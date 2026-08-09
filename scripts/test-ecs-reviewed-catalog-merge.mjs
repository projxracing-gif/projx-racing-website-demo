import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REVIEWED_ECS_CATALOGUE_STATUS,
  REVIEWED_ECS_PRODUCTS,
  mergeReviewedEcsProducts,
  reviewedEcsProductCard,
  reviewedFallbackResponse
} from '../server/ecs-reviewed-catalog.js';
import {
  BMW_M3_AGGREGATE_PRODUCTS,
  BMW_M3_AGGREGATE_QUARANTINED_ECS_IDENTITIES
} from '../server/data/ecs-bmw-m3-aggregate-products.js';
import { createConfiguredReviewedShardCatalogueProvider } from '../server/ecs-reviewed-shard-catalog.js';

function reviewedProduct(overrides = {}) {
  return {
    ecsPartNumber: 'ES#10001',
    sku: 'ES#10001',
    mpn: 'CURATED-ONE',
    publicKey: 'ecs-curated-intake',
    slug: 'curated-intake',
    title: 'Curated S58 Intake',
    description: 'A reviewed, vehicle-specific description that must remain public.',
    brand: 'Curated Brand',
    category: 'Engine',
    priceAmount: 100,
    priceCurrency: 'USD',
    priceVerifiedAt: '2026-08-04',
    checkedAt: '2026-08-04',
    observedAvailability: 'Previously observed in stock',
    images: [{ src: 'assets/products/ecs/curated-intake.jpg', alt: 'Curated intake' }],
    fitments: [{
      make: 'BMW', model: 'M3', generation: 'G80', models: ['M3'], chassis: ['G80'],
      engines: ['S58'], drivetrains: [], note: 'Curated fitment note.'
    }],
    filters: { supplier: ['ecs'], models: ['M3'], chassis: ['G80'], categories: ['engine'] },
    relatedProductSlugs: [],
    dataOrigin: 'manual-public-page-review',
    shipping: { status: 'quote-required', note: 'Curated Kuwait shipping note.' },
    ...overrides
  };
}

function generatedProduct(overrides = {}) {
  return reviewedProduct({
    publicKey: 'ecs-es-10001',
    slug: 'es-10001',
    title: 'Supplier Listing Intake',
    description: 'Supplier copy.',
    brand: 'Supplier Brand',
    priceAmount: 125.5,
    priceVerifiedAt: '2026-08-08',
    priceNote: 'Public supplier retail price observed 2026-08-08.',
    checkedAt: '2026-08-08',
    stockObservedAt: '2026-08-08',
    observedAvailability: 'Ships in 2 days',
    images: [{ src: 'assets/products/ecs/g-series-performance/es10001.webp', alt: 'Supplier intake' }],
    fitments: [
      {
        make: 'BMW', model: 'M3', generation: 'G80', models: ['M3 Competition'], chassis: ['G80'],
        engines: ['S58'], drivetrains: ['RWD'], note: 'Supplier vehicle-category evidence.'
      },
      {
        make: 'BMW', model: 'M4', generation: 'G82', models: ['M4'], chassis: ['G82'],
        engines: ['S58'], drivetrains: [], note: 'Supplier vehicle-category evidence.'
      }
    ],
    filters: {
      supplier: ['ecs'], models: ['M3', 'M4'], chassis: ['G80', 'G82'],
      categories: ['performance-engine-drivetrain']
    },
    relatedProductSlugs: ['es-20002'],
    dataOrigin: 'authorized-public-vehicle-category-review',
    selectionEvidence: 'ecs-vehicle-category-relevance',
    selectionRank: 4,
    selectionNote: 'Current ECS relevance evidence.',
    selectionSources: [{
      vehicle: 'BMW G80 M3 Competition S58 3.0L', category: 'Performance Engine & Drivetrain Parts',
      sourceUrl: 'https://www.ecstuning.com/BMW-G80-M3_Competition-S58_3.0L/Performance/',
      relevancePosition: 4, observedAt: '2026-08-08T12:00:00Z'
    }],
    shipping: {
      status: 'quote-required', origin: 'United States', observedSupplierMessage: 'Free Shipping',
      note: 'Generated shipping note.'
    },
    ...overrides
  });
}

test('includes the reviewed BMW M3 aggregate through an auditable empty-safe source', () => {
  assert.equal(
    REVIEWED_ECS_CATALOGUE_STATUS.sourceRecordCounts.bmwM3Aggregate,
    BMW_M3_AGGREGATE_PRODUCTS.length
  );
  assert.equal(
    REVIEWED_ECS_CATALOGUE_STATUS.sourceRecordCount,
    Object.values(REVIEWED_ECS_CATALOGUE_STATUS.sourceRecordCounts)
      .reduce((total, count) => total + count, 0)
  );
  assert.equal(REVIEWED_ECS_CATALOGUE_STATUS.publishedProductCount, REVIEWED_ECS_PRODUCTS.length);
  assert.ok(
    REVIEWED_ECS_CATALOGUE_STATUS.bmwM3AggregateNewUniqueProductCount <= BMW_M3_AGGREGATE_PRODUCTS.length
  );
  const quarantined = new Set(BMW_M3_AGGREGATE_QUARANTINED_ECS_IDENTITIES.map(String));
  assert.equal(REVIEWED_ECS_PRODUCTS.some(product => {
    const match = String(product.ecsPartNumber || product.sku || '').match(/(?:ES#)?(\d{3,12})/i);
    return match && quarantined.has(match[1]);
  }), false);
});

test('keeps the runtime module empty and exposes BMW M3 progress through verified shards', async () => {
  assert.equal(BMW_M3_AGGREGATE_PRODUCTS.length, 0);
  const provider = createConfiguredReviewedShardCatalogueProvider();
  const combined = await provider.getStatus(REVIEWED_ECS_PRODUCTS);
  const status = combined.bmwM3AggregateCaptureStatus;
  assert.equal(status.importPolicy, 'reconciled-sections-only');
  assert.equal(status.requestedSectionCount, 7);
  assert.equal(status.includedSectionCount, status.includedSections.length);
  assert.equal(status.excludedSections.length,
    status.requestedSectionCount - status.includedSectionCount);
  assert.equal(status.complete, status.includedSectionCount === status.requestedSectionCount);
  assert.equal(status.stage, status.complete ? 'complete' : 'staging-progress');
  assert.equal(combined.sourceRecordCounts.bmwM3Sharded, 2071);
  assert.ok(combined.bmwM3AggregateNewUniqueProductCount > 0);
  assert.equal(combined.shardRelease.source, 'bundled-verified-progress');

  const repairedIdentity = REVIEWED_ECS_PRODUCTS.filter(product => product.ecsPartNumber === 'ES#4772219');
  assert.equal(repairedIdentity.length, 1);
  assert.equal(repairedIdentity[0].mpn, '706402');
  assert.equal(repairedIdentity[0].originalUrl,
    'https://www.ecstuning.com/b-ate-parts/sl6-low-viscosity-brake-fluid-1-liter/%C2%AD706402~ate/');
});

test('deduplicates by ES number while preserving reviewed URLs and curated content', () => {
  const existing = [
    reviewedProduct(),
    reviewedProduct({
      ecsPartNumber: 'ES#20002', sku: 'ES#20002', publicKey: 'ecs-curated-charge-pipe',
      slug: 'curated-charge-pipe', title: 'Curated Charge Pipe', relatedProductSlugs: []
    })
  ];
  const generated = [
    generatedProduct(),
    generatedProduct({
      ecsPartNumber: 'ES#20002', sku: 'ES#20002', publicKey: 'ecs-es-20002', slug: 'es-20002',
      title: 'Supplier Charge Pipe', relatedProductSlugs: ['es-10001']
    })
  ];

  const merged = mergeReviewedEcsProducts(existing, generated);
  assert.equal(merged.length, 2);
  assert.equal(new Set(merged.map(product => product.ecsPartNumber.replace(/\D/g, ''))).size, 2);
  assert.equal(new Set(merged.map(product => product.publicKey)).size, 2);
  assert.equal(new Set(merged.map(product => product.slug)).size, 2);

  const intake = merged.find(product => product.ecsPartNumber === 'ES#10001');
  assert.equal(intake.publicKey, 'ecs-curated-intake');
  assert.equal(intake.slug, 'curated-intake');
  assert.equal(intake.title, 'Curated S58 Intake');
  assert.match(intake.description, /vehicle-specific description/);
  assert.deepEqual(intake.images, existing[0].images);
  assert.equal(intake.priceAmount, 125.5);
  assert.equal(intake.priceVerifiedAt, '2026-08-08');
  assert.equal(intake.observedAvailability, 'Ships in 2 days');
  assert.equal(intake.selectionEvidence, 'ecs-vehicle-category-relevance');
  assert.equal(intake.selectionSources.length, 1);
  assert.deepEqual(intake.fitments.map(fitment => fitment.generation), ['G80', 'G82']);
  assert.deepEqual(intake.fitments[0].models, ['M3', 'M3 Competition']);
  assert.deepEqual(intake.fitments[0].drivetrains, ['RWD']);
  assert.deepEqual(intake.filters.chassis, ['G80', 'G82']);
  assert.deepEqual(intake.relatedProductSlugs, ['curated-charge-pipe']);
  assert.equal(intake.shipping.note, 'Curated Kuwait shipping note.');
  assert.equal(intake.shipping.observedSupplierMessage, 'Free Shipping');
  assert.deepEqual(intake.dataOrigins, [
    'manual-public-page-review', 'authorized-public-vehicle-category-review'
  ]);

  const chargePipe = merged.find(product => product.ecsPartNumber === 'ES#20002');
  assert.deepEqual(chargePipe.relatedProductSlugs, ['curated-intake']);
});

test('does not replace newer reviewed price and availability with an older observation', () => {
  const current = reviewedProduct({
    priceAmount: 150, priceVerifiedAt: '2026-08-10', checkedAt: '2026-08-10',
    stockObservedAt: '2026-08-10', observedAvailability: 'Current reviewed status'
  });
  const older = generatedProduct({
    priceAmount: 99, priceVerifiedAt: '2026-08-08', checkedAt: '2026-08-08',
    stockObservedAt: '2026-08-08', observedAvailability: 'Older status'
  });
  const [merged] = mergeReviewedEcsProducts([current], [older]);
  assert.equal(merged.priceAmount, 150);
  assert.equal(merged.observedAvailability, 'Current reviewed status');
  assert.equal(merged.selectionSources.length, 1);
});

test('upgrades an official supplier placeholder when a later capture has verified product media', () => {
  const placeholder = reviewedProduct({
    imageStatus: 'supplier-media-unavailable',
    imageSourceUrl: 'https://assets.ecstuning.com/static/img/category/ecs_box_no_image.jpg',
    images: [{ src: 'assets/products/ecs/g-series-performance/ecs-box-no-image.jpg', alt: 'No supplier image' }]
  });
  const verified = generatedProduct({
    imageStatus: 'supplier-media-verified',
    imageSourceUrl: 'https://assets.ecstuning.com/product_library/1000000/300x225/example.jpg',
    images: [{ src: 'assets/products/ecs/g-series-exterior/example.webp', alt: 'Verified supplier product' }]
  });
  const [merged] = mergeReviewedEcsProducts([placeholder], [verified]);
  assert.equal(merged.imageStatus, 'supplier-media-verified');
  assert.deepEqual(merged.images, verified.images);
  assert.equal(merged.imageSourceUrl, verified.imageSourceUrl);
});

test('preserves established verified media when another verified scope is merged', () => {
  const established = reviewedProduct({
    imageStatus: 'supplier-media-verified',
    images: [{ src: 'assets/products/ecs/curated-intake.jpg', alt: 'Established product image' }]
  });
  const additional = generatedProduct({
    imageStatus: 'supplier-media-verified',
    images: [{ src: 'assets/products/ecs/g-series-exterior/example.webp', alt: 'Other capture image' }]
  });
  const [merged] = mergeReviewedEcsProducts([established], [additional]);
  assert.deepEqual(merged.images, established.images);
});

test('preserves primary selection wording while unioning duplicate catalogue evidence', () => {
  const primary = reviewedProduct({
    category: 'Exterior',
    selectionEvidence: 'primary-exterior-evidence',
    selectionNote: 'Primary Exterior selection wording.',
    selectionNoteAr: 'صياغة اختيار الفئة الخارجية الأساسية.',
    imageStatus: 'supplier-media-verified',
    images: [{ src: 'assets/products/ecs/primary.webp', alt: 'Primary verified image' }],
    selectionSources: [{
      vehicle: 'BMW G80 M3', category: 'Exterior',
      sourceUrl: 'https://www.ecstuning.com/BMW-G80-M3/Exterior/',
      relevancePosition: 2, observedAt: '2026-08-07T12:00:00Z'
    }]
  });
  const secondary = generatedProduct({
    category: 'Performance',
    selectionEvidence: 'secondary-performance-evidence',
    selectionNote: 'Secondary Performance selection wording.',
    selectionNoteAr: 'صياغة اختيار فئة الأداء الثانوية.',
    imageStatus: 'supplier-media-verified',
    images: [{ src: 'assets/products/ecs/secondary.webp', alt: 'Secondary verified image' }]
  });

  const [merged] = mergeReviewedEcsProducts([primary], [secondary]);
  assert.equal(merged.category, 'Exterior');
  assert.equal(merged.selectionEvidence, 'primary-exterior-evidence');
  assert.equal(merged.selectionNote, 'Primary Exterior selection wording.');
  assert.equal(merged.selectionNoteAr, primary.selectionNoteAr);
  assert.deepEqual(merged.images, primary.images);
  assert.deepEqual(merged.filters.categories, ['engine', 'performance-engine-drivetrain']);
  assert.deepEqual(merged.fitments.map(fitment => fitment.generation), ['G80', 'G82']);
  assert.equal(merged.selectionSources.length, 2);
  assert.deepEqual(merged.selectionSources.map(source => source.category), [
    'Exterior', 'Performance Engine & Drivetrain Parts'
  ]);
});

test('appends exact Drivetrain evidence without replacing an established reviewed product', () => {
  const established = reviewedProduct({
    category: 'Performance',
    categorySlug: 'performance-engine-drivetrain',
    imageStatus: 'supplier-media-verified',
    images: [{ src: 'assets/products/ecs/established.webp', alt: 'Established product image' }],
    selectionSources: [{
      vehicle: 'BMW G80 M3 Competition S58 3.0L', category: 'Performance Engine & Drivetrain Parts',
      sourceUrl: 'https://www.ecstuning.com/BMW-G80-M3_Competition-S58_3.0L/Performance/',
      relevancePosition: 3, observedAt: '2026-08-08T12:00:00Z'
    }]
  });
  const drivetrain = generatedProduct({
    category: 'Automatic Transmission Parts',
    categoryAr: 'أجزاء ناقل الحركة الأوتوماتيكي',
    categorySlug: 'drivetrain-automatic-transmission',
    filters: {
      supplier: ['ecs'], models: ['M3'], chassis: ['G80'],
      categories: ['g-series-drivetrain', 'drivetrain-automatic-transmission'],
      subcategories: ['drivetrain-automatic-transmission']
    },
    selectionSources: [{
      vehicle: 'BMW G80 M3 Competition S58 3.0L', category: 'Automatic Transmission',
      sourceUrl: 'https://www.ecstuning.com/BMW-G80-M3_Competition-S58_3.0L/Drivetrain/Automatic-Transmission/',
      relevancePosition: 5, observedAt: '2026-08-09T12:00:00Z'
    }]
  });

  const [merged] = mergeReviewedEcsProducts([established], [drivetrain]);
  assert.equal(merged.category, 'Performance');
  assert.equal(merged.categorySlug, 'performance-engine-drivetrain');
  assert.deepEqual(merged.images, established.images);
  assert.deepEqual(merged.filters.categories, [
    'engine', 'g-series-drivetrain', 'drivetrain-automatic-transmission'
  ]);
  assert.deepEqual(merged.filters.subcategories, ['drivetrain-automatic-transmission']);
  assert.deepEqual(merged.selectionSources.map(source => source.category), [
    'Performance Engine & Drivetrain Parts', 'Automatic Transmission'
  ]);
});

test('appends exact Braking evidence to an overlapping Performance product without duplication', () => {
  const performance = generatedProduct({
    category: 'Performance Brake Parts & Upgrades',
    categorySlug: 'performance-brakes',
    filters: {
      supplier: ['ecs'], models: ['M3'], chassis: ['G80'],
      categories: ['performance', 'performance-brakes'], subcategories: ['performance-brakes']
    },
    selectionSources: [{
      vehicle: 'BMW G80 M3 Competition S58 3.0L', category: 'Performance Brake Parts & Upgrades',
      sourceUrl: 'https://www.ecstuning.com/BMW-G80-M3_Competition-S58_3.0L/Performance/Braking/',
      relevancePosition: 6, observedAt: '2026-08-08T12:00:00Z'
    }]
  });
  const braking = generatedProduct({
    category: 'Performance Brake Parts',
    categorySlug: 'braking-performance',
    filters: {
      supplier: ['ecs'], models: ['M3'], chassis: ['G80'],
      categories: ['g-series-braking', 'braking-performance'],
      subcategories: ['braking-performance']
    },
    selectionSources: [{
      vehicle: 'BMW G80 M3 Competition S58 3.0L', category: 'Performance Brake Parts',
      sourceUrl: 'https://www.ecstuning.com/BMW-G80-M3_Competition-S58_3.0L/Braking/Performance/',
      relevancePosition: 3, observedAt: '2026-08-09T12:00:00Z'
    }]
  });

  const mergedProducts = mergeReviewedEcsProducts([performance], [braking]);
  assert.equal(mergedProducts.length, 1);
  const [merged] = mergedProducts;
  assert.equal(merged.category, 'Performance Brake Parts & Upgrades');
  assert.equal(merged.categorySlug, 'performance-brakes');
  assert.deepEqual(merged.filters.categories, [
    'performance', 'performance-brakes', 'g-series-braking', 'braking-performance'
  ]);
  assert.deepEqual(merged.filters.subcategories, ['performance-brakes', 'braking-performance']);
  assert.deepEqual(merged.selectionSources.map(source => source.category), [
    'Performance Brake Parts & Upgrades', 'Performance Brake Parts'
  ]);
});

test('deduplicates a legitimate three-digit ECS Drivetrain identity', () => {
  const identity = {
    ecsPartNumber: 'ES#602', sku: 'ES#602', mpn: 'MT-LV-602',
    publicKey: 'ecs-es-602', slug: 'es-602'
  };
  const [merged] = mergeReviewedEcsProducts(
    [reviewedProduct(identity)],
    [generatedProduct(identity)]
  );
  assert.equal(merged.ecsPartNumber, 'ES#602');
  assert.equal(merged.publicKey, 'ecs-es-602');
  assert.equal(merged.selectionSources.length, 1);
});

test('fails closed when the same ES number has a conflicting MPN or canonical product URL', () => {
  assert.throws(
    () => mergeReviewedEcsProducts([reviewedProduct()], [generatedProduct({ mpn: 'OTHER-MPN' })]),
    /manufacturer part number.*ES#10001/
  );
  assert.throws(
    () => mergeReviewedEcsProducts(
      [reviewedProduct({ originalUrl: 'https://www.ecstuning.com/b-brand-parts/item/one/' })],
      [generatedProduct({ originalUrl: 'https://www.ecstuning.com/b-brand-parts/item/two/' })]
    ),
    /canonical product URL.*ES#10001/
  );
});

test('suppresses conflicting same-day public prices across catalogue scopes', () => {
  const [merged] = mergeReviewedEcsProducts(
    [reviewedProduct({ priceAmount: 100, priceVerifiedAt: '2026-08-08', checkedAt: '2026-08-08' })],
    [generatedProduct({ priceAmount: 125.5, priceVerifiedAt: '2026-08-08', checkedAt: '2026-08-08' })]
  );
  assert.equal(merged.priceAmount, null);
  assert.equal(merged.priceConflict, true);
  assert.equal(merged.purchaseMode, 'request-price');
  assert.match(merged.priceNote, /Conflicting public ECS prices/);
});

test('keeps an inherited price conflict closed when a later catalogue scope has a price', () => {
  const first = reviewedProduct({
    priceAmount: 100, priceVerifiedAt: '2026-08-08', checkedAt: '2026-08-08'
  });
  const conflicting = generatedProduct({
    priceAmount: 125.5, priceVerifiedAt: '2026-08-08', checkedAt: '2026-08-08'
  });
  const laterScope = generatedProduct({
    priceAmount: 381.58, priceStartingAt: true,
    priceVerifiedAt: '2026-08-09', checkedAt: '2026-08-09'
  });
  const [merged] = mergeReviewedEcsProducts(
    mergeReviewedEcsProducts([first], [conflicting]),
    [laterScope]
  );
  assert.equal(merged.priceConflict, true);
  assert.equal(merged.priceAmount, null);
  assert.equal(merged.originalPriceAmount, null);
  assert.equal(merged.priceStartingAt, false);
  assert.equal(merged.quoteOnly, true);
  assert.equal(merged.purchaseMode, 'request-price');
  assert.equal(merged.priceType, 'confirmation-required');
  assert.match(merged.priceNote, /Conflicting public ECS prices/);
});

test('keeps every merged catalogue price conflict in request-price mode', () => {
  const conflicts = REVIEWED_ECS_PRODUCTS.filter(product => product.priceConflict);
  assert.ok(conflicts.length > 0);
  for (const product of conflicts) {
    assert.equal(product.priceAmount, null, `${product.ecsPartNumber} exposed a conflicted price`);
    assert.equal(product.originalPriceAmount, null, `${product.ecsPartNumber} exposed an original price`);
    assert.equal(product.priceStartingAt, false, `${product.ecsPartNumber} exposed a starting price`);
    assert.equal(product.quoteOnly, true, `${product.ecsPartNumber} was not quote-only`);
    assert.equal(product.purchaseMode, 'request-price', `${product.ecsPartNumber} was not request-price`);
  }
});

test('fails closed when different ES numbers claim the same public handle', () => {
  const first = reviewedProduct();
  const second = generatedProduct({
    ecsPartNumber: 'ES#30003', sku: 'ES#30003', publicKey: first.publicKey, slug: 'different-slug'
  });
  assert.throws(
    () => mergeReviewedEcsProducts([first], [second]),
    /publicKey.*assigned to multiple products/
  );
});

test('renders quote-only zero-price configurators as Request price and excludes them from priced counts', async () => {
  const quoteOnly = generatedProduct({
    quoteOnly: true,
    purchaseMode: 'request-price',
    priceAmount: null,
    priceStartingAt: true,
    priceVerifiedAt: '2026-08-08'
  });
  const request = {
    mode: 'list', supplier: 'ecs', currency: 'USD', brand: null, partType: null,
    availability: 'all', pricing: 'all', fitment: 'all', structuredVehicle: false,
    query: '', page: 1, offset: 0, sort: 'relevance', match: 'any', positionSource: 'page'
  };
  const response = await reviewedFallbackResponse({
    request,
    req: {},
    nowValue: Date.parse('2026-08-08T18:00:00Z'),
    reason: 'test',
    products: [quoteOnly]
  });
  assert.equal(response.items[0].price.min, null);
  assert.equal(response.items[0].price.max, null);
  assert.equal(response.items[0].price.note, 'The supplier listing requires configuration or current-price confirmation.');
  assert.equal(response.meta.stockIndexedProductCount, 0);
});

test('explains a conflicting public supplier price without exposing an incorrect amount', async () => {
  const conflict = generatedProduct({
    quoteOnly: true,
    purchaseMode: 'request-price',
    priceAmount: null,
    priceConflict: true,
    priceVerifiedAt: '2026-08-08'
  });
  const response = await reviewedFallbackResponse({
    request: {
      mode: 'list', supplier: 'ecs', currency: 'USD', brand: null, partType: null,
      availability: 'all', pricing: 'all', fitment: 'all', structuredVehicle: false,
      query: '', page: 1, offset: 0, sort: 'relevance', match: 'any', positionSource: 'page'
    },
    req: {}, nowValue: Date.parse('2026-08-08T18:00:00Z'), reason: 'test', products: [conflict]
  });
  assert.equal(response.items[0].price.min, null);
  assert.match(response.items[0].price.note, /Conflicting public supplier prices/);
});

test('preserves official ECS HTTPS media URLs without converting them into local paths', () => {
  const source = 'https://assets.ecstuning.com/product_library/25194_x300.webp';
  const card = reviewedEcsProductCard(reviewedProduct({
    images: [{ src: source, alt: 'BMW M3 steering wheel trim' }],
    imageStatus: 'supplier-media-verified'
  }), {
    structuredVehicle: false,
    fitment: 'all'
  }, Date.parse('2026-08-09T12:00:00Z'));
  assert.equal(card.image.src, source);
  assert.equal(card.image.src.startsWith('/https://'), false);
});
