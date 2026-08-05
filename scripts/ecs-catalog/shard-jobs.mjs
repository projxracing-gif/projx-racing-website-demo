#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  canonicalizeProductUrl,
  runIngestion,
  validateAutomationAuthorization
} from "./lib.mjs";
import {
  MAX_MANIFEST_BYTES,
  MAX_URLS_PER_MANIFEST,
  URL_MANIFEST_SCHEMA_VERSION,
  resolveSafeOutputPath
} from "./build-url-manifests.mjs";

export const SHARD_JOB_PLAN_SCHEMA_VERSION = 1;
export const SHARD_CHECKPOINT_SCHEMA_VERSION = 1;
export const MIN_STALE_LOCK_AGE_MS = 60 * 60 * 1000;
export const MAX_STALE_LOCK_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const privateImportRoot = path.join(repoRoot, "private-imports");
const MAX_INDEX_BYTES = 16 * 1024 * 1024;
const MAX_AUTHORIZATION_BYTES = 64 * 1024;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isInside(base, candidate) {
  const relative = path.relative(base, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function portableRelative(from, to) {
  return path.relative(from, to).replace(/\\/g, "/");
}

function boundedInteger(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

async function readBoundedFile(filePath, maximumBytes, label) {
  const details = await stat(filePath);
  if (!details.isFile()) throw new Error(`${label} must be a regular file`);
  if (details.size > maximumBytes) throw new Error(`${label} exceeds the ${maximumBytes}-byte limit`);
  return readFile(filePath);
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
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

function validateDescriptor(descriptor, expectedSequence) {
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    throw new Error(`Manifest descriptor ${expectedSequence} must be an object`);
  }
  if (descriptor.sequence !== expectedSequence) {
    throw new Error(`Manifest sequence must be contiguous; expected ${expectedSequence}`);
  }
  if (
    typeof descriptor.file !== "string" ||
    !descriptor.file ||
    path.basename(descriptor.file) !== descriptor.file ||
    !/^ecs-product-urls-\d{8}\.json$/.test(descriptor.file)
  ) {
    throw new Error(`Manifest ${expectedSequence} has an unsafe file name`);
  }
  boundedInteger(descriptor.urlCount, `Manifest ${expectedSequence} urlCount`, 1, MAX_URLS_PER_MANIFEST);
  boundedInteger(descriptor.bytes, `Manifest ${expectedSequence} bytes`, 1, MAX_MANIFEST_BYTES);
  if (!/^[a-f0-9]{64}$/.test(descriptor.sha256 ?? "")) {
    throw new Error(`Manifest ${expectedSequence} has an invalid SHA-256`);
  }
}

async function readVerifiedIndex(indexPath) {
  const absolutePath = path.resolve(indexPath);
  const contents = await readBoundedFile(absolutePath, MAX_INDEX_BYTES, "ECS URL manifest index");
  const digest = sha256(contents);
  const sidecar = (await readBoundedFile(`${absolutePath}.sha256`, 1024, "ECS URL manifest index checksum"))
    .toString("utf8")
    .trim();
  if (sidecar !== `${digest}  index.json`) throw new Error("ECS URL manifest index checksum does not match");
  let index;
  try {
    index = JSON.parse(contents.toString("utf8"));
  } catch {
    throw new Error("ECS URL manifest index is not valid JSON");
  }
  if (
    index.schemaVersion !== URL_MANIFEST_SCHEMA_VERSION ||
    index.supplier !== "ECS Tuning" ||
    index.kind !== "ecs-product-url-manifest-index" ||
    index.offlineOnly !== true
  ) {
    throw new Error("ECS URL manifest index has an unsupported identity or schema");
  }
  if (!Array.isArray(index.manifests) || index.manifests.length === 0) {
    throw new Error("ECS URL manifest index must contain at least one manifest");
  }
  index.manifests.forEach((descriptor, offset) => validateDescriptor(descriptor, offset + 1));
  if (index.counts?.manifests !== index.manifests.length) {
    throw new Error("ECS URL manifest index count does not match its manifest list");
  }
  const urlCount = index.manifests.reduce((total, descriptor) => total + descriptor.urlCount, 0);
  if (index.counts?.uniqueUrls !== urlCount) {
    throw new Error("ECS URL manifest index unique URL count does not match its manifests");
  }
  if (index.manifestSetSha256 !== manifestSetDigest(index.manifests)) {
    throw new Error("ECS URL manifest set checksum does not match");
  }
  return { absolutePath, directory: path.dirname(absolutePath), digest, index };
}

async function readVerifiedShard(indexDirectory, descriptor) {
  const manifestPath = path.join(indexDirectory, descriptor.file);
  const contents = await readBoundedFile(manifestPath, MAX_MANIFEST_BYTES, `ECS URL shard ${descriptor.sequence}`);
  if (contents.byteLength !== descriptor.bytes || sha256(contents) !== descriptor.sha256) {
    throw new Error(`ECS URL shard ${descriptor.sequence} does not match the index`);
  }
  let manifest;
  try {
    manifest = JSON.parse(contents.toString("utf8"));
  } catch {
    throw new Error(`ECS URL shard ${descriptor.sequence} is not valid JSON`);
  }
  if (
    manifest.schemaVersion !== URL_MANIFEST_SCHEMA_VERSION ||
    manifest.supplier !== "ECS Tuning" ||
    manifest.kind !== "ecs-product-url-manifest" ||
    manifest.sequence !== descriptor.sequence ||
    manifest.urlCount !== descriptor.urlCount ||
    !Array.isArray(manifest.entries) ||
    manifest.entries.length !== descriptor.urlCount
  ) {
    throw new Error(`ECS URL shard ${descriptor.sequence} has an unsupported identity, schema or count`);
  }
  const seen = new Set();
  const entries = manifest.entries.map((sourceUrl, offset) => {
    if (typeof sourceUrl !== "string") {
      throw new Error(`ECS URL shard ${descriptor.sequence} entry ${offset + 1} is not a URL string`);
    }
    const canonical = canonicalizeProductUrl(sourceUrl);
    if (canonical !== sourceUrl) {
      throw new Error(`ECS URL shard ${descriptor.sequence} entry ${offset + 1} is not canonical`);
    }
    if (seen.has(canonical)) throw new Error(`ECS URL shard ${descriptor.sequence} contains a duplicate URL`);
    seen.add(canonical);
    return { sourceUrl: canonical };
  });
  return { manifestPath, entries };
}

async function readAuthorization(authorizationPath) {
  const absolutePath = path.resolve(authorizationPath);
  const contents = await readBoundedFile(
    absolutePath,
    MAX_AUTHORIZATION_BYTES,
    "ECS automated-access authorization"
  );
  let authorization;
  try {
    authorization = JSON.parse(contents.toString("utf8"));
  } catch {
    throw new Error("ECS automated-access authorization is not valid JSON");
  }
  return { authorization, digest: sha256(contents) };
}

async function assertSafeExistingWorkspace(value) {
  const workspace = path.resolve(value ?? "");
  if (!value || workspace === path.parse(workspace).root) throw new Error("A safe shard workspace is required");
  const details = await lstat(workspace);
  if (!details.isDirectory() || details.isSymbolicLink()) throw new Error("Shard workspace must be a real directory");
  const [physicalWorkspace, physicalRepo, physicalPrivateImports] = await Promise.all([
    realpath(workspace),
    realpath(repoRoot),
    realpath(privateImportRoot)
  ]);
  if (isInside(repoRoot, workspace) && !isInside(privateImportRoot, workspace)) {
    throw new Error("Shard workspace inside the repository must stay under ignored private-imports/");
  }
  if (isInside(physicalRepo, physicalWorkspace) && !isInside(physicalPrivateImports, physicalWorkspace)) {
    throw new Error("Shard workspace resolves outside ignored private-imports/");
  }
  return workspace;
}

export async function createShardJobPlan({
  indexPath,
  workspacePath,
  authorizationPath,
  at = new Date()
}) {
  const validationTime = at instanceof Date ? at : new Date(at);
  if (!Number.isFinite(validationTime.getTime())) throw new Error("Shard plan validation time is invalid");
  const [{ absolutePath: indexAbsolutePath, directory: indexDirectory, digest: indexSha256, index }, authorizationData] =
    await Promise.all([readVerifiedIndex(indexPath), readAuthorization(authorizationPath)]);
  const workspace = await resolveSafeOutputPath(workspacePath);
  const staging = path.join(
    path.dirname(workspace),
    `.${path.basename(workspace)}.working-${process.pid}-${randomBytes(6).toString("hex")}`
  );
  await mkdir(path.join(staging, "checkpoints"), { recursive: true });
  await mkdir(path.join(staging, "locks"), { recursive: true });
  await mkdir(path.join(staging, "stale-locks"), { recursive: true });
  await mkdir(path.join(staging, "results"), { recursive: true });
  let committed = false;
  try {
    const jobs = [];
    for (const descriptor of index.manifests) {
      const { entries } = await readVerifiedShard(indexDirectory, descriptor);
      const authorizationErrors = validateAutomationAuthorization(
        authorizationData.authorization,
        entries,
        validationTime
      );
      if (authorizationErrors.length) {
        throw new Error(
          `Automated access is not authorized for ECS URL shard ${descriptor.sequence}:\n- ${authorizationErrors.join("\n- ")}`
        );
      }
      jobs.push({
        id: `ecs-url-shard-${String(descriptor.sequence).padStart(8, "0")}`,
        adapter: "ecs-public-url-v1",
        sequence: descriptor.sequence,
        manifestFile: descriptor.file,
        manifestSha256: descriptor.sha256,
        urlCount: descriptor.urlCount,
        bytes: descriptor.bytes
      });
    }
    const plan = {
      schemaVersion: SHARD_JOB_PLAN_SCHEMA_VERSION,
      supplier: "ECS Tuning",
      kind: "ecs-catalog-shard-job-plan",
      createdAt: validationTime.toISOString(),
      source: {
        adapter: "ecs-public-url-v1",
        indexPath: portableRelative(workspace, indexAbsolutePath),
        indexSha256,
        manifestSetSha256: index.manifestSetSha256
      },
      authorization: {
        sha256: authorizationData.digest,
        validatedAt: validationTime.toISOString()
      },
      safety: {
        explicitManifestEntriesOnly: true,
        urlDiscovery: false,
        crawling: false,
        storefrontPublishing: false,
        publicDataPolicy: {
          dealerCost: "forbidden",
          wholesalePrice: "forbidden",
          credentials: "forbidden",
          taxAndVat: "forbidden"
        }
      },
      counts: {
        jobs: jobs.length,
        urls: jobs.reduce((total, job) => total + job.urlCount, 0)
      },
      jobs
    };
    const planContents = `${JSON.stringify(plan, null, 2)}\n`;
    const planSha256 = sha256(planContents);
    await writeFile(path.join(staging, "plan.json"), planContents, "utf8");
    await writeFile(path.join(staging, "plan.json.sha256"), `${planSha256}  plan.json\n`, "utf8");
    for (const job of jobs) {
      await writeFile(
        path.join(staging, "checkpoints", `${job.id}.json`),
        `${JSON.stringify({
          schemaVersion: SHARD_CHECKPOINT_SCHEMA_VERSION,
          kind: "ecs-catalog-shard-checkpoint",
          jobId: job.id,
          planSha256,
          manifestSha256: job.manifestSha256,
          status: "pending",
          attempts: 0,
          startedAt: null,
          completedAt: null,
          updatedAt: validationTime.toISOString(),
          error: null,
          result: null
        }, null, 2)}\n`,
        "utf8"
      );
    }
    await rename(staging, workspace);
    committed = true;
    return { workspace, plan, planSha256 };
  } finally {
    if (!committed) await rm(staging, { recursive: true, force: true });
  }
}

async function readVerifiedPlan(workspace) {
  const planPath = path.join(workspace, "plan.json");
  const contents = await readBoundedFile(planPath, MAX_INDEX_BYTES, "ECS shard job plan");
  const digest = sha256(contents);
  const sidecar = (await readBoundedFile(`${planPath}.sha256`, 1024, "ECS shard job plan checksum"))
    .toString("utf8")
    .trim();
  if (sidecar !== `${digest}  plan.json`) throw new Error("ECS shard job plan checksum does not match");
  const plan = JSON.parse(contents.toString("utf8"));
  if (
    plan.schemaVersion !== SHARD_JOB_PLAN_SCHEMA_VERSION ||
    plan.supplier !== "ECS Tuning" ||
    plan.kind !== "ecs-catalog-shard-job-plan" ||
    plan.safety?.explicitManifestEntriesOnly !== true ||
    plan.safety?.urlDiscovery !== false ||
    plan.safety?.crawling !== false ||
    plan.safety?.storefrontPublishing !== false ||
    plan.safety?.publicDataPolicy?.dealerCost !== "forbidden"
  ) {
    throw new Error("ECS shard job plan has an unsupported identity or unsafe policy");
  }
  if (!Array.isArray(plan.jobs) || plan.jobs.length === 0) throw new Error("ECS shard job plan has no jobs");
  return { plan, digest };
}

async function readCheckpoint(checkpointPath, job, planSha256) {
  const checkpoint = JSON.parse((await readBoundedFile(checkpointPath, 256 * 1024, "ECS shard checkpoint")).toString("utf8"));
  if (
    checkpoint.schemaVersion !== SHARD_CHECKPOINT_SCHEMA_VERSION ||
    checkpoint.kind !== "ecs-catalog-shard-checkpoint" ||
    checkpoint.jobId !== job.id ||
    checkpoint.planSha256 !== planSha256 ||
    checkpoint.manifestSha256 !== job.manifestSha256
  ) {
    throw new Error(`Checkpoint binding is invalid for ${job.id}`);
  }
  return checkpoint;
}

async function completedResultIsDurable(resultPath, job, planSha256) {
  try {
    const result = JSON.parse((await readBoundedFile(resultPath, 256 * 1024, "ECS shard result")).toString("utf8"));
    return result.success === true && result.jobId === job.id && result.planSha256 === planSha256 &&
      result.manifestSha256 === job.manifestSha256 && result.validation?.valid === true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function acquireLock(lockPath, { jobId, at, recoverStaleLockMs = null }) {
  async function create() {
    const handle = await open(lockPath, "wx");
    await handle.writeFile(`${JSON.stringify({ jobId, processId: process.pid, acquiredAt: at.toISOString() })}\n`, "utf8");
    await handle.close();
  }
  try {
    await create();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    if (recoverStaleLockMs === null) throw new Error(`Shard ${jobId} is already locked by another worker`);
    boundedInteger(recoverStaleLockMs, "recoverStaleLockMs", MIN_STALE_LOCK_AGE_MS, MAX_STALE_LOCK_AGE_MS);
    const lock = JSON.parse((await readBoundedFile(lockPath, 64 * 1024, "ECS shard lock")).toString("utf8"));
    const acquiredAt = Date.parse(lock.acquiredAt ?? "");
    if (!Number.isFinite(acquiredAt) || at.getTime() - acquiredAt < recoverStaleLockMs) {
      throw new Error(`Shard ${jobId} lock is not old enough for explicit stale-lock recovery`);
    }
    const stalePath = path.join(
      path.dirname(path.dirname(lockPath)),
      "stale-locks",
      `${jobId}-${new Date(acquiredAt).toISOString().replace(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}.json`
    );
    await rename(lockPath, stalePath);
    await create();
  }
}

export async function runShardJob({
  workspacePath,
  sequence,
  authorizationPath,
  fetchMode = false,
  rateLimitMs = 5_000,
  retries = 3,
  timeoutMs = 30_000,
  maxResponseBytes = 5 * 1024 * 1024,
  refresh = false,
  recoverStaleLockMs = null,
  at = new Date(),
  ingestionRunner = runIngestion,
  fetchImpl = globalThis.fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
}) {
  if (!fetchMode) {
    throw new Error("Shard execution is locked by default; pass --fetch only for a reviewed authorized run");
  }
  const runTime = at instanceof Date ? at : new Date(at);
  if (!Number.isFinite(runTime.getTime())) throw new Error("Shard run time is invalid");
  const workspace = await assertSafeExistingWorkspace(workspacePath);
  const [{ plan, digest: planSha256 }, authorizationData] = await Promise.all([
    readVerifiedPlan(workspace),
    readAuthorization(authorizationPath)
  ]);
  const shardSequence = boundedInteger(Number(sequence), "sequence", 1, plan.jobs.length);
  const job = plan.jobs.find((candidate) => candidate.sequence === shardSequence);
  if (!job || job.adapter !== "ecs-public-url-v1") throw new Error(`Shard ${shardSequence} is not supported`);
  if (authorizationData.digest !== plan.authorization?.sha256) {
    throw new Error("Authorization file changed after the shard plan was created; create a new reviewed plan");
  }
  const indexPath = path.resolve(workspace, plan.source.indexPath);
  const verifiedIndex = await readVerifiedIndex(indexPath);
  if (
    verifiedIndex.digest !== plan.source.indexSha256 ||
    verifiedIndex.index.manifestSetSha256 !== plan.source.manifestSetSha256
  ) {
    throw new Error("Source ECS URL manifest index changed after the shard plan was created");
  }
  const descriptor = verifiedIndex.index.manifests.find((candidate) => candidate.sequence === shardSequence);
  if (!descriptor || descriptor.sha256 !== job.manifestSha256 || descriptor.file !== job.manifestFile) {
    throw new Error(`Shard ${shardSequence} no longer matches the reviewed job plan`);
  }
  const { entries } = await readVerifiedShard(verifiedIndex.directory, descriptor);
  const authorizationErrors = validateAutomationAuthorization(authorizationData.authorization, entries, runTime);
  if (authorizationErrors.length) {
    throw new Error(`Automated access is not authorized for shard ${shardSequence}:\n- ${authorizationErrors.join("\n- ")}`);
  }

  const checkpointPath = path.join(workspace, "checkpoints", `${job.id}.json`);
  const resultDirectory = path.join(workspace, "results", job.id);
  const resultPath = path.join(resultDirectory, "job-result.json");
  let checkpoint = await readCheckpoint(checkpointPath, job, planSha256);
  if (checkpoint.status === "completed" && await completedResultIsDurable(resultPath, job, planSha256)) {
    return { skipped: true, job, checkpoint };
  }

  const lockPath = path.join(workspace, "locks", `${job.id}.lock`);
  await acquireLock(lockPath, { jobId: job.id, at: runTime, recoverStaleLockMs });
  try {
    checkpoint = await readCheckpoint(checkpointPath, job, planSha256);
    if (checkpoint.status === "completed" && await completedResultIsDurable(resultPath, job, planSha256)) {
      return { skipped: true, job, checkpoint };
    }
    checkpoint = {
      ...checkpoint,
      status: "running",
      attempts: Number(checkpoint.attempts ?? 0) + 1,
      startedAt: runTime.toISOString(),
      completedAt: null,
      updatedAt: runTime.toISOString(),
      error: null
    };
    await writeJsonAtomic(checkpointPath, checkpoint);
    await mkdir(resultDirectory, { recursive: true });
    try {
      const ingestion = await ingestionRunner({
        entries,
        outputDir: resultDirectory,
        fetchMode: true,
        authorization: authorizationData.authorization,
        rateLimitMs,
        retries,
        timeoutMs,
        maxResponseBytes,
        refresh,
        fetchImpl,
        sleep,
        now: () => new Date()
      });
      const success = ingestion.summary.failed === 0 && ingestion.validation.valid === true;
      const result = {
        schemaVersion: 1,
        kind: "ecs-catalog-shard-result",
        jobId: job.id,
        planSha256,
        manifestSha256: job.manifestSha256,
        success,
        completedAt: new Date().toISOString(),
        summary: ingestion.summary,
        validation: {
          valid: ingestion.validation.valid,
          productCount: ingestion.validation.productCount,
          invalidProductCount: ingestion.validation.invalidProductCount
        },
        storefrontPublished: false
      };
      await writeJsonAtomic(resultPath, result);
      checkpoint = {
        ...checkpoint,
        status: success ? "completed" : "failed",
        completedAt: result.completedAt,
        updatedAt: result.completedAt,
        error: success ? null : "Shard ingestion completed with failed entries or invalid records",
        result: portableRelative(workspace, resultPath)
      };
      await writeJsonAtomic(checkpointPath, checkpoint);
      if (!success) throw new Error(checkpoint.error);
      return { skipped: false, job, checkpoint, result };
    } catch (error) {
      if (checkpoint.status !== "failed") {
        checkpoint = {
          ...checkpoint,
          status: "failed",
          completedAt: null,
          updatedAt: new Date().toISOString(),
          error: String(error?.message ?? error).slice(0, 2000)
        };
        await writeJsonAtomic(checkpointPath, checkpoint);
      }
      throw error;
    }
  } finally {
    await rm(lockPath, { force: true });
  }
}

export async function shardJobStatus(workspacePath) {
  const workspace = await assertSafeExistingWorkspace(workspacePath);
  const { plan, digest } = await readVerifiedPlan(workspace);
  const counts = { pending: 0, running: 0, completed: 0, failed: 0 };
  for (const job of plan.jobs) {
    const checkpoint = await readCheckpoint(
      path.join(workspace, "checkpoints", `${job.id}.json`),
      job,
      digest
    );
    if (!(checkpoint.status in counts)) throw new Error(`Unknown checkpoint status for ${job.id}`);
    counts[checkpoint.status] += 1;
  }
  return { jobs: plan.jobs.length, urls: plan.counts.urls, counts };
}

function usage() {
  return `
Usage:
  node scripts/ecs-catalog/shard-jobs.mjs plan --index <index.json> --workspace <new-directory> --authorization-file <file>
  node scripts/ecs-catalog/shard-jobs.mjs run --workspace <directory> --shard <sequence> --authorization-file <file> --fetch [options]
  node scripts/ecs-catalog/shard-jobs.mjs status --workspace <directory>

This runner processes exactly one generated, checksum-bound manifest. It never discovers URLs or publishes storefront data.
Network access is disabled unless --fetch is explicitly supplied with the same valid authorization used to create the plan.

Run options:
  --rate-ms <milliseconds>
  --retries <count>
  --timeout-ms <milliseconds>
  --max-response-bytes <bytes>
  --refresh
  --recover-stale-lock-ms <milliseconds>  Explicit recovery; minimum ${MIN_STALE_LOCK_AGE_MS}
`;
}

function parseCli(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--fetch" || argument === "--refresh" || argument === "--help") {
      options[argument.slice(2)] = true;
      continue;
    }
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    options[argument.slice(2)] = value;
    index += 1;
  }
  return { command, options };
}

async function main() {
  const { command, options } = parseCli(process.argv.slice(2));
  if (options.help || !command) {
    process.stdout.write(usage());
    return;
  }
  if (command === "plan") {
    if (!options.index || !options.workspace || !options["authorization-file"]) {
      throw new Error(`plan requires --index, --workspace and --authorization-file\n${usage()}`);
    }
    const result = await createShardJobPlan({
      indexPath: options.index,
      workspacePath: options.workspace,
      authorizationPath: options["authorization-file"]
    });
    process.stdout.write(`${JSON.stringify({ workspace: result.workspace, planSha256: result.planSha256, counts: result.plan.counts }, null, 2)}\n`);
    return;
  }
  if (command === "run") {
    if (!options.workspace || !options.shard || !options["authorization-file"]) {
      throw new Error(`run requires --workspace, --shard and --authorization-file\n${usage()}`);
    }
    const result = await runShardJob({
      workspacePath: options.workspace,
      sequence: Number(options.shard),
      authorizationPath: options["authorization-file"],
      fetchMode: Boolean(options.fetch),
      rateLimitMs: Number(options["rate-ms"] ?? 5_000),
      retries: Number(options.retries ?? 3),
      timeoutMs: Number(options["timeout-ms"] ?? 30_000),
      maxResponseBytes: Number(options["max-response-bytes"] ?? 5 * 1024 * 1024),
      refresh: Boolean(options.refresh),
      recoverStaleLockMs: options["recover-stale-lock-ms"] === undefined
        ? null
        : Number(options["recover-stale-lock-ms"])
    });
    process.stdout.write(`${JSON.stringify({ shard: result.job.sequence, skipped: result.skipped, status: result.checkpoint.status }, null, 2)}\n`);
    return;
  }
  if (command === "status") {
    if (!options.workspace) throw new Error(`status requires --workspace\n${usage()}`);
    process.stdout.write(`${JSON.stringify(await shardJobStatus(options.workspace), null, 2)}\n`);
    return;
  }
  throw new Error(`Unknown command: ${command}\n${usage()}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
