import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGSeriesBrakingScope,
  createGSeriesDrivetrainScope,
  createGSeriesEngineScope,
  prepareGSeriesBraking as prepareGSeriesBrakingSource,
  prepareGSeriesDrivetrain as prepareGSeriesDrivetrainSource,
  prepareGSeriesEngine as prepareGSeriesEngineSource,
  prepareGSeriesExterior as prepareGSeriesExteriorSource,
  prepareGSeriesInterior as prepareGSeriesInteriorSource,
  prepareGSeriesPerformance as prepareGSeriesPerformanceSource
} from './prepare-g-series-performance.mjs';

function prepareGSeriesPerformance(source, media, options = {}) {
  return prepareGSeriesPerformanceSource(source, media, { ...options, requireCompleteScope: false });
}

const observedAt = new Date(Date.now() - 60_000).toISOString();
const source = {
  supplier: 'ECS Tuning',
  records: [
    {
      title: 'S58 Test Intake', description: 'Supplier listing description.', brand: 'Test Brand',
      ecsPartNumber: '4699999', manufacturerPartNumber: 'S58-TEST', priceText: '$499.99 USD',
      availabilityText: 'In Stock at Vendor', shippingText: 'Free Shipping',
      productUrl: 'https://www.ecstuning.com/b-test-brand-parts/s58-test-intake/s58-test/',
      imageUrl: 'https://assets.ecstuning.com/product_library/1_x300.webp',
      imageFallbackUrl: 'https://assets.ecstuning.com/product_library/1_x300.jpg',
      imageAlt: 'S58 test intake', category: 'Performance Engine & Drivetrain Parts',
      vehicle: 'BMW G80 M3 Competition S58 3.0L',
      sourceUrl: 'https://www.ecstuning.com/BMW-G80-M3_Competition-S58_3.0L/Performance/Engine_-or-_Drivetrain/',
      relevancePosition: 1, observedAt
    },
    {
      title: 'S58 Test Intake', description: 'Supplier listing description.', brand: 'Test Brand',
      ecsPartNumber: '4699999', manufacturerPartNumber: 'S58-TEST', priceText: '$499.99 USD',
      availabilityText: 'In Stock at Vendor', shippingText: 'Free Shipping',
      productUrl: 'https://www.ecstuning.com/b-test-brand-parts/s58-test-intake/s58-test/',
      imageUrl: 'https://assets.ecstuning.com/product_library/1_x300.webp',
      imageFallbackUrl: 'https://assets.ecstuning.com/product_library/1_x300.jpg',
      imageAlt: 'S58 test intake', category: 'Performance Engine & Drivetrain Parts',
      vehicle: 'BMW G82 M4 Competition S58 3.0L',
      sourceUrl: 'https://www.ecstuning.com/BMW-G82-M4_Competition-S58_3.0L/Performance/Engine_-or-_Drivetrain/',
      relevancePosition: 2, observedAt
    }
  ]
};
const media = {
  schemaVersion: 1,
  supplier: 'ECS Tuning',
  images: [
    {
      sourceUrl: 'https://assets.ecstuning.com/product_library/1_x300.webp',
      localPath: 'assets/products/ecs/g-series-performance/es4699999.webp',
      width: 300, height: 225, contentType: 'image/webp', sha256: '0'.repeat(64)
    },
    {
      sourceUrl: 'https://assets.ecstuning.com/static/img/category/ecs_box_no_image.jpg',
      localPath: 'assets/products/ecs/g-series-performance/ecs-box-no-image.jpg',
      width: 300, height: 225, contentType: 'image/jpeg', sha256: '1'.repeat(64)
    }
  ]
};

const drivetrainScopeManifest = {
  schemaVersion: 1,
  supplier: 'ECS Tuning',
  kind: 'g-series-drivetrain-scope-manifest',
  categories: {
    'fixture-components': {
      name: 'Fixture Drivetrain Components',
      nameAr: '\u0645\u0643\u0648\u0646\u0627\u062a \u0627\u062e\u062a\u0628\u0627\u0631 \u0646\u0638\u0627\u0645 \u0627\u0644\u062f\u0641\u0639',
      sourcePath: 'Drivetrain/Fixture_Components/',
      slug: 'drivetrain-fixture-components'
    },
    'fixture-tools': {
      name: 'Fixture Drivetrain Tools',
      nameAr: '\u0623\u062f\u0648\u0627\u062a \u0627\u062e\u062a\u0628\u0627\u0631 \u0646\u0638\u0627\u0645 \u0627\u0644\u062f\u0641\u0639',
      sourcePath: 'Drivetrain/Tools/',
      slug: 'drivetrain-fixture-tools'
    }
  },
  counts: {
    'BMW G87 M2 S58 3.0L': { 'fixture-components': 0, 'fixture-tools': 1 },
    'BMW G80 M3 Competition S58 3.0L': { 'fixture-components': 1, 'fixture-tools': 0 },
    'BMW G82 M4 Competition S58 3.0L': { 'fixture-components': 0, 'fixture-tools': 1 }
  }
};

const quarantinedDrivetrainScopeManifest = structuredClone(drivetrainScopeManifest);
quarantinedDrivetrainScopeManifest.categories['fixture-pdk'] = {
  name: 'Fixture PDK Transmission Parts',
  nameAr: 'أجزاء ناقل الحركة PDK للاختبار',
  sourcePath: 'Drivetrain/PDK_Transmission/',
  slug: 'drivetrain-pdk-transmission',
  catalogueDisposition: 'quarantined',
  excludeFromCustomerFacing: true,
  quarantineReason: 'Supplier taxonomy anomaly under test.'
};
for (const [vehicle, counts] of Object.entries(quarantinedDrivetrainScopeManifest.counts)) {
  counts['fixture-pdk'] = vehicle === 'BMW G82 M4 Competition S58 3.0L' ? 1 : 0;
}

const brakingScopeManifest = {
  schemaVersion: 1,
  supplier: 'ECS Tuning',
  kind: 'g-series-braking-scope-manifest',
  categories: {
    'fixture-pads': {
      name: 'Fixture Brake Pads',
      nameAr: '\u0641\u062d\u0645\u0627\u062a \u0641\u0631\u0627\u0645\u0644 \u0644\u0644\u0627\u062e\u062a\u0628\u0627\u0631',
      sourcePath: 'Braking/Pads/',
      slug: 'braking-fixture-pads'
    },
    'fixture-tools': {
      name: 'Fixture Brake Tools',
      nameAr: '\u0623\u062f\u0648\u0627\u062a \u0641\u0631\u0627\u0645\u0644 \u0644\u0644\u0627\u062e\u062a\u0628\u0627\u0631',
      sourcePath: 'Braking/Tools/',
      slug: 'braking-fixture-tools'
    }
  },
  counts: {
    'BMW G87 M2 S58 3.0L': { 'fixture-pads': 0, 'fixture-tools': 1 },
    'BMW G80 M3 Competition S58 3.0L': { 'fixture-pads': 1, 'fixture-tools': 0 },
    'BMW G82 M4 Competition S58 3.0L': { 'fixture-pads': 0, 'fixture-tools': 1 }
  }
};

const engineScopeManifest = {
  schemaVersion: 1,
  supplier: 'ECS Tuning',
  kind: 'g-series-engine-scope-manifest',
  categories: {
    'fixture-performance': {
      name: 'Fixture Performance Engine Parts',
      nameAr: '\u0642\u0637\u0639 \u0623\u062f\u0627\u0621 \u0627\u0644\u0645\u062d\u0631\u0643 \u0644\u0644\u0627\u062e\u062a\u0628\u0627\u0631',
      sourcePath: 'Engine/Performance/',
      slug: 'engine-fixture-performance'
    },
    'fixture-tools': {
      name: 'Fixture Engine Tools',
      nameAr: '\u0623\u062f\u0648\u0627\u062a \u0627\u0644\u0645\u062d\u0631\u0643 \u0644\u0644\u0627\u062e\u062a\u0628\u0627\u0631',
      sourcePath: 'Engine/Tools/',
      slug: 'engine-fixture-tools'
    }
  },
  counts: {
    'BMW G87 M2 S58 3.0L': { 'fixture-performance': 0, 'fixture-tools': 1 },
    'BMW G80 M3 Competition S58 3.0L': { 'fixture-performance': 1, 'fixture-tools': 0 },
    'BMW G82 M4 Competition S58 3.0L': { 'fixture-performance': 0, 'fixture-tools': 1 }
  }
};

test('deduplicates ECS products and retains vehicle evidence', () => {
  const products = prepareGSeriesPerformance(source, media, { minimumProducts: 1 });
  assert.equal(products.length, 1);
  assert.equal(products[0].ecsPartNumber, 'ES#4699999');
  assert.equal(products[0].priceAmount, 499.99);
  assert.deepEqual(products[0].fitments.map(item => item.generation).sort(), ['G80', 'G82']);
  assert.equal(products[0].selectionSources.length, 2);
  assert.equal(products[0].images[0].src, 'assets/products/ecs/g-series-performance/es4699999.webp');
  assert.equal(products[0].publicKey, 'ecs-es-4699999');
  assert.match(products[0].fitments[0].noteAr, /فئة الأداء/);
  assert.match(products[0].selectionNoteAr, /فئات أداء السيارة/);
});

test('prepares the separate Exterior scope without mislabelling it as Performance', () => {
  const exterior = structuredClone(source);
  exterior.records = [exterior.records[0]];
  exterior.records[0].category = 'Exterior Body Parts';
  exterior.records[0].sourceUrl = 'https://www.ecstuning.com/BMW-G80-M3_Competition-S58_3.0L/Exterior/Body/';
  const exteriorMedia = structuredClone(media);
  exteriorMedia.images[0].localPath = 'assets/products/ecs/g-series-exterior/es4699999.webp';
  exteriorMedia.images[1].localPath = 'assets/products/ecs/g-series-exterior/ecs-box-no-image.jpg';
  const [product] = prepareGSeriesExteriorSource(exterior, exteriorMedia, {
    minimumProducts: 1, requireCompleteScope: false
  });
  assert.equal(product.category, 'Exterior Body Parts');
  assert.equal(product.categoryAr, 'أجزاء الهيكل الخارجي');
  assert.equal(product.fitments[0].evidence, 'ecs-vehicle-exterior-category');
  assert.match(product.selectionNote, /vehicle Exterior categories/);
  assert.deepEqual(product.filters.categories, ['exterior', 'exterior-body-parts']);
  assert.equal(product.images[0].src, 'assets/products/ecs/g-series-exterior/es4699999.webp');
});

test('prepares the exact Interior scope with parent and child filters', () => {
  const interior = structuredClone(source);
  interior.records = [interior.records[0]];
  interior.records[0].category = 'Interior Seat Parts';
  interior.records[0].sourceUrl = 'https://www.ecstuning.com/BMW-G80-M3_Competition-S58_3.0L/Interior/Seats/';
  const interiorMedia = structuredClone(media);
  interiorMedia.images[0].localPath = 'assets/products/ecs/g-series-interior/es4699999.webp';
  interiorMedia.images[1].localPath = 'assets/products/ecs/g-series-interior/ecs-box-no-image.jpg';
  const [product] = prepareGSeriesInteriorSource(interior, interiorMedia, {
    minimumProducts: 1, requireCompleteScope: false
  });
  assert.equal(product.category, 'Interior Seat Parts');
  assert.equal(product.categoryAr, 'أجزاء المقاعد الداخلية');
  assert.equal(product.categorySlug, 'seats');
  assert.equal(product.fitments[0].evidence, 'ecs-vehicle-interior-category');
  assert.match(product.selectionNote, /vehicle Interior categories/);
  assert.deepEqual(product.filters.categories, ['interior', 'seats']);
  assert.equal(product.images[0].src, 'assets/products/ecs/g-series-interior/es4699999.webp');
});

test('prepares manifest-backed Drivetrain paths with collision-safe parent and child filters', () => {
  const drivetrain = structuredClone(source);
  drivetrain.records = [structuredClone(source.records[0]), structuredClone(source.records[1])];
  drivetrain.records[0].category = 'Fixture Drivetrain Components';
  drivetrain.records[0].sourceUrl = 'https://www.ecstuning.com/BMW-G80-M3_Competition-S58_3.0L/Drivetrain/Fixture_Components/';
  drivetrain.records[1].category = 'Fixture Drivetrain Tools';
  drivetrain.records[1].sourceUrl = 'https://www.ecstuning.com/BMW-G82-M4_Competition-S58_3.0L/Drivetrain/Tools/';
  const drivetrainMedia = structuredClone(media);
  drivetrainMedia.images[0].localPath = 'assets/products/ecs/g-series-drivetrain/es4699999.webp';
  drivetrainMedia.images[1].localPath = 'assets/products/ecs/g-series-drivetrain/ecs-box-no-image.jpg';
  const [product] = prepareGSeriesDrivetrainSource(drivetrain, drivetrainMedia, {
    minimumProducts: 1,
    requireCompleteScope: false,
    scopeManifest: drivetrainScopeManifest
  });
  assert.equal(product.category, 'Fixture Drivetrain Components');
  assert.equal(product.categoryAr, drivetrainScopeManifest.categories['fixture-components'].nameAr);
  assert.equal(product.categorySlug, 'drivetrain-fixture-components');
  assert.equal(product.fitments[0].evidence, 'ecs-vehicle-drivetrain-category');
  assert.ok(product.fitments.every(fitment => fitment.confidence === 'possible'));
  assert.ok(product.fitments.every(fitment => fitment.drivetrains.length === 0));
  assert.deepEqual(product.filters.drivetrains, []);
  assert.deepEqual(product.filters.categories, [
    'g-series-drivetrain',
    'drivetrain-fixture-components',
    'drivetrain-fixture-tools'
  ]);
  assert.match(product.selectionNote, /vehicle Drivetrain categories/);
  assert.deepEqual(product.selectionSources.map(item => item.sourceUrl), [
    drivetrain.records[0].sourceUrl,
    drivetrain.records[1].sourceUrl
  ]);
  assert.equal(product.images[0].src, 'assets/products/ecs/g-series-drivetrain/es4699999.webp');
});

test('prepares manifest-backed Braking paths with collision-safe parent and child filters', () => {
  const braking = structuredClone(source);
  braking.records = [structuredClone(source.records[0]), structuredClone(source.records[1])];
  braking.records[0].category = 'Fixture Brake Pads';
  braking.records[0].sourceUrl = 'https://www.ecstuning.com/BMW-G80-M3_Competition-S58_3.0L/Braking/Pads/';
  braking.records[1].category = 'Fixture Brake Tools';
  braking.records[1].sourceUrl = 'https://www.ecstuning.com/BMW-G82-M4_Competition-S58_3.0L/Braking/Tools/';
  const brakingMedia = structuredClone(media);
  brakingMedia.images[0].localPath = 'assets/products/ecs/g-series-braking/es4699999.webp';
  brakingMedia.images[1].localPath = 'assets/products/ecs/g-series-braking/ecs-box-no-image.jpg';
  const [product] = prepareGSeriesBrakingSource(braking, brakingMedia, {
    minimumProducts: 1,
    requireCompleteScope: false,
    scopeManifest: brakingScopeManifest
  });
  assert.equal(product.category, 'Fixture Brake Pads');
  assert.equal(product.categoryAr, brakingScopeManifest.categories['fixture-pads'].nameAr);
  assert.equal(product.categorySlug, 'braking-fixture-pads');
  assert.equal(product.fitments[0].evidence, 'ecs-vehicle-braking-category');
  assert.ok(product.fitments.every(fitment => fitment.confidence === 'possible'));
  assert.deepEqual(product.filters.categories, [
    'g-series-braking',
    'braking-fixture-pads',
    'braking-fixture-tools'
  ]);
  assert.deepEqual(product.selectionSources.map(item => item.sourceUrl), [
    braking.records[0].sourceUrl,
    braking.records[1].sourceUrl
  ]);
  assert.equal(product.images[0].src, 'assets/products/ecs/g-series-braking/es4699999.webp');

  const scope = createGSeriesBrakingScope(brakingScopeManifest);
  assert.equal(scope.parentCategorySlug, 'g-series-braking');
  assert.equal(scope.expectedCategoryCounts['BMW G80 M3 Competition S58 3.0L']['Fixture Brake Pads'], 1);
  assert.throws(() => prepareGSeriesBrakingSource(braking, brakingMedia, {
    requireCompleteScope: false
  }), /Braking scope manifest is required/);

  const unsafePath = structuredClone(brakingScopeManifest);
  unsafePath.categories['fixture-tools'].sourcePath = 'Drivetrain/Tools/';
  assert.throws(() => createGSeriesBrakingScope(unsafePath), /Braking category manifest is invalid/);
  const unsafeSlug = structuredClone(brakingScopeManifest);
  unsafeSlug.categories['fixture-tools'].slug = 'drivetrain-fixture-tools';
  assert.throws(() => createGSeriesBrakingScope(unsafeSlug), /Braking category manifest is invalid/);
});

test('prepares manifest-backed Engine paths with collision-safe parent and child filters', () => {
  const engine = structuredClone(source);
  engine.records = [structuredClone(source.records[0]), structuredClone(source.records[1])];
  engine.records[0].category = 'Fixture Performance Engine Parts';
  engine.records[0].sourceUrl = 'https://www.ecstuning.com/BMW-G80-M3_Competition-S58_3.0L/Engine/Performance/';
  engine.records[1].category = 'Fixture Engine Tools';
  engine.records[1].sourceUrl = 'https://www.ecstuning.com/BMW-G82-M4_Competition-S58_3.0L/Engine/Tools/';
  const engineMedia = structuredClone(media);
  engineMedia.images[0].localPath = 'assets/products/ecs/g-series-engine/es4699999.webp';
  engineMedia.images[1].localPath = 'assets/products/ecs/g-series-engine/ecs-box-no-image.jpg';
  const [product] = prepareGSeriesEngineSource(engine, engineMedia, {
    minimumProducts: 1,
    requireCompleteScope: false,
    scopeManifest: engineScopeManifest
  });
  assert.equal(product.category, 'Fixture Performance Engine Parts');
  assert.equal(product.categoryAr, engineScopeManifest.categories['fixture-performance'].nameAr);
  assert.equal(product.categorySlug, 'engine-fixture-performance');
  assert.equal(product.fitments[0].evidence, 'ecs-vehicle-engine-category');
  assert.ok(product.fitments.every(fitment => fitment.confidence === 'possible'));
  assert.deepEqual(product.filters.categories, [
    'g-series-engine',
    'engine-fixture-performance',
    'engine-fixture-tools'
  ]);
  assert.deepEqual(product.selectionSources.map(item => item.sourceUrl), [
    engine.records[0].sourceUrl,
    engine.records[1].sourceUrl
  ]);
  assert.equal(product.images[0].src, 'assets/products/ecs/g-series-engine/es4699999.webp');

  const scope = createGSeriesEngineScope(engineScopeManifest);
  assert.equal(scope.parentCategorySlug, 'g-series-engine');
  assert.equal(scope.expectedCategoryCounts['BMW G80 M3 Competition S58 3.0L']['Fixture Performance Engine Parts'], 1);
  assert.throws(() => prepareGSeriesEngineSource(engine, engineMedia, {
    requireCompleteScope: false
  }), /Engine scope manifest is required/);

  const unsafePath = structuredClone(engineScopeManifest);
  unsafePath.categories['fixture-tools'].sourcePath = 'Drivetrain/Tools/';
  assert.throws(() => createGSeriesEngineScope(unsafePath), /Engine category manifest is invalid/);
  const unsafeSlug = structuredClone(engineScopeManifest);
  unsafeSlug.categories['fixture-tools'].slug = 'drivetrain-fixture-tools';
  assert.throws(() => createGSeriesEngineScope(unsafeSlug), /Engine category manifest is invalid/);
});

test('keeps legitimate supplier assembly copy clear of the removed interactive builder wording', () => {
  const supplierBuilderCopy = ['Build', 'your', 'engine'].join(' ');
  const removedBuilderPattern = new RegExp(['build', 'your', 'engine'].join(' '), 'i');
  const engine = structuredClone(source);
  engine.records = [structuredClone(source.records[0])];
  engine.records[0].category = 'Fixture Performance Engine Parts';
  engine.records[0].sourceUrl = 'https://www.ecstuning.com/BMW-G80-M3_Competition-S58_3.0L/Engine/Performance/';
  engine.records[0].description = `${supplierBuilderCopy} the right way!`;
  engine.records[0].imageAlt = `Assembly Lube - ${supplierBuilderCopy} the right way!`;
  const engineMedia = structuredClone(media);
  engineMedia.images[0].localPath = 'assets/products/ecs/g-series-engine/es4699999.webp';
  const [product] = prepareGSeriesEngineSource(engine, engineMedia, {
    minimumProducts: 1,
    requireCompleteScope: false,
    scopeManifest: engineScopeManifest
  });
  assert.equal(product.description, 'Assemble your engine the right way!');
  assert.match(product.images[0].alt, /Assemble your engine the right way!/);
  assert.doesNotMatch(JSON.stringify(product), removedBuilderPattern);
});

test('keeps quarantined Drivetrain evidence in the manifest while excluding its complete ECS identity', () => {
  const drivetrain = structuredClone(source);
  const validShared = structuredClone(source.records[0]);
  validShared.category = 'Fixture Drivetrain Components';
  validShared.sourceUrl = 'https://www.ecstuning.com/BMW-G80-M3_Competition-S58_3.0L/Drivetrain/Fixture_Components/';
  const quarantinedShared = structuredClone(source.records[1]);
  quarantinedShared.category = 'Fixture PDK Transmission Parts';
  quarantinedShared.sourceUrl = 'https://www.ecstuning.com/BMW-G82-M4_Competition-S58_3.0L/Drivetrain/PDK_Transmission/';
  quarantinedShared.catalogueDisposition = 'quarantined';
  quarantinedShared.excludeFromCustomerFacing = true;
  quarantinedShared.quarantineReason = 'Supplier taxonomy anomaly under test.';
  const publishable = structuredClone(validShared);
  publishable.ecsPartNumber = '602';
  publishable.manufacturerPartNumber = 'SHORT-ES-602';
  publishable.productUrl = 'https://www.ecstuning.com/b-test-brand-parts/short-ecs-identity/short-es-602/';
  publishable.relevancePosition = 2;
  drivetrain.records = [validShared, quarantinedShared, publishable];
  const drivetrainMedia = structuredClone(media);
  drivetrainMedia.images[0].localPath = 'assets/products/ecs/g-series-drivetrain/es4699999.webp';
  drivetrainMedia.images[1].localPath = 'assets/products/ecs/g-series-drivetrain/ecs-box-no-image.jpg';

  const scope = createGSeriesDrivetrainScope(quarantinedDrivetrainScopeManifest);
  assert.equal(scope.scopeManifest.categories['fixture-pdk'].excludeFromCustomerFacing, true);
  assert.equal(scope.quarantinedCategories.length, 1);
  const products = prepareGSeriesDrivetrainSource(drivetrain, drivetrainMedia, {
    minimumProducts: 1,
    requireCompleteScope: false,
    scopeManifest: quarantinedDrivetrainScopeManifest
  });
  assert.deepEqual(products.map(product => product.ecsPartNumber), ['ES#602']);
  assert.ok(products.every(product => !product.filters.categories.includes('drivetrain-pdk-transmission')));

  const missingRecordQuarantine = structuredClone(drivetrain);
  delete missingRecordQuarantine.records[1].excludeFromCustomerFacing;
  assert.throws(() => prepareGSeriesDrivetrainSource(missingRecordQuarantine, drivetrainMedia, {
    minimumProducts: 1,
    requireCompleteScope: false,
    scopeManifest: quarantinedDrivetrainScopeManifest
  }), /failed ECS source validation/);
});

test('requires a complete keyed Drivetrain scope manifest and exact category route', () => {
  const scope = createGSeriesDrivetrainScope(drivetrainScopeManifest);
  assert.equal(scope.parentCategorySlug, 'g-series-drivetrain');
  assert.equal(scope.expectedCategoryCounts['BMW G80 M3 Competition S58 3.0L']['Fixture Drivetrain Components'], 1);
  assert.throws(() => prepareGSeriesDrivetrainSource(source, media, { requireCompleteScope: false }),
    /scope manifest is required/);

  const drivetrain = structuredClone(source);
  drivetrain.records = [drivetrain.records[0]];
  drivetrain.records[0].category = 'Fixture Drivetrain Tools';
  drivetrain.records[0].sourceUrl = 'https://www.ecstuning.com/BMW-G80-M3_Competition-S58_3.0L/Tools/Drivetrain/';
  const drivetrainMedia = structuredClone(media);
  drivetrainMedia.images[0].localPath = 'assets/products/ecs/g-series-drivetrain/es4699999.webp';
  drivetrainMedia.images[1].localPath = 'assets/products/ecs/g-series-drivetrain/ecs-box-no-image.jpg';
  assert.throws(() => prepareGSeriesDrivetrainSource(drivetrain, drivetrainMedia, {
    requireCompleteScope: false,
    scopeManifest: drivetrainScopeManifest
  }), /failed ECS source validation/);

  const unsafeSlug = structuredClone(drivetrainScopeManifest);
  unsafeSlug.categories['fixture-tools'].slug = 'tools';
  assert.throws(() => createGSeriesDrivetrainScope(unsafeSlug), /category manifest is invalid/);
});

test('rejects unverified or incomplete product sources', () => {
  const invalid = structuredClone(source);
  invalid.records[0].productUrl = 'https://example.com/not-ecs/';
  assert.throws(() => prepareGSeriesPerformance(invalid, media), /failed ECS source validation/);
});

test('accepts official ECS product paths with supplier punctuation', () => {
  const punctuated = structuredClone(source);
  punctuated.records = [punctuated.records[0]];
  punctuated.records[0].productUrl = 'https://www.ecstuning.com/b-fuel_it!-parts/s58-flex-fuel-kit-g8x/s58flexfkit~fue/';
  assert.equal(prepareGSeriesPerformance(punctuated, media).length, 1);
});

test('rejects a source page that does not match the declared vehicle category', () => {
  const mismatched = structuredClone(source);
  mismatched.records = [mismatched.records[0]];
  mismatched.records[0].sourceUrl = 'https://www.ecstuning.com/BMW-G82-M4_Competition-S58_3.0L/Performance/Exhaust/';
  assert.throws(() => prepareGSeriesPerformance(mismatched, media), /failed ECS source validation/);
});

test('rejects ambiguous or malformed public price text', () => {
  const malformed = structuredClone(source);
  malformed.records = [malformed.records[0]];
  malformed.records[0].priceText = '$599.99 $499.99 USD';
  assert.throws(() => prepareGSeriesPerformance(malformed, media), /failed ECS source validation/);
});

test('requires a complete reconciliation manifest for publication', () => {
  assert.throws(() => prepareGSeriesPerformanceSource(source, media), /reconciliation manifest/);
});

test('fails closed when verified local media is missing', () => {
  assert.throws(() => prepareGSeriesPerformance(source, {
    schemaVersion: 1, supplier: 'ECS Tuning', images: []
  }), /Verified local media/);
});

test('uses the official ECS placeholder and controlled copy when supplier fields are absent', () => {
  const partial = structuredClone(source);
  partial.records[0].description = '';
  partial.records[0].brand = '';
  partial.records[0].imageUrl = 'https://assets.ecstuning.com/product_library/not-bundled.webp';
  partial.records[0].imageFallbackUrl = 'https://assets.ecstuning.com/product_library/not-bundled.jpg';
  partial.records = [partial.records[0]];
  const [product] = prepareGSeriesPerformance(partial, media);
  assert.equal(product.brand, 'Supplier brand not provided');
  assert.equal(product.detailedDescriptionAvailable, false);
  assert.equal(product.imageStatus, 'supplier-media-unavailable');
  assert.match(product.images[0].src, /ecs-box-no-image\.jpg$/);
});

test('normalizes an explicit supplier no-image listing to the official local placeholder', () => {
  const noImage = structuredClone(source);
  noImage.records = [noImage.records[0]];
  noImage.records[0].imageUrl = null;
  noImage.records[0].imageFallbackUrl = null;
  noImage.records[0].imageAlt = '';
  const [product] = prepareGSeriesPerformance(noImage, media);
  assert.equal(product.imageStatus, 'supplier-media-unavailable');
  assert.match(product.images[0].src, /ecs-box-no-image\.jpg$/);
  assert.match(product.images[0].alt, /Product image not supplied by ECS/);
});

test('converts supplier HTML to plain text and removes expired promotional calls to action', () => {
  const promoted = structuredClone(source);
  promoted.records = [promoted.records[0]];
  promoted.records[0].description = '<p><strong>S58 &amp; G8X intake.</strong></p> ALL SALES FINAL. Want To Haggle? Give Us A Call Or Chat To Make An Offer On This Product! Call In Or Chat For Best Price! 10X Entries For Our 25th Anniversary Sweepstakes! Confirm fitment.';
  const [product] = prepareGSeriesPerformance(promoted, media);
  assert.equal(product.description, 'S58 & G8X intake. ALL SALES FINAL. Confirm fitment.');
  assert.equal(product.summary, 'S58 & G8X intake. ALL SALES FINAL. Confirm fitment.');
  assert.equal(product.subcategory, null);
  assert.deepEqual(product.filters.subcategories, []);
});

test('removes supplier phone/chat and urgency promotions without removing product facts', () => {
  const promoted = structuredClone(source);
  promoted.records = [promoted.records[0]];
  promoted.records[0].description = 'Includes both blades. We Price Match - Give Us A Call or Chat! 1/8 inch aluminum plate. Don\'t See A Bundle You Want - Give Us A Call Or Chat - We Will Make One! Trunk fitment only. Don\'t wait, they may not be around forever!';
  promoted.records[0].imageAlt = 'S58 intake. 10X Entries For Our Spin To Win Sweepstakes! Don\'t wait, they may not be around forever!';
  const [product] = prepareGSeriesPerformance(promoted, media);
  assert.equal(product.description, 'Includes both blades. 1/8 inch aluminum plate. Trunk fitment only.');
  assert.equal(product.images[0].alt, 'S58 intake.');
});

test('repairs known supplier temperature encoding and rejects unresolved replacement characters', () => {
  const temperatures = structuredClone(source);
  temperatures.records = [temperatures.records[0]];
  temperatures.records[0].description = 'Boiling Point - Dry 265�C (509�F) / Wet >165Â°C (329ï¿½F)';
  const [product] = prepareGSeriesPerformance(temperatures, media);
  assert.equal(product.description, 'Boiling Point - Dry 265°C (509°F) / Wet >165°C (329°F)');

  temperatures.records[0].description = 'Unresolved supplier text �';
  assert.throws(() => prepareGSeriesPerformance(temperatures, media), /unresolved replacement character/);
});

test('repairs known supplier smart punctuation encoding before compatibility normalization', () => {
  const punctuation = structuredClone(source);
  punctuation.records = [punctuation.records[0]];
  punctuation.records[0].description = 'BMW\u00e2\u20ac\u2122s legacy \u00e2\u20ac\u201d engineered for track use\u00e2\u20ac\u00a6';
  const [product] = prepareGSeriesPerformance(punctuation, media);
  assert.equal(product.description, 'BMW’s legacy — engineered for track use...');
});

test('keeps zero-value or starting-price configurators quote-only', () => {
  const configurable = structuredClone(source);
  configurable.records = [configurable.records[0]];
  configurable.records[0].priceText = 'Starting at $0.00 USD';
  const [product] = prepareGSeriesPerformance(configurable, media);
  assert.equal(product.quoteOnly, true);
  assert.equal(product.purchaseMode, 'request-price');
  assert.equal(product.priceAmount, null);
});

test('retains a positive supplier starting price while requiring a quote', () => {
  const configurable = structuredClone(source);
  configurable.records = [configurable.records[0]];
  configurable.records[0].priceText = 'Starting at $46.99 USD';
  const [product] = prepareGSeriesPerformance(configurable, media);
  assert.equal(product.quoteOnly, true);
  assert.equal(product.priceStartingAt, true);
  assert.equal(product.priceAmount, 46.99);
});

test('enforces the requested publication floor', () => {
  assert.throws(() => prepareGSeriesPerformance(source, media, { minimumProducts: 2 }), /2 are required/);
});
