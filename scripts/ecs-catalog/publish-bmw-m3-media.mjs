import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { __test as imageValidation } from './materialize-page-assets.mjs';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const MEDIA_ROOT = path.join(REPO, 'assets', 'products', 'ecs');
const PUBLIC_BLOB_HOST = /\.public\.blob\.vercel-storage\.com$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_\-.]{20,4096}$/;
const STORE_ID_PATTERN = /^(?:store_)?[A-Za-z0-9_-]{3,256}$/;
const MAX_IMAGES = 25_000;
const MAX_IMAGE_BYTES = 25_000_000;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_UPLOAD_CONCURRENCY = 4;
const MAX_UPLOAD_CONCURRENCY = 8;
const CONTENT_TYPES = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});

export const BMW_M3_MEDIA_BLOB_PREFIX = 'projx-racing/ecs-media/bmw-m3/';

export class BmwM3MediaPublishError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BmwM3MediaPublishError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new BmwM3MediaPublishError(code, message);
}

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const credential = (value) => typeof value === 'string' ? value.trim() : '';

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
    fail('blob_token_required', 'Configure VERCEL_OIDC_TOKEN with BLOB_STORE_ID, or provide BLOB_READ_WRITE_TOKEN, for a real preview media publish.');
  }
  return Object.freeze({ token: legacyToken });
}

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function exactTimestamp(value) {
  const source = clean(value);
  const milliseconds = Date.parse(source);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === source
    ? source : null;
}

function officialSourceUrl(value) {
  try {
    const url = new URL(clean(value));
    if (url.protocol !== 'https:' || url.hostname !== 'assets.ecstuning.com'
      || url.username || url.password || url.port || url.search || url.hash) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function publicBlobUrl(value, expectedPathname = null) {
  try {
    const url = new URL(clean(value));
    if (url.protocol !== 'https:' || !PUBLIC_BLOB_HOST.test(url.hostname)
      || url.username || url.password || url.port || url.search || url.hash
      || (expectedPathname && url.pathname !== `/${expectedPathname}`)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function readStream(stream, maximumBytes) {
  const reader = stream?.getReader?.();
  if (!reader) fail('remote_verify_failed', 'An uploaded BMW M3 image could not be read back.');
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maximumBytes) fail('remote_verify_failed', 'An uploaded BMW M3 image exceeded its size bound.');
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, bytes);
}

async function loadVerifiedIndex(indexPath) {
  const resolvedIndex = path.resolve(indexPath);
  if (!inside(REPO, resolvedIndex)) fail('invalid_index_path', 'The BMW M3 media index must stay inside the repository.');
  let document;
  try {
    document = JSON.parse(await readFile(resolvedIndex, 'utf8'));
  } catch {
    fail('invalid_index', 'The BMW M3 media index could not be read.');
  }
  if (document?.schemaVersion !== 1 || document?.supplier !== 'ECS Tuning'
    || !exactTimestamp(document?.generatedAt)
    || !Array.isArray(document?.images) || document.images.length < 1
    || document.images.length > MAX_IMAGES) {
    fail('invalid_index', 'The BMW M3 media index schema or image count is invalid.');
  }
  const bySource = new Map();
  const files = new Map();
  let totalBytes = 0;
  for (const [position, image] of document.images.entries()) {
    const sourceUrl = officialSourceUrl(image?.sourceUrl);
    const localPath = clean(image?.localPath).replaceAll('\\', '/');
    const filename = path.resolve(REPO, localPath);
    const contentType = clean(image?.contentType).toLocaleLowerCase('en-US');
    const expectedHash = clean(image?.sha256).toLocaleLowerCase('en-US');
    const width = Number(image?.width);
    const height = Number(image?.height);
    if (!sourceUrl || !inside(MEDIA_ROOT, filename) || !Object.hasOwn(CONTENT_TYPES, contentType)
      || !/^[a-f0-9]{64}$/.test(expectedHash)
      || !Number.isInteger(width) || width < 1 || width > 8_000
      || !Number.isInteger(height) || height < 1 || height > 8_000) {
      fail('invalid_index_entry', `BMW M3 media index entry ${position + 1} is invalid.`);
    }
    let bytes;
    try {
      if (!(await stat(filename)).isFile()) throw new Error();
      bytes = await readFile(filename);
    } catch {
      fail('missing_local_file', `BMW M3 media file is missing for entry ${position + 1}.`);
    }
    if (bytes.length < 32 || bytes.length > MAX_IMAGE_BYTES || sha256(bytes) !== expectedHash) {
      fail('local_checksum_mismatch', `BMW M3 media file failed checksum validation for entry ${position + 1}.`);
    }
    const measured = imageValidation.dimensions(bytes, contentType);
    if (measured.width !== width || measured.height !== height) {
      fail('local_dimension_mismatch', `BMW M3 media dimensions changed for entry ${position + 1}.`);
    }
    const prior = bySource.get(sourceUrl);
    if (prior && prior.sha256 !== expectedHash) {
      fail('source_conflict', `BMW M3 media source URL maps to conflicting bytes: ${sourceUrl}`);
    }
    const extension = CONTENT_TYPES[contentType];
    const pathname = `${BMW_M3_MEDIA_BLOB_PREFIX}${expectedHash}.${extension}`;
    const file = files.get(expectedHash);
    if (file && (file.contentType !== contentType || file.byteLength !== bytes.length
      || !(await readFile(file.filename)).equals(bytes))) {
      fail('hash_collision', `BMW M3 media hash collision for ${expectedHash}.`);
    }
    if (!file) {
      files.set(expectedHash, {
        filename,
        byteLength: bytes.length,
        contentType,
        pathname,
        sha256: expectedHash,
      });
      totalBytes += bytes.length;
      if (totalBytes > MAX_TOTAL_BYTES) fail('local_size_limit', 'BMW M3 media exceeds the 2 GiB staging limit.');
    }
    bySource.set(sourceUrl, { sourceUrl, width, height, contentType, sha256: expectedHash });
  }
  return { document, bySource, files, totalBytes };
}

async function officialSdk() {
  try {
    return await import('@vercel/blob');
  } catch {
    fail('blob_sdk_unavailable', 'The official Vercel Blob SDK is unavailable.');
  }
}

function validatedSdk(sdk) {
  if (!sdk || !['put', 'get'].every((method) => typeof sdk[method] === 'function')) {
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

async function verifyRemote(sdk, file, authOptions) {
  const response = await getExisting(sdk, file.pathname, authOptions);
  if (!response || response.statusCode !== 200) {
    fail('remote_verify_failed', `${file.pathname} could not be read back.`);
  }
  if (response.blob?.pathname !== file.pathname || response.blob?.size !== file.byteLength
    || clean(response.blob?.contentType).toLocaleLowerCase('en-US') !== file.contentType) {
    fail('remote_verify_failed', `${file.pathname} returned conflicting remote metadata.`);
  }
  const bytes = await readStream(response.stream, MAX_IMAGE_BYTES);
  if (bytes.length !== file.byteLength || sha256(bytes) !== file.sha256) {
    fail('remote_verify_failed', `${file.pathname} failed remote checksum validation.`);
  }
  const url = response?.blob?.url;
  if (!publicBlobUrl(url, file.pathname)) {
    fail('remote_url_invalid', `${file.pathname} did not expose an approved public Blob URL.`);
  }
  return url;
}

async function putImmutable(sdk, file, authOptions) {
  let bytes;
  try {
    bytes = await readFile(file.filename);
  } catch {
    fail('missing_local_file', `${file.pathname} disappeared before it could be published.`);
  }
  if (bytes.length !== file.byteLength || sha256(bytes) !== file.sha256) {
    fail('local_checksum_mismatch', `${file.pathname} changed before it could be published.`);
  }
  let blob = null;
  try {
    blob = await sdk.put(file.pathname, bytes, {
      ...authOptions,
      access: 'public',
      contentType: file.contentType,
      cacheControlMaxAge: 31_536_000,
      addRandomSuffix: false,
      allowOverwrite: false,
      maximumSizeInBytes: MAX_IMAGE_BYTES,
      multipart: bytes.length > 4 * 1024 * 1024,
    });
  } catch (error) {
    if (!['BlobAlreadyExistsError', 'BlobPreconditionFailedError'].includes(error?.name)
      && !['BLOB_ALREADY_EXISTS', 'BLOB_PRECONDITION_FAILED'].includes(error?.code)) {
      fail('blob_upload_failed', `${file.pathname} could not be uploaded.`);
    }
  }
  const verifiedUrl = await verifyRemote(sdk, file, authOptions);
  const uploadedUrl = publicBlobUrl(blob?.url, file.pathname);
  if (blob?.url && !uploadedUrl) fail('remote_url_invalid', `${file.pathname} returned an unsafe Blob URL.`);
  return uploadedUrl || verifiedUrl;
}

async function writeJsonAtomic(filename, value) {
  const resolved = path.resolve(filename);
  if (!inside(REPO, resolved)) fail('invalid_output_path', 'The published media index must stay inside the repository.');
  await mkdir(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, resolved);
}

function uploadConcurrency(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_UPLOAD_CONCURRENCY) {
    fail('invalid_concurrency', `BMW M3 media upload concurrency must be from 1 to ${MAX_UPLOAD_CONCURRENCY}.`);
  }
  return parsed;
}

async function publishFiles(files, concurrency, operation) {
  const values = [...files];
  let cursor = 0;
  let failure = null;
  const worker = async () => {
    while (!failure) {
      const position = cursor;
      cursor += 1;
      if (position >= values.length) return;
      try {
        await operation(values[position]);
      } catch (error) {
        failure ||= error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  if (failure) throw failure;
}

export async function publishBmwM3Media({
  indexPath,
  outputPath,
  dryRun = true,
  previewConfirmed = false,
  token = process.env.BLOB_READ_WRITE_TOKEN || '',
  oidcToken = process.env.VERCEL_OIDC_TOKEN || '',
  storeId = process.env.BLOB_STORE_ID || '',
  blobSdk = null,
  now = Date.now(),
  concurrency = DEFAULT_UPLOAD_CONCURRENCY,
} = {}) {
  if (!indexPath || (!dryRun && !outputPath)) {
    fail('invalid_arguments', 'BMW M3 media publishing requires an input index and a real-run output index.');
  }
  const resolvedIndex = path.resolve(indexPath);
  const resolvedOutput = outputPath ? path.resolve(outputPath) : null;
  if (resolvedOutput && (!inside(REPO, resolvedOutput) || resolvedOutput === resolvedIndex)) {
    fail('invalid_output_path', 'The published media index must be a separate file inside the repository.');
  }
  const boundedConcurrency = uploadConcurrency(concurrency);
  const local = await loadVerifiedIndex(indexPath);
  const plan = Object.freeze({
    status: 'dry_run_passed',
    environment: 'preview',
    imageMappings: local.bySource.size,
    uniqueFiles: local.files.size,
    totalBytes: local.totalBytes,
    uploadConcurrency: boundedConcurrency,
  });
  if (dryRun) return plan;
  if (!previewConfirmed) fail('preview_confirmation_required', 'A real media publish requires explicit preview confirmation.');
  const authOptions = blobAuthOptions({ token, oidcToken, storeId });
  let nowValue;
  let publishedAt;
  try {
    nowValue = Number(now);
    publishedAt = Number.isFinite(nowValue) ? new Date(nowValue).toISOString() : null;
  } catch {
    publishedAt = null;
  }
  if (!publishedAt || nowValue < Date.parse(local.document.generatedAt)) {
    fail('invalid_clock', 'The BMW M3 media publish clock is invalid.');
  }
  const sdk = validatedSdk(blobSdk || await officialSdk());
  const urlByHash = new Map();
  await publishFiles(local.files.values(), boundedConcurrency, async (file) => {
    urlByHash.set(file.sha256, await putImmutable(sdk, file, authOptions));
  });
  const images = [...local.bySource.values()].map((image) => ({
    sourceUrl: image.sourceUrl,
    publicUrl: urlByHash.get(image.sha256),
    width: image.width,
    height: image.height,
    contentType: image.contentType,
    sha256: image.sha256,
  })).sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl));
  await writeJsonAtomic(outputPath, {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    storage: 'vercel-blob-public',
    generatedAt: local.document.generatedAt,
    publishedAt,
    images,
  });
  return Object.freeze({ ...plan, status: 'published', dryRun: false, outputPath: resolvedOutput });
}

function option(argv, name) {
  const indexes = argv.flatMap((item, index) => item === name ? [index] : []);
  if (indexes.length > 1) fail('invalid_arguments', `Duplicate option: ${name}.`);
  if (!indexes.length) return null;
  const value = argv[indexes[0] + 1];
  if (!value || value.startsWith('--')) fail('invalid_arguments', `Missing value for ${name}.`);
  return value;
}

async function main() {
  const argv = process.argv.slice(2);
  const indexPath = option(argv, '--index');
  const outputPath = option(argv, '--output');
  const concurrency = option(argv, '--concurrency') || DEFAULT_UPLOAD_CONCURRENCY;
  const preview = argv.includes('--preview');
  const allowed = new Set(['--index', '--output', '--preview', '--concurrency']);
  if (!indexPath || argv.some((item) => item.startsWith('--') && !allowed.has(item))) {
    fail('invalid_arguments', 'Usage: publish-bmw-m3-media.mjs --index <media-index.json> [--output <published-index.json> --preview] [--concurrency <1-8>].');
  }
  const result = await publishBmwM3Media({
    indexPath,
    outputPath,
    dryRun: !preview,
    previewConfirmed: preview,
    concurrency,
  });
  process.stdout.write(`${JSON.stringify({
    status: result.status,
    environment: result.environment,
    imageMappings: result.imageMappings,
    uniqueFiles: result.uniqueFiles,
    totalBytes: result.totalBytes,
  })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error?.code || 'unexpected_failure'}: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export const __test = Object.freeze({
  inside,
  officialSourceUrl,
  exactTimestamp,
  loadVerifiedIndex,
  blobAuthOptions,
  uploadConcurrency,
  publishFiles,
});
