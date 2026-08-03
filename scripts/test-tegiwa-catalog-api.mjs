import assert from 'node:assert/strict';
import {
  default as productionHandler,
  createTegiwaCatalogHandler,
  normalizeTitleForStock,
  stockKeyForTitle
} from '../api/tegiwa-catalog.js';

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
  headers = { host: 'preview.projxracing.com', origin: 'https://preview.projxracing.com' }
} = {}) {
  const req = { method, query, headers, url: '/api/tegiwa-catalog' };
  const res = responseRecorder();
  await handler(req, res);
  return {
    status: res.statusCode,
    headers: res.headers,
    body: JSON.parse(res.body || '{}')
  };
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

const STOCK_KEY_FIXTURE = 'kvSkN4vT1Bb2VWIN';
const FIXED_NOW = Date.parse('2026-08-04T12:00:00Z');
assert.equal(normalizeTitleForStock('  TEGIWA\u00a0 BMW B58 Service Kit  '), 'tegiwa bmw b58 service kit');
assert.equal(stockKeyForTitle('  TEGIWA\u00a0 BMW B58 Service Kit  '), STOCK_KEY_FIXTURE);

const stockIndex = {
  version: 1,
  checkedAt: '2026-08-03',
  productCount: 4_218,
  availableProductCount: 2_601,
  leadTimes: ['', '2-3 working days'],
  products: {
    [STOCK_KEY_FIXTURE]: [11796, 12999, 1, 1]
  }
};

const noFetch = async () => {
  throw new Error('Fetch should not have been called.');
};
const validationHandler = createTegiwaCatalogHandler({ fetchImpl: noFetch, stockIndex, now: () => FIXED_NOW });

const methodRejected = await invoke(validationHandler, { method: 'POST' });
assert.equal(methodRejected.status, 405);
assert.equal(methodRejected.headers.allow, 'GET');
assert.equal(methodRejected.body.error.code, 'method_not_allowed');

assert.equal((await invoke(validationHandler, { query: { q: 'x' } })).status, 400);
assert.equal((await invoke(validationHandler, { query: { q: 'x'.repeat(81) } })).body.error.code, 'invalid_query');
assert.equal((await invoke(validationHandler, { query: { q: ['brake', 'engine'] } })).body.error.code, 'invalid_parameters');
assert.equal((await invoke(validationHandler, { query: { handle: 'Upper-Case-Handle' } })).body.error.code, 'invalid_handle');
assert.equal((await invoke(validationHandler, { query: { handle: 'a'.repeat(256) } })).body.error.code, 'invalid_handle');
assert.equal((await invoke(validationHandler, { query: { q: 'brake', cursor: 'abcd' } })).body.error.code, 'invalid_parameters');
assert.equal((await invoke(validationHandler, { query: { page: '0' } })).body.error.code, 'invalid_page');
assert.equal((await invoke(validationHandler, { query: { page: '1.5' } })).body.error.code, 'invalid_page');
assert.equal((await invoke(validationHandler, { query: { page: ['1', '2'] } })).body.error.code, 'invalid_page');
assert.equal((await invoke(validationHandler, { query: { q: 'brake', suggest: '1', page: '1' } })).body.error.code, 'invalid_parameters');
assert.equal((await invoke(validationHandler, { query: { sort: 'relevance' } })).body.error.code, 'invalid_parameters');
assert.equal((await invoke(validationHandler, { query: { q: 'brake', sort: 'newest' } })).body.error.code, 'invalid_sort');
assert.equal((await invoke(validationHandler, { query: { q: 'brake', availability: 'maybe' } })).body.error.code, 'invalid_availability');
assert.equal((await invoke(validationHandler, { query: { q: 'brake', pricing: 'trade' } })).body.error.code, 'invalid_pricing');
assert.equal((await invoke(validationHandler, { query: { q: 'brake', debug: '1' } })).body.error.code, 'invalid_parameters');
assert.equal((await invoke(validationHandler, {
  query: { q: 'brake' },
  headers: { host: 'preview.projxracing.com', origin: 'https://attacker.example' }
})).status, 403);

function normalizeSearch(value) {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function makeSearchIndex(records) {
  const terms = Object.create(null);
  const pairs = Object.create(null);
  const names = [];
  const stockKeys = [];
  const add = (object, key, documentId) => {
    if (!object[key]) object[key] = [];
    if (object[key].at(-1) !== documentId) object[key].push(documentId);
  };
  records.forEach((record, documentId) => {
    const titleTokens = normalizeSearch(record[1]).split(' ').filter(Boolean);
    const combined = normalizeSearch(`${record[1]} ${record[0].replace(/[-_]+/g, ' ')}`).split(' ').filter(Boolean);
    for (const token of new Set(combined)) add(terms, token, documentId);
    for (let index = 0; index + 1 < titleTokens.length; index += 1) add(pairs, `${titleTokens[index]}\u0001${titleTokens[index + 1]}`, documentId);
    names.push({ documentId, key: `${normalizeSearch(record[1])}\u0000${record[0]}` });
    stockKeys.push(stockKeyForTitle(record[1]));
  });
  names.sort((left, right) => left.key.localeCompare(right.key) || left.documentId - right.documentId);
  const nameRanks = new Array(records.length);
  names.forEach((entry, rank) => { nameRanks[entry.documentId] = rank; });
  return { version: 1, productCount: records.length, terms, pairs, nameRanks, stockKeys };
}

const searchRecords = [
  ...Array.from({ length: 135 }, (_, index) => [
    `engine-management-ecu-${String(index + 1).padStart(3, '0')}`,
    `Link Engine Management ECU Controller ${String(index + 1).padStart(3, '0')}`,
    `https://cdn.shopify.com/s/files/1/0000/engine-${index + 1}.jpg`
  ]),
  ...Array.from({ length: 100 }, (_, index) => [
    `ecu-engine-management-${String(index + 136).padStart(3, '0')}`,
    `Link ECU Engine Management Module ${String(index + 136).padStart(3, '0')}`,
    `https://cdn.shopify.com/s/files/1/0000/engine-${index + 136}.jpg`
  ]),
  ...Array.from({ length: 8 }, (_, index) => [
    `performance-brake-pads-${String(index + 1).padStart(3, '0')}`,
    `Performance Brake Pads ${String(index + 1).padStart(3, '0')}`,
    `https://cdn.shopify.com/s/files/1/0000/brake-${index + 1}.jpg`
  ])
];
const searchCatalogShards = [searchRecords.slice(0, 80), searchRecords.slice(80, 170), searchRecords.slice(170)];
const searchCatalogSummary = {
  version: 1,
  shardCount: searchCatalogShards.length,
  shardProductCounts: searchCatalogShards.map(shard => shard.length),
  productCount: searchRecords.length
};
const searchSitemaps = searchCatalogShards.map((shard, index) =>
  `https://www.tegiwa.com/sitemap_products_${index + 1}.xml?from=${index}&to=${index + shard.length}`);
const searchProducts = Object.create(null);
let searchAvailableCount = 0;
searchRecords.forEach((record, index) => {
  const status = index % 5;
  if (status === 4) return;
  searchProducts[stockKeyForTitle(record[1])] = [10_000 + index, 10_500 + index, status, 0];
  if (status === 1 || status === 2) searchAvailableCount += 1;
});
const searchStockIndex = {
  version: 1,
  checkedAt: '2026-08-03',
  productCount: searchRecords.length,
  availableProductCount: searchAvailableCount,
  leadTimes: [''],
  products: searchProducts
};
const localSearchIndex = makeSearchIndex(searchRecords);
const searchHandler = createTegiwaCatalogHandler({
  stockIndex: searchStockIndex,
  sitemapManifest: searchSitemaps,
  catalogSummary: searchCatalogSummary,
  catalogLoader: async index => searchCatalogShards[index],
  searchIndex: localSearchIndex,
  now: () => FIXED_NOW,
  fetchImpl: noFetch
});

const searchPageOne = await invoke(searchHandler, { query: { q: 'engine management ecu' } });
assert.equal(searchPageOne.status, 200);
assert.equal(searchPageOne.body.mode, 'search');
assert.equal(searchPageOne.body.items.length, 100);
assert.equal(searchPageOne.body.meta.totalResults, 235);
assert.equal(searchPageOne.body.meta.totalPages, 3);
assert.equal(searchPageOne.body.meta.pageSize, 100);
assert.equal(searchPageOne.body.meta.canonicalQuery, 'engine management ecu');
assert.equal(searchPageOne.body.meta.corrected, false);
assert.equal(searchPageOne.body.items[0].title, 'Link Engine Management ECU Controller 001');
assert.equal(searchPageOne.body.items[0].vendor, null);
assert.equal(searchPageOne.body.items[0].category, null);
assert.match(searchPageOne.headers['cache-control'], /s-maxage=300/);
assert.equal(searchPageOne.headers['x-content-type-options'], 'nosniff');
assert.equal(searchPageOne.headers['cross-origin-resource-policy'], 'same-origin');
assert.equal(searchPageOne.headers['access-control-allow-origin'], undefined);
assert.equal(searchPageOne.headers['ratelimit-policy'], '120;w=60');

const searchPageTwo = await invoke(searchHandler, { query: { q: 'engine management ecu', page: '2' } });
const searchPageThree = await invoke(searchHandler, { query: { q: 'engine management ecu', page: '3' } });
assert.equal(searchPageTwo.body.items.length, 100);
assert.equal(searchPageThree.body.items.length, 35);
const allSearchHandles = [searchPageOne, searchPageTwo, searchPageThree].flatMap(result => result.body.items.map(item => item.handle));
assert.equal(allSearchHandles.length, 235);
assert.equal(new Set(allSearchHandles).size, 235);
assert.equal((await invoke(searchHandler, { query: { q: 'engine management ecu', page: '4' } })).body.error.code, 'invalid_page');

const typoSearch = await invoke(searchHandler, { query: { q: 'engien managment ecu' } });
assert.equal(typoSearch.body.meta.canonicalQuery, 'engine management ecu');
assert.equal(typoSearch.body.meta.corrected, true);
assert.deepEqual(typoSearch.body.meta.corrections, [
  { from: 'engien', to: 'engine' }, { from: 'managment', to: 'management' }
]);
assert.deepEqual(typoSearch.body.items.map(item => item.handle), searchPageOne.body.items.map(item => item.handle));

const brakeSearch = await invoke(searchHandler, { query: { q: 'brake pads' } });
assert.equal(brakeSearch.body.meta.totalResults, 8);
assert.equal(brakeSearch.body.items.length, 8);
assert.ok(brakeSearch.body.items.every(item => /Brake Pads/.test(item.title)));

const suggestions = await invoke(searchHandler, { query: { q: 'engine manag', suggest: '1' } });
assert.equal(suggestions.body.mode, 'suggest');
assert.equal(suggestions.body.suggestions.length, 8);
assert.ok(suggestions.body.suggestions.every(item => item.kind === 'product' && item.handle && item.label === item.query));
assert.equal(suggestions.body.correction.canonicalQuery, 'engine manag');
assert.equal(suggestions.body.meta.limit, 8);

const arabicBrake = await invoke(searchHandler, { query: { q: 'قطع فحمات فرامل' } });
assert.equal(arabicBrake.status, 200);
assert.equal(arabicBrake.body.items.length, 8);
assert.equal(arabicBrake.body.meta.totalResults, 8);
assert.equal(arabicBrake.body.meta.canonicalQuery, 'brake pads');
assert.equal(arabicBrake.body.meta.corrected, true);
assert.equal(arabicBrake.body.meta.translated, true);
assert.ok(arabicBrake.body.meta.corrections.some(item => item.from === 'فحمات' && item.to === 'brake pads'));

const arabicSuggestions = await invoke(searchHandler, { query: { q: 'فرامل', suggest: '1' } });
assert.equal(arabicSuggestions.status, 200);
assert.equal(arabicSuggestions.body.suggestions.length, 8);
assert.equal(arabicSuggestions.body.correction.canonicalQuery, 'brake');
assert.equal(arabicSuggestions.body.correction.corrected, true);
assert.equal(arabicSuggestions.body.correction.translated, true);

const unknownArabic = await invoke(searchHandler, { query: { q: 'عبارة غير معروفة' } });
assert.equal(unknownArabic.status, 200);
assert.equal(unknownArabic.body.items.length, 0);
assert.equal(unknownArabic.body.meta.totalResults, 0);
assert.equal(unknownArabic.body.meta.translated, false);

const xssSafe = await invoke(searchHandler, { query: { q: '<img src=x onerror=alert(1)>engine' } });
assert.equal(xssSafe.status, 200);
assert.equal(xssSafe.body.meta.query, 'engine');
assert.equal(JSON.stringify(xssSafe.body).includes('<img'), false);

const allAvailability = await invoke(searchHandler, { query: { q: 'engine management ecu', availability: 'all' } });
const available = await invoke(searchHandler, { query: { q: 'engine management ecu', availability: 'available' } });
const inStock = await invoke(searchHandler, { query: { q: 'engine management ecu', availability: 'in_stock' } });
const supplierStock = await invoke(searchHandler, { query: { q: 'engine management ecu', availability: 'supplier_stock' } });
const checkAvailability = await invoke(searchHandler, { query: { q: 'engine management ecu', availability: 'check' } });
const unavailable = await invoke(searchHandler, { query: { q: 'engine management ecu', availability: 'unavailable' } });
assert.equal(allAvailability.body.meta.totalResults, 235);
assert.equal(available.body.meta.totalResults, inStock.body.meta.totalResults + supplierStock.body.meta.totalResults);
assert.ok(inStock.body.items.every(item => item.availability.code === 'in_stock'));
assert.ok(supplierStock.body.items.every(item => item.availability.code === 'supplier_stock'));
assert.ok(checkAvailability.body.items.every(item => item.availability.code === 'check_availability'));
assert.ok(unavailable.body.items.every(item => item.availability.code === 'out_of_stock'));

const priced = await invoke(searchHandler, { query: { q: 'engine management ecu', pricing: 'priced' } });
const requestPrice = await invoke(searchHandler, { query: { q: 'engine management ecu', pricing: 'request_price' } });
assert.equal(priced.body.meta.totalResults + requestPrice.body.meta.totalResults, 235);
assert.ok(priced.body.items.every(item => item.price.min !== null));
assert.ok(requestPrice.body.items.every(item => item.price.min === null));

const nameAscending = await invoke(searchHandler, { query: { q: 'engine management ecu', sort: 'name_asc' } });
const nameDescending = await invoke(searchHandler, { query: { q: 'engine management ecu', sort: 'name_desc' } });
assert.equal(nameAscending.body.meta.sort, 'name_asc');
assert.equal(nameDescending.body.meta.sort, 'name_desc');
assert.notEqual(nameAscending.body.items[0].handle, nameDescending.body.items[0].handle);
const priceAscending = await invoke(searchHandler, { query: { q: 'engine management ecu', sort: 'price_asc' } });
const priceDescending = await invoke(searchHandler, { query: { q: 'engine management ecu', sort: 'price_desc' } });
assert.ok(priceAscending.body.items[0].price.min <= priceAscending.body.items[1].price.min);
assert.ok(priceDescending.body.items[0].price.min >= priceDescending.body.items[1].price.min);

const staleStockHandler = createTegiwaCatalogHandler({
  stockIndex: searchStockIndex,
  sitemapManifest: searchSitemaps,
  catalogSummary: searchCatalogSummary,
  catalogLoader: async index => searchCatalogShards[index],
  searchIndex: localSearchIndex,
  now: () => Date.parse('2026-08-12T00:00:00Z'),
  fetchImpl: noFetch
});
const staleStock = await invoke(staleStockHandler, { query: { q: 'brake pads', availability: 'check' } });
assert.equal(staleStock.body.meta.totalResults, 8);
assert.ok(staleStock.body.items.every(item => item.availability.code === 'check_availability' && item.availability.snapshotStale));

const limitedSearchHandler = createTegiwaCatalogHandler({
  stockIndex: searchStockIndex,
  sitemapManifest: searchSitemaps,
  catalogSummary: searchCatalogSummary,
  catalogLoader: async index => searchCatalogShards[index],
  searchIndex: localSearchIndex,
  searchRateLimit: { limit: 2, windowMs: 60_000 },
  now: () => FIXED_NOW,
  fetchImpl: noFetch
});
assert.equal((await invoke(limitedSearchHandler, { query: { q: 'brake pads' } })).status, 200);
assert.equal((await invoke(limitedSearchHandler, { query: { q: 'engine management' } })).status, 200);
const rateLimited = await invoke(limitedSearchHandler, { query: { q: 'engine ecu' } });
assert.equal(rateLimited.status, 429);
assert.equal(rateLimited.body.error.code, 'rate_limited');
assert.equal(rateLimited.headers['retry-after'], '60');

function catalogRecord(number) {
  const padded = String(number).padStart(3, '0');
  return [
    `product-${padded}`,
    `Official Product ${padded}`,
    `https://cdn.shopify.com/s/files/1/0000/product-${padded}.jpg`
  ];
}

const sitemapManifest = [
  'https://www.tegiwa.com/sitemap_products_1.xml?from=1&to=75',
  'https://www.tegiwa.com/sitemap_products_2.xml?from=76&to=165',
  'https://www.tegiwa.com/sitemap_products_3.xml?from=166&to=206'
];
const catalogShards = [
  Array.from({ length: 75 }, (_, index) => catalogRecord(index + 1)),
  Array.from({ length: 90 }, (_, index) => catalogRecord(index + 76)),
  Array.from({ length: 41 }, (_, index) => catalogRecord(index + 166))
];
const catalogSummary = {
  version: 1,
  shardCount: 3,
  shardProductCounts: catalogShards.map(shard => shard.length),
  productCount: 206
};
assert.throws(() => createTegiwaCatalogHandler({
  stockIndex,
  sitemapManifest,
  catalogSummary: { ...catalogSummary, shardProductCounts: [75, 90, 40] },
  fetchImpl: noFetch
}), /invalid_catalog_summary/);

const catalogShardRequests = [];
const browseHandler = createTegiwaCatalogHandler({
  stockIndex,
  sitemapManifest,
  catalogSummary,
  now: () => FIXED_NOW,
  fetchImpl: noFetch,
  catalogLoader: async shardIndex => {
    catalogShardRequests.push(shardIndex);
    return catalogShards[shardIndex];
  }
});

const browsePageOne = await invoke(browseHandler, { query: { page: '1' } });
assert.equal(browsePageOne.status, 200);
assert.equal(browsePageOne.body.mode, 'browse');
assert.equal(browsePageOne.body.items.length, 100);
assert.equal(browsePageOne.body.items[0].handle, 'product-001');
assert.equal(browsePageOne.body.items[99].handle, 'product-100');
assert.deepEqual(browsePageOne.body.meta, {
  count: 100,
  checkedAt: '2026-08-03',
  stockSnapshotStale: false,
  catalogProductCount: 206,
  stockIndexedProductCount: 4_218,
  availableProductCount: 2_601,
  page: 1,
  pageSize: 100,
  totalPages: 3
});
assert.match(browsePageOne.body.nextCursor, /^[A-Za-z0-9_-]+$/);
assert.equal(browsePageOne.body.items[0].image.src, 'https://cdn.shopify.com/s/files/1/0000/product-001.jpg');

const browsePageTwo = await invoke(browseHandler, { query: { page: '2' } });
assert.equal(browsePageTwo.status, 200);
assert.equal(browsePageTwo.body.items.length, 100);
assert.equal(browsePageTwo.body.items[0].handle, 'product-101');
assert.equal(browsePageTwo.body.items[99].handle, 'product-200');
assert.equal(browsePageTwo.body.meta.page, 2);
assert.equal(browsePageTwo.body.meta.pageSize, 100);
assert.equal(browsePageTwo.body.meta.totalPages, 3);
assert.match(browsePageTwo.body.nextCursor, /^[A-Za-z0-9_-]+$/);

const browseFinalPage = await invoke(browseHandler, { query: { page: '3' } });
assert.equal(browseFinalPage.status, 200);
assert.deepEqual(browseFinalPage.body.items.map(item => item.handle), [
  'product-201', 'product-202', 'product-203', 'product-204', 'product-205', 'product-206'
]);
assert.equal(browseFinalPage.body.meta.page, 3);
assert.equal(browseFinalPage.body.meta.count, 6);
assert.equal(browseFinalPage.body.meta.totalPages, 3);
assert.equal(browseFinalPage.body.nextCursor, null);

const allBrowseHandles = [browsePageOne, browsePageTwo, browseFinalPage]
  .flatMap(page => page.body.items.map(item => item.handle));
assert.deepEqual(allBrowseHandles, Array.from({ length: 206 }, (_, index) => catalogRecord(index + 1)[0]));
assert.equal(new Set(allBrowseHandles).size, 206);
assert.equal((await invoke(browseHandler, { query: { page: '4' } })).body.error.code, 'invalid_page');

const browsePageTwoByCursor = await invoke(browseHandler, { query: { cursor: browsePageOne.body.nextCursor } });
assert.deepEqual(browsePageTwoByCursor.body.items, browsePageTwo.body.items);
assert.equal(browsePageTwoByCursor.body.meta.page, 2);
assert.equal(browsePageTwoByCursor.body.meta.pageSize, 100);
assert.equal(browsePageTwoByCursor.body.meta.totalPages, 3);
assert.equal(browsePageTwoByCursor.body.nextCursor, browsePageTwo.body.nextCursor);

assert.deepEqual(catalogShardRequests.slice(0, 5), [0, 1, 1, 2, 2]);
assert.deepEqual(catalogShardRequests.slice(5), [1, 2]);
assert.equal(browsePageTwoByCursor.body.nextCursor === null, false);
assert.equal(browseFinalPage.body.nextCursor, null);
assert.equal((await invoke(browseHandler, { query: { cursor: 'not-a-valid-cursor' } })).body.error.code, 'invalid_cursor');

const bundledBrowseHandler = createTegiwaCatalogHandler({ stockIndex, now: () => FIXED_NOW, fetchImpl: noFetch });
const bundledBrowse = await invoke(bundledBrowseHandler);
assert.equal(bundledBrowse.status, 200);
assert.equal(bundledBrowse.body.mode, 'browse');
assert.equal(bundledBrowse.body.items.length, 100);
assert.match(bundledBrowse.body.nextCursor, /^[A-Za-z0-9_-]+$/);
assert.ok(bundledBrowse.body.items.every(item => item.handle && item.title && item.sourceUrl.startsWith('https://www.tegiwa.com/products/')));

const productionBrowse = await invoke(productionHandler);
assert.equal(productionBrowse.status, 200);
assert.equal(productionBrowse.body.items.length, 100);
assert.equal(productionBrowse.body.meta.catalogProductCount, 193_253);
assert.equal(productionBrowse.body.meta.stockIndexedProductCount, 193_844);
assert.equal(productionBrowse.body.meta.availableProductCount, 26_349);
assert.equal(productionBrowse.body.meta.page, 1);
assert.equal(productionBrowse.body.meta.pageSize, 100);
assert.equal(productionBrowse.body.meta.totalPages, 1_933);

const productionPageTwo = await invoke(productionHandler, { query: { page: '2' } });
assert.equal(productionPageTwo.status, 200);
assert.equal(productionPageTwo.body.items.length, 100);
assert.equal(productionPageTwo.body.meta.page, 2);
assert.equal(productionPageTwo.body.meta.pageSize, 100);
assert.equal(productionPageTwo.body.meta.totalPages, 1_933);
assert.equal(new Set([
  ...productionBrowse.body.items.map(item => item.handle),
  ...productionPageTwo.body.items.map(item => item.handle)
]).size, 200);

const productionFinalPage = await invoke(productionHandler, { query: { page: '1933' } });
assert.equal(productionFinalPage.status, 200);
assert.equal(productionFinalPage.body.items.length, 53);
assert.equal(productionFinalPage.body.meta.page, 1_933);
assert.equal(productionFinalPage.body.meta.count, 53);
assert.equal(productionFinalPage.body.meta.totalPages, 1_933);
assert.equal(productionFinalPage.body.nextCursor, null);

const productionPageOutOfRange = await invoke(productionHandler, { query: { page: '1934' } });
assert.equal(productionPageOutOfRange.status, 400);
assert.equal(productionPageOutOfRange.body.error.code, 'invalid_page');

const productionSearch = await invoke(productionHandler, { query: { q: 'engine management ecu' } });
assert.equal(productionSearch.status, 200);
assert.equal(productionSearch.body.items.length, 100);
assert.ok(productionSearch.body.meta.totalResults > 100);
assert.ok(productionSearch.body.meta.totalPages > 1);
assert.equal(productionSearch.body.meta.canonicalQuery, 'engine management ecu');
assert.ok(productionSearch.body.items.every(item => item.handle && item.title && item.image?.src));
const productionSearchPageTwo = await invoke(productionHandler, { query: { q: 'engine management ecu', page: '2' } });
assert.equal(productionSearchPageTwo.body.items.length, 100);
assert.equal(new Set([
  ...productionSearch.body.items.map(item => item.handle),
  ...productionSearchPageTwo.body.items.map(item => item.handle)
]).size, 200);
const productionTypoSearch = await invoke(productionHandler, { query: { q: 'engien managment ecu' } });
assert.equal(productionTypoSearch.body.meta.canonicalQuery, 'engine management ecu');
assert.equal(productionTypoSearch.body.meta.corrected, true);
assert.deepEqual(productionTypoSearch.body.items.map(item => item.handle), productionSearch.body.items.map(item => item.handle));
const productionBrakePads = await invoke(productionHandler, { query: { q: 'brake pads' } });
assert.equal(productionBrakePads.body.items.length, 100);
assert.ok(productionBrakePads.body.meta.totalResults > 100);
const productionArabicBrakePads = await invoke(productionHandler, { query: { q: 'قطع فحمات فرامل' } });
assert.equal(productionArabicBrakePads.status, 200);
assert.equal(productionArabicBrakePads.body.meta.canonicalQuery, 'brake pads');
assert.equal(productionArabicBrakePads.body.meta.translated, true);
assert.equal(productionArabicBrakePads.body.meta.totalResults, productionBrakePads.body.meta.totalResults);
assert.deepEqual(productionArabicBrakePads.body.items.map(item => item.handle), productionBrakePads.body.items.map(item => item.handle));

const longHandle = `long-${'performance-part-'.repeat(11)}catalog-item`;
assert.ok(longHandle.length > 160 && longHandle.length < 256);
const longHandleBrowse = await invoke(createTegiwaCatalogHandler({
  stockIndex,
  sitemapManifest: [sitemapManifest[0]],
  now: () => FIXED_NOW,
  fetchImpl: noFetch,
  catalogLoader: async () => [[longHandle, 'Official long-handle product', '']]
}));
assert.equal(longHandleBrowse.status, 200);
assert.equal(longHandleBrowse.body.items[0].handle, longHandle);
assert.equal(longHandleBrowse.body.items[0].sourceUrl, `https://www.tegiwa.com/products/${longHandle}`);

const detailHandler = createTegiwaCatalogHandler({
  stockIndex: { ...stockIndex, products: {} },
  now: () => FIXED_NOW,
  fetchImpl: async url => {
    assert.equal(url, 'https://www.tegiwa.com/products/race-kit.js');
    return jsonResponse({
      id: 555,
      handle: 'race-kit',
      title: '<b>Race</b> &amp; Kit<script>alert(1)</script>',
      vendor: '<span>Tegiwa</span>',
      type: 'Track <em>Parts</em>',
      description: '<p>Fast <strong>part</strong>.</p><script>steal()</script>',
      available: true,
      inventory_quantity: 91,
      inventory_policy: 'continue',
      featured_image: 'https://private.example/leak.jpg',
      images: [
        'https://cdn.shopify.com/s/files/1/0000/race-kit.jpg',
        'javascript:alert(1)',
        'https://evil.example/race-kit.jpg'
      ],
      variants: [{
        id: 777,
        title: '<b>Black</b>',
        available: true,
        price: 12500,
        sku: 'SECRET-SKU',
        inventory_quantity: 42,
        inventory_management: 'shopify'
      }]
    });
  }
});

const detail = await invoke(detailHandler, { query: { handle: 'race-kit' } });
assert.equal(detail.status, 200);
assert.equal(detail.body.mode, 'detail');
assert.equal(detail.body.product.title, 'Race & Kit');
assert.equal(detail.body.product.description, 'Fast part .');
assert.equal(detail.body.product.vendor, 'Tegiwa');
assert.equal(detail.body.product.category, 'Track Parts');
assert.equal(detail.body.product.images.length, 1);
assert.equal(detail.body.product.image.src, 'https://cdn.shopify.com/s/files/1/0000/race-kit.jpg');
assert.deepEqual(detail.body.product.variants, [{
  title: 'Black',
  available: true,
  price: { currency: 'GBP', amount: 125 }
}]);
assert.deepEqual(detail.body.product.price, {
  currency: 'GBP', min: 125, max: 125, note: 'Tegiwa online price'
});
assert.equal(detail.body.meta.catalogProductCount, 4_218);

const serializedDetail = JSON.stringify(detail.body).toLowerCase();
for (const forbidden of ['inventory_quantity', 'inventory_policy', 'inventory_management', 'secret-sku', '"sku"', '"id"']) {
  assert.equal(serializedDetail.includes(forbidden), false, `Public detail leaked forbidden field: ${forbidden}`);
}
assert.equal(serializedDetail.includes('private.example'), false);
assert.equal(serializedDetail.includes('evil.example'), false);
assert.equal(serializedDetail.includes('<script'), false);

const failingHandler = createTegiwaCatalogHandler({
  stockIndex,
  now: () => FIXED_NOW,
  logger: { warn() {} },
  fetchImpl: async () => new Response('Service unavailable', { status: 503 })
});
const upstreamFailure = await invoke(failingHandler, { query: { handle: 'brakes' } });
assert.equal(upstreamFailure.status, 502);
assert.deepEqual(upstreamFailure.body, {
  error: {
    code: 'upstream_unavailable',
    message: 'The official Tegiwa catalog is temporarily unavailable.'
  }
});
assert.equal(upstreamFailure.headers['cache-control'], 'no-store');

console.log('PASS: Tegiwa catalog API method, origin and parameter validation');
console.log('PASS: normalized-title stock/RRP join with the generated-key fixture');
console.log('PASS: local full-catalog search, phrase ranking, typo correction and field sanitization');
console.log('PASS: 100-result search pagination has stable totals and no skips or duplicate products');
console.log('PASS: full-result stock/pricing filters and relevance/name/price sorts run before pagination');
console.log('PASS: local autocomplete, Arabic/Kuwaiti aliases, unknown Arabic safety, XSS rejection and bounded rate limiting');
console.log('PASS: bundled public-catalog browsing with numbered pages and compatible opaque cursors');
console.log('PASS: generated 194-shard catalog snapshot loads through the production file path');
console.log('PASS: product-detail sanitization, image allow-list and variant caps');
console.log('PASS: upstream failures return structured, non-cacheable errors');
console.log('PASS: exact inventory, SKU, private URLs and raw stock data are not exposed');
