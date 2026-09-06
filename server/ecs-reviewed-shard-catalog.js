import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { mergeReviewedEcsProducts, selectReviewedEcsProducts } from './ecs-reviewed-catalog.js';
import {
  ECS_F8X_OVERLAY_SCOPE,
  validateCanonicalEcsF8xOverlayProduct
} from './ecs-f8x-overlay-contract.js';

export const ECS_REVIEWED_SHARD_CURRENT_URL_ENV = 'ECS_REVIEWED_SHARD_CURRENT_URL';
export const ECS_REVIEWED_SHARD_MANIFEST_SECRET_ENV = 'ECS_REVIEWED_SHARD_MANIFEST_SECRET';
export const ECS_REVIEWED_F8X_OVERLAY_CURRENT_URL_ENV = 'ECS_REVIEWED_F8X_OVERLAY_CURRENT_URL';
export const ECS_REVIEWED_F8X_OVERLAY_MANIFEST_SECRET_ENV = 'ECS_REVIEWED_F8X_OVERLAY_MANIFEST_SECRET';
export const ECS_REVIEWED_SHARD_LOCAL_MANIFEST = fileURLToPath(
  new URL('../api/data/ecs-bmw-m3-reviewed/manifest.json', import.meta.url)
);
export const ECS_REVIEWED_F8X_OVERLAY_LOCAL_MANIFEST = fileURLToPath(
  new URL('../api/data/ecs-f8x-reviewed/manifest.json', import.meta.url)
);
const ECS_REVIEWED_F8X_OVERLAY_LOCAL_ROOT = path.dirname(ECS_REVIEWED_F8X_OVERLAY_LOCAL_MANIFEST);

async function readBundledReviewedShardArtifact(filename, reader = readFile) {
  const resolved = path.resolve(filename);
  const relative = path.relative(ECS_REVIEWED_F8X_OVERLAY_LOCAL_ROOT, resolved).replaceAll('\\', '/');
  const bundledOverlayArtifact = relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    && /^(?:index|shard-\d{5})\.json$/u.test(relative);
  if (!bundledOverlayArtifact) return reader(resolved);

  const maximumBytes = relative === 'index.json' ? MAX_INDEX_BYTES : MAX_SHARD_BYTES;
  const compressed = Buffer.from(await reader(`${resolved}.gz`));
  if (!compressed.length || compressed.length > maximumBytes + 65_536) {
    throw new Error('The bundled reviewed F8X overlay gzip artifact exceeds its size limit.');
  }
  return gunzipSync(compressed, { maxOutputLength: maximumBytes });
}

const SCHEMA_VERSION = 1;
const MANIFEST_KIND = 'ecs-reviewed-product-shard-manifest';
const INDEX_KIND = 'ecs-reviewed-product-routing-index';
const SHARD_KIND = 'ecs-reviewed-product-shard';
export const ECS_REVIEWED_F8X_OVERLAY_MANIFEST_KIND = 'ecs-reviewed-f8x-overlay-shard-manifest';
export const ECS_REVIEWED_F8X_OVERLAY_INDEX_KIND = 'ecs-reviewed-f8x-overlay-routing-index';
export const ECS_REVIEWED_F8X_OVERLAY_SHARD_KIND = 'ecs-reviewed-f8x-overlay-product-shard';
export const ECS_REVIEWED_F8X_OVERLAY_SCOPE = ECS_F8X_OVERLAY_SCOPE;
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

function stableJson(value) {
  const seen = new Set();
  function normalize(item) {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) fail(503, 'invalid_reviewed_shard_release', 'Reviewed shard data contains a non-finite number.');
      return item;
    }
    if (Array.isArray(item)) return item.map(entry => normalize(entry === undefined ? null : entry));
    if (plainObject(item)) {
      if (seen.has(item)) fail(503, 'invalid_reviewed_shard_release', 'Reviewed shard data contains a circular value.');
      seen.add(item);
      const result = {};
      for (const key of Object.keys(item).sort()) {
        const entry = item[key];
        if (entry !== undefined && typeof entry !== 'function' && typeof entry !== 'symbol') {
          result[key] = normalize(entry);
        }
      }
      seen.delete(item);
      return result;
    }
    fail(503, 'invalid_reviewed_shard_release', 'Reviewed shard data is not JSON-compatible.');
  }
  return JSON.stringify(normalize(value));
}

function dataSha256(value) {
  return sha256(Buffer.from(stableJson(value), 'utf8'));
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function immutableSnapshot(value, seen = new Map()) {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const result = [];
    seen.set(value, result);
    value.forEach(entry => result.push(immutableSnapshot(entry, seen)));
    return Object.freeze(result);
  }
  const result = {};
  seen.set(value, result);
  for (const [key, entry] of Object.entries(value)) result[key] = immutableSnapshot(entry, seen);
  return Object.freeze(result);
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
    ].map(value => String(value).match(/^bmw-(?:m3|f8x|f80|f82|f83)-(braking|engine|exterior|interior|performance|suspension|steering)(?:-|$)/)?.[1])
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

function artifactFilename(value) {
  try {
    return new URL(value).pathname.split('/').at(-1) || '';
  } catch {
    return '';
  }
}

function validateF8xOverlayScope(scope) {
  if (!exactKeys(scope, ['kind', 'profiles', 'chassis', 'sections', 'complete'])
    || scope.kind !== ECS_REVIEWED_F8X_OVERLAY_SCOPE.kind
    || scope.complete !== true
    || JSON.stringify(scope.profiles) !== JSON.stringify(ECS_REVIEWED_F8X_OVERLAY_SCOPE.profiles)
    || JSON.stringify(scope.chassis) !== JSON.stringify(ECS_REVIEWED_F8X_OVERLAY_SCOPE.chassis)
    || JSON.stringify(scope.sections) !== JSON.stringify(ECS_REVIEWED_F8X_OVERLAY_SCOPE.sections)) {
    fail(503, 'invalid_f8x_overlay_manifest', 'The reviewed F8X overlay scope is invalid or incomplete.');
  }
}

function validateF8xOverlayManifest(manifest, { remote, secret, nowValue }) {
  const expectedKeys = [
    'schemaVersion', 'supplier', 'kind', 'releaseId', 'generatedAt', 'publicationMode', 'complete',
    'overlayScope', 'baseRelease', 'finalAudit', 'projectedQuarantine', 'counts', 'index', 'shards',
    'contentSetSha256', ...(remote ? ['publishedAt', 'expiresAt', 'signature'] : [])
  ];
  const baseKeys = [
    'releaseId', 'manifestSha256', 'contentSetSha256', 'artifactSetSha256',
    'productCount', 'routeCount', 'shardCount', 'quarantinedIdentityCount', 'productsSha256'
  ];
  if (!exactKeys(manifest, expectedKeys) || manifest.schemaVersion !== SCHEMA_VERSION
    || manifest.supplier !== 'ECS Tuning' || manifest.kind !== ECS_REVIEWED_F8X_OVERLAY_MANIFEST_KIND
    || !RELEASE_ID.test(manifest.releaseId || '') || !canonicalTimestamp(manifest.generatedAt)
    || manifest.publicationMode !== 'complete' || manifest.complete !== true
    || !exactKeys(manifest.baseRelease, baseKeys)
    || !RELEASE_ID.test(manifest.baseRelease.releaseId || '')
    || !['manifestSha256', 'contentSetSha256', 'artifactSetSha256', 'productsSha256']
      .every(field => SHA256.test(manifest.baseRelease[field] || ''))
    || !safeInteger(manifest.baseRelease.productCount, 1, MAX_PRODUCTS)
    || manifest.baseRelease.routeCount !== manifest.baseRelease.productCount
    || !safeInteger(manifest.baseRelease.shardCount, 1, MAX_SHARDS)
    || !safeInteger(manifest.baseRelease.quarantinedIdentityCount, 0, MAX_PRODUCTS)
    || !exactKeys(manifest.finalAudit, ['kind', 'inputSetSha256', 'aggregateModuleSha256'])
    || manifest.finalAudit.kind !== 'ecs-f8x-final-release-audit-verification'
    || !SHA256.test(manifest.finalAudit.inputSetSha256 || '')
    || !SHA256.test(manifest.finalAudit.aggregateModuleSha256 || '')
    || !exactKeys(manifest.projectedQuarantine, ['identities', 'identityCount', 'identitiesSha256'])
    || !Array.isArray(manifest.projectedQuarantine.identities)
    || !safeInteger(manifest.projectedQuarantine.identityCount, 0, MAX_PRODUCTS)
    || !SHA256.test(manifest.projectedQuarantine.identitiesSha256 || '')
    || !exactKeys(manifest.counts, ['productCount', 'routeCount', 'shardCount', 'quarantinedIdentityCount'])
    || !safeInteger(manifest.counts.productCount, 1, MAX_PRODUCTS)
    || manifest.counts.routeCount !== manifest.counts.productCount
    || !safeInteger(manifest.counts.shardCount, 1, MAX_SHARDS)
    || manifest.counts.quarantinedIdentityCount !== manifest.projectedQuarantine.identityCount
    || manifest.projectedQuarantine.identityCount < manifest.baseRelease.quarantinedIdentityCount
    || !Array.isArray(manifest.shards) || manifest.shards.length !== manifest.counts.shardCount
    || !SHA256.test(manifest.contentSetSha256 || '')) {
    fail(503, 'invalid_f8x_overlay_manifest', 'The reviewed F8X overlay manifest has an invalid schema or binding.');
  }
  const quarantineIdentities = manifest.projectedQuarantine.identities;
  if (quarantineIdentities.length !== manifest.projectedQuarantine.identityCount
    || quarantineIdentities.some(value => typeof value !== 'string' || !/^\d{3,12}$/.test(value))
    || new Set(quarantineIdentities).size !== quarantineIdentities.length
    || JSON.stringify(quarantineIdentities) !== JSON.stringify([...quarantineIdentities].sort())
    || dataSha256(quarantineIdentities) !== manifest.projectedQuarantine.identitiesSha256) {
    fail(503, 'invalid_f8x_overlay_quarantine', 'The reviewed F8X overlay projected quarantine is stale or invalid.');
  }
  validateF8xOverlayScope(manifest.overlayScope);
  if (remote) {
    const publishedAt = Date.parse(canonicalTimestamp(manifest.publishedAt) || '');
    const expiresAt = Date.parse(canonicalTimestamp(manifest.expiresAt) || '');
    if (!verifyReviewedShardManifestSignature(manifest, secret) || !Number.isFinite(publishedAt)
      || !Number.isFinite(expiresAt) || expiresAt <= publishedAt
      || expiresAt - publishedAt > MAX_RELEASE_LIFETIME_MS || publishedAt > nowValue + MAX_FUTURE_SKEW_MS
      || expiresAt <= nowValue) {
      fail(503, 'invalid_f8x_overlay_manifest', 'The remote reviewed F8X overlay manifest is unsigned, expired or invalid.');
    }
  }
  const expectedIndex = remote ? ['url', 'bytes', 'sha256'] : ['file', 'bytes', 'sha256'];
  const expectedDescriptor = remote
    ? ['sequence', 'url', 'productCount', 'bytes', 'sha256', 'firstKey', 'lastKey']
    : ['sequence', 'file', 'productCount', 'bytes', 'sha256', 'firstKey', 'lastKey'];
  const indexFile = remote ? artifactFilename(manifest.index?.url) : manifest.index?.file;
  const hostname = remote ? safeRemoteUrl(manifest.index?.url)?.hostname.toLowerCase() : null;
  if (!exactKeys(manifest.index, expectedIndex) || indexFile !== 'index.json'
    || !safeInteger(manifest.index.bytes, 1, MAX_INDEX_BYTES) || !SHA256.test(manifest.index.sha256 || '')
    || (remote ? !safeRemoteUrl(manifest.index.url) : manifest.index.file !== 'index.json')) {
    fail(503, 'invalid_f8x_overlay_manifest', 'The reviewed F8X overlay routing-index descriptor is invalid.');
  }
  const filenames = new Set(['index.json']);
  let productCount = 0;
  manifest.shards.forEach((descriptor, index) => {
    const filename = remote ? artifactFilename(descriptor?.url) : descriptor?.file;
    if (!exactKeys(descriptor, expectedDescriptor) || descriptor.sequence !== index + 1
      || !safeInteger(descriptor.productCount, 1, 250) || !safeInteger(descriptor.bytes, 1, MAX_SHARD_BYTES)
      || !SHA256.test(descriptor.sha256 || '') || !/^ecs-es-\d{3,12}$/.test(descriptor.firstKey || '')
      || !/^ecs-es-\d{3,12}$/.test(descriptor.lastKey || '') || !SAFE_FILE.test(filename)
      || filenames.has(filename)
      || (remote ? !safeRemoteUrl(descriptor.url, hostname) : descriptor.file !== filename)) {
      fail(503, 'invalid_f8x_overlay_manifest', `Reviewed F8X overlay shard ${index + 1} has an invalid descriptor.`);
    }
    filenames.add(filename);
    productCount += descriptor.productCount;
  });
  if (productCount !== manifest.counts.productCount) {
    fail(503, 'invalid_f8x_overlay_manifest', 'Reviewed F8X overlay product counts do not reconcile.');
  }
  const contentSetSha256 = sha256(Buffer.from([
    `index.json\0${manifest.index.bytes}\0${manifest.index.sha256}`,
    ...manifest.shards.map(descriptor => {
      const filename = remote ? artifactFilename(descriptor.url) : descriptor.file;
      return `${filename}\0${descriptor.bytes}\0${descriptor.sha256}`;
    })
  ].join('\n'), 'utf8'));
  if (contentSetSha256 !== manifest.contentSetSha256) {
    fail(503, 'invalid_f8x_overlay_manifest', 'The reviewed F8X overlay artifact-set checksum is invalid.');
  }
  return manifest;
}

function validateF8xOverlayProductEvidence(product, label, { compact = false } = {}) {
  try {
    return validateCanonicalEcsF8xOverlayProduct(product, { compact, label });
  } catch (error) {
    fail(
      503,
      'invalid_f8x_overlay_scope',
      error instanceof Error
        ? error.message
        : `${label} contains invalid canonical F8X overlay evidence.`
    );
  }
}

function validateF8xOverlayIndex(index, manifest) {
  if (!exactKeys(index, ['schemaVersion', 'supplier', 'kind', 'releaseId', 'routeCount', 'routes'])
    || index.schemaVersion !== SCHEMA_VERSION || index.supplier !== 'ECS Tuning'
    || index.kind !== ECS_REVIEWED_F8X_OVERLAY_INDEX_KIND || index.releaseId !== manifest.releaseId
    || index.routeCount !== manifest.counts.routeCount || !Array.isArray(index.routes)
    || index.routes.length !== index.routeCount) {
    fail(503, 'invalid_f8x_overlay_index', 'The reviewed F8X overlay routing index is invalid.');
  }
  const identities = new Set();
  const positions = new Set();
  const positionCounts = new Map();
  for (const route of index.routes) {
    const { identity } = validateF8xOverlayProductEvidence(
      route,
      'The reviewed F8X overlay route',
      { compact: true }
    );
    const position = `${route?.shardSequence}:${route?.shardProductIndex}`;
    if (route.shardedRoute !== true || identities.has(identity)
      || route.publicKey !== `ecs-es-${identity}` || route.slug !== `es-${identity}`
      || !safeInteger(route.shardSequence, 1, manifest.shards.length)
      || !safeInteger(route.shardProductIndex, 0, 249) || positions.has(position)
      || route.shardProductIndex >= manifest.shards[route.shardSequence - 1].productCount) {
      fail(503, 'invalid_f8x_overlay_index', 'The reviewed F8X overlay index contains an invalid or duplicate route.');
    }
    identities.add(identity);
    positions.add(position);
    positionCounts.set(route.shardSequence, (positionCounts.get(route.shardSequence) || 0) + 1);
  }
  for (const descriptor of manifest.shards) {
    if (positionCounts.get(descriptor.sequence) !== descriptor.productCount) {
      fail(503, 'invalid_f8x_overlay_index', `The reviewed F8X overlay routes for shard ${descriptor.sequence} do not reconcile.`);
    }
  }
  return Object.freeze(index.routes.map(route => Object.freeze(route)));
}

function validateF8xOverlayShard(document, descriptor, manifest) {
  if (!exactKeys(document, ['schemaVersion', 'supplier', 'kind', 'releaseId', 'sequence', 'productCount', 'products'])
    || document.schemaVersion !== SCHEMA_VERSION || document.supplier !== 'ECS Tuning'
    || document.kind !== ECS_REVIEWED_F8X_OVERLAY_SHARD_KIND || document.releaseId !== manifest.releaseId
    || document.sequence !== descriptor.sequence || document.productCount !== descriptor.productCount
    || !Array.isArray(document.products) || document.products.length !== descriptor.productCount) {
    fail(503, 'invalid_f8x_overlay_shard', `Reviewed F8X overlay shard ${descriptor.sequence} is invalid.`);
  }
  const identities = new Set();
  for (const product of document.products) {
    const { identity } = validateF8xOverlayProductEvidence(
      product,
      `Reviewed F8X overlay shard ${descriptor.sequence}`
    );
    if (identities.has(identity)
      || product.publicKey !== `ecs-es-${identity}` || product.slug !== `es-${identity}`) {
      fail(503, 'invalid_f8x_overlay_shard', `Reviewed F8X overlay shard ${descriptor.sequence} contains an invalid product.`);
    }
    identities.add(identity);
  }
  if (document.products[0].publicKey !== descriptor.firstKey
    || document.products.at(-1).publicKey !== descriptor.lastKey) {
    fail(503, 'invalid_f8x_overlay_shard', `Reviewed F8X overlay shard ${descriptor.sequence} does not match its key bounds.`);
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

function hasStructuredFitmentEvidence(fitment) {
  return Boolean(fitment?.generation || fitment?.yearFrom || fitment?.yearTo
    || fitment?.chassis?.length || fitment?.engines?.length || fitment?.drivetrains?.length);
}

function overlayEvidence(existing, addition) {
  const overlay = { ...addition };
  for (const field of [
    'category', 'categoryAr', 'categorySlug',
    'subcategory', 'subcategoryAr', 'subcategorySlug'
  ]) {
    if (Object.hasOwn(existing || {}, field)) overlay[field] = existing[field];
  }
  if (Array.isArray(addition?.fitments)) {
    // The old model-wide shards contain intentionally broad BMW M3 placeholders.
    // They were never added to overlapping curated records. Preserve that legacy
    // behavior while allowing a new overlay's chassis/engine/year evidence through.
    overlay.fitments = addition.fitments.filter(hasStructuredFitmentEvidence);
  }
  return overlay;
}

const F8X_FITMENT_CONFIRMATION_NOTE = 'Fitment confirmation required before order.';
const F8X_FITMENT_CONFIRMATION_NOTE_AR = '\u064a\u062c\u0628 \u062a\u0623\u0643\u064a\u062f \u062a\u0648\u0627\u0641\u0642 \u0627\u0644\u0642\u0637\u0639\u0629 \u0645\u0639 \u0627\u0644\u0633\u064a\u0627\u0631\u0629 \u0642\u0628\u0644 \u0627\u0644\u0637\u0644\u0628.';

function sameF8xProfileFitment(fitment, canonicalFitment) {
  if (!fitment || !canonicalFitment) return false;
  if (fitment.generation === canonicalFitment.generation) return true;
  const chassis = new Set(Array.isArray(canonicalFitment.chassis) ? canonicalFitment.chassis : []);
  return Array.isArray(fitment.chassis) && fitment.chassis.some(value => chassis.has(value));
}

function canonicalPossibleF8xFitment(fitment) {
  return {
    make: fitment.make,
    model: fitment.model,
    models: [...fitment.models],
    trim: null,
    generation: fitment.generation,
    chassis: [...fitment.chassis],
    yearFrom: null,
    yearTo: null,
    engines: [...fitment.engines],
    drivetrains: [],
    options: [],
    confidence: 'possible',
    evidence: 'ecs-exact-f8x-vehicle-category',
    note: F8X_FITMENT_CONFIRMATION_NOTE,
    noteAr: F8X_FITMENT_CONFIRMATION_NOTE_AR
  };
}

function scrubAvailabilityObservations(observations) {
  if (!Array.isArray(observations)) return observations;
  return observations.map(observation => {
    if (!plainObject(observation)) return observation;
    const result = { ...observation };
    for (const field of ['availability', 'availabilityText', 'observedAvailability', 'stockStatus']) {
      delete result[field];
    }
    return result;
  });
}

function enforceF8xManualConfirmation(product, canonicalProduct = product) {
  const result = { ...product };
  result.fitmentStatus = 'supplier-vehicle-category-confirm';
  result.fitmentConfidence = 'possible';
  result.stockPolicy = 'manual-confirm';
  result.availabilityCode = 'check_availability';
  result.purchaseMode = 'fitment-confirmation-required';
  result.status = 'Supplier status \u2014 confirmation required';
  result.statusAr = '\u062d\u0627\u0644\u0629 \u0627\u0644\u0645\u0648\u0631\u062f \u2014 \u064a\u0644\u0632\u0645 \u0627\u0644\u062a\u0623\u0643\u064a\u062f';
  result.observedAvailability = null;
  result.observedAvailabilityAr = null;
  result.availabilityNote = 'Availability confirmation required. No live stock promise is published.';
  result.availabilityNoteAr = '\u064a\u0644\u0632\u0645 \u062a\u0623\u0643\u064a\u062f \u0627\u0644\u062a\u0648\u0641\u0631. \u0644\u0627 \u064a\u0648\u062c\u062f \u0648\u0639\u062f \u0645\u0646\u0634\u0648\u0631 \u0628\u0627\u0644\u0645\u062e\u0632\u0648\u0646 \u0627\u0644\u0645\u0628\u0627\u0634\u0631.';
  result.stockNote = result.availabilityNote;
  result.stockNoteAr = result.availabilityNoteAr;
  for (const field of ['availabilityText', 'stockStatus', 'stockQuantity', 'availableQuantity', 'inStock']) {
    delete result[field];
  }
  result.sourceObservations = scrubAvailabilityObservations(result.sourceObservations);
  result.filters = {
    ...(plainObject(result.filters) ? result.filters : {}),
    availability: ['confirmation-required'],
    fitment: ['possible']
  };
  const canonicalFitments = Array.isArray(canonicalProduct?.fitments)
    ? canonicalProduct.fitments
    : [];
  if (Array.isArray(result.fitments)) {
    const unrelated = result.fitments.filter(fitment => !canonicalFitments.some(canonicalFitment => (
      sameF8xProfileFitment(fitment, canonicalFitment)
    ))).map(fitment => ({
      ...fitment,
      confidence: 'possible',
      note: F8X_FITMENT_CONFIRMATION_NOTE,
      noteAr: F8X_FITMENT_CONFIRMATION_NOTE_AR
    }));
    result.fitments = [
      ...unrelated,
      ...canonicalFitments.map(canonicalPossibleF8xFitment)
    ];
  }
  return result;
}

function f8xManualConfirmationEvidence(existing, addition) {
  return enforceF8xManualConfirmation(overlayEvidence(existing, addition), addition);
}

function localManifestBufferForBinding(manifest, manifestBuffer, remote) {
  if (!remote) return manifestBuffer;
  const { publishedAt, expiresAt, signature, ...local } = manifest;
  local.index = {
    file: artifactFilename(manifest.index.url),
    bytes: manifest.index.bytes,
    sha256: manifest.index.sha256
  };
  local.shards = manifest.shards.map(descriptor => ({
    sequence: descriptor.sequence,
    file: artifactFilename(descriptor.url),
    productCount: descriptor.productCount,
    bytes: descriptor.bytes,
    sha256: descriptor.sha256,
    firstKey: descriptor.firstKey,
    lastKey: descriptor.lastKey
  }));
  return Buffer.from(`${JSON.stringify(local, null, 2)}\n`, 'utf8');
}

export function createReviewedShardCatalogueProvider({
  localManifestPath = null,
  currentUrl = null,
  manifestSecret = null,
  f8xOverlay = null,
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
  if (f8xOverlay !== null && !plainObject(f8xOverlay)) {
    fail(500, 'invalid_f8x_overlay_configuration', 'The reviewed F8X overlay configuration is invalid.');
  }
  const overlayCurrentUrlValue = f8xOverlay?.currentUrl || null;
  const overlayLocalManifestPath = f8xOverlay?.localManifestPath || null;
  const overlayManifestSecret = f8xOverlay?.manifestSecret || null;
  const overlayRemoteUrl = overlayCurrentUrlValue ? safeRemoteUrl(overlayCurrentUrlValue) : null;
  const overlayConfigured = Boolean(overlayCurrentUrlValue || overlayLocalManifestPath);
  if ((f8xOverlay
      && (!overlayConfigured || Boolean(overlayCurrentUrlValue) === Boolean(overlayLocalManifestPath)))
    || (overlayCurrentUrlValue && (!overlayRemoteUrl || !validSecret(overlayManifestSecret)))) {
    fail(500, 'invalid_f8x_overlay_configuration', 'The reviewed F8X overlay requires exactly one valid local or signed remote manifest.');
  }
  const remote = Boolean(remoteUrl);
  const localRoot = localManifestPath ? path.dirname(path.resolve(localManifestPath)) : null;
  const overlayRemote = Boolean(overlayRemoteUrl);
  const overlayLocalRoot = overlayLocalManifestPath
    ? path.dirname(path.resolve(overlayLocalManifestPath)) : null;
  let releasePromise = null;
  let releaseExpiresAt = null;
  let baseBindingPromise = null;
  let overlayReleasePromise = null;
  let overlayReleaseExpiresAt = null;
  let routePlanCache = new WeakMap();
  let f8xRuntimePlanCache = new WeakMap();
  const shardCache = new Map();
  const shardPromises = new Map();
  const overlayShardCache = new Map();
  const overlayShardPromises = new Map();
  let shardReadCount = 0;
  let overlayShardReadCount = 0;

  function currentTime(code, label) {
    const value = Number(now());
    if (!Number.isFinite(value)) fail(500, code, `${label} clock is invalid.`);
    return value;
  }

  function resetOverlayReleaseCache(expectedPromise = null) {
    if (expectedPromise && overlayReleasePromise !== expectedPromise) return;
    overlayReleasePromise = null;
    overlayReleaseExpiresAt = null;
    f8xRuntimePlanCache = new WeakMap();
    overlayShardCache.clear();
    overlayShardPromises.clear();
  }

  function resetBaseBindingCache(expectedPromise = null) {
    if (expectedPromise && baseBindingPromise !== expectedPromise) return;
    baseBindingPromise = null;
    f8xRuntimePlanCache = new WeakMap();
    resetOverlayReleaseCache();
  }

  function resetBaseReleaseCache(expectedPromise = null) {
    if (expectedPromise && releasePromise !== expectedPromise) return;
    releasePromise = null;
    releaseExpiresAt = null;
    baseBindingPromise = null;
    routePlanCache = new WeakMap();
    f8xRuntimePlanCache = new WeakMap();
    shardCache.clear();
    shardPromises.clear();
    resetOverlayReleaseCache();
  }

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
    const requestedAt = currentTime(
      'invalid_reviewed_shard_configuration',
      'The reviewed shard'
    );
    if (remote && releaseExpiresAt !== null && releaseExpiresAt <= requestedAt) {
      resetBaseReleaseCache();
    }
    if (!releasePromise) {
      const promise = (async () => {
        const manifestBuffer = remote
          ? await readRemoteBounded(fetchImpl, remoteUrl, MAX_MANIFEST_BYTES, timeoutMs, 'The reviewed shard manifest')
          : await readLocalBounded(path.resolve(localManifestPath), MAX_MANIFEST_BYTES, readFileImpl);
        const nowValue = remote
          ? currentTime('invalid_reviewed_shard_configuration', 'The reviewed shard')
          : requestedAt;
        const manifest = validateManifest(
          parseJson(manifestBuffer, 'invalid_reviewed_shard_manifest', 'The reviewed shard manifest'),
          { remote, secret: manifestSecret, nowValue, allowIncomplete: remote ? false : allowIncompleteLocal }
        );
        releaseExpiresAt = remote ? Date.parse(manifest.expiresAt) : null;
        const indexBuffer = await artifactBuffer(manifest.index, MAX_INDEX_BYTES, 'The reviewed product routing index');
        const routes = validateIndex(
          parseJson(indexBuffer, 'invalid_reviewed_shard_index', 'The reviewed product routing index'),
          manifest
        );
        return Object.freeze({
          manifest: Object.freeze(manifest),
          routes,
          manifestBuffer,
          bindingManifestBuffer: localManifestBufferForBinding(manifest, manifestBuffer, remote)
        });
      })();
      releasePromise = promise;
      promise.catch(() => resetBaseReleaseCache(promise));
    }
    const promise = releasePromise;
    const release = await promise;
    if (remote && Date.parse(release.manifest.expiresAt) <= currentTime(
      'invalid_reviewed_shard_configuration',
      'The reviewed shard'
    )) {
      resetBaseReleaseCache(promise);
      fail(503, 'invalid_reviewed_shard_manifest', 'The remote reviewed shard manifest is expired.');
    }
    return release;
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

  async function loadBaseBinding(release) {
    if (!baseBindingPromise) {
      const promise = (async () => {
        const productsByShard = await Promise.all(release.manifest.shards.map(descriptor => (
          loadShard(release, descriptor.sequence)
        )));
        const products = productsByShard.flat();
        for (const route of release.routes) {
          const product = productsByShard[route.shardSequence - 1]?.[route.shardProductIndex];
          if (!product || product.publicKey !== route.publicKey || product.slug !== route.slug) {
            fail(503, 'invalid_reviewed_product_shard', 'A reviewed base product does not match its public route.');
          }
        }
        const descriptors = [
          {
            file: 'manifest.json',
            bytes: release.bindingManifestBuffer.length,
            sha256: sha256(release.bindingManifestBuffer)
          },
          { file: 'index.json', bytes: release.manifest.index.bytes, sha256: release.manifest.index.sha256 },
          ...release.manifest.shards.map(descriptor => ({
            file: remote ? artifactFilename(descriptor.url) : descriptor.file,
            bytes: descriptor.bytes,
            sha256: descriptor.sha256
          }))
        ].sort((left, right) => left.file.localeCompare(right.file, 'en'));
        const binding = Object.freeze({
          releaseId: release.manifest.releaseId,
          manifestSha256: sha256(release.bindingManifestBuffer),
          contentSetSha256: release.manifest.contentSetSha256,
          artifactSetSha256: dataSha256(descriptors),
          productCount: products.length,
          routeCount: release.manifest.counts.routeCount,
          shardCount: release.manifest.counts.shardCount,
          quarantinedIdentityCount: release.manifest.counts.quarantinedIdentityCount,
          productsSha256: dataSha256(products)
        });
        return Object.freeze({ binding, products: Object.freeze(products) });
      })();
      baseBindingPromise = promise;
      promise.catch(() => resetBaseBindingCache(promise));
    }
    return baseBindingPromise;
  }

  async function overlayArtifactBuffer(descriptor, maximumBytes, label) {
    const buffer = overlayRemote
      ? await readRemoteBounded(fetchImpl, descriptor.url, maximumBytes, timeoutMs, label)
      : await readLocalBounded(path.join(overlayLocalRoot, descriptor.file), maximumBytes, readFileImpl);
    if (buffer.length !== descriptor.bytes || sha256(buffer) !== descriptor.sha256) {
      fail(503, 'f8x_overlay_checksum_mismatch', `${label} failed checksum validation.`);
    }
    return buffer;
  }

  async function loadOverlayShard(release, sequence) {
    const descriptor = release.manifest.shards[sequence - 1];
    if (!descriptor) fail(503, 'invalid_f8x_overlay_index', 'A reviewed F8X overlay route points outside its release.');
    const key = `${release.manifest.releaseId}:${sequence}:${descriptor.sha256}`;
    if (overlayShardCache.has(key)) return overlayShardCache.get(key);
    if (!overlayShardPromises.has(key)) {
      overlayShardPromises.set(key, (async () => {
        overlayShardReadCount += 1;
        const buffer = await overlayArtifactBuffer(
          descriptor,
          MAX_SHARD_BYTES,
          `Reviewed F8X overlay shard ${sequence}`
        );
        const products = validateF8xOverlayShard(
          parseJson(buffer, 'invalid_f8x_overlay_shard', `Reviewed F8X overlay shard ${sequence}`),
          descriptor,
          release.manifest
        );
        overlayShardCache.set(key, products);
        return products;
      })().finally(() => overlayShardPromises.delete(key)));
    }
    return overlayShardPromises.get(key);
  }

  async function loadOverlayRelease(baseRelease) {
    if (!overlayConfigured) return null;
    const requestedAt = currentTime(
      'invalid_f8x_overlay_configuration',
      'The reviewed F8X overlay'
    );
    if (overlayRemote && overlayReleaseExpiresAt !== null
      && overlayReleaseExpiresAt <= requestedAt) {
      resetOverlayReleaseCache();
    }
    if (!overlayReleasePromise) {
      const promise = (async () => {
        const manifestBuffer = overlayRemote
          ? await readRemoteBounded(
            fetchImpl,
            overlayRemoteUrl,
            MAX_MANIFEST_BYTES,
            timeoutMs,
            'The reviewed F8X overlay manifest'
          )
          : await readLocalBounded(
            path.resolve(overlayLocalManifestPath),
            MAX_MANIFEST_BYTES,
            readFileImpl
          );
        const nowValue = overlayRemote
          ? currentTime('invalid_f8x_overlay_configuration', 'The reviewed F8X overlay')
          : requestedAt;
        const manifest = validateF8xOverlayManifest(
          parseJson(manifestBuffer, 'invalid_f8x_overlay_manifest', 'The reviewed F8X overlay manifest'),
          { remote: overlayRemote, secret: overlayManifestSecret, nowValue }
        );
        overlayReleaseExpiresAt = overlayRemote ? Date.parse(manifest.expiresAt) : null;
        const base = await loadBaseBinding(baseRelease);
        if (stableJson(manifest.baseRelease) !== stableJson(base.binding)) {
          fail(503, 'f8x_overlay_base_release_mismatch', 'The reviewed F8X overlay is not bound to the active base shard release.');
        }
        const indexBuffer = await overlayArtifactBuffer(
          manifest.index,
          MAX_INDEX_BYTES,
          'The reviewed F8X overlay routing index'
        );
        const routes = validateF8xOverlayIndex(
          parseJson(indexBuffer, 'invalid_f8x_overlay_index', 'The reviewed F8X overlay routing index'),
          manifest
        );
        const productsByShard = await Promise.all(manifest.shards.map(descriptor => (
          loadOverlayShard({ manifest }, descriptor.sequence)
        )));
        const products = productsByShard.flat();
        for (const route of routes) {
          const product = productsByShard[route.shardSequence - 1]?.[route.shardProductIndex];
          if (!product || product.publicKey !== route.publicKey || product.slug !== route.slug) {
            fail(503, 'invalid_f8x_overlay_shard', 'A reviewed F8X overlay product does not match its public route.');
          }
        }
        return Object.freeze({
          manifest: Object.freeze(manifest),
          routes,
          products: Object.freeze(products),
          baseProducts: base.products
        });
      })();
      overlayReleasePromise = promise;
      promise.catch(() => resetOverlayReleaseCache(promise));
    }
    const promise = overlayReleasePromise;
    const release = await promise;
    if (overlayRemote && Date.parse(release.manifest.expiresAt) <= currentTime(
      'invalid_f8x_overlay_configuration',
      'The reviewed F8X overlay'
    )) {
      resetOverlayReleaseCache(promise);
      fail(503, 'invalid_f8x_overlay_manifest', 'The remote reviewed F8X overlay manifest is expired.');
    }
    return release;
  }

  function statusFor(release, baseProducts, plan) {
    return Object.freeze({
      schemaVersion: 2,
      sourceRecordCounts: Object.freeze({
        staticReviewed: baseProducts.length,
        bmwM3Sharded: release.manifest.counts.productCount,
        bmwM3ShardedUnique: plan.newRoutes.length,
        bmwM3ShardedOverlay: plan.overlayRoutes.length
      }),
      sourceRecordCount: baseProducts.length + release.manifest.counts.productCount,
      preQuarantineUniqueProductCount: plan.combined.length,
      quarantinedIdentityCount: release.manifest.counts.quarantinedIdentityCount,
      publishedProductCount: plan.combined.length,
      bmwM3AggregateNewUniqueProductCount: plan.newRoutes.length,
      bmwM3AggregateOverlayProductCount: plan.overlayRoutes.length,
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

  function ecsIdentity(product) {
    for (const value of [product?.ecsPartNumber, product?.identifiers?.ecs, product?.sku]) {
      const match = String(value ?? '').trim().match(/^(?:ES\s*#?\s*)?(\d{3,12})$/i);
      if (match) return match[1];
    }
    return String(product?.publicKey ?? '').trim().match(/^ecs-es-(\d{3,12})$/i)?.[1] || null;
  }

  function allEcsIdentityCarriers(product) {
    const identities = new Set();
    for (const value of [
      product?.ecsPartNumber,
      product?.sku,
      product?.identifiers?.ecs,
      product?.identifiers?.sku
    ]) {
      const match = String(value ?? '').trim().match(/^(?:ES\s*#?\s*)?(\d{3,12})$/i);
      if (match) identities.add(match[1]);
    }
    for (const [value, pattern] of [
      [product?.publicKey, /^ecs-es-(\d{3,12})$/i],
      [product?.slug, /^es-(\d{3,12})$/i]
    ]) {
      const match = String(value ?? '').trim().match(pattern);
      if (match) identities.add(match[1]);
    }
    return identities;
  }

  function routePlan(release, baseProducts) {
    const cached = routePlanCache.get(baseProducts);
    if (cached?.releaseId === release.manifest.releaseId) return cached.plan;
    const baseByIdentity = new Map();
    for (const product of baseProducts) {
      const key = ecsIdentity(product);
      if (!key) continue;
      if (baseByIdentity.has(key)) {
        fail(503, 'reviewed_shard_identity_conflict', `The static reviewed catalogue contains duplicate ES#${key}.`);
      }
      baseByIdentity.set(key, product);
    }
    const routeByIdentity = new Map();
    for (const route of release.routes) {
      const key = ecsIdentity(route);
      if (!key || routeByIdentity.has(key)) {
        fail(503, 'invalid_reviewed_shard_index', 'The reviewed product routing index contains a duplicate ECS identity.');
      }
      routeByIdentity.set(key, route);
    }
    let combined;
    try {
      const mergeRoutes = release.routes.map(route => {
        const existing = baseByIdentity.get(ecsIdentity(route));
        return existing ? overlayEvidence(existing, route) : route;
      });
      combined = mergeReviewedEcsProducts(baseProducts, mergeRoutes);
    } catch {
      fail(503, 'reviewed_shard_identity_conflict', 'The reviewed shard release conflicts with a static public product identity.');
    }
    const overlayRoutes = release.routes.filter(route => baseByIdentity.has(ecsIdentity(route)));
    const newRoutes = release.routes.filter(route => !baseByIdentity.has(ecsIdentity(route)));
    const plan = Object.freeze({ baseByIdentity, routeByIdentity, overlayRoutes, newRoutes, combined });
    routePlanCache.set(baseProducts, Object.freeze({ releaseId: release.manifest.releaseId, plan }));
    return plan;
  }

  function mergeFullBaseRuntime(staticProducts, shardProducts) {
    const staticByIdentity = new Map();
    for (const product of staticProducts) {
      const identity = ecsIdentity(product);
      if (!identity) continue;
      if (staticByIdentity.has(identity)) {
        fail(503, 'reviewed_shard_identity_conflict', `The static reviewed catalogue contains duplicate ES#${identity}.`);
      }
      staticByIdentity.set(identity, product);
    }
    try {
      return mergeReviewedEcsProducts(staticProducts, shardProducts.map(product => {
        const existing = staticByIdentity.get(ecsIdentity(product));
        return existing ? overlayEvidence(existing, product) : product;
      }));
    } catch (error) {
      fail(
        503,
        'reviewed_shard_identity_conflict',
        `The full reviewed base release conflicts with the static catalogue: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  function mergeF8xRuntimeOverlay(currentRuntime, overlayProducts, projectedQuarantine) {
    const quarantined = new Set(projectedQuarantine.identities);
    const carriesQuarantinedIdentity = product => (
      [...allEcsIdentityCarriers(product)].some(identity => quarantined.has(identity))
    );
    const quarantinedHandles = new Set(projectedQuarantine.identities.flatMap(identity => [
      `ecs-es-${identity}`, `es-${identity}`
    ]));
    currentRuntime.filter(carriesQuarantinedIdentity)
      .forEach(product => {
        if (product?.publicKey) quarantinedHandles.add(product.publicKey);
        if (product?.slug) quarantinedHandles.add(product.slug);
      });
    const currentFiltered = currentRuntime.filter(product => !carriesQuarantinedIdentity(product));
    const overlayFiltered = overlayProducts.filter(product => !carriesQuarantinedIdentity(product));
    if (overlayFiltered.length !== overlayProducts.length) {
      fail(503, 'f8x_overlay_quarantine_overlap', 'A projected-quarantine identity remains in the F8X overlay release.');
    }
    const currentHandles = new Map(currentFiltered.map(product => [
      ecsIdentity(product),
      [product.publicKey, product.slug]
    ]).filter(([identity]) => identity));
    let combined;
    try {
      const currentByIdentity = new Map(currentFiltered.map(product => [ecsIdentity(product), product]));
      combined = mergeReviewedEcsProducts(currentFiltered, overlayFiltered.map(product => (
        f8xManualConfirmationEvidence(currentByIdentity.get(ecsIdentity(product)), product)
      )));
    } catch (error) {
      fail(
        503,
        'f8x_overlay_identity_conflict',
        `The reviewed F8X overlay conflicts with the static-plus-base runtime union: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    const combinedByIdentity = new Map(combined.map(product => [ecsIdentity(product), product]));
    for (const [identity, [publicKey, slug]] of currentHandles) {
      const product = combinedByIdentity.get(identity);
      if (!product || product.publicKey !== publicKey || product.slug !== slug) {
        fail(503, 'f8x_overlay_identity_conflict', `The reviewed F8X overlay changes the stable handle for ES#${identity}.`);
      }
    }
    if (combined.some(carriesQuarantinedIdentity)) {
      fail(503, 'f8x_overlay_quarantine_overlap', 'A projected-quarantine identity survived the reviewed runtime merge.');
    }
    const overlayByIdentity = new Map(overlayFiltered.map(product => [ecsIdentity(product), product]));
    const normalized = combined.map(product => {
      const canonicalOverlayProduct = overlayByIdentity.get(ecsIdentity(product));
      const enforced = canonicalOverlayProduct
        ? enforceF8xManualConfirmation(product, canonicalOverlayProduct)
        : { ...product };
      enforced.relatedProductSlugs = (enforced.relatedProductSlugs || [])
        .filter(value => !quarantinedHandles.has(value));
      return enforced;
    });
    return immutableSnapshot(normalized);
  }

  async function f8xRuntimePlan(release, staticProducts) {
    const overlayRelease = await loadOverlayRelease(release);
    if (!f8xRuntimePlanCache.has(staticProducts)) {
      const cache = f8xRuntimePlanCache;
      const planPromise = (async () => {
        const currentRuntime = mergeFullBaseRuntime(staticProducts, overlayRelease.baseProducts);
        const combined = mergeF8xRuntimeOverlay(
          currentRuntime,
          overlayRelease.products,
          overlayRelease.manifest.projectedQuarantine
        );
        const currentIdentities = new Set(currentRuntime.map(ecsIdentity).filter(Boolean));
        const overlayIdentities = new Set(overlayRelease.products.map(ecsIdentity).filter(Boolean));
        const overlayCount = [...overlayIdentities].filter(identity => currentIdentities.has(identity)).length;
        return Object.freeze({
          overlayRelease,
          currentRuntime,
          combined,
          overlayCount,
          newCount: overlayIdentities.size - overlayCount
        });
      })();
      cache.set(staticProducts, planPromise);
      planPromise.catch(() => {
        if (cache.get(staticProducts) === planPromise) cache.delete(staticProducts);
      });
    }
    return f8xRuntimePlanCache.get(staticProducts);
  }

  function f8xStatusFor(release, staticProducts, basePlan, plan) {
    const baseStatus = statusFor(release, staticProducts, basePlan);
    const manifest = plan.overlayRelease.manifest;
    return Object.freeze({
      ...baseStatus,
      schemaVersion: 3,
      sourceRecordCounts: Object.freeze({
        ...baseStatus.sourceRecordCounts,
        f8xOverlay: manifest.counts.productCount,
        f8xOverlayUnique: plan.newCount,
        f8xOverlayExisting: plan.overlayCount
      }),
      sourceRecordCount: baseStatus.sourceRecordCount + manifest.counts.productCount,
      preQuarantineUniqueProductCount: plan.currentRuntime.length + plan.newCount,
      quarantinedIdentityCount: manifest.projectedQuarantine.identityCount,
      publishedProductCount: plan.combined.length,
      f8xOverlayNewUniqueProductCount: plan.newCount,
      f8xOverlayExistingProductCount: plan.overlayCount,
      f8xOverlayRelease: Object.freeze({
        releaseId: manifest.releaseId,
        source: overlayRemote ? 'signed-vercel-blob' : 'bundled-complete-overlay',
        complete: true,
        shardCount: manifest.counts.shardCount,
        routeCount: manifest.counts.routeCount,
        baseReleaseId: manifest.baseRelease.releaseId,
        finalAuditKind: manifest.finalAudit.kind,
        finalAuditInputSetSha256: manifest.finalAudit.inputSetSha256,
        scope: ECS_REVIEWED_F8X_OVERLAY_SCOPE
      })
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
    const plan = routePlan(release, baseProducts);
    if (overlayConfigured) {
      const f8xPlan = await f8xRuntimePlan(release, baseProducts);
      return Object.freeze({
        products: Object.freeze(f8xPlan.combined),
        status: f8xStatusFor(release, baseProducts, plan, f8xPlan),
        loadedShardCount: release.manifest.counts.shardCount,
        loadedOverlayShardCount: f8xPlan.overlayRelease.manifest.counts.shardCount
      });
    }
    const { combined } = plan;
    let selectedRoutes = [];
    if (request.mode === 'detail') {
      const selected = combined.find(item => item.publicKey === request.handle || item.slug === request.handle);
      const route = selected ? plan.routeByIdentity.get(ecsIdentity(selected)) : null;
      if (route) selectedRoutes = [route];
    } else {
      const selected = selectReviewedEcsProducts(combined, selectionRequest(request), nowValue);
      const limit = request.mode === 'suggest' ? 8 : 100;
      const offset = request.mode === 'suggest' ? 0 : request.offset;
      selectedRoutes = selected.slice(offset, offset + limit)
        .map(product => plan.routeByIdentity.get(ecsIdentity(product)))
        .filter(Boolean);
    }
    const hydrated = await hydrateRoutes(release, selectedRoutes);
    if (request.mode === 'detail' && hydrated.size) {
      const related = [...hydrated.values()].flatMap(product => product.relatedProductSlugs || []);
      const relatedRoutes = release.routes.filter(route => related.includes(route.slug) || related.includes(route.publicKey));
      const relatedHydrated = await hydrateRoutes(release, relatedRoutes);
      relatedHydrated.forEach((product, key) => hydrated.set(key, product));
    }
    const products = combined.map(product => {
      const route = plan.routeByIdentity.get(ecsIdentity(product));
      const fullProduct = route ? hydrated.get(route.publicKey) : null;
      if (!fullProduct) return product;
      try {
        const merged = mergeReviewedEcsProducts([product], [overlayEvidence(product, fullProduct)])[0];
        delete merged.shardedRoute;
        delete merged.shardSequence;
        delete merged.shardProductIndex;
        delete merged.searchDocument;
        return merged;
      } catch {
        fail(503, 'reviewed_shard_identity_conflict', 'A hydrated reviewed shard product conflicts with its public route.');
      }
    });
    return Object.freeze({
      products: Object.freeze(products),
      status: statusFor(release, baseProducts, plan),
      loadedShardCount: new Set(selectedRoutes.map(route => route.shardSequence)).size
    });
  }

  async function getStatus(baseProducts = []) {
    const release = await loadRelease();
    const plan = routePlan(release, baseProducts);
    if (overlayConfigured) {
      const f8xPlan = await f8xRuntimePlan(release, baseProducts);
      return f8xStatusFor(release, baseProducts, plan, f8xPlan);
    }
    return statusFor(release, baseProducts, plan);
  }

  function diagnostics() {
    return Object.freeze({
      shardReadCount,
      cachedShardCount: shardCache.size,
      remote,
      f8xOverlayConfigured: overlayConfigured,
      overlayShardReadCount,
      cachedOverlayShardCount: overlayShardCache.size,
      overlayRemote
    });
  }

  function clearCache() {
    resetBaseReleaseCache();
    shardReadCount = 0;
    overlayShardReadCount = 0;
  }

  return Object.freeze({ prepareProducts, getStatus, diagnostics, clearCache });
}

export function createConfiguredReviewedShardCatalogueProvider(configuration = {}) {
  const {
    env = process.env,
    readFileImpl = readFile,
    ...options
  } = configuration;
  const currentUrl = env?.[ECS_REVIEWED_SHARD_CURRENT_URL_ENV] || null;
  const manifestSecret = env?.[ECS_REVIEWED_SHARD_MANIFEST_SECRET_ENV] || null;
  const overlayCurrentUrl = env?.[ECS_REVIEWED_F8X_OVERLAY_CURRENT_URL_ENV] || null;
  const overlayManifestSecret = env?.[ECS_REVIEWED_F8X_OVERLAY_MANIFEST_SECRET_ENV] || null;
  const overlayEnvConfigured = Boolean(overlayCurrentUrl || overlayManifestSecret);
  const overlayExplicitlyConfigured = Object.prototype.hasOwnProperty.call(options, 'f8xOverlay');
  const useBundledPreviewOverlay = !overlayExplicitlyConfigured
    && String(env?.VERCEL_ENV || '').trim().toLowerCase() === 'preview';
  return createReviewedShardCatalogueProvider({
    currentUrl,
    manifestSecret,
    localManifestPath: currentUrl ? null : ECS_REVIEWED_SHARD_LOCAL_MANIFEST,
    f8xOverlay: useBundledPreviewOverlay
      ? { localManifestPath: ECS_REVIEWED_F8X_OVERLAY_LOCAL_MANIFEST }
      : overlayEnvConfigured ? {
        currentUrl: overlayCurrentUrl,
        manifestSecret: overlayManifestSecret
      } : null,
    readFileImpl: useBundledPreviewOverlay
      ? filename => readBundledReviewedShardArtifact(filename, readFileImpl)
      : readFileImpl,
    allowIncompleteLocal: true,
    ...options
  });
}
