import test from 'node:test';
import assert from 'node:assert/strict';
import {
  combineBmwM3SectionCaptures,
  prepareBmwM3AggregateCapture,
  renderBmwM3AggregateModule
} from './prepare-bmw-m3-aggregate.mjs';

const generatedAt = '2026-08-09T08:00:00.000Z';
const nowMs = Date.parse('2026-08-09T08:01:00.000Z');

function record(overrides = {}) {
  return {
    title: 'M3 Test Intake',
    description: 'Public supplier description.',
    brand: 'Test Brand',
    ecsPartNumber: 'ES#4700001',
    manufacturerPartNumber: 'M3-TEST-1',
    publicUsdPrice: '$499.99 USD',
    availability: 'In Stock',
    productUrl: 'https://www.ecstuning.com/b-test-brand-parts/m3-test-intake/m3-test-1/',
    imageUrls: ['https://assets.ecstuning.com/product_library/4700001_x300.webp'],
    section: 'Engine',
    category: 'Air Intake',
    sourceUrl: 'https://www.ecstuning.com/BMW-M3/Engine/Air_Intake/',
    observedAt: generatedAt,
    relevancePosition: 2,
    ...overrides
  };
}

function capture(records) {
  return {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    kind: 'bmw-m3-aggregate-listing-capture',
    generatedAt,
    records
  };
}

test('deduplicates model-level M3 observations and never invents exact fitment', () => {
  const result = prepareBmwM3AggregateCapture(capture([
    record(),
    record({
      section: 'Performance',
      category: 'Engine Performance',
      sourceUrl: 'https://www.ecstuning.com/BMW-M3/Performance/Engine/',
      relevancePosition: 1
    })
  ]), { nowMs });
  assert.equal(result.products.length, 1);
  const product = result.products[0];
  assert.equal(product.ecsPartNumber, 'ES#4700001');
  assert.equal(product.priceAmount, 499.99);
  assert.equal(product.purchaseMode, 'fitment-confirmation-required');
  assert.equal(product.status, 'Supplier status — confirmation required');
  assert.deepEqual(product.fitments[0], {
    make: 'BMW', model: 'M3', models: ['M3'], trim: null, generation: null,
    chassis: [], yearFrom: null, yearTo: null, engines: [], drivetrains: [],
    confidence: 'possible', evidence: 'ecs-bmw-m3-aggregate-category',
    note: product.fitments[0].note, noteAr: product.fitments[0].noteAr
  });
  assert.match(product.fitments[0].note, /does not establish model year, generation, chassis, engine, drivetrain or options/);
  assert.match(product.fitments[0].noteAr, /لا يحدد هذا الإدراج العام سنة الصنع/);
  assert.deepEqual(product.filters.categories, ['bmw-m3', 'bmw-m3-engine', 'bmw-m3-performance']);
  assert.deepEqual(product.filters.subcategories, [
    'bmw-m3-engine-air-intake', 'bmw-m3-performance-engine-performance'
  ]);
  assert.equal(product.section, 'Engine');
  assert.equal(product.subcategory, 'Air Intake');
  assert.equal(product.categoryMemberships.length, 2);
  assert.equal(product.selectionSources.length, 2);
  assert.equal(product.images[0].src, 'https://assets.ecstuning.com/product_library/4700001_x300.webp');
  assert.equal(result.audit.duplicateObservationCount, 1);
  assert.equal(result.audit.sections.engine.productCount, 1);
  assert.equal(result.audit.sections.performance.productCount, 1);
});

test('accepts and audits every approved generic BMW M3 section without deriving a chassis', () => {
  const sections = ['Braking', 'Engine', 'Exterior', 'Interior', 'Performance', 'Suspension', 'Steering'];
  const records = sections.map((section, index) => record({
    title: `${section} test item`,
    ecsPartNumber: `ES#480000${index}`,
    manufacturerPartNumber: `M3-${section.toUpperCase()}`,
    productUrl: `https://www.ecstuning.com/b-test-brand-parts/${section.toLowerCase()}-item/m3-${section.toLowerCase()}/`,
    section,
    category: `${section} Components`,
    sourceUrl: `https://www.ecstuning.com/BMW-M3/${section}/Components/`
  }));
  const result = prepareBmwM3AggregateCapture(capture(records), { nowMs });
  assert.equal(result.products.length, 7);
  for (const section of sections.map(value => value.toLowerCase())) {
    assert.equal(result.audit.sections[section].observationCount, 1);
    assert.equal(result.audit.sections[section].productCount, 1);
  }
  assert.ok(result.products.every(product => product.fitmentConfidence === 'possible'));
  assert.ok(result.products.every(product => product.fitments[0].generation === null));
  assert.ok(result.products.every(product => product.fitments[0].chassis.length === 0));
});

test('combines all seven direct reconciled section-capture JSON files', () => {
  const sections = ['Braking', 'Engine', 'Exterior', 'Interior', 'Performance', 'Suspension', 'Steering'];
  const documents = sections.map((section, index) => {
    const listing = record({
      title: `${section} test item`, ecsPartNumber: `ES#490000${index}`,
      manufacturerPartNumber: `M3-${section.toUpperCase()}`,
      productUrl: `https://www.ecstuning.com/b-test-brand-parts/${section.toLowerCase()}-item/m3-${section.toLowerCase()}/`,
      section, category: `${section} Components`, vehicle: 'BMW M3',
      sourceUrl: `https://www.ecstuning.com/BMW-M3/${section}/Components/`, relevancePosition: 1
    });
    return {
      schemaVersion: 1, supplier: 'ECS Tuning', accessClass: 'public-retail',
      kind: `bmw-m3-${section.toLowerCase()}-listing-capture`, generatedAt,
      vehicle: 'BMW M3', section,
      categories: [{ name: `${section} Components`, count: 1 }], records: [listing]
    };
  });
  const combined = combineBmwM3SectionCaptures(documents, { nowMs });
  assert.equal(combined.kind, 'bmw-m3-aggregate-listing-capture');
  assert.equal(combined.records.length, 7);
  assert.equal(prepareBmwM3AggregateCapture(combined, { nowMs }).products.length, 7);
});

test('quarantines conflicting ECS identities and same-day public prices', () => {
  const result = prepareBmwM3AggregateCapture(capture([
    record(),
    record({ manufacturerPartNumber: 'DIFFERENT-MPN' }),
    record({
      ecsPartNumber: '4700002', manufacturerPartNumber: 'M3-TEST-2',
      productUrl: 'https://www.ecstuning.com/b-test-brand-parts/m3-test-two/m3-test-2/',
      publicUsdPrice: '$100.00'
    }),
    record({
      ecsPartNumber: '4700002', manufacturerPartNumber: 'M3-TEST-2',
      productUrl: 'https://www.ecstuning.com/b-test-brand-parts/m3-test-two/m3-test-2/',
      publicUsdPrice: '$101.00'
    })
  ]), { nowMs });
  assert.equal(result.products.length, 0);
  assert.deepEqual(result.quarantinedEcsIdentities, ['4700001', '4700002']);
  assert.deepEqual(result.audit.quarantine[0].reasons, ['conflicting-manufacturer-part-number']);
  assert.deepEqual(result.audit.quarantine[1].reasons, ['conflicting-same-day-public-price']);
  assert.equal(result.audit.quarantinedRecordCount, 4);
});

test('uses a newer dated retail observation but still publishes confirmation-only availability', () => {
  const result = prepareBmwM3AggregateCapture(capture([
    record({ publicUsdPrice: '$499.99', observedAt: '2026-08-08T08:00:00.000Z' }),
    record({ publicUsdPrice: '$479.99', availability: 'Ships in 2 days', observedAt: generatedAt })
  ]), { nowMs });
  const product = result.products[0];
  assert.equal(product.priceAmount, 479.99);
  assert.equal(product.priceVerifiedAt, '2026-08-09');
  assert.equal(product.observedAvailability, 'Ships in 2 days');
  assert.equal(product.availabilityCode, 'check_availability');
  assert.equal(product.stockPolicy, 'manual-confirm');
});

test('keeps missing prices fail-closed and rejects non-generic or malformed source records', () => {
  const result = prepareBmwM3AggregateCapture(capture([
    record({ publicUsdPrice: null }),
    record({
      ecsPartNumber: '4700002',
      sourceUrl: 'https://www.ecstuning.com/BMW-G80-M3_Competition-S58_3.0L/Engine/'
    }),
    record({ ecsPartNumber: 'not-an-es-number' })
  ]), { nowMs });
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].quoteOnly, true);
  assert.equal(result.products[0].purchaseMode, 'request-price');
  assert.equal(result.products[0].priceAmount, null);
  assert.equal(result.audit.invalidRecordCount, 2);
  assert.ok(result.audit.invalidRecords[0].reasons.includes('missing-or-invalid-source-url'));
  assert.ok(result.audit.invalidRecords[1].reasons.includes('missing-or-invalid-ecs-identity'));
});

test('accepts canonical ECS product families whose supplier segment does not end in parts', () => {
  const result = prepareBmwM3AggregateCapture(capture([record({
    title: 'ATI Test Super Damper',
    brand: 'ATI',
    ecsPartNumber: 'ES#4800999',
    manufacturerPartNumber: 'ATI-918999',
    productUrl: 'https://www.ecstuning.com/b-ati-performance-products/super-damper/918999/'
  })]), { nowMs });
  assert.equal(result.audit.invalidRecordCount, 0);
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].ecsPartNumber, 'ES#4800999');
  assert.equal(result.products[0].originalUrl,
    'https://www.ecstuning.com/b-ati-performance-products/super-damper/918999/');
});

test('repairs the captured ECS soft-hyphen mojibake without changing product identity', () => {
  const result = prepareBmwM3AggregateCapture(capture([record({
    title: 'SL6 DOT 4 Low Viscosity Brake Fluid - 1 Liter',
    brand: 'ATE',
    ecsPartNumber: '4772219',
    manufacturerPartNumber: '\u00ad706402',
    productUrl: 'https://www.ecstuning.com/b-ate-parts/sl6-low-viscosity-brake-fluid-1-liter/%C3%82%C2%AD706402~ate/',
    section: 'Braking',
    category: 'BMW M3 Brake Fluids',
    sourceUrl: 'https://www.ecstuning.com/BMW-M3/Braking/Fluid/3'
  })]), { nowMs });
  assert.equal(result.audit.invalidRecordCount, 0);
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].mpn, '706402');
  assert.equal(result.products[0].identifiers.mpn, '706402');
  assert.equal(result.products[0].originalUrl,
    'https://www.ecstuning.com/b-ate-parts/sl6-low-viscosity-brake-fluid-1-liter/%C2%AD706402~ate/');
});

test('keeps an otherwise valid product when ECS omits the brand instead of inventing one', () => {
  const listing = record({
    brand: '',
    ecsPartNumber: '7123456',
    manufacturerPartNumber: 'NO-BRAND-1',
    productUrl: 'https://www.ecstuning.com/b-supplier-parts/no-brand-test/no-brand-1/',
    title: 'Brand field omitted test product'
  });
  const result = prepareBmwM3AggregateCapture(capture([listing]), { nowMs });

  assert.equal(result.audit.invalidRecordCount, 0);
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].brand, 'Supplier brand not provided');
  assert.equal(result.products[0].brandSlug, 'supplier-brand-not-provided');
  assert.equal(result.products[0].brandSupplied, false);
});

test('renders a deterministic importable compact data module', async () => {
  const result = prepareBmwM3AggregateCapture(capture([record()]), { nowMs });
  const first = renderBmwM3AggregateModule(result);
  const second = renderBmwM3AggregateModule(result);
  assert.equal(first, second);
  assert.match(first, /BMW_M3_AGGREGATE_PRODUCTS/);
  assert.match(first, /BMW_M3_AGGREGATE_QUARANTINED_ECS_IDENTITIES/);
  const module = await import(`data:text/javascript,${encodeURIComponent(first)}`);
  assert.equal(module.BMW_M3_AGGREGATE_PRODUCTS.length, 1);
  assert.deepEqual(module.BMW_M3_AGGREGATE_QUARANTINED_ECS_IDENTITIES, []);
});

test('maps captured ECS CDN images to verified local materialized assets when an index is supplied', () => {
  const mediaIndex = {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    images: [{
      sourceUrl: 'https://assets.ecstuning.com/product_library/4700001_x300.webp',
      localPath: 'assets/products/ecs/bmw-m3/abcdef0123456789abcdef01.webp',
      width: 300,
      height: 225,
      sha256: 'a'.repeat(64)
    }]
  };
  const result = prepareBmwM3AggregateCapture(capture([record()]), { nowMs, mediaIndex });
  assert.deepEqual(result.products[0].images[0], {
    src: 'assets/products/ecs/bmw-m3/abcdef0123456789abcdef01.webp',
    width: 300,
    height: 225,
    sourceUrl: 'https://assets.ecstuning.com/product_library/4700001_x300.webp',
    alt: 'ES#4700001 - M3-TEST-1 - M3 Test Intake - Test Brand',
    altAr: 'M3 Test Intake'
  });
  assert.equal(result.audit.localAssetImageProductCount, 1);
  assert.equal(result.audit.remoteCdnImageProductCount, 0);
});
