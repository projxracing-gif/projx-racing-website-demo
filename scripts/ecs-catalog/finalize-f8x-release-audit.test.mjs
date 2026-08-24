import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  F8X_AGGREGATE_PROFILES,
  F8X_AGGREGATE_SECTIONS,
  prepareF8xAggregateBundles,
  renderF8xAggregateModule,
} from './prepare-f8x-aggregate.mjs';
import {
  F8xFinalReleaseAuditError,
  buildPriorReviewedQuarantineArtifact,
  finalizeF8xReleaseAudit,
  parseExactF8xAggregateModule,
  parseExactPriorReviewedAggregateModule,
  validateF8xReconciliationReport,
  verifyF8xCaptureBundleBinding,
  verifyF8xReleaseAuditFiles,
  verifyPriorReviewedQuarantineFiles,
  writeF8xFinalReleaseAuditCreateOnly,
  writePriorReviewedQuarantineCreateOnly,
} from './finalize-f8x-release-audit.mjs';
import {
  buildReviewedProductShardRelease,
  writeReviewedProductShardRelease,
} from './build-reviewed-product-shards.mjs';
import { mergeReviewedEcsProducts } from '../../server/ecs-reviewed-catalog.js';

const GENERATED_AT = '2026-08-20T12:00:00.000Z';
const CAPTURE_STARTED_AT = '2026-08-20T11:30:00.000Z';
const NOW = Date.parse('2026-08-20T12:01:00.000Z');
const PRODUCT_DIGITS = '990000001';
const STATIC_QUARANTINE_IDENTITY = '4017812';
const PROFILE_KEYS = Object.keys(F8X_AGGREGATE_PROFILES);
const SECTION_KEYS = Object.keys(F8X_AGGREGATE_SECTIONS);
const TRUSTED_CURRENT_REVIEWED_MODULE = fileURLToPath(new URL('../../server/ecs-reviewed-catalog.js', import.meta.url));
const REQUIRED_MISSING = Object.freeze({
  availabilityText: 0,
  ecsPartNumber: 0,
  manufacturerPartNumber: 0,
  priceText: 0,
  productUrl: 0,
  sourceUrl: 0,
  title: 0,
});

function bundle(profileKey, sectionKey, overrides = {}) {
  const profile = F8X_AGGREGATE_PROFILES[profileKey];
  const section = F8X_AGGREGATE_SECTIONS[sectionKey];
  const sectionUrl = `${profile.rootUrl}${section.path}/`;
  const categoryKey = `${sectionKey}-test-parts`;
  const categoryName = `${section.label} Test Parts`;
  const categoryUrl = `${sectionUrl}Test_Parts/`;
  const category = {
    key: categoryKey,
    name: categoryName,
    sourceUrl: categoryUrl,
    count: 1,
    countEvidence: { source: 'visible-link-text', value: '1' },
    expectedPages: 1,
    pages: 1,
    pageCounts: [1],
    pageUrls: [categoryUrl],
    positionsContiguous: true,
  };
  const terminalProof = {
    kind: `${profile.artifactPrefix}-section-terminal-pagination-proof`,
    observedAt: GENERATED_AT,
    terminalPage: 1,
    terminalUrl: categoryUrl,
    expectedRenderedCount: 1,
    renderedCount: 1,
    observedVisibleLinkCount: 1,
    observedPaginationLinks: [],
    nextPageAbsent: true,
    validated: true,
  };
  category.terminalProof = terminalProof;
  const totals = {
    vehicle: profile.vehicle,
    section: section.label,
    categories: 1,
    expectedPages: 1,
    capturedPages: 1,
    expectedPlacements: 1,
    capturedPlacements: 1,
    terminalProofs: 1,
    uniqueEcsProducts: 1,
    crossCategoryRepeatPlacements: 0,
  };
  return {
    capture: {
      schemaVersion: 1,
      supplier: 'ECS Tuning',
      accessClass: 'public-retail',
      kind: `${profile.artifactPrefix}-${sectionKey}-listing-capture`,
      captureStartedAt: CAPTURE_STARTED_AT,
      generatedAt: GENERATED_AT,
      vehicle: profile.vehicle,
      section: section.label,
      sectionUrl,
      categories: [category],
      terminalProofs: { [categoryKey]: terminalProof },
      records: [{
        availabilityText: 'In Stock',
        brand: 'Test Brand',
        category: categoryName,
        categoryKey,
        description: 'Reviewed F8X fixture.',
        ecsPartNumber: `ES#${PRODUCT_DIGITS}`,
        imageAlt: 'F8X fixture',
        imageFallbackUrl: `https://assets.ecstuning.com/product_library/${PRODUCT_DIGITS}_x300.webp`,
        imageUrl: `https://assets.ecstuning.com/product_library/${PRODUCT_DIGITS}_x300.webp`,
        manufacturerPartNumber: 'F8X-FINAL-AUDIT-1',
        observedAt: GENERATED_AT,
        priceBlockText: '$499.99',
        priceText: '$499.99',
        productUrl: 'https://www.ecstuning.com/b-test-brand-parts/f8x-final-audit-product/f8x-final-audit-1/',
        relevancePosition: 1,
        section: section.label,
        shippingText: 'Calculated at checkout',
        sourceUrl: categoryUrl,
        title: 'F8X Final Audit Product',
        vehicle: profile.vehicle,
        ...overrides,
      }],
    },
    manifest: {
      schemaVersion: 1,
      supplier: 'ECS Tuning',
      accessClass: 'public-retail',
      kind: `${profile.artifactPrefix}-${sectionKey}-capture-manifest`,
      captureStartedAt: CAPTURE_STARTED_AT,
      generatedAt: GENERATED_AT,
      rootUrl: profile.rootUrl,
      section: { section: section.label, key: sectionKey, href: sectionUrl },
      pageSize: 16,
      categories: { [categoryKey]: category },
      terminalProofs: { [categoryKey]: terminalProof },
      totals,
      complete: true,
    },
    report: {
      schemaVersion: 1,
      supplier: 'ECS Tuning',
      accessClass: 'public-retail',
      kind: `${profile.artifactPrefix}-${sectionKey}-reconciliation-report`,
      captureStartedAt: CAPTURE_STARTED_AT,
      generatedAt: GENERATED_AT,
      source: { rootUrl: profile.rootUrl, sectionUrl },
      scope: totals,
      completeness: {
        complete: true,
        status: 'reconciled',
        exactCategories: 1,
        categoryAudit: [{ ...category, observedCount: 1, exact: true }],
        requiredMissing: { ...REQUIRED_MISSING },
        optionalMissing: {},
        duplicatePlacements: [],
      },
      consistency: { identityConflicts: [], observationDifferences: [] },
      safeguards: {
        publicRetailOnly: true,
        challengeBypassUsed: false,
        guessedCategoryRoutes: false,
        guessedPaginationRoutes: false,
        checkpointResumeUrlsValidated: true,
        nextUncheckpointPageValidated: true,
        liveStockClaim: false,
      },
    },
  };
}

function completeBundles(overrides = () => ({})) {
  return PROFILE_KEYS.flatMap(profileKey => SECTION_KEYS.map(sectionKey => (
    bundle(profileKey, sectionKey, overrides(profileKey, sectionKey))
  )));
}

function twoPageReconciliationReport(observedPaginationLinks = null) {
  const report = structuredClone(bundle('f80-m3', 'braking').report);
  const category = report.completeness.categoryAudit[0];
  const terminalUrl = `${category.sourceUrl}2`;
  Object.assign(category, {
    count: 17,
    expectedPages: 2,
    pages: 2,
    pageCounts: [16, 1],
    pageUrls: [category.sourceUrl, terminalUrl],
    observedCount: 17,
  });
  Object.assign(category.terminalProof, {
    terminalPage: 2,
    terminalUrl,
    expectedRenderedCount: 1,
    renderedCount: 1,
    observedVisibleLinkCount: 3,
    observedPaginationLinks: observedPaginationLinks ?? [
      { href: `${terminalUrl}#`, page: 2, rel: '' },
      { href: category.sourceUrl, page: 1, rel: '' },
      { href: terminalUrl, page: 2, rel: '' },
    ],
  });
  Object.assign(report.scope, {
    expectedPages: 2,
    capturedPages: 2,
    expectedPlacements: 17,
    capturedPlacements: 17,
    uniqueEcsProducts: 17,
  });
  return report;
}

function twoRecordBundle(profileKey, sectionKey) {
  const item = structuredClone(bundle(profileKey, sectionKey));
  const categoryKey = item.capture.categories[0].key;
  const secondRecord = {
    ...structuredClone(item.capture.records[0]),
    ecsPartNumber: 'ES#990000002',
    manufacturerPartNumber: 'F8X-FINAL-AUDIT-2',
    productUrl: 'https://www.ecstuning.com/b-test-brand-parts/f8x-final-audit-product-2/f8x-final-audit-2/',
    relevancePosition: 2,
    title: 'F8X Final Audit Product Two',
  };
  item.capture.records.push(secondRecord);
  for (const category of [
    item.capture.categories[0],
    item.manifest.categories[categoryKey],
    item.report.completeness.categoryAudit[0],
  ]) {
    category.count = 2;
    category.countEvidence.value = '2';
    category.pageCounts = [2];
    category.observedCount = 2;
    category.terminalProof.expectedRenderedCount = 2;
    category.terminalProof.renderedCount = 2;
  }
  for (const proof of [
    item.capture.terminalProofs[categoryKey],
    item.manifest.terminalProofs[categoryKey],
  ]) {
    proof.expectedRenderedCount = 2;
    proof.renderedCount = 2;
  }
  for (const totals of [item.manifest.totals, item.report.scope]) {
    totals.expectedPlacements = 2;
    totals.capturedPlacements = 2;
    totals.uniqueEcsProducts = 2;
    totals.crossCategoryRepeatPlacements = 0;
  }
  return item;
}

function completeTwoRecordBundles() {
  return PROFILE_KEYS.flatMap(profileKey => SECTION_KEYS.map(sectionKey => (
    twoRecordBundle(profileKey, sectionKey)
  )));
}

function canonicalDataSha256(value) {
  function canonical(item) {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical(item[key])]));
    }
    return item;
  }
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function genericShardAudit(quarantinedIdentityCount) {
  const includedSections = ['braking'];
  return {
    generatedAt: GENERATED_AT,
    quarantinedIdentityCount,
    sections: Object.fromEntries(SECTION_KEYS.map(key => [key, {
      productCount: key === 'braking' ? 1 : 0,
    }])),
    captureProgress: {
      complete: false,
      includedSections,
      sections: Object.fromEntries(SECTION_KEYS.map(key => [key, {
        complete: key === 'braking',
        capturedPages: key === 'braking' ? 1 : 0,
        expectedPages: key === 'braking' ? 1 : 0,
        capturedPlacements: key === 'braking' ? 1 : 0,
        expectedPlacements: key === 'braking' ? 1 : 0,
      }])),
    },
  };
}

function renderPriorReviewedAggregateModule(products, quarantine) {
  return '// Generated offline from a validated, dated ECS BMW M3 model-level category capture.\n'
    + `export const BMW_M3_AGGREGATE_QUARANTINED_ECS_IDENTITIES = Object.freeze(${JSON.stringify(quarantine, null, 2)});\n`
    + `export const BMW_M3_AGGREGATE_PRODUCTS = Object.freeze(${JSON.stringify(products, null, 2)});\n`;
}

function currentProduct(digits, { canonical = false, ...overrides } = {}) {
  return {
    publicKey: canonical ? `ecs-es-${digits}` : `ecs-curated-${digits}`,
    slug: canonical ? `es-${digits}` : `curated-${digits}`,
    ecsPartNumber: `ES#${digits}`,
    sku: `ES#${digits}`,
    title: `Current reviewed ${digits}`,
    brand: 'Current Brand',
    priceCurrency: 'USD',
    selectionSources: [{ section: 'Braking', category: 'Current Braking' }],
    filters: { categories: ['bmw-m3', 'bmw-m3-braking'], subcategories: [] },
    ...overrides,
  };
}

function syntheticReleaseBinding(shards, priorIdentities = []) {
  const datasetSha256 = 'a'.repeat(64);
  const identities = shards.map(product => String(product.ecsPartNumber).replace(/^ES#/, '')).sort();
  return {
    releaseId: `20260820T120000000Z-${datasetSha256.slice(0, 16)}`,
    generatedAt: GENERATED_AT,
    productCount: shards.length,
    routeCount: shards.length,
    shardCount: shards.length ? 1 : 0,
    quarantinedIdentityCount: priorIdentities.length,
    productsSha256: canonicalDataSha256(shards),
    artifactSetSha256: 'b'.repeat(64),
    datasetSha256,
    contentSetSha256: 'c'.repeat(64),
    manifestFileSha256: 'd'.repeat(64),
    manifestCanonicalSha256: 'e'.repeat(64),
    productIdentitySetSha256: canonicalDataSha256(identities),
  };
}

function syntheticPriorQuarantine(shards, priorIdentities = []) {
  const sourceRelease = syntheticReleaseBinding(shards, priorIdentities);
  return buildPriorReviewedQuarantineArtifact({
    priorAggregateProducts: shards,
    priorAggregateQuarantinedEcsIdentities: [...priorIdentities].sort(),
    priorAggregateModuleBytes: 1,
    priorAggregateModuleSha256: 'f'.repeat(64),
    currentReviewedShardRelease: sourceRelease,
    currentReviewedShardProducts: shards,
  });
}

function finalized(result, bundles, overrides = {}) {
  const shards = overrides.shards || [currentProduct('880000002', { canonical: true })];
  const priorIdentities = overrides.priorIdentities || [];
  const currentReviewedShardRelease = syntheticReleaseBinding(shards, priorIdentities);
  const captureBundleBinding = verifyF8xCaptureBundleBinding({
    captureBundles: bundles,
    importerAudit: result.audit,
    aggregateProducts: result.products,
    aggregateQuarantinedEcsIdentities: result.quarantinedEcsIdentities,
    nowMs: NOW,
  });
  return finalizeF8xReleaseAudit({
    importerAudit: result.audit,
    reconciliationReports: bundles.map(item => item.report),
    aggregateProducts: result.products,
    aggregateQuarantinedEcsIdentities: result.quarantinedEcsIdentities,
    captureBundleBinding,
    currentReviewedProducts: overrides.current || [currentProduct('880000001')],
    currentReviewedShardProducts: shards,
    currentReviewedShardRelease,
    priorReviewedQuarantineArtifact: overrides.priorArtifact
      || syntheticPriorQuarantine(shards, priorIdentities),
    priorAggregateProducts: shards,
    priorAggregateQuarantinedEcsIdentities: [...priorIdentities].sort(),
    priorAggregateModuleBytes: 1,
    priorAggregateModuleSha256: 'f'.repeat(64),
    mergeReviewedProducts: overrides.mergeReviewedProducts || mergeReviewedEcsProducts,
  });
}

test('accepts the actual normalizer 3×7 contract and derives a builder-compatible seven-section audit', () => {
  const bundles = completeBundles();
  const result = prepareF8xAggregateBundles(bundles, { nowMs: NOW });
  assert.deepEqual(result.products[0].filters.categories, [
    'bmw-f8x',
    'f80-m3',
    'f82-m4',
    'f83-m4',
    'bmw-f8x-braking',
    'bmw-f8x-engine',
    'bmw-f8x-exterior',
    'bmw-f8x-interior',
    'bmw-f8x-suspension',
    'bmw-f8x-steering',
    'bmw-f8x-performance',
  ]);
  const audit = finalized(result, bundles);
  assert.equal(audit.captureProgress.complete, true);
  assert.equal(audit.captureProgress.includedSectionCount, 7);
  assert.equal(audit.captureProgress.sections.braking.vehicleScopeCount, 3);
  assert.equal(audit.captureProgress.sections.braking.capturedPages, 3);
  assert.equal(audit.captureProgress.sections.braking.capturedPlacements, 3);
  assert.equal(audit.sections.braking.productCount, 1);
  assert.equal(audit.sections.braking.f8xOverlayProductCount, 1);
  assert.equal(audit.publicationMergeAudit.currentRuntimeReviewedProductCount, 2);
  assert.equal(audit.publicationMergeAudit.projectedPublishedReviewedEcsCount, 3);
  assert.equal(audit.publicationMergeAudit.unintendedCurrentReviewedRemovalCount, 0);
  assert.equal(audit.publicationPlan.mode, 'separate-f8x-overlay');
  assert.equal(audit.publicationPlan.overlayProductCount, 1);
  assert.equal(audit.publicationPlan.baseRelease.productCount, 1);
  assert.equal(audit.publicationPlan.staticPlusBasePlusOverlayProductCount, 3);
  assert.equal(audit.observationEvidence.scopeCount, 21);
  assert.equal(audit.observationEvidence.observationCount, 21);
  assert.equal(audit.observationEvidence.retainedObservationCount, 21);
  assert.equal(audit.observationEvidence.quarantinedObservationCount, 0);
  assert.match(audit.observationEvidence.placementsSha256, /^[a-f0-9]{64}$/);
  assert.ok(Object.values(audit.observationEvidence.scopes).every(scope => (
    scope.observationCount === 1 && scope.retainedObservationCount === 1
      && scope.quarantinedObservationCount === 0 && /^[a-f0-9]{64}$/.test(scope.placementsSha256)
  )));

  assert.throws(
    () => buildReviewedProductShardRelease(result.products, audit),
    error => error?.code === 'f8x_overlay_mode_required',
  );
});

test('rejects legacy or incomplete F8X category filters', () => {
  const bundles = completeBundles();
  const result = prepareF8xAggregateBundles(bundles, { nowMs: NOW });
  const legacy = structuredClone(result.products);
  legacy[0].filters.categories[0] = 'f8x';
  assert.throws(
    () => finalizeF8xReleaseAudit({
      importerAudit: result.audit,
      reconciliationReports: bundles.map(item => item.report),
      aggregateProducts: legacy,
      aggregateQuarantinedEcsIdentities: result.quarantinedEcsIdentities,
      currentReviewedProducts: [],
      currentReviewedShardProducts: [],
    }),
    error => error instanceof F8xFinalReleaseAuditError && error.code === 'invalid_f8x_filters',
  );

  const incomplete = structuredClone(result.products);
  incomplete[0].filters.categories = incomplete[0].filters.categories
    .filter(value => value !== 'bmw-f8x-performance');
  assert.throws(
    () => finalizeF8xReleaseAudit({
      importerAudit: result.audit,
      reconciliationReports: bundles.map(item => item.report),
      aggregateProducts: incomplete,
      aggregateQuarantinedEcsIdentities: result.quarantinedEcsIdentities,
      currentReviewedProducts: [],
      currentReviewedShardProducts: [],
    }),
    error => error instanceof F8xFinalReleaseAuditError && error.code === 'invalid_f8x_filters',
  );
});

test('rejects a same-count product observation moved to a forged category', () => {
  const bundles = completeBundles();
  const result = prepareF8xAggregateBundles(bundles, { nowMs: NOW });
  const products = structuredClone(result.products);
  const source = products[0].selectionSources[0];
  const membership = products[0].categoryMemberships.find(item => (
    item.vehicleKey === source.vehicleKey && item.section === source.section
      && item.categoryKey === source.categoryKey
  ));
  const observation = products[0].sourceObservations.find(item => (
    item.vehicleKey === source.vehicleKey && item.section === source.section
      && item.categoryKey === source.categoryKey
  ));
  source.category = 'Forged Same-Count Category';
  membership.category = source.category;
  observation.category = source.category;
  assert.throws(
    () => finalized({ ...result, products }, bundles),
    error => error instanceof F8xFinalReleaseAuditError
      && error.code === 'f8x_capture_identity_mismatch',
  );
});

test('requires exact per-category terminal proof, scope counts, and terminal safeguards', () => {
  const source = bundle('f80-m3', 'braking').report;

  const omitted = structuredClone(source);
  delete omitted.completeness.categoryAudit[0].terminalProof;
  assert.throws(
    () => validateF8xReconciliationReport(omitted),
    error => error instanceof F8xFinalReleaseAuditError
      && error.code === 'invalid_f8x_terminal_proof',
  );

  const forged = structuredClone(source);
  const categoryUrl = forged.completeness.categoryAudit[0].sourceUrl;
  forged.completeness.categoryAudit[0].terminalProof.observedPaginationLinks = [{
    href: `${categoryUrl}2/`, page: 2, rel: '',
  }];
  assert.throws(
    () => validateF8xReconciliationReport(forged),
    error => error instanceof F8xFinalReleaseAuditError
      && error.code === 'invalid_f8x_terminal_proof',
  );

  const countMismatch = structuredClone(source);
  countMismatch.scope.terminalProofs = 0;
  assert.throws(
    () => validateF8xReconciliationReport(countMismatch),
    error => error instanceof F8xFinalReleaseAuditError
      && error.code === 'f8x_reconciliation_count_mismatch',
  );

  const unsafe = structuredClone(source);
  unsafe.safeguards.nextUncheckpointPageValidated = false;
  assert.throws(
    () => validateF8xReconciliationReport(unsafe),
    error => error instanceof F8xFinalReleaseAuditError
      && error.code === 'invalid_f8x_reconciliation_report',
  );

  const omittedSafeguard = structuredClone(source);
  delete omittedSafeguard.safeguards.nextUncheckpointPageValidated;
  assert.throws(
    () => validateF8xReconciliationReport(omittedSafeguard),
    error => error instanceof F8xFinalReleaseAuditError
      && error.code === 'invalid_f8x_reconciliation_report',
  );

  const forgedSafeguard = structuredClone(source);
  forgedSafeguard.safeguards.terminalProofAcceptedWithoutObservation = true;
  assert.throws(
    () => validateF8xReconciliationReport(forgedSafeguard),
    error => error instanceof F8xFinalReleaseAuditError
      && error.code === 'invalid_f8x_reconciliation_report',
  );
});

test('accepts exact numeric terminal URLs and capture-compatible bare self anchors', () => {
  const result = validateF8xReconciliationReport(twoPageReconciliationReport());
  assert.equal(result.capturedPages, 2);
  assert.equal(result.capturedPlacements, 17);
});

test('final terminal audit rejects unsafe pagination URL and next-page evidence', () => {
  const cases = [
    {
      name: 'numeric terminal trailing-slash mutation',
      mutate(report) {
        report.completeness.categoryAudit[0].terminalProof.terminalUrl += '/';
      },
    },
    {
      name: 'pagination-link path mutation',
      links: (categoryUrl, terminalUrl) => [
        { href: `${terminalUrl}/`, page: 2, rel: '' },
      ],
    },
    {
      name: 'zero-padded pagination-link path mutation',
      links: categoryUrl => [
        { href: `${categoryUrl}02`, page: 2, rel: '' },
      ],
    },
    {
      name: 'nonempty fragment',
      links: (categoryUrl, terminalUrl) => [
        { href: `${terminalUrl}#pagination`, page: 2, rel: '' },
      ],
    },
    {
      name: 'query',
      links: (categoryUrl, terminalUrl) => [
        { href: `${terminalUrl}?page=2`, page: 2, rel: '' },
      ],
    },
    {
      name: 'bare query delimiter',
      links: (categoryUrl, terminalUrl) => [
        { href: `${terminalUrl}?`, page: 2, rel: '' },
      ],
    },
    {
      name: 'bare anchor on a nonterminal page',
      links: categoryUrl => [{ href: `${categoryUrl}#`, page: 1, rel: '' }],
    },
    {
      name: 'next relationship',
      links: (categoryUrl, terminalUrl) => [{ href: terminalUrl, page: 2, rel: 'next' }],
    },
    {
      name: 'higher page',
      links: categoryUrl => [{ href: `${categoryUrl}3`, page: 3, rel: '' }],
    },
  ];
  for (const scenario of cases) {
    const base = twoPageReconciliationReport();
    const category = base.completeness.categoryAudit[0];
    const terminalUrl = category.pageUrls.at(-1);
    const report = scenario.links
      ? twoPageReconciliationReport(scenario.links(category.sourceUrl, terminalUrl)) : base;
    scenario.mutate?.(report);
    assert.throws(
      () => validateF8xReconciliationReport(report),
      error => error instanceof F8xFinalReleaseAuditError
        && error.code === 'invalid_f8x_terminal_proof',
      scenario.name,
    );
  }
});

test('parses current and BMW-prefixed canonical normalizer exports without executing appended code', () => {
  const result = prepareF8xAggregateBundles(completeBundles(), { nowMs: NOW });
  const currentSource = renderF8xAggregateModule(result);
  assert.equal(parseExactF8xAggregateModule(currentSource).products.length, 1);
  const bmwSource = currentSource
    .replaceAll('F8X_AGGREGATE_QUARANTINED_ECS_IDENTITIES', 'BMW_F8X_AGGREGATE_QUARANTINED_ECS_IDENTITIES')
    .replaceAll('F8X_AGGREGATE_PRODUCTS', 'BMW_F8X_AGGREGATE_PRODUCTS');
  assert.equal(parseExactF8xAggregateModule(bmwSource).products.length, 1);
  delete globalThis.__F8X_FINAL_AUDIT_EXECUTED;
  assert.throws(
    () => parseExactF8xAggregateModule(`${currentSource}globalThis.__F8X_FINAL_AUDIT_EXECUTED = true;\n`),
    error => error instanceof F8xFinalReleaseAuditError && error.code === 'invalid_aggregate_module_format',
  );
  assert.equal(globalThis.__F8X_FINAL_AUDIT_EXECUTED, undefined);

  const priorSource = '// Generated offline from a validated, dated ECS BMW M3 model-level category capture.\n'
    + 'export const BMW_M3_AGGREGATE_QUARANTINED_ECS_IDENTITIES = Object.freeze([]);\n'
    + 'export const BMW_M3_AGGREGATE_PRODUCTS = Object.freeze([]);\n';
  assert.deepEqual(parseExactPriorReviewedAggregateModule(priorSource), {
    products: [], quarantine: [],
  });
  delete globalThis.__PRIOR_QUARANTINE_EXECUTED;
  assert.throws(
    () => parseExactPriorReviewedAggregateModule(
      `${priorSource}globalThis.__PRIOR_QUARANTINE_EXECUTED = true;\n`,
    ),
    error => error instanceof F8xFinalReleaseAuditError
      && error.code === 'invalid_prior_aggregate_module_format',
  );
  assert.equal(globalThis.__PRIOR_QUARANTINE_EXECUTED, undefined);
});

test('rejects a missing or duplicate scope and explicitly removes a quarantined current product', () => {
  const bundles = completeBundles();
  const result = prepareF8xAggregateBundles(bundles, { nowMs: NOW });
  assert.throws(
    () => finalizeF8xReleaseAudit({
      importerAudit: result.audit,
      reconciliationReports: bundles.slice(0, -1).map(item => item.report),
      aggregateProducts: result.products,
      aggregateQuarantinedEcsIdentities: result.quarantinedEcsIdentities,
      currentReviewedProducts: [],
      currentReviewedShardProducts: [],
    }),
    error => error instanceof F8xFinalReleaseAuditError && error.code === 'f8x_reconciliation_report_count',
  );
  const duplicateReports = bundles.map(item => item.report);
  duplicateReports[20] = structuredClone(duplicateReports[0]);
  assert.throws(
    () => finalizeF8xReleaseAudit({
      importerAudit: result.audit,
      reconciliationReports: duplicateReports,
      aggregateProducts: result.products,
      aggregateQuarantinedEcsIdentities: result.quarantinedEcsIdentities,
      currentReviewedProducts: [],
      currentReviewedShardProducts: [],
    }),
    error => error instanceof F8xFinalReleaseAuditError && error.code === 'duplicate_f8x_reconciliation_scope',
  );

  const conflictBundles = completeBundles((profileKey, sectionKey) => (
    profileKey === 'f83-m4' && sectionKey === 'performance'
      ? { manufacturerPartNumber: 'CONFLICT', priceText: '$599.99', priceBlockText: '$599.99' }
      : {}
  ));
  const conflict = prepareF8xAggregateBundles(conflictBundles, { nowMs: NOW });
  assert.deepEqual(conflict.quarantinedEcsIdentities, [PRODUCT_DIGITS]);
  const filtered = finalized(conflict, conflictBundles, {
    shards: [currentProduct(PRODUCT_DIGITS, { canonical: true })],
  });
  assert.equal(filtered.publicationMergeAudit.currentReviewedRemovedByProjectedQuarantineCount, 1);
  assert.deepEqual(filtered.publicationMergeAudit.currentReviewedRemovedByProjectedQuarantine, {
    identityCount: 1,
    identitiesSha256: canonicalDataSha256([PRODUCT_DIGITS]),
  });
  assert.equal(filtered.publicationMergeAudit.projectedPublishedReviewedEcsCount, 1);
});

test('merges static plus the overlaid shard candidate and rejects a cross-layer identity conflict', () => {
  const bundles = completeBundles();
  const result = prepareF8xAggregateBundles(bundles, { nowMs: NOW });
  assert.throws(
    () => finalized(result, bundles, {
      current: [currentProduct(PRODUCT_DIGITS, { mpn: 'STATIC-CONFLICT' })],
      shards: [currentProduct(PRODUCT_DIGITS, { canonical: true })],
    }),
    error => error instanceof F8xFinalReleaseAuditError
      && error.code === 'candidate_merge_conflict',
  );
});

test('requires a release-bound prior quarantine and preserves it in projected quarantine counts', () => {
  const bundles = completeBundles();
  const result = prepareF8xAggregateBundles(bundles, { nowMs: NOW });
  const shards = [currentProduct('880000002', { canonical: true })];
  const currentReviewedShardRelease = syntheticReleaseBinding(shards);
  const captureBundleBinding = verifyF8xCaptureBundleBinding({
    captureBundles: bundles,
    importerAudit: result.audit,
    aggregateProducts: result.products,
    aggregateQuarantinedEcsIdentities: result.quarantinedEcsIdentities,
    nowMs: NOW,
  });
  assert.throws(
    () => finalizeF8xReleaseAudit({
      importerAudit: result.audit,
      reconciliationReports: bundles.map(item => item.report),
      aggregateProducts: result.products,
      aggregateQuarantinedEcsIdentities: result.quarantinedEcsIdentities,
      captureBundleBinding,
      currentReviewedProducts: [],
      currentReviewedShardProducts: shards,
      currentReviewedShardRelease,
      mergeReviewedProducts: mergeReviewedEcsProducts,
    }),
    error => error instanceof F8xFinalReleaseAuditError
      && error.code === 'invalid_prior_quarantine',
  );

  const forged = syntheticPriorQuarantine(shards);
  forged.quarantinedIdentityCount = 1;
  assert.throws(
    () => finalized(result, bundles, { shards, priorArtifact: forged }),
    error => error instanceof F8xFinalReleaseAuditError
      && error.code === 'invalid_prior_quarantine',
  );

  const sourceIdentity = '777000001';
  const substitutedIdentity = '777000999';
  const sameCountSubstitution = syntheticPriorQuarantine(shards, [sourceIdentity]);
  sameCountSubstitution.quarantinedEcsIdentities = [substitutedIdentity];
  sameCountSubstitution.sourceAggregate.quarantinedIdentitiesSha256 = canonicalDataSha256([
    substitutedIdentity,
  ]);
  assert.throws(
    () => finalized(result, bundles, {
      shards,
      priorIdentities: [sourceIdentity],
      priorArtifact: sameCountSubstitution,
    }),
    error => error instanceof F8xFinalReleaseAuditError
      && error.code === 'invalid_prior_quarantine',
  );

  const filteredOverlay = finalized(result, bundles, {
    current: [],
    shards,
    priorIdentities: [PRODUCT_DIGITS],
  });
  assert.equal(filteredOverlay.publicationPlan.overlayProductCount, 0);
  assert.equal(filteredOverlay.publicationMergeAudit.projectedQuarantinedIdentityCount, 1);
  assert.equal(filteredOverlay.publicationMergeAudit.projectedPublishedReviewedEcsCount, 1);

  let mergeCall = 0;
  assert.throws(
    () => finalized(result, bundles, {
      current: [],
      shards,
      priorIdentities: [PRODUCT_DIGITS],
      mergeReviewedProducts(existing, generated) {
        mergeCall += 1;
        const merged = mergeReviewedEcsProducts(existing, generated);
        return mergeCall === 3
          ? [...merged, currentProduct(PRODUCT_DIGITS, { canonical: true })]
          : merged;
      },
    }),
    error => error instanceof F8xFinalReleaseAuditError
      && error.code === 'projected_quarantine_survivor',
  );

  const preservedIdentity = '777000001';
  const audit = finalized(result, bundles, {
    shards,
    priorIdentities: [preservedIdentity],
  });
  assert.deepEqual(audit.projectedQuarantinedEcsIdentities, [preservedIdentity]);
  assert.equal(audit.quarantinedIdentityCount, 1);
  assert.equal(audit.publicationMergeAudit.projectedQuarantinedIdentityCount, 1);
  assert.deepEqual(audit.publicationPlan.priorQuarantine, {
    identityCount: 1,
    identitiesSha256: canonicalDataSha256([preservedIdentity]),
  });
});

test('prior quarantine artifact creation rejects a source identity set that differs from the bound release', () => {
  const shards = [currentProduct('880000002', { canonical: true })];
  const binding = syntheticReleaseBinding(shards);
  assert.throws(
    () => buildPriorReviewedQuarantineArtifact({
      priorAggregateProducts: [currentProduct('880000003', { canonical: true })],
      priorAggregateQuarantinedEcsIdentities: [],
      priorAggregateModuleBytes: 1,
      priorAggregateModuleSha256: 'f'.repeat(64),
      currentReviewedShardRelease: binding,
      currentReviewedShardProducts: shards,
    }),
    error => error instanceof F8xFinalReleaseAuditError
      && error.code === 'prior_aggregate_release_mismatch',
  );

  const sameIdentityChangedProduct = [structuredClone(shards[0])];
  sameIdentityChangedProduct[0].title = 'Changed content under the same ES identity';
  assert.throws(
    () => buildPriorReviewedQuarantineArtifact({
      priorAggregateProducts: sameIdentityChangedProduct,
      priorAggregateQuarantinedEcsIdentities: [],
      priorAggregateModuleBytes: 1,
      priorAggregateModuleSha256: 'f'.repeat(64),
      currentReviewedShardRelease: binding,
      currentReviewedShardProducts: shards,
    }),
    error => error instanceof F8xFinalReleaseAuditError
      && error.code === 'prior_aggregate_release_mismatch',
  );
});

async function fileFixture(context, { bundles = completeBundles() } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'projx-f8x-final-audit-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const result = prepareF8xAggregateBundles(bundles, { nowMs: NOW });
  const auditPath = path.join(root, 'f8x-aggregate-audit.json');
  const aggregateModulePath = path.join(root, 'f8x-aggregate-products.mjs');
  const reportsDirectory = path.join(root, 'reports');
  const currentReviewedShardDirectory = path.join(root, 'current-reviewed-shards');
  const currentShardProducts = [currentProduct('880000002', { canonical: true })];
  const currentShardRelease = buildReviewedProductShardRelease(
    currentShardProducts,
    genericShardAudit(1),
  );
  await writeReviewedProductShardRelease(currentReviewedShardDirectory, currentShardRelease);
  const priorAggregateModulePath = path.join(root, 'prior-reviewed-aggregate.mjs');
  await writeFile(priorAggregateModulePath, renderPriorReviewedAggregateModule(
    currentShardProducts,
    [STATIC_QUARANTINE_IDENTITY],
  ));
  const priorVerified = await verifyPriorReviewedQuarantineFiles({
    priorAggregateModulePath,
    currentReviewedShardDirectory,
    workDirectory: root,
  });
  const priorQuarantinePath = path.join(root, 'ecs-reviewed-prior-quarantine.json');
  await writePriorReviewedQuarantineCreateOnly(
    priorQuarantinePath,
    priorVerified.artifact,
    priorVerified.roots,
  );
  await mkdir(reportsDirectory);
  await writeFile(auditPath, `${JSON.stringify(result.audit, null, 2)}\n`);
  await writeFile(aggregateModulePath, renderF8xAggregateModule(result));
  const reconciliationPaths = [];
  const captureBundlePaths = [];
  for (const item of bundles) {
    const stem = item.report.kind.replace(/-reconciliation-report$/, '');
    const recordsPath = path.join(reportsDirectory, `${stem}-records.json`);
    const manifestPath = path.join(reportsDirectory, `${stem}-manifest.json`);
    const reportPath = path.join(reportsDirectory, `${stem}-reconciliation-report.json`);
    await Promise.all([
      writeFile(recordsPath, `${JSON.stringify(item.capture, null, 2)}\n`),
      writeFile(manifestPath, `${JSON.stringify(item.manifest, null, 2)}\n`),
      writeFile(reportPath, `${JSON.stringify(item.report, null, 2)}\n`),
    ]);
    reconciliationPaths.push(reportPath);
    captureBundlePaths.push({ recordsPath, manifestPath, reportPath });
  }
  return {
    root,
    auditPath,
    aggregateModulePath,
    priorAggregateModulePath,
    currentReviewedModulePath: TRUSTED_CURRENT_REVIEWED_MODULE,
    currentReviewedShardDirectory,
    priorQuarantinePath,
    priorVerified,
    bundles,
    result,
    reconciliationPaths,
    captureBundlePaths,
    currentShardProducts,
  };
}

test('reopens a temp canonical prior module and binds all 21 exact sibling capture bundles', async (context) => {
  const item = await fileFixture(context);
  assert.match(item.priorVerified.inputSetSha256, /^[a-f0-9]{64}$/);
  assert.equal(item.priorVerified.checksums.currentReviewedShardRelease.productCount, 1);
  assert.match(item.priorVerified.checksums.currentReviewedShardRelease.manifestFileSha256,
    /^[a-f0-9]{64}$/);
  assert.match(item.priorVerified.checksums.currentReviewedShardRelease.manifestCanonicalSha256,
    /^[a-f0-9]{64}$/);
  assert.match(item.priorVerified.checksums.currentReviewedShardRelease.artifactSetSha256,
    /^[a-f0-9]{64}$/);
  assert.equal(item.priorVerified.artifact.quarantinedIdentityCount, 1);
  assert.deepEqual(item.priorVerified.artifact.quarantinedEcsIdentities, [STATIC_QUARANTINE_IDENTITY]);
  const verified = await verifyF8xReleaseAuditFiles({ ...item, workDirectory: item.root });
  assert.match(verified.inputSetSha256, /^[a-f0-9]{64}$/);
  assert.equal(Object.keys(verified.checksums.captureBundles).length, 21);
  assert.ok(Object.values(verified.checksums.captureBundles).every(bundleChecksums => (
    ['records', 'manifest', 'reconciliationReport'].every(key => (
      bundleChecksums[key].bytes > 0 && /^[a-f0-9]{64}$/.test(bundleChecksums[key].sha256)
    ))
  )));
  assert.equal(verified.checksums.priorReviewedQuarantineArtifact.identityCount, 1);
  assert.equal(verified.finalizedAudit.publicationMergeAudit
    .currentReviewedRemovedByProjectedQuarantineCount, 1);
  assert.deepEqual(verified.finalizedAudit.publicationMergeAudit
    .currentReviewedRemovedByProjectedQuarantine, {
    identityCount: 1,
    identitiesSha256: canonicalDataSha256([STATIC_QUARANTINE_IDENTITY]),
  });
  assert.equal(verified.finalizedAudit.publicationMergeAudit.projectedQuarantinedIdentityCount, 1);
  assert.equal(verified.finalizedAudit.publicationPlan.mode, 'separate-f8x-overlay');
  assert.equal(verified.finalizedAudit.publicationPlan.overlayProductCount, 1);
  assert.equal(verified.finalizedAudit.publicationPlan.baseRelease.productCount, 1);
  assert.deepEqual(
    verified.finalizedAudit.placementIdentityEvidence,
    verified.finalizedAudit.observationEvidence.capturePlacementIdentityEvidence,
  );

  const pinned = await verifyF8xReleaseAuditFiles({
    ...item,
    workDirectory: item.root,
    expectedInputSetSha256: verified.inputSetSha256,
  });
  const outputPath = path.join(item.root, 'f8x-final-release-audit.json');
  await writeF8xFinalReleaseAuditCreateOnly(outputPath, pinned.finalizedAudit, pinned.roots);
  const written = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.equal(written.publicationPlan.mode, 'separate-f8x-overlay');
  assert.equal(written.finalReleaseAudit.inputSetSha256, verified.inputSetSha256);
  assert.equal(written.captureProgress.sections.performance.vehicleScopeCount, 3);
  await assert.rejects(
    () => writeF8xFinalReleaseAuditCreateOnly(outputPath, pinned.finalizedAudit, pinned.roots),
    error => error instanceof F8xFinalReleaseAuditError && error.code === 'output_exists',
  );
});

test('rejects a same-count ES substitution across all 21 records captures', async (context) => {
  const item = await fileFixture(context);
  for (const { recordsPath } of item.captureBundlePaths) {
    const capture = JSON.parse(await readFile(recordsPath, 'utf8'));
    capture.records[0].ecsPartNumber = 'ES#990000099';
    await writeFile(recordsPath, `${JSON.stringify(capture, null, 2)}\n`);
  }
  await assert.rejects(
    verifyF8xReleaseAuditFiles({ ...item, workDirectory: item.root }),
    error => error instanceof F8xFinalReleaseAuditError
      && error.code === 'f8x_capture_identity_mismatch',
  );
});

test('rejects a two-product position swap with unchanged scope and product counts', async (context) => {
  const item = await fileFixture(context, { bundles: completeTwoRecordBundles() });
  const { recordsPath } = item.captureBundlePaths[0];
  const capture = JSON.parse(await readFile(recordsPath, 'utf8'));
  const [first, second] = capture.records;
  capture.records = [
    { ...second, relevancePosition: first.relevancePosition },
    { ...first, relevancePosition: second.relevancePosition },
  ];
  await writeFile(recordsPath, `${JSON.stringify(capture, null, 2)}\n`);
  await assert.rejects(
    verifyF8xReleaseAuditFiles({ ...item, workDirectory: item.root }),
    error => error instanceof F8xFinalReleaseAuditError
      && error.code === 'f8x_capture_identity_mismatch',
  );
});
