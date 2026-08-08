import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REVIEWED_ECS_PRODUCTS,
  mergeReviewedEcsProducts,
  reviewedFallbackResponse
} from '../server/ecs-reviewed-catalog.js';

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
