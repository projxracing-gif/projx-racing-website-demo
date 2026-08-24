import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdir, mkdtemp, readFile, rm, symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  F8X_AGGREGATE_PROFILES,
  F8X_AGGREGATE_SECTIONS,
  prepareF8xAggregateBundles,
  renderF8xAggregateModule,
  resolveF8xOutputPlan,
  writeCreateOnly,
} from './prepare-f8x-aggregate.mjs';
import { F8X_CAPTURE_PROFILES } from './capture-f8x-section.mjs';

const generatedAt = '2026-08-20T12:00:00.000Z';
const captureStartedAt = '2026-08-20T11:30:00.000Z';
const nowMs = Date.parse('2026-08-20T12:01:00.000Z');
const profileKeys = Object.keys(F8X_AGGREGATE_PROFILES);
const sectionKeys = Object.keys(F8X_AGGREGATE_SECTIONS);
const requiredMissing = Object.freeze({
  availabilityText: 0,
  ecsPartNumber: 0,
  manufacturerPartNumber: 0,
  priceText: 0,
  productUrl: 0,
  sourceUrl: 0,
  title: 0,
});

function makeBundle(profileKey, sectionKey, recordOverrides = {}) {
  const profile = F8X_AGGREGATE_PROFILES[profileKey];
  const section = F8X_AGGREGATE_SECTIONS[sectionKey];
  const sectionUrl = `${profile.rootUrl}${section.path}/`;
  const categoryKey = `${sectionKey}-test-parts`;
  const categoryName = `${section.label} Test Parts`;
  const categoryUrl = `${sectionUrl}Test_Parts/`;
  const record = {
    availabilityText: 'In Stock',
    brand: 'Test Brand',
    category: categoryName,
    categoryKey,
    description: 'Public supplier description.',
    ecsPartNumber: 'ES#4700001',
    imageAlt: 'Test product',
    imageFallbackUrl: 'https://assets.ecstuning.com/product_library/4700001_x300.webp',
    imageUrl: 'https://assets.ecstuning.com/product_library/4700001_x300.webp',
    manufacturerPartNumber: 'F8X-TEST-1',
    observedAt: generatedAt,
    priceBlockText: '$499.99',
    priceText: '$499.99',
    productUrl: 'https://www.ecstuning.com/b-test-brand-parts/f8x-test-product/f8x-test-1/',
    relevancePosition: 1,
    section: section.label,
    shippingText: 'Free Shipping',
    sourceUrl: categoryUrl,
    title: 'F8X Test Product',
    vehicle: profile.vehicle,
    ...recordOverrides,
  };
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
    observedAt: generatedAt,
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
      captureStartedAt,
      generatedAt,
      vehicle: profile.vehicle,
      section: section.label,
      sectionUrl,
      categories: [category],
      terminalProofs: { [categoryKey]: terminalProof },
      records: [record],
    },
    manifest: {
      schemaVersion: 1,
      supplier: 'ECS Tuning',
      accessClass: 'public-retail',
      kind: `${profile.artifactPrefix}-${sectionKey}-capture-manifest`,
      captureStartedAt,
      generatedAt,
      rootUrl: profile.rootUrl,
      section: {
        section: section.label,
        key: sectionKey,
        href: sectionUrl,
      },
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
      captureStartedAt,
      generatedAt,
      source: { rootUrl: profile.rootUrl, sectionUrl },
      scope: totals,
      completeness: {
        complete: true,
        status: 'reconciled',
        exactCategories: 1,
        categoryAudit: [{ ...category, observedCount: 1, exact: true }],
        requiredMissing: { ...requiredMissing },
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

function completeSet(overrides = () => ({})) {
  return profileKeys.flatMap((profileKey) => sectionKeys.map((sectionKey) => (
    makeBundle(profileKey, sectionKey, overrides(profileKey, sectionKey))
  )));
}

function makeTwoPageTerminalSet(observedPaginationLinks = null) {
  const bundles = completeSet();
  const bundle = bundles[0];
  const category = bundle.capture.categories[0];
  const categoryKey = category.key;
  const terminalUrl = `${category.sourceUrl}2`;
  const records = Array.from({ length: 17 }, (_, index) => ({
    ...bundle.capture.records[0],
    ecsPartNumber: `ES#${4_700_001 + index}`,
    manufacturerPartNumber: `F8X-TEST-${index + 1}`,
    productUrl: `https://www.ecstuning.com/b-test-brand-parts/f8x-test-product-${index + 1}/f8x-test-${index + 1}/`,
    relevancePosition: index + 1,
    sourceUrl: index < 16 ? category.sourceUrl : terminalUrl,
  }));
  Object.assign(category, {
    count: 17,
    expectedPages: 2,
    pages: 2,
    pageCounts: [16, 1],
    pageUrls: [category.sourceUrl, terminalUrl],
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
  bundle.capture.records = records;
  bundle.capture.terminalProofs[categoryKey] = category.terminalProof;
  bundle.manifest.categories[categoryKey] = category;
  bundle.manifest.terminalProofs[categoryKey] = category.terminalProof;
  Object.assign(bundle.report.completeness.categoryAudit[0], category, {
    observedCount: 17,
    exact: true,
  });
  Object.assign(bundle.manifest.totals, {
    expectedPages: 2,
    capturedPages: 2,
    expectedPlacements: 17,
    capturedPlacements: 17,
    uniqueEcsProducts: 17,
  });
  return bundles;
}

test('requires the exact 3 × 7 F8X profile and section matrix', () => {
  const bundles = completeSet();
  assert.equal(bundles.length, 21);
  assert.throws(
    () => prepareF8xAggregateBundles(bundles.slice(0, -1), { nowMs }),
    /exactly 21 reconciled capture bundles/,
  );
  const duplicate = structuredClone(bundles);
  duplicate[20] = structuredClone(duplicate[0]);
  assert.throws(
    () => prepareF8xAggregateBundles(duplicate, { nowMs }),
    /repeats scope/,
  );
  const generic = structuredClone(bundles);
  generic[0].capture.kind = 'bmw-m3-braking-listing-capture';
  generic[0].capture.vehicle = 'BMW M3';
  assert.throws(
    () => prepareF8xAggregateBundles(generic, { nowMs }),
    /unexpected listing-capture kind/,
  );
});

test('pins the normalizer contract to the capture profiles without silently relabelling roots', () => {
  for (const profileKey of profileKeys) {
    const normalizer = F8X_AGGREGATE_PROFILES[profileKey];
    const capture = F8X_CAPTURE_PROFILES[profileKey];
    assert.deepEqual({
      artifactPrefix: normalizer.artifactPrefix,
      rootUrl: normalizer.rootUrl,
      vehicle: normalizer.vehicle,
      vehicleKey: normalizer.vehicleKey,
    }, {
      artifactPrefix: capture.artifactPrefix,
      rootUrl: capture.rootUrl,
      vehicle: capture.vehicle,
      vehicleKey: capture.vehicleKey,
    });
  }
});

test('rejects a wrong profile root or an incomplete reconciliation', () => {
  const wrongRoot = completeSet();
  wrongRoot[0].manifest.rootUrl = 'https://www.ecstuning.com/BMW-M3/';
  assert.throws(
    () => prepareF8xAggregateBundles(wrongRoot, { nowMs }),
    /manifest is incomplete or outside its exact profile/,
  );
  const incomplete = completeSet();
  incomplete[0].report.completeness.complete = false;
  incomplete[0].report.completeness.status = 'in_progress_or_blocked';
  assert.throws(
    () => prepareF8xAggregateBundles(incomplete, { nowMs }),
    /reconciliation report is incomplete/,
  );
});

test('rejects legacy complete reports that lack per-category terminal-pagination evidence', () => {
  const bundles = completeSet();
  const first = bundles[0];
  const categoryKey = first.capture.categories[0].key;
  delete first.capture.categories[0].terminalProof;
  delete first.capture.terminalProofs;
  delete first.manifest.categories[categoryKey].terminalProof;
  delete first.manifest.terminalProofs;
  delete first.report.completeness.categoryAudit[0].terminalProof;
  delete first.report.scope.terminalProofs;
  assert.throws(
    () => prepareF8xAggregateBundles(bundles, { nowMs }),
    /listing capture does not match|terminal-pagination evidence/,
  );
});

test('accepts exact numeric terminal URLs and capture-compatible bare self anchors', () => {
  const result = prepareF8xAggregateBundles(makeTwoPageTerminalSet(), { nowMs });
  assert.equal(result.audit.completeCaptureCount, 21);
  assert.equal(result.audit.rawObservationCount, 37);
});

test('terminal-pagination evidence rejects URL mutation, unsafe URL state, next links and higher pages', () => {
  const cases = [
    {
      name: 'numeric terminal trailing-slash mutation',
      mutate(bundles) {
        bundles[0].capture.categories[0].terminalProof.terminalUrl += '/';
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
      name: 'bare anchor on a different page',
      links: (categoryUrl) => [{ href: `${categoryUrl}#`, page: 1, rel: '' }],
    },
    {
      name: 'next relationship',
      links: (categoryUrl, terminalUrl) => [{ href: terminalUrl, page: 2, rel: 'next' }],
    },
    {
      name: 'higher page',
      links: (categoryUrl) => [{ href: `${categoryUrl}3`, page: 3, rel: '' }],
    },
  ];
  for (const scenario of cases) {
    const base = makeTwoPageTerminalSet();
    const category = base[0].capture.categories[0];
    const terminalUrl = category.pageUrls.at(-1);
    const bundles = scenario.links
      ? makeTwoPageTerminalSet(scenario.links(category.sourceUrl, terminalUrl)) : base;
    scenario.mutate?.(bundles);
    assert.throws(
      () => prepareF8xAggregateBundles(bundles, { nowMs }),
      /terminal-pagination evidence/,
      scenario.name,
    );
  }
});

test('deduplicates by ES identity while retaining all vehicle, section and category observations', () => {
  const bundles = completeSet();
  const result = prepareF8xAggregateBundles(bundles, { nowMs });
  assert.equal(result.products.length, 1);
  assert.equal(result.audit.inputCaptureCount, 21);
  assert.equal(result.audit.completeCaptureCount, 21);
  assert.equal(result.audit.rawObservationCount, 21);
  assert.equal(result.audit.duplicateObservationCount, 20);
  assert.equal(result.audit.exactFitmentProductCount, 0);
  const product = result.products[0];
  assert.equal(product.ecsPartNumber, 'ES#4700001');
  assert.equal(product.priceAmount, 499.99);
  assert.equal(product.purchaseMode, 'fitment-confirmation-required');
  assert.equal(product.selectionSources.length, 21);
  assert.equal(product.sourceObservations.length, 21);
  assert.ok(product.selectionSources.every((source) => (
    source.vehicleKey && source.vehicle && source.section && source.category && source.categoryKey
  )));
  assert.deepEqual(product.fitments.map((fitment) => ({
    model: fitment.model,
    generation: fitment.generation,
    chassis: fitment.chassis,
    engines: fitment.engines,
    years: [fitment.yearFrom, fitment.yearTo],
    drivetrains: fitment.drivetrains,
    confidence: fitment.confidence,
  })), [
    { model: 'M3', generation: 'F80', chassis: ['F80'], engines: ['S55'], years: [null, null], drivetrains: [], confidence: 'possible' },
    { model: 'M4', generation: 'F82', chassis: ['F82'], engines: ['S55'], years: [null, null], drivetrains: [], confidence: 'possible' },
    { model: 'M4', generation: 'F83', chassis: ['F83'], engines: ['S55'], years: [null, null], drivetrains: [], confidence: 'possible' },
  ]);
  assert.deepEqual(product.filters.chassis, ['F80', 'F82', 'F83']);
  assert.deepEqual(product.filters.years, []);
  assert.deepEqual(product.filters.drivetrains, []);
});

test('emits canonical BMW F8X parent, section and deep category slugs', () => {
  const product = prepareF8xAggregateBundles(completeSet(), { nowMs }).products[0];
  assert.equal(product.sectionSlug, 'bmw-f8x-braking');
  assert.equal(product.categorySlug, 'bmw-f8x-braking');
  assert.equal(product.subcategorySlug, 'bmw-f8x-braking-braking-test-parts');
  assert.deepEqual(product.filters.categories, [
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
  assert.deepEqual(product.filters.subcategories, [
    'bmw-f8x-braking-braking-test-parts',
    'bmw-f8x-engine-engine-test-parts',
    'bmw-f8x-exterior-exterior-test-parts',
    'bmw-f8x-interior-interior-test-parts',
    'bmw-f8x-suspension-suspension-test-parts',
    'bmw-f8x-steering-steering-test-parts',
    'bmw-f8x-performance-performance-test-parts',
  ]);
  assert.ok(product.categoryMemberships.every((membership) => (
    membership.sectionSlug === `bmw-f8x-${membership.categoryKey.replace(/-test-parts$/, '')}`
      && membership.categorySlug.startsWith(`${membership.sectionSlug}-`)
  )));
  assert.doesNotMatch(JSON.stringify({
    sectionSlug: product.sectionSlug,
    categorySlug: product.categorySlug,
    subcategorySlug: product.subcategorySlug,
    categories: product.filters.categories,
    subcategories: product.filters.subcategories,
    memberships: product.categoryMemberships,
  }), /(?:^|["])f8x-/);
});

test('keeps supplier availability as an observation while making possible fitment and manual confirmation explicit', () => {
  const product = prepareF8xAggregateBundles(completeSet(), { nowMs }).products[0];
  assert.equal(product.observedAvailability, 'In Stock');
  assert.equal(product.status, 'Supplier status — confirmation required');
  assert.equal(product.stockPolicy, 'manual-confirm');
  assert.equal(product.availabilityCode, 'check_availability');
  assert.deepEqual(product.filters.availability, ['confirmation-required']);
  assert.equal(product.fitmentConfidence, 'possible');
  assert.deepEqual(product.filters.fitment, ['possible']);
  assert.ok(product.fitments.every((fitment) => fitment.confidence === 'possible'));
  assert.equal(product.purchaseMode, 'fitment-confirmation-required');
});

test('rendering and audit output are deterministic regardless of input ordering', () => {
  const forward = prepareF8xAggregateBundles(completeSet(), { nowMs });
  const reverse = prepareF8xAggregateBundles(completeSet().reverse(), { nowMs });
  assert.equal(renderF8xAggregateModule(forward), renderF8xAggregateModule(reverse));
  assert.equal(JSON.stringify(forward.audit), JSON.stringify(reverse.audit));
  assert.doesNotMatch(renderF8xAggregateModule(forward), /BMW-M3\//);
});

test('starting-at and zero-price values cannot become fixed sellable prices', () => {
  const starting = prepareF8xAggregateBundles(completeSet(() => ({
    priceText: 'Starting at $299.00',
    priceBlockText: 'Starting at $299.00',
  })), { nowMs });
  assert.equal(starting.products[0].priceAmount, 299);
  assert.equal(starting.products[0].priceStartingAt, true);
  assert.equal(starting.products[0].quoteOnly, true);
  assert.equal(starting.products[0].purchaseMode, 'variant-confirmation-required');

  for (const priceText of ['Starting at $0.00', '$0.00']) {
    const zero = prepareF8xAggregateBundles(completeSet(() => ({
      priceText,
      priceBlockText: priceText,
    })), { nowMs });
    assert.equal(zero.products[0].priceAmount, null);
    assert.equal(zero.products[0].quoteOnly, true);
    assert.equal(zero.products[0].purchaseMode, 'request-price');
    assert.equal(zero.audit.zeroPriceRequestProductCount, 1);
  }
});

test('accepts one explicit public USD amount in the supplier formats used by capture artifacts', () => {
  for (const priceText of ['$499.99', 'USD 499.99', '$499.99 USD']) {
    const result = prepareF8xAggregateBundles(completeSet(() => ({
      priceText,
      priceBlockText: priceText,
    })), { nowMs });
    assert.equal(result.products[0].priceAmount, 499.99, priceText);
    assert.equal(result.products[0].priceCurrency, 'USD', priceText);
    assert.equal(result.products[0].quoteOnly, false, priceText);
  }
});

test('non-USD and ambiguous price presentations cannot become USD selling prices', () => {
  for (const priceText of [
    'EUR 499.99',
    '£499.99',
    '499.99',
    '$499.99 or $599.99',
    'USD 499.99 / 599.99',
  ]) {
    const result = prepareF8xAggregateBundles(completeSet(() => ({
      priceText,
      priceBlockText: priceText,
    })), { nowMs });
    const [product] = result.products;
    assert.equal(product.priceAmount, null, priceText);
    assert.equal(product.quoteOnly, true, priceText);
    assert.equal(product.purchaseMode, 'request-price', priceText);
    assert.equal(result.audit.publicUsdPriceProductCount, 0, priceText);
    assert.equal(result.audit.requestPriceProductCount, 1, priceText);
  }
});

test('quarantines cross-scope MPN, canonical URL and same-day price conflicts', () => {
  const bundles = completeSet((profileKey, sectionKey) => {
    if (profileKey !== 'f83-m4' || sectionKey !== 'performance') return {};
    return {
      manufacturerPartNumber: 'CONFLICTING-MPN',
      productUrl: 'https://www.ecstuning.com/b-test-brand-parts/conflicting-product/conflict-1/',
      priceText: '$599.99',
      priceBlockText: '$599.99',
    };
  });
  const result = prepareF8xAggregateBundles(bundles, { nowMs });
  assert.equal(result.products.length, 0);
  assert.deepEqual(result.quarantinedEcsIdentities, ['4700001']);
  assert.deepEqual(result.audit.quarantine[0].reasons, [
    'conflicting-canonical-product-url',
    'conflicting-manufacturer-part-number',
    'conflicting-same-day-public-price',
  ]);
  assert.equal(result.audit.quarantine[0].observations.length, 21);
});

test('quarantines aliases where an MPN and canonical URL are shared by multiple ES identities', () => {
  const bundles = completeSet((profileKey, sectionKey) => (
    profileKey === 'f83-m4' && sectionKey === 'performance'
      ? { ecsPartNumber: 'ES#4700002' } : {}
  ));
  const result = prepareF8xAggregateBundles(bundles, { nowMs });
  assert.equal(result.products.length, 0);
  assert.deepEqual(result.quarantinedEcsIdentities, ['4700001', '4700002']);
  for (const item of result.audit.quarantine) {
    assert.deepEqual(item.reasons, [
      'canonical-product-url-shared-by-multiple-ecs-identities',
      'manufacturer-part-number-shared-by-multiple-ecs-identities',
    ]);
  }
});

test('output is limited to private-imports or a safe external directory and is create-only', async (t) => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'projx-f8x-normalizer-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const repository = path.join(sandbox, 'repo');
  const privateWork = path.join(repository, 'private-imports', 'f8x-run');
  const trackedWork = path.join(repository, 'docs');
  const externalWork = path.join(sandbox, 'external');
  await Promise.all([
    mkdir(privateWork, { recursive: true }),
    mkdir(trackedWork, { recursive: true }),
    mkdir(externalWork, { recursive: true }),
  ]);
  const privatePlan = await resolveF8xOutputPlan({
    repositoryRoot: repository,
    workDir: path.join('private-imports', 'f8x-run'),
  });
  assert.equal(privatePlan.workDir, privateWork);
  const externalPlan = await resolveF8xOutputPlan({ repositoryRoot: repository, workDir: externalWork });
  assert.equal(externalPlan.workDir, externalWork);
  await assert.rejects(
    resolveF8xOutputPlan({ repositoryRoot: repository, workDir: trackedWork }),
    /must resolve within canonical private-imports/,
  );
  await assert.rejects(
    resolveF8xOutputPlan({
      repositoryRoot: repository,
      workDir: path.relative(repository, externalWork),
    }),
    /must be explicit absolute existing paths/,
  );
  await writeCreateOnly(privatePlan.output, 'first\n');
  await assert.rejects(writeCreateOnly(privatePlan.output, 'second\n'), /Refusing to overwrite/);
  assert.equal(await readFile(privatePlan.output, 'utf8'), 'first\n');

  const redirectedRoot = path.join(sandbox, 'redirected-private-root');
  const redirectedRootRun = path.join(redirectedRoot, 'run');
  const junctionRepository = path.join(sandbox, 'junction-repo');
  const redirectedChild = path.join(sandbox, 'redirected-private-child');
  await Promise.all([
    mkdir(redirectedRootRun, { recursive: true }),
    mkdir(junctionRepository, { recursive: true }),
    mkdir(redirectedChild, { recursive: true }),
  ]);
  try {
    await symlink(redirectedRoot, path.join(junctionRepository, 'private-imports'), 'junction');
    await assert.rejects(
      resolveF8xOutputPlan({
        repositoryRoot: junctionRepository,
        workDir: path.join('private-imports', 'run'),
      }),
      /must resolve within canonical private-imports/,
    );

    const childJunction = path.join(repository, 'private-imports', 'redirected-child');
    await symlink(redirectedChild, childJunction, 'junction');
    await assert.rejects(
      resolveF8xOutputPlan({
        repositoryRoot: repository,
        workDir: path.join('private-imports', 'redirected-child'),
      }),
      /must resolve within canonical private-imports/,
    );

    const externalAliasToPrivate = path.join(sandbox, 'external-alias-to-private');
    await symlink(privateWork, externalAliasToPrivate, 'junction');
    await assert.rejects(
      resolveF8xOutputPlan({
        repositoryRoot: repository,
        workDir: externalAliasToPrivate,
      }),
      /must resolve within canonical private-imports/,
    );
  } catch (error) {
    if (!['EACCES', 'EPERM', 'ENOSYS'].includes(error?.code)) throw error;
    t.diagnostic(`Junction assertions skipped because this host denied junction creation (${error.code}).`);
  }
});
