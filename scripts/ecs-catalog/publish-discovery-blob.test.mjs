import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ECS_DISCOVERY_CURRENT_PATH,
  ECS_DISCOVERY_RELEASE_PREFIX,
  loadLocalEcsDiscovery,
  parseArguments,
  publishEcsDiscoveryToVercelBlob,
  signEcsDiscoveryManifest,
  verifyEcsDiscoveryManifestSignature
} from "./publish-discovery-blob.mjs";

const TOKEN = "vercel_blob_rw_unit_test_token_123456789";
const SECRET = "ecs-discovery-unit-test-secret-".repeat(2);
const NOW = Date.parse("2026-08-05T22:00:00.000Z");
const HOST = "ecs-unit-test.public.blob.vercel-storage.com";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
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

async function makeFixture({ badShardChecksum = false, badUrl = false, extraShardKey = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "projx-ecs-discovery-publisher-"));
  const directory = path.join(root, "url-manifests");
  await mkdir(directory);
  const urlGroups = [
    [
      "https://www.ecstuning.com/b-alpha-parts/group/first-product/",
      "https://www.ecstuning.com/b-alpha-parts/group/second-product/"
    ],
    [badUrl
      ? "https://example.com/private-product/"
      : "https://www.ecstuning.com/b-beta-parts/group/third-product/"]
  ];
  const manifests = [];
  for (let position = 0; position < urlGroups.length; position += 1) {
    const sequence = position + 1;
    const file = `ecs-product-urls-${String(sequence).padStart(8, "0")}.json`;
    const document = {
      schemaVersion: 1,
      supplier: "ECS Tuning",
      kind: "ecs-product-url-manifest",
      sequence,
      urlCount: urlGroups[position].length,
      entries: urlGroups[position],
      ...(extraShardKey ? { dealerPrice: "NEVER" } : {})
    };
    const body = Buffer.from(`${JSON.stringify(document)}\n`);
    await writeFile(path.join(directory, file), body);
    manifests.push({
      sequence,
      file,
      urlCount: urlGroups[position].length,
      bytes: body.length,
      sha256: digest(body)
    });
  }
  if (badShardChecksum) manifests[0].sha256 = "0".repeat(64);
  const uniqueUrls = urlGroups.flat().length;
  const index = {
    schemaVersion: 1,
    supplier: "ECS Tuning",
    kind: "ecs-product-url-manifest-index",
    generatedAt: "2026-08-05T21:23:05.813Z",
    offlineOnly: true,
    source: { fileName: "product-urls.txt", bytes: 999, sha256: "a".repeat(64) },
    counts: {
      inputLines: uniqueUrls,
      ignoredLines: 0,
      candidateLines: uniqueUrls,
      acceptedEntries: uniqueUrls,
      canonicalizedEntries: 0,
      invalidLines: 0,
      uniqueUrls,
      duplicateUrls: 0,
      manifests: manifests.length
    },
    limits: { maxUrlsPerManifest: 10_000, maxManifestBytes: 2_097_152, deduplicationBuckets: 64 },
    ordering: "sha256-bucket-then-canonical-url",
    manifestSetSha256: manifestSetDigest(manifests),
    manifests
  };
  const indexBuffer = Buffer.from(`${JSON.stringify(index, null, 2)}\n`);
  const indexPath = path.join(directory, "index.json");
  await writeFile(indexPath, indexBuffer);
  await writeFile(`${indexPath}.sha256`, `${digest(indexBuffer)}  index.json\n`);
  return { root, directory, indexPath, index, indexBuffer };
}

function stream(value) {
  return new Response(value).body;
}

function sdkMock({ corruptReadPath = null, initial = new Map(), currentReadError = null } = {}) {
  const objects = new Map(initial);
  const calls = [];
  let counter = 0;
  return {
    calls,
    objects,
    async put(pathname, body, options) {
      const buffer = Buffer.from(body);
      calls.push(["put", pathname, buffer, options]);
      if (objects.has(pathname) && options.allowOverwrite === false) {
        const error = new Error("exists");
        error.name = "BlobAlreadyExistsError";
        throw error;
      }
      if (objects.has(pathname) && options.ifMatch && objects.get(pathname).etag !== options.ifMatch) {
        const error = new Error("changed");
        error.name = "BlobPreconditionFailedError";
        throw error;
      }
      counter += 1;
      const item = { body: buffer, etag: `etag-${counter}` };
      objects.set(pathname, item);
      return { pathname, url: `https://${HOST}/${pathname}` };
    },
    async get(pathname) {
      calls.push(["get", pathname]);
      if (pathname === ECS_DISCOVERY_CURRENT_PATH && currentReadError) throw currentReadError;
      const item = objects.get(pathname);
      if (!item) return null;
      const body = pathname === corruptReadPath ? Buffer.from("{}") : item.body;
      return {
        statusCode: 200,
        stream: stream(body),
        blob: {
          pathname,
          url: `https://${HOST}/${pathname}`,
          etag: item.etag,
          size: body.length,
          contentType: "application/json"
        }
      };
    },
    async del(url, options) {
      calls.push(["del", url, options]);
      const pathname = new URL(url).pathname.replace(/^\//, "");
      const item = objects.get(pathname);
      if (item && (!options?.ifMatch || item.etag === options.ifMatch)) objects.delete(pathname);
    }
  };
}

async function rejectsCode(action, code) {
  await assert.rejects(action, error => error?.code === code);
}

test("dry run validates every local shard without credentials or SDK activity", async (t) => {
  const fixture = await makeFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const sdk = new Proxy({}, { get() { throw new Error("SDK touched"); } });
  const result = await publishEcsDiscoveryToVercelBlob({
    indexPath: fixture.indexPath,
    dryRun: true,
    token: "",
    manifestSecret: "",
    blobSdk: sdk,
    now: NOW
  });
  assert.equal(result.status, "dry_run_passed");
  assert.equal(result.uniqueUrls, 3);
  assert.equal(result.shards, 2);
  assert.equal(result.uploadObjects, 3);
  assert.match(result.releaseId, /^20260805T212305813Z-[a-f0-9]{16}$/);
});

test("checksum, URL-only schema and public-host violations fail closed", async (t) => {
  const checksum = await makeFixture({ badShardChecksum: true });
  const privateKey = await makeFixture({ extraShardKey: true });
  const foreignUrl = await makeFixture({ badUrl: true });
  t.after(() => Promise.all([checksum, privateKey, foreignUrl].map(value => rm(value.root, { recursive: true, force: true }))));
  await rejectsCode(() => loadLocalEcsDiscovery(checksum.indexPath), "shard_checksum_mismatch");
  await rejectsCode(() => loadLocalEcsDiscovery(privateKey.indexPath), "invalid_shard");
  await rejectsCode(() => loadLocalEcsDiscovery(foreignUrl.indexPath), "invalid_shard");
});

test("default mode is dry-run; real publication requires both server-only credentials", async (t) => {
  const fixture = await makeFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  let touched = false;
  const sdk = new Proxy({}, { get() { touched = true; return undefined; } });
  const defaultResult = await publishEcsDiscoveryToVercelBlob({
    indexPath: fixture.indexPath, token: TOKEN, manifestSecret: SECRET, blobSdk: sdk, now: NOW
  });
  assert.equal(defaultResult.status, "dry_run_passed");
  await rejectsCode(() => publishEcsDiscoveryToVercelBlob({
    indexPath: fixture.indexPath, dryRun: false, previewConfirmed: false,
    token: TOKEN, manifestSecret: SECRET, blobSdk: sdk, now: NOW
  }), "preview_confirmation_required");
  await rejectsCode(() => publishEcsDiscoveryToVercelBlob({
    indexPath: fixture.indexPath, previewConfirmed: true, token: "", manifestSecret: SECRET, blobSdk: sdk, now: NOW
  }), "blob_token_required");
  await rejectsCode(() => publishEcsDiscoveryToVercelBlob({
    indexPath: fixture.indexPath, previewConfirmed: true, token: TOKEN, manifestSecret: "", blobSdk: sdk, now: NOW
  }), "manifest_secret_required");
  await rejectsCode(() => publishEcsDiscoveryToVercelBlob({
    indexPath: fixture.indexPath, previewConfirmed: true, token: TOKEN, manifestSecret: SECRET, blobSdk: sdk, now: Number.NaN
  }), "invalid_clock");
  assert.equal(touched, false);
});

test("publishes immutable shards and index, verifies each, then signs and verifies current last", async (t) => {
  const fixture = await makeFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const sdk = sdkMock();
  const result = await publishEcsDiscoveryToVercelBlob({
    indexPath: fixture.indexPath,
    previewConfirmed: true,
    token: TOKEN,
    manifestSecret: SECRET,
    blobSdk: sdk,
    now: NOW
  });
  assert.equal(result.status, "published");
  assert.equal(result.environment, "preview");
  assert.equal(verifyEcsDiscoveryManifestSignature(result.currentManifest, SECRET), true);
  const releasePrefix = `${ECS_DISCOVERY_RELEASE_PREFIX}${result.releaseId}/`;
  const puts = sdk.calls.filter(call => call[0] === "put");
  assert.deepEqual(puts.map(call => call[1]), [
    `${releasePrefix}ecs-product-urls-00000001.json`,
    `${releasePrefix}ecs-product-urls-00000002.json`,
    `${releasePrefix}index.json`,
    ECS_DISCOVERY_CURRENT_PATH
  ]);
  assert.ok(puts.slice(0, 3).every(call => call[3].allowOverwrite === false && call[3].addRandomSuffix === false));
  const callsBeforeCurrent = sdk.calls.slice(0, sdk.calls.findIndex(call => call[0] === "put" && call[1] === ECS_DISCOVERY_CURRENT_PATH));
  assert.equal(callsBeforeCurrent.filter(call => call[0] === "get" && call[1].startsWith(releasePrefix)).length, 3);
  assert.equal(sdk.calls.at(-1)[0], "get");
  assert.equal(sdk.calls.at(-1)[1], ECS_DISCOVERY_CURRENT_PATH);
  assert.equal(result.currentManifest.counts.urlCount, 3);
  assert.equal(result.currentManifest.counts.shardCount, 2);
  assert.equal(result.currentManifest.shards.length, 2);
  assert.equal(result.currentManifest.shards[0].sha256, fixture.index.manifests[0].sha256);
  assert.match(result.currentManifest.signature, /^[a-f0-9]{64}$/);
});

test("a read-back checksum mismatch aborts without publishing current", async (t) => {
  const fixture = await makeFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const local = await loadLocalEcsDiscovery(fixture.indexPath);
  const corruptPath = `${ECS_DISCOVERY_RELEASE_PREFIX}${local.releaseId}/ecs-product-urls-00000002.json`;
  const sdk = sdkMock({ corruptReadPath: corruptPath });
  await rejectsCode(() => publishEcsDiscoveryToVercelBlob({
    indexPath: fixture.indexPath,
    previewConfirmed: true,
    token: TOKEN,
    manifestSecret: SECRET,
    blobSdk: sdk,
    now: NOW
  }), "remote_verify_failed");
  assert.equal(sdk.calls.some(call => call[0] === "put" && call[1] === ECS_DISCOVERY_CURRENT_PATH), false);
});

test("immutable conflicts resume safely and the same signed release is idempotent", async (t) => {
  const fixture = await makeFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const sdk = sdkMock();
  const first = await publishEcsDiscoveryToVercelBlob({
    indexPath: fixture.indexPath, previewConfirmed: true, token: TOKEN,
    manifestSecret: SECRET, blobSdk: sdk, now: NOW
  });
  const putCount = sdk.calls.filter(call => call[0] === "put").length;
  const second = await publishEcsDiscoveryToVercelBlob({
    indexPath: fixture.indexPath, previewConfirmed: true, token: TOKEN,
    manifestSecret: SECRET, blobSdk: sdk, now: NOW + 1_000
  });
  assert.equal(second.status, "no_change");
  assert.equal(sdk.calls.filter(call => call[0] === "put").length, putCount);
  assert.equal(first.indexSha256, second.indexSha256);
});

test("invalid remote signatures fail before any immutable upload", async (t) => {
  const fixture = await makeFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const local = await loadLocalEcsDiscovery(fixture.indexPath);
  const unsigned = {
    version: 1,
    vendor: "ECS Tuning",
    kind: "ecs-url-discovery-current",
    releaseId: local.releaseId,
    publishedAt: "2026-08-05T21:30:00.000Z",
    expiresAt: "2026-08-12T21:30:00.000Z",
    counts: { urlCount: 3, shardCount: 2 },
    shards: local.shards.map(shard => ({
      sequence: shard.sequence,
      url: `https://${HOST}/${ECS_DISCOVERY_RELEASE_PREFIX}${local.releaseId}/${shard.file}`,
      urlCount: shard.urlCount,
      bytes: shard.bytes,
      sha256: shard.sha256
    }))
  };
  const current = { ...unsigned, signature: signEcsDiscoveryManifest(unsigned, "different-secret-different-secret-123") };
  const sdk = sdkMock({
    initial: new Map([[ECS_DISCOVERY_CURRENT_PATH, { body: Buffer.from(JSON.stringify(current)), etag: "old-etag" }]])
  });
  await rejectsCode(() => publishEcsDiscoveryToVercelBlob({
    indexPath: fixture.indexPath, previewConfirmed: true, token: TOKEN,
    manifestSecret: SECRET, blobSdk: sdk, now: NOW
  }), "invalid_remote_manifest");
  assert.equal(sdk.calls.some(call => call[0] === "put"), false);
});

test("argument parser exposes only index, dry-run, preview and help", () => {
  assert.deepEqual({ ...parseArguments(["--index", "private/index.json", "--dry-run"]) }, {
    index: "private/index.json", "dry-run": true
  });
  assert.throws(() => parseArguments(["--production"]), error => error?.code === "invalid_arguments");
});
