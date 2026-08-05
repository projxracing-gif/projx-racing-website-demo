#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { tegiwaSkuMappingFingerprint } from '../../server/tegiwa-sku-mapping.js';
import {
  TEGIWA_PUBLIC_MANIFEST_VERSION,
  signTegiwaPublicManifest,
  validTegiwaManifestSecret,
  verifyTegiwaPublicManifestSignature
} from '../../server/tegiwa-public-manifest.js';
import { DEFAULT_THRESHOLDS, validateTegiwaIndex } from './lib.mjs';

export const TEGIWA_BLOB_CURRENT_PATH = 'projx-racing/tegiwa/current.json';
export const TEGIWA_BLOB_RELEASE_PREFIX = 'projx-racing/tegiwa/releases/';

const LOCAL_POINTER_BYTES = 64 * 1024;
const LOCAL_MANIFEST_BYTES = 256 * 1024;
const LOCAL_ARTIFACT_BYTES = 50_000_000;
const REMOTE_MANIFEST_BYTES = 64 * 1024;
const RELEASE_LIFETIME_MS = 2 * 60 * 60 * 1_000;
const MAX_PUBLISH_DELAY_MS = 2 * 60 * 60 * 1_000;
const MAX_REMOTE_LIFETIME_MS = 24 * 60 * 60 * 1_000;
const MAX_LIST_PAGES = 10;
const LIST_PAGE_SIZE = 100;
const MAX_CLEANUP_DELETES = 100;
const LOCAL_RELEASE_ID = /^\d{8}T\d{9}Z-[a-f0-9]{8}$/;
const PUBLIC_RELEASE_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/;
const SHA256 = /^[a-f0-9]{64}$/;
const LOCAL_POINTER_FIELDS = Object.freeze([
  'version', 'vendor', 'releaseId', 'previousReleaseId', 'previousManifestSha256',
  'previousIndexSha256', 'manifestSha256', 'indexSha256', 'promotedAt'
]);
const LOCAL_MANIFEST_FIELDS = Object.freeze([
  'version', 'vendor', 'releaseId', 'createdAt', 'checkedAt', 'source',
  'artifact', 'counts', 'baseline', 'gates'
]);

export class BlobPublisherError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BlobPublisherError';
    this.code = code;
  }
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!plainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function canonicalTimestamp(value) {
  if (typeof value !== 'string' || value.length > 40) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value ? timestamp : null;
}

function publicBlobUrl(value, expectedHostname = null) {
  if (typeof value !== 'string' || value.length < 9 || value.length > 4_096) return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLocaleLowerCase('en-US');
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port
      || !hostname.endsWith('.public.blob.vercel-storage.com')
      || (expectedHostname && hostname !== expectedHostname)) return null;
    return url;
  } catch {
    return null;
  }
}

async function readRegularFile(filePath, maximumBytes, label) {
  let metadata;
  try {
    metadata = await lstat(filePath);
  } catch {
    throw new BlobPublisherError('local_release_missing', `${label} is missing.`);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 2 || metadata.size > maximumBytes) {
    throw new BlobPublisherError('invalid_local_release', `${label} is not a bounded regular file.`);
  }
  const buffer = await readFile(filePath);
  if (buffer.length !== metadata.size) throw new BlobPublisherError('local_release_changed', `${label} changed while it was being read.`);
  return buffer;
}

function parseJson(buffer, code, label) {
  try {
    const value = JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, ''));
    if (!plainObject(value)) throw new Error('not_an_object');
    return value;
  } catch {
    throw new BlobPublisherError(code, `${label} is not valid JSON.`);
  }
}

async function assertWorkspace(workspace) {
  const root = path.resolve(workspace || '');
  let metadata;
  try {
    metadata = await lstat(root);
  } catch {
    throw new BlobPublisherError('workspace_missing', 'The local vendor workspace does not exist.');
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new BlobPublisherError('invalid_workspace', 'The local vendor workspace must be a real directory.');
  }
  return root;
}

async function loadSearchFingerprint(searchSummaryPath) {
  const buffer = await readRegularFile(searchSummaryPath, 64 * 1024, 'Checked-in Tegiwa search summary');
  const summary = parseJson(buffer, 'invalid_search_summary', 'Checked-in Tegiwa search summary');
  if (summary.version !== 2 || !SHA256.test(String(summary.skuMappingSha256 || ''))) {
    throw new BlobPublisherError('invalid_search_summary', 'The checked-in Tegiwa search summary is unsupported.');
  }
  return summary.skuMappingSha256;
}

export async function loadLocalTegiwaPublication({ workspace, searchSummaryPath, now = Date.now() }) {
  const root = await assertWorkspace(workspace);
  const pointerBuffer = await readRegularFile(path.join(root, 'current.json'), LOCAL_POINTER_BYTES, 'Current release pointer');
  const pointer = parseJson(pointerBuffer, 'corrupt_current_pointer', 'Current release pointer');
  const previousPresent = pointer.previousReleaseId !== null;
  if (!exactKeys(pointer, LOCAL_POINTER_FIELDS)
    || pointer.version !== 1 || pointer.vendor !== 'tegiwa'
    || !LOCAL_RELEASE_ID.test(String(pointer.releaseId || ''))
    || !SHA256.test(String(pointer.manifestSha256 || ''))
    || !SHA256.test(String(pointer.indexSha256 || ''))
    || canonicalTimestamp(pointer.promotedAt) === null
    || (previousPresent && (!LOCAL_RELEASE_ID.test(String(pointer.previousReleaseId || ''))
      || !SHA256.test(String(pointer.previousManifestSha256 || ''))
      || !SHA256.test(String(pointer.previousIndexSha256 || ''))
      || pointer.previousReleaseId === pointer.releaseId))
    || (!previousPresent && (pointer.previousManifestSha256 !== null || pointer.previousIndexSha256 !== null))) {
    throw new BlobPublisherError('corrupt_current_pointer', 'The current release pointer failed validation.');
  }

  const releaseDirectory = path.join(root, 'releases', pointer.releaseId);
  const manifestBuffer = await readRegularFile(path.join(releaseDirectory, 'manifest.json'), LOCAL_MANIFEST_BYTES, 'Local release manifest');
  const artifactBuffer = await readRegularFile(path.join(releaseDirectory, 'tegiwa-stock-index.json'), LOCAL_ARTIFACT_BYTES, 'Local public stock artifact');
  const manifest = parseJson(manifestBuffer, 'corrupt_local_manifest', 'Local release manifest');
  const index = parseJson(artifactBuffer, 'corrupt_local_artifact', 'Local public stock artifact');
  const manifestHash = sha256(manifestBuffer);
  const artifactHash = sha256(artifactBuffer);
  if (!exactKeys(manifest, LOCAL_MANIFEST_FIELDS)
    || manifest.version !== 1 || manifest.vendor !== 'tegiwa' || manifest.releaseId !== pointer.releaseId
    || canonicalTimestamp(manifest.createdAt) === null
    || !plainObject(manifest.source)
    || manifest.artifact?.name !== 'tegiwa-stock-index.json'
    || manifest.artifact?.bytes !== artifactBuffer.length
    || manifest.artifact?.sha256 !== artifactHash
    || pointer.manifestSha256 !== manifestHash || pointer.indexSha256 !== artifactHash) {
    throw new BlobPublisherError('corrupt_local_release', 'The local release failed its manifest or checksum validation.');
  }

  let retrievedAt = manifest.createdAt;
  const currentHasApprovedProvenance = manifest.source.kind === 'approved-download'
    && manifest.source.privateArchiveVerified === true;
  if (!currentHasApprovedProvenance) {
    if (!previousPresent || pointer.previousIndexSha256 !== artifactHash) {
      throw new BlobPublisherError(
        'untrusted_source_provenance',
        'The current release is not backed by a verified approved-download source with the same artifact checksum.'
      );
    }
    const previousDirectory = path.join(root, 'releases', pointer.previousReleaseId);
    const previousManifestBuffer = await readRegularFile(
      path.join(previousDirectory, 'manifest.json'), LOCAL_MANIFEST_BYTES, 'Previous local release manifest'
    );
    const previousArtifactBuffer = await readRegularFile(
      path.join(previousDirectory, 'tegiwa-stock-index.json'), LOCAL_ARTIFACT_BYTES, 'Previous local public stock artifact'
    );
    const previousManifest = parseJson(
      previousManifestBuffer, 'corrupt_previous_release', 'Previous local release manifest'
    );
    const previousArtifactHash = sha256(previousArtifactBuffer);
    if (sha256(previousManifestBuffer) !== pointer.previousManifestSha256
      || previousArtifactHash !== pointer.previousIndexSha256
      || previousArtifactHash !== artifactHash
      || !exactKeys(previousManifest, LOCAL_MANIFEST_FIELDS)
      || previousManifest.version !== 1 || previousManifest.vendor !== 'tegiwa'
      || previousManifest.releaseId !== pointer.previousReleaseId
      || canonicalTimestamp(previousManifest.createdAt) === null
      || previousManifest.artifact?.name !== 'tegiwa-stock-index.json'
      || previousManifest.artifact?.bytes !== previousArtifactBuffer.length
      || previousManifest.artifact?.sha256 !== previousArtifactHash
      || previousManifest.source?.kind !== 'approved-download'
      || previousManifest.source?.privateArchiveVerified !== true) {
      throw new BlobPublisherError(
        'untrusted_source_provenance',
        'The checksum-identical previous release does not prove an approved vendor download.'
      );
    }
    retrievedAt = previousManifest.createdAt;
  }

  let indexSummary;
  try {
    indexSummary = validateTegiwaIndex(index, { now, thresholds: DEFAULT_THRESHOLDS, freshness: true });
  } catch {
    throw new BlobPublisherError('invalid_local_artifact', 'The local public stock artifact failed schema or freshness validation.');
  }
  if (manifest.checkedAt !== indexSummary.checkedAt
    || manifest.counts?.checkedAt !== indexSummary.checkedAt
    || manifest.counts?.productCount !== indexSummary.productCount
    || manifest.counts?.skuProductCount !== indexSummary.skuProductCount
    || manifest.counts?.availableProductCount !== indexSummary.availableProductCount) {
    throw new BlobPublisherError('corrupt_local_release', 'The local manifest aggregates do not match the public stock artifact.');
  }

  const expectedSkuFingerprint = await loadSearchFingerprint(searchSummaryPath);
  let actualSkuFingerprint;
  try {
    actualSkuFingerprint = tegiwaSkuMappingFingerprint(index);
  } catch {
    throw new BlobPublisherError('invalid_local_artifact', 'The local public SKU mapping is invalid.');
  }
  if (actualSkuFingerprint !== expectedSkuFingerprint) {
    throw new BlobPublisherError('stale_search_sku_index', 'The local stock SKU mapping does not match the checked-in search index.');
  }

  return Object.freeze({
    releaseId: pointer.releaseId,
    retrievedAt,
    artifactBuffer,
    artifactBytes: artifactBuffer.length,
    artifactSha256: artifactHash,
    skuMappingSha256: actualSkuFingerprint,
    counts: Object.freeze({
      productCount: indexSummary.productCount,
      skuProductCount: indexSummary.skuProductCount,
      availableProductCount: indexSummary.availableProductCount
    })
  });
}

async function readBoundedStream(stream, maximumBytes) {
  if (!stream) throw new BlobPublisherError('invalid_remote_manifest', 'The remote current manifest has no content.');
  const chunks = [];
  let bytes = 0;
  if (typeof stream.getReader === 'function') {
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      bytes += chunk.length;
      if (bytes > maximumBytes) {
        await reader.cancel().catch(() => {});
        throw new BlobPublisherError('invalid_remote_manifest', 'The remote current manifest is too large.');
      }
      chunks.push(chunk);
    }
  } else if (stream[Symbol.asyncIterator]) {
    for await (const value of stream) {
      const chunk = Buffer.from(value);
      bytes += chunk.length;
      if (bytes > maximumBytes) throw new BlobPublisherError('invalid_remote_manifest', 'The remote current manifest is too large.');
      chunks.push(chunk);
    }
  } else {
    throw new BlobPublisherError('invalid_remote_manifest', 'The remote current manifest stream is unsupported.');
  }
  return Buffer.concat(chunks, bytes);
}

function validateRemoteManifestPolicy(manifest, currentBlobUrl, secret) {
  if (!verifyTegiwaPublicManifestSignature(manifest, secret)) {
    throw new BlobPublisherError('invalid_remote_manifest', 'The remote current manifest signature is invalid.');
  }
  const currentUrl = publicBlobUrl(currentBlobUrl);
  const artifactUrl = publicBlobUrl(manifest.artifact.url, currentUrl?.hostname || null);
  const retrievedAt = canonicalTimestamp(manifest.retrievedAt);
  const publishedAt = canonicalTimestamp(manifest.publishedAt);
  const expiresAt = canonicalTimestamp(manifest.expiresAt);
  if (!currentUrl || !artifactUrl || !artifactUrl.pathname.includes(`/${TEGIWA_BLOB_RELEASE_PREFIX}`)
    || retrievedAt === null || publishedAt === null || expiresAt === null
    || retrievedAt > publishedAt || publishedAt >= expiresAt
    || expiresAt - retrievedAt > MAX_REMOTE_LIFETIME_MS) {
    throw new BlobPublisherError('invalid_remote_manifest', 'The remote current manifest failed publication-policy validation.');
  }
}

async function loadRemoteCurrent(sdk, token, secret) {
  const result = await sdk.get(TEGIWA_BLOB_CURRENT_PATH, {
    access: 'public', token, headers: { 'Cache-Control': 'no-cache' }
  });
  if (result === null || result === undefined) return null;
  if (result.statusCode !== 200 || !result.stream || result.blob?.pathname !== TEGIWA_BLOB_CURRENT_PATH
    || typeof result.blob?.etag !== 'string' || !result.blob.etag
    || (result.blob.contentType && !String(result.blob.contentType).toLocaleLowerCase('en-US').startsWith('application/json'))
    || (result.blob.size !== null && result.blob.size !== undefined
      && (!Number.isSafeInteger(result.blob.size) || result.blob.size < 2 || result.blob.size > REMOTE_MANIFEST_BYTES))) {
    throw new BlobPublisherError('invalid_remote_manifest', 'The remote current manifest metadata is invalid.');
  }
  const buffer = await readBoundedStream(result.stream, REMOTE_MANIFEST_BYTES);
  if (Number.isSafeInteger(result.blob.size) && result.blob.size !== buffer.length) {
    throw new BlobPublisherError('invalid_remote_manifest', 'The remote current manifest size changed while it was read.');
  }
  const manifest = parseJson(buffer, 'invalid_remote_manifest', 'Remote current manifest');
  validateRemoteManifestPolicy(manifest, result.blob.url, secret);
  return Object.freeze({ manifest, etag: result.blob.etag, url: result.blob.url });
}

function validateSdk(sdk) {
  if (!sdk || ['put', 'get', 'list', 'del'].some(method => typeof sdk[method] !== 'function')) {
    throw new BlobPublisherError('blob_sdk_unavailable', 'The official Vercel Blob SDK is unavailable.');
  }
  return sdk;
}

async function loadOfficialSdk() {
  try {
    return validateSdk(await import('@vercel/blob'));
  } catch {
    throw new BlobPublisherError('blob_sdk_unavailable', 'Install the declared @vercel/blob dependency before publishing.');
  }
}

function validToken(token) {
  return typeof token === 'string' && token.length >= 20 && token.length <= 4_096 && token === token.trim();
}

function publicationTimes(retrievedAt, now) {
  const retrievedTimestamp = canonicalTimestamp(retrievedAt);
  if (!Number.isFinite(Number(now))) {
    throw new BlobPublisherError('invalid_clock', 'The publication clock is invalid.');
  }
  let publishedAt;
  try {
    publishedAt = new Date(Number(now)).toISOString();
  } catch {
    throw new BlobPublisherError('invalid_clock', 'The publication clock is invalid.');
  }
  const publishedTimestamp = canonicalTimestamp(publishedAt);
  if (retrievedTimestamp === null || publishedTimestamp === null || retrievedTimestamp > publishedTimestamp
    || publishedTimestamp - retrievedTimestamp > MAX_PUBLISH_DELAY_MS) {
    throw new BlobPublisherError('local_release_too_old', 'The local release is outside the two-hour publication window.');
  }
  const expiresTimestamp = retrievedTimestamp + RELEASE_LIFETIME_MS;
  if (publishedTimestamp >= expiresTimestamp) {
    throw new BlobPublisherError('local_release_expired', 'The local release would already be expired when published.');
  }
  return { publishedAt, expiresAt: new Date(expiresTimestamp).toISOString() };
}

function artifactPath(local) {
  if (!PUBLIC_RELEASE_ID.test(local.releaseId) || !SHA256.test(local.artifactSha256)) {
    throw new BlobPublisherError('invalid_local_release', 'The release identity is not safe for publication.');
  }
  return `${TEGIWA_BLOB_RELEASE_PREFIX}${local.releaseId}-${local.artifactSha256.slice(0, 16)}.json`;
}

function validUploadedBlob(blob, prefix, expectedHostname = null) {
  const url = publicBlobUrl(blob?.url, expectedHostname);
  return url && typeof blob.pathname === 'string' && blob.pathname.startsWith(prefix)
    ? { ...blob, url: url.toString() }
    : null;
}

function preconditionFailure(error) {
  return ['BlobPreconditionFailedError', 'BlobAlreadyExistsError'].includes(error?.name)
    || ['BLOB_PRECONDITION_FAILED', 'BLOB_ALREADY_EXISTS'].includes(error?.code)
    || [409, 412].includes(error?.status) || [409, 412].includes(error?.statusCode);
}

async function cleanupOldArtifacts(sdk, token, keepUrls, expectedHostname) {
  const blobs = [];
  let cursor;
  let pages = 0;
  let truncated = false;
  try {
    do {
      const result = await sdk.list({
        token, prefix: TEGIWA_BLOB_RELEASE_PREFIX, limit: LIST_PAGE_SIZE, ...(cursor ? { cursor } : {})
      });
      pages += 1;
      if (!result || !Array.isArray(result.blobs) || typeof result.hasMore !== 'boolean') throw new Error('invalid_list');
      blobs.push(...result.blobs);
      if (!result.hasMore) break;
      if (pages >= MAX_LIST_PAGES || typeof result.cursor !== 'string' || !result.cursor || result.cursor === cursor) {
        truncated = true;
        break;
      }
      cursor = result.cursor;
    } while (pages < MAX_LIST_PAGES);
  } catch {
    return { deleted: 0, failed: 0, truncated: true };
  }

  const candidates = blobs
    .filter(blob => publicBlobUrl(blob?.url, expectedHostname) && !keepUrls.has(blob.url)
      && typeof blob.pathname === 'string' && blob.pathname.startsWith(TEGIWA_BLOB_RELEASE_PREFIX))
    .sort((left, right) => Date.parse(left.uploadedAt || 0) - Date.parse(right.uploadedAt || 0)
      || left.pathname.localeCompare(right.pathname))
    .slice(0, MAX_CLEANUP_DELETES);
  if (candidates.length < blobs.filter(blob => !keepUrls.has(blob?.url)).length) truncated = true;
  let deleted = 0;
  let failed = 0;
  for (const blob of candidates) {
    try {
      await sdk.del(blob.url, { token, ...(blob.etag ? { ifMatch: blob.etag } : {}) });
      deleted += 1;
    } catch {
      failed += 1;
    }
  }
  return { deleted, failed, truncated };
}

export async function publishTegiwaToVercelBlob({
  workspace,
  repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  searchSummaryPath = path.join(repoRoot, 'api', 'data', 'tegiwa-search-summary.json'),
  dryRun = false,
  token = process.env.BLOB_READ_WRITE_TOKEN,
  manifestSecret = process.env.TEGIWA_STOCK_MANIFEST_SECRET,
  blobSdk = null,
  now = Date.now()
} = {}) {
  const local = await loadLocalTegiwaPublication({ workspace, searchSummaryPath, now });
  const plan = {
    vendor: 'Tegiwa',
    releaseId: local.releaseId,
    artifactBytes: local.artifactBytes,
    artifactSha256: local.artifactSha256,
    skuMappingSha256: local.skuMappingSha256,
    counts: local.counts
  };
  const times = publicationTimes(local.retrievedAt, now);
  if (dryRun) return Object.freeze({ status: 'dry_run_passed', dryRun: true, noChange: false, ...plan });
  if (!validToken(token)) throw new BlobPublisherError('blob_token_required', 'BLOB_READ_WRITE_TOKEN is required for a real publish.');
  if (!validTegiwaManifestSecret(manifestSecret)) {
    throw new BlobPublisherError('manifest_secret_required', 'TEGIWA_STOCK_MANIFEST_SECRET is required for a real publish.');
  }
  const sdk = validateSdk(blobSdk || await loadOfficialSdk());
  let remoteCurrent;
  try {
    remoteCurrent = await loadRemoteCurrent(sdk, token, manifestSecret);
  } catch (error) {
    if (error instanceof BlobPublisherError) throw error;
    throw new BlobPublisherError('remote_read_failed', 'The remote current manifest could not be read.');
  }
  if (remoteCurrent?.manifest.artifact.sha256 === local.artifactSha256) {
    return Object.freeze({ status: 'no_change', dryRun: false, noChange: true, ...plan, cleanup: null });
  }
  if (remoteCurrent && Date.parse(local.retrievedAt) <= Date.parse(remoteCurrent.manifest.retrievedAt)) {
    throw new BlobPublisherError('remote_release_newer', 'The remote current release is newer than the selected local release.');
  }

  const basePath = artifactPath(local);
  let artifactBlob;
  try {
    artifactBlob = validUploadedBlob(await sdk.put(basePath, local.artifactBuffer, {
      access: 'public', token, contentType: 'application/json', cacheControlMaxAge: 31_536_000,
      addRandomSuffix: true, allowOverwrite: false, multipart: true
    }), TEGIWA_BLOB_RELEASE_PREFIX);
  } catch {
    throw new BlobPublisherError('artifact_upload_failed', 'The immutable public stock artifact could not be uploaded.');
  }
  if (!artifactBlob) throw new BlobPublisherError('artifact_upload_failed', 'The uploaded artifact metadata is invalid.');

  const unsignedManifest = {
    version: TEGIWA_PUBLIC_MANIFEST_VERSION,
    vendor: 'Tegiwa',
    releaseId: local.releaseId,
    retrievedAt: local.retrievedAt,
    publishedAt: times.publishedAt,
    expiresAt: times.expiresAt,
    counts: local.counts,
    artifact: {
      url: artifactBlob.url,
      bytes: local.artifactBytes,
      sha256: local.artifactSha256
    }
  };
  const publicManifest = Object.freeze({
    ...unsignedManifest,
    signature: signTegiwaPublicManifest(unsignedManifest, manifestSecret)
  });
  if (!verifyTegiwaPublicManifestSignature(publicManifest, manifestSecret)) {
    throw new BlobPublisherError('manifest_signing_failed', 'The public manifest signature could not be verified locally.');
  }
  const manifestBody = JSON.stringify(publicManifest);
  let currentBlob;
  try {
    const currentOptions = {
      access: 'public', token, contentType: 'application/json', cacheControlMaxAge: 60,
      addRandomSuffix: false,
      ...(remoteCurrent
        ? { allowOverwrite: true, ifMatch: remoteCurrent.etag }
        : { allowOverwrite: false })
    };
    currentBlob = validUploadedBlob(
      await sdk.put(TEGIWA_BLOB_CURRENT_PATH, manifestBody, currentOptions),
      TEGIWA_BLOB_CURRENT_PATH,
      new URL(artifactBlob.url).hostname
    );
  } catch (error) {
    if (preconditionFailure(error)) {
      throw new BlobPublisherError('publish_conflict', 'The remote current manifest changed during publication.');
    }
    throw new BlobPublisherError('manifest_upload_failed', 'The signed current manifest could not be published.');
  }
  if (!currentBlob || currentBlob.pathname !== TEGIWA_BLOB_CURRENT_PATH) {
    throw new BlobPublisherError('manifest_upload_failed', 'The published current-manifest metadata is invalid.');
  }

  const keepUrls = new Set([artifactBlob.url]);
  if (remoteCurrent?.manifest.artifact.url) keepUrls.add(remoteCurrent.manifest.artifact.url);
  const cleanup = await cleanupOldArtifacts(
    sdk, token, keepUrls, new URL(artifactBlob.url).hostname
  );
  return Object.freeze({
    status: 'published', dryRun: false, noChange: false, ...plan,
    publicManifest, currentManifestUrl: currentBlob.url, cleanup
  });
}

function usage(defaultWorkspace) {
  return `
Usage:
  node scripts/vendor-sync/publish-vercel-blob.mjs --workspace <directory> --dry-run
  node scripts/vendor-sync/publish-vercel-blob.mjs --workspace <directory>

Options:
  --workspace <directory>  Local Tegiwa release workspace${defaultWorkspace ? ` (default: ${defaultWorkspace})` : ''}
  --dry-run                Validate the local release and SKU mapping; no credentials or network
  --help                   Show this help

A real publish requires BLOB_READ_WRITE_TOKEN and TEGIWA_STOCK_MANIFEST_SECRET.
This command never creates a Blob store and never uploads raw CSV or the private local manifest.
`;
}

function parseArguments(argv) {
  const options = Object.create(null);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run' || argument === '--help') {
      if (options[argument.slice(2)]) throw new BlobPublisherError('invalid_arguments', `Duplicate option: ${argument}`);
      options[argument.slice(2)] = true;
    } else if (argument === '--workspace') {
      if (options.workspace) throw new BlobPublisherError('invalid_arguments', 'Duplicate option: --workspace');
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new BlobPublisherError('invalid_arguments', 'Missing value for --workspace.');
      options.workspace = value;
      index += 1;
    } else {
      throw new BlobPublisherError('invalid_arguments', `Unsupported option: ${argument}`);
    }
  }
  return options;
}

async function main() {
  const defaultWorkspace = process.platform === 'win32'
    ? 'D:\\Projx-Racing-Website-Data\\vendor-feeds\\tegiwa'
    : '';
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage(defaultWorkspace));
    return;
  }
  const workspace = options.workspace || defaultWorkspace;
  if (!workspace) throw new BlobPublisherError('invalid_arguments', '--workspace is required on this operating system.');
  const result = await publishTegiwaToVercelBlob({ workspace, dryRun: Boolean(options['dry-run']) });
  process.stdout.write(`${JSON.stringify({
    status: result.status,
    vendor: result.vendor,
    releaseId: result.releaseId,
    artifactBytes: result.artifactBytes,
    artifactSha256: result.artifactSha256,
    skuMappingSha256: result.skuMappingSha256,
    counts: result.counts,
    cleanup: result.cleanup || null
  }, null, 2)}\n`);
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch(error => {
    const safe = error instanceof BlobPublisherError
      ? { code: error.code, message: error.message }
      : { code: 'unexpected_failure', message: 'The Vercel Blob publisher stopped unexpectedly.' };
    process.stderr.write(`Blob publish stopped [${safe.code}]: ${safe.message}\n`);
    process.exitCode = 1;
  });
}
