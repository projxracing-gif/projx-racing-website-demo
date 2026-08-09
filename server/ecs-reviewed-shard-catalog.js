import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectReviewedEcsProducts } from './ecs-reviewed-catalog.js';

export const ECS_REVIEWED_SHARD_CURRENT_URL_ENV = 'ECS_REVIEWED_SHARD_CURRENT_URL';
export const ECS_REVIEWED_SHARD_MANIFEST_SECRET_ENV = 'ECS_REVIEWED_SHARD_MANIFEST_SECRET';
export const ECS_REVIEWED_SHARD_LOCAL_MANIFEST = fileURLToPath(
  new URL('../api/data/ecs-bmw-m3-reviewed/manifest.json', import.meta.url)
);

const SCHEMA_VERSION = 1;
const MANIFEST_KIND = 'ecs-reviewed-product-shard-manifest';
const INDEX_KIND = 'ecs-reviewed-product-routing-index';
const SHARD_KIND = 'ecs-reviewed-product-shard';
const SHA256 = /^[a-f0-9]{64}$/;
const RELEASE_ID = /^\d{8}T\d{9}Z-[a-f0-9]{16}$/;
const SAFE_FILE = /^(?:index|shard-\d{5})\.json$/;
const PUBLIC_BLOB_HOST = /\.public\.blob\.vercel-storage\.com$/i;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_INDEX_BYTES = 64 * 1024 * 1024;
const MAX_SHARD_BYTES = 4 * 1024 * 1024;
const MAX_PRODUCTS = 50_000;
const MAX_SHARDS = 1_000;
const MAX_SHARDS_PER_REQUEST = 100;
const MAX_RELEASE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;

export class ReviewedShardProviderError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ReviewedShardProviderError';
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new ReviewedShardProviderError(status, code, message);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, expected) {
  if (!plainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function safeInteger(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function canonicalTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function validSecret(secret) {
  return typeof secret === 'string' && Buffer.byteLength(secret, 'utf8') >= 32
    && Buffer.byteLength(secret, 'utf8') <= 1_024;
}

function safeRemoteUrl(value, expectedHostname = null) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash
      || !PUBLIC_BLOB_HOST.test(hostname) || (expectedHostname && hostname !== expectedHostname)) return null;
    return url;
  } catch {
    return null;
  }
}

function canonicalManifestPayload(manifest) {
  const { signature, ...payload } = manifest;
  return JSON.stringify(payload);
}

export function signReviewedShardManifest(manifest, secret) {
  if (!validSecret(secret)) fail(500, 'invalid_reviewed_shard_secret', 'The reviewed shard manifest secret is invalid.');
  return createHmac('sha256', secret).update(canonicalManifestPayload(manifest), 'utf8').digest('hex');
}

export function verifyReviewedShardManifestSignature(manifest, secret) {
  if (!validSecret(secret) || !plainObject(manifest) || !/^[a-f0-9]{64}$/.test(manifest.signature || '')) return false;
  const expected = Buffer.from(signReviewedShardManifest(manifest, secret), 'hex');
  const actual = Buffer.from(manifest.signature, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function parseJson(buffer, code, label) {
  try {
    const value = JSON.parse(buffer.toString('utf8'));
    if (!plainObject(value)) throw new Error('not_object');
    return value;
  } catch {
    fail(503, code, `${label} is not valid JSON.`);
  }
}

async function readLocalBounded(filename, maximumBytes, reader) {
  let buffer;
  try {
    buffer = Buffer.from(await reader(filename));
  } catch {
    fail(503, 'reviewed_shard_unavailable', 'The bundled reviewed catalogue release could not be read.');
  }
  if (!buffer.length || buffer.length > maximumBytes) {
    fail(503, 'invalid_reviewed_shard_release', 'A bundled reviewed catalogue artifact exceeds its size limit.');
  }
  return buffer;
}

async function readRemoteBounded(fetchImpl, url, maximumBytes, timeoutMs, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, { cache: 'no-store', redirect: 'error', signal: controller.signal });
  } catch {
    fail(503, 'reviewed_shard_unavailable', `${label} could not be downloaded.`);
  } finally {
    clearTimeout(timeout);
  }
  if (!response?.ok) fail(503, 'reviewed_shard_unavailable', `${label} returned an invalid response.`);
  const contentType = String(response.headers?.get?.('content-type') || '');
  if (!/^(?:application\/(?:[a-z0-9.+-]*\+)?json|text\/json)(?:\s*;|$)/i.test(contentType)) {
    fail(503, 'invalid_reviewed_shard_release', `${label} did not return JSON.`);
  }
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    fail(503, 'invalid_reviewed_shard_release', `${label} exceeds its size limit.`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > maximumBytes) {
    fail(503, 'invalid_reviewed_shard_release', `${label} exceeds its size limit.`);
  }
  return buffer;
}

function validateSections(manifest, allowIncomplete) {
  const keys = ['braking', 'engine', 'exterior', 'interior', 'performance', 'suspension', 'steering'];
  if (!exactKeys(manifest.sections, keys)) fail(503, 'invalid_reviewed_shard_manifest', 'The reviewed shard section manifest is invalid.');
  for (const key of keys) {
    const section = manifest.sections[key];
    if (!exactKeys(section, [
      'complete', 'included', 'capturedPages', 'expectedPages', 'capturedPlacements',
      'expectedPlacements', 'productCount'
    ]) || typeof section.complete !== 'boolean' || typeof section.included !== 'boolean'
      || !['capturedPages', 'expectedPages', 'capturedPlacements', 'expectedPlacements', 'productCount']
        .every(field => safeInteger(section[field], 0, 100_000_000))
      || (section.included && !section.complete)) {
      fail(503, 'invalid_reviewed_shard_manifest', `The reviewed ${key} section state is invalid.`);
    }
  }
  const complete = keys.every(key => manifest.sections[key].complete && manifest.sections[key].included);
  if (manifest.complete !== complete || (!complete && !allowIncomplete)) {
    fail(503, 'incomplete_reviewed_shard_release', 'The reviewed catalogue release is incomplete and cannot be published in this environment.');
  }
  if (!complete && manifest.publicationMode !== 'verified-progress') {
    fail(503, 'invalid_reviewed_shard_manifest', 'An incomplete reviewed release must be explicitly marked verified-progress.');
  }
  if (complete && manifest.publicationMode !== 'complete') {
    fail(503, 'invalid_reviewed_shard_manifest', 'A complete reviewed release must be explicitly marked complete.');
  }
}

function validateManifest(manifest, { remote, secret, nowValue, allowIncomplete }) {
  const expectedKeys = [
    'schemaVersion', 'supplier', 'kind', 'releaseId', 'generatedAt', 'publicationMode', 'complete',
    'requestedSections', 'includedSections', 'excludedSections', 'sections', 'counts', 'index',
    'shards', 'contentSetSha256', ...(remote ? ['publishedAt', 'expiresAt', 'signature'] : [])
  ];
  if (!exactKeys(manifest, expectedKeys) || manifest.schemaVersion !== SCHEMA_VERSION
    || manifest.supplier !== 'ECS Tuning' || manifest.kind !== MANIFEST_KIND
    || !RELEASE_ID.test(manifest.releaseId) || !canonicalTimestamp(manifest.generatedAt)
    || typeof manifest.complete !== 'boolean' || !SHA256.test(manifest.contentSetSha256)
    || !Array.isArray(manifest.requestedSections) || !Array.isArray(manifest.includedSections)
    || !Array.isArray(manifest.excludedSections)
    || !exactKeys(manifest.counts, ['productCount', 'routeCount', 'shardCount', 'quarantinedIdentityCount'])
    || !safeInteger(manifest.counts.productCount, 1, MAX_PRODUCTS)
    || manifest.counts.routeCount !== manifest.counts.productCount
    || !safeInteger(manifest.counts.shardCount, 1, MAX_SHARDS)
    || !safeInteger(manifest.counts.quarantinedIdentityCount, 0, MAX_PRODUCTS)
    || !Array.isArray(manifest.shards) || manifest.shards.length !== manifest.counts.shardCount) {
    fail(503, 'invalid_reviewed_shard_manifest', 'The reviewed shard manifest has an invalid schema.');
  }
  validateSections(manifest, allowIncomplete);
  const requested = ['braking', 'engine', 'exterior', 'interior', 'performance', 'suspension', 'steering'];
  const included = requested.filter(key => manifest.sections[key].included);
  const excluded = requested.filter(key => !manifest.sections[key].included);
  if (JSON.stringify(manifest.requestedSections) !== JSON.stringify(requested)
    || JSON.stringify(manifest.includedSections) !== JSON.stringify(included)
    || JSON.stringify(manifest.excludedSections) !== JSON.stringify(excluded)) {
    fail(503, 'invalid_reviewed_shard_manifest', 'The reviewed shard section lists do not reconcile.');
  }
  if (remote) {
    const publishedAt = Date.parse(canonicalTimestamp(manifest.publishedAt) || '');
    const expiresAt = Date.parse(canonicalTimestamp(manifest.expiresAt) || '');
    if (!verifyReviewedShardManifestSignature(manifest, secret) || !Number.isFinite(publishedAt)
      || !Number.isFinite(expiresAt) || expiresAt <= publishedAt
      || expiresAt - publishedAt > MAX_RELEASE_LIFETIME_MS || publishedAt > nowValue + MAX_FUTURE_SKEW_MS
      || expiresAt <= nowValue || !manifest.complete) {
      fail(503, 'invalid_reviewed_shard_manifest', 'The remote reviewed shard manifest is unsigned, expired, incomplete or invalid.');
    }
  }
  const expectedDescriptor = remote
    ? ['sequence', 'url', 'productCount', 'bytes', 'sha256', 'firstKey', 'lastKey']
    : ['sequence', 'file', 'productCount', 'bytes', 'sha256', 'firstKey', 'lastKey'];
  const hostname = remote ? safeRemoteUrl(manifest.index?.url)?.hostname.toLowerCase() : null;
  const expectedIndex = remote ? ['url', 'bytes', 'sha256'] : ['file', 'bytes', 'sha256'];
  if (!exactKeys(manifest.index, expectedIndex) || !safeInteger(manifest.index.bytes, 1, MAX_INDEX_BYTES)
    || !SHA256.test(manifest.index.sha256)
    || (remote ? !safeRemoteUrl(manifest.index.url) : manifest.index.file !== 'index.json')) {
    fail(503, 'invalid_reviewed_shard_manifest', 'The reviewed routing index descriptor is invalid.');
  }
  let productCount = 0;
  manifest.shards.forEach((descriptor, index) => {
    if (!exactKeys(descriptor, expectedDescriptor) || descriptor.sequence !== index + 1
      || !safeInteger(descriptor.productCount, 1, 250) || !safeInteger(descriptor.bytes, 1, MAX_SHARD_BYTES)
      || !SHA256.test(descriptor.sha256) || !/^ecs-es-\d{3,12}$/.test(descriptor.firstKey)
      || !/^ecs-es-\d{3,12}$/.test(descriptor.lastKey)
      || (remote ? !safeRemoteUrl(descriptor.url, hostname) : !SAFE_FILE.test(descriptor.file))) {
      fail(503, 'invalid_reviewed_shard_manifest', `Reviewed product shard ${index + 1} has an invalid descriptor.`);
    }
    productCount += descriptor.productCount;
  });
  if (productCount !== manifest.counts.productCount) {
    fail(503, 'invalid_reviewed_shard_manifest', 'Reviewed shard product counts do not reconcile.');
  }
  const contentSetSha256 = sha256(Buffer.from([
    `index.json\0${manifest.index.bytes}\0${manifest.index.sha256}`,
    ...manifest.shards.map(descriptor => {
      const filename = remote ? new URL(descriptor.url).pathname.split('/').at(-1) : descriptor.file;
      return `${filename}\0${descriptor.bytes}\0${descriptor.sha256}`;
    })
  ].join('\n'), 'utf8'));
  if (contentSetSha256 !== manifest.contentSetSha256) {
    fail(503, 'invalid_reviewed_shard_manifest', 'The reviewed shard artifact-set checksum is invalid.');
  }
  return manifest;
}

function validateIndex(index, manifest) {
  if (!exactKeys(index, ['schemaVersion', 'supplier', 'kind', 'releaseId', 'routeCount', 'routes'])
    || index.schemaVersion !== SCHEMA_VERSION || index.supplier !== 'ECS Tuning'
    || index.kind !== INDEX_KIND || index.releaseId !== manifest.releaseId
    || index.routeCount !== manifest.counts.routeCount || !Array.isArray(index.routes)
    || index.routes.length !== index.routeCount) {
    fail(503, 'invalid_reviewed_shard_index', 'The reviewed product routing index is invalid.');
  }
  const keys = new Set();
  const positions = new Set();
  const positionCounts = new Map();
  const includedSections = new Set(manifest.includedSections);
  for (const route of index.routes) {
    const position = `${route?.shardSequence}:${route?.shardProductIndex}`;
    const routeSections = new Set([
      ...(route?.filters?.categories || []), ...(route?.filters?.subcategories || [])
    ].map(value => String(value).match(/^bmw-m3-(braking|engine|exterior|interior|performance|suspension|steering)(?:-|$)/)?.[1])
      .filter(Boolean));
    if (!plainObject(route) || route.shardedRoute !== true || !/^ecs-es-\d{3,12}$/.test(route.publicKey)
      || !/^es-\d{3,12}$/.test(route.slug) || !safeInteger(route.shardSequence, 1, manifest.shards.length)
      || !safeInteger(route.shardProductIndex, 0, 249) || keys.has(route.publicKey)
      || positions.has(position) || route.shardProductIndex >= manifest.shards[route.shardSequence - 1].productCount
      || !routeSections.size || [...routeSections].some(section => !includedSections.has(section))) {
      fail(503, 'invalid_reviewed_shard_index', 'The reviewed product routing index contains an invalid or duplicate route.');
    }
    keys.add(route.publicKey);
    positions.add(position);
    positionCounts.set(route.shardSequence, (positionCounts.get(route.shardSequence) || 0) + 1);
  }
  for (const descriptor of manifest.shards) {
    if (positionCounts.get(descriptor.sequence) !== descriptor.productCount) {
      fail(503, 'invalid_reviewed_shard_index', `The reviewed product routes for shard ${descriptor.sequence} do not reconcile.`);
    }
  }
  return Object.freeze(index.routes.map(route => Object.freeze(route)));
}

function validateShard(document, descriptor, manifest) {
  if (!exactKeys(document, ['schemaVersion', 'supplier', 'kind', 'releaseId', 'sequence', 'productCount', 'products'])
    || document.schemaVersion !== SCHEMA_VERSION || document.supplier !== 'ECS Tuning'
    || document.kind !== SHARD_KIND || document.releaseId !== manifest.releaseId
    || document.sequence !== descriptor.sequence || document.productCount !== descriptor.productCount
    || !Array.isArray(document.products) || document.products.length !== descriptor.productCount) {
    fail(503, 'invalid_reviewed_product_shard', `Reviewed product shard ${descriptor.sequence} is invalid.`);
  }
  const keys = new Set();
  for (const product of document.products) {
    if (!plainObject(product) || !/^ecs-es-\d{3,12}$/.test(product.publicKey)
      || !/^es-\d{3,12}$/.test(product.slug) || keys.has(product.publicKey)) {
      fail(503, 'invalid_reviewed_product_shard', `Reviewed product shard ${descriptor.sequence} contains an invalid product.`);
    }
    keys.add(product.publicKey);
  }
  if (document.products[0].publicKey !== descriptor.firstKey
    || document.products.at(-1).publicKey !== descriptor.lastKey) {
    fail(503, 'invalid_reviewed_product_shard', `Reviewed product shard ${descriptor.sequence} does not match its key bounds.`);
  }
  return Object.freeze(document.products.map(product => Object.freeze(product)));
}

function selectionRequest(request) {
  if (request.mode !== 'suggest') return request;
  return {
    ...request,
    sort: 'relevance', availability: 'all', pricing: 'all', fitment: 'all',
    structuredVehicle: Boolean(request.year || request.make || request.model || request.generation || request.engine)
  };
}

export function createReviewedShardCatalogueProvider({
  localManifestPath = null,
  currentUrl = null,
  manifestSecret = null,
  allowIncompleteLocal = true,
  fetchImpl = globalThis.fetch,
  readFileImpl = readFile,
  now = () => Date.now(),
  timeoutMs = 8_000,
  shardCacheEntries = 8
} = {}) {
  const remoteUrl = currentUrl ? safeRemoteUrl(currentUrl) : null;
  if (currentUrl && (!remoteUrl || !validSecret(manifestSecret))) {
    fail(500, 'invalid_reviewed_shard_configuration', 'The remote reviewed shard configuration is incomplete or invalid.');
  }
  if (!remoteUrl && !localManifestPath) {
    fail(500, 'invalid_reviewed_shard_configuration', 'A local or remote reviewed shard manifest is required.');
  }
  if (typeof fetchImpl !== 'function' || typeof readFileImpl !== 'function'
    || typeof now !== 'function' || !safeInteger(timeoutMs, 100, 60_000)
    || !safeInteger(shardCacheEntries, 1, 64)) {
    fail(500, 'invalid_reviewed_shard_configuration', 'The reviewed shard provider options are invalid.');
  }
  const remote = Boolean(remoteUrl);
  const localRoot = localManifestPath ? path.dirname(path.resolve(localManifestPath)) : null;
  let releasePromise = null;
  const shardCache = new Map();
  const shardPromises = new Map();
  let shardReadCount = 0;

  async function artifactBuffer(descriptor, maximumBytes, label) {
    const buffer = remote
      ? await readRemoteBounded(fetchImpl, descriptor.url, maximumBytes, timeoutMs, label)
      : await readLocalBounded(path.join(localRoot, descriptor.file), maximumBytes, readFileImpl);
    if (buffer.length !== descriptor.bytes || sha256(buffer) !== descriptor.sha256) {
      fail(503, 'reviewed_shard_checksum_mismatch', `${label} failed checksum validation.`);
    }
    return buffer;
  }

  async function loadRelease() {
    if (!releasePromise) {
      releasePromise = (async () => {
        const nowValue = Number(now());
        if (!Number.isFinite(nowValue)) fail(500, 'invalid_reviewed_shard_configuration', 'The reviewed shard clock is invalid.');
        const manifestBuffer = remote
          ? await readRemoteBounded(fetchImpl, remoteUrl, MAX_MANIFEST_BYTES, timeoutMs, 'The reviewed shard manifest')
          : await readLocalBounded(path.resolve(localManifestPath), MAX_MANIFEST_BYTES, readFileImpl);
        const manifest = validateManifest(
          parseJson(manifestBuffer, 'invalid_reviewed_shard_manifest', 'The reviewed shard manifest'),
          { remote, secret: manifestSecret, nowValue, allowIncomplete: remote ? false : allowIncompleteLocal }
        );
        const indexBuffer = await artifactBuffer(manifest.index, MAX_INDEX_BYTES, 'The reviewed product routing index');
        const routes = validateIndex(
          parseJson(indexBuffer, 'invalid_reviewed_shard_index', 'The reviewed product routing index'),
          manifest
        );
        return Object.freeze({ manifest: Object.freeze(manifest), routes });
      })();
    }
    return releasePromise;
  }

  function rememberShard(key, products) {
    shardCache.delete(key);
    shardCache.set(key, products);
    while (shardCache.size > shardCacheEntries) shardCache.delete(shardCache.keys().next().value);
  }

  async function loadShard(release, sequence) {
    const descriptor = release.manifest.shards[sequence - 1];
    if (!descriptor) fail(503, 'invalid_reviewed_shard_index', 'A reviewed product route points outside the release.');
    const key = `${release.manifest.releaseId}:${sequence}:${descriptor.sha256}`;
    if (shardCache.has(key)) {
      const products = shardCache.get(key);
      rememberShard(key, products);
      return products;
    }
    if (!shardPromises.has(key)) {
      shardPromises.set(key, (async () => {
        shardReadCount += 1;
        const buffer = await artifactBuffer(descriptor, MAX_SHARD_BYTES, `Reviewed product shard ${sequence}`);
        const products = validateShard(
          parseJson(buffer, 'invalid_reviewed_product_shard', `Reviewed product shard ${sequence}`),
          descriptor,
          release.manifest
        );
        rememberShard(key, products);
        return products;
      })().finally(() => shardPromises.delete(key)));
    }
    return shardPromises.get(key);
  }

  function statusFor(release, baseProducts, extraRoutes) {
    return Object.freeze({
      schemaVersion: 2,
      sourceRecordCounts: Object.freeze({
        staticReviewed: baseProducts.length,
        bmwM3Sharded: release.manifest.counts.productCount,
        bmwM3ShardedUnique: extraRoutes.length
      }),
      sourceRecordCount: baseProducts.length + release.manifest.counts.productCount,
      preQuarantineUniqueProductCount: baseProducts.length + extraRoutes.length,
      quarantinedIdentityCount: release.manifest.counts.quarantinedIdentityCount,
      publishedProductCount: baseProducts.length + extraRoutes.length,
      bmwM3AggregateNewUniqueProductCount: extraRoutes.length,
      bmwM3AggregateCaptureStatus: Object.freeze({
        stage: release.manifest.complete ? 'complete' : 'staging-progress',
        complete: release.manifest.complete,
        importPolicy: release.manifest.complete ? 'all-reconciled-sections' : 'reconciled-sections-only',
        requestedSectionCount: release.manifest.requestedSections.length,
        includedSectionCount: release.manifest.includedSections.length,
        includedSections: Object.freeze([...release.manifest.includedSections]),
        excludedSections: Object.freeze([...release.manifest.excludedSections])
      }),
      shardRelease: Object.freeze({
        releaseId: release.manifest.releaseId,
        source: remote ? 'signed-vercel-blob' : 'bundled-verified-progress',
        complete: release.manifest.complete,
        shardCount: release.manifest.counts.shardCount,
        routeCount: release.manifest.counts.routeCount
      })
    });
  }

  function uniqueRoutes(release, baseProducts) {
    const identities = new Set(baseProducts.flatMap(product => [product?.publicKey, product?.slug]).filter(Boolean));
    const ecsIdentities = new Set(baseProducts.flatMap(product => [product?.ecsPartNumber, product?.sku])
      .map(value => String(value || '').match(/^(?:ES\s*#?\s*)?(\d{3,12})$/i)?.[1]).filter(Boolean));
    return release.routes.filter(route => {
      const digits = String(route.ecsPartNumber || route.sku || '').match(/^(?:ES\s*#?\s*)?(\d{3,12})$/i)?.[1];
      return !identities.has(route.publicKey) && !identities.has(route.slug) && (!digits || !ecsIdentities.has(digits));
    });
  }

  async function hydrateRoutes(release, routes) {
    const sequences = [...new Set(routes.map(route => route.shardSequence))];
    if (sequences.length > MAX_SHARDS_PER_REQUEST) {
      fail(503, 'reviewed_shard_request_too_broad', 'The requested page spans too many reviewed product shards. Refine the filters and try again.');
    }
    const loaded = new Map();
    await Promise.all(sequences.map(async sequence => {
      const products = await loadShard(release, sequence);
      products.forEach((product, index) => loaded.set(`${sequence}:${index}`, product));
    }));
    const hydrated = new Map();
    for (const route of routes) {
      const product = loaded.get(`${route.shardSequence}:${route.shardProductIndex}`);
      if (!product || product.publicKey !== route.publicKey || product.slug !== route.slug) {
        fail(503, 'invalid_reviewed_product_shard', `The reviewed product payload for ${route.publicKey} does not match its route.`);
      }
      hydrated.set(route.publicKey, product);
    }
    return hydrated;
  }

  async function prepareProducts({ request, baseProducts, nowValue }) {
    if (!Array.isArray(baseProducts)) throw new TypeError('Reviewed shard baseProducts must be an array.');
    const release = await loadRelease();
    const extraRoutes = uniqueRoutes(release, baseProducts);
    const combined = [...baseProducts, ...extraRoutes];
    let selectedRoutes = [];
    if (request.mode === 'detail') {
      const route = extraRoutes.find(item => item.publicKey === request.handle || item.slug === request.handle);
      if (route) selectedRoutes = [route];
    } else {
      const selected = selectReviewedEcsProducts(combined, selectionRequest(request), nowValue);
      const limit = request.mode === 'suggest' ? 8 : 100;
      const offset = request.mode === 'suggest' ? 0 : request.offset;
      selectedRoutes = selected.slice(offset, offset + limit).filter(product => product.shardedRoute === true);
    }
    const hydrated = await hydrateRoutes(release, selectedRoutes);
    if (request.mode === 'detail' && hydrated.size) {
      const related = [...hydrated.values()].flatMap(product => product.relatedProductSlugs || []);
      const relatedRoutes = extraRoutes.filter(route => related.includes(route.slug) || related.includes(route.publicKey));
      const relatedHydrated = await hydrateRoutes(release, relatedRoutes);
      relatedHydrated.forEach((product, key) => hydrated.set(key, product));
    }
    const products = [...baseProducts, ...extraRoutes.map(route => hydrated.get(route.publicKey) || route)];
    return Object.freeze({
      products: Object.freeze(products),
      status: statusFor(release, baseProducts, extraRoutes),
      loadedShardCount: new Set(selectedRoutes.map(route => route.shardSequence)).size
    });
  }

  async function getStatus(baseProducts = []) {
    const release = await loadRelease();
    const extraRoutes = uniqueRoutes(release, baseProducts);
    return statusFor(release, baseProducts, extraRoutes);
  }

  function diagnostics() {
    return Object.freeze({ shardReadCount, cachedShardCount: shardCache.size, remote });
  }

  function clearCache() {
    releasePromise = null;
    shardCache.clear();
    shardPromises.clear();
    shardReadCount = 0;
  }

  return Object.freeze({ prepareProducts, getStatus, diagnostics, clearCache });
}

export function createConfiguredReviewedShardCatalogueProvider({ env = process.env, ...options } = {}) {
  const currentUrl = env?.[ECS_REVIEWED_SHARD_CURRENT_URL_ENV] || null;
  const manifestSecret = env?.[ECS_REVIEWED_SHARD_MANIFEST_SECRET_ENV] || null;
  return createReviewedShardCatalogueProvider({
    currentUrl,
    manifestSecret,
    localManifestPath: currentUrl ? null : ECS_REVIEWED_SHARD_LOCAL_MANIFEST,
    allowIncompleteLocal: true,
    ...options
  });
}
