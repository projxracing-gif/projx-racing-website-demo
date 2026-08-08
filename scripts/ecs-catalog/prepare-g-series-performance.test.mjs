import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareGSeriesExterior as prepareGSeriesExteriorSource,
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
