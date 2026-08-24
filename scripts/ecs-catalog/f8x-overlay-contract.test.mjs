import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EcsF8xOverlayContractError,
  canonicalEcsF8xIdentity,
  validateCanonicalEcsF8xOverlayProduct
} from '../../server/ecs-f8x-overlay-contract.js';

function product() {
  return {
    catalogType: 'product',
    provider: 'ECS Tuning',
    providerSlug: 'ecs',
    dataOrigin: 'authorized-public-ecs-f8x-vehicle-category-review',
    publicKey: 'ecs-es-7000002',
    slug: 'es-7000002',
    title: 'Canonical F82 product',
    brand: 'ECS Tuning',
    ecsPartNumber: 'ES#7000002',
    sku: 'ES#7000002',
    mpn: 'F8X-7000002',
    identifiers: { ecs: 'ES#7000002', sku: 'ES#7000002', mpn: 'F8X-7000002' },
    originalUrl: 'https://www.ecstuning.com/b-ecs-parts/canonical-f82-product/f8x-7000002/',
    checkedAt: '2026-08-20',
    stockObservedAt: '2026-08-20',
    staleAfterDays: 7,
    stockPolicy: 'manual-confirm',
    availabilityCode: 'check_availability',
    fitmentStatus: 'supplier-vehicle-category-confirm',
    fitmentConfidence: 'possible',
    fitments: [{
      make: 'BMW',
      model: 'M4',
      models: ['M4'],
      trim: null,
      generation: 'F82',
      chassis: ['F82'],
      yearFrom: null,
      yearTo: null,
      engines: ['S55'],
      drivetrains: [],
      confidence: 'possible',
      evidence: 'ecs-exact-f8x-vehicle-category'
    }],
    filters: {
      supplier: ['ecs'],
      makes: ['BMW'],
      models: ['M4'],
      chassis: ['F82'],
      years: [],
      engines: ['S55'],
      drivetrains: [],
      categories: ['bmw-f8x', 'f82-m4', 'bmw-f8x-braking'],
      subcategories: ['bmw-f8x-braking-brake-pads'],
      availability: ['confirmation-required'],
      fitment: ['possible']
    },
    options: [],
    variants: [],
    selectionSources: [{
      vehicleKey: 'f82-m4',
      vehicle: 'BMW F82 M4 S55 3.0L',
      section: 'Braking',
      category: 'Brake Pads',
      categoryKey: 'brake-pads',
      sourceUrl: 'https://www.ecstuning.com/BMW-F82-M4-S55_3.0L/Braking/Pads/',
      relevancePosition: 1,
      observedAt: '2026-08-20T10:00:00.000Z'
    }]
  };
}

function rejected(mutate) {
  const value = structuredClone(product());
  mutate(value);
  assert.throws(
    () => validateCanonicalEcsF8xOverlayProduct(value),
    error => error instanceof EcsF8xOverlayContractError
      && error.code === 'invalid_f8x_overlay_product'
  );
}

test('accepts only the canonical dated F82 possible-fitment product contract', () => {
  const value = product();
  assert.equal(canonicalEcsF8xIdentity(value), '7000002');
  assert.deepEqual(validateCanonicalEcsF8xOverlayProduct(value), {
    identity: '7000002', profiles: ['f82-m4'], sections: ['braking']
  });
});

test('rejects inconsistent ECS identity carriers including quarantined aliases', () => {
  for (const mutate of [
    value => { value.sku = 'ES#4017812'; },
    value => { value.identifiers.ecs = 'ES#7888888'; },
    value => { value.identifiers.sku = 'ES#7999999'; },
    value => { value.publicKey = 'ecs-es-7999999'; },
    value => { value.slug = 'es-7999999'; }
  ]) rejected(mutate);
});

test('rejects foreign and cross-profile make, model, generation, filter and evidence claims', () => {
  for (const mutate of [
    value => { value.filters.makes = ['Audi']; },
    value => { value.fitments[0].make = 'Toyota'; },
    value => { value.fitments[0].model = 'Supra'; value.fitments[0].models = ['Supra']; },
    value => { value.fitments[0].generation = 'G82'; },
    value => { value.fitments[0].chassis = ['F80']; },
    value => { value.fitments[0].engines = ['B58']; },
    value => { value.fitments[0].evidence = 'supplier-title'; },
    value => { value.selectionSources[0].vehicle = 'BMW F80 M3 S55 3.0L'; },
    value => { value.selectionSources[0].section = 'Engine'; }
  ]) rejected(mutate);
});

test('requires deep-category filters for every declared F8X section', () => {
  const value = product();
  value.filters.categories.push('bmw-f8x-engine');
  value.selectionSources.push({
    ...value.selectionSources[0],
    section: 'Engine',
    category: 'Cooling',
    categoryKey: 'cooling',
    sourceUrl: 'https://www.ecstuning.com/BMW-F82-M4-S55_3.0L/Engine/Cooling/',
    relevancePosition: 2
  });
  assert.throws(
    () => validateCanonicalEcsF8xOverlayProduct(value),
    error => error instanceof EcsF8xOverlayContractError
      && error.code === 'invalid_f8x_overlay_product'
  );
  value.filters.subcategories.push('bmw-f8x-engine-cooling');
  assert.doesNotThrow(() => validateCanonicalEcsF8xOverlayProduct(value));
});

test('rejects invented years, drivetrains, options, exact confidence and undated observations', () => {
  for (const mutate of [
    value => { value.fitments[0].yearFrom = 2014; value.fitments[0].yearTo = 2020; },
    value => { value.fitments[0].yearFrom = 2035; value.fitments[0].yearTo = 1900; },
    value => { value.fitments[0].drivetrains = ['AWD']; },
    value => { value.fitments[0].options = ['Competition']; },
    value => { value.fitments[0].confidence = 'exact'; },
    value => { value.fitmentConfidence = 'exact'; },
    value => { value.options = ['Competition']; },
    value => { value.selectionSources[0].observedAt = null; },
    value => { value.checkedAt = '2026-08-19'; }
  ]) rejected(mutate);
});
