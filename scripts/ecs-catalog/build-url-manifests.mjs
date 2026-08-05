#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  lstat,
  mkdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonicalizeProductUrl } from "./lib.mjs";

export const URL_MANIFEST_SCHEMA_VERSION = 1;
export const DEFAULT_URLS_PER_MANIFEST = 10_000;
export const DEFAULT_MANIFEST_BYTES = 2 * 1024 * 1024;
export const DEFAULT_BUCKET_COUNT = 64;
export const MAX_INPUT_LINE_BYTES = 8 * 1024;
export const MAX_CANONICAL_URL_BYTES = 2 * 1024;
export const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
export const MAX_URLS_PER_MANIFEST = 100_000;

const MANIFEST_OVERHEAD_RESERVE = 4 * 1024;
const MAX_REPORTED_INVALID_LINES = 50;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const privateImportRoot = path.join(repoRoot, "private-imports");
const headerValues = new Set(["url", "sourceurl", "source_url", "producturl", "product_url"]);

function isInside(base, candidate) {
  const relative = path.relative(base, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function projectedRealPath(candidate) {
  let ancestor = candidate;
  while (true) {
    try {
      const physicalAncestor = await realpath(ancestor);
      return path.resolve(physicalAncestor, path.relative(ancestor, candidate));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
}

function assertAllowedLocation(value, repository, privateImports) {
  if (isInside(repository, value) && (
    !isInside(privateImports, value) || path.relative(privateImports, value) === ""
  )) {
    throw new Error(
      "URL manifest output inside this repository must be a directory below ignored private-imports/. Use a new external directory or private-imports/ecs-url-manifests/<snapshot>."
    );
  }
}

export async function resolveSafeOutputPath(value) {
  if (!value || typeof value !== "string") throw new Error("A URL manifest output directory is required.");
  const output = path.resolve(value);
  if (output === path.parse(output).root) throw new Error("The filesystem root cannot be used as URL manifest output.");
  const [physicalOutput, resolvedRepo, resolvedPrivateImports] = await Promise.all([
    projectedRealPath(output),
    realpath(repoRoot),
    realpath(privateImportRoot)
  ]);
  assertAllowedLocation(output, repoRoot, privateImportRoot);
  assertAllowedLocation(physicalOutput, resolvedRepo, resolvedPrivateImports);
  try {
    await lstat(output);
    throw new Error(`URL manifest output already exists and will not be overwritten: ${output}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return output;
}

function safeErrorMessage(error) {
  return String(error?.message ?? error).replace(/:\s+.*$/s, "");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function bucketNumber(url, bucketCount) {
  return createHash("sha256").update(url, "utf8").digest().readUInt32BE(0) % bucketCount;
}

function bucketFileName(index) {
  return `bucket-${String(index).padStart(4, "0")}.txt`;
}

function manifestFileName(sequence) {
  return `ecs-product-urls-${String(sequence).padStart(8, "0")}.json`;
}

function validateLimits({ maxUrls, maxBytes, bucketCount }) {
  if (!Number.isInteger(maxUrls) || maxUrls < 1 || maxUrls > MAX_URLS_PER_MANIFEST) {
    throw new Error(`maxUrls must be an integer between 1 and ${MAX_URLS_PER_MANIFEST}.`);
  }
  if (!Number.isInteger(maxBytes) || maxBytes < 8 * 1024 || maxBytes > MAX_MANIFEST_BYTES) {
    throw new Error(`maxBytes must be an integer between 8192 and ${MAX_MANIFEST_BYTES}.`);
  }
  if (
    !Number.isInteger(bucketCount) ||
    bucketCount < 4 ||
    bucketCount > 256 ||
    (bucketCount & (bucketCount - 1)) !== 0
  ) {
    throw new Error("bucketCount must be a power of two between 4 and 256.");
  }
}

function newBucketWriter(filePath) {
  const state = {
    error: null,
    stream: createWriteStream(filePath, { encoding: "utf8", flags: "a" })
  };
  state.stream.on("error", (error) => {
    state.error = error;
  });
  return state;
}

async function writeBucketLine(state, value) {
  if (state.error) throw state.error;
  if (!state.stream.write(`${value}\n`)) await once(state.stream, "drain");
  if (state.error) throw state.error;
}

async function closeBucketWriters(states) {
  await Promise.all(
    states.map(
      (state) =>
        new Promise((resolve, reject) => {
          if (state.error) {
            reject(state.error);
            return;
          }
          state.stream.once("finish", resolve);
          state.stream.once("error", reject);
          state.stream.end();
        })
    )
  );
}

async function partitionInput({ input, bucketDirectory, bucketCount }) {
  const sourceHash = createHash("sha256");
  const writers = new Map();
  const invalidSamples = [];
  const counts = {
    inputLines: 0,
    ignoredLines: 0,
    candidateLines: 0,
    acceptedEntries: 0,
    canonicalizedEntries: 0,
    invalidLines: 0
  };
  let sourceBytes = 0;
  let sawFirstCandidate = false;
  const inputStream = createReadStream(input);
  inputStream.on("data", (chunk) => {
    sourceHash.update(chunk);
    sourceBytes += chunk.length;
  });
  const lines = readline.createInterface({ input: inputStream, crlfDelay: Infinity });

  try {
    for await (const inputLine of lines) {
      counts.inputLines += 1;
      const withoutBom = counts.inputLines === 1 ? inputLine.replace(/^\uFEFF/, "") : inputLine;
      const value = withoutBom.trim();
      if (!value || value.startsWith("#")) {
        counts.ignoredLines += 1;
        continue;
      }
      if (!sawFirstCandidate && headerValues.has(value.toLocaleLowerCase("en-US"))) {
        sawFirstCandidate = true;
        counts.ignoredLines += 1;
        continue;
      }
      sawFirstCandidate = true;
      counts.candidateLines += 1;
      let canonicalUrl;
      try {
        if (Buffer.byteLength(withoutBom, "utf8") > MAX_INPUT_LINE_BYTES) {
          throw new Error(`Input line exceeds ${MAX_INPUT_LINE_BYTES} bytes`);
        }
        if (/[\u0000-\u001F\u007F]/u.test(value)) throw new Error("Input URL contains control characters");
        canonicalUrl = canonicalizeProductUrl(value);
        if (Buffer.byteLength(canonicalUrl, "utf8") > MAX_CANONICAL_URL_BYTES) {
          throw new Error(`Canonical URL exceeds ${MAX_CANONICAL_URL_BYTES} bytes`);
        }
      } catch (error) {
        counts.invalidLines += 1;
        if (invalidSamples.length < MAX_REPORTED_INVALID_LINES) {
          invalidSamples.push({ line: counts.inputLines, reason: safeErrorMessage(error) });
        }
        continue;
      }

      if (canonicalUrl !== value) counts.canonicalizedEntries += 1;
      const number = bucketNumber(canonicalUrl, bucketCount);
      let writer = writers.get(number);
      if (!writer) {
        writer = newBucketWriter(path.join(bucketDirectory, bucketFileName(number)));
        writers.set(number, writer);
      }
      await writeBucketLine(writer, canonicalUrl);
      counts.acceptedEntries += 1;
    }
  } finally {
    await closeBucketWriters([...writers.values()]);
  }

  return {
    counts,
    invalidSamples,
    sourceBytes,
    sourceSha256: sourceHash.digest("hex")
  };
}

async function readUniqueSortedUrls(filePath) {
  const unique = new Set();
  const input = createReadStream(filePath);
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line) unique.add(line);
  }
  return [...unique].sort((left, right) => left.localeCompare(right, "en-US"));
}

function createManifestAccumulator({ stagingDirectory, maxUrls, maxBytes }) {
  const manifests = [];
  let urls = [];
  let payloadBytes = 2;

  async function flush() {
    if (!urls.length) return;
    const sequence = manifests.length + 1;
    const file = manifestFileName(sequence);
    const document = {
      schemaVersion: URL_MANIFEST_SCHEMA_VERSION,
      supplier: "ECS Tuning",
      kind: "ecs-product-url-manifest",
      sequence,
      urlCount: urls.length,
      entries: urls
    };
    const contents = `${JSON.stringify(document)}\n`;
    const bytes = Buffer.byteLength(contents, "utf8");
    if (bytes > maxBytes) {
      throw new Error(`Generated manifest ${file} exceeds the configured ${maxBytes}-byte limit.`);
    }
    const digest = sha256(contents);
    await writeFile(path.join(stagingDirectory, file), contents, "utf8");
    manifests.push({
      sequence,
      file,
      urlCount: urls.length,
      bytes,
      sha256: digest
    });
    urls = [];
    payloadBytes = 2;
  }

  async function add(url) {
    const encodedBytes = Buffer.byteLength(JSON.stringify(url), "utf8");
    const nextPayloadBytes = payloadBytes + (urls.length ? 1 : 0) + encodedBytes;
    if (urls.length && (urls.length >= maxUrls || nextPayloadBytes > maxBytes - MANIFEST_OVERHEAD_RESERVE)) {
      await flush();
    }
    const emptyPayloadBytes = 2 + encodedBytes;
    if (!urls.length && emptyPayloadBytes > maxBytes - MANIFEST_OVERHEAD_RESERVE) {
      throw new Error("A canonical ECS product URL is too large for the configured manifest byte limit.");
    }
    payloadBytes += (urls.length ? 1 : 0) + encodedBytes;
    urls.push(url);
  }

  return { add, flush, manifests };
}

async function createManifests({ stagingDirectory, bucketDirectory, bucketCount, maxUrls, maxBytes }) {
  const accumulator = createManifestAccumulator({ stagingDirectory, maxUrls, maxBytes });
  let uniqueUrls = 0;
  for (let index = 0; index < bucketCount; index += 1) {
    const bucketPath = path.join(bucketDirectory, bucketFileName(index));
    try {
      await stat(bucketPath);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    const bucketUrls = await readUniqueSortedUrls(bucketPath);
    for (const url of bucketUrls) {
      await accumulator.add(url);
      uniqueUrls += 1;
    }
  }
  await accumulator.flush();
  return { manifests: accumulator.manifests, uniqueUrls };
}

function manifestSetDigest(manifests) {
  const hash = createHash("sha256");
  for (const manifest of manifests) {
    hash.update(
      `${manifest.sequence}\0${manifest.file}\0${manifest.urlCount}\0${manifest.bytes}\0${manifest.sha256}\n`,
      "utf8"
    );
  }
  return hash.digest("hex");
}

function invalidInputError(partition) {
  const details = partition.invalidSamples
    .map((sample) => `line ${sample.line}: ${sample.reason}`)
    .join("\n- ");
  const omitted = partition.counts.invalidLines - partition.invalidSamples.length;
  return new Error(
    `The ECS product URL list contains ${partition.counts.invalidLines} invalid line(s); no manifests were published.\n- ${details}${
      omitted > 0 ? `\n- ${omitted} additional invalid line(s) omitted` : ""
    }`
  );
}

export async function buildUrlManifests({
  inputPath,
  outputPath,
  maxUrls = DEFAULT_URLS_PER_MANIFEST,
  maxBytes = DEFAULT_MANIFEST_BYTES,
  bucketCount = DEFAULT_BUCKET_COUNT,
  generatedAt = new Date().toISOString()
}) {
  validateLimits({ maxUrls, maxBytes, bucketCount });
  const generatedTimestamp = new Date(generatedAt);
  if (!Number.isFinite(generatedTimestamp.getTime())) throw new Error("generatedAt must be a valid date-time.");
  const input = path.resolve(inputPath ?? "");
  const inputStats = await stat(input);
  if (!inputStats.isFile()) throw new Error("The ECS product URL input must be a regular file.");
  const output = await resolveSafeOutputPath(outputPath);
  const stagingDirectory = path.join(
    path.dirname(output),
    `.${path.basename(output)}.working-${process.pid}-${randomBytes(6).toString("hex")}`
  );
  const bucketDirectory = path.join(stagingDirectory, ".buckets");

  await mkdir(bucketDirectory, { recursive: true });
  let published = false;
  try {
    const partition = await partitionInput({ input, bucketDirectory, bucketCount });
    if (partition.counts.invalidLines) throw invalidInputError(partition);
    if (!partition.counts.acceptedEntries) {
      throw new Error("The ECS product URL list did not contain any valid product URLs; no manifests were published.");
    }

    const { manifests, uniqueUrls } = await createManifests({
      stagingDirectory,
      bucketDirectory,
      bucketCount,
      maxUrls,
      maxBytes
    });
    await rm(bucketDirectory, { recursive: true, force: true });
    const duplicateUrls = partition.counts.acceptedEntries - uniqueUrls;
    const index = {
      schemaVersion: URL_MANIFEST_SCHEMA_VERSION,
      supplier: "ECS Tuning",
      kind: "ecs-product-url-manifest-index",
      generatedAt: generatedTimestamp.toISOString(),
      offlineOnly: true,
      source: {
        fileName: path.basename(input),
        bytes: partition.sourceBytes,
        sha256: partition.sourceSha256
      },
      counts: {
        ...partition.counts,
        uniqueUrls,
        duplicateUrls,
        manifests: manifests.length
      },
      limits: {
        maxUrlsPerManifest: maxUrls,
        maxManifestBytes: maxBytes,
        deduplicationBuckets: bucketCount
      },
      ordering: "sha256-bucket-then-canonical-url",
      manifestSetSha256: manifestSetDigest(manifests),
      manifests
    };
    const indexContents = `${JSON.stringify(index, null, 2)}\n`;
    const indexSha256 = sha256(indexContents);
    await writeFile(path.join(stagingDirectory, "index.json"), indexContents, "utf8");
    await writeFile(path.join(stagingDirectory, "index.json.sha256"), `${indexSha256}  index.json\n`, "utf8");
    await rename(stagingDirectory, output);
    published = true;
    return { ...index, indexSha256, outputDirectory: output };
  } finally {
    if (!published) await rm(stagingDirectory, { recursive: true, force: true });
  }
}

function usage() {
  return `
Usage:
  node scripts/ecs-catalog/build-url-manifests.mjs --input <urls.txt> --output <new-directory> [options]

This command performs offline file processing only. It never requests, crawls or opens a URL.

Required:
  --input <file>       UTF-8 text file containing one public ECS product URL per line
  --output <directory> New output below private-imports/ or a new external directory

Options:
  --max-urls <count>   Maximum URLs per manifest (default ${DEFAULT_URLS_PER_MANIFEST})
  --max-bytes <bytes>  Maximum bytes per manifest (default ${DEFAULT_MANIFEST_BYTES})
  --buckets <count>    Deduplication buckets: power of two, 4-256 (default ${DEFAULT_BUCKET_COUNT})
  --help               Show this help
`;
}

function integerArgument(value, label) {
  if (!/^\d+$/.test(String(value ?? ""))) throw new Error(`${label} must be a positive integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} is too large.`);
  return parsed;
}

export function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      options.help = true;
      continue;
    }
    if (!["--input", "--output", "--max-urls", "--max-bytes", "--buckets"].includes(argument)) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    options[argument.slice(2)] = value;
    index += 1;
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  if (!options.input || !options.output) throw new Error(`--input and --output are required.\n${usage()}`);
  const result = await buildUrlManifests({
    inputPath: options.input,
    outputPath: options.output,
    maxUrls: options["max-urls"]
      ? integerArgument(options["max-urls"], "--max-urls")
      : DEFAULT_URLS_PER_MANIFEST,
    maxBytes: options["max-bytes"]
      ? integerArgument(options["max-bytes"], "--max-bytes")
      : DEFAULT_MANIFEST_BYTES,
    bucketCount: options.buckets ? integerArgument(options.buckets, "--buckets") : DEFAULT_BUCKET_COUNT
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        outputDirectory: result.outputDirectory,
        inputLines: result.counts.inputLines,
        uniqueUrls: result.counts.uniqueUrls,
        duplicateUrls: result.counts.duplicateUrls,
        manifests: result.counts.manifests,
        indexSha256: result.indexSha256
      },
      null,
      2
    )}\n`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
