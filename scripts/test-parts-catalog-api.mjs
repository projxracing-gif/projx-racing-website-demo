import assert from 'node:assert/strict';
import { createPartsCatalogHandler, __test } from '../api/parts-catalog.js';

const FIXED_NOW = Date.parse('2026-08-05T09:30:00Z');

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
  catalog_product_count: 193_270,
  available_product_count: 26_360,
  priced_product_count: 26_370,
  sku_product_count: 188_840,
  checked_at: '2026-08-05T08:00:00Z',
  stale_offer_count: 0,
  suppliers: [
    { slug: 'ecs', name: 'ECS Tuning', productCount: 14 },
    { slug: 'tegiwa', name: 'Tegiwa', productCount: 193_256 }
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
assert.equal(reviewedBrowse.body.items.length, 14);
assert.equal(reviewedBrowse.body.meta.totalResults, 14);
assert.equal(reviewedBrowse.body.meta.reviewedEcsProductCount, 14);
assert.equal(reviewedBrowse.body.meta.partialCatalogue, true);
assert.equal(reviewedBrowse.body.meta.catalogueSource, 'reviewed-local-fallback');
assert.deepEqual(reviewedBrowse.body.meta.suppliers, [{ slug: 'ecs', name: 'ECS Tuning' }]);
assert.deepEqual(reviewedBrowse.body.meta.currencies, ['USD']);
assert.equal(new Set(reviewedBrowse.body.items.map(item => item.handle)).size, 14);
assert.equal(new Set(reviewedBrowse.body.items.map(item => item.sku)).size, 14);
assert.ok(reviewedBrowse.body.items.every(item => item.handle.startsWith('ecs-')));
assert.ok(reviewedBrowse.body.items.every(item => item.supplier.slug === 'ecs'));
assert.ok(reviewedBrowse.body.items.every(item => item.price.currency === 'USD'));
assert.ok(reviewedBrowse.body.items.every(item => item.availability.code === 'check_availability'));
assert.ok(reviewedBrowse.body.items.every(item => item.fitmentConfidence === null));

const staleReviewedOnly = createPartsCatalogHandler({
  databaseUrl: '', legacyHandler: false, now: () => Date.parse('2026-08-13T00:00:00Z')
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

const reviewedBrandFilter = await invoke(reviewedOnly, { query: { brand: 'csf-cooling' } });
assert.equal(reviewedBrandFilter.status, 200);
assert.equal(reviewedBrandFilter.body.meta.totalResults, 3);
assert.ok(reviewedBrandFilter.body.items.every(item => item.vendor === 'CSF Cooling'));

const reviewedCategoryFilter = await invoke(reviewedOnly, { query: { partType: 'cooling' } });
assert.equal(reviewedCategoryFilter.status, 200);
assert.equal(reviewedCategoryFilter.body.meta.totalResults, 5);
assert.ok(reviewedCategoryFilter.body.items.every(item => item.category.startsWith('Cooling')));

const reviewedPossibleFitment = await invoke(reviewedOnly, {
  query: { fitment: 'possible', make: 'BMW', model: 'M3' }
});
assert.equal(reviewedPossibleFitment.status, 200);
assert.equal(reviewedPossibleFitment.body.meta.totalResults, 2);
assert.ok(reviewedPossibleFitment.body.items.every(item => item.fitmentConfidence === 'possible'));
const reviewedM2Fitment = await invoke(reviewedOnly, {
  query: { fitment: 'possible', make: 'BMW', model: 'M2' }
});
assert.equal(reviewedM2Fitment.body.meta.totalResults, 2);
assert.ok(reviewedM2Fitment.body.items.every(item => !/m240/i.test(item.title)));
assert.equal((await invoke(reviewedOnly, {
  query: { fitment: 'exact', make: 'BMW', model: 'M3' }
})).body.meta.totalResults, 0);
assert.equal((await invoke(reviewedOnly, { query: { availability: 'in_stock' } })).body.meta.totalResults, 0);
assert.equal((await invoke(reviewedOnly, { query: { availability: 'check' } })).body.meta.totalResults, 14);

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

async function legacyFallbackHandler(req, res) {
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

const mergedFallback = createPartsCatalogHandler({
  databaseUrl: '', legacyHandler: legacyFallbackHandler, now: () => FIXED_NOW
});
const mergedPageOne = await invoke(mergedFallback);
assert.equal(mergedPageOne.status, 200);
assert.equal(mergedPageOne.body.items.length, 100);
assert.equal(mergedPageOne.body.meta.totalResults, 264);
assert.equal(mergedPageOne.body.meta.catalogProductCount, 264);
assert.equal(mergedPageOne.body.items.filter(item => item.supplier.slug === 'ecs').length, 14);
assert.equal(mergedPageOne.body.items.filter(item => item.supplier.slug === 'tegiwa').length, 86);
assert.equal(mergedPageOne.body.items[14].handle, 'tegiwa-legacy-1');
const mergedPageTwo = await invoke(mergedFallback, { query: { cursor: mergedPageOne.body.nextCursor } });
assert.equal(mergedPageTwo.status, 200);
assert.equal(mergedPageTwo.body.items.length, 100);
assert.equal(mergedPageTwo.body.items[0].handle, 'tegiwa-legacy-87');
assert.equal(new Set([
  ...mergedPageOne.body.items.map(item => item.handle),
  ...mergedPageTwo.body.items.map(item => item.handle)
]).size, 200);

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
assert.equal(incompleteDatabaseFallback.body.items.length, 14);
assert.equal(incompleteDatabaseFallback.body.meta.fallbackReason, 'reviewed_ecs_not_seeded');
assert.equal(incompleteDatabaseFallback.body.meta.reviewedEcsProductCount, 14);

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
assert.equal(emptySearch.body.meta.catalogProductCount, 193_270);
assert.equal(emptySearch.body.meta.totalResults, 0);
const emptySuggestions = await invoke(zeroMatches, { query: { q: 'nonexistent product', suggest: '1' } });
assert.equal(emptySuggestions.status, 200);
assert.equal(emptySuggestions.body.mode, 'suggest');
assert.deepEqual(emptySuggestions.body.suggestions, []);
assert.equal(emptySuggestions.body.meta.catalogProductCount, 193_270);
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
assert.equal(browse.body.meta.catalogProductCount, 193_270);
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

console.log('Unified parts catalog API tests passed.');
