import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createReviewedShardCatalogueProvider,
  signReviewedShardManifest,
  verifyReviewedShardManifestSignature
} from '../../server/ecs-reviewed-shard-catalog.js';

export const ECS_REVIEWED_RELEASE_PREFIX = 'projx-racing/ecs-reviewed/releases/';
export const ECS_REVIEWED_CURRENT_PATH = 'projx-racing/ecs-reviewed/preview/current.json';

const TOKEN_PATTERN = /^[A-Za-z0-9_\-.]{20,4096}$/;
const STORE_ID_PATTERN = /^(?:store_)?[A-Za-z0-9_-]{3,256}$/;
const MAX_READ_BYTES = 4 * 1024 * 1024;

export class ReviewedShardPublisherError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReviewedShardPublisherError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ReviewedShardPublisherError(code, message);
}

const credential = value => typeof value === 'string' ? value.trim() : '';

function blobAuthOptions({ token = '', oidcToken = '', storeId = '' } = {}) {
  const legacyToken = credential(token);
  const vercelOidcToken = credential(oidcToken);
  const blobStoreId = credential(storeId);
  if (Boolean(vercelOidcToken) !== Boolean(blobStoreId)) {
    fail('blob_oidc_incomplete', 'VERCEL_OIDC_TOKEN and BLOB_STORE_ID must be configured together.');
  }
  if (vercelOidcToken && blobStoreId) {
    if (!TOKEN_PATTERN.test(vercelOidcToken) || !STORE_ID_PATTERN.test(blobStoreId)) {
      fail('blob_oidc_invalid', 'The Vercel OIDC Blob credential configuration is invalid.');
    }
    return Object.freeze({ oidcToken: vercelOidcToken, storeId: blobStoreId });
  }
  if (!TOKEN_PATTERN.test(legacyToken)) {
    fail('blob_token_required', 'Configure VERCEL_OIDC_TOKEN with BLOB_STORE_ID, or provide BLOB_READ_WRITE_TOKEN, for a real preview publish.');
  }
  return Object.freeze({ token: legacyToken });
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function readStream(stream, maximumBytes) {
  const reader = stream?.getReader?.();
  if (!reader) fail('remote_verify_failed', 'An uploaded Blob could not be read back.');
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maximumBytes) fail('remote_verify_failed', 'An uploaded Blob exceeded its verified size bound.');
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function loadLocalRelease(directory) {
  const root = path.resolve(directory);
  const manifestPath = path.join(root, 'manifest.json');
  const provider = createReviewedShardCatalogueProvider({
    localManifestPath: manifestPath,
    allowIncompleteLocal: false
  });
  await provider.getStatus([]);
  const manifestBuffer = Buffer.from(await readFile(manifestPath));
  const manifest = JSON.parse(manifestBuffer.toString('utf8'));
  const artifacts = [];
  for (const descriptor of [manifest.index, ...manifest.shards]) {
    const buffer = Buffer.from(await readFile(path.join(root, descriptor.file)));
    if (buffer.length !== descriptor.bytes || sha256(buffer) !== descriptor.sha256) {
      fail('local_checksum_mismatch', `${descriptor.file} failed local checksum validation.`);
    }
    artifacts.push({ descriptor, buffer });
  }
  return { root, manifest, manifestBuffer, artifacts };
}

async function officialSdk() {
  try {
    return await import('@vercel/blob');
  } catch {
    fail('blob_sdk_unavailable', 'The official Vercel Blob SDK is unavailable.');
  }
}

function validateSdk(sdk) {
  if (!sdk || !['put', 'get'].every(method => typeof sdk[method] === 'function')) {
    fail('blob_sdk_invalid', 'The Vercel Blob SDK is invalid.');
  }
  return sdk;
}

async function getExisting(sdk, pathname, authOptions) {
  try {
    return await sdk.get(pathname, { ...authOptions, access: 'public' });
  } catch {
    return null;
  }
}

async function verifyRemote(sdk, pathname, expected, authOptions) {
  const response = await getExisting(sdk, pathname, authOptions);
  if (!response || response.statusCode !== 200) fail('remote_verify_failed', `${pathname} could not be read back.`);
  const body = await readStream(response.stream, Math.max(MAX_READ_BYTES, expected.length));
  if (body.length !== expected.length || sha256(body) !== sha256(expected)) {
    fail('remote_verify_failed', `${pathname} failed remote checksum validation.`);
  }
  return response;
}

async function putImmutable(sdk, pathname, buffer, authOptions) {
  let blob;
  try {
    blob = await sdk.put(pathname, buffer, {
      ...authOptions, access: 'public', contentType: 'application/json', cacheControlMaxAge: 31_536_000,
      addRandomSuffix: false, allowOverwrite: false, multipart: buffer.length > 4 * 1024 * 1024
    });
  } catch (error) {
    if (!['BlobAlreadyExistsError', 'BlobPreconditionFailedError'].includes(error?.name)
      && !['BLOB_ALREADY_EXISTS', 'BLOB_PRECONDITION_FAILED'].includes(error?.code)) throw error;
  }
  const response = await verifyRemote(sdk, pathname, buffer, authOptions);
  const url = blob?.url || response?.blob?.url;
  if (!url) fail('remote_verify_failed', `${pathname} did not expose a public URL.`);
  return { url, etag: response?.blob?.etag || null };
}

export async function publishReviewedProductShards({
  directory,
  dryRun = true,
  previewConfirmed = false,
  token = process.env.BLOB_READ_WRITE_TOKEN || '',
  oidcToken = process.env.VERCEL_OIDC_TOKEN || '',
  storeId = process.env.BLOB_STORE_ID || '',
  manifestSecret = process.env.ECS_REVIEWED_SHARD_MANIFEST_SECRET || '',
  blobSdk = null,
  now = Date.now()
} = {}) {
  if (!directory) fail('invalid_arguments', 'A reviewed product shard directory is required.');
  let local;
  try {
    local = await loadLocalRelease(directory);
  } catch (error) {
    if (error instanceof ReviewedShardPublisherError) throw error;
    fail(error?.code || 'invalid_local_release', error instanceof Error ? error.message : 'The local release is invalid.');
  }
  const plan = {
    status: 'dry_run_passed', environment: 'preview', releaseId: local.manifest.releaseId,
    productCount: local.manifest.counts.productCount, shardCount: local.manifest.counts.shardCount,
    complete: local.manifest.complete
  };
  if (dryRun) return Object.freeze(plan);
  if (!previewConfirmed) fail('preview_confirmation_required', 'A real reviewed shard publish requires explicit preview confirmation.');
  const authOptions = blobAuthOptions({ token, oidcToken, storeId });
  if (typeof manifestSecret !== 'string' || Buffer.byteLength(manifestSecret, 'utf8') < 32) {
    fail('manifest_secret_required', 'ECS_REVIEWED_SHARD_MANIFEST_SECRET is required for a real preview publish.');
  }
  const nowValue = Number(now);
  if (!Number.isFinite(nowValue)) fail('invalid_clock', 'The reviewed shard publish clock is invalid.');
  const sdk = validateSdk(blobSdk || await officialSdk());
  const prefix = `${ECS_REVIEWED_RELEASE_PREFIX}${local.manifest.releaseId}/`;
  const remoteByFile = new Map();
  for (const artifact of local.artifacts) {
    const pathname = `${prefix}${artifact.descriptor.file}`;
    remoteByFile.set(artifact.descriptor.file, await putImmutable(sdk, pathname, artifact.buffer, authOptions));
  }
  const publishedAt = new Date(nowValue).toISOString();
  const expiresAt = new Date(nowValue + 7 * 24 * 60 * 60 * 1_000).toISOString();
  const remoteManifest = {
    ...local.manifest,
    index: {
      url: remoteByFile.get(local.manifest.index.file).url,
      bytes: local.manifest.index.bytes,
      sha256: local.manifest.index.sha256
    },
    shards: local.manifest.shards.map(descriptor => ({
      sequence: descriptor.sequence,
      url: remoteByFile.get(descriptor.file).url,
      productCount: descriptor.productCount,
      bytes: descriptor.bytes,
      sha256: descriptor.sha256,
      firstKey: descriptor.firstKey,
      lastKey: descriptor.lastKey
    })),
    publishedAt,
    expiresAt
  };
  remoteManifest.signature = signReviewedShardManifest(remoteManifest, manifestSecret);
  if (!verifyReviewedShardManifestSignature(remoteManifest, manifestSecret)) {
    fail('manifest_signing_failed', 'The reviewed shard manifest signature could not be verified locally.');
  }
  const body = Buffer.from(`${JSON.stringify(remoteManifest)}\n`, 'utf8');
  let existing = await getExisting(sdk, ECS_REVIEWED_CURRENT_PATH, authOptions);
  if (existing?.statusCode === 200) {
    const currentBody = await readStream(existing.stream, 2 * 1024 * 1024);
    try {
      const current = JSON.parse(currentBody.toString('utf8'));
      if (current.releaseId === remoteManifest.releaseId
        && verifyReviewedShardManifestSignature(current, manifestSecret)) {
        return Object.freeze({ ...plan, status: 'no_change', dryRun: false, currentManifest: current });
      }
    } catch { /* an invalid current pointer must be replaced only through the guarded write below */ }
  }
  try {
    await sdk.put(ECS_REVIEWED_CURRENT_PATH, body, {
      ...authOptions, access: 'public', contentType: 'application/json', cacheControlMaxAge: 60,
      addRandomSuffix: false, allowOverwrite: Boolean(existing),
      ...(existing?.blob?.etag ? { ifMatch: existing.blob.etag } : {})
    });
  } catch (error) {
    if (['BlobPreconditionFailedError', 'BLOB_PRECONDITION_FAILED'].includes(error?.name || error?.code)) {
      fail('publish_conflict', 'The reviewed shard current manifest changed during publication.');
    }
    fail('manifest_upload_failed', 'The reviewed shard current manifest could not be published.');
  }
  await verifyRemote(sdk, ECS_REVIEWED_CURRENT_PATH, body, authOptions);
  return Object.freeze({
    ...plan, status: 'published', dryRun: false,
    currentManifest: Object.freeze(remoteManifest)
  });
}

function value(argv, name) {
  const indexes = argv.flatMap((item, index) => item === name ? [index] : []);
  if (indexes.length > 1) fail('invalid_arguments', `Duplicate option: ${name}.`);
  if (!indexes.length) return null;
  const result = argv[indexes[0] + 1];
  if (!result || result.startsWith('--')) fail('invalid_arguments', `Missing value for ${name}.`);
  return result;
}

async function main() {
  const argv = process.argv.slice(2);
  const directory = value(argv, '--directory');
  const preview = argv.includes('--preview');
  if (!directory || argv.some(item => item.startsWith('--') && !['--directory', '--preview'].includes(item))) {
    fail('invalid_arguments', 'Usage: publish-reviewed-product-shards.mjs --directory <release> [--preview].');
  }
  const result = await publishReviewedProductShards({
    directory,
    dryRun: !preview,
    previewConfirmed: preview
  });
  process.stdout.write(`${JSON.stringify({
    status: result.status, environment: result.environment, releaseId: result.releaseId,
    productCount: result.productCount, shardCount: result.shardCount, complete: result.complete
  })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error?.code || 'unexpected_failure'}: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export const __test = Object.freeze({ blobAuthOptions });
