import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BMW_M3_FINAL_SECTIONS,
  FinalReleaseAuditError,
  finalizeBmwM3ReleaseAudit,
  validateFinalReconciliationReport,
  verifyBmwM3ReleaseAuditFiles,
  writeFinalReleaseAuditCreateOnly,
  __test,
} from './finalize-bmw-m3-release-audit.mjs';

const GENERATED_AT = '2026-08-10T04:00:00.000Z';
const SECTION_KEYS = Object.keys(BMW_M3_FINAL_SECTIONS);
const TRUSTED_CURRENT_REVIEWED_MODULE = fileURLToPath(new URL('../../server/ecs-reviewed-catalog.js', import.meta.url));

function aggregateModule(products, quarantine) {
  return '// Generated offline from a validated, dated ECS BMW M3 model-level category capture.\n'
    + `export const BMW_M3_AGGREGATE_QUARANTINED_ECS_IDENTITIES = Object.freeze(${JSON.stringify(quarantine, null, 2)});\n`
    + `export const BMW_M3_AGGREGATE_PRODUCTS = Object.freeze(${JSON.stringify(products, null, 2)});\n`;
}

function product(index, key) {
  const digits = String(1_000 + index);
  const section = BMW_M3_FINAL_SECTIONS[key];
  return {
    publicKey: `ecs-es-${digits}`,
    slug: `es-${digits}`,
    ecsPartNumber: `ES#${digits}`,
    sku: `ES#${digits}`,
    title: `${section.label} product`,
    brand: 'Fixture Brand',
    priceCurrency: 'USD',
    selectionSources: [{
      section: section.label,
      category: `BMW M3 ${section.label} Fixture Parts`,
    }],
  };
}

function currentProduct(digits) {
  return {
    publicKey: `ecs-es-${digits}`,
    slug: `current-es-${digits}`,
    ecsPartNumber: `ES#${digits}`,
    sku: `ES#${digits}`,
    title: `Current reviewed ${digits}`,
  };
}

function report(key) {
  const section = BMW_M3_FINAL_SECTIONS[key];
  const category = `BMW M3 ${section.label} Fixture Parts`;
  return {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    accessClass: 'public-retail',
    kind: `bmw-m3-${key}-reconciliation-report`,
    captureStartedAt: '2026-08-10T03:00:00.000Z',
    generatedAt: GENERATED_AT,
    source: {
      rootUrl: 'https://www.ecstuning.com/BMW-M3/',
      sectionUrl: `https://www.ecstuning.com/BMW-M3/${section.path}/`,
      discoveryRule: 'visible-links-only',
    },
    scope: {
      vehicle: 'BMW M3',
      section: section.label,
      categories: 1,
      expectedPages: 1,
      capturedPages: 1,
      expectedPlacements: 1,
      capturedPlacements: 1,
      uniqueEcsProducts: 1,
      crossCategoryRepeatPlacements: 0,
    },
    completeness: {
      complete: true,
      status: 'reconciled',
      exactCategories: 1,
      categoryAudit: [{
        key: `bmw-m3-${key}-fixture-parts`,
        name: category,
        sourceUrl: `https://www.ecstuning.com/BMW-M3/${section.path}/Fixture/`,
        count: 1,
        countEvidence: 'data-count: 1',
        expectedPages: 1,
        pages: 1,
        pageCounts: [1],
        pageUrls: [`https://www.ecstuning.com/BMW-M3/${section.path}/Fixture/`],
        positionsContiguous: true,
        observedCount: 1,
        exact: true,
      }],
      requiredMissing: {
        availabilityText: 0,
        ecsPartNumber: 0,
        manufacturerPartNumber: 0,
        priceText: 0,
        productUrl: 0,
        sourceUrl: 0,
        title: 0,
      },
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
  };
}

function interiorSeatReport() {
  const document = report('interior');
  const category = document.completeness.categoryAudit[0];
  category.key = 'bmw-m3-interior-seat-parts';
  category.name = 'BMW M3 Interior Seat Parts';
  category.sourceUrl = 'https://www.ecstuning.com/BMW-M3/Interior/Seats/';
  category.count = 559;
  category.expectedPages = 35;
  category.pages = 35;
  category.pageCounts = [...Array(34).fill(16), 15];
  category.pageUrls = Array.from({ length: 35 }, (_, index) => (
    index === 0 ? category.sourceUrl : `${category.sourceUrl}${index + 1}`
  ));
  category.observedCount = 559;
  document.scope.expectedPages = 35;
  document.scope.capturedPages = 35;
  document.scope.expectedPlacements = 559;
  document.scope.capturedPlacements = 559;
  document.scope.uniqueEcsProducts = 559;
  return document;
}

function exteriorBodyReport() {
  const document = report('exterior');
  const category = document.completeness.categoryAudit[0];
  category.key = 'bmw-m3-exterior-body-parts';
  category.name = 'BMW M3 Exterior Body Parts';
  category.sourceUrl = 'https://www.ecstuning.com/BMW-M3/Exterior/Body/';
  category.count = 2_549;
  category.expectedPages = 160;
  category.pages = 160;
  category.pageCounts = [...Array(159).fill(16), 5];
  category.pageUrls = Array.from({ length: 160 }, (_, index) => (
    index === 0 ? category.sourceUrl : `${category.sourceUrl}${index + 1}`
  ));
  category.observedCount = 2_549;
  document.scope.expectedPages = 160;
  document.scope.capturedPages = 160;
  document.scope.expectedPlacements = 2_549;
  document.scope.capturedPlacements = 2_549;
  document.scope.uniqueEcsProducts = 2_549;
  return document;
}

function inputsWithQuarantine(identities) {
  const item = inputs();
  item.quarantine = [...identities];
  item.audit.rawRecordCount += identities.length;
  item.audit.validatedRecordCount += identities.length;
  item.audit.uniqueValidatedEcsIdentityCount += identities.length;
  item.audit.quarantinedIdentityCount = identities.length;
  item.audit.quarantinedRecordCount = identities.length;
  item.audit.quarantine = identities.map((identity, index) => ({
    ecsPartNumber: `ES#${identity}`,
    reasons: ['conflicting-same-day-public-price'],
    recordIndexes: [7 + index],
    sections: ['Braking'],
  }));
  item.audit.sections.braking.observationCount += identities.length;
  const braking = item.reports[0];
  braking.scope.expectedPlacements += identities.length;
  braking.scope.capturedPlacements += identities.length;
  braking.scope.uniqueEcsProducts += identities.length;
  braking.completeness.categoryAudit[0].count += identities.length;
  braking.completeness.categoryAudit[0].pageCounts[0] += identities.length;
  braking.completeness.categoryAudit[0].observedCount += identities.length;
  return item;
}

function inputs() {
  const reports = SECTION_KEYS.map(report);
  const products = SECTION_KEYS.map((key, index) => product(index, key));
  const sections = Object.fromEntries(SECTION_KEYS.map((key) => {
    const section = BMW_M3_FINAL_SECTIONS[key];
    return [key, {
      label: section.label,
      observationCount: 1,
      productCount: 1,
      categories: [`BMW M3 ${section.label} Fixture Parts`],
    }];
  }));
  const audit = {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    kind: 'bmw-m3-aggregate-import-audit',
    generatedAt: GENERATED_AT,
    sourceKind: 'bmw-m3-aggregate-listing-capture',
    sourceGeneratedAt: GENERATED_AT,
    rawRecordCount: 7,
    validatedRecordCount: 7,
    invalidRecordCount: 0,
    uniqueValidatedEcsIdentityCount: 7,
    productCount: 7,
    quarantinedIdentityCount: 0,
    quarantinedRecordCount: 0,
    duplicateObservationCount: 0,
    sections,
    invalidRecords: [],
    quarantine: [],
  };
  return {
    audit,
    reports,
    products,
    quarantine: [],
    current: [currentProduct('1000'), currentProduct('9999')],
  };
}

function finalize(overrides = {}) {
  const item = inputs();
  return finalizeBmwM3ReleaseAudit({
    importerAudit: overrides.audit ?? item.audit,
    reconciliationReports: overrides.reports ?? item.reports,
    aggregateProducts: overrides.products ?? item.products,
    aggregateQuarantinedEcsIdentities: overrides.quarantine ?? item.quarantine,
    currentReviewedProducts: overrides.current ?? item.current,
    inputChecksums: overrides.inputChecksums ?? null,
    inputSetSha256: overrides.inputSetSha256 ?? null,
  });
}

async function fileFixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'projx-final-audit-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const item = inputs();
  const auditPath = path.join(root, 'importer-audit.json');
  const aggregateModulePath = path.join(root, 'aggregate-products.mjs');
  const reportsDir = path.join(root, 'reports');
  await mkdir(reportsDir);
  await writeFile(auditPath, `${JSON.stringify(item.audit, null, 2)}\n`);
  await writeFile(aggregateModulePath, aggregateModule(item.products, item.quarantine));
  const reconciliationPaths = [];
  for (const [index, reportDocument] of item.reports.entries()) {
    const filename = path.join(reportsDir, `${SECTION_KEYS[index]}.json`);
    await writeFile(filename, `${JSON.stringify(reportDocument, null, 2)}\n`);
    reconciliationPaths.push(filename);
  }
  return {
    root,
    auditPath,
    aggregateModulePath,
    currentReviewedModulePath: TRUSTED_CURRENT_REVIEWED_MODULE,
    reconciliationPaths,
  };
}

test('finalizes seven exact sections and computes publication counts from actual products', () => {
  const output = finalize({
    inputSetSha256: 'a'.repeat(64),
    inputChecksums: {
      reconciliationReports: Object.fromEntries(SECTION_KEYS.map(key => [key, { sha256: key.padEnd(64, '0') }])),
    },
  });
  assert.equal(output.captureProgress.complete, true);
  assert.equal(output.captureProgress.includedSectionCount, 7);
  assert.deepEqual(output.captureProgress.excludedSections, []);
  assert.equal(output.publicationMergeAudit.staticReviewedProductCount, 2);
  assert.equal(output.publicationMergeAudit.generatedProductCount, 7);
  assert.equal(output.publicationMergeAudit.overlapWithPreviouslyReviewedEcsCount, 1);
  assert.equal(output.publicationMergeAudit.newUniqueProductCount, 6);
  assert.equal(output.publicationMergeAudit.currentReviewedRemovedByIncomingQuarantineCount, 0);
  assert.equal(output.publicationMergeAudit.projectedPublishedReviewedEcsCount, 8);
  assert.equal(output.finalReleaseAudit.inputSetSha256, 'a'.repeat(64));
});

test('subtracts current reviewed products removed by the incoming aggregate quarantine', () => {
  const item = inputs();
  const quarantined = ['4017812', '4630189', '4715378'];
  item.quarantine = [...quarantined];
  item.current.push(...quarantined.map(currentProduct));
  item.audit.rawRecordCount = 10;
  item.audit.validatedRecordCount = 10;
  item.audit.uniqueValidatedEcsIdentityCount = 10;
  item.audit.quarantinedIdentityCount = 3;
  item.audit.quarantinedRecordCount = 3;
  item.audit.quarantine = quarantined.map((identity, index) => ({
    ecsPartNumber: `ES#${identity}`,
    reasons: ['conflicting-same-day-public-price'],
    recordIndexes: [7 + index],
    sections: ['Braking'],
  }));
  item.audit.sections.braking.observationCount = 4;
  const braking = item.reports[0];
  braking.scope.expectedPlacements = 4;
  braking.scope.capturedPlacements = 4;
  braking.scope.uniqueEcsProducts = 4;
  braking.completeness.categoryAudit[0].count = 4;
  braking.completeness.categoryAudit[0].pageCounts = [4];
  braking.completeness.categoryAudit[0].observedCount = 4;

  const output = finalizeBmwM3ReleaseAudit({
    importerAudit: item.audit,
    reconciliationReports: item.reports,
    aggregateProducts: item.products,
    aggregateQuarantinedEcsIdentities: item.quarantine,
    currentReviewedProducts: item.current,
  });
  assert.equal(output.publicationMergeAudit.overlapWithPreviouslyReviewedEcsCount, 1);
  assert.equal(output.publicationMergeAudit.newUniqueProductCount, 6);
  assert.equal(output.publicationMergeAudit.currentReviewedRemovedByIncomingQuarantineCount, 3);
  assert.equal(output.publicationMergeAudit.projectedPublishedReviewedEcsCount, 8);
  assert.equal(3_383 + 14_314 - 2_162
    - output.publicationMergeAudit.currentReviewedRemovedByIncomingQuarantineCount, 15_532);
});

test('rejects incomplete, non-exact, or unsafe reconciliation reports', () => {
  const incomplete = inputs();
  incomplete.reports[0].completeness.complete = false;
  assert.throws(
    () => finalize({ reports: incomplete.reports }),
    error => error instanceof FinalReleaseAuditError && error.code === 'incomplete_reconciliation_report',
  );
  const inexact = inputs();
  inexact.reports[1].completeness.categoryAudit[0].exact = false;
  assert.throws(
    () => finalize({ reports: inexact.reports }),
    error => error instanceof FinalReleaseAuditError && error.code === 'unreconciled_category',
  );
  const unsafe = inputs();
  unsafe.reports[2].safeguards.challengeBypassUsed = true;
  assert.throws(
    () => finalize({ reports: unsafe.reports }),
    error => error instanceof FinalReleaseAuditError && error.code === 'unsafe_reconciliation_report',
  );
});

test('enforces the real Interior pagination shape and rejects duplicate, reordered, or cross-category page URLs', () => {
  const valid = interiorSeatReport();
  const summary = validateFinalReconciliationReport(valid);
  assert.equal(summary.label, 'Interior');
  assert.equal(summary.capturedPages, 35);

  const duplicate = structuredClone(valid);
  duplicate.completeness.categoryAudit[0].pageUrls[34]
    = duplicate.completeness.categoryAudit[0].pageUrls[0];
  assert.throws(
    () => validateFinalReconciliationReport(duplicate),
    error => error instanceof FinalReleaseAuditError && error.code === 'unreconciled_category',
  );

  const reordered = structuredClone(valid);
  [reordered.completeness.categoryAudit[0].pageUrls[1], reordered.completeness.categoryAudit[0].pageUrls[2]]
    = [reordered.completeness.categoryAudit[0].pageUrls[2], reordered.completeness.categoryAudit[0].pageUrls[1]];
  assert.throws(
    () => validateFinalReconciliationReport(reordered),
    error => error instanceof FinalReleaseAuditError && error.code === 'unreconciled_category',
  );

  const crossCategory = structuredClone(valid);
  const repeatedCategory = structuredClone(crossCategory.completeness.categoryAudit[0]);
  repeatedCategory.key = 'bmw-m3-interior-seat-parts-copy';
  repeatedCategory.name = 'BMW M3 Interior Seat Parts Copy';
  crossCategory.completeness.categoryAudit.push(repeatedCategory);
  crossCategory.completeness.exactCategories = 2;
  crossCategory.scope.categories = 2;
  crossCategory.scope.expectedPages = 70;
  crossCategory.scope.capturedPages = 70;
  crossCategory.scope.expectedPlacements = 1_118;
  crossCategory.scope.capturedPlacements = 1_118;
  crossCategory.scope.uniqueEcsProducts = 1_118;
  assert.throws(
    () => validateFinalReconciliationReport(crossCategory),
    error => error instanceof FinalReleaseAuditError && error.code === 'duplicate_reconciliation_page',
  );
});

test('enforces the real Exterior 16-card page shape and rejects a collapsed-page report', () => {
  const valid = exteriorBodyReport();
  const summary = validateFinalReconciliationReport(valid);
  assert.equal(summary.label, 'Exterior');
  assert.equal(summary.capturedPages, 160);
  assert.equal(summary.capturedPlacements, 2_549);

  const collapsed = structuredClone(valid);
  const category = collapsed.completeness.categoryAudit[0];
  category.expectedPages = 1;
  category.pages = 1;
  category.pageCounts = [2_549];
  category.pageUrls = [category.sourceUrl];
  collapsed.scope.expectedPages = 1;
  collapsed.scope.capturedPages = 1;
  assert.throws(
    () => validateFinalReconciliationReport(collapsed),
    error => error instanceof FinalReleaseAuditError && error.code === 'unreconciled_category',
  );
});

test('rejects page and placement drift, missing required fields, duplicates, and identity conflicts', () => {
  const pageDrift = inputs();
  pageDrift.reports[0].completeness.categoryAudit[0].pageCounts = [2];
  assert.throws(
    () => finalize({ reports: pageDrift.reports }),
    error => error instanceof FinalReleaseAuditError && error.code === 'unreconciled_category',
  );
  const missing = inputs();
  missing.reports[1].completeness.requiredMissing.title = 1;
  assert.throws(
    () => finalize({ reports: missing.reports }),
    error => error instanceof FinalReleaseAuditError && error.code === 'required_fields_missing',
  );
  const duplicate = inputs();
  duplicate.reports[2].completeness.duplicatePlacements = [{ key: 'fixture|1002', count: 2 }];
  assert.throws(
    () => finalize({ reports: duplicate.reports }),
    error => error instanceof FinalReleaseAuditError && error.code === 'reconciliation_conflict',
  );
  const conflict = inputs();
  conflict.reports[3].consistency.identityConflicts = [{ ecsPartNumber: 'ES#1003' }];
  assert.throws(
    () => finalize({ reports: conflict.reports }),
    error => error instanceof FinalReleaseAuditError && error.code === 'reconciliation_conflict',
  );
});

test('rejects stale section counts and product scope mismatches', () => {
  const stale = inputs();
  stale.audit.sections.engine.observationCount = 2;
  assert.throws(
    () => finalize({ audit: stale.audit }),
    error => error instanceof FinalReleaseAuditError && error.code === 'stale_section_audit',
  );
  const wrongCategory = inputs();
  wrongCategory.products[0].selectionSources[0].category = 'Unverified category';
  assert.throws(
    () => finalize({ products: wrongCategory.products }),
    error => error instanceof FinalReleaseAuditError && error.code === 'product_scope_mismatch',
  );
});

test('binds reported per-section unique identities to aggregate and quarantine evidence', () => {
  const item = inputs();
  item.audit.rawRecordCount = 8;
  item.audit.validatedRecordCount = 8;
  item.audit.duplicateObservationCount = 1;
  item.audit.sections.braking.observationCount = 2;
  const braking = item.reports[0];
  braking.scope.expectedPlacements = 2;
  braking.scope.capturedPlacements = 2;
  braking.scope.uniqueEcsProducts = 2;
  braking.completeness.categoryAudit[0].count = 2;
  braking.completeness.categoryAudit[0].pageCounts = [2];
  braking.completeness.categoryAudit[0].observedCount = 2;

  assert.throws(
    () => finalizeBmwM3ReleaseAudit({
      importerAudit: item.audit,
      reconciliationReports: item.reports,
      aggregateProducts: item.products,
      aggregateQuarantinedEcsIdentities: item.quarantine,
      currentReviewedProducts: item.current,
    }),
    error => error instanceof FinalReleaseAuditError && error.code === 'stale_section_identity_count',
  );
});

test('rejects missing, unknown, duplicate, or record-inconsistent quarantine section evidence', () => {
  function quarantined(sections) {
    const item = inputs();
    item.quarantine = ['4017812'];
    item.audit.rawRecordCount = 8;
    item.audit.validatedRecordCount = 8;
    item.audit.uniqueValidatedEcsIdentityCount = 8;
    item.audit.quarantinedIdentityCount = 1;
    item.audit.quarantinedRecordCount = 1;
    item.audit.quarantine = [{
      ecsPartNumber: 'ES#4017812',
      reasons: ['conflicting-same-day-public-price'],
      recordIndexes: [7],
      ...(sections === undefined ? {} : { sections }),
    }];
    item.audit.sections.braking.observationCount = 2;
    item.reports[0].scope.expectedPlacements = 2;
    item.reports[0].scope.capturedPlacements = 2;
    item.reports[0].scope.uniqueEcsProducts = 2;
    item.reports[0].completeness.categoryAudit[0].count = 2;
    item.reports[0].completeness.categoryAudit[0].pageCounts = [2];
    item.reports[0].completeness.categoryAudit[0].observedCount = 2;
    return item;
  }

  for (const sections of [undefined, ['Unknown'], ['Braking', 'Braking'], ['Braking', 'Engine']]) {
    const item = quarantined(sections);
    assert.throws(
      () => finalizeBmwM3ReleaseAudit({
        importerAudit: item.audit,
        reconciliationReports: item.reports,
        aggregateProducts: item.products,
        aggregateQuarantinedEcsIdentities: item.quarantine,
        currentReviewedProducts: item.current,
      }),
      error => error instanceof FinalReleaseAuditError && error.code === 'invalid_quarantine_section',
    );
  }
});

test('rejects product and quarantine count or identity mismatches', () => {
  const mismatch = inputs();
  mismatch.audit.quarantinedIdentityCount = 1;
  assert.throws(
    () => finalize({ audit: mismatch.audit }),
    error => error instanceof FinalReleaseAuditError && error.code === 'product_quarantine_count_mismatch',
  );
  const different = inputs();
  different.audit.quarantine = [{ ecsPartNumber: 'ES#8888', recordIndexes: [0] }];
  different.audit.quarantinedIdentityCount = 1;
  different.audit.quarantinedRecordCount = 1;
  different.audit.uniqueValidatedEcsIdentityCount = 8;
  assert.throws(
    () => finalize({ audit: different.audit, quarantine: ['7777'] }),
    error => error instanceof FinalReleaseAuditError && error.code === 'quarantine_mismatch',
  );
});

test('requires digit-only aggregate quarantine identities that match runtime semantics', () => {
  for (const quarantine of [
    ['ES#4017812'],
    [{ ecsPartNumber: 'ES#4017812' }],
    ['4017812', '4017812'],
  ]) {
    const item = inputsWithQuarantine(['4017812']);
    assert.throws(
      () => finalizeBmwM3ReleaseAudit({
        importerAudit: item.audit,
        reconciliationReports: item.reports,
        aggregateProducts: item.products,
        aggregateQuarantinedEcsIdentities: quarantine,
        currentReviewedProducts: item.current,
      }),
      error => error instanceof FinalReleaseAuditError && error.code === 'quarantine_mismatch',
    );
  }
});

test('requires canonical unique aggregate public keys and slugs before finalization', () => {
  for (const mutate of [
    products => { products[0].publicKey = 'shared-handle'; },
    products => { products[0].slug = 'shared-handle'; },
    products => { products[1].publicKey = products[0].publicKey; },
    products => { products[1].slug = products[0].slug; },
  ]) {
    const products = structuredClone(inputs().products);
    mutate(products);
    assert.throws(
      () => finalize({ products }),
      error => error instanceof FinalReleaseAuditError
        && ['invalid_product_identity', 'invalid_product_handle', 'duplicate_product_handle'].includes(error.code),
    );
  }
});

test('verifies a deterministic input checksum then writes create-only in a designated work directory', async (context) => {
  const item = await fileFixture(context);
  const verified = await verifyBmwM3ReleaseAuditFiles({
    ...item,
    workDirectory: item.root,
  });
  assert.match(verified.inputSetSha256, /^[a-f0-9]{64}$/);
  assert.equal(verified.finalizedAudit.captureProgress.complete, true);
  const pinned = await verifyBmwM3ReleaseAuditFiles({
    ...item,
    workDirectory: item.root,
    expectedInputSetSha256: verified.inputSetSha256,
  });
  const outputPath = path.join(item.root, 'final-audit.json');
  const output = await writeFinalReleaseAuditCreateOnly(outputPath, pinned.finalizedAudit, pinned.roots);
  assert.equal(output.path, outputPath);
  const written = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.equal(written.finalReleaseAudit.inputSetSha256, verified.inputSetSha256);
  assert.equal(written.captureProgress.complete, true);
  await assert.rejects(
    () => writeFinalReleaseAuditCreateOnly(outputPath, pinned.finalizedAudit, pinned.roots),
    error => error instanceof FinalReleaseAuditError && error.code === 'output_exists',
  );
});

test('parses but never executes the exact generated aggregate module', async (context) => {
  const item = await fileFixture(context);
  const safeSource = await readFile(item.aggregateModulePath, 'utf8');
  delete globalThis.__PROJX_FINAL_AUDIT_EXECUTED;
  for (const addition of [
    "\nglobalThis.__PROJX_FINAL_AUDIT_EXECUTED = true; globalThis.fetch('https://example.invalid/');\n",
    "\nimport 'node:fs';\n",
    "\nimport('node:fs');\n",
  ]) {
    await writeFile(item.aggregateModulePath, `${safeSource}${addition}`);
    await assert.rejects(
      () => verifyBmwM3ReleaseAuditFiles({ ...item, workDirectory: item.root }),
      error => error instanceof FinalReleaseAuditError && error.code === 'invalid_aggregate_module_format',
    );
    assert.equal(globalThis.__PROJX_FINAL_AUDIT_EXECUTED, undefined);
  }
});

test('rejects an alternate current-reviewed module before it can execute', async (context) => {
  const item = await fileFixture(context);
  const alternate = path.join(item.root, 'alternate-current-reviewed.mjs');
  await writeFile(alternate, [
    'globalThis.__PROJX_ALTERNATE_CURRENT_EXECUTED = true;',
    'export const REVIEWED_ECS_PRODUCTS = [];',
    '',
  ].join('\n'));
  delete globalThis.__PROJX_ALTERNATE_CURRENT_EXECUTED;
  await assert.rejects(
    () => verifyBmwM3ReleaseAuditFiles({
      ...item,
      currentReviewedModulePath: alternate,
      workDirectory: item.root,
    }),
    error => error instanceof FinalReleaseAuditError
      && error.code === 'untrusted_current_reviewed_module',
  );
  assert.equal(globalThis.__PROJX_ALTERNATE_CURRENT_EXECUTED, undefined);
});

test('rejects dynamic, node builtin, and external current-module dependencies', () => {
  assert.throws(
    () => __test.moduleSpecifiers("const value = import('./dynamic.mjs');"),
    error => error instanceof FinalReleaseAuditError && error.code === 'unsupported_module_dependency',
  );
  for (const specifier of ['node:fs', 'external-package', 'https://example.invalid/module.mjs']) {
    assert.throws(
      () => __test.trustedModuleSpecifier(specifier),
      error => error instanceof FinalReleaseAuditError && error.code === 'unsupported_module_dependency',
    );
  }
  assert.equal(__test.trustedModuleSpecifier('./local-module.js'), './local-module.js');

  for (const source of [
    "import/*comment*/'node:fs';",
    "import/*comment*/{ readFile }from'node:fs';",
    "export/*comment*/{ readFile }from'node:fs';",
    "export { readFile }from/*comment*/'node:fs';",
    "const module = import/*comment*/('node:fs');",
  ]) {
    assert.throws(
      () => __test.moduleSpecifiers(source),
      error => error instanceof FinalReleaseAuditError && error.code === 'unsupported_module_dependency',
    );
  }
  assert.deepEqual(__test.moduleSpecifiers("const text = \"import/*comment*/'node:fs'\";"), []);
});

test('fails closed on checksum drift, output path escape, and report-count errors', async (context) => {
  const item = await fileFixture(context);
  const initial = await verifyBmwM3ReleaseAuditFiles({ ...item, workDirectory: item.root });
  const auditSource = await readFile(item.auditPath, 'utf8');
  await writeFile(item.auditPath, `${auditSource}\n`);
  await assert.rejects(
    () => verifyBmwM3ReleaseAuditFiles({
      ...item,
      workDirectory: item.root,
      expectedInputSetSha256: initial.inputSetSha256,
    }),
    error => error instanceof FinalReleaseAuditError && error.code === 'checksum_drift',
  );
  const verified = await verifyBmwM3ReleaseAuditFiles({ ...item, workDirectory: item.root });
  const escaped = path.join(path.dirname(item.root), `${path.basename(item.root)}-escaped.json`);
  await assert.rejects(
    () => writeFinalReleaseAuditCreateOnly(escaped, verified.finalizedAudit, verified.roots),
    error => error instanceof FinalReleaseAuditError && error.code === 'output_path_escape',
  );
  const foreign = await mkdtemp(path.join(os.tmpdir(), 'projx-final-audit-foreign-'));
  context.after(() => rm(foreign, { recursive: true, force: true }));
  const foreignAudit = path.join(foreign, 'audit.json');
  await writeFile(foreignAudit, auditSource);
  await assert.rejects(
    () => verifyBmwM3ReleaseAuditFiles({
      ...item,
      auditPath: foreignAudit,
      workDirectory: item.root,
    }),
    error => error instanceof FinalReleaseAuditError && error.code === 'input_path_escape',
  );
  assert.throws(
    () => finalizeBmwM3ReleaseAudit({
      importerAudit: inputs().audit,
      reconciliationReports: inputs().reports.slice(0, 6),
      aggregateProducts: inputs().products,
      aggregateQuarantinedEcsIdentities: [],
      currentReviewedProducts: inputs().current,
    }),
    error => error instanceof FinalReleaseAuditError && error.code === 'reconciliation_report_count',
  );
});
