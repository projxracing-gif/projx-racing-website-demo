#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile
} from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildUrlManifests } from "./build-url-manifests.mjs";
import {
  canonicalizeProductUrl,
  validateAutomationAuthorizationGrant
} from "./lib.mjs";

export const ECS_SITEMAP_INDEX = "https://www.ecstuning.com/sitemap_index.xml";
export const ECS_PRODUCT_SHARD_COUNT = 177;
export const DEFAULT_REQUEST_INTERVAL_MS = 2_000;
export const DEFAULT_TIMEOUT_MS = 45_000;
export const DEFAULT_MAX_XML_BYTES = 24 * 1024 * 1024;
export const DEFAULT_RETRIES = 1;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const privateImports = path.join(repoRoot, "private-imports");
const MAX_AUTHORIZATION_BYTES = 64 * 1024;
const MAX_INDEX_BYTES = 4 * 1024 * 1024;
const XML_CONTENT_TYPE = /^(?:application|text)\/(?:[a-z0-9.+-]*\+)?xml(?:\s*;|$)/i;

class PermanentCollectionError extends Error {
  constructor(message) {
    super(message);
    this.name = "PermanentCollectionError";
    this.permanent = true;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isInside(base, candidate) {
  const relative = path.relative(base, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function boundedRegularFile(filePath, maximumBytes, label) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular file.`);
  if (info.size > maximumBytes) throw new Error(`${label} exceeds ${maximumBytes} bytes.`);
  return readFile(filePath, "utf8");
}

async function resolvePrivateWorkspace(value) {
  if (!value || typeof value !== "string") throw new Error("--output is required.");
  const output = path.resolve(value);
  const privateRoot = await realpath(privateImports);
  if (!isInside(privateImports, output) || output === privateImports) {
    throw new Error("Sitemap collection output must be a child directory below ignored private-imports/.");
  }
  await mkdir(output, { recursive: true });
  const physicalOutput = await realpath(output);
  if (!isInside(privateRoot, physicalOutput) || physicalOutput === privateRoot) {
    throw new Error("Sitemap collection output resolves outside ignored private-imports/.");
  }
  return physicalOutput;
}

function expectedShardUrl(number) {
  if (!Number.isInteger(number) || number < 0 || number >= ECS_PRODUCT_SHARD_COUNT) {
    throw new Error(`Invalid ECS product sitemap shard number: ${number}`);
  }
  return `https://www.ecstuning.com/sitemap_product_${number}.xml`;
}

export function normalizeShardUrl(value) {
  const raw = String(value ?? "").trim();
  const normalized = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("Invalid ECS sitemap URL.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "www.ecstuning.com" ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("ECS sitemap URL is outside the approved public origin.");
  }
  const match = /^\/sitemap_product_(0|[1-9]\d?|1[0-6]\d|17[0-6])\.xml$/.exec(parsed.pathname);
  if (!match) throw new Error("ECS sitemap URL is not an approved product shard.");
  const number = Number(match[1]);
  const canonical = expectedShardUrl(number);
  if (parsed.href !== canonical) throw new Error("ECS sitemap URL is not canonical.");
  return { number, url: canonical };
}

function decodeXmlText(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function locValues(xml) {
  const values = [];
  const pattern = /<loc\b[^>]*>([\s\S]*?)<\/loc>/gi;
  let match;
  while ((match = pattern.exec(xml))) values.push(decodeXmlText(match[1].trim()));
  return values;
}

export function parseSitemapIndex(xml) {
  if (typeof xml !== "string" || !/<sitemapindex\b/i.test(xml)) {
    throw new Error("ECS sitemap index XML is invalid.");
  }
  const byNumber = new Map();
  for (const value of locValues(xml)) {
    let shard;
    try {
      shard = normalizeShardUrl(value);
    } catch {
      continue;
    }
    if (byNumber.has(shard.number)) throw new Error(`Duplicate ECS product sitemap shard ${shard.number}.`);
    byNumber.set(shard.number, shard.url);
  }
  if (byNumber.size !== ECS_PRODUCT_SHARD_COUNT) {
    throw new Error(`Expected ${ECS_PRODUCT_SHARD_COUNT} ECS product sitemap shards; found ${byNumber.size}.`);
  }
  const shards = [];
  for (let number = 0; number < ECS_PRODUCT_SHARD_COUNT; number += 1) {
    const url = byNumber.get(number);
    if (url !== expectedShardUrl(number)) throw new Error(`Missing ECS product sitemap shard ${number}.`);
    shards.push({ number, url });
  }
  return shards;
}

export function parseProductSitemap(xml) {
  if (typeof xml !== "string" || !/<urlset\b/i.test(xml)) {
    throw new Error("ECS product sitemap XML is invalid.");
  }
  const unique = new Set();
  for (const value of locValues(xml)) unique.add(canonicalizeProductUrl(value));
  if (!unique.size) throw new Error("ECS product sitemap contains no approved product URLs.");
  return [...unique].sort((left, right) => left.localeCompare(right, "en-US"));
}

function challengeResponse(response, text) {
  const mitigated = String(response.headers?.get?.("cf-mitigated") ?? "").toLowerCase();
  const server = String(response.headers?.get?.("server") ?? "").toLowerCase();
  return mitigated === "challenge" || (
    server.includes("cloudflare") && /(?:just a moment|challenge-platform|cf-chl-|enable javascript and cookies)/i.test(text)
  );
}

async function responseTextWithinLimit(response, maximumBytes) {
  const announced = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(announced) && announced > maximumBytes) {
    throw new PermanentCollectionError(`XML response exceeds ${maximumBytes} bytes.`);
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maximumBytes) throw new PermanentCollectionError(`XML response exceeds ${maximumBytes} bytes.`);
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > maximumBytes) {
      await reader.cancel("response-too-large").catch(() => {});
      throw new PermanentCollectionError(`XML response exceeds ${maximumBytes} bytes.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

function integerOption(value, label, minimum, maximum) {
  const raw = String(value ?? "");
  if (!/^\d+$/.test(raw)) throw new Error(`${label} must be a whole number.`);
  const number = Number(raw);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return number;
}

async function loadAuthorization(filePath, expectedSha256 = null, at = new Date()) {
  const contents = await boundedRegularFile(path.resolve(filePath), MAX_AUTHORIZATION_BYTES, "Authorization file");
  const digest = sha256(contents);
  if (expectedSha256 && digest !== expectedSha256) throw new Error("Authorization file changed during sitemap collection.");
  let value;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error("Authorization file is not valid JSON.");
  }
  const errors = validateAutomationAuthorizationGrant(value, at);
  if (errors.length) throw new Error(`Automated-access authorization failed:\n- ${errors.join("\n- ")}`);
  return { digest, value };
}

function newRateGate(intervalMs, sleep, now) {
  let lastRequestStartedAt = null;
  return async function waitForTurn() {
    const current = now();
    if (lastRequestStartedAt !== null) {
      const waitMs = Math.max(0, intervalMs - (current - lastRequestStartedAt));
      if (waitMs) await sleep(waitMs);
    }
    lastRequestStartedAt = now();
  };
}

export async function fetchApprovedXml(url, {
  authorizationFile,
  authorizationSha256,
  fetchImpl = globalThis.fetch,
  waitForTurn = async () => {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maximumBytes = DEFAULT_MAX_XML_BYTES,
  retries = DEFAULT_RETRIES,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  nowDate = () => new Date()
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable.");
  if (url !== ECS_SITEMAP_INDEX) normalizeShardUrl(url);
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    await loadAuthorization(authorizationFile, authorizationSha256, nowDate());
    await waitForTurn();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        headers: {
          accept: "application/xml,text/xml;q=0.9",
          "user-agent": "ProjxRacingAuthorizedCatalogueSitemapCollector/1.0"
        },
        redirect: "manual",
        signal: controller.signal
      });
      if (response.status >= 300 && response.status < 400) {
        throw new PermanentCollectionError(`Redirects are not allowed for ECS sitemap collection (HTTP ${response.status}).`);
      }
      const text = await responseTextWithinLimit(response, maximumBytes);
      if (challengeResponse(response, text)) throw new PermanentCollectionError("ECS returned an interactive access challenge; collection stopped without bypassing it.");
      if (response.ok) {
        const contentType = String(response.headers?.get?.("content-type") ?? "");
        if (!XML_CONTENT_TYPE.test(contentType)) throw new PermanentCollectionError(`ECS sitemap content type is not XML: ${contentType || "missing"}.`);
        return text;
      }
      const message = `ECS sitemap request failed with HTTP ${response.status}.`;
      if (response.status !== 408 && response.status !== 429 && response.status < 500) throw new PermanentCollectionError(message);
      lastError = new Error(message);
      const retryAfter = Number(response.headers?.get?.("retry-after"));
      if (attempt < retries) await sleep(Number.isFinite(retryAfter) ? Math.min(retryAfter * 1_000, 60_000) : Math.min(30_000, 2_000 * 2 ** attempt));
    } catch (error) {
      if (error?.permanent) throw error;
      lastError = error;
      if (attempt < retries) await sleep(Math.min(30_000, 2_000 * 2 ** attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError ?? new Error("ECS sitemap request failed.");
}

async function atomicJson(filePath, value) {
  const temporary = `${filePath}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, filePath);
}

async function fileSha256(filePath) {
  const hash = createHash("sha256");
  const input = createReadStream(filePath);
  input.on("data", (chunk) => hash.update(chunk));
  await once(input, "end");
  return hash.digest("hex");
}

async function durableShard(filePath, expected) {
  try {
    const contents = await boundedRegularFile(filePath, DEFAULT_MAX_XML_BYTES * 2, "Saved sitemap URL shard");
    const urls = contents.trim() ? contents.trimEnd().split("\n") : [];
    return urls.length === expected.urlCount && sha256(contents) === expected.sha256;
  } catch {
    return false;
  }
}

async function concatenateShardFiles(shardDirectory, destination) {
  const output = createWriteStream(destination, { encoding: "utf8", flags: "wx" });
  try {
    for (let number = 0; number < ECS_PRODUCT_SHARD_COUNT; number += 1) {
      const input = createReadStream(path.join(shardDirectory, `${String(number).padStart(3, "0")}.urls.txt`));
      input.pipe(output, { end: false });
      await once(input, "end");
    }
  } finally {
    output.end();
    await once(output, "finish");
  }
}

export async function collectEcsSitemaps({
  outputPath,
  authorizationFile,
  fetchMode = false,
  intervalMs = DEFAULT_REQUEST_INTERVAL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maximumBytes = DEFAULT_MAX_XML_BYTES,
  retries = DEFAULT_RETRIES,
  fetchImpl = globalThis.fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = () => Date.now(),
  nowDate = () => new Date()
}) {
  if (!fetchMode) throw new Error("Network sitemap collection is locked. Pass --fetch with the retained written authorization.");
  integerOption(intervalMs, "intervalMs", 2_000, 60_000);
  integerOption(timeoutMs, "timeoutMs", 1_000, 120_000);
  integerOption(maximumBytes, "maximumBytes", 1_024, 32 * 1024 * 1024);
  integerOption(retries, "retries", 0, 3);
  const workspace = await resolvePrivateWorkspace(outputPath);
  const shardDirectory = path.join(workspace, "sitemap-url-shards");
  await mkdir(shardDirectory, { recursive: true });
  const authorization = await loadAuthorization(authorizationFile, null, nowDate());
  const waitForTurn = newRateGate(intervalMs, sleep, now);
  const fetchOptions = {
    authorizationFile,
    authorizationSha256: authorization.digest,
    fetchImpl,
    waitForTurn,
    timeoutMs,
    maximumBytes,
    retries,
    sleep,
    nowDate
  };

  const checkpointPath = path.join(workspace, "checkpoint.json");
  let checkpoint = {
    schemaVersion: 1,
    supplier: "ECS Tuning",
    source: ECS_SITEMAP_INDEX,
    authorizationSha256: authorization.digest,
    startedAt: nowDate().toISOString(),
    updatedAt: nowDate().toISOString(),
    complete: false,
    shards: {}
  };
  try {
    const saved = JSON.parse(await boundedRegularFile(checkpointPath, 2 * 1024 * 1024, "Sitemap checkpoint"));
    if (saved?.schemaVersion !== 1 || saved?.source !== ECS_SITEMAP_INDEX || saved?.authorizationSha256 !== authorization.digest) {
      throw new Error("Existing sitemap checkpoint does not match this authorized collection.");
    }
    checkpoint = saved;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await atomicJson(checkpointPath, checkpoint);
  }

  const indexXml = await fetchApprovedXml(ECS_SITEMAP_INDEX, {
    ...fetchOptions,
    maximumBytes: Math.min(maximumBytes, MAX_INDEX_BYTES)
  });
  const shards = parseSitemapIndex(indexXml);
  const indexSha256 = sha256(indexXml);
  if (checkpoint.indexSha256 && checkpoint.indexSha256 !== indexSha256) {
    throw new Error("ECS sitemap index changed during a resumed collection; use a new output directory.");
  }
  checkpoint.indexSha256 = indexSha256;
  checkpoint.shardCount = shards.length;
  checkpoint.updatedAt = nowDate().toISOString();
  await atomicJson(checkpointPath, checkpoint);

  for (const shard of shards) {
    const key = String(shard.number);
    const filePath = path.join(shardDirectory, `${String(shard.number).padStart(3, "0")}.urls.txt`);
    if (checkpoint.shards[key]?.complete && await durableShard(filePath, checkpoint.shards[key])) continue;
    const xml = await fetchApprovedXml(shard.url, fetchOptions);
    const urls = parseProductSitemap(xml);
    const contents = `${urls.join("\n")}\n`;
    await writeFile(filePath, contents, { encoding: "utf8", flag: "w" });
    checkpoint.shards[key] = {
      complete: true,
      sourceUrl: shard.url,
      sourceSha256: sha256(xml),
      urlCount: urls.length,
      sha256: sha256(contents),
      collectedAt: nowDate().toISOString()
    };
    checkpoint.updatedAt = nowDate().toISOString();
    await atomicJson(checkpointPath, checkpoint);
  }

  const inputPath = path.join(workspace, "product-urls.txt");
  try {
    const inputStats = await stat(inputPath);
    if (!inputStats.isFile()) throw new Error("Saved consolidated product URL input is not a regular file.");
    const digest = await fileSha256(inputPath);
    if (!checkpoint.inputSha256 || digest !== checkpoint.inputSha256 || inputStats.size !== checkpoint.inputBytes) {
      throw new Error("Saved consolidated product URL input failed its resume integrity check; use a new output directory.");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const temporaryInput = `${inputPath}.building-${process.pid}-${randomBytes(4).toString("hex")}`;
    await concatenateShardFiles(shardDirectory, temporaryInput);
    const inputStats = await stat(temporaryInput);
    checkpoint.inputBytes = inputStats.size;
    checkpoint.inputSha256 = await fileSha256(temporaryInput);
    await rename(temporaryInput, inputPath);
    checkpoint.updatedAt = nowDate().toISOString();
    await atomicJson(checkpointPath, checkpoint);
  }
  const manifestOutput = path.join(workspace, "url-manifests");
  let manifestIndex;
  try {
    manifestIndex = JSON.parse(await boundedRegularFile(path.join(manifestOutput, "index.json"), 4 * 1024 * 1024, "URL manifest index"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    manifestIndex = await buildUrlManifests({ inputPath, outputPath: manifestOutput, generatedAt: nowDate().toISOString() });
  }
  checkpoint.complete = true;
  checkpoint.completedAt = nowDate().toISOString();
  checkpoint.updatedAt = checkpoint.completedAt;
  checkpoint.uniqueProductUrls = manifestIndex.counts.uniqueUrls;
  checkpoint.duplicateProductUrls = manifestIndex.counts.duplicateUrls;
  checkpoint.manifestCount = manifestIndex.counts.manifests;
  checkpoint.manifestSetSha256 = manifestIndex.manifestSetSha256;
  await atomicJson(checkpointPath, checkpoint);
  return { workspace, checkpoint, manifestIndex };
}

function usage() {
  return `Usage:\n  node scripts/ecs-catalog/collect-sitemaps.mjs --output <private-imports/subdir> --authorization-file <file> --fetch [options]\n\nOptions:\n  --interval-ms <ms>       Minimum start-to-start interval, 2000-60000 (default 2000)\n  --timeout-ms <ms>        Request timeout, 1000-120000 (default 45000)\n  --max-xml-bytes <bytes>  Per-response limit, 1024-33554432 (default ${DEFAULT_MAX_XML_BYTES})\n  --retries <count>        Retry count for 408, 429, 5xx or network errors, 0-3 (default 1)\n  --help                   Show this help\n`;
}

export function parseArguments(argv) {
  const options = {};
  const valued = new Set(["--output", "--authorization-file", "--interval-ms", "--timeout-ms", "--max-xml-bytes", "--retries"]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") options.help = true;
    else if (argument === "--fetch") options.fetch = true;
    else if (valued.has(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
      options[argument.slice(2)] = value;
      index += 1;
    } else throw new Error(`Unexpected argument: ${argument}`);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) return process.stdout.write(usage());
  if (!options.output || !options["authorization-file"] || !options.fetch) throw new Error(`--output, --authorization-file and --fetch are required.\n${usage()}`);
  const result = await collectEcsSitemaps({
    outputPath: options.output,
    authorizationFile: options["authorization-file"],
    fetchMode: true,
    intervalMs: options["interval-ms"] ? integerOption(options["interval-ms"], "--interval-ms", 2_000, 60_000) : DEFAULT_REQUEST_INTERVAL_MS,
    timeoutMs: options["timeout-ms"] ? integerOption(options["timeout-ms"], "--timeout-ms", 1_000, 120_000) : DEFAULT_TIMEOUT_MS,
    maximumBytes: options["max-xml-bytes"] ? integerOption(options["max-xml-bytes"], "--max-xml-bytes", 1_024, 32 * 1024 * 1024) : DEFAULT_MAX_XML_BYTES,
    retries: options.retries ? integerOption(options.retries, "--retries", 0, 3) : DEFAULT_RETRIES
  });
  process.stdout.write(`${JSON.stringify({
    output: result.workspace,
    shards: result.checkpoint.shardCount,
    uniqueProductUrls: result.checkpoint.uniqueProductUrls,
    duplicates: result.checkpoint.duplicateProductUrls,
    manifests: result.checkpoint.manifestCount,
    manifestSetSha256: result.checkpoint.manifestSetSha256
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
