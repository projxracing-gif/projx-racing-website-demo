import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  lstat, mkdir, open, readdir, realpath, stat, unlink
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REVIEWED_ECS_PRODUCTS, mergeReviewedEcsProducts } from '../../server/ecs-reviewed-catalog.js';
import {
  buildF8xObservationEvidenceBinding,
  parseExactF8xAggregateModule,
  snapshotTrustedCurrentReviewedGraph,
} from './finalize-f8x-release-audit.mjs';
import {
  ECS_F8X_OVERLAY_SCOPE,
  validateCanonicalEcsF8xOverlayProduct,
} from '../../server/ecs-f8x-overlay-contract.js';

export const REVIEWED_SHARD_SCHEMA_VERSION = 1;
export const REVIEWED_SHARD_SIZE = 128;
export const REVIEWED_SHARD_MAX_BYTES = 4 * 1024 * 1024;
export const REVIEWED_INDEX_MAX_BYTES = 64 * 1024 * 1024;
export const REVIEWED_PRODUCT_MAX_COUNT = 50_000;
export const REVIEWED_BMW_M3_SECTIONS = Object.freeze([
  'braking', 'engine', 'exterior', 'interior', 'performance', 'suspension', 'steering'
]);
export const F8X_OVERLAY_MANIFEST_KIND = 'ecs-reviewed-f8x-overlay-shard-manifest';
export const F8X_OVERLAY_INDEX_KIND = 'ecs-reviewed-f8x-overlay-routing-index';
export const F8X_OVERLAY_SHARD_KIND = 'ecs-reviewed-f8x-overlay-product-shard';

const PRODUCT_KEY = /^ecs-es-\d{3,12}$/;
const PRODUCT_SLUG = /^es-\d{3,12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const RELEASE_ID = /^\d{8}T\d{9}Z-[a-f0-9]{16}$/;
const F8X_FINAL_AUDIT_KIND = 'ecs-f8x-final-release-audit-verification';
const F8X_IMPORT_AUDIT_KIND = 'ecs-f8x-aggregate-import-audit';
const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const PRIVATE_IMPORTS_ROOT = path.join(REPOSITORY_ROOT, 'private-imports');
const OUTPUT_CLAIM_FILE = '.projx-reviewed-release-write.claim';

export class ReviewedShardBuildError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReviewedShardBuildError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ReviewedShardBuildError(code, message);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function stableJson(value) {
  const seen = new Set();
  function normalize(item) {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) fail('invalid_audit', 'Release audit data may not contain non-finite numbers.');
      return item;
    }
    if (Array.isArray(item)) return item.map(entry => normalize(entry === undefined ? null : entry));
    if (plainObject(item)) {
      if (seen.has(item)) fail('invalid_audit', 'Release audit data may not contain circular values.');
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
    fail('invalid_audit', 'Release audit data must contain JSON-compatible values only.');
  }
  return JSON.stringify(normalize(value));
}

function dataSha256(value) {
  return sha256(Buffer.from(stableJson(value), 'utf8'));
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
}

function clean(value, maximum = 5_000) {
  return String(value ?? '').normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function identity(value) {
  return clean(value, 20_000).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function ecsIdentity(product) {
  for (const value of [product?.ecsPartNumber, product?.identifiers?.ecs, product?.sku]) {
    const match = String(value ?? '').trim().match(/^(?:ES\s*#?\s*)?(\d{3,12})$/i);
    if (match) return match[1];
  }
  return String(product?.publicKey ?? '').trim().match(/^ecs-es-(\d{3,12})$/i)?.[1] || null;
}

function productsByEcsIdentity(products, label) {
  if (!Array.isArray(products)) fail('invalid_product_input', `${label} must be an array.`);
  const result = new Map();
  for (const [index, product] of products.entries()) {
    const key = ecsIdentity(product);
    if (!key) fail('invalid_product_identity', `${label} product ${index + 1} has no canonical ECS identity.`);
    if (result.has(key)) fail('duplicate_product_identity', `${label} contains duplicate ES#${key}.`);
    result.set(key, product);
  }
  return result;
}

export function mergeReviewedShardOverlay(currentProducts, overlayProducts) {
  const currentByIdentity = productsByEcsIdentity(currentProducts, 'The current reviewed shard release');
  productsByEcsIdentity(overlayProducts, 'The reviewed overlay');
  let merged;
  try {
    merged = mergeReviewedEcsProducts(currentProducts, overlayProducts);
  } catch (error) {
    fail(
      'overlay_identity_conflict',
      `The reviewed overlay conflicts with the current shard release: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const mergedByIdentity = productsByEcsIdentity(merged, 'The merged reviewed shard candidate');
  for (const [key, current] of currentByIdentity) {
    const candidate = mergedByIdentity.get(key);
    if (!candidate) fail('current_product_removed', `The merged candidate removed current product ES#${key}.`);
    if (candidate.publicKey !== current.publicKey || candidate.slug !== current.slug) {
      fail('current_handle_changed', `The merged candidate changed the stable public handle for ES#${key}.`);
    }
  }
  return merged;
}

function projectedRuntimeUnion(baseProducts, overlayProducts, projectedQuarantine) {
  const projected = new Set(projectedQuarantine);
  const currentRuntime = mergeReviewedShardOverlay(REVIEWED_ECS_PRODUCTS, baseProducts);
  const removedIdentities = [...productsByEcsIdentity(currentRuntime, 'The current reviewed runtime').keys()]
    .filter(identityValue => projected.has(identityValue)).sort();
  const survivingStatic = REVIEWED_ECS_PRODUCTS.filter(product => !projected.has(ecsIdentity(product)));
  const survivingBase = baseProducts.filter(product => !projected.has(ecsIdentity(product)));
  const staticPlusBase = mergeReviewedShardOverlay(survivingStatic, survivingBase);
  return Object.freeze({
    currentRuntime,
    removedIdentities: Object.freeze(removedIdentities),
    products: Object.freeze(mergeReviewedShardOverlay(staticPlusBase, overlayProducts)),
  });
}

function exactSectionKeys(value) {
  return plainObject(value)
    && Object.keys(value).sort().join('\0') === [...REVIEWED_BMW_M3_SECTIONS].sort().join('\0');
}

function sectionIdentityCounts(products, label) {
  const identities = productsByEcsIdentity(products, label);
  const bySection = Object.fromEntries(REVIEWED_BMW_M3_SECTIONS.map(key => [key, new Set()]));
  for (const [key, product] of identities) {
    for (const section of productSections(product)) {
      if (bySection[section]) bySection[section].add(key);
    }
  }
  return Object.fromEntries(REVIEWED_BMW_M3_SECTIONS.map(key => [key, bySection[key].size]));
}

function f8xAuditEnvelope(audit) {
  const verification = audit?.finalReleaseAudit;
  const inputChecksums = verification?.inputChecksums;
  if (!plainObject(audit) || audit.kind !== F8X_IMPORT_AUDIT_KIND
    || verification?.schemaVersion !== 1 || verification.kind !== F8X_FINAL_AUDIT_KIND
    || verification.verifiedAtSourceTimestamp !== canonicalTimestamp(audit.generatedAt)
    || !SHA256.test(verification.inputSetSha256 || '') || !plainObject(inputChecksums)
    || dataSha256(inputChecksums) !== verification.inputSetSha256) {
    fail('invalid_f8x_final_audit', 'The overlay requires the exact checksum-bound F8X final-release audit.');
  }
  return { verification, inputChecksums };
}

function isF8xReleaseAudit(audit) {
  return audit?.kind === F8X_IMPORT_AUDIT_KIND
    || audit?.finalReleaseAudit?.kind === F8X_FINAL_AUDIT_KIND
    || audit?.publicationPlan?.mode === 'separate-f8x-overlay';
}

function validateOverlayProduct(product, label, { compact = false } = {}) {
  try {
    return validateCanonicalEcsF8xOverlayProduct(product, { compact, label });
  } catch (error) {
    fail('invalid_f8x_overlay_product', error instanceof Error ? error.message : String(error));
  }
}

export function validateF8xOverlayModuleSnapshot(audit, moduleBuffer) {
  const { verification, inputChecksums } = f8xAuditEnvelope(audit);
  const expected = inputChecksums.aggregateModule;
  if (!Buffer.isBuffer(moduleBuffer) || !plainObject(expected)
    || !safeIntegerForRead(expected.bytes, 1, Number.MAX_SAFE_INTEGER)
    || !SHA256.test(expected.sha256 || '') || moduleBuffer.length !== expected.bytes
    || sha256(moduleBuffer) !== expected.sha256) {
    fail('f8x_overlay_checksum_mismatch', 'The F8X overlay module differs from the finalized module bytes.');
  }
  return { verification, inputChecksums };
}

export function validateF8xOverlayBuildBinding({
  audit,
  overlayModuleBuffer,
  aggregateProducts,
  aggregateQuarantine,
  overlayProducts,
  currentRelease,
  currentReviewedModuleGraph,
  runtimeUnionProducts,
}) {
  const { verification, inputChecksums } = validateF8xOverlayModuleSnapshot(audit, overlayModuleBuffer);
  const base = inputChecksums.currentReviewedShardRelease;
  if (!Array.isArray(aggregateProducts) || !Array.isArray(aggregateQuarantine)
    || !Array.isArray(overlayProducts)
    || !plainObject(inputChecksums.aggregateProducts)
    || inputChecksums.aggregateProducts.count !== aggregateProducts.length
    || !SHA256.test(inputChecksums.aggregateProducts.sha256 || '')
    || inputChecksums.aggregateProducts.sha256 !== dataSha256(aggregateProducts)
    || !plainObject(inputChecksums.aggregateQuarantine)
    || inputChecksums.aggregateQuarantine.count !== aggregateQuarantine.length
    || !SHA256.test(inputChecksums.aggregateQuarantine.sha256 || '')
    || inputChecksums.aggregateQuarantine.sha256 !== dataSha256(aggregateQuarantine)) {
    fail('f8x_overlay_data_mismatch', 'The F8X overlay products or quarantine differ from the finalized data.');
  }
  const quarantineIdentities = new Set();
  for (const value of aggregateQuarantine) {
    const match = String(value ?? '').trim().match(/^(?:ES\s*#?\s*)?(\d{3,12})$/i);
    if (!match || quarantineIdentities.has(match[1])) {
      fail('f8x_overlay_data_mismatch', 'The F8X overlay quarantine contains an invalid or duplicate identity.');
    }
    quarantineIdentities.add(match[1]);
  }
  const actualBaseChecksum = plainObject(currentRelease?.releaseBinding)
    ? { ...currentRelease.releaseBinding, fileCount: currentRelease.artifactSnapshots?.length }
    : null;
  if (!plainObject(currentRelease) || !plainObject(currentRelease.manifest)
    || !Array.isArray(currentRelease.products) || !plainObject(base)
    || !plainObject(actualBaseChecksum) || stableJson(base) !== stableJson(actualBaseChecksum)
    || stableJson(verification.currentReviewedShardRelease) !== stableJson(currentRelease.releaseBinding)) {
    fail('f8x_base_release_mismatch', 'The current reviewed shard release differs from the finalized base release.');
  }
  const plan = audit.publicationPlan;
  const expectedPlanBase = {
    releaseId: currentRelease.releaseBinding.releaseId,
    manifestSha256: currentRelease.releaseBinding.manifestFileSha256,
    contentSetSha256: currentRelease.releaseBinding.contentSetSha256,
    artifactSetSha256: currentRelease.releaseBinding.artifactSetSha256,
    productCount: currentRelease.releaseBinding.productCount,
    routeCount: currentRelease.releaseBinding.routeCount,
    shardCount: currentRelease.releaseBinding.shardCount,
    quarantinedIdentityCount: currentRelease.releaseBinding.quarantinedIdentityCount,
    productsSha256: currentRelease.releaseBinding.productsSha256,
  };
  if (!plainObject(plan) || plan.mode !== 'separate-f8x-overlay'
    || plan.overlayProductCount !== overlayProducts.length
    || stableJson(plan.baseRelease) !== stableJson(expectedPlanBase)) {
    fail('f8x_publication_plan_mismatch', 'The F8X audit does not authorize a separate overlay against this exact base release.');
  }

  const projectedQuarantine = audit.projectedQuarantinedEcsIdentities;
  if (!Array.isArray(projectedQuarantine)
    || projectedQuarantine.some(value => typeof value !== 'string' || !/^\d{3,12}$/.test(value))
    || new Set(projectedQuarantine).size !== projectedQuarantine.length
    || stableJson(projectedQuarantine) !== stableJson([...projectedQuarantine].sort())
    || !plainObject(plan.projectedQuarantine)
    || plan.projectedQuarantine.identityCount !== projectedQuarantine.length
    || plan.projectedQuarantine.identitiesSha256 !== dataSha256(projectedQuarantine)) {
    fail('f8x_quarantine_binding_mismatch', 'The F8X projected quarantine identity list is invalid.');
  }
  const projectedSet = new Set(projectedQuarantine);
  const projection = projectedRuntimeUnion(currentRelease.products, overlayProducts, projectedQuarantine);
  const expectedRuntimeUnion = projection.products;
  if (!Array.isArray(runtimeUnionProducts)
    || dataSha256(runtimeUnionProducts) !== dataSha256(expectedRuntimeUnion)) {
    fail('f8x_candidate_union_mismatch', 'The reviewed runtime union is not the exact finalized static-plus-base-plus-F8X merge.');
  }
  const overlayCounts = sectionIdentityCounts(overlayProducts, 'The finalized F8X overlay');
  const progress = audit.captureProgress;
  const publication = audit.publicationMergeAudit;
  const overlayByIdentity = productsByEcsIdentity(overlayProducts, 'The F8X overlay quarantine check');
  if (!plainObject(plan.priorQuarantine) || !plainObject(plan.incomingQuarantine)
    || !plainObject(plan.projectedQuarantine)
    || plan.incomingQuarantine.identityCount !== aggregateQuarantine.length
    || plan.incomingQuarantine.identitiesSha256 !== dataSha256([...quarantineIdentities].sort())
    || [...quarantineIdentities].some(identityValue => !projectedSet.has(identityValue))
    || plan.priorQuarantine.identityCount !== currentRelease.releaseBinding.quarantinedIdentityCount
    || plan.priorQuarantine.identityCount > projectedQuarantine.length
    || plan.incomingQuarantine.identityCount > projectedQuarantine.length
    || projectedQuarantine.length
      > plan.priorQuarantine.identityCount + plan.incomingQuarantine.identityCount
    || plan.projectedQuarantine.identityCount !== projectedQuarantine.length
    || plan.projectedQuarantine.identitiesSha256 !== dataSha256(projectedQuarantine)
    || audit.priorReviewedQuarantine?.sourceReleaseId !== currentRelease.releaseBinding.releaseId
    || audit.priorReviewedQuarantine?.identityCount !== plan.priorQuarantine.identityCount
    || audit.priorReviewedQuarantine?.identitySetSha256 !== plan.priorQuarantine.identitiesSha256
    || projectedQuarantine.some(identity => overlayByIdentity.has(identity))
    || dataSha256(overlayProducts) !== dataSha256(aggregateProducts.filter(product => (
      !projectedSet.has(ecsIdentity(product))
    )))) {
    fail('f8x_quarantine_binding_mismatch', 'The F8X projected quarantine does not match the finalized prior-plus-incoming evidence.');
  }
  const staticChecksum = inputChecksums.currentReviewedProducts;
  const staticGraphChecksum = inputChecksums.currentReviewedModuleGraph;
  let observationEvidence;
  try {
    observationEvidence = buildF8xObservationEvidenceBinding(
      aggregateProducts,
      Array.isArray(audit.quarantine) ? audit.quarantine : [],
    );
  } catch (error) {
    fail(
      'f8x_observation_binding_mismatch',
      `The F8X observation evidence is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const detailedQuarantine = Array.isArray(audit.quarantine) ? audit.quarantine : [];
  const detailedQuarantineIdentities = detailedQuarantine.map(item => (
    String(item?.ecsPartNumber ?? '').trim().match(/^(?:ES\s*#?\s*)?(\d{3,12})$/i)?.[1] || null
  ));
  if (detailedQuarantineIdentities.some(value => !value)
    || new Set(detailedQuarantineIdentities).size !== detailedQuarantineIdentities.length
    || stableJson([...detailedQuarantineIdentities].sort())
      !== stableJson([...quarantineIdentities].sort())) {
    fail(
      'f8x_observation_binding_mismatch',
      'The detailed importer quarantine does not match the exact aggregate-module quarantine identities.',
    );
  }
  if (!plainObject(staticGraphChecksum)
    || !safeIntegerForRead(staticGraphChecksum.fileCount, 1, 10_000)
    || !SHA256.test(staticGraphChecksum.sha256 || '')
    || !plainObject(currentReviewedModuleGraph)
    || stableJson(currentReviewedModuleGraph) !== stableJson(staticGraphChecksum)) {
    fail(
      'f8x_static_graph_mismatch',
      'The trusted static reviewed module graph differs from the graph finalized by the F8X audit.',
    );
  }
  if (stableJson(audit.observationEvidence) !== stableJson(observationEvidence)
    || stableJson(audit.placementIdentityEvidence)
      !== stableJson(observationEvidence.capturePlacementIdentityEvidence)) {
    fail(
      'f8x_observation_binding_mismatch',
      'The finalized F8X audit does not bind the exact retained and quarantined capture placements.',
    );
  }
  const currentRuntimeIdentities = productsByEcsIdentity(projection.currentRuntime, 'The current static-plus-base runtime');
  const overlapWithCurrentRuntime = [...productsByEcsIdentity(overlayProducts, 'The finalized F8X overlay overlap check').keys()]
    .filter(identityValue => currentRuntimeIdentities.has(identityValue)).length;
  const newUniqueCount = projection.products.length
    - (projection.currentRuntime.length - projection.removedIdentities.length);
  if (audit.productCount !== aggregateProducts.length
    || audit.quarantinedIdentityCount !== projectedQuarantine.length
    || !plainObject(progress) || progress.stage !== 'complete' || progress.complete !== true
    || progress.importPolicy !== 'all-21-f8x-scopes-reconciled'
    || progress.requestedSectionCount !== REVIEWED_BMW_M3_SECTIONS.length
    || progress.includedSectionCount !== REVIEWED_BMW_M3_SECTIONS.length
    || !Array.isArray(progress.includedSections)
    || [...progress.includedSections].sort().join('\0') !== [...REVIEWED_BMW_M3_SECTIONS].sort().join('\0')
    || !Array.isArray(progress.excludedSections) || progress.excludedSections.length
    || !exactSectionKeys(progress.sections) || !exactSectionKeys(audit.sections)
    || !plainObject(staticChecksum) || staticChecksum.count !== REVIEWED_ECS_PRODUCTS.length
    || staticChecksum.sha256 !== dataSha256(REVIEWED_ECS_PRODUCTS)
    || !plainObject(publication)
    || publication.staticReviewedProductCount !== REVIEWED_ECS_PRODUCTS.length
    || publication.currentReviewedShardProductCount !== currentRelease.products.length
    || publication.currentRuntimeReviewedProductCount !== projection.currentRuntime.length
    || publication.generatedProductCount !== aggregateProducts.length
    || publication.publishedOverlayProductCount !== overlayProducts.length
    || publication.overlapWithCurrentRuntimeReviewedEcsCount !== overlapWithCurrentRuntime
    || publication.newUniqueProductCount !== newUniqueCount
    || publication.currentRuntimeQuarantineOverlapCount !== projection.removedIdentities.length
    || publication.currentReviewedRemovedByProjectedQuarantineCount !== projection.removedIdentities.length
    || publication.currentReviewedRemovedByProjectedQuarantine?.identityCount
      !== projection.removedIdentities.length
    || publication.currentReviewedRemovedByProjectedQuarantine?.identitiesSha256
      !== dataSha256(projection.removedIdentities)
    || publication.projectedPublishedReviewedEcsCount !== projection.products.length
    || plan.staticPlusBasePlusOverlayProductCount !== projection.products.length
    || publication.unintendedCurrentReviewedRemovalCount !== 0) {
    fail('f8x_audit_count_mismatch', 'The F8X final audit does not match the base, overlay or complete section policy.');
  }
  for (const key of REVIEWED_BMW_M3_SECTIONS) {
    const progressSection = progress.sections[key];
    const auditedSection = audit.sections[key];
    if (progressSection?.complete !== true || progressSection?.included !== true
      || progressSection.productCount !== overlayCounts[key]
      || auditedSection?.productCount !== overlayCounts[key]
      || auditedSection.f8xOverlayProductCount !== overlayCounts[key]) {
      fail('f8x_audit_count_mismatch', `The F8X final audit has stale ${key} product counts.`);
    }
  }
  return Object.freeze({
    kind: verification.kind,
    inputSetSha256: verification.inputSetSha256,
    aggregateModuleSha256: inputChecksums.aggregateModule.sha256,
    baseReleaseId: currentRelease.manifest.releaseId,
    baseReleaseSha256: base.artifactSetSha256,
    overlayProductCount: overlayProducts.length,
    runtimeUnionProductCount: runtimeUnionProducts.length,
    manifestContract: Object.freeze({
      overlayScope: ECS_F8X_OVERLAY_SCOPE,
      baseRelease: Object.freeze({ ...plan.baseRelease }),
      finalAudit: Object.freeze({
        kind: verification.kind,
        inputSetSha256: verification.inputSetSha256,
        aggregateModuleSha256: inputChecksums.aggregateModule.sha256,
      }),
      projectedQuarantine: Object.freeze({
        identities: Object.freeze([...projectedQuarantine]),
        ...plan.projectedQuarantine,
      }),
    }),
  });
}

function stableSearchDocument(product) {
  const values = [
    product.title, product.titleAr, product.brand, product.category, product.categoryAr,
    product.subcategory, product.subcategoryAr, product.ecsPartNumber, product.sku, product.mpn,
    product.description, product.descriptionAr, product.summary, product.summaryAr,
    ...(product.selectionSources || []).map(source => source?.category),
    ...(product.specifications || []).flatMap(item => [item?.name, item?.label, item?.value]),
    ...(product.fitments || []).flatMap(fitment => [
      fitment.make, fitment.model, fitment.generation,
      ...(fitment.models || []), ...(fitment.chassis || []), ...(fitment.engines || [])
    ])
  ];
  const tokens = new Set(identity(values.filter(Boolean).join(' ')).split(' ').filter(token => token.length > 1));
  return [...tokens].slice(0, 256).join(' ').slice(0, 6_000);
}

function compactFitment(fitment) {
  return {
    make: clean(fitment?.make, 80) || null,
    model: clean(fitment?.model, 100) || null,
    models: Array.isArray(fitment?.models) ? fitment.models.map(value => clean(value, 100)).filter(Boolean) : [],
    generation: clean(fitment?.generation, 120) || null,
    chassis: Array.isArray(fitment?.chassis) ? fitment.chassis.map(value => clean(value, 80)).filter(Boolean) : [],
    yearFrom: Number.isInteger(fitment?.yearFrom) ? fitment.yearFrom : null,
    yearTo: Number.isInteger(fitment?.yearTo) ? fitment.yearTo : null,
    engines: Array.isArray(fitment?.engines) ? fitment.engines.map(value => clean(value, 120)).filter(Boolean) : [],
    confidence: ['exact', 'possible'].includes(fitment?.confidence) ? fitment.confidence : 'possible'
  };
}

function routingProduct(product, sequence, productIndex) {
  return {
    shardedRoute: true,
    shardSequence: sequence,
    shardProductIndex: productIndex,
    publicKey: product.publicKey,
    slug: product.slug,
    title: clean(product.title, 300),
    titleAr: clean(product.titleAr, 300) || null,
    brand: clean(product.brand, 120),
    brandSlug: clean(product.brandSlug, 120),
    category: clean(product.category, 160),
    categoryAr: clean(product.categoryAr, 160) || null,
    categorySlug: clean(product.categorySlug, 160),
    subcategory: clean(product.subcategory, 200) || null,
    subcategoryAr: clean(product.subcategoryAr, 200) || null,
    subcategorySlug: clean(product.subcategorySlug, 200) || null,
    ecsPartNumber: clean(product.ecsPartNumber, 120),
    sku: clean(product.sku, 120),
    mpn: clean(product.mpn, 160) || null,
    priceAmount: Number.isFinite(Number(product.priceAmount)) ? Number(product.priceAmount) : null,
    priceCurrency: product.priceCurrency === 'USD' ? 'USD' : null,
    priceStartingAt: Boolean(product.priceStartingAt),
    priceConflict: Boolean(product.priceConflict),
    priceVerifiedAt: clean(product.priceVerifiedAt, 40) || null,
    quoteOnly: Boolean(product.quoteOnly),
    checkedAt: clean(product.checkedAt, 40) || null,
    staleAfterDays: Number.isFinite(Number(product.staleAfterDays)) ? Number(product.staleAfterDays) : 7,
    stockPolicy: clean(product.stockPolicy, 80) || 'manual-confirm',
    availabilityCode: clean(product.availabilityCode, 80) || 'check_availability',
    fitmentConfidence: ['exact', 'possible'].includes(product.fitmentConfidence)
      ? product.fitmentConfidence : 'possible',
    fitments: Array.isArray(product.fitments) ? product.fitments.map(compactFitment) : [],
    filters: {
      categories: Array.isArray(product.filters?.categories) ? [...product.filters.categories] : [],
      subcategories: Array.isArray(product.filters?.subcategories) ? [...product.filters.subcategories] : []
    },
    selectionRank: Number.isFinite(Number(product.selectionRank)) ? Number(product.selectionRank) : null,
    searchDocument: stableSearchDocument(product)
  };
}

function canonicalTimestamp(value) {
  const source = clean(value, 80);
  const milliseconds = Date.parse(source);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(source)
    || !Number.isFinite(milliseconds)) fail('invalid_audit', 'The aggregate audit generatedAt value is invalid.');
  return new Date(milliseconds).toISOString();
}

function validateProduct(product, seenKeys, seenSlugs) {
  if (!product || typeof product !== 'object' || !PRODUCT_KEY.test(product.publicKey)
    || !PRODUCT_SLUG.test(product.slug) || !clean(product.title, 300) || !clean(product.brand, 120)
    || product.priceCurrency !== 'USD' || !Array.isArray(product.selectionSources)) {
    fail('invalid_product', 'Every reviewed shard product requires a valid ECS identity, title, brand, USD policy and selection evidence.');
  }
  if (seenKeys.has(product.publicKey) || seenSlugs.has(product.slug)) {
    fail('duplicate_product', `Duplicate reviewed product identity: ${product.publicKey}.`);
  }
  seenKeys.add(product.publicKey);
  seenSlugs.add(product.slug);
}

function sectionState(audit) {
  const progress = audit?.captureProgress;
  if (!progress || typeof progress !== 'object' || !progress.sections) {
    fail('invalid_audit', 'The aggregate audit must include captureProgress section reconciliation.');
  }
  const included = new Set((progress.includedSections || []).map(value => clean(value, 40).toLowerCase()));
  const sections = {};
  for (const key of REVIEWED_BMW_M3_SECTIONS) {
    const source = progress.sections[key] || {};
    const complete = source.complete === true;
    if (included.has(key) && !complete) {
      fail('unverified_section', `BMW M3 ${key} cannot be included before reconciliation is complete.`);
    }
    sections[key] = {
      complete,
      included: included.has(key),
      capturedPages: Number.isSafeInteger(source.capturedPages) ? source.capturedPages : 0,
      expectedPages: Number.isSafeInteger(source.expectedPages) ? source.expectedPages : 0,
      capturedPlacements: Number.isSafeInteger(source.capturedPlacements) ? source.capturedPlacements : 0,
      expectedPlacements: Number.isSafeInteger(source.expectedPlacements) ? source.expectedPlacements : 0,
      productCount: Number.isSafeInteger(audit?.sections?.[key]?.productCount)
        ? audit.sections[key].productCount : 0
    };
  }
  const complete = REVIEWED_BMW_M3_SECTIONS.every(key => sections[key].complete && sections[key].included);
  if (Boolean(progress.complete) !== complete) {
    fail('invalid_audit', 'The aggregate audit complete flag does not match the seven reconciled sections.');
  }
  return { complete, included, sections };
}

function productSections(product) {
  return new Set((product.selectionSources || []).map(source => clean(source?.section, 40).toLowerCase()));
}

function validatedF8xManifestContract(value) {
  if (value === null || value === undefined) return null;
  const expectedScope = ECS_F8X_OVERLAY_SCOPE;
  if (!exactKeys(value, ['overlayScope', 'baseRelease', 'finalAudit', 'projectedQuarantine'])
    || stableJson(value.overlayScope) !== stableJson(expectedScope)
    || !exactKeys(value.baseRelease, [
      'releaseId', 'manifestSha256', 'contentSetSha256', 'artifactSetSha256',
      'productCount', 'routeCount', 'shardCount', 'quarantinedIdentityCount', 'productsSha256'
    ])
    || !RELEASE_ID.test(value.baseRelease.releaseId || '')
    || !SHA256.test(value.baseRelease.manifestSha256 || '')
    || !SHA256.test(value.baseRelease.contentSetSha256 || '')
    || !SHA256.test(value.baseRelease.artifactSetSha256 || '')
    || !safeIntegerForRead(value.baseRelease.productCount, 1, REVIEWED_PRODUCT_MAX_COUNT)
    || value.baseRelease.routeCount !== value.baseRelease.productCount
    || !safeIntegerForRead(value.baseRelease.shardCount, 1, 1_000)
    || !safeIntegerForRead(value.baseRelease.quarantinedIdentityCount, 0, REVIEWED_PRODUCT_MAX_COUNT)
    || !SHA256.test(value.baseRelease.productsSha256 || '')
    || !exactKeys(value.finalAudit, ['kind', 'inputSetSha256', 'aggregateModuleSha256'])
    || value.finalAudit.kind !== F8X_FINAL_AUDIT_KIND
    || !SHA256.test(value.finalAudit.inputSetSha256 || '')
    || !SHA256.test(value.finalAudit.aggregateModuleSha256 || '')
    || !exactKeys(value.projectedQuarantine, ['identities', 'identityCount', 'identitiesSha256'])
    || !Array.isArray(value.projectedQuarantine.identities)
    || !safeIntegerForRead(value.projectedQuarantine.identityCount, 0, REVIEWED_PRODUCT_MAX_COUNT)
    || value.projectedQuarantine.identities.length !== value.projectedQuarantine.identityCount
    || value.projectedQuarantine.identityCount < value.baseRelease.quarantinedIdentityCount
    || value.projectedQuarantine.identities.some(identityValue => (
      typeof identityValue !== 'string' || !/^\d{3,12}$/.test(identityValue)
    ))
    || new Set(value.projectedQuarantine.identities).size !== value.projectedQuarantine.identities.length
    || stableJson(value.projectedQuarantine.identities)
      !== stableJson([...value.projectedQuarantine.identities].sort())
    || !SHA256.test(value.projectedQuarantine.identitiesSha256 || '')
    || value.projectedQuarantine.identitiesSha256 !== dataSha256(value.projectedQuarantine.identities)) {
    fail('invalid_f8x_overlay_contract', 'The F8X overlay manifest contract is incomplete or invalid.');
  }
  return value;
}

export function buildReviewedProductShardRelease(products, audit, {
  shardSize = REVIEWED_SHARD_SIZE,
  f8xOverlayContract = null,
} = {}) {
  if (!Array.isArray(products) || !products.length || products.length > REVIEWED_PRODUCT_MAX_COUNT) {
    fail('invalid_product_count', `Reviewed shard releases require 1-${REVIEWED_PRODUCT_MAX_COUNT} products.`);
  }
  if (!Number.isSafeInteger(shardSize) || shardSize < 32 || shardSize > 250) {
    fail('invalid_shard_size', 'Reviewed product shard size must be between 32 and 250.');
  }
  const generatedAt = canonicalTimestamp(audit?.generatedAt);
  const state = sectionState(audit);
  const overlayContract = validatedF8xManifestContract(f8xOverlayContract);
  if (isF8xReleaseAudit(audit) && !overlayContract) {
    fail('f8x_overlay_mode_required', 'A finalized F8X audit may only build the distinct overlay release kind.');
  }
  if (overlayContract && !isF8xReleaseAudit(audit)) {
    fail('invalid_f8x_overlay_contract', 'A separate F8X overlay requires the finalized F8X audit kind.');
  }
  if (overlayContract && !state.complete) {
    fail('invalid_f8x_overlay_contract', 'A separate F8X overlay release requires all exact 3×7 scopes.');
  }
  const seenKeys = new Set();
  const seenSlugs = new Set();
  for (const product of products) {
    validateProduct(product, seenKeys, seenSlugs);
    if (overlayContract) validateOverlayProduct(product, `The F8X overlay product ${product.publicKey}`);
    const sections = productSections(product);
    if (!sections.size || [...sections].some(section => !state.included.has(section))) {
      fail('unverified_product_scope', `${product.publicKey} references a section that is not reconciled and included.`);
    }
    if (overlayContract?.projectedQuarantine.identities.includes(ecsIdentity(product))) {
      fail('quarantined_product', `${product.publicKey} remains in the projected F8X quarantine.`);
    }
  }
  const ordered = [...products].sort((left, right) => left.title.localeCompare(right.title, 'en')
    || left.publicKey.localeCompare(right.publicKey, 'en'));
  const datasetSha256 = sha256(jsonBuffer(overlayContract ? {
    generatedAt,
    complete: true,
    f8xOverlayContract: overlayContract,
    keys: ordered.map(product => [product.publicKey, sha256(jsonBuffer(product))])
  } : {
    generatedAt,
    complete: state.complete,
    sections: state.sections,
    keys: ordered.map(product => [product.publicKey, sha256(jsonBuffer(product))])
  }));
  const releaseId = `${generatedAt.replace(/[-:.]/g, '').replace('Z', 'Z')}-${datasetSha256.slice(0, 16)}`;
  const shards = [];
  const routes = [];
  for (let offset = 0; offset < ordered.length; offset += shardSize) {
    const productsInShard = ordered.slice(offset, offset + shardSize);
    const sequence = shards.length + 1;
    const file = `shard-${String(sequence).padStart(5, '0')}.json`;
    const document = {
      schemaVersion: REVIEWED_SHARD_SCHEMA_VERSION,
      supplier: 'ECS Tuning',
      kind: overlayContract ? F8X_OVERLAY_SHARD_KIND : 'ecs-reviewed-product-shard',
      releaseId,
      sequence,
      productCount: productsInShard.length,
      products: productsInShard
    };
    const buffer = jsonBuffer(document);
    if (buffer.length > REVIEWED_SHARD_MAX_BYTES) {
      fail('shard_too_large', `${file} exceeds the ${REVIEWED_SHARD_MAX_BYTES}-byte limit.`);
    }
    productsInShard.forEach((product, productIndex) => routes.push(routingProduct(product, sequence, productIndex)));
    shards.push({
      sequence, file, productCount: productsInShard.length, bytes: buffer.length,
      sha256: sha256(buffer), firstKey: productsInShard[0].publicKey,
      lastKey: productsInShard.at(-1).publicKey, buffer
    });
  }
  const indexDocument = {
    schemaVersion: REVIEWED_SHARD_SCHEMA_VERSION,
    supplier: 'ECS Tuning',
    kind: overlayContract ? F8X_OVERLAY_INDEX_KIND : 'ecs-reviewed-product-routing-index',
    releaseId,
    routeCount: routes.length,
    routes
  };
  const indexBuffer = jsonBuffer(indexDocument);
  if (indexBuffer.length > REVIEWED_INDEX_MAX_BYTES) {
    fail('index_too_large', `The routing index exceeds the ${REVIEWED_INDEX_MAX_BYTES}-byte limit.`);
  }
  const sharedManifest = {
    schemaVersion: REVIEWED_SHARD_SCHEMA_VERSION,
    supplier: 'ECS Tuning',
    releaseId,
    generatedAt,
    counts: {
      productCount: ordered.length,
      routeCount: routes.length,
      shardCount: shards.length,
      quarantinedIdentityCount: overlayContract
        ? overlayContract.projectedQuarantine.identityCount
        : (Number.isSafeInteger(audit?.quarantinedIdentityCount) ? audit.quarantinedIdentityCount : 0)
    },
    index: { file: 'index.json', bytes: indexBuffer.length, sha256: sha256(indexBuffer) },
    shards: shards.map(({ buffer, ...descriptor }) => descriptor),
    contentSetSha256: sha256(Buffer.from([
      `index.json\0${indexBuffer.length}\0${sha256(indexBuffer)}`,
      ...shards.map(shard => `${shard.file}\0${shard.bytes}\0${shard.sha256}`)
    ].join('\n'), 'utf8'))
  };
  const manifest = overlayContract ? {
    schemaVersion: sharedManifest.schemaVersion,
    supplier: sharedManifest.supplier,
    kind: F8X_OVERLAY_MANIFEST_KIND,
    releaseId: sharedManifest.releaseId,
    generatedAt: sharedManifest.generatedAt,
    publicationMode: 'complete',
    complete: true,
    overlayScope: overlayContract.overlayScope,
    baseRelease: overlayContract.baseRelease,
    finalAudit: overlayContract.finalAudit,
    projectedQuarantine: overlayContract.projectedQuarantine,
    counts: sharedManifest.counts,
    index: sharedManifest.index,
    shards: sharedManifest.shards,
    contentSetSha256: sharedManifest.contentSetSha256,
  } : {
    schemaVersion: sharedManifest.schemaVersion,
    supplier: sharedManifest.supplier,
    kind: 'ecs-reviewed-product-shard-manifest',
    releaseId: sharedManifest.releaseId,
    generatedAt: sharedManifest.generatedAt,
    publicationMode: state.complete ? 'complete' : 'verified-progress',
    complete: state.complete,
    requestedSections: [...REVIEWED_BMW_M3_SECTIONS],
    includedSections: REVIEWED_BMW_M3_SECTIONS.filter(key => state.sections[key].included),
    excludedSections: REVIEWED_BMW_M3_SECTIONS.filter(key => !state.sections[key].included),
    sections: state.sections,
    counts: sharedManifest.counts,
    index: sharedManifest.index,
    shards: sharedManifest.shards,
    contentSetSha256: sharedManifest.contentSetSha256,
  };
  return { manifest, indexDocument, indexBuffer, shards, datasetSha256 };
}

function comparablePath(value) {
  const resolved = path.resolve(value);
  return path.sep === '\\' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

function samePath(left, right) {
  return comparablePath(left) === comparablePath(right);
}

function insidePath(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function readCanonicalFileSnapshot(filename, label, maximumBytes = 128 * 1024 * 1024) {
  const requested = path.resolve(filename);
  let handle;
  try {
    const entry = await lstat(requested);
    const resolved = await realpath(requested);
    if (!entry.isFile() || entry.isSymbolicLink() || !samePath(resolved, requested)) throw new Error();
    handle = await open(resolved, 'r');
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > maximumBytes) throw new Error();
    const buffer = Buffer.from(await handle.readFile());
    const after = await handle.stat();
    const postEntry = await lstat(requested);
    const postResolved = await realpath(requested);
    const post = await stat(postResolved);
    if (!postEntry.isFile() || postEntry.isSymbolicLink() || !samePath(postResolved, resolved)
      || !sameFileIdentity(before, after) || !sameFileIdentity(before, post)
      || before.size !== after.size || after.size !== buffer.length
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error();
    return Object.freeze({ path: resolved, bytes: buffer.length, sha256: sha256(buffer), buffer });
  } catch (error) {
    if (error instanceof ReviewedShardBuildError) throw error;
    fail('invalid_input_path', `${label} must be an unchanged canonical non-linked file.`);
  } finally {
    await handle?.close();
  }
}

function exactKeys(value, expected) {
  if (!plainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

async function canonicalDirectoryIdentity(directory, {
  code = 'linked_output_path',
  message = 'The release output directory changed or became linked.',
} = {}) {
  const requested = path.resolve(directory);
  try {
    const entry = await lstat(requested);
    const resolved = await realpath(requested);
    const details = await stat(resolved);
    if (!entry.isDirectory() || entry.isSymbolicLink() || !samePath(resolved, requested)
      || !details.isDirectory()) throw new Error();
    return Object.freeze({ path: resolved, dev: details.dev, ino: details.ino });
  } catch {
    fail(code, message);
  }
}

async function assertDirectoryIdentity(expected, options = {}) {
  const actual = await canonicalDirectoryIdentity(expected.path, options);
  if (!sameFileIdentity(actual, expected)) {
    fail(
      options.code || 'linked_output_path',
      options.message || 'The release output directory identity changed during the write.',
    );
  }
}

async function writeCreateOnly(filename, buffer, directoryIdentity = null) {
  let handle;
  try {
    if (directoryIdentity) await assertDirectoryIdentity(directoryIdentity);
    const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL
      | (fsConstants.O_NOFOLLOW || 0);
    handle = await open(filename, flags, 0o600);
    const opened = await handle.stat();
    await handle.writeFile(buffer);
    await handle.sync();
    const entry = await lstat(filename);
    const resolved = await realpath(filename);
    const current = await stat(resolved);
    if (!entry.isFile() || entry.isSymbolicLink() || !samePath(resolved, filename)
      || !sameFileIdentity(opened, current) || opened.size !== 0 || current.size !== buffer.length) {
      fail('linked_output_path', `Release output changed while writing: ${filename}`);
    }
    if (directoryIdentity) await assertDirectoryIdentity(directoryIdentity);
  } catch (error) {
    if (error instanceof ReviewedShardBuildError) throw error;
    if (error?.code === 'EEXIST') fail('output_exists', `Release output already exists: ${filename}`);
    throw error;
  } finally {
    await handle?.close();
  }
}

async function canonicalOutputDirectory(outputDirectory, {
  forbiddenDirectories = [],
  privateCandidate = false,
} = {}) {
  if (privateCandidate && !path.isAbsolute(outputDirectory)) {
    fail('invalid_output_path', 'A private F8X overlay output directory must be absolute.');
  }
  const requested = path.resolve(outputDirectory);
  if (path.parse(requested).root === requested) fail('invalid_output_path', 'A filesystem root cannot be a release output.');
  const requestedParent = path.dirname(requested);
  let realParent;
  try {
    realParent = await realpath(requestedParent);
    if (!(await stat(realParent)).isDirectory() || !samePath(realParent, requestedParent)
      || path.parse(realParent).root === realParent) throw new Error();
  } catch {
    fail('linked_output_path', 'The release output parent must be an existing canonical non-linked directory.');
  }
  const root = path.join(realParent, path.basename(requested));
  for (const directory of forbiddenDirectories) {
    let forbidden;
    try {
      forbidden = await realpath(path.resolve(directory));
    } catch {
      fail('invalid_input_release', 'The forbidden input release directory cannot be resolved.');
    }
    if (insidePath(forbidden, root) || insidePath(root, forbidden)) {
      fail('output_input_overlap', 'The candidate output must not equal, contain or sit inside its base release.');
    }
  }
  if (privateCandidate) {
    const realRepository = await realpath(REPOSITORY_ROOT);
    if (insidePath(realRepository, root)) {
      let realPrivate;
      try {
        realPrivate = await realpath(PRIVATE_IMPORTS_ROOT);
      } catch {
        fail('invalid_output_path', 'Repository-local F8X overlay output requires canonical private-imports.');
      }
      if (!samePath(realPrivate, PRIVATE_IMPORTS_ROOT) || !insidePath(realPrivate, root)) {
        fail('public_output_path', 'A repository-local F8X overlay candidate must stay below canonical private-imports.');
      }
    }
  }
  try {
    const entry = await lstat(root);
    const resolved = await realpath(root);
    if (!entry.isDirectory() || entry.isSymbolicLink() || !samePath(resolved, root)) {
      fail('linked_output_path', 'The release output directory must not be a link or junction.');
    }
    if (privateCandidate) fail('output_exists', 'The private F8X overlay output directory already exists.');
    if ((await readdir(root)).length) fail('output_exists', 'The release output directory is not empty.');
  } catch (error) {
    if (error instanceof ReviewedShardBuildError) throw error;
    if (error?.code !== 'ENOENT') fail('invalid_output_path', 'The release output directory cannot be validated.');
    try {
      await mkdir(root);
    } catch (mkdirError) {
      if (mkdirError?.code === 'EEXIST') fail('output_exists', 'Another writer claimed the release output directory.');
      throw mkdirError;
    }
  }
  return { root, identity: await canonicalDirectoryIdentity(root) };
}

export async function writeReviewedProductShardRelease(outputDirectory, release, options = {}) {
  const { root, identity: directoryIdentity } = await canonicalOutputDirectory(outputDirectory, options);
  const claimPath = path.join(root, OUTPUT_CLAIM_FILE);
  let claimed = false;
  try {
    await writeCreateOnly(
      claimPath,
      Buffer.from('create-only reviewed release writer\n', 'utf8'),
      directoryIdentity,
    );
    claimed = true;
    await Promise.all(release.shards.map(shard => (
      writeCreateOnly(path.join(root, shard.file), shard.buffer, directoryIdentity)
    )));
    await writeCreateOnly(path.join(root, 'index.json'), release.indexBuffer, directoryIdentity);
    const manifestBuffer = Buffer.from(`${JSON.stringify(release.manifest, null, 2)}\n`, 'utf8');
    await writeCreateOnly(
      path.join(root, 'manifest.json.sha256'),
      Buffer.from(`${sha256(manifestBuffer)}  manifest.json\n`, 'utf8'),
      directoryIdentity,
    );
    await writeCreateOnly(path.join(root, 'manifest.json'), manifestBuffer, directoryIdentity);
    await assertDirectoryIdentity(directoryIdentity);
    await readReviewedProductShardRelease(root);
    await assertDirectoryIdentity(directoryIdentity);
    await unlink(claimPath);
    claimed = false;
    return { outputDirectory: root, manifestBytes: manifestBuffer.length, ...release.manifest.counts };
  } finally {
    if (claimed) {
      await assertDirectoryIdentity(directoryIdentity)
        .then(() => unlink(claimPath)).catch(() => {});
    }
  }
}

function parseJsonBuffer(buffer, label) {
  try {
    const value = JSON.parse(buffer.toString('utf8'));
    if (!plainObject(value)) throw new Error();
    return value;
  } catch {
    fail('invalid_input_release', `${label} is not valid JSON.`);
  }
}

function reviewedDatasetSha256(manifest, products) {
  const keys = products.map(product => [product.publicKey, sha256(jsonBuffer(product))]);
  if (manifest.kind === F8X_OVERLAY_MANIFEST_KIND) {
    return sha256(jsonBuffer({
      generatedAt: manifest.generatedAt,
      complete: true,
      f8xOverlayContract: {
        overlayScope: manifest.overlayScope,
        baseRelease: manifest.baseRelease,
        finalAudit: manifest.finalAudit,
        projectedQuarantine: manifest.projectedQuarantine,
      },
      keys,
    }));
  }
  return sha256(jsonBuffer({
    generatedAt: manifest.generatedAt,
    complete: manifest.complete,
    sections: manifest.sections,
    keys,
  }));
}

function productIdentitySetSha256(products) {
  return dataSha256([...productsByEcsIdentity(products, 'The reviewed shard release').keys()].sort());
}

export async function readReviewedProductShardRelease(inputDirectory) {
  const requested = path.resolve(inputDirectory);
  const inputDirectoryOptions = {
    code: 'invalid_input_release',
    message: 'The input reviewed release changed or became linked during verification.',
  };
  const inputDirectoryIdentity = await canonicalDirectoryIdentity(requested, inputDirectoryOptions);
  const root = inputDirectoryIdentity.path;
  const readArtifact = async (name, maximum = Number.MAX_SAFE_INTEGER) => {
    const filename = path.join(root, name);
    try {
      await assertDirectoryIdentity(inputDirectoryIdentity, inputDirectoryOptions);
      const snapshot = await readCanonicalFileSnapshot(filename, `Release artifact ${name}`, maximum);
      if (!insidePath(root, snapshot.path)) throw new Error();
      await assertDirectoryIdentity(inputDirectoryIdentity, inputDirectoryOptions);
      return snapshot;
    } catch {
      fail('invalid_input_release', `Release artifact ${name} is missing, linked or invalid.`);
    }
  };
  const manifestSnapshot = await readArtifact('manifest.json', REVIEWED_INDEX_MAX_BYTES);
  const manifest = parseJsonBuffer(manifestSnapshot.buffer, 'The reviewed shard manifest');
  const overlayRelease = manifest.kind === F8X_OVERLAY_MANIFEST_KIND;
  const expectedManifestKeys = overlayRelease
    ? ['schemaVersion', 'supplier', 'kind', 'releaseId', 'generatedAt', 'publicationMode', 'complete',
      'overlayScope', 'baseRelease', 'finalAudit', 'projectedQuarantine', 'counts', 'index', 'shards',
      'contentSetSha256']
    : ['schemaVersion', 'supplier', 'kind', 'releaseId', 'generatedAt', 'publicationMode', 'complete',
      'requestedSections', 'includedSections', 'excludedSections', 'sections', 'counts', 'index', 'shards',
      'contentSetSha256'];
  if (!exactKeys(manifest, expectedManifestKeys)
    || manifest.schemaVersion !== REVIEWED_SHARD_SCHEMA_VERSION || manifest.supplier !== 'ECS Tuning'
    || (!overlayRelease && manifest.kind !== 'ecs-reviewed-product-shard-manifest')
    || !RELEASE_ID.test(manifest.releaseId || '') || canonicalTimestamp(manifest.generatedAt) !== manifest.generatedAt
    || !exactKeys(manifest.counts, ['productCount', 'routeCount', 'shardCount', 'quarantinedIdentityCount'])
    || !safeIntegerForRead(manifest.counts.productCount, 1, REVIEWED_PRODUCT_MAX_COUNT)
    || manifest.counts.routeCount !== manifest.counts.productCount
    || !safeIntegerForRead(manifest.counts.shardCount, 1, 1_000)
    || !safeIntegerForRead(manifest.counts.quarantinedIdentityCount, 0, REVIEWED_PRODUCT_MAX_COUNT)
    || !Array.isArray(manifest.shards) || manifest.shards.length !== manifest.counts.shardCount
    || manifest.index?.file !== 'index.json' || !safeIntegerForRead(manifest.index?.bytes, 1, REVIEWED_INDEX_MAX_BYTES)
    || !SHA256.test(manifest.index?.sha256 || '') || !SHA256.test(manifest.contentSetSha256 || '')) {
    fail('invalid_input_release', 'The input reviewed shard manifest is invalid.');
  }
  if (overlayRelease) {
    validatedF8xManifestContract({
      overlayScope: manifest.overlayScope,
      baseRelease: manifest.baseRelease,
      finalAudit: manifest.finalAudit,
      projectedQuarantine: manifest.projectedQuarantine,
    });
    if (manifest.publicationMode !== 'complete' || manifest.complete !== true
      || manifest.counts.quarantinedIdentityCount !== manifest.projectedQuarantine.identityCount) {
      fail('invalid_input_release', 'The F8X overlay release is not explicitly complete and quarantine-bound.');
    }
  }
  const sidecar = await readArtifact('manifest.json.sha256', 256);
  if (sidecar.buffer.toString('utf8') !== `${manifestSnapshot.sha256}  manifest.json\n`) {
    fail('input_checksum_mismatch', 'The reviewed manifest checksum sidecar differs.');
  }
  const indexSnapshot = await readArtifact('index.json', REVIEWED_INDEX_MAX_BYTES);
  if (indexSnapshot.bytes !== manifest.index.bytes || indexSnapshot.sha256 !== manifest.index.sha256) {
    fail('input_checksum_mismatch', 'The reviewed routing index checksum differs.');
  }
  const index = parseJsonBuffer(indexSnapshot.buffer, 'The reviewed routing index');
  const expectedIndexKind = overlayRelease ? F8X_OVERLAY_INDEX_KIND : 'ecs-reviewed-product-routing-index';
  if (!exactKeys(index, ['schemaVersion', 'supplier', 'kind', 'releaseId', 'routeCount', 'routes'])
    || index.schemaVersion !== REVIEWED_SHARD_SCHEMA_VERSION || index.supplier !== 'ECS Tuning'
    || index.kind !== expectedIndexKind || index.releaseId !== manifest.releaseId
    || index.routeCount !== manifest.counts.routeCount || !Array.isArray(index.routes)
    || index.routes.length !== index.routeCount) {
    fail('invalid_input_release', 'The reviewed routing index is invalid.');
  }
  const products = [];
  const positions = new Map();
  const shardSnapshots = [];
  const filenames = new Set();
  const expectedShardKind = overlayRelease ? F8X_OVERLAY_SHARD_KIND : 'ecs-reviewed-product-shard';
  for (const [descriptorIndex, descriptor] of manifest.shards.entries()) {
    if (!plainObject(descriptor) || descriptor.sequence !== descriptorIndex + 1
      || !/^shard-\d{5}\.json$/.test(descriptor.file || '') || filenames.has(descriptor.file)
      || !safeIntegerForRead(descriptor.productCount, 1, 250)
      || !safeIntegerForRead(descriptor.bytes, 1, REVIEWED_SHARD_MAX_BYTES)
      || !SHA256.test(descriptor.sha256 || '')) {
      fail('invalid_input_release', 'An input reviewed shard descriptor is invalid.');
    }
    filenames.add(descriptor.file);
    const snapshot = await readArtifact(descriptor.file, REVIEWED_SHARD_MAX_BYTES);
    if (snapshot.bytes !== descriptor.bytes || snapshot.sha256 !== descriptor.sha256) {
      fail('input_checksum_mismatch', `${descriptor.file} failed input checksum validation.`);
    }
    const document = parseJsonBuffer(snapshot.buffer, descriptor.file);
    if (!exactKeys(document, ['schemaVersion', 'supplier', 'kind', 'releaseId', 'sequence', 'productCount', 'products'])
      || document.schemaVersion !== REVIEWED_SHARD_SCHEMA_VERSION || document.supplier !== 'ECS Tuning'
      || document.kind !== expectedShardKind || document.releaseId !== manifest.releaseId
      || document.sequence !== descriptor.sequence || document.productCount !== descriptor.productCount
      || !Array.isArray(document.products) || document.products.length !== descriptor.productCount
      || document.products[0]?.publicKey !== descriptor.firstKey
      || document.products.at(-1)?.publicKey !== descriptor.lastKey) {
      fail('invalid_input_release', `${descriptor.file} is not a valid reviewed product shard.`);
    }
    document.products.forEach((product, productIndex) => {
      if (overlayRelease) {
        validateOverlayProduct(product, `${descriptor.file} product ${productIndex + 1}`);
      }
      products.push(product);
      positions.set(`${descriptor.sequence}:${productIndex}`, product);
    });
    shardSnapshots.push(snapshot);
  }
  if (products.length !== manifest.counts.productCount) {
    fail('invalid_input_release', 'The input reviewed product shard counts do not reconcile.');
  }
  productsByEcsIdentity(products, 'The input reviewed shard release');
  const routeKeys = new Set();
  for (const route of index.routes) {
    const product = positions.get(`${route?.shardSequence}:${route?.shardProductIndex}`);
    if (overlayRelease) validateOverlayProduct(route, 'The F8X overlay routing product', { compact: true });
    if (route?.shardedRoute !== true || routeKeys.has(route.publicKey)
      || product?.publicKey !== route.publicKey || product?.slug !== route.slug) {
      fail('invalid_input_release', 'A reviewed route does not match its exact shard product.');
    }
    routeKeys.add(route.publicKey);
  }
  const contentSetSha256 = sha256(Buffer.from([
    `index.json\0${manifest.index.bytes}\0${manifest.index.sha256}`,
    ...manifest.shards.map(descriptor => `${descriptor.file}\0${descriptor.bytes}\0${descriptor.sha256}`),
  ].join('\n'), 'utf8'));
  if (contentSetSha256 !== manifest.contentSetSha256) {
    fail('input_checksum_mismatch', 'The reviewed release content-set checksum differs.');
  }
  const datasetSha256 = reviewedDatasetSha256(manifest, products);
  if (!manifest.releaseId.endsWith(`-${datasetSha256.slice(0, 16)}`)) {
    fail('input_checksum_mismatch', 'The reviewed release ID is not bound to its dataset.');
  }
  const artifactSnapshots = [manifestSnapshot, indexSnapshot, ...shardSnapshots];
  const descriptors = [
    { file: 'manifest.json', snapshot: manifestSnapshot },
    { file: 'index.json', snapshot: indexSnapshot },
    ...manifest.shards.map((descriptor, indexValue) => ({
      file: descriptor.file, snapshot: shardSnapshots[indexValue],
    })),
  ].map(({ file, snapshot }) => ({ file, bytes: snapshot.bytes, sha256: snapshot.sha256 }))
    .sort((left, right) => left.file.localeCompare(right.file, 'en'));
  const artifactSetSha256 = dataSha256(descriptors);
  const releaseBinding = {
    releaseId: manifest.releaseId,
    generatedAt: manifest.generatedAt,
    productCount: products.length,
    routeCount: manifest.counts.routeCount,
    shardCount: manifest.counts.shardCount,
    quarantinedIdentityCount: manifest.counts.quarantinedIdentityCount,
    productsSha256: dataSha256(products),
    artifactSetSha256,
    datasetSha256,
    contentSetSha256: manifest.contentSetSha256,
    manifestFileSha256: manifestSnapshot.sha256,
    manifestCanonicalSha256: dataSha256(manifest),
    productIdentitySetSha256: productIdentitySetSha256(products),
  };
  await assertDirectoryIdentity(inputDirectoryIdentity, inputDirectoryOptions);
  return {
    root, manifest, index, products, artifactSnapshots, descriptors, artifactSetSha256,
    manifestSha256: manifestSnapshot.sha256, releaseBinding,
  };
}

export async function readReviewedProductsFromShardRelease(inputDirectory) {
  return (await readReviewedProductShardRelease(inputDirectory)).products;
}

function safeIntegerForRead(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function argument(argv, name) {
  const positions = argv.flatMap((value, index) => value === name ? [index] : []);
  if (positions.length > 1) fail('invalid_arguments', `Duplicate option: ${name}.`);
  const index = positions[0];
  if (index === undefined) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) fail('invalid_arguments', `Missing value for ${name}.`);
  return value;
}

async function main() {
  const argv = process.argv.slice(2);
  const supported = new Set(['--input-module', '--input-dir', '--overlay-module', '--audit', '--output-dir']);
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const optionValue = argv[index + 1];
    if (!supported.has(name) || !optionValue || optionValue.startsWith('--')) {
      fail('invalid_arguments', `Unsupported or incomplete option: ${name || '<empty>'}.`);
    }
  }
  const inputModule = argument(argv, '--input-module');
  const inputDirectory = argument(argv, '--input-dir');
  const overlayModule = argument(argv, '--overlay-module');
  const auditPath = argument(argv, '--audit');
  const outputDirectory = argument(argv, '--output-dir');
  if (Boolean(inputModule) === Boolean(inputDirectory) || (overlayModule && !inputDirectory)
    || !auditPath || !outputDirectory) {
    fail('invalid_arguments', 'Usage: build-reviewed-product-shards.mjs (--input-module <products.js> | --input-dir <existing-release> [--overlay-module <products.js>]) --audit <report.json> --output-dir <directory>.');
  }
  let audit;
  try {
    const auditSnapshot = await readCanonicalFileSnapshot(auditPath, 'The reviewed release audit');
    audit = JSON.parse(auditSnapshot.buffer.toString('utf8'));
  } catch {
    fail('invalid_audit', 'The reviewed release audit is not valid JSON.');
  }
  if (isF8xReleaseAudit(audit) && !overlayModule) {
    fail('f8x_overlay_mode_required', 'A finalized F8X audit requires --input-dir and --overlay-module.');
  }
  let release;
  let writeOptions = {};
  if (overlayModule) {
    const currentRelease = await readReviewedProductShardRelease(inputDirectory);
    const overlaySnapshot = await readCanonicalFileSnapshot(overlayModule, 'The F8X overlay module');
    const overlayModuleBuffer = overlaySnapshot.buffer;
    validateF8xOverlayModuleSnapshot(audit, overlayModuleBuffer);
    let parsed;
    try {
      parsed = parseExactF8xAggregateModule(overlayModuleBuffer.toString('utf8'));
    } catch (error) {
      fail(
        'invalid_f8x_overlay_module',
        `The F8X overlay module is not canonical: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    const projected = new Set(Array.isArray(audit.projectedQuarantinedEcsIdentities)
      ? audit.projectedQuarantinedEcsIdentities : []);
    const overlayProducts = parsed.products.filter(productValue => !projected.has(ecsIdentity(productValue)));
    const runtimeUnionProducts = projectedRuntimeUnion(
      currentRelease.products,
      overlayProducts,
      [...projected],
    ).products;
    const liveGraph = await snapshotTrustedCurrentReviewedGraph();
    const binding = validateF8xOverlayBuildBinding({
      audit,
      overlayModuleBuffer,
      aggregateProducts: parsed.products,
      aggregateQuarantine: parsed.quarantine,
      overlayProducts,
      currentRelease,
      currentReviewedModuleGraph: {
        fileCount: liveGraph.fileCount,
        sha256: liveGraph.sha256,
      },
      runtimeUnionProducts,
    });
    release = buildReviewedProductShardRelease(overlayProducts, audit, {
      f8xOverlayContract: binding.manifestContract,
    });
    writeOptions = { forbiddenDirectories: [currentRelease.root], privateCandidate: true };
  } else {
    const products = inputModule
      ? (await import(`${pathToFileURL(path.resolve(inputModule)).href}?reviewed-shards=${Date.now()}`))
        .BMW_M3_AGGREGATE_PRODUCTS
      : (await readReviewedProductShardRelease(inputDirectory)).products;
    release = buildReviewedProductShardRelease(products, audit);
    writeOptions = inputDirectory ? { forbiddenDirectories: [inputDirectory] } : {};
  }
  const result = await writeReviewedProductShardRelease(outputDirectory, release, writeOptions);
  process.stdout.write(`${JSON.stringify({ releaseId: release.manifest.releaseId, complete: release.manifest.complete, ...result })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error?.code || 'unexpected_failure'}: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
