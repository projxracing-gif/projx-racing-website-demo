import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { REVIEWED_ECS_PRODUCTS } from './ecs-reviewed-catalog.js';

export const ECS_DISCOVERY_MANIFEST_VERSION = 1;
export const ECS_DISCOVERY_CURRENT_PATH = 'projx-racing/ecs-discovery/preview/current.json';
export const ECS_DISCOVERY_CURRENT_URL_ENV = 'ECS_DISCOVERY_CURRENT_URL';
export const ECS_DISCOVERY_MANIFEST_SECRET_ENV = 'ECS_DISCOVERY_MANIFEST_SECRET';
export const ECS_DISCOVERY_CURSOR_MAX_LENGTH = 1_024;

const CURRENT_MANIFEST_FIELDS = Object.freeze([
  'version', 'vendor', 'kind', 'releaseId', 'publishedAt', 'expiresAt', 'counts', 'shards'
]);
const SIGNED_CURRENT_MANIFEST_FIELDS = Object.freeze([...CURRENT_MANIFEST_FIELDS, 'signature']);
const COUNT_FIELDS = Object.freeze(['urlCount', 'shardCount']);
const SHARD_DESCRIPTOR_FIELDS = Object.freeze(['sequence', 'url', 'urlCount', 'bytes', 'sha256']);
const SHARD_FIELDS = Object.freeze([
  'schemaVersion', 'supplier', 'kind', 'sequence', 'urlCount', 'entries'
]);

const VENDOR = 'ECS Tuning';
const MANIFEST_KIND = 'ecs-url-discovery-current';
const SHARD_KIND = 'ecs-product-url-manifest';
const RELEASE_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/;
const SHA256 = /^[a-f0-9]{64}$/;
const JSON_CONTENT_TYPE = /^(?:application\/(?:[a-z0-9.+-]*\+)?json|text\/json)(?:\s*;|$)/i;
const PUBLIC_BLOB_HOST = /\.public\.blob\.vercel-storage\.com$/i;

const MIN_SECRET_BYTES = 32;
const MAX_SECRET_BYTES = 1_024;
const MAX_CURRENT_BYTES = 256 * 1_024;
const MAX_SHARD_BYTES = 16 * 1_024 * 1_024;
const MAX_SHARDS = 1_000;
const MAX_URLS_PER_SHARD = 100_000;
const MAX_TOTAL_URLS = 10_000_000;
const MAX_RELEASE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_CURRENT_CACHE_MS = 30_000;
const DEFAULT_SHARD_CACHE_ENTRIES = 4;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 250;

export class EcsDiscoveryError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'EcsDiscoveryError';
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new EcsDiscoveryError(status, code, message);
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  if (!plainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return actual.length === required.length && actual.every((key, index) => key === required[index]);
}

function canonicalTimestamp(value) {
  if (typeof value !== 'string' || value.length > 40) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value ? timestamp : null;
}

function validSecret(secret) {
  if (typeof secret !== 'string' || !secret.trim()) return false;
  const bytes = Buffer.byteLength(secret, 'utf8');
  return bytes >= MIN_SECRET_BYTES && bytes <= MAX_SECRET_BYTES;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function publicBlobUrl(value, expectedHostname = null) {
  if (typeof value !== 'string' || value.length < 9 || value.length > 4_096) return null;
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLocaleLowerCase('en-US');
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port
      || parsed.search || parsed.hash || !PUBLIC_BLOB_HOST.test(hostname)
      || (expectedHostname && hostname !== expectedHostname)
      || parsed.toString() !== value) return null;
    return parsed;
  } catch {
    return null;
  }
}

function releasePathMatches(pathname, releaseId) {
  const segments = pathname.split('/').filter(Boolean).map(segment => {
    try { return decodeURIComponent(segment); } catch { return ''; }
  });
  const index = segments.lastIndexOf('releases');
  return index >= 0 && segments[index + 1] === releaseId && index + 2 < segments.length;
}

function safeInteger(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function validateManifestShape(manifest) {
  const expected = Object.hasOwn(manifest || {}, 'signature')
    ? SIGNED_CURRENT_MANIFEST_FIELDS
    : CURRENT_MANIFEST_FIELDS;
  if (!hasExactKeys(manifest, expected)
    || manifest.version !== ECS_DISCOVERY_MANIFEST_VERSION
    || manifest.vendor !== VENDOR
    || manifest.kind !== MANIFEST_KIND
    || typeof manifest.releaseId !== 'string'
    || !RELEASE_ID.test(manifest.releaseId)
    || canonicalTimestamp(manifest.publishedAt) === null
    || canonicalTimestamp(manifest.expiresAt) === null
    || !hasExactKeys(manifest.counts, COUNT_FIELDS)
    || !safeInteger(manifest.counts.urlCount, 1, MAX_TOTAL_URLS)
    || !safeInteger(manifest.counts.shardCount, 1, MAX_SHARDS)
    || !Array.isArray(manifest.shards)
    || manifest.shards.length !== manifest.counts.shardCount) {
    fail(503, 'invalid_ecs_discovery_manifest', 'The ECS discovery manifest failed schema validation.');
  }

  let totalUrls = 0;
  for (let offset = 0; offset < manifest.shards.length; offset += 1) {
    const descriptor = manifest.shards[offset];
    if (!hasExactKeys(descriptor, SHARD_DESCRIPTOR_FIELDS)
      || descriptor.sequence !== offset + 1
      || !safeInteger(descriptor.urlCount, 1, MAX_URLS_PER_SHARD)
      || !safeInteger(descriptor.bytes, 2, MAX_SHARD_BYTES)
      || !SHA256.test(String(descriptor.sha256 || ''))
      || typeof descriptor.url !== 'string') {
      fail(503, 'invalid_ecs_discovery_manifest', 'The ECS discovery manifest contains an invalid shard descriptor.');
    }
    totalUrls += descriptor.urlCount;
    if (!Number.isSafeInteger(totalUrls) || totalUrls > MAX_TOTAL_URLS) {
      fail(503, 'invalid_ecs_discovery_manifest', 'The ECS discovery manifest exceeds the URL limit.');
    }
  }
  if (totalUrls !== manifest.counts.urlCount) {
    fail(503, 'invalid_ecs_discovery_manifest', 'The ECS discovery manifest URL count is inconsistent.');
  }
}

export function canonicalEcsDiscoveryManifestPayload(manifest) {
  validateManifestShape(manifest);
  return JSON.stringify([
    manifest.version,
    manifest.vendor,
    manifest.kind,
    manifest.releaseId,
    manifest.publishedAt,
    manifest.expiresAt,
    manifest.counts.urlCount,
    manifest.counts.shardCount,
    ...manifest.shards.flatMap(descriptor => [
      descriptor.sequence,
      descriptor.url,
      descriptor.urlCount,
      descriptor.bytes,
      descriptor.sha256
    ])
  ]);
}

export function signEcsDiscoveryManifest(manifest, secret) {
  if (!validSecret(secret)) {
    fail(503, 'invalid_ecs_discovery_configuration', 'The ECS discovery manifest secret is invalid.');
  }
  return createHmac('sha256', secret)
    .update(canonicalEcsDiscoveryManifestPayload(manifest), 'utf8')
    .digest('hex');
}

export function verifyEcsDiscoveryManifestSignature(manifest, secret) {
  if (!validSecret(secret) || !SHA256.test(String(manifest?.signature || ''))) return false;
  let expected;
  try {
    expected = signEcsDiscoveryManifest(manifest, secret);
  } catch {
    return false;
  }
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(manifest.signature, 'hex'));
}

export function canonicalizeEcsDiscoveryProductUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    fail(400, 'invalid_ecs_product_url', 'The ECS product URL is invalid.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    fail(400, 'invalid_ecs_product_url', 'The ECS product URL is outside the approved public origin.');
  }
  url.hostname = url.hostname.toLocaleLowerCase('en-US');
  if (!['ecstuning.com', 'www.ecstuning.com'].includes(url.hostname)) {
    fail(400, 'invalid_ecs_product_url', 'The ECS product URL is outside the approved public origin.');
  }
  url.hostname = 'www.ecstuning.com';
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/{2,}/g, '/');
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2
    || segments[0].length > 180
    || !/^b-[a-z0-9._~!$&'()*+,;=:@%-]+$/i.test(segments[0])
    || !/[a-z0-9]/i.test(segments[0].slice(2))
    || segments.slice(1).some(segment => !segment || segment === '.' || segment === '..')) {
    fail(400, 'invalid_ecs_product_url', 'The ECS URL is not a public product URL.');
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}

function strictCanonicalProductUrl(value, code = 'invalid_ecs_discovery_shard') {
  let canonical;
  try {
    canonical = canonicalizeEcsDiscoveryProductUrl(value);
  } catch {
    fail(503, code, 'An ECS discovery shard contains an invalid product URL.');
  }
  if (canonical !== value) {
    fail(503, code, 'An ECS discovery shard contains a non-canonical product URL.');
  }
  return canonical;
}

async function readBoundedResponse(response, maximumBytes, code, label) {
  const announced = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(announced) && announced > maximumBytes) {
    fail(503, code, `${label} exceeds the configured size limit.`);
  }
  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maximumBytes) fail(503, code, `${label} exceeds the configured size limit.`);
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    bytes += chunk.length;
    if (bytes > maximumBytes) {
      await reader.cancel('response-too-large').catch(() => {});
      fail(503, code, `${label} exceeds the configured size limit.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, bytes);
}

function parseJson(buffer, code, label) {
  try {
    const value = JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, ''));
    if (!plainObject(value)) throw new Error('not-an-object');
    return value;
  } catch {
    fail(503, code, `${label} is not valid JSON.`);
  }
}

async function requestJson(fetchImpl, url, {
  timeoutMs,
  maximumBytes,
  code,
  label,
  cache
}) {
  const controller = new AbortController();
  let timedOut = false;
  let timer;
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new EcsDiscoveryError(503, 'ecs_discovery_timeout', `${label} timed out.`));
    }, timeoutMs);
  });
  let response;
  try {
    response = await Promise.race([
      Promise.resolve(fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        cache,
        headers: { accept: 'application/json' },
        signal: controller.signal
      })),
      deadline
    ]);
  } catch (error) {
    if (error instanceof EcsDiscoveryError) throw error;
    if (timedOut || error?.name === 'AbortError') {
      fail(503, 'ecs_discovery_timeout', `${label} timed out.`);
    }
    fail(503, 'ecs_discovery_unavailable', `${label} is unavailable.`);
  } finally {
    clearTimeout(timer);
  }
  if (!response || response.status !== 200) {
    fail(503, 'ecs_discovery_unavailable', `${label} returned an invalid response.`);
  }
  if (response.url && response.url !== url) {
    fail(503, code, `${label} redirected outside its immutable URL.`);
  }
  if (!JSON_CONTENT_TYPE.test(String(response.headers?.get?.('content-type') || ''))) {
    fail(503, code, `${label} has an invalid content type.`);
  }
  const buffer = await readBoundedResponse(response, maximumBytes, code, label);
  return { buffer, value: parseJson(buffer, code, label) };
}

function validateProviderOptions({
  currentUrl,
  manifestSecret,
  fetchImpl,
  timeoutMs,
  currentCacheMs,
  shardCacheEntries
}) {
  const current = publicBlobUrl(currentUrl);
  if (!current || !validSecret(manifestSecret) || typeof fetchImpl !== 'function'
    || !safeInteger(timeoutMs, 1, 60_000)
    || !safeInteger(currentCacheMs, 0, 10 * 60 * 1_000)
    || !safeInteger(shardCacheEntries, 1, 64)) {
    fail(503, 'invalid_ecs_discovery_configuration', 'The ECS discovery provider configuration is invalid.');
  }
  return current;
}

function validateCurrentManifest(manifest, currentUrl, secret, nowValue) {
  validateManifestShape(manifest);
  if (!verifyEcsDiscoveryManifestSignature(manifest, secret)) {
    fail(503, 'invalid_ecs_discovery_manifest', 'The ECS discovery manifest signature is invalid.');
  }
  const publishedAt = canonicalTimestamp(manifest.publishedAt);
  const expiresAt = canonicalTimestamp(manifest.expiresAt);
  if (publishedAt > nowValue + MAX_FUTURE_SKEW_MS
    || expiresAt <= nowValue
    || publishedAt >= expiresAt
    || expiresAt - publishedAt > MAX_RELEASE_LIFETIME_MS) {
    fail(503, 'stale_ecs_discovery_manifest', 'The ECS discovery manifest is stale or has an invalid lifetime.');
  }
  for (const descriptor of manifest.shards) {
    const shardUrl = publicBlobUrl(descriptor.url, currentUrl.hostname);
    if (!shardUrl || !releasePathMatches(shardUrl.pathname, manifest.releaseId)) {
      fail(503, 'invalid_ecs_discovery_manifest', 'An ECS discovery shard is not bound to the signed release.');
    }
  }
}

function validateShard(value, descriptor) {
  if (!hasExactKeys(value, SHARD_FIELDS)
    || value.schemaVersion !== 1
    || value.supplier !== VENDOR
    || value.kind !== SHARD_KIND
    || value.sequence !== descriptor.sequence
    || value.urlCount !== descriptor.urlCount
    || !Array.isArray(value.entries)
    || value.entries.length !== descriptor.urlCount) {
    fail(503, 'invalid_ecs_discovery_shard', 'An ECS discovery shard failed schema validation.');
  }
  const seen = new Set();
  const entries = value.entries.map(entry => {
    if (typeof entry !== 'string') {
      fail(503, 'invalid_ecs_discovery_shard', 'An ECS discovery shard contains a non-string entry.');
    }
    const canonical = strictCanonicalProductUrl(entry);
    if (seen.has(canonical)) {
      fail(503, 'invalid_ecs_discovery_shard', 'An ECS discovery shard contains a duplicate URL.');
    }
    seen.add(canonical);
    return canonical;
  });
  return Object.freeze(entries);
}

function cursorMac(payload, secret) {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

function encodeCursor(position, secret) {
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    r: position.releaseId,
    s: position.shardIndex,
    o: position.offset
  }), 'utf8').toString('base64url');
  return `${payload}.${cursorMac(payload, secret)}`;
}

function decodeCursor(value, secret) {
  if (typeof value !== 'string' || value.length < 10 || value.length > ECS_DISCOVERY_CURSOR_MAX_LENGTH) {
    fail(400, 'invalid_ecs_discovery_cursor', 'The ECS discovery cursor is invalid.');
  }
  const [payload, provided, extra] = value.split('.');
  if (!payload || !SHA256.test(String(provided || '')) || extra !== undefined) {
    fail(400, 'invalid_ecs_discovery_cursor', 'The ECS discovery cursor is invalid.');
  }
  const expected = cursorMac(payload, secret);
  if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'))) {
    fail(400, 'invalid_ecs_discovery_cursor', 'The ECS discovery cursor signature is invalid.');
  }
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    fail(400, 'invalid_ecs_discovery_cursor', 'The ECS discovery cursor payload is invalid.');
  }
  if (!hasExactKeys(decoded, ['v', 'r', 's', 'o'])
    || decoded.v !== 1
    || !RELEASE_ID.test(String(decoded.r || ''))
    || !safeInteger(decoded.s, 0, MAX_SHARDS)
    || !safeInteger(decoded.o, 0, MAX_URLS_PER_SHARD)) {
    fail(400, 'invalid_ecs_discovery_cursor', 'The ECS discovery cursor payload is invalid.');
  }
  return { releaseId: decoded.r, shardIndex: decoded.s, offset: decoded.o };
}

function stableUrlIdentity(sourceUrl) {
  const digest = sha256(Buffer.from(sourceUrl, 'utf8'));
  return {
    digest,
    handle: `ecs-discovery-${digest}`
  };
}

function discoveryRecord(sourceUrl) {
  const identity = stableUrlIdentity(sourceUrl);
  return Object.freeze({
    handle: identity.handle,
    publicKey: identity.handle,
    key: `sha256:${identity.digest}`,
    sha256Key: identity.digest,
    supplier: Object.freeze({ slug: 'ecs', name: VENDOR }),
    sourceUrl,
    canonicalSourceUrl: sourceUrl,
    dataStatus: 'url_discovered',
    title: null,
    sku: null,
    mpn: null,
    brand: null,
    category: null,
    subcategory: null,
    price: null,
    pricing: 'request_price',
    stock: null,
    availability: 'check',
    image: null,
    images: null,
    fitment: null,
    fitments: null,
    purchaseMode: 'request_details',
    requestDetailsOnly: true,
    quoteOnly: true
  });
}

function reviewedSourceUrls(products) {
  const urls = new Set();
  for (const product of products || []) {
    if (!product?.originalUrl) continue;
    try { urls.add(canonicalizeEcsDiscoveryProductUrl(product.originalUrl)); } catch { /* ignore invalid legacy rows */ }
  }
  return urls;
}

export function createEcsDiscoveryCatalogueProvider({
  currentUrl,
  manifestSecret,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  currentCacheMs = DEFAULT_CURRENT_CACHE_MS,
  shardCacheEntries = DEFAULT_SHARD_CACHE_ENTRIES,
  reviewedProducts = REVIEWED_ECS_PRODUCTS
} = {}) {
  const parsedCurrentUrl = validateProviderOptions({
    currentUrl, manifestSecret, fetchImpl, timeoutMs, currentCacheMs, shardCacheEntries
  });
  const reviewedUrls = reviewedSourceUrls(reviewedProducts);
  let manifestCache = null;
  let manifestPromise = null;
  const shardCache = new Map();
  const shardPromises = new Map();

  function currentTime() {
    const value = Number(typeof now === 'function' ? now() : now);
    if (!Number.isFinite(value)) {
      fail(503, 'invalid_ecs_discovery_configuration', 'The ECS discovery clock is invalid.');
    }
    return value;
  }

  function clearShardCache() {
    shardCache.clear();
    shardPromises.clear();
  }

  async function fetchManifest() {
    const requestedAt = currentTime();
    const { value } = await requestJson(fetchImpl, currentUrl, {
      timeoutMs,
      maximumBytes: MAX_CURRENT_BYTES,
      code: 'invalid_ecs_discovery_manifest',
      label: 'The ECS discovery current manifest',
      cache: 'no-store'
    });
    validateCurrentManifest(value, parsedCurrentUrl, manifestSecret, currentTime());
    if (manifestCache?.manifest.releaseId !== value.releaseId) clearShardCache();
    const frozen = Object.freeze({
      ...value,
      counts: Object.freeze({ ...value.counts }),
      shards: Object.freeze(value.shards.map(item => Object.freeze({ ...item })))
    });
    manifestCache = { manifest: frozen, loadedAt: requestedAt };
    return frozen;
  }

  async function loadManifest() {
    const at = currentTime();
    if (manifestCache && at - manifestCache.loadedAt <= currentCacheMs) {
      validateCurrentManifest(manifestCache.manifest, parsedCurrentUrl, manifestSecret, at);
      return manifestCache.manifest;
    }
    if (!manifestPromise) {
      manifestPromise = fetchManifest().finally(() => { manifestPromise = null; });
    }
    return manifestPromise;
  }

  function rememberShard(cacheKey, entries) {
    shardCache.delete(cacheKey);
    shardCache.set(cacheKey, entries);
    while (shardCache.size > shardCacheEntries) {
      shardCache.delete(shardCache.keys().next().value);
    }
  }

  async function fetchShard(manifest, descriptor) {
    const { buffer, value } = await requestJson(fetchImpl, descriptor.url, {
      timeoutMs,
      maximumBytes: Math.min(descriptor.bytes, MAX_SHARD_BYTES),
      code: 'invalid_ecs_discovery_shard',
      label: `ECS discovery shard ${descriptor.sequence}`,
      cache: 'force-cache'
    });
    if (buffer.length !== descriptor.bytes || sha256(buffer) !== descriptor.sha256) {
      fail(503, 'invalid_ecs_discovery_shard', `ECS discovery shard ${descriptor.sequence} failed checksum validation.`);
    }
    return validateShard(value, descriptor);
  }

  async function loadShard(manifest, shardIndex) {
    if (!safeInteger(shardIndex, 0, manifest.shards.length - 1)) {
      fail(503, 'invalid_ecs_discovery_manifest', 'The ECS discovery shard position is invalid.');
    }
    const descriptor = manifest.shards[shardIndex];
    const cacheKey = `${manifest.releaseId}:${descriptor.sequence}:${descriptor.sha256}`;
    if (shardCache.has(cacheKey)) {
      const cached = shardCache.get(cacheKey);
      rememberShard(cacheKey, cached);
      return cached;
    }
    if (!shardPromises.has(cacheKey)) {
      shardPromises.set(cacheKey, fetchShard(manifest, descriptor)
        .then(entries => {
          rememberShard(cacheKey, entries);
          return entries;
        })
        .finally(() => shardPromises.delete(cacheKey)));
    }
    return shardPromises.get(cacheKey);
  }

  async function list({ cursor = null, limit = DEFAULT_PAGE_SIZE } = {}) {
    if (!safeInteger(limit, 1, MAX_PAGE_SIZE)) {
      fail(400, 'invalid_ecs_discovery_limit', `ECS discovery page size must be between 1 and ${MAX_PAGE_SIZE}.`);
    }
    const manifest = await loadManifest();
    const position = cursor
      ? decodeCursor(cursor, manifestSecret)
      : { releaseId: manifest.releaseId, shardIndex: 0, offset: 0 };
    if (position.releaseId !== manifest.releaseId) {
      fail(409, 'ecs_discovery_release_changed', 'The ECS discovery release changed; restart pagination.');
    }
    if (position.shardIndex > manifest.shards.length) {
      fail(400, 'invalid_ecs_discovery_cursor', 'The ECS discovery cursor position is invalid.');
    }

    let shardIndex = position.shardIndex;
    let offset = position.offset;
    const items = [];
    while (shardIndex < manifest.shards.length && items.length < limit) {
      const entries = await loadShard(manifest, shardIndex);
      if (offset > entries.length) {
        fail(400, 'invalid_ecs_discovery_cursor', 'The ECS discovery cursor offset is invalid.');
      }
      while (offset < entries.length && items.length < limit) {
        const sourceUrl = entries[offset];
        offset += 1;
        if (!reviewedUrls.has(sourceUrl)) items.push(discoveryRecord(sourceUrl));
      }
      if (offset >= entries.length) {
        shardIndex += 1;
        offset = 0;
      }
    }
    const nextCursor = shardIndex < manifest.shards.length
      ? encodeCursor({ releaseId: manifest.releaseId, shardIndex, offset }, manifestSecret)
      : null;
    return Object.freeze({
      releaseId: manifest.releaseId,
      items: Object.freeze(items),
      nextCursor,
      count: items.length,
      meta: Object.freeze({
        supplier: 'ecs',
        pricing: 'request_price',
        availability: 'check',
        dataStatus: 'url_discovered',
        discoveryOnly: true,
        discoveredUrlCount: manifest.counts.urlCount,
        shardCount: manifest.counts.shardCount,
        releaseId: manifest.releaseId
      })
    });
  }

  async function listByOffset({ offset = 0, limit = DEFAULT_PAGE_SIZE } = {}) {
    if (!safeInteger(offset, 0, MAX_TOTAL_URLS)) {
      fail(400, 'invalid_ecs_discovery_offset', 'The ECS catalogue position is invalid.');
    }
    if (!safeInteger(limit, 1, MAX_PAGE_SIZE)) {
      fail(400, 'invalid_ecs_discovery_limit', `ECS catalogue page size must be between 1 and ${MAX_PAGE_SIZE}.`);
    }
    const manifest = await loadManifest();
    if (offset >= manifest.counts.urlCount) {
      return Object.freeze({
        releaseId: manifest.releaseId,
        items: Object.freeze([]),
        nextOffset: null,
        count: 0,
        meta: Object.freeze({
          supplier: 'ecs',
          pricing: 'request_price',
          availability: 'check',
          dataStatus: 'url_discovered',
          discoveryOnly: false,
          discoveredUrlCount: manifest.counts.urlCount,
          shardCount: manifest.counts.shardCount,
          releaseId: manifest.releaseId
        })
      });
    }

    let shardIndex = 0;
    let shardOffset = offset;
    while (shardIndex < manifest.shards.length
      && shardOffset >= manifest.shards[shardIndex].urlCount) {
      shardOffset -= manifest.shards[shardIndex].urlCount;
      shardIndex += 1;
    }
    if (shardIndex >= manifest.shards.length) {
      fail(503, 'invalid_ecs_discovery_manifest', 'The ECS catalogue position exceeds its signed manifest.');
    }

    const items = [];
    while (shardIndex < manifest.shards.length && items.length < limit) {
      const entries = await loadShard(manifest, shardIndex);
      if (shardOffset > entries.length) {
        fail(503, 'invalid_ecs_discovery_manifest', 'The ECS catalogue shard position is invalid.');
      }
      while (shardOffset < entries.length && items.length < limit) {
        items.push(discoveryRecord(entries[shardOffset]));
        shardOffset += 1;
      }
      if (shardOffset >= entries.length) {
        shardIndex += 1;
        shardOffset = 0;
      }
    }
    const nextOffset = offset + items.length < manifest.counts.urlCount
      ? offset + items.length
      : null;
    return Object.freeze({
      releaseId: manifest.releaseId,
      items: Object.freeze(items),
      nextOffset,
      count: items.length,
      meta: Object.freeze({
        supplier: 'ecs',
        pricing: 'request_price',
        availability: 'check',
        dataStatus: 'url_discovered',
        discoveryOnly: false,
        discoveredUrlCount: manifest.counts.urlCount,
        shardCount: manifest.counts.shardCount,
        releaseId: manifest.releaseId
      })
    });
  }

  async function findByCanonicalUrl(canonicalUrl) {
    if (canonicalUrl && reviewedUrls.has(canonicalUrl)) return null;
    const manifest = await loadManifest();
    for (let shardIndex = 0; shardIndex < manifest.shards.length; shardIndex += 1) {
      const entries = await loadShard(manifest, shardIndex);
      for (const sourceUrl of entries) {
        if (sourceUrl === canonicalUrl) {
          if (reviewedUrls.has(sourceUrl)) return null;
          return discoveryRecord(sourceUrl);
        }
      }
    }
    return null;
  }

  async function getByCanonicalUrl(sourceUrl) {
    const canonical = canonicalizeEcsDiscoveryProductUrl(sourceUrl);
    if (canonical !== sourceUrl) {
      fail(400, 'invalid_ecs_product_url', 'Exact lookup requires the canonical ECS product URL.');
    }
    return findByCanonicalUrl(canonical);
  }

  async function getMeta() {
    const manifest = await loadManifest();
    return Object.freeze({
      releaseId: manifest.releaseId,
      discoveredUrlCount: manifest.counts.urlCount,
      shardCount: manifest.counts.shardCount
    });
  }

  function clearCache() {
    manifestCache = null;
    manifestPromise = null;
    clearShardCache();
  }

  return Object.freeze({ list, listByOffset, getByCanonicalUrl, getMeta, clearCache });
}

export function createConfiguredEcsDiscoveryCatalogueProvider({
  env = process.env,
  ...overrides
} = {}) {
  return createEcsDiscoveryCatalogueProvider({
    currentUrl: env?.[ECS_DISCOVERY_CURRENT_URL_ENV],
    manifestSecret: env?.[ECS_DISCOVERY_MANIFEST_SECRET_ENV],
    ...overrides
  });
}
