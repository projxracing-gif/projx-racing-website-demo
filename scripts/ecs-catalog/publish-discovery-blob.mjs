#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  ECS_DISCOVERY_CURRENT_PATH,
  canonicalEcsDiscoveryManifestPayload,
  signEcsDiscoveryManifest,
  verifyEcsDiscoveryManifestSignature
} from "../../server/ecs-discovery-catalog.js";
import { canonicalizeProductUrl } from "./lib.mjs";

export const ECS_DISCOVERY_RELEASE_PREFIX = "projx-racing/ecs-discovery/releases/";
export {
  ECS_DISCOVERY_CURRENT_PATH,
  canonicalEcsDiscoveryManifestPayload,
  signEcsDiscoveryManifest,
  verifyEcsDiscoveryManifestSignature
};

const INDEX_MAX_BYTES = 256 * 1024;
const SHARD_MAX_BYTES = 2 * 1024 * 1024;
const CURRENT_MAX_BYTES = 256 * 1024;
const MAX_SHARDS = 500;
const MAX_URLS = 5_000_000;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const DISCOVERY_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
const SHA256 = /^[a-f0-9]{64}$/;
const FILE_NAME = /^ecs-product-urls-(\d{8})\.json$/;
const RELEASE_ID = /^\d{8}T\d{9}Z-[a-f0-9]{16}$/;
const PUBLIC_BLOB_HOST = /\.public\.blob\.vercel-storage\.com$/;
const READ_BACK_RETRY_DELAYS_MS = Object.freeze([200, 500, 1_000, 2_000, 4_000, 8_000, 16_000]);

const INDEX_KEYS = [
  "schemaVersion", "supplier", "kind", "generatedAt", "offlineOnly", "source",
  "counts", "limits", "ordering", "manifestSetSha256", "manifests"
];
const SHARD_KEYS = ["schemaVersion", "supplier", "kind", "sequence", "urlCount", "entries"];
const CURRENT_KEYS = [
  "version", "vendor", "kind", "releaseId", "publishedAt", "expiresAt", "counts", "shards", "signature"
];

export class EcsDiscoveryPublisherError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EcsDiscoveryPublisherError";
    this.code = code;
  }
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!plainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalTimestamp(value) {
  if (typeof value !== "string" || value.length > 40) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value ? timestamp : null;
}

function releaseId(generatedAt, indexSha256) {
  const timestamp = canonicalTimestamp(generatedAt);
  if (timestamp === null || !SHA256.test(indexSha256)) {
    throw new EcsDiscoveryPublisherError("invalid_index", "The discovery index has an invalid release identity.");
  }
  const compact = new Date(timestamp).toISOString().replace(/[-:.]/g, "");
  return `${compact}-${indexSha256.slice(0, 16)}`;
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

function parseObject(buffer, code, label) {
  try {
    const value = JSON.parse(buffer.toString("utf8").replace(/^\uFEFF/, ""));
    if (!plainObject(value)) throw new Error("not_object");
    return value;
  } catch {
    throw new EcsDiscoveryPublisherError(code, `${label} is not valid JSON.`);
  }
}

async function readRegularFile(filePath, maximumBytes, label) {
  let metadata;
  try {
    metadata = await lstat(filePath);
  } catch {
    throw new EcsDiscoveryPublisherError("local_file_missing", `${label} is missing.`);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 2 || metadata.size > maximumBytes) {
    throw new EcsDiscoveryPublisherError("invalid_local_file", `${label} is not a bounded regular file.`);
  }
  const buffer = await readFile(filePath);
  if (buffer.length !== metadata.size) {
    throw new EcsDiscoveryPublisherError("local_file_changed", `${label} changed while it was being read.`);
  }
  return buffer;
}

function validateIndex(index) {
  if (!exactKeys(index, INDEX_KEYS)
    || index.schemaVersion !== 1
    || index.supplier !== "ECS Tuning"
    || index.kind !== "ecs-product-url-manifest-index"
    || index.offlineOnly !== true
    || canonicalTimestamp(index.generatedAt) === null
    || !exactKeys(index.source, ["fileName", "bytes", "sha256"])
    || typeof index.source.fileName !== "string"
    || !/^[A-Za-z0-9._-]{1,128}$/.test(index.source.fileName)
    || !Number.isSafeInteger(index.source.bytes) || index.source.bytes < 1
    || !SHA256.test(String(index.source.sha256 || ""))
    || !exactKeys(index.counts, [
      "inputLines", "ignoredLines", "candidateLines", "acceptedEntries", "canonicalizedEntries",
      "invalidLines", "uniqueUrls", "duplicateUrls", "manifests"
    ])
    || !["inputLines", "ignoredLines", "candidateLines", "acceptedEntries", "canonicalizedEntries", "invalidLines", "uniqueUrls", "duplicateUrls", "manifests"]
      .every(key => Number.isSafeInteger(index.counts[key]) && index.counts[key] >= 0)
    || !Number.isSafeInteger(index.counts.uniqueUrls) || index.counts.uniqueUrls < 1 || index.counts.uniqueUrls > MAX_URLS
    || !Number.isSafeInteger(index.counts.manifests) || index.counts.manifests < 1 || index.counts.manifests > MAX_SHARDS
    || index.counts.invalidLines !== 0
    || index.counts.inputLines !== index.counts.ignoredLines + index.counts.candidateLines
    || index.counts.candidateLines !== index.counts.acceptedEntries + index.counts.invalidLines
    || index.counts.acceptedEntries !== index.counts.uniqueUrls + index.counts.duplicateUrls
    || !exactKeys(index.limits, ["maxUrlsPerManifest", "maxManifestBytes", "deduplicationBuckets"])
    || !Number.isSafeInteger(index.limits.maxUrlsPerManifest) || index.limits.maxUrlsPerManifest < 1
    || !Number.isSafeInteger(index.limits.maxManifestBytes) || index.limits.maxManifestBytes < 8 * 1024
    || !Number.isSafeInteger(index.limits.deduplicationBuckets) || index.limits.deduplicationBuckets < 4
    || index.limits.maxManifestBytes > SHARD_MAX_BYTES
    || index.ordering !== "sha256-bucket-then-canonical-url"
    || !SHA256.test(String(index.manifestSetSha256 || ""))
    || !Array.isArray(index.manifests)
    || index.manifests.length !== index.counts.manifests) {
    throw new EcsDiscoveryPublisherError("invalid_index", "The discovery index failed its bounded URL-manifest policy.");
  }
  let urls = 0;
  let bytes = 0;
  const files = new Set();
  for (let position = 0; position < index.manifests.length; position += 1) {
    const entry = index.manifests[position];
    const match = typeof entry?.file === "string" ? entry.file.match(FILE_NAME) : null;
    if (!exactKeys(entry, ["sequence", "file", "urlCount", "bytes", "sha256"])
      || entry.sequence !== position + 1
      || !match || Number(match[1]) !== entry.sequence || files.has(entry.file)
      || !Number.isSafeInteger(entry.urlCount) || entry.urlCount < 1
      || entry.urlCount > index.limits.maxUrlsPerManifest
      || !Number.isSafeInteger(entry.bytes) || entry.bytes < 2 || entry.bytes > SHARD_MAX_BYTES
      || entry.bytes > index.limits.maxManifestBytes
      || !SHA256.test(String(entry.sha256 || ""))) {
      throw new EcsDiscoveryPublisherError("invalid_index", "The discovery index contains an invalid shard entry.");
    }
    files.add(entry.file);
    urls += entry.urlCount;
    bytes += entry.bytes;
  }
  if (urls !== index.counts.uniqueUrls || bytes > MAX_TOTAL_BYTES
    || manifestSetDigest(index.manifests) !== index.manifestSetSha256) {
    throw new EcsDiscoveryPublisherError("invalid_index", "The discovery index aggregates or manifest-set checksum do not match.");
  }
  return { urls, bytes };
}

function validateShard(document, entry) {
  if (!exactKeys(document, SHARD_KEYS)
    || document.schemaVersion !== 1
    || document.supplier !== "ECS Tuning"
    || document.kind !== "ecs-product-url-manifest"
    || document.sequence !== entry.sequence
    || document.urlCount !== entry.urlCount
    || !Array.isArray(document.entries)
    || document.entries.length !== entry.urlCount) {
    throw new EcsDiscoveryPublisherError("invalid_shard", `Discovery shard ${entry.sequence} failed schema validation.`);
  }
  let previous = null;
  for (const value of document.entries) {
    if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 4_096) {
      throw new EcsDiscoveryPublisherError("invalid_shard", `Discovery shard ${entry.sequence} contains an invalid URL record.`);
    }
    let canonical;
    try {
      canonical = canonicalizeProductUrl(value);
    } catch {
      throw new EcsDiscoveryPublisherError("invalid_shard", `Discovery shard ${entry.sequence} contains a non-public ECS URL.`);
    }
    if (canonical !== value || value === previous) {
      throw new EcsDiscoveryPublisherError("invalid_shard", `Discovery shard ${entry.sequence} contains a non-canonical or duplicate URL.`);
    }
    previous = value;
  }
}

export async function loadLocalEcsDiscovery(indexPath) {
  const resolvedIndex = path.resolve(indexPath || "");
  let directoryMetadata;
  try {
    directoryMetadata = await lstat(path.dirname(resolvedIndex));
  } catch {
    throw new EcsDiscoveryPublisherError("local_file_missing", "The discovery manifest directory is missing.");
  }
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink() || path.basename(resolvedIndex) !== "index.json") {
    throw new EcsDiscoveryPublisherError("invalid_index_path", "Select a real URL-manifest index.json directory.");
  }
  const indexBuffer = await readRegularFile(resolvedIndex, INDEX_MAX_BYTES, "Discovery index");
  const indexSha256 = sha256(indexBuffer);
  const checksumBuffer = await readRegularFile(`${resolvedIndex}.sha256`, 256, "Discovery index checksum");
  if (checksumBuffer.toString("utf8") !== `${indexSha256}  index.json\n`) {
    throw new EcsDiscoveryPublisherError("index_checksum_mismatch", "The discovery index checksum does not match.");
  }
  const index = parseObject(indexBuffer, "invalid_index", "Discovery index");
  const summary = validateIndex(index);
  const shards = [];
  for (const entry of index.manifests) {
    const filePath = path.join(path.dirname(resolvedIndex), entry.file);
    const shardBuffer = await readRegularFile(filePath, SHARD_MAX_BYTES, `Discovery shard ${entry.sequence}`);
    if (shardBuffer.length !== entry.bytes || sha256(shardBuffer) !== entry.sha256) {
      throw new EcsDiscoveryPublisherError("shard_checksum_mismatch", `Discovery shard ${entry.sequence} failed checksum validation.`);
    }
    validateShard(parseObject(shardBuffer, "invalid_shard", `Discovery shard ${entry.sequence}`), entry);
    shards.push(Object.freeze({ ...entry, buffer: shardBuffer }));
  }
  const id = releaseId(index.generatedAt, indexSha256);
  if (!RELEASE_ID.test(id)) throw new EcsDiscoveryPublisherError("invalid_index", "The release ID is unsafe.");
  return Object.freeze({
    releaseId: id,
    generatedAt: index.generatedAt,
    index,
    indexBuffer,
    indexBytes: indexBuffer.length,
    indexSha256,
    shards: Object.freeze(shards),
    totalShardBytes: summary.bytes,
    totalUploadBytes: summary.bytes + indexBuffer.length
  });
}

function validSecret(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  const bytes = Buffer.byteLength(value, "utf8");
  return bytes >= 32 && bytes <= 1_024;
}

function validToken(value) {
  return typeof value === "string" && value.length >= 20 && value.length <= 4_096 && value === value.trim();
}

function publicBlobUrl(value, expectedHostname = null) {
  try {
    const url = new URL(String(value));
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash
      || !PUBLIC_BLOB_HOST.test(hostname) || (expectedHostname && hostname !== expectedHostname)) return null;
    return url;
  } catch {
    return null;
  }
}

function validBlobMetadata(blob, pathname, expectedHostname = null, requireEtag = true) {
  const url = publicBlobUrl(blob?.url, expectedHostname);
  const etag = typeof blob?.etag === "string" && blob.etag ? blob.etag : null;
  return url && blob.pathname === pathname && (!requireEtag || etag)
    ? Object.freeze({ url: url.toString(), pathname, etag }) : null;
}

async function readBoundedStream(stream, maximumBytes) {
  if (!stream) throw new EcsDiscoveryPublisherError("remote_verify_failed", "A remote Blob has no readable content.");
  const chunks = [];
  let bytes = 0;
  if (typeof stream.getReader === "function") {
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      bytes += chunk.length;
      if (bytes > maximumBytes) {
        await reader.cancel().catch(() => {});
        throw new EcsDiscoveryPublisherError("remote_verify_failed", "A remote Blob exceeds its bounded size.");
      }
      chunks.push(chunk);
    }
  } else if (stream[Symbol.asyncIterator]) {
    for await (const value of stream) {
      const chunk = Buffer.from(value);
      bytes += chunk.length;
      if (bytes > maximumBytes) throw new EcsDiscoveryPublisherError("remote_verify_failed", "A remote Blob exceeds its bounded size.");
      chunks.push(chunk);
    }
  } else {
    throw new EcsDiscoveryPublisherError("remote_verify_failed", "A remote Blob stream is unsupported.");
  }
  return Buffer.concat(chunks, bytes);
}

async function getAndVerify(sdk, token, pathname, expectedBuffer, maximumBytes, expectedHostname = null) {
  let result;
  for (let attempt = 0; attempt <= READ_BACK_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      result = await sdk.get(pathname, { access: "public", token, headers: { "Cache-Control": "no-cache" } });
    } catch {
      throw new EcsDiscoveryPublisherError("remote_verify_failed", "An uploaded discovery Blob could not be read back.");
    }
    if (result != null || attempt === READ_BACK_RETRY_DELAYS_MS.length) break;
    await new Promise(resolve => setTimeout(resolve, READ_BACK_RETRY_DELAYS_MS[attempt]));
  }
  const metadata = validBlobMetadata(result?.blob, pathname, expectedHostname);
  const reportedSize = result?.blob?.size;
  const contentEncoded = Boolean(result?.headers?.get?.('content-encoding'));
  if (!metadata || result.statusCode !== 200 || !result.stream
    || (!contentEncoded && Number.isSafeInteger(reportedSize) && reportedSize > 0
      && reportedSize !== expectedBuffer.length)) {
    const diagnostic = [
      `object=${pathname.split("/").pop()}`,
      `metadata=${metadata ? "valid" : "invalid"}`,
      `status=${Number.isSafeInteger(result?.statusCode) ? result.statusCode : "missing"}`,
      `stream=${result?.stream ? "present" : "missing"}`,
      `encoding=${contentEncoded ? "present" : "none"}`,
      `reportedSize=${Number.isSafeInteger(reportedSize) ? reportedSize : "missing"}`,
      `expectedSize=${expectedBuffer.length}`
    ].join(", ");
    throw new EcsDiscoveryPublisherError(
      "remote_verify_failed",
      `An uploaded discovery Blob has invalid metadata (${diagnostic}).`
    );
  }
  const remoteBuffer = await readBoundedStream(result.stream, maximumBytes);
  if (remoteBuffer.length !== expectedBuffer.length
    || sha256(remoteBuffer) !== sha256(expectedBuffer)) {
    throw new EcsDiscoveryPublisherError("remote_verify_failed", "An uploaded discovery Blob failed read-back checksum verification.");
  }
  return metadata;
}

function preconditionFailure(error) {
  return ["BlobPreconditionFailedError", "BlobAlreadyExistsError"].includes(error?.name)
    || ["BLOB_PRECONDITION_FAILED", "BLOB_ALREADY_EXISTS"].includes(error?.code)
    || [409, 412].includes(error?.status) || [409, 412].includes(error?.statusCode);
}

async function uploadImmutableAndVerify(sdk, token, pathname, buffer, maximumBytes, expectedHostname = null) {
  let created = false;
  let uploadedMetadata = null;
  try {
    const uploaded = await sdk.put(pathname, buffer, {
      access: "public",
      token,
      contentType: "application/json",
      cacheControlMaxAge: 31_536_000,
      addRandomSuffix: false,
      allowOverwrite: false,
      multipart: buffer.length >= 5 * 1024 * 1024
    });
    uploadedMetadata = validBlobMetadata(uploaded, pathname, expectedHostname, false);
    if (!uploadedMetadata) {
      throw new EcsDiscoveryPublisherError("upload_failed", "An immutable discovery Blob returned invalid metadata.");
    }
    created = true;
  } catch (error) {
    if (error instanceof EcsDiscoveryPublisherError) throw error;
    if (!preconditionFailure(error)) {
      throw new EcsDiscoveryPublisherError("upload_failed", "An immutable discovery Blob could not be uploaded.");
    }
  }
  try {
    const metadata = await getAndVerify(sdk, token, pathname, buffer, maximumBytes, expectedHostname);
    return Object.freeze({ metadata, created, etag: uploadedMetadata?.etag || metadata.etag });
  } catch (error) {
    if (created && uploadedMetadata?.etag) {
      await sdk.del(uploadedMetadata.url, { token, ifMatch: uploadedMetadata.etag }).catch(() => {});
    }
    throw error;
  }
}

function validateSdk(sdk) {
  if (!sdk || typeof sdk.put !== "function" || typeof sdk.get !== "function"
    || typeof sdk.list !== "function" || typeof sdk.del !== "function") {
    throw new EcsDiscoveryPublisherError("blob_sdk_unavailable", "The official Vercel Blob SDK is unavailable.");
  }
  return sdk;
}

async function loadOfficialSdk() {
  try {
    return validateSdk(await import("@vercel/blob"));
  } catch {
    throw new EcsDiscoveryPublisherError("blob_sdk_unavailable", "Install the declared @vercel/blob dependency before publishing.");
  }
}

function validateRemoteCurrent(manifest, currentUrl, secret) {
  const current = publicBlobUrl(currentUrl);
  if (!exactKeys(manifest, CURRENT_KEYS)
    || manifest.version !== 1 || manifest.vendor !== "ECS Tuning"
    || manifest.kind !== "ecs-url-discovery-current"
    || !RELEASE_ID.test(String(manifest.releaseId || ""))
    || canonicalTimestamp(manifest.publishedAt) === null || canonicalTimestamp(manifest.expiresAt) === null
    || Date.parse(manifest.publishedAt) >= Date.parse(manifest.expiresAt)
    || Date.parse(manifest.expiresAt) - Date.parse(manifest.publishedAt) > DISCOVERY_LIFETIME_MS
    || !plainObject(manifest.counts)
    || !exactKeys(manifest.counts, ["urlCount", "shardCount"])
    || !Number.isSafeInteger(manifest.counts.urlCount) || manifest.counts.urlCount < 1 || manifest.counts.urlCount > MAX_URLS
    || !Number.isSafeInteger(manifest.counts.shardCount) || manifest.counts.shardCount < 1 || manifest.counts.shardCount > MAX_SHARDS
    || !Array.isArray(manifest.shards) || manifest.shards.length !== manifest.counts.shardCount
    || !verifyEcsDiscoveryManifestSignature(manifest, secret)) {
    throw new EcsDiscoveryPublisherError("invalid_remote_manifest", "The remote preview manifest failed signature or policy validation.");
  }
  let urlCount = 0;
  for (let position = 0; position < manifest.shards.length; position += 1) {
    const shard = manifest.shards[position];
    const url = publicBlobUrl(shard?.url, current?.hostname || null);
    const expectedPath = `${ECS_DISCOVERY_RELEASE_PREFIX}${manifest.releaseId}/ecs-product-urls-${String(position + 1).padStart(8, "0")}.json`;
    if (!exactKeys(shard, ["sequence", "url", "urlCount", "bytes", "sha256"])
      || shard.sequence !== position + 1 || !url || !url.pathname.endsWith(`/${expectedPath}`)
      || !Number.isSafeInteger(shard.urlCount) || shard.urlCount < 1
      || !Number.isSafeInteger(shard.bytes) || shard.bytes < 2 || shard.bytes > SHARD_MAX_BYTES
      || !SHA256.test(String(shard.sha256 || ""))) {
      throw new EcsDiscoveryPublisherError("invalid_remote_manifest", "The remote preview manifest contains an invalid shard reference.");
    }
    urlCount += shard.urlCount;
  }
  if (urlCount !== manifest.counts.urlCount) {
    throw new EcsDiscoveryPublisherError("invalid_remote_manifest", "The remote preview manifest URL count does not match its shards.");
  }
}

async function loadRemoteCurrent(sdk, token, secret) {
  let result;
  try {
    result = await sdk.get(ECS_DISCOVERY_CURRENT_PATH, {
      access: "public", token, headers: { "Cache-Control": "no-cache" }
    });
  } catch {
    throw new EcsDiscoveryPublisherError("remote_read_failed", "The remote preview manifest could not be read.");
  }
  if (result == null) return null;
  const metadata = validBlobMetadata(result.blob, ECS_DISCOVERY_CURRENT_PATH);
  if (!metadata || result.statusCode !== 200 || !result.stream
    || (result.blob.size != null && result.blob.size > CURRENT_MAX_BYTES)) {
    throw new EcsDiscoveryPublisherError("invalid_remote_manifest", "The remote preview manifest metadata is invalid.");
  }
  const buffer = await readBoundedStream(result.stream, CURRENT_MAX_BYTES);
  const manifest = parseObject(buffer, "invalid_remote_manifest", "Remote preview manifest");
  validateRemoteCurrent(manifest, metadata.url, secret);
  let listing;
  try {
    listing = await sdk.list({ token, prefix: ECS_DISCOVERY_CURRENT_PATH, limit: 2 });
  } catch {
    throw new EcsDiscoveryPublisherError("remote_read_failed", "The authoritative preview manifest metadata could not be read.");
  }
  const listedCurrent = Array.isArray(listing?.blobs)
    ? listing.blobs.find(blob => blob?.pathname === ECS_DISCOVERY_CURRENT_PATH)
    : null;
  const authoritativeMetadata = validBlobMetadata(
    listedCurrent,
    ECS_DISCOVERY_CURRENT_PATH,
    new URL(metadata.url).hostname
  );
  if (!authoritativeMetadata) {
    throw new EcsDiscoveryPublisherError("invalid_remote_manifest", "The authoritative preview manifest metadata is invalid.");
  }
  return Object.freeze({
    manifest,
    etag: authoritativeMetadata.etag,
    hostname: new URL(metadata.url).hostname
  });
}

export async function publishEcsDiscoveryToVercelBlob({
  indexPath,
  dryRun,
  previewConfirmed = false,
  token = process.env.BLOB_READ_WRITE_TOKEN,
  manifestSecret = process.env.ECS_DISCOVERY_MANIFEST_SECRET,
  blobSdk = null,
  now = Date.now()
} = {}) {
  const effectiveDryRun = dryRun === undefined ? !previewConfirmed : Boolean(dryRun);
  const local = await loadLocalEcsDiscovery(indexPath);
  const plan = Object.freeze({
    supplier: "ECS Tuning",
    environment: "preview",
    releaseId: local.releaseId,
    uniqueUrls: local.index.counts.uniqueUrls,
    shards: local.shards.length,
    uploadObjects: local.shards.length + 1,
    totalUploadBytes: local.totalUploadBytes,
    indexSha256: local.indexSha256,
    manifestSetSha256: local.index.manifestSetSha256
  });
  if (effectiveDryRun) return Object.freeze({ status: "dry_run_passed", dryRun: true, noChange: false, ...plan });
  if (!previewConfirmed) {
    throw new EcsDiscoveryPublisherError("preview_confirmation_required", "A real publish requires the explicit --preview confirmation.");
  }
  if (!validToken(token)) {
    throw new EcsDiscoveryPublisherError("blob_token_required", "BLOB_READ_WRITE_TOKEN is required for a real preview publish.");
  }
  if (!validSecret(manifestSecret)) {
    throw new EcsDiscoveryPublisherError("manifest_secret_required", "ECS_DISCOVERY_MANIFEST_SECRET is required for a real preview publish.");
  }
  if (!Number.isFinite(Number(now))) {
    throw new EcsDiscoveryPublisherError("invalid_clock", "The publication clock is invalid.");
  }
  const publishedAt = new Date(Number(now)).toISOString();
  if (canonicalTimestamp(publishedAt) === null || Date.parse(local.generatedAt) > Date.parse(publishedAt) + 5 * 60 * 1_000) {
    throw new EcsDiscoveryPublisherError("invalid_clock", "The publication clock is invalid.");
  }
  const sdk = validateSdk(blobSdk || await loadOfficialSdk());
  const remoteCurrent = await loadRemoteCurrent(sdk, token, manifestSecret);
  const releasePrefix = `${ECS_DISCOVERY_RELEASE_PREFIX}${local.releaseId}/`;
  const sameRelease = remoteCurrent?.manifest.releaseId === local.releaseId;
  if (remoteCurrent && !sameRelease && remoteCurrent.manifest.releaseId > local.releaseId) {
    throw new EcsDiscoveryPublisherError("remote_release_newer", "The remote preview release is newer than this local discovery set.");
  }

  let hostname = remoteCurrent?.hostname || null;
  const shardUrls = [];
  const createdBlobs = [];
  const cleanupCreatedBlobs = async () => {
    const pending = createdBlobs.splice(0, createdBlobs.length);
    await Promise.all(pending.map(blob => sdk.del(blob.url, { token, ifMatch: blob.etag }).catch(() => {})));
  };
  if (sameRelease) {
    for (let index = 0; index < local.shards.length; index += 1) {
      const shard = local.shards[index];
      const remoteShard = remoteCurrent.manifest.shards[index];
      if (remoteShard.sequence !== shard.sequence || remoteShard.urlCount !== shard.urlCount
        || remoteShard.bytes !== shard.bytes || remoteShard.sha256 !== shard.sha256) {
        throw new EcsDiscoveryPublisherError("invalid_remote_manifest", "The current release descriptors differ from the local release.");
      }
      await getAndVerify(
        sdk, token, `${releasePrefix}${shard.file}`, shard.buffer, SHARD_MAX_BYTES, hostname
      );
      shardUrls.push(remoteShard.url);
    }
    await getAndVerify(
      sdk, token, `${releasePrefix}index.json`, local.indexBuffer, INDEX_MAX_BYTES, hostname
    );
    if (Date.parse(remoteCurrent.manifest.expiresAt) > Number(now) + 60 * 60 * 1_000) {
      return Object.freeze({ status: "no_change", dryRun: false, noChange: true, ...plan });
    }
  } else {
    try {
      for (const shard of local.shards) {
        const uploaded = await uploadImmutableAndVerify(
          sdk, token, `${releasePrefix}${shard.file}`, shard.buffer, SHARD_MAX_BYTES, hostname
        );
        const { metadata } = uploaded;
        hostname ||= new URL(metadata.url).hostname;
        shardUrls.push(metadata.url);
        if (uploaded.created) createdBlobs.push({ url: metadata.url, etag: uploaded.etag });
      }
      const uploadedIndex = await uploadImmutableAndVerify(
        sdk, token, `${releasePrefix}index.json`, local.indexBuffer, INDEX_MAX_BYTES, hostname
      );
      hostname ||= new URL(uploadedIndex.metadata.url).hostname;
      if (uploadedIndex.created) createdBlobs.push({ url: uploadedIndex.metadata.url, etag: uploadedIndex.etag });
    } catch (error) {
      await cleanupCreatedBlobs();
      throw error;
    }
    if (shardUrls.length !== local.shards.length) {
      await cleanupCreatedBlobs();
      throw new EcsDiscoveryPublisherError("remote_verify_failed", "Not every discovery shard was verified.");
    }
  }

  const unsignedManifest = {
    version: 1,
    vendor: "ECS Tuning",
    kind: "ecs-url-discovery-current",
    releaseId: local.releaseId,
    publishedAt,
    expiresAt: new Date(Number(now) + DISCOVERY_LIFETIME_MS).toISOString(),
    counts: {
      urlCount: local.index.counts.uniqueUrls,
      shardCount: local.shards.length
    },
    shards: local.shards.map((shard, index) => ({
      sequence: shard.sequence,
      url: shardUrls[index],
      urlCount: shard.urlCount,
      bytes: shard.bytes,
      sha256: shard.sha256
    }))
  };
  const currentManifest = Object.freeze({
    ...unsignedManifest,
    signature: signEcsDiscoveryManifest(unsignedManifest, manifestSecret)
  });
  if (!verifyEcsDiscoveryManifestSignature(currentManifest, manifestSecret)) {
    await cleanupCreatedBlobs();
    throw new EcsDiscoveryPublisherError("manifest_signing_failed", "The signed preview manifest failed local verification.");
  }
  const currentBody = Buffer.from(`${JSON.stringify(currentManifest)}\n`);
  let currentBlob;
  try {
    const uploaded = await sdk.put(ECS_DISCOVERY_CURRENT_PATH, currentBody, {
      access: "public",
      token,
      contentType: "application/json",
      cacheControlMaxAge: 60,
      addRandomSuffix: false,
      ...(remoteCurrent
        ? { allowOverwrite: true, ifMatch: remoteCurrent.etag }
        : { allowOverwrite: false })
    });
    currentBlob = validBlobMetadata(uploaded, ECS_DISCOVERY_CURRENT_PATH, hostname, false);
  } catch (error) {
    if (preconditionFailure(error)) {
      await cleanupCreatedBlobs();
      throw new EcsDiscoveryPublisherError("publish_conflict", "The preview pointer changed during publication.");
    }
    throw new EcsDiscoveryPublisherError("manifest_upload_failed", "The signed preview pointer could not be published.");
  }
  if (!currentBlob) {
    throw new EcsDiscoveryPublisherError("manifest_upload_failed", "The signed preview pointer returned invalid metadata.");
  }
  try {
    await getAndVerify(sdk, token, ECS_DISCOVERY_CURRENT_PATH, currentBody, CURRENT_MAX_BYTES, hostname);
  } catch (error) {
    throw error;
  }
  return Object.freeze({
    status: "published", dryRun: false, noChange: false, ...plan,
    currentManifestUrl: currentBlob.url, currentManifest
  });
}

export function parseArguments(argv) {
  const options = Object.create(null);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--dry-run", "--preview", "--help"].includes(argument)) {
      const key = argument.slice(2);
      if (options[key]) throw new EcsDiscoveryPublisherError("invalid_arguments", `Duplicate option: ${argument}`);
      options[key] = true;
      continue;
    }
    if (argument === "--index") {
      if (options.index) throw new EcsDiscoveryPublisherError("invalid_arguments", "Duplicate option: --index");
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new EcsDiscoveryPublisherError("invalid_arguments", "Missing value for --index.");
      options.index = value;
      index += 1;
      continue;
    }
    throw new EcsDiscoveryPublisherError("invalid_arguments", `Unsupported option: ${argument}`);
  }
  return options;
}

function usage() {
  return `
Usage:
  node scripts/ecs-catalog/publish-discovery-blob.mjs --index <private index.json> --dry-run
  node scripts/ecs-catalog/publish-discovery-blob.mjs --index <private index.json> --preview

The real command is preview-only and requires BLOB_READ_WRITE_TOKEN plus
ECS_DISCOVERY_MANIFEST_SECRET. It uploads URL-discovery records only, verifies every
immutable object by read-back checksum, and changes the signed preview pointer last.
`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  if (!options.index) throw new EcsDiscoveryPublisherError("invalid_arguments", `--index is required.\n${usage()}`);
  const result = await publishEcsDiscoveryToVercelBlob({
    indexPath: options.index,
    dryRun: options.preview ? false : true,
    previewConfirmed: Boolean(options.preview)
  });
  process.stdout.write(`${JSON.stringify({
    status: result.status,
    environment: result.environment,
    releaseId: result.releaseId,
    uniqueUrls: result.uniqueUrls,
    shards: result.shards,
    uploadObjects: result.uploadObjects,
    totalUploadBytes: result.totalUploadBytes,
    indexSha256: result.indexSha256,
    manifestSetSha256: result.manifestSetSha256,
    currentManifestUrl: result.currentManifestUrl || null
  }, null, 2)}\n`);
}

if (process.argv?.[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    const safe = error instanceof EcsDiscoveryPublisherError
      ? { code: error.code, message: error.message }
      : { code: "unexpected_failure", message: "The ECS discovery publisher stopped unexpectedly." };
    process.stderr.write(`ECS discovery publish stopped [${safe.code}]: ${safe.message}\n`);
    process.exitCode = 1;
  });
}
