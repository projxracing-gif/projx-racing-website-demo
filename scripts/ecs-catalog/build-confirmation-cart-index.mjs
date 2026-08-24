import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  ECS_CONFIRMATION_CART_BASE_EXPECTED_PRODUCT_COUNT,
  ECS_CONFIRMATION_CART_F8X_COVERAGE_COUNT,
  ECS_CONFIRMATION_CART_F8X_EXPECTED_PRODUCT_COUNT,
  ECS_CONFIRMATION_CART_PROJECTED_QUARANTINE_COUNT,
  ECS_CONFIRMATION_CART_RUNTIME_PRODUCT_COUNT,
  buildCombinedEcsConfirmationCartIndex,
  classifyEcsObservedAvailability,
  evaluateEcsConfirmationCartEligibility,
  unpackEcsConfirmationCartEntry,
  validateEcsConfirmationCartBaseSnapshot,
  validateEcsConfirmationCartIndex
} from '../../server/ecs-confirmation-cart-sellability.js';
import { validateCanonicalEcsF8xOverlayProduct } from '../../server/ecs-f8x-overlay-contract.js';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..', '..');
const DEFAULT_BASE_INDEX = path.join(
  PROJECT_ROOT, 'server', 'data', 'ecs-confirmation-cart-base-20260811.json'
);
const DEFAULT_OVERLAY_DIRECTORY = path.join(
  PROJECT_ROOT, 'private-imports', 'ecs-f8x-release-20260821-cart-v2', 'f8x-overlay-candidate'
);
const DEFAULT_FINAL_AUDIT = path.join(
  PROJECT_ROOT, 'private-imports', 'ecs-f8x-release-20260821-cart-v2', 'f8x-final-release-audit.json'
);
const DEFAULT_STABLE_HANDLES = path.join(
  PROJECT_ROOT, 'server', 'data', 'ecs-confirmation-cart-stable-handles.json'
);
const DEFAULT_STATIC_CATALOGUE = path.join(PROJECT_ROOT, 'assets', 'ecs-products.js');
const DEFAULT_OUTPUT = path.join(PROJECT_ROOT, 'server', 'data', 'ecs-confirmation-cart-index.json');
const SHA256 = /^[a-f0-9]{64}$/;
const RELEASE_ID = /^\d{8}T\d{9}Z-[a-f0-9]{16}$/;
const IDENTITY = /^\d{3,12}$/;
const PRODUCT_KEY = /^ecs-[a-z0-9][a-z0-9-]*$/;
const PRODUCT_SLUG = /^[a-z0-9][a-z0-9-]*$/;
const OVERLAY_MANIFEST_KIND = 'ecs-reviewed-f8x-overlay-shard-manifest';
const OVERLAY_INDEX_KIND = 'ecs-reviewed-f8x-overlay-routing-index';
const OVERLAY_SHARD_KIND = 'ecs-reviewed-f8x-overlay-product-shard';
const F8X_AUDIT_KIND = 'ecs-f8x-aggregate-import-audit';
const F8X_FINAL_AUDIT_KIND = 'ecs-f8x-final-release-audit-verification';
const EXPECTED_PROFILES = Object.freeze(['f80-m3', 'f82-m4', 'f83-m4']);
const EXPECTED_CHASSIS = Object.freeze(['F80', 'F82', 'F83']);
const EXPECTED_SECTIONS = Object.freeze([
  'braking', 'engine', 'exterior', 'interior', 'performance', 'suspension', 'steering'
]);

function digest(value) {
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

function stableJson(value) {
  const normalize = item => {
    if (Array.isArray(item)) return item.map(normalize);
    if (plainObject(item)) return Object.fromEntries(Object.keys(item).sort().map(key => [key, normalize(item[key])]));
    return item;
  };
  return JSON.stringify(normalize(value));
}

function dataDigest(value) {
  return digest(Buffer.from(stableJson(value), 'utf8'));
}

function parseJson(bytes, label) {
  try { return JSON.parse(String(bytes)); }
  catch { throw new Error(`${label} is not valid JSON.`); }
}

function ecsIdentity(value) {
  return String(value || '').match(/^ES#(\d{3,12})$/i)?.[1] || null;
}

function sameArray(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function parseArguments(values) {
  const options = {
    baseIndex: DEFAULT_BASE_INDEX,
    overlayDirectory: DEFAULT_OVERLAY_DIRECTORY,
    finalAudit: DEFAULT_FINAL_AUDIT,
    stableHandles: DEFAULT_STABLE_HANDLES,
    staticCatalogue: DEFAULT_STATIC_CATALOGUE,
    output: DEFAULT_OUTPUT,
    baseSnapshotOutput: null,
    evaluatedAt: null,
    expectedCount: null,
    expectedF8xCount: null,
    expectedCoverageCount: null,
    expectedQuarantineCount: null,
    check: false
  };
  for (const value of values) {
    if (value === '--check') options.check = true;
    else if (value.startsWith('--base-index=')) options.baseIndex = path.resolve(value.slice(13));
    else if (value.startsWith('--overlay-directory=')) options.overlayDirectory = path.resolve(value.slice(20));
    else if (value.startsWith('--final-audit=')) options.finalAudit = path.resolve(value.slice(14));
    else if (value.startsWith('--stable-handles=')) options.stableHandles = path.resolve(value.slice(17));
    else if (value.startsWith('--static-catalogue=')) options.staticCatalogue = path.resolve(value.slice(19));
    else if (value.startsWith('--output=')) options.output = path.resolve(value.slice(9));
    else if (value.startsWith('--base-snapshot-output=')) options.baseSnapshotOutput = path.resolve(value.slice(23));
    else if (value.startsWith('--as-of=')) options.evaluatedAt = value.slice(8);
    else if (value.startsWith('--expected-count=')) options.expectedCount = Number(value.slice(17));
    else if (value.startsWith('--expected-f8x-count=')) options.expectedF8xCount = Number(value.slice(21));
    else if (value.startsWith('--expected-coverage-count=')) options.expectedCoverageCount = Number(value.slice(26));
    else if (value.startsWith('--expected-quarantine-count=')) options.expectedQuarantineCount = Number(value.slice(28));
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!options.evaluatedAt) throw new Error('--as-of=<canonical UTC timestamp> is required.');
  for (const field of ['expectedCount', 'expectedF8xCount', 'expectedCoverageCount', 'expectedQuarantineCount']) {
    if (options[field] !== null && !positiveInteger(options[field])) {
      throw new Error(`--${field.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`)} must be a positive safe integer.`);
    }
  }
  return options;
}

function validateBaseReleaseBinding(value) {
  return exactKeys(value, [
    'releaseId', 'manifestSha256', 'contentSetSha256', 'artifactSetSha256', 'productCount',
    'routeCount', 'shardCount', 'quarantinedIdentityCount', 'productsSha256'
  ])
    && RELEASE_ID.test(value.releaseId || '')
    && SHA256.test(value.manifestSha256 || '')
    && SHA256.test(value.contentSetSha256 || '')
    && SHA256.test(value.artifactSetSha256 || '')
    && SHA256.test(value.productsSha256 || '')
    && positiveInteger(value.productCount)
    && value.routeCount === value.productCount
    && positiveInteger(value.shardCount)
    && Number.isSafeInteger(value.quarantinedIdentityCount)
    && value.quarantinedIdentityCount >= 0;
}

function validateOverlayManifest(manifest) {
  if (!exactKeys(manifest, [
    'schemaVersion', 'supplier', 'kind', 'releaseId', 'generatedAt', 'publicationMode', 'complete',
    'overlayScope', 'baseRelease', 'finalAudit', 'projectedQuarantine', 'counts', 'index', 'shards',
    'contentSetSha256'
  ])
    || manifest.schemaVersion !== 1 || manifest.supplier !== 'ECS Tuning'
    || manifest.kind !== OVERLAY_MANIFEST_KIND || !RELEASE_ID.test(manifest.releaseId || '')
    || manifest.publicationMode !== 'complete' || manifest.complete !== true
    || !exactKeys(manifest.overlayScope, ['kind', 'profiles', 'chassis', 'sections', 'complete'])
    || manifest.overlayScope.kind !== 'bmw-f8x' || manifest.overlayScope.complete !== true
    || !sameArray(manifest.overlayScope.profiles, EXPECTED_PROFILES)
    || !sameArray(manifest.overlayScope.chassis, EXPECTED_CHASSIS)
    || !sameArray(manifest.overlayScope.sections, EXPECTED_SECTIONS)
    || !validateBaseReleaseBinding(manifest.baseRelease)
    || !exactKeys(manifest.finalAudit, ['kind', 'inputSetSha256', 'aggregateModuleSha256'])
    || manifest.finalAudit.kind !== F8X_FINAL_AUDIT_KIND
    || !SHA256.test(manifest.finalAudit.inputSetSha256 || '')
    || !SHA256.test(manifest.finalAudit.aggregateModuleSha256 || '')
    || !exactKeys(manifest.projectedQuarantine, ['identities', 'identityCount', 'identitiesSha256'])
    || !Array.isArray(manifest.projectedQuarantine.identities)
    || manifest.projectedQuarantine.identities.length !== manifest.projectedQuarantine.identityCount
    || manifest.projectedQuarantine.identities.some(identity => !IDENTITY.test(identity))
    || new Set(manifest.projectedQuarantine.identities).size !== manifest.projectedQuarantine.identities.length
    || !sameArray(manifest.projectedQuarantine.identities, [...manifest.projectedQuarantine.identities].sort())
    || dataDigest(manifest.projectedQuarantine.identities) !== manifest.projectedQuarantine.identitiesSha256
    || !exactKeys(manifest.counts, ['productCount', 'routeCount', 'shardCount', 'quarantinedIdentityCount'])
    || !positiveInteger(manifest.counts.productCount)
    || manifest.counts.routeCount !== manifest.counts.productCount
    || !positiveInteger(manifest.counts.shardCount)
    || manifest.counts.quarantinedIdentityCount !== manifest.projectedQuarantine.identityCount
    || !exactKeys(manifest.index, ['file', 'bytes', 'sha256'])
    || manifest.index.file !== 'index.json' || !positiveInteger(manifest.index.bytes)
    || !SHA256.test(manifest.index.sha256 || '')
    || !Array.isArray(manifest.shards) || manifest.shards.length !== manifest.counts.shardCount
    || !SHA256.test(manifest.contentSetSha256 || '')) {
    throw new Error('The audited F8X overlay manifest is invalid.');
  }
  return manifest;
}

function validateFinalAudit(audit, manifest, auditSha256) {
  if (!plainObject(audit) || audit.kind !== F8X_AUDIT_KIND
    || audit.expectedCaptureCount !== 21 || audit.inputCaptureCount !== 21
    || audit.completeCaptureCount !== 21
    || audit.captureProgress?.complete !== true
    || audit.captureProgress?.requestedSectionCount !== 7
    || audit.captureProgress?.includedSectionCount !== 7
    || !sameArray(audit.captureProgress?.includedSections, EXPECTED_SECTIONS)
    || audit.publicationPlan?.mode !== 'separate-f8x-overlay'
    || audit.publicationPlan?.overlayProductCount !== manifest.counts.productCount
    || stableJson(audit.publicationPlan?.baseRelease) !== stableJson(manifest.baseRelease)
    || audit.publicationPlan?.projectedQuarantine?.identityCount
      !== manifest.projectedQuarantine.identityCount
    || audit.publicationPlan?.projectedQuarantine?.identitiesSha256
      !== manifest.projectedQuarantine.identitiesSha256
    || audit.publicationPlan?.staticPlusBasePlusOverlayProductCount !== ECS_CONFIRMATION_CART_RUNTIME_PRODUCT_COUNT
    || audit.publicationMergeAudit?.publishedOverlayProductCount !== manifest.counts.productCount
    || audit.publicationMergeAudit?.unintendedCurrentReviewedRemovalCount !== 0
    || audit.publicationMergeAudit?.projectedPublishedReviewedEcsCount
      !== audit.publicationPlan.staticPlusBasePlusOverlayProductCount
    || audit.finalReleaseAudit?.kind !== F8X_FINAL_AUDIT_KIND
    || audit.finalReleaseAudit?.inputSetSha256 !== manifest.finalAudit.inputSetSha256
    || audit.finalReleaseAudit?.inputChecksums?.aggregateModule?.sha256
      !== manifest.finalAudit.aggregateModuleSha256
    || !sameArray(audit.projectedQuarantinedEcsIdentities, manifest.projectedQuarantine.identities)
    || !SHA256.test(auditSha256)) {
    throw new Error('The F8X final audit does not bind the overlay candidate.');
  }
  return audit;
}

export async function loadF8xOverlayRelease(directory, finalAuditPath, { readFileImpl = readFile } = {}) {
  const manifestBytes = await readFileImpl(path.join(directory, 'manifest.json'));
  const manifestSha256 = digest(manifestBytes);
  const manifest = validateOverlayManifest(parseJson(manifestBytes, 'The F8X overlay manifest'));
  const sidecar = await readFileImpl(path.join(directory, 'manifest.json.sha256'));
  if (String(sidecar) !== `${manifestSha256}  manifest.json\n`) {
    throw new Error('The F8X overlay manifest checksum sidecar does not match.');
  }

  const indexBytes = await readFileImpl(path.join(directory, manifest.index.file));
  if (indexBytes.length !== manifest.index.bytes || digest(indexBytes) !== manifest.index.sha256) {
    throw new Error('The F8X overlay routing index checksum does not match.');
  }
  const index = parseJson(indexBytes, 'The F8X overlay routing index');
  if (!exactKeys(index, ['schemaVersion', 'supplier', 'kind', 'releaseId', 'routeCount', 'routes'])
    || index.schemaVersion !== 1 || index.supplier !== 'ECS Tuning'
    || index.kind !== OVERLAY_INDEX_KIND || index.releaseId !== manifest.releaseId
    || index.routeCount !== manifest.counts.routeCount || !Array.isArray(index.routes)
    || index.routes.length !== index.routeCount) {
    throw new Error('The F8X overlay routing index is invalid.');
  }

  const products = [];
  const positions = new Map();
  const contentDescriptors = [`index.json\0${manifest.index.bytes}\0${manifest.index.sha256}`];
  for (const [descriptorIndex, descriptor] of manifest.shards.entries()) {
    if (!exactKeys(descriptor, [
      'sequence', 'file', 'productCount', 'bytes', 'sha256', 'firstKey', 'lastKey'
    ])
      || descriptor.sequence !== descriptorIndex + 1
      || !/^shard-\d{5}\.json$/.test(descriptor.file || '')
      || !positiveInteger(descriptor.productCount) || !positiveInteger(descriptor.bytes)
      || !SHA256.test(descriptor.sha256 || '')
      || !PRODUCT_KEY.test(descriptor.firstKey || '') || !PRODUCT_KEY.test(descriptor.lastKey || '')) {
      throw new Error('An F8X overlay shard descriptor is invalid.');
    }
    const bytes = await readFileImpl(path.join(directory, descriptor.file));
    if (bytes.length !== descriptor.bytes || digest(bytes) !== descriptor.sha256) {
      throw new Error(`${descriptor.file} failed checksum validation.`);
    }
    const shard = parseJson(bytes, descriptor.file);
    if (!exactKeys(shard, ['schemaVersion', 'supplier', 'kind', 'releaseId', 'sequence', 'productCount', 'products'])
      || shard.schemaVersion !== 1 || shard.supplier !== 'ECS Tuning'
      || shard.kind !== OVERLAY_SHARD_KIND || shard.releaseId !== manifest.releaseId
      || shard.sequence !== descriptor.sequence || shard.productCount !== descriptor.productCount
      || !Array.isArray(shard.products) || shard.products.length !== descriptor.productCount
      || shard.products[0]?.publicKey !== descriptor.firstKey
      || shard.products.at(-1)?.publicKey !== descriptor.lastKey) {
      throw new Error(`${descriptor.file} is not a valid F8X overlay shard.`);
    }
    shard.products.forEach((product, productIndex) => {
      validateCanonicalEcsF8xOverlayProduct(product, {
        label: `${descriptor.file} product ${productIndex + 1}`
      });
      products.push(product);
      positions.set(`${descriptor.sequence}:${productIndex}`, product);
    });
    contentDescriptors.push(`${descriptor.file}\0${descriptor.bytes}\0${descriptor.sha256}`);
  }
  if (products.length !== manifest.counts.productCount
    || digest(Buffer.from(contentDescriptors.join('\n'), 'utf8')) !== manifest.contentSetSha256) {
    throw new Error('The F8X overlay content set does not reconcile.');
  }

  const routeKeys = new Set();
  for (const route of index.routes) {
    validateCanonicalEcsF8xOverlayProduct(route, { compact: true, label: 'The F8X overlay route' });
    const product = positions.get(`${route.shardSequence}:${route.shardProductIndex}`);
    if (route.shardedRoute !== true || routeKeys.has(route.publicKey)
      || product?.publicKey !== route.publicKey || product?.slug !== route.slug) {
      throw new Error('An F8X overlay route does not match its shard product.');
    }
    routeKeys.add(route.publicKey);
  }

  const identities = new Set();
  const quarantined = new Set(manifest.projectedQuarantine.identities);
  for (const product of products) {
    const identity = ecsIdentity(product.ecsPartNumber);
    if (!identity || identities.has(identity) || quarantined.has(identity)) {
      throw new Error('The F8X overlay has a duplicate, invalid, or quarantined ECS identity.');
    }
    identities.add(identity);
  }

  const auditBytes = await readFileImpl(finalAuditPath);
  const finalAuditFileSha256 = digest(auditBytes);
  const finalAudit = validateFinalAudit(
    parseJson(auditBytes, 'The F8X final audit'), manifest, finalAuditFileSha256
  );
  return Object.freeze({
    manifest, manifestSha256, index, products: Object.freeze(products), finalAudit, finalAuditFileSha256
  });
}

export async function loadStableHandleOverrides(filename, {
  readFileImpl = readFile, staticCatalogue = DEFAULT_STATIC_CATALOGUE
} = {}) {
  const staticBytes = await readFileImpl(staticCatalogue);
  const context = Object.create(null);
  try {
    vm.runInNewContext(String(staticBytes), context, {
      filename: path.basename(staticCatalogue instanceof URL ? fileURLToPath(staticCatalogue) : staticCatalogue),
      timeout: 5_000
    });
  } catch {
    throw new Error('The static ECS catalogue could not be evaluated for stable-handle validation.');
  }
  const staticProducts = context.PROJX_ECS_PRODUCTS;
  if (!Array.isArray(staticProducts) || staticProducts.length === 0) {
    throw new Error('The static ECS catalogue did not expose its reviewed product array.');
  }
  const staticByIdentity = new Map();
  for (const product of staticProducts) {
    const identity = ecsIdentity(product?.ecsPartNumber || product?.sku);
    if (!identity || staticByIdentity.has(identity)
      || !PRODUCT_KEY.test(product?.publicKey || '') || !PRODUCT_SLUG.test(product?.slug || '')) {
      throw new Error('The static ECS catalogue has an invalid or duplicate stable identity.');
    }
    staticByIdentity.set(identity, product);
  }

  const bytes = await readFileImpl(filename);
  const document = parseJson(bytes, 'The ECS stable-handle override document');
  const { contentSha256, ...payload } = document;
  if (!exactKeys(document, ['schemaVersion', 'kind', 'source', 'entryCount', 'entries', 'contentSha256'])
    || document.schemaVersion !== 1
    || document.kind !== 'ecs-confirmation-cart-stable-handle-overrides'
    || !exactKeys(document.source, [
      'releaseId', 'contentSetSha256', 'runtimeProductCount',
      'staticCatalogueSha256', 'staticProductCount'
    ])
    || !RELEASE_ID.test(document.source.releaseId || '')
    || !SHA256.test(document.source.contentSetSha256 || '')
    || !positiveInteger(document.source.runtimeProductCount)
    || document.source.staticCatalogueSha256 !== digest(staticBytes)
    || document.source.staticProductCount !== staticProducts.length
    || !positiveInteger(document.entryCount)
    || !Array.isArray(document.entries) || document.entries.length !== document.entryCount
    || !SHA256.test(contentSha256 || '') || digest(JSON.stringify(payload)) !== contentSha256) {
    throw new Error('The ECS stable-handle override document is invalid.');
  }
  const byIdentity = new Map();
  const productKeys = new Set();
  const slugs = new Set();
  let previous = null;
  for (const row of document.entries) {
    if (!Array.isArray(row) || row.length !== 3 || !IDENTITY.test(row[0])
      || !PRODUCT_KEY.test(row[1]) || !PRODUCT_SLUG.test(row[2])
      || (previous !== null && previous.localeCompare(row[0]) >= 0)
      || productKeys.has(row[1]) || slugs.has(row[2])) {
      throw new Error('An ECS stable-handle override row is invalid or duplicated.');
    }
    previous = row[0];
    const staticProduct = staticByIdentity.get(row[0]);
    if (staticProduct?.publicKey !== row[1] || staticProduct?.slug !== row[2]) {
      throw new Error(`Stable handle ES#${row[0]} does not match the checksum-bound static ECS catalogue.`);
    }
    productKeys.add(row[1]);
    slugs.add(row[2]);
    byIdentity.set(row[0], Object.freeze({ productId: row[1], slug: row[2] }));
  }
  return Object.freeze({
    document: Object.freeze(document), byIdentity,
    staticByIdentity,
    staticCatalogueSha256: digest(staticBytes), staticProductCount: staticProducts.length
  });
}

function assertExpected(label, actual, expected) {
  if (expected !== null && actual !== Number(expected)) {
    throw new Error(`Expected ${Number(expected).toLocaleString('en-US')} ${label}; generated ${actual.toLocaleString('en-US')}.`);
  }
}

function composeEntries(baseDocument, overlay, stableHandles, evaluatedAt, expectations) {
  const evaluatedAtValue = Date.parse(evaluatedAt);
  if (!Number.isFinite(evaluatedAtValue) || new Date(evaluatedAtValue).toISOString() !== evaluatedAt) {
    throw new Error('--as-of must be a canonical UTC timestamp.');
  }
  const quarantine = new Set(overlay.manifest.projectedQuarantine.identities);
  const overlayByIdentity = new Map();
  for (const product of overlay.products) {
    const identity = ecsIdentity(product.ecsPartNumber);
    if (!identity || overlayByIdentity.has(identity)) throw new Error('The F8X overlay identity set is invalid.');
    overlayByIdentity.set(identity, product);
  }
  for (const identity of stableHandles.byIdentity.keys()) {
    if (!overlayByIdentity.has(identity)) throw new Error(`Stable handle ES#${identity} is outside the F8X overlay.`);
  }
  const requiredStableIdentities = new Set();
  for (const [identity, product] of overlayByIdentity) {
    const staticProduct = stableHandles.staticByIdentity.get(identity);
    if (staticProduct && (staticProduct.publicKey !== product.publicKey || staticProduct.slug !== product.slug)) {
      requiredStableIdentities.add(identity);
    }
  }
  if (requiredStableIdentities.size !== stableHandles.byIdentity.size
    || [...requiredStableIdentities].some(identity => !stableHandles.byIdentity.has(identity))) {
    throw new Error('The stable-handle override set does not exactly cover every noncanonical static/F8X intersection.');
  }
  if (stableHandles.document.source.releaseId !== overlay.manifest.baseRelease.releaseId
    || stableHandles.document.source.contentSetSha256 !== overlay.manifest.baseRelease.contentSetSha256
    || stableHandles.document.source.runtimeProductCount
      !== overlay.finalAudit.publicationMergeAudit.currentRuntimeReviewedProductCount) {
    throw new Error('The ECS stable-handle overrides are not bound to the overlay base runtime.');
  }
  if (baseDocument.source.releaseId !== overlay.manifest.baseRelease.releaseId
    || baseDocument.source.contentSha256 !== overlay.manifest.baseRelease.contentSetSha256
    || baseDocument.source.mergedProductCount
      !== overlay.finalAudit.publicationMergeAudit.currentRuntimeReviewedProductCount) {
    throw new Error('The ECS base cart snapshot is not bound to the overlay base runtime.');
  }

  const baseEntries = baseDocument.entries.map(unpackEcsConfirmationCartEntry);
  const baseByIdentity = new Map(baseEntries.map(entry => [ecsIdentity(entry.sku), entry]));
  const supersededBaseEntryCount = baseEntries.filter(entry => overlayByIdentity.has(ecsIdentity(entry.sku))).length;
  const quarantinedBaseEntryCount = baseEntries.filter(entry => quarantine.has(ecsIdentity(entry.sku))).length;
  if (baseEntries.some(entry => overlayByIdentity.has(ecsIdentity(entry.sku)) && quarantine.has(ecsIdentity(entry.sku)))) {
    throw new Error('The F8X overlay and projected quarantine overlap in the base cart snapshot.');
  }
  const retainedBase = baseEntries.filter(entry => (
    !overlayByIdentity.has(ecsIdentity(entry.sku)) && !quarantine.has(ecsIdentity(entry.sku))
  ));
  if (retainedBase.some(entry => Date.parse(entry.expiresAt) < evaluatedAtValue)) {
    throw new Error('A retained base cart entry was already expired at composition time.');
  }

  const f8xEntries = [];
  const f8xExclusions = new Map();
  let f8xExistingBaseEligibleCount = 0;
  let stableHandleEligibleCount = 0;
  for (const [identity, product] of overlayByIdentity) {
    const stable = stableHandles.byIdentity.get(identity);
    const projectedProduct = stable
      ? { ...product, publicKey: stable.productId, slug: stable.slug }
      : product;
    const result = evaluateEcsConfirmationCartEligibility(projectedProduct, { nowValue: evaluatedAtValue });
    if (!result.eligible) {
      f8xExclusions.set(result.reason, (f8xExclusions.get(result.reason) || 0) + 1);
      continue;
    }
    if (baseByIdentity.has(identity)) f8xExistingBaseEligibleCount += 1;
    if (stable) stableHandleEligibleCount += 1;
    f8xEntries.push({ ...result.entry, sourceCohort: 'f8x' });
  }

  assertExpected('authoritative F8X identities', overlayByIdentity.size, expectations.expectedCoverageCount);
  assertExpected('projected quarantine identities', quarantine.size, expectations.expectedQuarantineCount);
  assertExpected('eligible F8X products', f8xEntries.length, expectations.expectedF8xCount);
  const f8xExclusionCounts = Object.fromEntries(
    [...f8xExclusions].sort(([left], [right]) => left.localeCompare(right))
  );
  const composition = {
    baseEntryCount: baseEntries.length,
    supersededBaseEntryCount,
    quarantinedBaseEntryCount,
    retainedBaseEntryCount: retainedBase.length,
    authoritativeF8xIdentityCount: overlayByIdentity.size,
    projectedQuarantineIdentityCount: quarantine.size,
    f8xEligibleCount: f8xEntries.length,
    f8xExcludedCount: overlayByIdentity.size - f8xEntries.length,
    f8xExistingBaseEligibleCount,
    newF8xEligibleCount: f8xEntries.length - f8xExistingBaseEligibleCount,
    stableHandleOverrideCount: stableHandles.document.entryCount,
    stableHandleEligibleCount,
    f8xExclusionCounts
  };
  const baseEvaluatedAt = Date.parse(baseDocument.evaluatedAt);
  const retainedEntries = retainedBase.map(entry => ({
    ...entry,
    sourceCohort: 'base',
    availabilityClass: classifyEcsObservedAvailability(entry.observedAvailability, baseEvaluatedAt)
  }));
  return Object.freeze({ entries: Object.freeze([...retainedEntries, ...f8xEntries]), composition });
}

export async function generateEcsConfirmationCartIndex(options = {}) {
  const baseBytes = await (options.readFileImpl || readFile)(options.baseIndex || DEFAULT_BASE_INDEX);
  const baseDocument = validateEcsConfirmationCartBaseSnapshot(
    parseJson(baseBytes, 'The ECS base cart snapshot'),
    { expectedCount: ECS_CONFIRMATION_CART_BASE_EXPECTED_PRODUCT_COUNT }
  );
  const overlay = await loadF8xOverlayRelease(
    options.overlayDirectory || DEFAULT_OVERLAY_DIRECTORY,
    options.finalAudit || DEFAULT_FINAL_AUDIT,
    { readFileImpl: options.readFileImpl || readFile }
  );
  const stableHandles = await loadStableHandleOverrides(
    options.stableHandles || DEFAULT_STABLE_HANDLES,
    {
      readFileImpl: options.readFileImpl || readFile,
      staticCatalogue: options.staticCatalogue || DEFAULT_STATIC_CATALOGUE
    }
  );
  const evaluatedAt = options.evaluatedAt;
  const composed = composeEntries(baseDocument, overlay, stableHandles, evaluatedAt, {
    expectedCoverageCount: options.expectedCoverageCount ?? ECS_CONFIRMATION_CART_F8X_COVERAGE_COUNT,
    expectedQuarantineCount: options.expectedQuarantineCount ?? ECS_CONFIRMATION_CART_PROJECTED_QUARANTINE_COUNT,
    expectedF8xCount: options.expectedF8xCount ?? ECS_CONFIRMATION_CART_F8X_EXPECTED_PRODUCT_COUNT
  });
  const source = {
    releaseId: overlay.manifest.releaseId,
    composition: 'validated-base-snapshot-plus-authoritative-f8x-overlay',
    runtimeProductCount: overlay.finalAudit.publicationPlan.staticPlusBasePlusOverlayProductCount,
    baseCart: {
      schemaVersion: baseDocument.schemaVersion,
      releaseId: baseDocument.source.releaseId,
      contentSha256: baseDocument.contentSha256,
      sourceContentSha256: baseDocument.source.contentSha256,
      baseContentSha256: baseDocument.source.baseContentSha256,
      mergedProductCount: baseDocument.source.mergedProductCount,
      productCount: baseDocument.productCount,
      evaluatedAt: baseDocument.evaluatedAt
    },
    reviewedBase: structuredClone(overlay.manifest.baseRelease),
    f8xOverlay: {
      releaseId: overlay.manifest.releaseId,
      baseReleaseId: overlay.manifest.baseRelease.releaseId,
      manifestSha256: overlay.manifestSha256,
      contentSetSha256: overlay.manifest.contentSetSha256,
      productCount: overlay.manifest.counts.productCount,
      routeCount: overlay.manifest.counts.routeCount,
      shardCount: overlay.manifest.counts.shardCount,
      finalAuditFileSha256: overlay.finalAuditFileSha256,
      finalAuditInputSetSha256: overlay.manifest.finalAudit.inputSetSha256,
      aggregateModuleSha256: overlay.manifest.finalAudit.aggregateModuleSha256,
      projectedQuarantineIdentityCount: overlay.manifest.projectedQuarantine.identityCount,
      projectedQuarantineIdentitiesSha256: overlay.manifest.projectedQuarantine.identitiesSha256
    },
    stableHandles: {
      kind: stableHandles.document.kind,
      baseReleaseId: stableHandles.document.source.releaseId,
      entryCount: stableHandles.document.entryCount,
      staticCatalogueSha256: stableHandles.staticCatalogueSha256,
      staticProductCount: stableHandles.staticProductCount,
      contentSha256: stableHandles.document.contentSha256
    }
  };
  if (source.runtimeProductCount !== ECS_CONFIRMATION_CART_RUNTIME_PRODUCT_COUNT) {
    throw new Error('The combined ECS runtime product count is not the audited F8X projection.');
  }
  const document = buildCombinedEcsConfirmationCartIndex(composed.entries, {
    evaluatedAt,
    source,
    composition: composed.composition,
    expectedCount: options.expectedCount ?? null
  });
  validateEcsConfirmationCartIndex(document, { expectedCount: options.expectedCount ?? null });
  return Object.freeze({
    document,
    bytes: Buffer.from(`${JSON.stringify(document)}\n`, 'utf8'),
    baseDocument,
    baseBytes: Buffer.from(`${JSON.stringify(baseDocument)}\n`, 'utf8'),
    overlay,
    stableHandles
  });
}

async function writeAtomically(filename, bytes) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, filename);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const generated = await generateEcsConfirmationCartIndex(options);
  if (options.baseSnapshotOutput) {
    if (options.check) {
      const existingBase = await readFile(options.baseSnapshotOutput);
      if (!existingBase.equals(generated.baseBytes)) throw new Error('The preserved ECS base cart snapshot changed.');
    } else {
      await writeAtomically(options.baseSnapshotOutput, generated.baseBytes);
    }
  }
  if (options.check) {
    const existing = await readFile(options.output);
    if (!existing.equals(generated.bytes)) {
      throw new Error('The checked-in ECS confirmation-cart index is not deterministic or is out of date.');
    }
  } else {
    await writeAtomically(options.output, generated.bytes);
  }
  const status = {
    output: path.relative(PROJECT_ROOT, options.output).replaceAll('\\', '/'),
    productCount: generated.document.productCount,
    f8xEligibleCount: generated.document.composition.f8xEligibleCount,
    retainedBaseEntryCount: generated.document.composition.retainedBaseEntryCount,
    newF8xEligibleCount: generated.document.composition.newF8xEligibleCount,
    projectedQuarantineIdentityCount: generated.document.composition.projectedQuarantineIdentityCount,
    bytes: generated.bytes.length,
    contentSha256: generated.document.contentSha256,
    sourceReleaseId: generated.document.source.releaseId,
    sourceProductCount: generated.document.source.runtimeProductCount,
    evaluatedAt: generated.document.evaluatedAt,
    earliestExpiryAt: generated.document.earliestExpiryAt,
    latestExpiryAt: generated.document.latestExpiryAt,
    check: options.check
  };
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  return status;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch(error => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
