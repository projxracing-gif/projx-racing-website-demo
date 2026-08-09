import assert from 'node:assert/strict';
import { createPartsCatalogHandler, __test } from '../api/parts-catalog.js';
import { REVIEWED_ECS_PRODUCTS } from '../server/ecs-reviewed-catalog.js';

const FIXED_NOW = Date.parse('2026-08-09T09:30:00Z');
const REVIEWED_ECS_COUNT = REVIEWED_ECS_PRODUCTS.length;
const TEGIWA_FIXTURE_COUNT = 193_256;
const INTERIOR_PRODUCT_COUNT = 678;
const REPRESENTATIVE_INTERIOR_ECS = 'ES#3010016';
const INTERIOR_PART_TYPE_SLUGS = Object.freeze([
  'gauges', 'seats', 'steering', 'vinyl-wrap', 'center-console', 'safety', 'trim', 'floor-mats',
  'dashboard', 'pedal', 'cellular-phone', 'key-fob', 'trunk', 'shifter', 'tools', 'window',
  'sound-system', 'sun-shade', 'electronic', 'door', 'hood-release', 'lighting', 'storage',
  'convertible', 'headliner', 'mirror', 'sunroof', 'airbag', 'carpet', 'navigation', 'armrest', 'hatch'
]);
const DRIVETRAIN_PART_TYPES = Object.freeze([
  ['drivetrain-tools', 'Drivetrain Tools'],
  ['drivetrain-differential', 'Differential Parts'],
  ['drivetrain-manual-transmission', 'Manual Transmission Parts'],
  ['drivetrain-shifter', 'Shifter Parts'],
  ['drivetrain-automatic-transmission', 'Automatic Transmission Parts'],
  ['drivetrain-axles', 'Axle Parts'],
  ['drivetrain-clutch', 'Clutch Parts'],
  ['drivetrain-mounts', 'Drivetrain Mounts'],
  ['drivetrain-driveshafts', 'Driveshaft Parts'],
  ['drivetrain-wheel-bearings', 'Wheel Bearing Parts'],
  ['drivetrain-skid-plate', 'Skid Plates'],
  ['drivetrain-transfer-case', 'Transfer Case Parts']
]);
const DRIVETRAIN_SENTINEL_ECS = Object.freeze(['ES#602', 'ES#3097303', 'ES#4811032']);
const BRAKING_PART_TYPES = Object.freeze([
  ['braking-tools', 'Brake Tools'],
  ['braking-pads', 'Brake Pads'],
  ['braking-performance', 'Performance Brake Parts'],
  ['braking-fluid', 'Brake Fluids'],
  ['braking-rotors', 'Brake Rotors'],
  ['braking-calipers', 'Brake Calipers'],
  ['braking-compounds', 'Brake Compounds & Lubricants'],
  ['braking-lines', 'Brake Lines'],
  ['braking-big-brakes', 'Big Brake Upgrades'],
  ['braking-service-kits', 'Brake Service Kits'],
  ['braking-electrical', 'Electrical Brake Parts & Components'],
  ['braking-sensors', 'Brake Sensors'],
  ['braking-abs', 'ABS Brake Parts'],
  ['braking-master-cylinder', 'Brake Master Cylinder Parts'],
  ['braking-parking-brake', 'Emergency Parking Brake Parts']
]);
const BRAKING_SENTINEL_ECS = Object.freeze(['ES#4900999', 'ES#4216356', 'ES#4818888']);
const ENGINE_PRODUCT_COUNT = 1_260;
const ENGINE_PART_TYPES = Object.freeze([
  ['engine-performance', 'Performance Engine Parts', 390],
  ['engine-intake', 'Engine Intake Parts', 203],
  ['engine-fuel', 'Engine Fuel Parts', 184],
  ['engine-tools', 'Engine Tools', 167],
  ['engine-electrical', 'Engine Electrical Parts', 159],
  ['engine-mechanical', 'Engine Mechanical Parts', 135],
  ['engine-cooling', 'Engine Cooling Parts', 117],
  ['engine-oil-service', 'Oil Change Service Kits and Accessories', 86],
  ['engine-covers', 'Engine Covers & Accessories', 58],
  ['engine-ignition', 'Engine Ignition Parts', 47],
  ['engine-turbocharger', 'Engine Turbocharger Parts', 47],
  ['engine-gaskets-seals', 'Engine Gaskets & Seals', 38],
  ['engine-filter', 'Engine Filter Parts', 30],
  ['engine-software', 'Engine Chips, Tunes & Software', 33],
  ['engine-drive-belts', 'Engine Drive Belt Parts', 20],
  ['engine-emissions', 'Engine Emission Parts', 21],
  ['engine-pulleys', 'Engine Pulley Parts', 19],
  ['engine-timing', 'Engine Timing Parts', 16],
  ['engine-mount', 'Engine Mount Parts', 7],
  ['engine-vacuum-system', 'Engine Vacuum System Parts', 6],
  ['engine-skid-plate', 'Engine Skid Plate Parts', 5],
  ['engine-fastener-kit', 'Engine Fastener Kit Parts', 1],
  ['engine-supercharger', 'Engine Supercharger Parts', 1]
]);
const ENGINE_SENTINELS = Object.freeze([
  {
    ecsPartNumber: 'ES#4690036', mpn: 'ECA-G-B58-S58-AT', category: 'Engine Fuel Parts',
    childSlug: 'engine-fuel', price: 490, chassis: ['G80', 'G82'], models: ['M3', 'M4']
  },
  {
    ecsPartNumber: 'ES#4876812', mpn: '8321', category: 'Engine Cooling Parts',
    childSlug: 'engine-cooling', price: 485, chassis: ['G80', 'G82', 'G87'], models: ['M3', 'M4', 'M2']
  },
  {
    ecsPartNumber: 'ES#2848320', mpn: '11367614288', category: 'Engine Mechanical Parts',
    childSlug: 'engine-timing', price: 128.68, chassis: ['G80', 'G82', 'G87'], models: ['M3', 'M4', 'M2']
  }
]);
const TOP_LEVEL_INTERIOR_SOURCE = /^https:\/\/www\.ecstuning\.com\/BMW-G(?:87-M2-S58_3\.0L|80-M3_Competition-S58_3\.0L|82-M4_Competition-S58_3\.0L)\/Interior\/[^/?#]+(?:\/\d+)?\/?$/i;
const TOP_LEVEL_BRAKING_SOURCE = /^https:\/\/www\.ecstuning\.com\/BMW-G(?:87-M2-S58_3\.0L|80-M3_Competition-S58_3\.0L|82-M4_Competition-S58_3\.0L)\/Braking\/[^/?#]+(?:\/\d+)?\/?$/i;
const TOP_LEVEL_ENGINE_SOURCE = /^https:\/\/www\.ecstuning\.com\/BMW-G(?:87-M2-S58_3\.0L|80-M3_Competition-S58_3\.0L|82-M4_Competition-S58_3\.0L)\/Engine\/[^/?#]+(?:\/\d+)?\/?$/i;
const reviewedBrandCount = brandSlug => REVIEWED_ECS_PRODUCTS.filter(product => product.brandSlug === brandSlug).length;
const reviewedCategoryCount = categorySlug => REVIEWED_ECS_PRODUCTS.filter(product => [
  product.categorySlug, product.subcategorySlug,
  ...(product.filters?.categories || []), ...(product.filters?.subcategories || [])
].includes(categorySlug)).length;
const reviewedModelCount = model => REVIEWED_ECS_PRODUCTS.filter(product => (product.fitments || []).some(fitment =>
  [fitment.model, ...(fitment.models || [])].some(value => String(value || '').split('/').some(item =>
    item.trim().toLocaleLowerCase('en-US').split(/[^a-z0-9]+/u).includes(model.toLocaleLowerCase('en-US'))
  ))
)).length;

function responseRecorder() {
  return {
    statusCode: 0,
    headers: Object.create(null),
    body: '',
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    end(value = '') { this.body = String(value); }
  };
}

async function invoke(handler, {
  method = 'GET',
  query = {},
  url = '/api/parts-catalog',
  headers = { host: 'preview.projxracing.com', origin: 'https://preview.projxracing.com' }
} = {}) {
  const req = { method, query, headers, url };
  const res = responseRecorder();
  await handler(req, res);
  return { status: res.statusCode, headers: res.headers, body: JSON.parse(res.body || '{}') };
}

async function collectAllItems(handler, query = {}) {
  const items = [];
  let cursor = null;
  for (let page = 0; page < 100; page += 1) {
    const pageQuery = cursor ? { ...query, cursor } : { ...query };
    delete pageQuery.page;
    const response = await invoke(handler, { query: pageQuery });
    assert.equal(response.status, 200);
    items.push(...(response.body.items || []));
    cursor = response.body.nextCursor || null;
    if (!cursor) return { items, lastResponse: response };
  }
  throw new Error('Catalogue pagination did not terminate within 100 pages.');
}

function row(index, overrides = {}) {
  return {
    id: index + 1,
    public_key: `tegiwa-product-${index + 1}`,
    title: `Product ${String(index + 1).padStart(3, '0')}`,
    description: 'A verified supplier product.',
    source_url: `https://www.tegiwa.com/products/product-${index + 1}`,
    supplier_slug: 'tegiwa',
    supplier_name: 'Tegiwa',
    brand_name: 'Tegiwa',
    part_type_name: 'Engine Components',
    image_url: `https://cdn.shopify.com/s/files/product-${index + 1}.jpg`,
    image_width: 1200,
    image_height: 900,
    image_alt: `Product ${index + 1}`,
    skus: [`SKU-${index + 1}`],
    mpns: [`MPN-${index + 1}`],
    price_min: 11250,
    price_max: 13500,
    currency: 'GBP',
    availability_code: 'supplier_stock',
    lead_time: '2-3 working days',
    stock_checked_at: '2026-08-05T08:00:00Z',
    stock_expires_at: '2026-08-12T08:00:00Z',
    fitment_confidence: 'exact',
    total_results: 250,
    ...overrides
  };
}

const stats = {
  catalog_product_count: TEGIWA_FIXTURE_COUNT + REVIEWED_ECS_COUNT,
  available_product_count: 26_360,
  priced_product_count: 26_370,
  sku_product_count: 188_840,
  checked_at: '2026-08-05T08:00:00Z',
  stale_offer_count: 0,
  suppliers: [
    { slug: 'ecs', name: 'ECS Tuning', productCount: REVIEWED_ECS_COUNT },
    { slug: 'tegiwa', name: 'Tegiwa', productCount: TEGIWA_FIXTURE_COUNT }
  ],
  currencies: ['GBP', 'USD']
};

const unpublishedStats = {
  catalog_product_count: 0,
  available_product_count: 0,
  priced_product_count: 0,
  sku_product_count: 0,
  checked_at: null,
  stale_offer_count: 0,
  suppliers: [],
  currencies: []
};

const statements = [];
async function queryAdapter(text, values) {
  statements.push({ text, values });
  if (text.includes('parts-catalog:stats')) return [stats];
  if (text.includes('parts-catalog:count')) return [{ total_results: 250 }];
  if (text.includes('parts-catalog:detail')) {
    return [row(0, {
      public_key: 'ecs-brake-kit',
      supplier_slug: 'ecs', supplier_name: 'ECS Tuning', source_url: 'https://www.ecstuning.com/b-ecs-parts/brake-kit/',
      currency: 'USD', price_min: 49999, price_max: 49999,
      images: [{ src: 'https://c1552172.ssl.cf0.rackcdn.com/123.jpg', width: 1600, height: 1200, alt: 'Brake kit' }],
      variants: [{
        title: 'Front axle', sku: 'ECS-100', mpn: '100', available: true,
        availabilityCode: 'in_stock', price: { currency: 'USD', amount: 49999 }
      }],
      fitments: [{ confidence: 'exact', yearFrom: 2021, yearTo: 2026, make: 'BMW', model: 'M3', generation: 'G80', engine: 'S58' }]
    })];
  }
  if (text.includes('parts-catalog:list')) {
    const offset = Number(values.at(-2));
    const limit = Number(values.at(-1));
    const count = Math.max(0, Math.min(limit, 250 - offset));
    return Array.from({ length: count }, (_, itemIndex) => row(offset + itemIndex));
  }
  throw new Error('unexpected_statement');
}

const handler = createPartsCatalogHandler({ query: queryAdapter, now: () => FIXED_NOW });

const reviewedOnly = createPartsCatalogHandler({
  databaseUrl: '',
  legacyHandler: false,
  now: () => FIXED_NOW
});
const reviewedBrowse = await invoke(reviewedOnly);
assert.equal(reviewedBrowse.status, 200);
assert.equal(reviewedBrowse.body.mode, 'browse');
assert.equal(reviewedBrowse.body.items.length, Math.min(100, REVIEWED_ECS_COUNT));
assert.equal(reviewedBrowse.body.meta.totalResults, REVIEWED_ECS_COUNT);
assert.equal(reviewedBrowse.body.meta.reviewedEcsProductCount, REVIEWED_ECS_COUNT);
assert.equal(reviewedBrowse.body.meta.partialCatalogue, true);
assert.equal(reviewedBrowse.body.meta.catalogueSource, 'reviewed-local-fallback');
assert.deepEqual(reviewedBrowse.body.meta.suppliers, [{ slug: 'ecs', name: 'ECS Tuning' }]);
assert.deepEqual(reviewedBrowse.body.meta.currencies, ['USD']);
assert.ok(reviewedBrowse.body.meta.brands.some(item => item.slug === 'genuine-bmw'));
assert.ok(reviewedBrowse.body.meta.partTypes.some(item => item.slug === 'exterior'));
assert.ok(reviewedBrowse.body.meta.partTypes.some(item => item.slug === 'exterior-body-parts'));
assert.ok(reviewedBrowse.body.meta.partTypes.filter(item => item.slug === 'exterior'
  || item.slug.startsWith('exterior-')
  || ['emblems-badges', 'skid-plate-parts', 'antenna-parts-accessories'].includes(item.slug))
  .every(item => item.nameAr));
const reviewedPartTypesBySlug = new Map(reviewedBrowse.body.meta.partTypes.map(item => [item.slug, item]));
assert.equal(INTERIOR_PART_TYPE_SLUGS.length, 32);
assert.equal(new Set(INTERIOR_PART_TYPE_SLUGS).size, 32);
for (const slug of ['interior', ...INTERIOR_PART_TYPE_SLUGS]) {
  const facet = reviewedPartTypesBySlug.get(slug);
  assert.ok(facet, `Expected the reviewed catalogue to expose the ${slug} Interior facet.`);
  assert.match(facet.nameAr || '', /[\u0600-\u06ff]/u, `Expected the ${slug} Interior facet to have an Arabic name.`);
}
assert.equal(DRIVETRAIN_PART_TYPES.length, 12);
assert.equal(new Set(DRIVETRAIN_PART_TYPES.map(([slug]) => slug)).size, 12);
const drivetrainParentFacet = reviewedPartTypesBySlug.get('g-series-drivetrain');
assert.equal(drivetrainParentFacet?.name, 'G-Series Drivetrain');
assert.match(drivetrainParentFacet?.nameAr || '', /[\u0600-\u06ff]/u);
for (const [slug, name] of DRIVETRAIN_PART_TYPES) {
  const facet = reviewedPartTypesBySlug.get(slug);
  assert.ok(facet, `Expected the reviewed catalogue to expose the ${slug} Drivetrain facet.`);
  assert.equal(facet.name, name);
  assert.match(facet.nameAr || '', /[\u0600-\u06ff]/u,
    `Expected the ${slug} Drivetrain facet to have an Arabic name.`);
}
assert.equal(BRAKING_PART_TYPES.length, 15);
assert.equal(new Set(BRAKING_PART_TYPES.map(([slug]) => slug)).size, 15);
const brakingParentFacet = reviewedPartTypesBySlug.get('g-series-braking');
assert.equal(brakingParentFacet?.name, 'G-Series Braking');
assert.match(brakingParentFacet?.nameAr || '', /[\u0600-\u06ff]/u);
for (const [slug, name] of BRAKING_PART_TYPES) {
  const facet = reviewedPartTypesBySlug.get(slug);
  assert.ok(facet, `Expected the reviewed catalogue to expose the ${slug} Braking facet.`);
  assert.equal(facet.name, name);
  assert.match(facet.nameAr || '', /[\u0600-\u06ff]/u,
    `Expected the ${slug} Braking facet to have an Arabic name.`);
}
assert.equal(ENGINE_PART_TYPES.length, 23);
assert.equal(new Set(ENGINE_PART_TYPES.map(([slug]) => slug)).size, 23);
const engineParentFacet = reviewedPartTypesBySlug.get('g-series-engine');
assert.equal(engineParentFacet?.name, 'G-Series Engine');
assert.match(engineParentFacet?.nameAr || '', /[\u0600-\u06ff]/u);
for (const [slug, name] of ENGINE_PART_TYPES) {
  const facet = reviewedPartTypesBySlug.get(slug);
  assert.ok(facet, `Expected the reviewed catalogue to expose the ${slug} Engine facet.`);
  assert.equal(facet.name, name);
  assert.match(facet.nameAr || '', /[\u0600-\u06ff]/u,
    `Expected the ${slug} Engine facet to have an Arabic name.`);
}
assert.equal(reviewedPartTypesBySlug.has('drivetrain-pdk-transmission'), false,
  'The quarantined PDK taxonomy must never appear as a customer-facing part-type facet.');
assert.equal(reviewedBrowse.body.meta.totalPages, Math.ceil(REVIEWED_ECS_COUNT / 100));
const reviewedAll = await collectAllItems(reviewedOnly);
assert.equal(reviewedAll.items.length, REVIEWED_ECS_COUNT);
assert.equal(new Set(reviewedAll.items.map(item => item.handle)).size, REVIEWED_ECS_COUNT);
assert.equal(new Set(reviewedAll.items.map(item => item.sku)).size, REVIEWED_ECS_COUNT);
assert.ok(reviewedBrowse.body.items.every(item => item.handle.startsWith('ecs-')));
assert.ok(reviewedBrowse.body.items.every(item => item.supplier.slug === 'ecs'));
assert.ok(reviewedBrowse.body.items.every(item => item.price.currency === 'USD'));
assert.ok(reviewedBrowse.body.items.every(item => item.availability.code === 'check_availability'));
assert.ok(reviewedBrowse.body.items.every(item => item.fitmentConfidence === null));

const reviewedInteriorSourceProducts = REVIEWED_ECS_PRODUCTS.filter(product =>
  (product.selectionSources || []).some(source => TOP_LEVEL_INTERIOR_SOURCE.test(String(source?.sourceUrl || '')))
);
assert.equal(reviewedInteriorSourceProducts.length, INTERIOR_PRODUCT_COUNT);
assert.equal(new Set(reviewedInteriorSourceProducts.map(product => product.ecsPartNumber)).size, INTERIOR_PRODUCT_COUNT);
assert.ok(reviewedInteriorSourceProducts.every(product => /^ES#\d{4,12}$/.test(product.ecsPartNumber)));
assert.ok(reviewedInteriorSourceProducts.every(product => product.filters?.categories?.includes('interior')),
  'Every identity generated from the reviewed Interior capture must retain the parent Interior filter.');
assert.ok(reviewedInteriorSourceProducts.every(product => INTERIOR_PART_TYPE_SLUGS.some(slug => [
  product.categorySlug, product.subcategorySlug,
  ...(product.filters?.categories || []), ...(product.filters?.subcategories || [])
].includes(slug))), 'Every reviewed Interior identity must retain an exact child part-type slug.');

const representativeInteriorProduct = reviewedInteriorSourceProducts.find(
  product => product.ecsPartNumber === REPRESENTATIVE_INTERIOR_ECS
);
assert.ok(representativeInteriorProduct, `${REPRESENTATIVE_INTERIOR_ECS} must remain an Interior-only reviewed identity.`);
assert.equal(representativeInteriorProduct.category, 'Interior Gauges');
assert.equal(representativeInteriorProduct.categorySlug, 'gauges');
assert.match(representativeInteriorProduct.categoryAr || '', /[\u0600-\u06ff]/u);
assert.ok(representativeInteriorProduct.filters.categories.includes('interior'));
assert.ok(representativeInteriorProduct.filters.categories.includes('gauges'));
const representativeInteriorSources = representativeInteriorProduct.selectionSources.filter(source =>
  TOP_LEVEL_INTERIOR_SOURCE.test(String(source?.sourceUrl || ''))
);
assert.equal(representativeInteriorSources.length, 3);
assert.equal(representativeInteriorProduct.selectionSources.length, representativeInteriorSources.length,
  `${REPRESENTATIVE_INTERIOR_ECS} must not acquire evidence from a non-Interior catalogue scope.`);
assert.deepEqual(new Set(representativeInteriorSources.map(source => source.category)), new Set(['Interior Gauges']));
assert.deepEqual(new Set(representativeInteriorSources.map(source => source.vehicle)), new Set([
  'BMW G87 M2 S58 3.0L', 'BMW G80 M3 Competition S58 3.0L', 'BMW G82 M4 Competition S58 3.0L'
]));
assert.equal(representativeInteriorProduct.imageStatus, 'supplier-media-verified');
assert.equal(representativeInteriorProduct.imageSourceUrl,
  'https://assets.ecstuning.com/product_library/783594_x300.webp');
assert.match(representativeInteriorProduct.images[0].src,
  /^assets\/products\/ecs\/g-series-interior\/[a-f0-9]{24}\.webp$/);

const reviewedDrivetrainProducts = REVIEWED_ECS_PRODUCTS.filter(product =>
  product.filters?.categories?.includes('g-series-drivetrain')
);
assert.ok(reviewedDrivetrainProducts.length > 0,
  'The reviewed catalogue must include the generated G-Series Drivetrain scope.');
assert.equal(new Set(reviewedDrivetrainProducts.map(product => product.ecsPartNumber)).size,
  reviewedDrivetrainProducts.length);
const recognizedDrivetrainChildren = new Set(DRIVETRAIN_PART_TYPES.map(([slug]) => slug));
assert.ok(reviewedDrivetrainProducts.every(product => [
  product.categorySlug, product.subcategorySlug,
  ...(product.filters?.categories || []), ...(product.filters?.subcategories || [])
].some(slug => recognizedDrivetrainChildren.has(slug))),
'Every reviewed Drivetrain identity must retain an exact child part-type slug.');
for (const ecsPartNumber of DRIVETRAIN_SENTINEL_ECS) {
  const product = REVIEWED_ECS_PRODUCTS.find(item => item.ecsPartNumber === ecsPartNumber);
  assert.ok(product, `${ecsPartNumber} must remain available as a Drivetrain readiness sentinel.`);
  assert.ok(product.filters?.categories?.includes('g-series-drivetrain'));
}
const reviewedBrakingProducts = REVIEWED_ECS_PRODUCTS.filter(product =>
  product.filters?.categories?.includes('g-series-braking')
);
assert.equal(reviewedBrakingProducts.length, 253,
  'The reviewed catalogue must retain all 253 duplicate-safe G-Series Braking identities.');
assert.equal(new Set(reviewedBrakingProducts.map(product => product.ecsPartNumber)).size, 253);
assert.ok(reviewedBrakingProducts.every(product => (product.selectionSources || []).some(source =>
  TOP_LEVEL_BRAKING_SOURCE.test(String(source?.sourceUrl || ''))
)), 'Every reviewed Braking identity must retain exact ECS vehicle-category evidence.');
const recognizedBrakingChildren = new Set(BRAKING_PART_TYPES.map(([slug]) => slug));
assert.ok(reviewedBrakingProducts.every(product => [
  product.categorySlug, product.subcategorySlug,
  ...(product.filters?.categories || []), ...(product.filters?.subcategories || [])
].some(slug => recognizedBrakingChildren.has(slug))),
'Every reviewed Braking identity must retain an exact child part-type slug.');
assert.ok(reviewedBrakingProducts.every(product => product.fitments?.every(fitment =>
  fitment.confidence === 'possible'
)), 'Braking fitment must remain possible-only pending VIN and brake-option confirmation.');
assert.ok(reviewedBrakingProducts.every(product => product.availabilityCode === 'check_availability'),
  'Dated ECS availability observations must never become a live-stock promise.');
for (const ecsPartNumber of BRAKING_SENTINEL_ECS) {
  const product = REVIEWED_ECS_PRODUCTS.find(item => item.ecsPartNumber === ecsPartNumber);
  assert.ok(product, `${ecsPartNumber} must remain available as a Braking readiness sentinel.`);
  assert.ok(product.filters?.categories?.includes('g-series-braking'));
  assert.equal(product.imageStatus, 'supplier-media-verified');
}
const reviewedEngineProducts = REVIEWED_ECS_PRODUCTS.filter(product =>
  product.filters?.categories?.includes('g-series-engine')
);
assert.equal(reviewedEngineProducts.length, ENGINE_PRODUCT_COUNT,
  'The reviewed catalogue must retain all 1,260 duplicate-safe G-Series Engine identities.');
assert.equal(new Set(reviewedEngineProducts.map(product => product.ecsPartNumber)).size, ENGINE_PRODUCT_COUNT);
assert.ok(reviewedEngineProducts.every(product => (product.selectionSources || []).some(source =>
  TOP_LEVEL_ENGINE_SOURCE.test(String(source?.sourceUrl || ''))
)), 'Every reviewed Engine identity must retain exact ECS vehicle-category evidence.');
const recognizedEngineChildren = new Set(ENGINE_PART_TYPES.map(([slug]) => slug));
assert.ok(reviewedEngineProducts.every(product => [
  product.categorySlug, product.subcategorySlug,
  ...(product.filters?.categories || []), ...(product.filters?.subcategories || [])
].some(slug => recognizedEngineChildren.has(slug))),
'Every reviewed Engine identity must retain an exact child part-type slug.');
assert.ok(reviewedEngineProducts.every(product => product.fitments?.length > 0
  && product.fitments.every(fitment => fitment.confidence === 'possible')),
'Engine fitment must remain possible-only pending VIN, model-year, drivetrain and option confirmation.');
assert.ok(reviewedEngineProducts.every(product => product.availabilityCode === 'check_availability'
  && product.filters?.availability?.includes('confirmation-required')),
'Dated ECS availability observations must remain confirmation-required rather than becoming live-stock promises.');
for (const { ecsPartNumber, childSlug } of ENGINE_SENTINELS) {
  const product = REVIEWED_ECS_PRODUCTS.find(item => item.ecsPartNumber === ecsPartNumber);
  assert.ok(product, `${ecsPartNumber} must remain available as an Engine readiness sentinel.`);
  assert.ok(product.filters?.categories?.includes('g-series-engine'));
  assert.ok(product.filters?.categories?.includes(childSlug));
  assert.equal(product.imageStatus, 'supplier-media-verified');
  assert.match(product.images[0].src,
    /^assets\/products\/ecs\/g-series-engine\/[a-f0-9]{24}\.webp$/);
}
assert.equal(REVIEWED_ECS_PRODUCTS.some(product => product.ecsPartNumber === 'ES#2019435'), false,
  'The quarantined PDK identity must not enter the merged reviewed catalogue.');

const staleReviewedOnly = createPartsCatalogHandler({
  databaseUrl: '', legacyHandler: false, now: () => Date.parse('2026-08-18T00:00:00Z')
});
const staleReviewedBrowse = await invoke(staleReviewedOnly);
assert.ok(staleReviewedBrowse.body.items.every(item => item.price.min === null));
assert.ok(staleReviewedBrowse.body.items.every(item => item.price.note === 'Contact us for current price'));
assert.ok(staleReviewedBrowse.body.items.every(item => item.availability.snapshotStale));
assert.ok(staleReviewedBrowse.body.items.every(item => !/in stock|ships from supplier/i.test(item.availability.leadTime)));

const reviewedIdentifierSearch = await invoke(reviewedOnly, { query: { q: 'ES#3987599', supplier: 'ecs' } });
assert.equal(reviewedIdentifierSearch.status, 200);
assert.equal(reviewedIdentifierSearch.body.items.length, 1);
assert.equal(reviewedIdentifierSearch.body.items[0].handle, 'ecs-high-performance-heat-exchanger-polished');
assert.equal(reviewedIdentifierSearch.body.items[0].sku, 'ES#3987599');

const reviewedClampSearch = await invoke(reviewedOnly, { query: { q: '034-105-D300', supplier: 'ecs' } });
assert.equal(reviewedClampSearch.status, 200);
assert.equal(reviewedClampSearch.body.items.length, 1);
assert.equal(reviewedClampSearch.body.items[0].handle, 'ecs-034motorsport-55mm-exhaust-clamp');
assert.equal(reviewedClampSearch.body.items[0].sku, 'ES#4877039');
assert.equal(reviewedClampSearch.body.items[0].mpn, '034-105-D300');
assert.equal(reviewedClampSearch.body.items[0].price.min, 33);
assert.match(reviewedClampSearch.body.items[0].image.src, /034motorsport-55mm-exhaust-clamp\.jpg$/);

const reviewedClampDetail = await invoke(reviewedOnly, {
  query: { handle: 'ecs-034motorsport-55mm-exhaust-clamp', supplier: 'ecs', currency: 'USD' }
});
assert.equal(reviewedClampDetail.status, 200);
assert.equal(reviewedClampDetail.body.product.images.length, 3);
assert.equal(reviewedClampDetail.body.product.fitments.length, 2);
assert.ok(reviewedClampDetail.body.product.images.every(image => image.src.endsWith('.jpg')));
assert.equal(reviewedClampDetail.body.product.specifications.length, 3);
assert.equal(reviewedClampDetail.body.product.dataQuality.detailedDescriptionAvailable, true);
assert.equal(reviewedClampDetail.body.product.dataQuality.specificationsAvailable, true);
assert.match(reviewedClampDetail.body.product.titleAr, /مشبك عادم/);
assert.match(reviewedClampDetail.body.product.descriptionAr, /الستانلس ستيل/);
assert.ok(reviewedClampDetail.body.product.images.every(image => image.altAr));
assert.match(reviewedClampDetail.body.product.availability.leadTimeAr, /تأكيد التوفر/);
assert.ok(reviewedClampDetail.body.product.fitments.every(fitment => fitment.noteAr));

const reviewedF8xSearch = await invoke(reviewedOnly, { query: { q: '055023LA02', supplier: 'ecs' } });
assert.equal(reviewedF8xSearch.status, 200);
assert.equal(reviewedF8xSearch.body.items.length, 1);
assert.equal(reviewedF8xSearch.body.items[0].handle, 'ecs-f8x-s55-luft-technik-intake');
assert.equal(reviewedF8xSearch.body.items[0].sku, 'ES#4877104');
assert.equal(reviewedF8xSearch.body.items[0].mpn, '055023LA02');
assert.equal(reviewedF8xSearch.body.items[0].price.min, 442.79);
assert.match(reviewedF8xSearch.body.items[0].image.src, /f8x-s55-luft-technik-intake\.jpg$/);

const reviewedF8xDetail = await invoke(reviewedOnly, {
  query: { handle: 'ecs-f8x-s55-luft-technik-intake', supplier: 'ecs', currency: 'USD' }
});
assert.equal(reviewedF8xDetail.status, 200);
assert.deepEqual(new Set(reviewedF8xDetail.body.product.fitments.flatMap(fitment => fitment.chassis)), new Set(['F80', 'F82']));
assert.ok(reviewedF8xDetail.body.product.fitments.every(fitment => fitment.engine === 'S55'));
assert.ok(reviewedF8xDetail.body.product.titleAr);
assert.ok(reviewedF8xDetail.body.product.images.every(image => image.altAr));

const reviewedG8xSearch = await invoke(reviewedOnly, { query: { q: 'EVE-G8XMV2-CF-IN', supplier: 'ecs' } });
assert.equal(reviewedG8xSearch.status, 200);
assert.equal(reviewedG8xSearch.body.items.length, 1);
assert.equal(reviewedG8xSearch.body.items[0].handle, 'ecs-eventuri-g8x-carbon-intake-v2-gloss');
assert.equal(reviewedG8xSearch.body.items[0].sku, 'ES#4716362');
assert.equal(reviewedG8xSearch.body.items[0].price.min, 2995);
assert.match(reviewedG8xSearch.body.items[0].image.src, /eventuri-g8x-carbon-intake-v2-gloss\.jpg$/);

const reviewedG8xDetail = await invoke(reviewedOnly, {
  query: { handle: 'ecs-eventuri-g8x-carbon-intake-v2-gloss', supplier: 'ecs', currency: 'USD' }
});
assert.equal(reviewedG8xDetail.status, 200);
assert.deepEqual(new Set(reviewedG8xDetail.body.product.fitments.flatMap(fitment => fitment.chassis)), new Set(['G80', 'G82', 'G87']));
assert.ok(reviewedG8xDetail.body.product.fitments.every(fitment => fitment.engine === 'S58'));
assert.equal(reviewedG8xDetail.body.product.availability.checkedAt, '2026-08-09');
assert.ok(reviewedG8xDetail.body.product.descriptionAr);

const reviewedBrandFilter = await invoke(reviewedOnly, { query: { brand: 'csf-cooling' } });
assert.equal(reviewedBrandFilter.status, 200);
assert.equal(reviewedBrandFilter.body.meta.totalResults, reviewedBrandCount('csf-cooling'));
assert.ok(reviewedBrandFilter.body.items.every(item => item.vendor === 'CSF Cooling'));

const reviewedCategoryFilter = await invoke(reviewedOnly, { query: { partType: 'cooling' } });
assert.equal(reviewedCategoryFilter.status, 200);
assert.equal(reviewedCategoryFilter.body.meta.totalResults, reviewedCategoryCount('cooling'));
assert.ok(reviewedCategoryFilter.body.items.every(item => item.category.startsWith('Cooling')));

const reviewedExteriorFilter = await invoke(reviewedOnly, { query: { partType: 'exterior' } });
assert.equal(reviewedExteriorFilter.status, 200);
assert.equal(reviewedExteriorFilter.body.meta.totalResults, 782);
assert.equal(reviewedExteriorFilter.body.meta.totalResults, reviewedCategoryCount('exterior'));
const reviewedExteriorBodyFilter = await invoke(reviewedOnly, { query: { partType: 'exterior-body-parts' } });
assert.equal(reviewedExteriorBodyFilter.status, 200);
assert.equal(reviewedExteriorBodyFilter.body.meta.totalResults, 580);
assert.equal(reviewedExteriorBodyFilter.body.meta.totalResults, reviewedCategoryCount('exterior-body-parts'));

const reviewedInteriorFilter = await invoke(reviewedOnly, { query: { partType: 'interior' } });
assert.equal(reviewedInteriorFilter.status, 200);
assert.equal(reviewedInteriorFilter.body.meta.totalResults, INTERIOR_PRODUCT_COUNT);
assert.equal(reviewedInteriorFilter.body.meta.totalResults, reviewedCategoryCount('interior'));
const reviewedInteriorItems = await collectAllItems(reviewedOnly, { partType: 'interior' });
assert.equal(reviewedInteriorItems.items.length, INTERIOR_PRODUCT_COUNT);
assert.equal(new Set(reviewedInteriorItems.items.map(item => item.handle)).size, INTERIOR_PRODUCT_COUNT);
assert.equal(new Set(reviewedInteriorItems.items.map(item => item.sku)).size, INTERIOR_PRODUCT_COUNT);

const reviewedDrivetrainFilter = await invoke(reviewedOnly, { query: { partType: 'g-series-drivetrain' } });
assert.equal(reviewedDrivetrainFilter.status, 200);
assert.ok(reviewedDrivetrainFilter.body.meta.totalResults > 0);
assert.equal(reviewedDrivetrainFilter.body.meta.totalResults, reviewedCategoryCount('g-series-drivetrain'));
const reviewedDrivetrainItems = await collectAllItems(reviewedOnly, { partType: 'g-series-drivetrain' });
assert.equal(reviewedDrivetrainItems.items.length, reviewedDrivetrainFilter.body.meta.totalResults);
assert.equal(new Set(reviewedDrivetrainItems.items.map(item => item.handle)).size,
  reviewedDrivetrainItems.items.length);
const quarantinedPdkSearch = await invoke(reviewedOnly, { query: { q: 'ES#2019435', supplier: 'ecs' } });
assert.equal(quarantinedPdkSearch.status, 200);
assert.equal(quarantinedPdkSearch.body.meta.totalResults, 0);
assert.equal(quarantinedPdkSearch.body.items.length, 0);
for (const [slug] of DRIVETRAIN_PART_TYPES) {
  const expectedCount = reviewedCategoryCount(slug);
  assert.ok(expectedCount > 0, `Expected reviewed Drivetrain products in ${slug}.`);
  const filtered = await invoke(reviewedOnly, { query: { partType: slug } });
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.meta.totalResults, expectedCount);
}
const reviewedBrakingFilter = await invoke(reviewedOnly, { query: { partType: 'g-series-braking' } });
assert.equal(reviewedBrakingFilter.status, 200);
assert.equal(reviewedBrakingFilter.body.meta.totalResults, 253);
assert.equal(reviewedBrakingFilter.body.meta.totalResults, reviewedCategoryCount('g-series-braking'));
const reviewedBrakingItems = await collectAllItems(reviewedOnly, { partType: 'g-series-braking' });
assert.equal(reviewedBrakingItems.items.length, 253);
assert.equal(new Set(reviewedBrakingItems.items.map(item => item.handle)).size, 253);
assert.equal(new Set(reviewedBrakingItems.items.map(item => item.sku)).size, 253);
assert.ok(reviewedBrakingItems.items.every(item => item.availability.code === 'check_availability'));
for (const [slug] of BRAKING_PART_TYPES) {
  const expectedCount = reviewedCategoryCount(slug);
  assert.ok(expectedCount > 0, `Expected reviewed Braking products in ${slug}.`);
  const filtered = await invoke(reviewedOnly, { query: { partType: slug } });
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.meta.totalResults, expectedCount);
}

const reviewedEngineFilter = await invoke(reviewedOnly, { query: { partType: 'g-series-engine' } });
assert.equal(reviewedEngineFilter.status, 200);
assert.equal(reviewedEngineFilter.body.meta.totalResults, ENGINE_PRODUCT_COUNT);
assert.equal(reviewedEngineFilter.body.meta.totalResults, reviewedCategoryCount('g-series-engine'));
assert.equal(reviewedEngineFilter.body.meta.totalPages, 13);
const reviewedEngineItems = await collectAllItems(reviewedOnly, { partType: 'g-series-engine' });
assert.equal(reviewedEngineItems.items.length, ENGINE_PRODUCT_COUNT);
assert.equal(new Set(reviewedEngineItems.items.map(item => item.handle)).size, ENGINE_PRODUCT_COUNT);
assert.equal(new Set(reviewedEngineItems.items.map(item => item.sku)).size, ENGINE_PRODUCT_COUNT);
assert.equal(reviewedEngineItems.lastResponse.body.meta.page, 13);
assert.equal(reviewedEngineItems.lastResponse.body.items.length, 60);
assert.ok(reviewedEngineItems.items.every(item => item.availability.code === 'check_availability'));
for (const [slug, , exactCount] of ENGINE_PART_TYPES) {
  assert.equal(reviewedCategoryCount(slug), exactCount,
    `Expected the generated ${slug} Engine facet to retain exactly ${exactCount} identities.`);
  const filtered = await invoke(reviewedOnly, { query: { partType: slug } });
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.meta.totalResults, exactCount);
  assert.equal(filtered.body.meta.totalPages, Math.ceil(exactCount / 100));
  const filteredItems = await collectAllItems(reviewedOnly, { partType: slug });
  assert.equal(filteredItems.items.length, exactCount);
  assert.equal(new Set(filteredItems.items.map(item => item.handle)).size, exactCount);
  assert.equal(new Set(filteredItems.items.map(item => item.sku)).size, exactCount);
}

const reviewedBrakingIdentifierSearch = await invoke(reviewedOnly, {
  query: { q: 'ES#4900999', supplier: 'ecs' }
});
assert.equal(reviewedBrakingIdentifierSearch.status, 200);
assert.equal(reviewedBrakingIdentifierSearch.body.items.length, 1);
assert.equal(reviewedBrakingIdentifierSearch.body.items[0].handle, 'ecs-es-4900999');
assert.equal(reviewedBrakingIdentifierSearch.body.items[0].sku, 'ES#4900999');
assert.equal(reviewedBrakingIdentifierSearch.body.items[0].mpn, '34525A16AC6');
assert.equal(reviewedBrakingIdentifierSearch.body.items[0].category, 'ABS Brake Parts');
assert.equal(reviewedBrakingIdentifierSearch.body.items[0].fitmentConfidence, null);
assert.equal(reviewedBrakingIdentifierSearch.body.items[0].availability.code, 'check_availability');
assert.equal(reviewedBrakingIdentifierSearch.body.items[0].image.status, 'supplier-media-verified');
assert.match(reviewedBrakingIdentifierSearch.body.items[0].image.src,
  /^\/assets\/products\/ecs\/g-series-braking\/[a-f0-9]{24}\.webp$/);

const reviewedBrakingDetail = await invoke(reviewedOnly, {
  query: { handle: 'ecs-es-4900999', supplier: 'ecs', currency: 'USD' }
});
assert.equal(reviewedBrakingDetail.status, 200);
assert.equal(reviewedBrakingDetail.body.product.sku, 'ES#4900999');
assert.equal(reviewedBrakingDetail.body.product.mpn, '34525A16AC6');
assert.equal(reviewedBrakingDetail.body.product.category, 'ABS Brake Parts');
assert.deepEqual(new Set(reviewedBrakingDetail.body.product.fitments.flatMap(fitment => fitment.chassis)),
  new Set(['G80', 'G82']));
assert.deepEqual(new Set(reviewedBrakingDetail.body.product.fitments.map(fitment => fitment.model)),
  new Set(['M3', 'M4']));
assert.ok(reviewedBrakingDetail.body.product.fitments.every(fitment => fitment.confidence === 'possible'));
assert.ok(reviewedBrakingDetail.body.product.fitments.every(fitment => fitment.engine === 'S58'));
assert.ok(reviewedBrakingDetail.body.product.fitments.every(fitment => /confirm/i.test(fitment.note)));

for (const sentinel of ENGINE_SENTINELS) {
  const identifierSearch = await invoke(reviewedOnly, {
    query: { q: sentinel.ecsPartNumber, supplier: 'ecs' }
  });
  assert.equal(identifierSearch.status, 200);
  assert.equal(identifierSearch.body.meta.totalResults, 1);
  assert.equal(identifierSearch.body.items.length, 1);
  assert.equal(identifierSearch.body.items[0].handle,
    `ecs-${sentinel.ecsPartNumber.toLocaleLowerCase('en-US').replace('#', '-')}`);
  assert.equal(identifierSearch.body.items[0].sku, sentinel.ecsPartNumber);
  assert.equal(identifierSearch.body.items[0].mpn, sentinel.mpn);
  assert.equal(identifierSearch.body.items[0].category, sentinel.category);
  assert.equal(identifierSearch.body.items[0].fitmentConfidence, null);
  assert.equal(identifierSearch.body.items[0].availability.code, 'check_availability');
  assert.equal(identifierSearch.body.items[0].price.min, sentinel.price);
  assert.equal(identifierSearch.body.items[0].image.status, 'supplier-media-verified');
  assert.match(identifierSearch.body.items[0].image.src,
    /^\/assets\/products\/ecs\/g-series-engine\/[a-f0-9]{24}\.webp$/);

  const mpnSearch = await invoke(reviewedOnly, { query: { q: sentinel.mpn, supplier: 'ecs' } });
  assert.equal(mpnSearch.status, 200);
  assert.ok(mpnSearch.body.meta.totalResults >= 1);
  assert.ok(mpnSearch.body.items.some(item => item.sku === sentinel.ecsPartNumber),
    `${sentinel.ecsPartNumber} must remain discoverable by manufacturer part number ${sentinel.mpn}.`);

  const childFilterSearch = await invoke(reviewedOnly, {
    query: { q: sentinel.ecsPartNumber, supplier: 'ecs', partType: sentinel.childSlug }
  });
  assert.equal(childFilterSearch.status, 200);
  assert.equal(childFilterSearch.body.meta.totalResults, 1,
    `${sentinel.ecsPartNumber} must remain discoverable through ${sentinel.childSlug}.`);
  assert.equal(childFilterSearch.body.items[0].sku, sentinel.ecsPartNumber);

  const detail = await invoke(reviewedOnly, {
    query: { handle: identifierSearch.body.items[0].handle, supplier: 'ecs', currency: 'USD' }
  });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.product.sku, sentinel.ecsPartNumber);
  assert.equal(detail.body.product.mpn, sentinel.mpn);
  assert.equal(detail.body.product.category, sentinel.category);
  assert.equal(detail.body.product.price.min, sentinel.price);
  assert.equal(detail.body.product.availability.code, 'check_availability');
  assert.match(detail.body.product.availability.leadTime, /require confirmation/i);
  assert.equal(detail.body.product.image.status, 'supplier-media-verified');
  assert.ok(detail.body.product.images.length > 0);
  assert.ok(detail.body.product.images.every(image => image.status === 'supplier-media-verified'));
  assert.match(detail.body.product.image.src,
    /^\/assets\/products\/ecs\/g-series-engine\/[a-f0-9]{24}\.webp$/);
  assert.deepEqual(new Set(detail.body.product.fitments.flatMap(fitment => fitment.chassis)),
    new Set(sentinel.chassis));
  assert.deepEqual(new Set(detail.body.product.fitments.map(fitment => fitment.model)),
    new Set(sentinel.models));
  assert.ok(detail.body.product.fitments.every(fitment => fitment.confidence === 'possible'));
  assert.ok(detail.body.product.fitments.every(fitment => fitment.engine === 'S58'));
  assert.ok(detail.body.product.fitments.every(fitment => /confirm/i.test(fitment.note)));
  assert.equal(detail.body.product.dataQuality.exactFitmentAvailable, false);
  assert.equal(detail.body.product.dataQuality.stockFeedAvailable, false);
}

const reviewedInteriorIdentifierSearch = await invoke(reviewedOnly, {
  query: { q: REPRESENTATIVE_INTERIOR_ECS, supplier: 'ecs' }
});
assert.equal(reviewedInteriorIdentifierSearch.status, 200);
assert.equal(reviewedInteriorIdentifierSearch.body.items.length, 1);
assert.equal(reviewedInteriorIdentifierSearch.body.items[0].handle, 'ecs-es-3010016');
assert.equal(reviewedInteriorIdentifierSearch.body.items[0].sku, REPRESENTATIVE_INTERIOR_ECS);
assert.equal(reviewedInteriorIdentifierSearch.body.items[0].mpn, '216EVOWGBO.PSI');
assert.equal(reviewedInteriorIdentifierSearch.body.items[0].category, 'Interior Gauges');
assert.equal(reviewedInteriorIdentifierSearch.body.items[0].fitmentConfidence, null);
assert.equal(reviewedInteriorIdentifierSearch.body.items[0].availability.code, 'check_availability');
assert.equal(reviewedInteriorIdentifierSearch.body.items[0].image.status, 'supplier-media-verified');
assert.match(reviewedInteriorIdentifierSearch.body.items[0].image.src,
  /^\/assets\/products\/ecs\/g-series-interior\/[a-f0-9]{24}\.webp$/);

const reviewedInteriorDetail = await invoke(reviewedOnly, {
  query: { handle: 'ecs-es-3010016', supplier: 'ecs', currency: 'USD' }
});
assert.equal(reviewedInteriorDetail.status, 200);
assert.equal(reviewedInteriorDetail.body.product.sku, REPRESENTATIVE_INTERIOR_ECS);
assert.equal(reviewedInteriorDetail.body.product.mpn, '216EVOWGBO.PSI');
assert.equal(reviewedInteriorDetail.body.product.category, 'Interior Gauges');
assert.deepEqual(new Set(reviewedInteriorDetail.body.product.fitments.flatMap(fitment => fitment.chassis)),
  new Set(['G87', 'G80', 'G82']));
assert.deepEqual(new Set(reviewedInteriorDetail.body.product.fitments.map(fitment => fitment.model)),
  new Set(['M2', 'M3', 'M4']));
assert.ok(reviewedInteriorDetail.body.product.fitments.every(fitment => fitment.confidence === 'possible'));
assert.ok(reviewedInteriorDetail.body.product.fitments.every(fitment => fitment.engine === 'S58'));
assert.ok(reviewedInteriorDetail.body.product.fitments.every(fitment => /confirm/i.test(fitment.note)));
assert.equal(reviewedInteriorDetail.body.product.image.status, 'supplier-media-verified');
assert.ok(reviewedInteriorDetail.body.product.images.every(image => image.status === 'supplier-media-verified'));
assert.equal(reviewedInteriorDetail.body.product.availability.code, 'check_availability');
assert.match(reviewedInteriorDetail.body.product.availability.leadTime, /supplier listing observed/i);
assert.match(reviewedInteriorDetail.body.product.availability.leadTime, /require confirmation/i);
assert.doesNotMatch(reviewedInteriorDetail.body.product.availability.leadTime, /available now|live stock/i);
assert.equal(reviewedInteriorDetail.body.product.dataQuality.exactFitmentAvailable, false);
assert.equal(reviewedInteriorDetail.body.product.dataQuality.stockFeedAvailable, false);

const reviewedInteriorPossibleFitment = await invoke(reviewedOnly, {
  query: {
    q: REPRESENTATIVE_INTERIOR_ECS, fitment: 'possible', make: 'BMW', model: 'M2', generation: 'G87', engine: 'S58'
  }
});
assert.equal(reviewedInteriorPossibleFitment.body.meta.totalResults, 1);
assert.equal(reviewedInteriorPossibleFitment.body.items[0].fitmentConfidence, 'possible');
assert.equal((await invoke(reviewedOnly, {
  query: { q: REPRESENTATIVE_INTERIOR_ECS, fitment: 'exact', make: 'BMW', model: 'M2', generation: 'G87' }
})).body.meta.totalResults, 0);
assert.equal((await invoke(reviewedOnly, {
  query: { q: REPRESENTATIVE_INTERIOR_ECS, availability: 'in_stock' }
})).body.meta.totalResults, 0);

const reviewedPossibleFitment = await invoke(reviewedOnly, {
  query: { fitment: 'possible', make: 'BMW', model: 'M3' }
});
assert.equal(reviewedPossibleFitment.status, 200);
assert.equal(reviewedPossibleFitment.body.meta.totalResults, reviewedModelCount('M3'));
assert.ok(reviewedPossibleFitment.body.items.every(item => item.fitmentConfidence === 'possible'));
const reviewedM2Fitment = await invoke(reviewedOnly, {
  query: { fitment: 'possible', make: 'BMW', model: 'M2' }
});
assert.equal(reviewedM2Fitment.body.meta.totalResults, reviewedModelCount('M2'));
assert.ok(reviewedM2Fitment.body.items.every(item => !/m240/i.test(item.title)));
const reviewedF80Vehicle = await invoke(reviewedOnly, {
  query: { fitment: 'possible', make: 'BMW', model: 'M3', generation: 'F80', year: '2017' }
});
assert.ok(reviewedF80Vehicle.body.meta.totalResults >= 8);
assert.ok(reviewedF80Vehicle.body.items.every(item => item.fitmentConfidence === 'possible'));
const reviewedF82Vehicle = await invoke(reviewedOnly, {
  query: { fitment: 'possible', make: 'BMW', model: 'M4', generation: 'F82', year: '2018' }
});
assert.ok(reviewedF82Vehicle.body.meta.totalResults >= 8);
const reviewedG80Vehicle = await invoke(reviewedOnly, {
  query: { fitment: 'possible', make: 'BMW', model: 'M3', generation: 'G80', year: '2023' }
});
assert.ok(reviewedG80Vehicle.body.meta.totalResults >= 10);
const reviewedG82Vehicle = await invoke(reviewedOnly, {
  query: { fitment: 'possible', make: 'BMW', model: 'M4', generation: 'G82', year: '2023' }
});
assert.ok(reviewedG82Vehicle.body.meta.totalResults >= 10);
const containsVehicleToken = (values, token) => values.flatMap(value => String(value || '').split(/[^a-z0-9]+/iu))
  .some(value => value.toLocaleLowerCase('en-US') === token.toLocaleLowerCase('en-US'));
const expectedG87Count = REVIEWED_ECS_PRODUCTS.filter(product => (product.fitments || []).some(fitment =>
  containsVehicleToken([fitment.model, ...(fitment.models || [])], 'M2')
  && containsVehicleToken([fitment.generation, ...(fitment.chassis || [])], 'G87')
  && containsVehicleToken(fitment.engines || [], 'S58')
)).length;
const reviewedG87Vehicle = await invoke(reviewedOnly, {
  query: { fitment: 'possible', make: 'BMW', model: 'M2', generation: 'G87', engine: 'S58', year: '2024' }
});
assert.equal(reviewedG87Vehicle.body.meta.totalResults, expectedG87Count);
assert.ok(expectedG87Count >= 790);
assert.ok(reviewedG87Vehicle.body.items.every(item => item.fitmentConfidence === 'possible'));

const placeholderProduct = REVIEWED_ECS_PRODUCTS.find(product => product.imageStatus === 'supplier-media-unavailable');
assert.ok(placeholderProduct);
const placeholderDetail = await invoke(reviewedOnly, {
  query: { handle: placeholderProduct.publicKey, supplier: 'ecs', currency: 'USD' }
});
assert.equal(placeholderDetail.body.product.image.status, 'supplier-media-unavailable');
assert.equal(placeholderDetail.body.product.images[0].status, 'supplier-media-unavailable');

const startingPriceProduct = REVIEWED_ECS_PRODUCTS.find(product => product.priceStartingAt && product.priceAmount > 0);
assert.ok(startingPriceProduct);
const startingPriceDetail = await invoke(reviewedOnly, {
  query: { handle: startingPriceProduct.publicKey, supplier: 'ecs', currency: 'USD' }
});
assert.equal(startingPriceDetail.body.product.price.startingAt, true);
assert.equal(startingPriceDetail.body.product.price.min, startingPriceProduct.priceAmount);
assert.equal((await invoke(reviewedOnly, {
  query: { fitment: 'exact', make: 'BMW', model: 'M3' }
})).body.meta.totalResults, 0);
assert.equal((await invoke(reviewedOnly, { query: { availability: 'in_stock' } })).body.meta.totalResults, 0);
assert.equal((await invoke(reviewedOnly, { query: { availability: 'check' } })).body.meta.totalResults, REVIEWED_ECS_COUNT);

const reviewedDetail = await invoke(reviewedOnly, {
  query: { handle: 'ecs-porsche-718-high-flow-catted-downpipe', supplier: 'ecs', currency: 'USD' }
});
assert.equal(reviewedDetail.status, 200);
assert.equal(reviewedDetail.body.product.sku, 'ES#4858335');
assert.equal(reviewedDetail.body.product.mpn, '987.10.00.750');
assert.equal(reviewedDetail.body.product.fitments[0].confidence, 'possible');
assert.equal(reviewedDetail.body.product.fitments[0].yearFrom, 2017);
assert.equal(reviewedDetail.body.product.fitments[0].yearTo, 2021);
assert.equal(reviewedDetail.body.product.dataQuality.exactFitmentAvailable, false);
assert.equal(reviewedDetail.body.product.dataQuality.stockFeedAvailable, false);
assert.ok(reviewedDetail.body.product.relatedProducts.length > 0);
assert.match(reviewedDetail.body.product.image.src, /^\/assets\/products\/ecs\//);

const reviewedSuggestions = await invoke(reviewedOnly, { query: { q: 'heat exchanger', suggest: '1' } });
assert.equal(reviewedSuggestions.status, 200);
assert.ok(reviewedSuggestions.body.suggestions.length >= 2);
assert.ok(reviewedSuggestions.body.suggestions.every(item => item.supplier.slug === 'ecs'));

const reviewedTypoSearch = await invoke(reviewedOnly, { query: { q: 'flex feul analizer', supplier: 'ecs' } });
assert.equal(reviewedTypoSearch.status, 200);
assert.equal(reviewedTypoSearch.body.meta.corrected, true);
assert.equal(reviewedTypoSearch.body.meta.canonicalQuery, 'flex fuel analyzer');
assert.ok(reviewedTypoSearch.body.items.some(item => item.sku === 'ES#4690036'));

const reviewedTypoSuggestions = await invoke(reviewedOnly, {
  query: { q: 'flex feul analizer', suggest: '1', supplier: 'ecs' }
});
assert.equal(reviewedTypoSuggestions.status, 200);
assert.equal(reviewedTypoSuggestions.body.correction.corrected, true);
assert.equal(reviewedTypoSuggestions.body.correction.canonicalQuery, 'flex fuel analyzer');
assert.ok(reviewedTypoSuggestions.body.suggestions.some(item => item.handle === 'ecs-es-4690036'));
assert.ok(reviewedTypoSuggestions.body.suggestions.every(item => item.brand && item.category && item.sku && item.image));

const reviewedArabicBrakeSearch = await invoke(reviewedOnly, {
  query: { q: '\u0641\u062d\u0645\u0627\u062a \u0641\u0631\u0627\u0645\u0644', supplier: 'ecs' }
});
assert.equal(reviewedArabicBrakeSearch.status, 200);
assert.equal(reviewedArabicBrakeSearch.body.meta.translated, true);
assert.equal(reviewedArabicBrakeSearch.body.meta.canonicalQuery, 'brake pad');
assert.ok(reviewedArabicBrakeSearch.body.items.length > 0);
assert.ok(reviewedArabicBrakeSearch.body.items.every(item => /brake|pad/i.test(`${item.title} ${item.category}`)));

const legacyFallbackRequests = [];
async function legacyFallbackHandler(req, res) {
  legacyFallbackRequests.push({ ...(req.query || {}) });
  const page = Number(req.query?.page || 1);
  const start = (page - 1) * 100;
  const all = Array.from({ length: 250 }, (_, index) => ({
    handle: `legacy-${index + 1}`,
    title: `Legacy Tegiwa Product ${index + 1}`,
    vendor: 'Tegiwa',
    category: 'Engine Components',
    sku: `LEGACY-${index + 1}`,
    skuCount: 1,
    skuState: 'exact',
    mpn: null,
    price: { currency: 'GBP', min: 100 + index, max: 100 + index },
    availability: { code: 'supplier_stock', checkedAt: '2026-08-05', leadTime: 'Confirm before order', snapshotStale: false },
    image: { src: `https://cdn.example.test/${index + 1}.jpg`, width: 800, height: 600, alt: `Product ${index + 1}` }
  }));
  let body;
  if (req.query?.suggest === '1') {
    body = {
      mode: 'suggest',
      suggestions: all.slice(0, 8).map(item => ({ query: item.title, label: item.title, kind: 'product', handle: item.handle })),
      meta: { count: 8, limit: 8 }
    };
  } else if (req.query?.handle) {
    const item = all.find(candidate => candidate.handle === req.query.handle);
    if (!item) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: { code: 'product_not_found', message: 'Missing' } }));
    }
    body = { mode: 'detail', product: { ...item, images: [item.image], variants: [], fitments: [] }, meta: { count: 1 } };
  } else {
    body = {
      mode: req.query?.q ? 'search' : 'browse',
      items: all.slice(start, start + 100),
      meta: {
        count: Math.min(100, Math.max(0, 250 - start)),
        page,
        pageSize: 100,
        totalResults: 250,
        totalPages: 3,
        catalogProductCount: 250,
        stockIndexedProductCount: 250,
        skuIndexedProductCount: 250,
        availableProductCount: 250,
        checkedAt: '2026-08-05'
      }
    };
  }
  res.statusCode = 200;
  return res.end(JSON.stringify(body));
}
Object.defineProperty(legacyFallbackHandler, 'catalogueMeta', {
  value: Object.freeze({
    catalogProductCount: 250,
    stockIndexedProductCount: 250,
    skuIndexedProductCount: 250,
    availableProductCount: 250,
    checkedAt: '2026-08-05'
  })
});

const mergedFallback = createPartsCatalogHandler({
  databaseUrl: '', legacyHandler: legacyFallbackHandler, now: () => FIXED_NOW
});
const mergedPageOne = await invoke(mergedFallback);
assert.equal(mergedPageOne.status, 200);
assert.equal(mergedPageOne.body.items.length, 100);
assert.equal(mergedPageOne.body.meta.totalResults, 250 + REVIEWED_ECS_COUNT);
assert.equal(mergedPageOne.body.meta.catalogProductCount, 250 + REVIEWED_ECS_COUNT);
assert.equal(mergedPageOne.body.meta.sortScope, 'supplier-groups');
assert.match(mergedPageOne.body.meta.sortNote, /USD and GBP prices are not converted or compared/);
assert.equal(mergedPageOne.body.items.filter(item => item.supplier.slug === 'ecs').length, Math.min(100, REVIEWED_ECS_COUNT));
assert.equal(mergedPageOne.body.items.filter(item => item.supplier.slug === 'tegiwa').length,
  Math.max(0, 100 - REVIEWED_ECS_COUNT));
const mergedPageTwo = await invoke(mergedFallback, { query: { cursor: mergedPageOne.body.nextCursor } });
assert.equal(mergedPageTwo.status, 200);
assert.equal(mergedPageTwo.body.items.length, 100);
assert.equal(new Set([
  ...mergedPageOne.body.items.map(item => item.handle),
  ...mergedPageTwo.body.items.map(item => item.handle)
]).size, 200);
const mergedAll = await collectAllItems(mergedFallback);
assert.equal(mergedAll.items.length, 250 + REVIEWED_ECS_COUNT);
assert.equal(new Set(mergedAll.items.map(item => item.handle)).size, 250 + REVIEWED_ECS_COUNT);
assert.equal(mergedAll.items.filter(item => item.supplier.slug === 'ecs').length, REVIEWED_ECS_COUNT);
assert.equal(mergedAll.items.filter(item => item.supplier.slug === 'tegiwa').length, 250);

legacyFallbackRequests.length = 0;
const mergedInterior = await invoke(mergedFallback, { query: { partType: 'interior' } });
assert.equal(mergedInterior.status, 200);
assert.equal(mergedInterior.body.meta.totalResults, INTERIOR_PRODUCT_COUNT);
assert.equal(mergedInterior.body.meta.catalogProductCount, 250 + REVIEWED_ECS_COUNT,
  'A direct scoped URL must keep the verified combined-catalogue headline total.');
assert.equal(mergedInterior.body.meta.availableProductCount, 250);
assert.equal(legacyFallbackRequests.length, 0,
  'The supplier catalogue must not be queried with an unsupported ECS-only part-type filter.');

legacyFallbackRequests.length = 0;
const blankInStockSort = await invoke(mergedFallback, {
  query: { availability: 'in_stock', sort: 'name_asc' }
});
assert.equal(blankInStockSort.status, 200);
assert.equal(blankInStockSort.body.meta.totalResults, 250);
assert.equal(blankInStockSort.body.meta.sortScope, 'single-supplier-or-currency');
assert.ok(blankInStockSort.body.items.every(item => item.supplier.slug === 'tegiwa'));
assert.ok(legacyFallbackRequests.some(request => request.availability === 'in_stock' && request.sort === 'name_asc'),
  'Blank-search availability and name sorting must fall through to the Tegiwa supplier catalogue.');

legacyFallbackRequests.length = 0;
const blankMixedPriceSort = await invoke(mergedFallback, {
  query: { pricing: 'priced', sort: 'price_desc' }
});
assert.equal(blankMixedPriceSort.status, 200);
assert.equal(blankMixedPriceSort.body.meta.sortScope, 'supplier-groups');
assert.match(blankMixedPriceSort.body.meta.sortNote, /Sorting is applied within each supplier/);
assert.ok(blankMixedPriceSort.body.items.every(item => item.price.currency === 'USD'),
  'The first mixed-catalogue block must retain ECS USD prices without comparing them to GBP.');
assert.ok(legacyFallbackRequests.some(request => request.pricing === 'priced' && request.sort === 'price_desc'),
  'Blank-search pricing and price sorting must be passed to the supplier catalogue.');

for (const exactIdentifier of ['034-105-D300', 'ES#4877039']) {
  const exactMergedSearch = await invoke(mergedFallback, { query: { q: exactIdentifier } });
  assert.equal(exactMergedSearch.status, 200);
  assert.equal(exactMergedSearch.body.items.length, 1);
  assert.equal(exactMergedSearch.body.meta.totalResults, 1);
  assert.equal(exactMergedSearch.body.meta.catalogProductCount, 250 + REVIEWED_ECS_COUNT);
  assert.equal(exactMergedSearch.body.items[0].handle, 'ecs-034motorsport-55mm-exhaust-clamp');
  assert.ok(exactMergedSearch.body.items.every(item => item.supplier.slug === 'ecs'));

  const exactMergedSuggestion = await invoke(mergedFallback, { query: { q: exactIdentifier, suggest: '1' } });
  assert.equal(exactMergedSuggestion.status, 200);
  assert.equal(exactMergedSuggestion.body.suggestions.length, 1);
  assert.equal(exactMergedSuggestion.body.suggestions[0].handle, 'ecs-034motorsport-55mm-exhaust-clamp');
}

async function legacyDetailOutageHandler(req, res) {
  if (req.query?.handle) {
    res.statusCode = 502;
    return res.end(JSON.stringify({ error: { code: 'upstream_unavailable', message: 'Supplier detail is offline' } }));
  }
  const item = {
    handle: 'legacy-1',
    title: 'Legacy Tegiwa Product 1',
    vendor: null,
    category: null,
    sku: 'LEGACY-1',
    skuCount: 1,
    skuState: 'exact',
    mpn: null,
    price: { currency: 'GBP', min: 100, max: 100 },
    availability: { code: 'supplier_stock', checkedAt: '2026-08-05', leadTime: 'Confirm before order', snapshotStale: false },
    image: { src: 'https://cdn.example.test/legacy-1.jpg', width: 800, height: 600, alt: 'Legacy product 1' },
    sourceUrl: 'https://www.tegiwa.com/products/legacy-1'
  };
  res.statusCode = 200;
  return res.end(JSON.stringify({
    mode: 'search', items: [item],
    meta: { count: 1, page: 1, pageSize: 100, totalResults: 1, totalPages: 1, catalogProductCount: 1 }
  }));
}

const detailOutageFallback = createPartsCatalogHandler({
  databaseUrl: '', legacyHandler: legacyDetailOutageHandler, now: () => FIXED_NOW
});
const snapshotDetail = await invoke(detailOutageFallback, { query: { handle: 'tegiwa-legacy-1' } });
assert.equal(snapshotDetail.status, 200);
assert.equal(snapshotDetail.body.mode, 'detail');
assert.equal(snapshotDetail.body.product.handle, 'tegiwa-legacy-1');
assert.equal(snapshotDetail.body.product.detailSnapshotOnly, true);
assert.equal(snapshotDetail.body.product.variants.length, 0);
assert.equal(snapshotDetail.body.meta.detailSnapshotOnly, true);
assert.equal(snapshotDetail.body.meta.detailFallbackReason, 'upstream_unavailable');

const incompleteDatabaseEcs = createPartsCatalogHandler({
  query: async (text, values) => {
    if (text.includes('parts-catalog:stats')) {
      return [{ ...stats, suppliers: [{ slug: 'ecs', name: 'ECS Tuning', productCount: 1 }] }];
    }
    if (text.includes('parts-catalog:count')) return [{ total_results: 1 }];
    if (text.includes('parts-catalog:list')) return [row(0)];
    return [];
  },
  legacyHandler: false,
  now: () => FIXED_NOW
});
const incompleteDatabaseFallback = await invoke(incompleteDatabaseEcs);
assert.equal(incompleteDatabaseFallback.status, 200);
assert.equal(incompleteDatabaseFallback.body.items.length, Math.min(100, REVIEWED_ECS_COUNT));
assert.equal(incompleteDatabaseFallback.body.meta.fallbackReason, 'reviewed_ecs_not_seeded');
assert.equal(incompleteDatabaseFallback.body.meta.reviewedEcsProductCount, REVIEWED_ECS_COUNT);

const highCountWithoutReviewedSentinels = createPartsCatalogHandler({
  query: async text => {
    if (text.includes('parts-catalog:stats')) {
      return [{
        ...stats,
        reviewed_ecs_sentinel_count: 0,
        suppliers: [{ slug: 'ecs', name: 'ECS Tuning', productCount: REVIEWED_ECS_COUNT + 50_000 }]
      }];
    }
    if (text.includes('parts-catalog:count')) return [{ total_results: 50_000 }];
    if (text.includes('parts-catalog:list')) return [row(0)];
    return [];
  },
  legacyHandler: false,
  now: () => FIXED_NOW
});
const highCountSentinelFallback = await invoke(highCountWithoutReviewedSentinels);
assert.equal(highCountSentinelFallback.status, 200);
assert.equal(highCountSentinelFallback.body.meta.fallbackReason, 'reviewed_ecs_not_seeded');
assert.equal(highCountSentinelFallback.body.meta.reviewedEcsProductCount, REVIEWED_ECS_COUNT);

const unconfigured = createPartsCatalogHandler({ databaseUrl: '', reviewedFallback: false, now: () => FIXED_NOW });
const unconfiguredResponse = await invoke(unconfigured);
assert.equal(unconfiguredResponse.status, 503);
assert.equal(unconfiguredResponse.body.error.code, 'service_unconfigured');
assert.equal(unconfiguredResponse.headers['cache-control'], 'no-store');

const unpublishedStatements = [];
const unpublished = createPartsCatalogHandler({
  query: async (text, values) => {
    unpublishedStatements.push({ text, values });
    if (text.includes('parts-catalog:stats')) return [unpublishedStats];
    if (text.includes('parts-catalog:count')) return [{ total_results: 0 }];
    return [];
  },
  now: () => FIXED_NOW,
  reviewedFallback: false
});
for (const query of [
  {},
  { q: 'brake pads' },
  { q: 'brake pads', suggest: '1' },
  { handle: 'missing-product' }
]) {
  const response = await invoke(unpublished, { query });
  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, 'catalogue_unpublished');
  assert.equal(response.headers['cache-control'], 'no-store');
}
assert.equal(unpublishedStatements.filter(statement => statement.text.includes('parts-catalog:stats')).length, 4);

const zeroMatchStatements = [];
const zeroMatches = createPartsCatalogHandler({
  query: async (text, values) => {
    zeroMatchStatements.push({ text, values });
    if (text.includes('parts-catalog:stats')) return [stats];
    if (text.includes('parts-catalog:count')) return [{ total_results: 0 }];
    return [];
  },
  now: () => FIXED_NOW
});
const emptySearch = await invoke(zeroMatches, { query: { q: 'nonexistent product' } });
assert.equal(emptySearch.status, 200);
assert.equal(emptySearch.body.mode, 'search');
assert.deepEqual(emptySearch.body.items, []);
assert.equal(emptySearch.body.meta.catalogProductCount, stats.catalog_product_count);
assert.equal(emptySearch.body.meta.totalResults, 0);
const emptySuggestions = await invoke(zeroMatches, { query: { q: 'nonexistent product', suggest: '1' } });
assert.equal(emptySuggestions.status, 200);
assert.equal(emptySuggestions.body.mode, 'suggest');
assert.deepEqual(emptySuggestions.body.suggestions, []);
assert.equal(emptySuggestions.body.meta.catalogProductCount, stats.catalog_product_count);
assert.ok(zeroMatchStatements.every(statement => !statement.text.includes('nonexistent product')));
assert.ok(zeroMatchStatements.some(statement => statement.values.includes('nonexistent product')));

const rejectedMethod = await invoke(handler, { method: 'POST' });
assert.equal(rejectedMethod.status, 405);
assert.equal(rejectedMethod.headers.allow, 'GET');
assert.equal(rejectedMethod.body.error.code, 'method_not_allowed');

assert.equal((await invoke(handler, {
  headers: { host: 'preview.projxracing.com', origin: 'https://attacker.example' }
})).body.error.code, 'origin_not_allowed');
assert.equal((await invoke(handler, {
  headers: { host: 'preview.projxracing.com', 'sec-fetch-site': 'cross-site' }
})).status, 403);

assert.equal((await invoke(handler, { query: { debug: '1' } })).body.error.code, 'invalid_parameters');
assert.equal((await invoke(handler, { query: { q: ['brake', 'pads'] } })).body.error.code, 'invalid_parameters');
assert.equal((await invoke(handler, { url: '/api/parts-catalog?q=brake&q=pads' })).body.error.code, 'invalid_parameters');
assert.equal((await invoke(handler, { query: { q: 'x' } })).body.error.code, 'invalid_query');
assert.equal((await invoke(handler, { query: { q: '<script>alert(1)</script>' } })).body.error.code, 'invalid_query');
assert.equal((await invoke(handler, { query: { q: '--' } })).body.error.code, 'invalid_query');
assert.equal((await invoke(handler, { query: { handle: 'ECS-Brake-Kit' } })).body.error.code, 'invalid_handle');
assert.equal((await invoke(handler, { query: { page: '0' } })).body.error.code, 'invalid_page');
assert.equal((await invoke(handler, { query: { year: '1885' } })).body.error.code, 'invalid_year');
assert.equal((await invoke(handler, { query: { currency: 'US' } })).body.error.code, 'invalid_currency');
assert.equal((await invoke(handler, { query: { supplier: 'ECS Tuning' } })).body.error.code, 'invalid_supplier');
assert.equal((await invoke(handler, { query: { fitment: 'guaranteed' } })).body.error.code, 'invalid_fitment');
assert.equal((await invoke(handler, { query: { match: 'vehicle' } })).body.error.code, 'invalid_parameters');
assert.equal((await invoke(handler, { query: { suggest: '1' } })).body.error.code, 'invalid_parameters');
assert.equal((await invoke(handler, { query: { q: 'brake', suggest: 'yes' } })).body.error.code, 'invalid_suggest');
assert.equal((await invoke(handler, { query: { handle: 'ecs-brake-kit', brand: 'ecs' } })).body.error.code, 'invalid_parameters');

statements.length = 0;
const browse = await invoke(handler);
assert.equal(browse.status, 200);
assert.equal(browse.body.mode, 'browse');
assert.equal(browse.body.items.length, 100);
assert.equal(browse.body.meta.pageSize, 100);
assert.equal(browse.body.meta.page, 1);
assert.equal(browse.body.meta.totalResults, 250);
assert.equal(browse.body.meta.totalPages, 3);
assert.equal(browse.body.meta.catalogProductCount, stats.catalog_product_count);
assert.deepEqual(browse.body.meta.currencies, ['GBP', 'USD']);
assert.match(browse.body.nextCursor, /^[A-Za-z0-9_-]+$/);
assert.equal(browse.body.items[0].price.currency, 'GBP');
assert.equal(browse.body.items[0].price.min, 112.5);
assert.equal(browse.body.items[0].fitmentConfidence, 'exact');
assert.equal(browse.headers['cross-origin-resource-policy'], 'same-origin');
assert.equal(browse.headers['x-content-type-options'], 'nosniff');
assert.match(browse.headers['cache-control'], /s-maxage=120/);

const pageTwo = await invoke(handler, { query: { cursor: browse.body.nextCursor } });
assert.equal(pageTwo.status, 200);
assert.equal(pageTwo.body.meta.page, 2);
assert.equal(pageTwo.body.items[0].handle, 'tegiwa-product-101');
assert.match(pageTwo.body.nextCursor, /^[A-Za-z0-9_-]+$/);
const finalPage = await invoke(handler, { query: { cursor: pageTwo.body.nextCursor } });
assert.equal(finalPage.body.items.length, 50);
assert.equal(finalPage.body.nextCursor, null);

assert.equal((await invoke(handler, { query: { cursor: browse.body.nextCursor, supplier: 'ecs' } })).body.error.code, 'invalid_cursor');
assert.equal((await invoke(handler, { query: { cursor: browse.body.nextCursor, page: '2' } })).body.error.code, 'invalid_parameters');
assert.equal((await invoke(handler, { query: { page: '4' } })).body.error.code, 'invalid_page');

statements.length = 0;
const exactSearch = await invoke(handler, { query: { q: 'ES-1234567' } });
assert.equal(exactSearch.status, 200);
assert.equal(exactSearch.body.mode, 'search');
const exactSql = statements.find(statement => statement.text.includes('parts-catalog:list'));
assert.ok(exactSql);
assert.ok(exactSql.text.indexOf('exact_identifier AS') < exactSql.text.indexOf("websearch_to_tsquery('simple'"));
assert.match(exactSql.text, /pi\.kind IN \('sku', 'mpn', 'ecs'\)/);
assert.ok(exactSql.values.includes('es1234567'));
assert.equal(exactSearch.body.meta.query, 'ES-1234567');

statements.length = 0;
const vehicleSearch = await invoke(handler, {
  query: {
    q: 'brake kit', supplier: 'ecs', brand: 'ecs', partType: 'brakes', currency: 'USD',
    availability: 'in_stock', pricing: 'priced', sort: 'price_asc', match: 'vehicle',
    fitment: 'exact', year: '2024', make: 'BMW', model: 'M3', generation: 'G80', engine: 'S58'
  }
});
assert.equal(vehicleSearch.status, 200);
assert.equal(vehicleSearch.body.meta.filters.currency, 'USD');
assert.equal(vehicleSearch.body.meta.filters.fitment, 'exact');
const vehicleSql = statements.find(statement => statement.text.includes('parts-catalog:list'));
for (const expected of ['ecs', 'brakes', 'USD', 2024, 'bmw', 'm3', 'g80', 's58']) {
  assert.ok(vehicleSql.values.includes(expected), `Expected bound query parameter ${expected}`);
}
assert.match(vehicleSql.text, /fit\.confidence IS NOT NULL/);
assert.match(vehicleSql.text, /pf\.confidence = 'exact'/);
assert.match(vehicleSql.text, /ps\.vehicle_vector/);

statements.length = 0;
const possibleFitment = await invoke(handler, {
  query: { q: 'intercooler', fitment: 'possible', make: 'BMW', model: 'M3' }
});
assert.equal(possibleFitment.status, 200);
const possibleSql = statements.find(statement => statement.text.includes('parts-catalog:list'));
assert.match(possibleSql.text, /pf\.confidence = 'possible'/);
assert.equal(possibleFitment.body.meta.filters.fitment, 'possible');

const bridgeRequest = __test.parseRequest({
  query: { year: '2024', make: 'BMW', model: 'M3' },
  url: '/api/parts-catalog', headers: {}
});
const mixedCurrencySortRequest = __test.parseRequest({
  query: { sort: 'price_asc' }, url: '/api/parts-catalog', headers: {}
});
assert.match(__test.buildListQuery(mixedCurrencySortRequest).text,
  /ORDER BY s\.slug ASC, offer\.currency ASC NULLS LAST, offer\.price_min ASC NULLS LAST/,
  'All-supplier price sorting must group suppliers before ordering prices within their original currency.');
const scopedSupplierSortRequest = __test.parseRequest({
  query: { supplier: 'ecs', currency: 'USD', sort: 'price_asc' },
  url: '/api/parts-catalog', headers: {}
});
assert.doesNotMatch(__test.buildListQuery(scopedSupplierSortRequest).text, /ORDER BY s\.slug ASC/,
  'Selecting a supplier or currency must preserve normal supplier-specific sorting.');
const bridgeListSql = __test.buildListQuery(bridgeRequest);
const bridgeCountSql = __test.buildCountQuery(bridgeRequest);
for (const statement of [bridgeListSql, bridgeCountSql]) {
  assert.match(statement.text, /UNION ALL\s+SELECT 'possible'::text AS confidence/);
  assert.match(statement.text, /NOT EXISTS \(\s*SELECT 1 FROM product_fitments existing_pf WHERE existing_pf\.product_id = p\.id\s*\)/);
  assert.equal((statement.text.match(/ps\.vehicle_vector @@ plainto_tsquery\('simple', \$\d+\)/g) || []).length, 2);
  assert.match(statement.text, /ORDER BY candidate\.source_priority,\s*CASE candidate\.confidence WHEN 'exact' THEN 0 ELSE 1 END/);
  assert.equal(statement.values.filter(value => value === 'bmw').length, 1);
  assert.equal(statement.values.filter(value => value === 'm3').length, 1);
  assert.equal(statement.values.filter(value => value === 2024).length, 1);
}

const exactBridgeRequest = __test.parseRequest({
  query: { fitment: 'exact', year: '2024', make: 'BMW', model: 'M3' },
  url: '/api/parts-catalog', headers: {}
});
for (const statement of [
  __test.buildListQuery(exactBridgeRequest),
  __test.buildCountQuery(exactBridgeRequest)
]) {
  assert.match(statement.text, /pf\.confidence = 'exact'/);
  assert.doesNotMatch(statement.text, /SELECT 'possible'::text AS confidence/);
  assert.doesNotMatch(statement.text, /ps\.vehicle_vector @@ plainto_tsquery/);
}

const oneSidedVehicleRequest = __test.parseRequest({
  query: { make: 'BMW' }, url: '/api/parts-catalog', headers: {}
});
assert.doesNotMatch(__test.buildListQuery(oneSidedVehicleRequest).text, /SELECT 'possible'::text AS confidence/);

const parameterizedBridgeRequest = __test.parseRequest({
  query: { make: "BMW' OR TRUE --", model: "M3') OR TRUE --" },
  url: '/api/parts-catalog', headers: {}
});
const parameterizedBridgeSql = __test.buildListQuery(parameterizedBridgeRequest);
assert.ok(parameterizedBridgeSql.values.includes("bmw' or true --"));
assert.ok(parameterizedBridgeSql.values.includes("m3') or true --"));
assert.doesNotMatch(parameterizedBridgeSql.text, /BMW' OR TRUE|M3'\) OR TRUE/i);
assert.equal((parameterizedBridgeSql.text.match(/plainto_tsquery\('simple', \$\d+\)/g) || []).length, 2);

statements.length = 0;
const suggestions = await invoke(handler, { query: { q: 'brake kit', suggest: '1', supplier: 'ecs', currency: 'USD' } });
assert.equal(suggestions.status, 200);
assert.equal(suggestions.body.mode, 'suggest');
assert.equal(suggestions.body.suggestions.length, 8);
assert.equal(suggestions.body.suggestions[0].kind, 'product');
assert.equal(suggestions.body.meta.limit, 8);
assert.equal(suggestions.body.nextCursor, null);
const suggestionSql = statements.find(statement => statement.text.includes('parts-catalog:list'));
assert.equal(suggestionSql.values.at(-1), 8);

const detail = await invoke(handler, { query: { handle: 'ecs-brake-kit', supplier: 'ecs', currency: 'USD' } });
assert.equal(detail.status, 200);
assert.equal(detail.body.mode, 'detail');
assert.equal(detail.body.product.handle, 'ecs-brake-kit');
assert.equal(detail.body.product.price.currency, 'USD');
assert.equal(detail.body.product.price.min, 499.99);
assert.equal(detail.body.product.variants[0].price.currency, 'USD');
assert.equal(detail.body.product.variants[0].price.amount, 499.99);
assert.equal(detail.body.product.fitments[0].confidence, 'exact');
assert.equal(detail.body.product.fitments[0].engine, 'S58');
assert.equal(detail.body.product.images.length, 1);

const missingDetail = createPartsCatalogHandler({ query: async text => text.includes('stats') ? [stats] : [], now: () => FIXED_NOW });
assert.equal((await invoke(missingDetail, { query: { handle: 'ecs-missing' } })).body.error.code, 'product_not_found');

const ambiguousDetail = createPartsCatalogHandler({
  query: async text => text.includes('stats') ? [stats] : [row(0), row(1)], now: () => FIXED_NOW
});
assert.equal((await invoke(ambiguousDetail, { query: { handle: 'shared-product' } })).body.error.code, 'ambiguous_product');

const unavailable = createPartsCatalogHandler({
  query: async () => { throw new Error('database is offline and details must not leak'); },
  now: () => FIXED_NOW,
  logger: { error() {} },
  reviewedFallback: false
});
const unavailableResponse = await invoke(unavailable);
assert.equal(unavailableResponse.status, 503);
assert.equal(unavailableResponse.body.error.code, 'service_unavailable');
assert.doesNotMatch(JSON.stringify(unavailableResponse.body), /database is offline/);

const limited = createPartsCatalogHandler({
  query: queryAdapter, now: () => FIXED_NOW, searchRateLimit: { limit: 1, windowMs: 60_000 }
});
assert.equal((await invoke(limited, { query: { q: 'brake' } })).status, 200);
const rateLimited = await invoke(limited, { query: { q: 'brake' } });
assert.equal(rateLimited.status, 429);
assert.equal(rateLimited.body.error.code, 'rate_limited');
assert.equal(rateLimited.headers['retry-after'], '60');

const request = __test.parseRequest({
  query: { q: 'brake', supplier: 'ecs' }, url: '/api/parts-catalog', headers: {}
});
const cursor = __test.encodeCursor(100, request.fingerprint);
assert.equal(__test.decodeCursor(cursor, request.fingerprint), 100);
assert.throws(() => __test.decodeCursor(cursor, 'different-filter'), /cursor is invalid/i);

let disabledDiscoveryCalls = 0;
const discoveryDisabled = createPartsCatalogHandler({
  databaseUrl: '',
  ecsDiscoveryEnabled: false,
  ecsDiscoveryProvider: { async list() { disabledDiscoveryCalls += 1; return null; } },
  now: () => FIXED_NOW
});
const disabledDiscovery = await invoke(discoveryDisabled, { query: { discovery: '1' } });
assert.equal(disabledDiscovery.status, 404);
assert.equal(disabledDiscovery.body.error.code, 'discovery_unavailable');
assert.equal(disabledDiscoveryCalls, 0);

let discoveryProviderCalls = 0;
const discoveryProvider = {
  async getMeta() {
    discoveryProviderCalls += 1;
    throw new Error('Private URL intake must not be called by the storefront.');
  },
  async list() {
    discoveryProviderCalls += 1;
    throw new Error('Private URL intake must not be called by the storefront.');
  },
  async listByOffset() {
    discoveryProviderCalls += 1;
    throw new Error('Private URL intake must not be called by the storefront.');
  }
};
const discoveryEnabled = createPartsCatalogHandler({
  databaseUrl: '',
  legacyHandler: false,
  ecsDiscoveryEnabled: true,
  ecsDiscoveryProvider: discoveryProvider,
  now: () => FIXED_NOW
});
const firstDiscovery = await invoke(discoveryEnabled, { query: { discovery: '1' } });
assert.equal(firstDiscovery.status, 404);
assert.equal(firstDiscovery.body.error.code, 'discovery_unavailable');
assert.match(firstDiscovery.body.error.message, /private ingestion data/i);
assert.equal(discoveryProviderCalls, 0);
assert.equal((await invoke(discoveryEnabled, { query: { discovery: '1', q: 'brakes' } })).body.error.code, 'discovery_filters_unsupported');
assert.equal((await invoke(discoveryEnabled, { query: { discovery: 'yes' } })).body.error.code, 'invalid_discovery');
assert.equal((await invoke(discoveryEnabled, { query: { discovery: '1', cursor: "bad\u0000cursor" } })).body.error.code, 'invalid_ecs_discovery_cursor');

const referenceTotalsUnavailable = createPartsCatalogHandler({
  databaseUrl: '', legacyHandler: false, ecsDiscoveryEnabled: true, now: () => FIXED_NOW,
  logger: { warn() {} }, ecsDiscoveryProvider: { async list() { return { items: [], count: 0, nextCursor: null }; } }
});
const safeVerifiedCatalogue = await invoke(referenceTotalsUnavailable);
assert.equal(safeVerifiedCatalogue.status, 200);
assert.equal(safeVerifiedCatalogue.body.meta.catalogProductCount, REVIEWED_ECS_COUNT);
assert.equal(Object.hasOwn(safeVerifiedCatalogue.body.meta, 'catalogueListingCount'), false);

const fullEcsCatalogue = await invoke(discoveryEnabled, { query: { supplier: 'ecs', page: '1' } });
assert.equal(fullEcsCatalogue.status, 200);
assert.equal(fullEcsCatalogue.body.mode, 'browse');
assert.equal(fullEcsCatalogue.body.items.length, Math.min(100, REVIEWED_ECS_COUNT));
assert.equal(fullEcsCatalogue.body.meta.catalogProductCount, REVIEWED_ECS_COUNT);
assert.equal(fullEcsCatalogue.body.meta.totalResults, REVIEWED_ECS_COUNT);
assert.equal(fullEcsCatalogue.body.meta.totalPages, Math.ceil(REVIEWED_ECS_COUNT / 100));
assert.ok(fullEcsCatalogue.body.items.every(item => item.title && item.sku && item.image?.src));
assert.ok(fullEcsCatalogue.body.items.every(item => item.dataStatus !== 'url_discovered'));
const fullEcsItems = await collectAllItems(discoveryEnabled, { supplier: 'ecs' });
assert.equal(fullEcsItems.items.length, REVIEWED_ECS_COUNT);
assert.equal(new Set(fullEcsItems.items.map(item => item.handle)).size, REVIEWED_ECS_COUNT);
assert.equal(new Set(fullEcsItems.items.map(item => item.sku)).size, REVIEWED_ECS_COUNT);
for (const field of ['catalogueListingCount', 'verifiedSearchableProductCount', 'ecsUrlReferenceCount',
  'ecsCatalogueListingCount', 'ecsReferenceOnlyCount', 'reviewedOutsideDiscoveryCount']) {
  assert.equal(Object.hasOwn(fullEcsCatalogue.body.meta, field), false);
}
assert.equal(discoveryProviderCalls, 0);

const discoveryConfiguredDatabase = createPartsCatalogHandler({
  query: queryAdapter,
  ecsDiscoveryEnabled: true,
  ecsDiscoveryProvider: discoveryProvider,
  now: () => FIXED_NOW
});
const normalWithDiscoveryConfigured = await invoke(discoveryConfiguredDatabase);
assert.equal(normalWithDiscoveryConfigured.status, 200);
assert.equal(normalWithDiscoveryConfigured.body.meta.catalogProductCount, stats.catalog_product_count);
assert.equal(normalWithDiscoveryConfigured.body.meta.availableProductCount, 26_360);
assert.equal(Object.hasOwn(normalWithDiscoveryConfigured.body.meta, 'catalogueListingCount'), false);
assert.equal(Object.hasOwn(normalWithDiscoveryConfigured.body.meta, 'ecsReferenceOnlyCount'), false);
assert.equal(normalWithDiscoveryConfigured.body.meta.filters.supplier, null);
assert.equal(normalWithDiscoveryConfigured.body.meta.totalResults, 250);
assert.equal(discoveryProviderCalls, 0);

console.log('Unified parts catalog API tests passed.');
