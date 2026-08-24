import { createHash } from 'node:crypto';
import {
  access, lstat, open, readFile, realpath, stat, unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  F8X_OVERLAY_MANIFEST_KIND,
  readReviewedProductShardRelease,
} from './build-reviewed-product-shards.mjs';
import {
  F8X_FINAL_PROFILES,
  F8X_FINAL_SECTIONS,
} from './finalize-f8x-release-audit.mjs';

const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const PRIVATE_IMPORTS_ROOT = path.join(REPOSITORY_ROOT, 'private-imports');
const SCHEMA_VERSION = 1;
const SUPPLIER = 'ECS Tuning';
const QUEUE_KIND = 'ecs-f8x-overlay-supplier-media-recovery-queue';
const FINAL_AUDIT_KIND = 'ecs-f8x-aggregate-import-audit';
const FINAL_AUDIT_VERIFICATION_KIND = 'ecs-f8x-final-release-audit-verification';
const SHA256 = /^[a-f0-9]{64}$/;
const ECS_IDENTITY = /^(?:ES\s*#?\s*)?(\d{3,12})$/i;
const PRODUCT_URL_PATH = /^\/b-[^/?#]+\/[^/?#]+\/[^/?#]+\/$/i;
const PROFILE_KEYS = Object.freeze(Object.keys(F8X_FINAL_PROFILES));
const SECTION_KEYS = Object.freeze(Object.keys(F8X_FINAL_SECTIONS));
const PROFILE_ORDER = new Map(PROFILE_KEYS.map((value, index) => [value, index]));
const SECTION_ORDER = new Map(SECTION_KEYS.map((value, index) => [value, index]));
const MAX_FINAL_AUDIT_BYTES = 16 * 1024 * 1024;

export class F8xOverlayMediaRecoveryQueueError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'F8xOverlayMediaRecoveryQueueError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new F8xOverlayMediaRecoveryQueueError(code, message);
}

function clean(value, maximum = 5_000) {
  return String(value ?? '').normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum);
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
  const seen = new Set();
  function normalize(item) {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) fail('invalid_input_data', 'Media-recovery inputs may not contain non-finite numbers.');
      return item;
    }
    if (Array.isArray(item)) return item.map(entry => normalize(entry === undefined ? null : entry));
    if (plainObject(item)) {
      if (seen.has(item)) fail('invalid_input_data', 'Media-recovery inputs may not contain circular values.');
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
    fail('invalid_input_data', 'Media-recovery inputs must contain JSON-compatible values only.');
  }
  return JSON.stringify(normalize(value));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function dataSha256(value) {
  return sha256(Buffer.from(stableJson(value), 'utf8'));
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function exactTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value ? value : null;
}

function inside(root, target, allowRoot = true) {
  const relative = path.relative(root, target);
  return (allowRoot && relative === '') || (relative !== '' && relative !== '..'
    && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function samePath(left, right) {
  const normalize = value => process.platform === 'win32'
    ? path.resolve(value).toLocaleLowerCase('en-US') : path.resolve(value);
  return normalize(left) === normalize(right);
}

async function canonicalDirectory(filename, code) {
  const requested = path.resolve(filename);
  try {
    const status = await lstat(requested);
    const resolved = await realpath(requested);
    if (!status.isDirectory() || status.isSymbolicLink() || !samePath(requested, resolved)
      || !(await stat(resolved)).isDirectory()) throw new Error();
    return resolved;
  } catch {
    fail(code, `Required directory is missing, linked or invalid: ${filename}`);
  }
}

async function allowedRoots(workDirectory = null) {
  const repository = await canonicalDirectory(REPOSITORY_ROOT, 'invalid_repository_root');
  const privateImports = await canonicalDirectory(PRIVATE_IMPORTS_ROOT, 'invalid_private_import_root');
  const inputRoots = [privateImports];
  const outputRoots = [privateImports];
  let work = null;
  if (workDirectory !== null) {
    if (!path.isAbsolute(workDirectory)) fail('invalid_work_directory', 'The work directory must be absolute.');
    work = await canonicalDirectory(workDirectory, 'invalid_work_directory');
    if (inside(repository, work) || path.parse(work).root === work) {
      fail('invalid_work_directory', 'The work directory must be a non-root directory outside the repository.');
    }
    inputRoots.push(work);
    outputRoots.push(work);
  }
  return { repository, privateImports, work, inputRoots, outputRoots };
}

function containingRoot(target, candidates) {
  return candidates.find(root => inside(root, target)) || null;
}

async function confinedFile(filename, roots, { maximumBytes = Number.MAX_SAFE_INTEGER } = {}) {
  const requested = path.resolve(filename);
  try {
    const status = await lstat(requested);
    const resolved = await realpath(requested);
    if (!status.isFile() || status.isSymbolicLink() || !samePath(requested, resolved)
      || !containingRoot(resolved, roots.inputRoots)) throw new Error();
    const buffer = Buffer.from(await readFile(resolved));
    if (!buffer.length || buffer.length > maximumBytes) throw new Error();
    return { path: resolved, bytes: buffer.length, sha256: sha256(buffer), buffer };
  } catch {
    fail('invalid_input_path', `Input file is missing, linked, oversized or outside private roots: ${filename}`);
  }
}

async function confinedDirectory(filename, roots) {
  const resolved = await canonicalDirectory(filename, 'invalid_input_path');
  if (!containingRoot(resolved, roots.inputRoots)) {
    fail('invalid_input_path', `Input directory is outside private roots: ${filename}`);
  }
  return resolved;
}

function parseJson(snapshot, label) {
  try {
    const value = JSON.parse(snapshot.buffer.toString('utf8'));
    if (!plainObject(value)) throw new Error();
    return value;
  } catch {
    fail('invalid_json_input', `${label} is not a JSON object.`);
  }
}

function canonicalHttpsUrl(value, { hostname, product = false } = {}) {
  const source = clean(value, 2_000);
  try {
    const url = new URL(source);
    if (url.protocol !== 'https:' || url.hostname !== hostname || url.username || url.password
      || url.port || url.search || url.hash || url.toString() !== source
      || (product && !PRODUCT_URL_PATH.test(url.pathname))) return null;
    return source;
  } catch {
    return null;
  }
}

function ecsIdentity(product) {
  const identityFields = [
    product?.ecsPartNumber, product?.sku, product?.identifiers?.ecs, product?.identifiers?.sku,
  ];
  const identities = identityFields.map(value => clean(value, 100).match(ECS_IDENTITY)?.[1] || null);
  const publicKey = clean(product?.publicKey, 100).match(/^ecs-es-(\d{3,12})$/)?.[1] || null;
  const slug = clean(product?.slug, 100).match(/^es-(\d{3,12})$/)?.[1] || null;
  const values = [...identities, publicKey, slug];
  if (values.some(value => !value) || new Set(values).size !== 1) {
    fail('invalid_product_identity', 'An F8X overlay product has missing or conflicting ECS identities.');
  }
  return values[0];
}

function exactMpn(product, identity) {
  const mpn = clean(product?.mpn, 200);
  const identifierMpn = clean(product?.identifiers?.mpn, 200);
  if (!mpn || mpn !== identifierMpn) {
    fail('invalid_product_identity', `ES#${identity} has a missing or conflicting manufacturer part number.`);
  }
  return mpn;
}

function sectionKeyForLabel(value) {
  return SECTION_KEYS.find(key => F8X_FINAL_SECTIONS[key].label === value) || null;
}

function scopeObservation(source, identity) {
  if (!exactKeys(source, [
    'vehicleKey', 'vehicle', 'section', 'category', 'categoryKey',
    'sourceUrl', 'relevancePosition', 'observedAt',
  ])) fail('invalid_f8x_scope', `ES#${identity} has non-canonical F8X selection evidence.`);
  const profile = F8X_FINAL_PROFILES[source.vehicleKey];
  const sectionKey = sectionKeyForLabel(source.section);
  const category = clean(source.category, 300);
  const categoryKey = clean(source.categoryKey, 300);
  const sourceUrl = canonicalHttpsUrl(source.sourceUrl, { hostname: 'www.ecstuning.com' });
  if (!profile || source.vehicle !== profile.vehicle || !sectionKey || !category || !categoryKey
    || !sourceUrl || !Number.isSafeInteger(source.relevancePosition) || source.relevancePosition < 1
    || !exactTimestamp(source.observedAt)) {
    fail('invalid_f8x_scope', `ES#${identity} has invalid F8X vehicle/category evidence.`);
  }
  return {
    vehicleKey: source.vehicleKey,
    vehicle: source.vehicle,
    chassis: profile.chassis,
    sectionKey,
    section: source.section,
    category,
    categoryKey,
    sourceUrl,
    relevancePosition: source.relevancePosition,
    observedAt: source.observedAt,
  };
}

function observationComparator(left, right) {
  return PROFILE_ORDER.get(left.vehicleKey) - PROFILE_ORDER.get(right.vehicleKey)
    || SECTION_ORDER.get(left.sectionKey) - SECTION_ORDER.get(right.sectionKey)
    || left.category.localeCompare(right.category, 'en')
    || left.relevancePosition - right.relevancePosition;
}

function validateF8xScopes(product, identity) {
  if (!Array.isArray(product?.selectionSources) || !product.selectionSources.length) {
    fail('invalid_f8x_scope', `ES#${identity} has no F8X selection evidence.`);
  }
  const observations = product.selectionSources.map(source => scopeObservation(source, identity))
    .sort(observationComparator);
  const placementKeys = observations.map(item => `${item.vehicleKey}|${item.sectionKey}|${item.categoryKey}`);
  if (new Set(placementKeys).size !== placementKeys.length) {
    fail('invalid_f8x_scope', `ES#${identity} repeats one F8X category placement.`);
  }
  const profiles = PROFILE_KEYS.filter(key => observations.some(item => item.vehicleKey === key));
  const sections = SECTION_KEYS.filter(key => observations.some(item => item.sectionKey === key));
  const expectedCategories = [
    'bmw-f8x', ...profiles, ...sections.map(key => `bmw-f8x-${key}`),
  ].sort();
  const actualCategories = product?.filters?.categories;
  if (!Array.isArray(actualCategories) || new Set(actualCategories).size !== actualCategories.length
    || stableJson([...actualCategories].sort()) !== stableJson(expectedCategories)) {
    fail('invalid_f8x_scope', `ES#${identity} does not have exact canonical F8X category filters.`);
  }
  const fitments = Array.isArray(product?.fitments) ? product.fitments : [];
  const fitmentProfiles = fitments.map(fitment => PROFILE_KEYS.find(key => {
    const profile = F8X_FINAL_PROFILES[key];
    return fitment?.make === 'BMW' && fitment?.model === profile.model
      && fitment?.generation === profile.chassis
      && stableJson(fitment?.models) === stableJson([profile.model])
      && stableJson(fitment?.chassis) === stableJson([profile.chassis])
      && stableJson(fitment?.engines) === stableJson(['S55'])
      && fitment?.confidence === 'possible';
  }));
  if (fitmentProfiles.some(value => !value) || new Set(fitmentProfiles).size !== fitmentProfiles.length
    || stableJson([...fitmentProfiles].sort()) !== stableJson([...profiles].sort())) {
    fail('invalid_f8x_scope', `ES#${identity} structured fitments differ from its category observations.`);
  }
  return {
    profiles,
    chassis: profiles.map(key => F8X_FINAL_PROFILES[key].chassis),
    sections,
    categories: [...new Set(observations.map(item => item.category))].sort(),
    observations,
  };
}

function supplierMediaState(product, identity) {
  const images = product?.images;
  const sourceUrl = clean(product?.imageSourceUrl, 2_000);
  if (!Array.isArray(images)) fail('invalid_media_state', `ES#${identity} has no images array.`);
  if (product.imageStatus === 'supplier-media-unavailable') {
    if (images.length || sourceUrl) {
      fail('invalid_media_state', `ES#${identity} marks supplier media unavailable while retaining an image.`);
    }
    return 'missing';
  }
  if (product.imageStatus !== 'supplier-media-verified' || !images.length || !sourceUrl) {
    fail('invalid_media_state', `ES#${identity} has an unsupported or incomplete supplier-media state.`);
  }
  const normalized = images.map((image, index) => {
    const src = canonicalHttpsUrl(image?.src, { hostname: 'assets.ecstuning.com' });
    const original = canonicalHttpsUrl(image?.sourceUrl, { hostname: 'assets.ecstuning.com' });
    if (!src || src !== original) {
      fail('invalid_media_state', `ES#${identity} supplier image ${index + 1} is not exact official ECS media.`);
    }
    return src;
  });
  if (sourceUrl !== normalized[0]) {
    fail('invalid_media_state', `ES#${identity} primary supplier image differs from its verified image list.`);
  }
  return 'verified';
}

function expectedBaseRelease(binding) {
  return {
    releaseId: binding.releaseId,
    manifestSha256: binding.manifestFileSha256,
    contentSetSha256: binding.contentSetSha256,
    artifactSetSha256: binding.artifactSetSha256,
    productCount: binding.productCount,
    routeCount: binding.routeCount,
    shardCount: binding.shardCount,
    quarantinedIdentityCount: binding.quarantinedIdentityCount,
    productsSha256: binding.productsSha256,
  };
}

function sectionProductCounts(products) {
  return Object.fromEntries(SECTION_KEYS.map(sectionKey => [sectionKey, products.filter(product => (
    product.selectionSources.some(source => sectionKeyForLabel(source.section) === sectionKey)
  )).length]));
}

function validateFinalAuditBinding(finalAudit, release) {
  const verification = finalAudit?.finalReleaseAudit;
  const inputChecksums = verification?.inputChecksums;
  const manifest = release.manifest;
  const plan = finalAudit?.publicationPlan;
  const mergeAudit = finalAudit?.publicationMergeAudit;
  const projected = finalAudit?.projectedQuarantinedEcsIdentities;
  if (!plainObject(finalAudit) || finalAudit.kind !== FINAL_AUDIT_KIND
    || finalAudit.supplier !== SUPPLIER || !exactTimestamp(finalAudit.generatedAt)
    || finalAudit.generatedAt !== manifest.generatedAt
    || !plainObject(verification) || verification.schemaVersion !== 1
    || verification.kind !== FINAL_AUDIT_VERIFICATION_KIND
    || verification.verifiedAtSourceTimestamp !== finalAudit.generatedAt
    || !SHA256.test(verification.inputSetSha256 || '') || !plainObject(inputChecksums)
    || dataSha256(inputChecksums) !== verification.inputSetSha256
    || manifest.finalAudit.kind !== verification.kind
    || manifest.finalAudit.inputSetSha256 !== verification.inputSetSha256
    || manifest.finalAudit.aggregateModuleSha256 !== inputChecksums.aggregateModule?.sha256
    || !SHA256.test(manifest.finalAudit.aggregateModuleSha256 || '')) {
    fail('final_audit_mismatch', 'The F8X overlay is not bound to the exact checksum-verified final audit.');
  }
  const currentReleaseChecksum = inputChecksums.currentReviewedShardRelease;
  if (!plainObject(currentReleaseChecksum)) {
    fail('final_audit_mismatch', 'The F8X final audit has no reviewed base-release checksum binding.');
  }
  const { fileCount: ignoredFileCount, ...currentReleaseBinding } = currentReleaseChecksum;
  void ignoredFileCount;
  const base = expectedBaseRelease(currentReleaseChecksum);
  if (stableJson(base) !== stableJson(manifest.baseRelease)
    || stableJson(base) !== stableJson(plan?.baseRelease)
    || stableJson(verification.currentReviewedShardRelease) !== stableJson(currentReleaseBinding)) {
    fail('final_audit_mismatch', 'The F8X final audit is bound to a different reviewed base release.');
  }
  if (!Array.isArray(projected) || stableJson(projected) !== stableJson(manifest.projectedQuarantine.identities)
    || finalAudit.quarantinedIdentityCount !== projected.length
    || plan?.mode !== 'separate-f8x-overlay' || plan.overlayProductCount !== release.products.length
    || stableJson(plan.projectedQuarantine) !== stableJson({
      identityCount: manifest.projectedQuarantine.identityCount,
      identitiesSha256: manifest.projectedQuarantine.identitiesSha256,
    })
    || mergeAudit?.publishedOverlayProductCount !== release.products.length
    || mergeAudit?.projectedQuarantinedIdentityCount !== projected.length
    || finalAudit.captureProgress?.stage !== 'complete' || finalAudit.captureProgress?.complete !== true
    || finalAudit.captureProgress?.importPolicy !== 'all-21-f8x-scopes-reconciled'
    || stableJson([...(finalAudit.captureProgress?.includedSections || [])].sort())
      !== stableJson([...SECTION_KEYS].sort())
    || !Array.isArray(finalAudit.captureProgress?.excludedSections)
    || finalAudit.captureProgress.excludedSections.length) {
    fail('final_audit_mismatch', 'The final audit does not authorize this exact complete F8X overlay and quarantine set.');
  }
  const counts = sectionProductCounts(release.products);
  for (const sectionKey of SECTION_KEYS) {
    if (finalAudit.sections?.[sectionKey]?.f8xOverlayProductCount !== counts[sectionKey]
      || finalAudit.captureProgress?.sections?.[sectionKey]?.productCount !== counts[sectionKey]
      || finalAudit.captureProgress?.sections?.[sectionKey]?.complete !== true
      || finalAudit.captureProgress?.sections?.[sectionKey]?.included !== true) {
      fail('final_audit_mismatch', `The F8X ${sectionKey} media scope differs from the final audit.`);
    }
  }
  return verification;
}

function sourcePositions(release) {
  return new Map(release.index.routes.map(route => [route.publicKey, {
    sourceShard: release.manifest.shards[route.shardSequence - 1]?.file,
    sourceProductIndex: route.shardProductIndex,
  }]));
}

function orderedCounts(items, values) {
  const counts = new Map();
  for (const item of items) {
    for (const value of values(item)) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right, 'en')));
}

export function buildF8xOverlayMediaRecoveryQueue({
  release,
  finalAudit,
  finalAuditSnapshot,
  inputSetSha256,
}) {
  if (!plainObject(release) || release.manifest?.kind !== F8X_OVERLAY_MANIFEST_KIND
    || !Array.isArray(release.products) || !release.products.length
    || !plainObject(release.releaseBinding) || !plainObject(finalAuditSnapshot)
    || !Number.isSafeInteger(finalAuditSnapshot.bytes) || finalAuditSnapshot.bytes < 1
    || !SHA256.test(finalAuditSnapshot.sha256 || '') || !SHA256.test(inputSetSha256 || '')) {
    fail('invalid_input', 'An exact F8X overlay, final-audit snapshot and input checksum are required.');
  }
  const verification = validateFinalAuditBinding(finalAudit, release);
  const projectedQuarantine = new Set(release.manifest.projectedQuarantine.identities);
  const positions = sourcePositions(release);
  const seen = new Set();
  const items = [];
  let verifiedSupplierMediaProductCount = 0;
  for (const product of release.products) {
    const identity = ecsIdentity(product);
    if (seen.has(identity)) fail('duplicate_product_identity', `The F8X overlay repeats ES#${identity}.`);
    seen.add(identity);
    if (projectedQuarantine.has(identity)) {
      fail('quarantined_product', `Projected-quarantine identity ES#${identity} remains in the F8X overlay.`);
    }
    const mpn = exactMpn(product, identity);
    const productUrl = canonicalHttpsUrl(product.originalUrl, {
      hostname: 'www.ecstuning.com', product: true,
    });
    const title = clean(product.title, 500);
    if (!productUrl || !title) fail('invalid_product', `ES#${identity} has no canonical product URL or title.`);
    const scope = validateF8xScopes(product, identity);
    const mediaState = supplierMediaState(product, identity);
    if (mediaState === 'verified') {
      verifiedSupplierMediaProductCount += 1;
      continue;
    }
    const position = positions.get(product.publicKey);
    if (!position?.sourceShard || !Number.isSafeInteger(position.sourceProductIndex)) {
      fail('invalid_source_reference', `ES#${identity} has no exact overlay shard position.`);
    }
    const brandSupplied = product.brandSupplied === true;
    const brand = clean(product.brand, 200);
    if (brandSupplied && !brand) fail('invalid_product', `ES#${identity} marks an empty brand as supplier-provided.`);
    items.push({
      ecsPartNumber: `ES#${identity}`,
      mpn,
      productUrl,
      title,
      brand: brandSupplied ? brand : null,
      profiles: scope.profiles,
      chassis: scope.chassis,
      sections: scope.sections,
      categories: scope.categories,
      scopeObservations: scope.observations,
      missingDescription: product.detailedDescriptionAvailable !== true,
      missingBrand: !brandSupplied,
      sourceShard: position.sourceShard,
      sourceProductIndex: position.sourceProductIndex,
    });
  }
  const ordered = items.sort((left, right) => Number(left.ecsPartNumber.slice(3))
    - Number(right.ecsPartNumber.slice(3)));
  const identitySet = ordered.map(item => item.ecsPartNumber).sort();
  const identitySetSha256 = sha256(Buffer.from(identitySet.join('\n'), 'utf8'));
  const recordsSha256 = dataSha256(ordered);
  return {
    schemaVersion: SCHEMA_VERSION,
    supplier: SUPPLIER,
    kind: QUEUE_KIND,
    verifiedAtSourceTimestamp: release.manifest.generatedAt,
    sourceOverlayRelease: { ...release.releaseBinding },
    baseRelease: { ...release.manifest.baseRelease },
    finalAudit: {
      kind: verification.kind,
      inputSetSha256: verification.inputSetSha256,
      aggregateModuleSha256: release.manifest.finalAudit.aggregateModuleSha256,
      fileBytes: finalAuditSnapshot.bytes,
      fileSha256: finalAuditSnapshot.sha256,
      canonicalSha256: dataSha256(finalAudit),
    },
    overlayScope: { ...release.manifest.overlayScope },
    projectedQuarantine: {
      identityCount: release.manifest.projectedQuarantine.identityCount,
      identitiesSha256: release.manifest.projectedQuarantine.identitiesSha256,
    },
    verification: { inputSetSha256 },
    policy: {
      access: 'public-product-detail-pages-only',
      media: 'verified-supplier-media-only',
      fitment: 'possible-confirmation-required',
      noFabrication: true,
      noChallengeBypass: true,
    },
    counts: {
      overlayProductCount: release.products.length,
      recoveryCandidateCount: ordered.length,
      verifiedSupplierMediaProductCount,
      missingDescriptionCount: ordered.filter(item => item.missingDescription).length,
      missingBrandCount: ordered.filter(item => item.missingBrand).length,
      candidateScopeCount: new Set(ordered.flatMap(item => item.scopeObservations.map(observation => (
        `${observation.vehicleKey}|${observation.sectionKey}`
      )))).size,
      byVehicle: orderedCounts(ordered, item => item.profiles),
      bySection: orderedCounts(ordered, item => item.sections),
      byCategory: orderedCounts(ordered, item => item.categories),
    },
    identitySetSha256,
    recordsSha256,
    items: ordered,
  };
}

async function assertSnapshotUnchanged(snapshot) {
  try {
    const resolved = await realpath(snapshot.path);
    const buffer = Buffer.from(await readFile(resolved));
    if (!samePath(resolved, snapshot.path) || buffer.length !== snapshot.bytes
      || sha256(buffer) !== snapshot.sha256) throw new Error();
  } catch {
    fail('checksum_drift', `Media-recovery input changed during verification: ${snapshot.path}`);
  }
}

export async function verifyF8xOverlayMediaRecoveryFiles({
  overlayReleaseDirectory,
  finalAuditPath,
  workDirectory = null,
  expectedInputSetSha256 = null,
}) {
  const roots = await allowedRoots(workDirectory);
  const overlayRoot = await confinedDirectory(overlayReleaseDirectory, roots);
  const finalAuditSnapshot = await confinedFile(finalAuditPath, roots, {
    maximumBytes: MAX_FINAL_AUDIT_BYTES,
  });
  let release;
  try {
    release = await readReviewedProductShardRelease(overlayRoot);
  } catch (error) {
    fail('invalid_overlay_release', `The F8X overlay release failed strict verification: ${error?.code || 'invalid_release'}.`);
  }
  const sidecarSnapshot = await confinedFile(path.join(overlayRoot, 'manifest.json.sha256'), roots, {
    maximumBytes: 256,
  });
  const finalAudit = parseJson(finalAuditSnapshot, 'The F8X final audit');
  const inputChecksums = {
    overlayRelease: {
      ...release.releaseBinding,
      fileCount: release.artifactSnapshots.length,
      manifestSidecarSha256: sidecarSnapshot.sha256,
    },
    finalAudit: {
      bytes: finalAuditSnapshot.bytes,
      sha256: finalAuditSnapshot.sha256,
      canonicalSha256: dataSha256(finalAudit),
      inputSetSha256: finalAudit.finalReleaseAudit?.inputSetSha256,
    },
  };
  const inputSetSha256 = dataSha256(inputChecksums);
  if (expectedInputSetSha256 !== null
    && (!SHA256.test(expectedInputSetSha256) || expectedInputSetSha256 !== inputSetSha256)) {
    fail('checksum_drift', 'The F8X media-recovery input set differs from the pinned checksum.');
  }
  const queue = buildF8xOverlayMediaRecoveryQueue({
    release, finalAudit, finalAuditSnapshot, inputSetSha256,
  });
  await Promise.all([
    ...release.artifactSnapshots.map(assertSnapshotUnchanged),
    assertSnapshotUnchanged(sidecarSnapshot),
    assertSnapshotUnchanged(finalAuditSnapshot),
  ]);
  return {
    queue,
    queueSha256: sha256(jsonBuffer(queue)),
    inputSetSha256,
    inputChecksums,
    roots,
  };
}

async function outputFilename(outputPath, roots) {
  const requested = path.resolve(outputPath);
  const parent = path.dirname(requested);
  const resolvedParent = await canonicalDirectory(parent, 'invalid_output_path');
  if (!containingRoot(resolvedParent, roots.outputRoots) || !samePath(parent, resolvedParent)
    || !inside(resolvedParent, requested, false)) {
    fail('invalid_output_path', 'Queue output must be a direct file in an existing private directory.');
  }
  return requested;
}

async function exists(filename) {
  try {
    await access(filename);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function writeF8xOverlayMediaRecoveryQueueCreateOnly(outputPath, queue, roots) {
  if (!plainObject(queue) || queue.kind !== QUEUE_KIND || !plainObject(roots)) {
    fail('invalid_output', 'A verified F8X media-recovery queue and private roots are required.');
  }
  const filename = await outputFilename(outputPath, roots);
  const sidecar = `${filename}.sha256`;
  if (await exists(filename) || await exists(sidecar)) {
    fail('output_exists', 'F8X media-recovery queue outputs are create-only.');
  }
  const buffer = jsonBuffer(queue);
  const checksum = sha256(buffer);
  let outputHandle;
  let sidecarHandle;
  let outputCreated = false;
  let sidecarCreated = false;
  let complete = false;
  try {
    outputHandle = await open(filename, 'wx', 0o600);
    outputCreated = true;
    sidecarHandle = await open(sidecar, 'wx', 0o600);
    sidecarCreated = true;
    await outputHandle.writeFile(buffer);
    await sidecarHandle.writeFile(`${checksum}  ${path.basename(filename)}\n`, 'utf8');
    await Promise.all([outputHandle.sync(), sidecarHandle.sync()]);
    complete = true;
  } catch (error) {
    if (error?.code === 'EEXIST') fail('output_exists', 'F8X media-recovery queue outputs are create-only.');
    throw error;
  } finally {
    await outputHandle?.close();
    await sidecarHandle?.close();
    if (!complete) {
      if (sidecarCreated) await unlink(sidecar).catch(() => {});
      if (outputCreated) await unlink(filename).catch(() => {});
    }
  }
  const [written, checksumText] = await Promise.all([readFile(filename), readFile(sidecar, 'utf8')]);
  if (sha256(written) !== checksum || checksumText !== `${checksum}  ${path.basename(filename)}\n`) {
    if (sidecarCreated) await unlink(sidecar).catch(() => {});
    if (outputCreated) await unlink(filename).catch(() => {});
    fail('output_verify_failed', 'The private F8X media-recovery queue failed read-back verification.');
  }
  return { filename, sidecar, bytes: buffer.length, sha256: checksum };
}

function parseArguments(argv) {
  const options = { verifyOnly: false };
  const valueOptions = new Map([
    ['--work-dir', 'workDirectory'],
    ['--overlay-release', 'overlayReleaseDirectory'],
    ['--final-audit', 'finalAuditPath'],
    ['--output', 'outputPath'],
    ['--expect-input-set-sha256', 'expectedInputSetSha256'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--verify-only') {
      if (options.verifyOnly) fail('invalid_arguments', 'Duplicate --verify-only option.');
      options.verifyOnly = true;
      continue;
    }
    const key = valueOptions.get(name);
    const value = argv[index + 1];
    if (!key || !value || value.startsWith('--') || Object.hasOwn(options, key)) {
      fail('invalid_arguments', `Unsupported, duplicate or incomplete option: ${name}`);
    }
    options[key] = value;
    index += 1;
  }
  if (!options.overlayReleaseDirectory || !options.finalAuditPath
    || (options.verifyOnly && (options.outputPath || options.expectedInputSetSha256))
    || (!options.verifyOnly && (!options.outputPath || !options.expectedInputSetSha256))) {
    fail('invalid_arguments', 'Use --verify-only with overlay/final-audit inputs, or provide --output and --expect-input-set-sha256 for a create-only pass.');
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const verified = await verifyF8xOverlayMediaRecoveryFiles(options);
  if (options.verifyOnly) {
    process.stdout.write(`${JSON.stringify({
      status: 'verified-no-write',
      inputSetSha256: verified.inputSetSha256,
      queueSha256: verified.queueSha256,
      overlayReleaseId: verified.queue.sourceOverlayRelease.releaseId,
      finalAuditInputSetSha256: verified.queue.finalAudit.inputSetSha256,
      counts: verified.queue.counts,
    })}\n`);
    return;
  }
  const written = await writeF8xOverlayMediaRecoveryQueueCreateOnly(
    options.outputPath,
    verified.queue,
    verified.roots,
  );
  process.stdout.write(`${JSON.stringify({
    status: 'created',
    inputSetSha256: verified.inputSetSha256,
    queueSha256: written.sha256,
    overlayReleaseId: verified.queue.sourceOverlayRelease.releaseId,
    counts: verified.queue.counts,
    output: written.filename,
    checksumFile: written.sidecar,
  })}\n`);
}

if (process.argv[1] && samePath(process.argv[1], fileURLToPath(import.meta.url))) {
  main().catch(error => {
    process.stderr.write(`${error?.code || 'f8x_media_recovery_error'}: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export const __test = Object.freeze({
  dataSha256,
  jsonBuffer,
  parseArguments,
  sha256,
});
