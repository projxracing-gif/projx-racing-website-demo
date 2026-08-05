#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  AUTOMATION_ACKNOWLEDGEMENT,
  runIngestion,
  validateAutomationAuthorization
} from "./lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const privateImportRoot = path.join(repoRoot, "private-imports");

function outputPathIsSafe(value) {
  const output = path.resolve(value);
  const relativeToRepo = path.relative(repoRoot, output);
  const insideRepo = !relativeToRepo.startsWith("..") && !path.isAbsolute(relativeToRepo);
  if (!insideRepo) return true;
  const relativeToPrivateImports = path.relative(privateImportRoot, output);
  return !relativeToPrivateImports.startsWith("..") && !path.isAbsolute(relativeToPrivateImports);
}

function usage() {
  return `
Usage:
  node scripts/ecs-catalog/ingest.mjs --manifest <file> --output <directory> [options]

Safe default (no network):
  Manifest entries must contain snapshotPath or a manually collected record.

Options:
  --manifest <file>            JSON manifest or newline-separated URL list
  --output <directory>         Checkpoint, raw snapshots, catalogue and validation output
  --fetch                      Enable network fetch only with explicit written authorization
  --authorization-file <file>  Required with --fetch; see README and invalid example template
  --rate-ms <milliseconds>     Minimum delay between requests (minimum 2000; default 5000)
  --retries <count>            Retry count for 429/5xx/network errors (maximum 5; default 3)
  --timeout-ms <milliseconds>  Per-request timeout (default 30000)
  --max-response-bytes <bytes> Maximum fetched HTML size (1 KiB-10 MiB; default 5 MiB)
  --refresh                    Reprocess entries already completed in the checkpoint
  --help                       Show this help

Automated-access acknowledgement (must be accompanied by an actual written grant):
  ${AUTOMATION_ACKNOWLEDGEMENT}
`;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") options.help = true;
    else if (argument === "--fetch") options.fetch = true;
    else if (argument === "--refresh") options.refresh = true;
    else if (argument.startsWith("--")) {
      const key = argument.slice(2);
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
      options[key] = value;
      index += 1;
    } else {
      throw new Error(`Unexpected argument: ${argument}`);
    }
  }
  return options;
}

async function loadManifest(filePath) {
  const absolutePath = path.resolve(filePath);
  const contents = await readFile(absolutePath, "utf8");
  if (path.extname(absolutePath).toLowerCase() === ".txt") {
    return {
      snapshotRoot: path.dirname(absolutePath),
      entries: contents
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((sourceUrl) => ({ sourceUrl }))
    };
  }
  const manifest = JSON.parse(contents);
  const entries = Array.isArray(manifest) ? manifest : manifest.entries;
  if (!Array.isArray(entries)) throw new Error("Manifest JSON must be an array or contain an entries array");
  return {
    snapshotRoot: path.dirname(absolutePath),
    entries: entries.map((entry) => {
      if (typeof entry === "string") return { sourceUrl: entry };
      const normalized = { ...entry };
      if (normalized.snapshotPath) {
        normalized.snapshotPath = path.resolve(path.dirname(absolutePath), normalized.snapshotPath);
      }
      return normalized;
    })
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  if (!options.manifest || !options.output) throw new Error(`--manifest and --output are required\n${usage()}`);
  if (!outputPathIsSafe(options.output)) {
    throw new Error("Catalogue review output inside this repository must stay under ignored private-imports/. Use an external directory or private-imports/ecs-catalog-review.");
  }
  const { entries, snapshotRoot } = await loadManifest(options.manifest);
  let authorization = null;
  if (options.fetch) {
    if (!options["authorization-file"]) {
      throw new Error("--fetch requires --authorization-file containing evidence of explicit automated-access permission");
    }
    authorization = JSON.parse(await readFile(path.resolve(options["authorization-file"]), "utf8"));
    const errors = validateAutomationAuthorization(authorization, entries);
    if (errors.length) throw new Error(`Automated access is not authorized:\n- ${errors.join("\n- ")}`);
  }

  const result = await runIngestion({
    entries,
    outputDir: options.output,
    fetchMode: Boolean(options.fetch),
    authorization,
    rateLimitMs: Number(options["rate-ms"] ?? 5_000),
    retries: Number(options.retries ?? 3),
    timeoutMs: Number(options["timeout-ms"] ?? 30_000),
    maxResponseBytes: Number(options["max-response-bytes"] ?? 5 * 1024 * 1024),
    refresh: Boolean(options.refresh),
    snapshotRoot
  });
  process.stdout.write(`${JSON.stringify({ summary: result.summary, validation: {
    valid: result.validation.valid,
    productCount: result.validation.productCount,
    invalidProductCount: result.validation.invalidProductCount
  } }, null, 2)}\n`);
  if (result.summary.failed > 0 || !result.validation.valid) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
