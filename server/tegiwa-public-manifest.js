import { createHmac, timingSafeEqual } from 'node:crypto';

export const TEGIWA_PUBLIC_MANIFEST_VERSION = 2;

const MANIFEST_FIELDS = Object.freeze([
  'version',
  'vendor',
  'releaseId',
  'retrievedAt',
  'publishedAt',
  'expiresAt',
  'counts',
  'artifact'
]);
const SIGNED_MANIFEST_FIELDS = Object.freeze([...MANIFEST_FIELDS, 'signature']);
const COUNT_FIELDS = Object.freeze(['productCount', 'skuProductCount', 'availableProductCount']);
const ARTIFACT_FIELDS = Object.freeze(['url', 'bytes', 'sha256']);
const MAX_PRODUCTS = 10_000_000;
const MAX_ARTIFACT_BYTES = 50_000_000;
const MIN_SECRET_BYTES = 32;
const MAX_SECRET_BYTES = 1_024;

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
  if (typeof value !== 'string' || value.length > 40) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function canonicalHttpsUrl(value) {
  if (typeof value !== 'string' || value.length < 9 || value.length > 4_096) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.port
      && url.toString() === value;
  } catch {
    return false;
  }
}

function safeCount(value, { allowZero = true } = {}) {
  return Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1) && value <= MAX_PRODUCTS;
}

function validateCanonicalFields(manifest) {
  const expectedFields = Object.hasOwn(manifest || {}, 'signature') ? SIGNED_MANIFEST_FIELDS : MANIFEST_FIELDS;
  if (!hasExactKeys(manifest, expectedFields)
    || manifest.version !== TEGIWA_PUBLIC_MANIFEST_VERSION
    || manifest.vendor !== 'Tegiwa'
    || typeof manifest.releaseId !== 'string'
    || !/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/.test(manifest.releaseId)
    || !canonicalTimestamp(manifest.retrievedAt)
    || !canonicalTimestamp(manifest.publishedAt)
    || !canonicalTimestamp(manifest.expiresAt)
    || !hasExactKeys(manifest.counts, COUNT_FIELDS)
    || !safeCount(manifest.counts.productCount, { allowZero: false })
    || !safeCount(manifest.counts.skuProductCount)
    || manifest.counts.skuProductCount > manifest.counts.productCount
    || !safeCount(manifest.counts.availableProductCount)
    || manifest.counts.availableProductCount > manifest.counts.productCount
    || !hasExactKeys(manifest.artifact, ARTIFACT_FIELDS)
    || !canonicalHttpsUrl(manifest.artifact.url)
    || !Number.isSafeInteger(manifest.artifact.bytes)
    || manifest.artifact.bytes < 1
    || manifest.artifact.bytes > MAX_ARTIFACT_BYTES
    || !/^[a-f0-9]{64}$/.test(String(manifest.artifact.sha256 || ''))) {
    throw new Error('invalid_tegiwa_public_manifest');
  }
}

export function validTegiwaManifestSecret(secret) {
  if (typeof secret !== 'string' || !secret.trim()) return false;
  const bytes = Buffer.byteLength(secret, 'utf8');
  return bytes >= MIN_SECRET_BYTES && bytes <= MAX_SECRET_BYTES;
}

export function canonicalTegiwaPublicManifestPayload(manifest) {
  validateCanonicalFields(manifest);
  return JSON.stringify([
    manifest.version,
    manifest.vendor,
    manifest.releaseId,
    manifest.retrievedAt,
    manifest.publishedAt,
    manifest.expiresAt,
    manifest.counts.productCount,
    manifest.counts.skuProductCount,
    manifest.counts.availableProductCount,
    manifest.artifact.url,
    manifest.artifact.bytes,
    manifest.artifact.sha256
  ]);
}

export function signTegiwaPublicManifest(manifest, secret) {
  if (!validTegiwaManifestSecret(secret)) throw new Error('invalid_tegiwa_manifest_secret');
  return createHmac('sha256', secret)
    .update(canonicalTegiwaPublicManifestPayload(manifest), 'utf8')
    .digest('hex');
}

export function verifyTegiwaPublicManifestSignature(manifest, secret) {
  if (!validTegiwaManifestSecret(secret) || !/^[a-f0-9]{64}$/.test(String(manifest?.signature || ''))) return false;
  let expected;
  try {
    expected = signTegiwaPublicManifest(manifest, secret);
  } catch {
    return false;
  }
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(manifest.signature, 'hex'));
}
