import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import {
  assertSkuSearchIndexFresh,
  default as productionHandler,
  createRemoteTegiwaStockReader,
  createTegiwaCatalogHandler,
  normalizeTitleForStock,
  stockKeyForTitle
} from '../api/tegiwa-catalog.js';
import {
  canonicalTegiwaPublicManifestPayload,
  signTegiwaPublicManifest
} from '../server/tegiwa-public-manifest.js';
import { tegiwaSkuMappingFingerprint } from '../server/tegiwa-sku-mapping.js';

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
const fingerprintFixture = {
  version: 2,
  checkedAt: '2026-08-03',
  skuProductCount: 1,
  products: { [STOCK_KEY_FIXTURE]: [11796, 12999, 1, 1, ['T-B58-SERVICE-KIT'], 1] }
};
const fingerprint = tegiwaSkuMappingFingerprint(fingerprintFixture);
assert.equal(assertSkuSearchIndexFresh(fingerprint, fingerprintFixture), true);
assert.equal(assertSkuSearchIndexFresh(fingerprint, JSON.stringify({
  ...fingerprintFixture,
  checkedAt: '2026-08-04',
  products: { [STOCK_KEY_FIXTURE]: [9999, 14000, 0, 0, ['T-B58-SERVICE-KIT'], 1] }
})), true);
assert.throws(() => assertSkuSearchIndexFresh(fingerprint, {
  ...fingerprintFixture,
  products: { [STOCK_KEY_FIXTURE]: [11796, 12999, 1, 1, ['T-B58-SERVICE-KIT-V2'], 1] }
}), /stale_search_sku_index/);
assert.throws(() => assertSkuSearchIndexFresh(fingerprint, {
  ...fingerprintFixture,
  products: {
    [stockKeyForTitle('A different catalog product')]: [11796, 12999, 1, 1, ['T-B58-SERVICE-KIT'], 1]
  }
}), /stale_search_sku_index/);
assert.throws(() => tegiwaSkuMappingFingerprint({
  ...fingerprintFixture,
  skuProductCount: 2
}), /invalid_search_sku_index/);

const stockIndex = {
  version: 2,
  checkedAt: '2026-08-03',
  productCount: 4_218,
  skuProductCount: 3,
  availableProductCount: 2_601,
  leadTimes: ['', '2-3 working days'],
  products: {
    [STOCK_KEY_FIXTURE]: [11796, 12999, 1, 1, ['T-B58-SERVICE-KIT'], 1],
    [stockKeyForTitle('Official Product 001')]: [5000, 5000, 1, 0, ['CAT-001'], 1],
    [stockKeyForTitle('Official Product 002')]: [6000, 6500, 2, 0, ['CAT-002-A', 'CAT-002-B'], 1],
    [stockKeyForTitle('Official Product 003')]: [7000, 7000, 1, 0, [], 2]
  }
};

const noFetch = async () => {
  throw new Error('Fetch should not have been called.');
};
const validationHandler = createTegiwaCatalogHandler({ fetchImpl: noFetch, stockIndex, now: () => FIXED_NOW });

const legacyTitle = 'Legacy Public Product';
const legacyHandler = createTegiwaCatalogHandler({
  fetchImpl: noFetch,
  now: () => FIXED_NOW,
  stockIndex: {
    version: 1,
    checkedAt: '2026-08-03',
    productCount: 1,
    availableProductCount: 1,
    leadTimes: [''],
    products: { [stockKeyForTitle(legacyTitle)]: [1000, 1000, 1, 0] }
  },
  sitemapManifest: ['https://www.tegiwa.com/sitemap_products_1.xml?from=1&to=1'],
  catalogSummary: { version: 1, shardCount: 1, shardProductCounts: [1], productCount: 1 },
  catalogLoader: async () => [['legacy-public-product', legacyTitle, '']]
});
const legacyBrowse = await invoke(legacyHandler);
assert.equal(legacyBrowse.status, 200);
assert.equal(legacyBrowse.body.meta.skuIndexedProductCount, 0);
assert.equal(legacyBrowse.body.items[0].sku, null);
assert.equal(legacyBrowse.body.items[0].skuCount, 0);

const methodRejected = await invoke(validationHandler, { method: 'POST' });
assert.equal(methodRejected.status, 405);
assert.equal(methodRejected.headers.allow, 'GET');
assert.equal(methodRejected.body.error.code, 'method_not_allowed');

assert.equal((await invoke(validationHandler, { query: { q: 'x' } })).status, 400);
assert.equal((await invoke(validationHandler, { query: { q: 'x'.repeat(121) } })).body.error.code, 'invalid_query');
assert.equal((await invoke(validationHandler, { query: { q: ['brake', 'engine'] } })).body.error.code, 'invalid_parameters');
assert.equal((await invoke(validationHandler, { query: { handle: 'Upper-Case-Handle' } })).body.error.code, 'invalid_handle');
assert.equal((await invoke(validationHandler, { query: { handle: 'a'.repeat(256) } })).body.error.code, 'invalid_handle');
assert.equal((await invoke(validationHandler, { query: { q: 'brake', cursor: 'abcd' } })).body.error.code, 'invalid_parameters');
assert.equal((await invoke(validationHandler, { query: { page: '0' } })).body.error.code, 'invalid_page');
assert.equal((await invoke(validationHandler, { query: { page: '1.5' } })).body.error.code, 'invalid_page');
assert.equal((await invoke(validationHandler, { query: { page: ['1', '2'] } })).body.error.code, 'invalid_page');
assert.equal((await invoke(validationHandler, { query: { q: 'brake', suggest: '1', page: '1' } })).body.error.code, 'invalid_parameters');
assert.equal((await invoke(validationHandler, { query: { match: 'vehicle' } })).body.error.code, 'invalid_match');
assert.equal((await invoke(validationHandler, { query: { q: 'brake', sort: 'newest' } })).body.error.code, 'invalid_sort');
assert.equal((await invoke(validationHandler, { query: { q: 'brake', availability: 'maybe' } })).body.error.code, 'invalid_availability');
assert.equal((await invoke(validationHandler, { query: { q: 'brake', pricing: 'trade' } })).body.error.code, 'invalid_pricing');
assert.equal((await invoke(validationHandler, { query: { q: 'BMW M3', match: 'broad' } })).body.error.code, 'invalid_match');
assert.equal((await invoke(validationHandler, { query: { q: 'brake', debug: '1' } })).body.error.code, 'invalid_parameters');
assert.equal((await invoke(validationHandler, {
  query: { q: 'brake' },
  headers: { host: 'preview.projxracing.com', origin: 'https://attacker.example' }
})).status, 403);

function normalizeSearch(value) {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function exactSkuSearchTerm(value) {
  const identity = String(value).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  return identity ? `projxsku${createHash('sha256').update(identity, 'utf8').digest('hex')}` : '';
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
    const combined = [
      ...normalizeSearch(`${record[1]} ${record[0].replace(/[-_]+/g, ' ')} ${(record[3] || []).join(' ')}`).split(' ').filter(Boolean),
      ...(record[3] || []).map(exactSkuSearchTerm).filter(Boolean)
    ];
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
    `https://cdn.shopify.com/s/files/1/0000/engine-${index + 1}.jpg`,
    [`SKUONLYX-${String(index + 1).padStart(3, '0')}`]
  ]),
  ...Array.from({ length: 100 }, (_, index) => [
    `ecu-engine-management-${String(index + 136).padStart(3, '0')}`,
    `Link ECU Engine Management Module ${String(index + 136).padStart(3, '0')}`,
    `https://cdn.shopify.com/s/files/1/0000/engine-${index + 136}.jpg`,
    [`SKUONLYX-${String(index + 136).padStart(3, '0')}`]
  ]),
  ...Array.from({ length: 8 }, (_, index) => [
    `performance-brake-pads-${String(index + 1).padStart(3, '0')}`,
    `Performance Brake Pads ${String(index + 1).padStart(3, '0')}`,
    `https://cdn.shopify.com/s/files/1/0000/brake-${index + 1}.jpg`,
    [`BRAKEONLY-${String(index + 1).padStart(3, '0')}`]
  ]),
  ['punctuation-sku-a', 'Fixture Hose Joiner A', '', ['FMHJ60-500']],
  ['punctuation-sku-b', 'Fixture Hose Joiner B', '', ['FMHJ-60-500']],
  ['multi-sku-fixture', 'Fixture Multi Option Product', '', ['16.1111', '16-1111', 'MULTI-EXTRA']],
  ['alpha-sku-fixture', 'Fixture Alphabetic Identifier', '', ['GPS']],
  ['numeric-sku-fixture', 'Fixture Numeric Identifier', '', ['0221504464']],
  ['long-sku-fixture', 'Fixture Long Identifier', '', [`LONG-${'X'.repeat(76)}`]],
  ['separator-heavy-sku-fixture', 'Fixture Separator Heavy Identifier', '', ['A-1-B-2-C-3-D-4-E-5-F-6-G-7-H-8-I-9-J-10-K-11']],
  ['bavarian-platform-fixture', 'BMW Chassis Platform', '', ['BMW-ONLY']],
  ['motorsport-three-fixture', 'M3 Suspension Components', '', ['M3-ONLY']],
  ['bmw-m3-fixture', 'BMW M3 Suspension Package', '', ['NOT-THE-TITLE']]
];
const searchCatalogShards = [searchRecords.slice(0, 80), searchRecords.slice(80, 170), searchRecords.slice(170)]
  .map(shard => shard.map(record => record.slice(0, 3)));
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
  searchProducts[stockKeyForTitle(record[1])] = status === 4
    ? [null, null, null, 0, record[3], 1]
    : [10_000 + index, 10_500 + index, status, 0, record[3], 1];
  if (status === 1 || status === 2) searchAvailableCount += 1;
});
const searchStockIndex = {
  version: 2,
  checkedAt: '2026-08-03',
  productCount: searchRecords.length,
  skuProductCount: searchRecords.length,
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

const filteredBrowse = await invoke(searchHandler, { query: { availability: 'in_stock', sort: 'name_asc' } });
assert.equal(filteredBrowse.status, 200);
assert.equal(filteredBrowse.body.mode, 'browse');
assert.equal(filteredBrowse.body.meta.availability, 'in_stock');
assert.equal(filteredBrowse.body.meta.sort, 'name_asc');
assert.ok(filteredBrowse.body.items.length > 0);
assert.ok(filteredBrowse.body.items.every(item => item.availability.code === 'in_stock'));
assert.deepEqual(
  filteredBrowse.body.items.map(item => item.title),
  [...filteredBrowse.body.items.map(item => item.title)].sort((left, right) => left.localeCompare(right))
);

const filteredPrices = await invoke(searchHandler, { query: { pricing: 'priced', sort: 'price_desc' } });
assert.equal(filteredPrices.status, 200);
assert.ok(filteredPrices.body.items.every(item => item.price.min !== null));
assert.ok(filteredPrices.body.items[0].price.min >= filteredPrices.body.items[1].price.min);

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
assert.equal(searchPageOne.body.items[0].sku, 'SKUONLYX-001');
assert.equal(searchPageOne.body.items[0].skuCount, 1);
assert.equal(searchPageOne.body.items[0].skuState, 'exact');
assert.match(searchPageOne.headers['cache-control'], /s-maxage=300/);
assert.equal(searchPageOne.headers['x-content-type-options'], 'nosniff');
assert.equal(searchPageOne.headers['cross-origin-resource-policy'], 'same-origin');
assert.equal(searchPageOne.headers['access-control-allow-origin'], undefined);
assert.equal(searchPageOne.headers['ratelimit-policy'], '120;w=60');

const skuSearch = await invoke(searchHandler, { query: { q: 'skuonlyx-117' } });
assert.equal(skuSearch.status, 200);
assert.equal(skuSearch.body.meta.totalResults, 1);
assert.equal(skuSearch.body.items[0].handle, 'engine-management-ecu-117');
assert.equal(skuSearch.body.items[0].sku, 'SKUONLYX-117');
assert.equal(skuSearch.body.items[0].matchedSku, 'SKUONLYX-117');
assert.equal(skuSearch.body.meta.canonicalQuery, 'skuonlyx-117');

for (const [query, handle] of [
  ['FMHJ60-500', 'punctuation-sku-a'],
  ['FMHJ-60-500', 'punctuation-sku-b'],
  ['GPS', 'alpha-sku-fixture'],
  ['0221504464', 'numeric-sku-fixture']
]) {
  const result = await invoke(searchHandler, { query: { q: query } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.items.map(item => item.handle), [handle]);
  assert.equal(result.body.items[0].matchedSku, query);
  assert.equal(result.body.meta.canonicalQuery, query);
}

const multiSkuExact = await invoke(searchHandler, { query: { q: '16.1111' } });
assert.equal(multiSkuExact.status, 200);
assert.equal(multiSkuExact.body.items[0].handle, 'multi-sku-fixture');
assert.equal(multiSkuExact.body.items[0].sku, null);
assert.equal(multiSkuExact.body.items[0].skuCount, 3);
assert.equal(multiSkuExact.body.items[0].skuState, 'multiple');
assert.equal(multiSkuExact.body.items[0].matchedSku, '16.1111');

const longSku = `LONG-${'X'.repeat(76)}`;
assert.equal(longSku.length, 81);
assert.equal((await invoke(searchHandler, { query: { q: longSku } })).body.items[0].matchedSku, longSku);
const separatorHeavySku = 'A-1-B-2-C-3-D-4-E-5-F-6-G-7-H-8-I-9-J-10-K-11';
assert.ok(normalizeSearch(separatorHeavySku).split(' ').length > 20);
assert.equal((await invoke(searchHandler, { query: { q: separatorHeavySku } })).body.items[0].matchedSku, separatorHeavySku);

const normalBmwSearch = await invoke(searchHandler, { query: { q: 'BMW M3' } });
assert.equal(normalBmwSearch.status, 200);
assert.deepEqual(normalBmwSearch.body.items.map(item => item.handle), ['bmw-m3-fixture'],
  'Multi-word smart search must prefer products matching every term instead of flooding results with one-token matches.');
assert.equal(normalBmwSearch.body.meta.canonicalQuery, 'bmw m3');
assert.equal(normalBmwSearch.body.items.some(item => Object.hasOwn(item, 'matchedSku')), false);

const vehicleBmwSearch = await invoke(searchHandler, { query: { q: 'BMW M3', match: 'vehicle' } });
assert.equal(vehicleBmwSearch.status, 200);
assert.deepEqual(vehicleBmwSearch.body.items.map(item => item.handle), ['bmw-m3-fixture']);
assert.ok(vehicleBmwSearch.body.items.every(item => /\bBMW\b/i.test(item.title) && /\bM3\b/i.test(item.title)));

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
assert.ok(priced.body.items.every(item => item.price.note === 'Supplier price excluding UK VAT'));
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
assert.ok(staleStock.body.items.every(item => item.price.min === null && item.price.max === null && item.price.note === null));
const stalePricedSearch = await invoke(staleStockHandler, { query: { q: 'brake pads', pricing: 'priced' } });
const staleRequestPriceSearch = await invoke(staleStockHandler, { query: { q: 'brake pads', pricing: 'request_price' } });
assert.equal(stalePricedSearch.body.meta.totalResults, 0);
assert.equal(staleRequestPriceSearch.body.meta.totalResults, 8);
assert.ok(staleRequestPriceSearch.body.items.every(item => item.price.min === null));
const staleBrowse = await invoke(staleStockHandler);
assert.equal(staleBrowse.body.mode, 'browse');
assert.ok(staleBrowse.body.items.every(item => item.price.min === null && item.price.max === null && item.price.note === null));

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
assert.deepEqual(browseHandler.catalogueMeta, {
  catalogProductCount: 206,
  stockIndexedProductCount: 4_218,
  skuIndexedProductCount: 3,
  availableProductCount: 2_601,
  checkedAt: '2026-08-03'
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
  skuIndexedProductCount: 3,
  availableProductCount: 2_601,
  page: 1,
  pageSize: 100,
  totalPages: 3
});
assert.match(browsePageOne.body.nextCursor, /^[A-Za-z0-9_-]+$/);
assert.equal(browsePageOne.body.items[0].image.src, 'https://cdn.shopify.com/s/files/1/0000/product-001.jpg');
assert.equal(browsePageOne.body.items[0].sku, 'CAT-001');
assert.equal(browsePageOne.body.items[0].skuCount, 1);
assert.equal(browsePageOne.body.items[0].skuState, 'exact');
assert.equal(browsePageOne.body.items[1].sku, null);
assert.equal(browsePageOne.body.items[1].skuCount, 2);
assert.equal(browsePageOne.body.items[1].skuState, 'multiple');
assert.equal(browsePageOne.body.items[2].sku, null);
assert.equal(browsePageOne.body.items[2].skuCount, 0);
assert.equal(browsePageOne.body.items[2].skuState, 'open_for_exact');

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
assert.equal(productionBrowse.body.meta.catalogProductCount, 197_881);
assert.equal(productionBrowse.body.meta.stockIndexedProductCount, 197_580);
assert.equal(productionBrowse.body.meta.skuIndexedProductCount, 192_239);
assert.equal(productionBrowse.body.meta.availableProductCount, 28_323);
assert.equal(productionBrowse.body.meta.checkedAt, '2026-09-06');
assert.equal(productionBrowse.body.meta.page, 1);
assert.equal(productionBrowse.body.meta.pageSize, 100);
assert.equal(productionBrowse.body.meta.totalPages, 1_979);
assert.equal(productionBrowse.body.items[0].handle, 'garmin-tread-powersport-sat-nav');
assert.equal(productionBrowse.body.items[0].sku, 'GAR010-02406-10');
assert.equal(productionBrowse.body.items[0].skuCount, 1);

const productionPageTwo = await invoke(productionHandler, { query: { page: '2' } });
assert.equal(productionPageTwo.status, 200);
assert.equal(productionPageTwo.body.items.length, 100);
assert.equal(productionPageTwo.body.meta.page, 2);
assert.equal(productionPageTwo.body.meta.pageSize, 100);
assert.equal(productionPageTwo.body.meta.totalPages, 1_979);
assert.equal(new Set([
  ...productionBrowse.body.items.map(item => item.handle),
  ...productionPageTwo.body.items.map(item => item.handle)
]).size, 200);

const productionFinalPage = await invoke(productionHandler, { query: { page: '1979' } });
assert.equal(productionFinalPage.status, 200);
assert.equal(productionFinalPage.body.items.length, 81);
assert.equal(productionFinalPage.body.meta.page, 1_979);
assert.equal(productionFinalPage.body.meta.count, 81);
assert.equal(productionFinalPage.body.meta.totalPages, 1_979);
assert.equal(productionFinalPage.body.nextCursor, null);

const productionPageOutOfRange = await invoke(productionHandler, { query: { page: '1980' } });
assert.equal(productionPageOutOfRange.status, 400);
assert.equal(productionPageOutOfRange.body.error.code, 'invalid_page');

const productionSearch = await invoke(productionHandler, { query: { q: 'engine management ecu' } });
assert.equal(productionSearch.status, 200);
assert.ok(productionSearch.body.items.length > 0 && productionSearch.body.items.length <= 100);
assert.equal(productionSearch.body.items.length, Math.min(100, productionSearch.body.meta.totalResults));
assert.equal(productionSearch.body.meta.totalPages, Math.ceil(productionSearch.body.meta.totalResults / 100));
assert.equal(productionSearch.body.meta.canonicalQuery, 'engine management ecu');
assert.ok(productionSearch.body.items.every(item => item.handle && item.title && item.image?.src));
assert.ok(productionSearch.body.items.every(item => Object.hasOwn(item, 'sku') && Number.isInteger(item.skuCount)));
const productionSkuSearch = await invoke(productionHandler, { query: { q: 'GAR010-02406-10' } });
assert.equal(productionSkuSearch.status, 200);
assert.ok(productionSkuSearch.body.items.some(item => item.handle === 'garmin-tread-powersport-sat-nav'));
assert.ok(productionSkuSearch.body.items.every(item => item.skuCount > 0));
assert.ok(productionSkuSearch.body.items.every(item => item.matchedSku === 'GAR010-02406-10'));
assert.equal(productionSkuSearch.body.meta.canonicalQuery, 'GAR010-02406-10');

for (const query of ['16.1111', 'FMHJ60-500', 'FMHJ-60-500', 'GPS', '0221504464']) {
  const result = await invoke(productionHandler, { query: { q: query } });
  assert.equal(result.status, 200);
  assert.ok(result.body.items.length > 0, `Expected a production SKU match for ${query}.`);
  assert.ok(result.body.items.every(item => item.matchedSku.toLocaleLowerCase('en-US') === query.toLocaleLowerCase('en-US')));
  assert.equal(result.body.meta.canonicalQuery, query);
}
const punctuationA = await invoke(productionHandler, { query: { q: 'FMHJ60-500' } });
const punctuationB = await invoke(productionHandler, { query: { q: 'FMHJ-60-500' } });
assert.equal(punctuationA.body.items.some(item => punctuationB.body.items.some(other => other.handle === item.handle)), false);
const productionMultiSku = await invoke(productionHandler, { query: { q: 'KL091672R' } });
assert.equal(productionMultiSku.status, 200);
assert.ok(productionMultiSku.body.items.some(item => item.skuCount > 1 && item.skuState === 'multiple' && item.matchedSku === 'KL091672R'));
const productionNormalBmw = await invoke(productionHandler, { query: { q: 'BMW M3' } });
assert.equal(productionNormalBmw.status, 200);
assert.equal(productionNormalBmw.body.meta.canonicalQuery, 'bmw m3');
assert.equal(productionNormalBmw.body.items.some(item => Object.hasOwn(item, 'matchedSku')), false);
const productionBroadSearch = await invoke(productionHandler, { query: { q: 'engine' } });
assert.ok(productionBroadSearch.body.meta.totalResults > 100);
const productionSearchPageTwo = await invoke(productionHandler, { query: { q: 'engine', page: '2' } });
assert.equal(productionSearchPageTwo.body.items.length, 100);
assert.equal(new Set([
  ...productionBroadSearch.body.items.map(item => item.handle),
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
    assert.equal(url, 'https://www.tegiwa.com/products/race-kit.js?country=KW');
    return jsonResponse({
      id: 555,
      handle: 'race-kit',
      title: '<b>Race</b> &amp; Kit<script>alert(1)</script>',
      vendor: '<span>Tegiwa</span>',
      type: 'Track <em>Parts</em>',
      description: '<p>Fast <strong>part</strong>.</p><script>steal()</script>',
      sku: 'RACE-KIT-PARENT',
      mpn: 'MFG-RACE-KIT',
      available: true,
      inventory_quantity: 91,
      inventory_policy: 'continue',
      featured_image: 'https://private.example/leak.jpg',
      images: [
        'https://cdn.shopify.com/s/files/1/0000/race-kit.jpg',
        'javascript:alert(1)',
        'https://evil.example/race-kit.jpg'
      ],
      variants: [
        {
          id: 777,
          title: '<b>Black</b>',
          available: true,
          price: 12500,
          sku: 'RACE-BLK-01',
          inventory_quantity: 42,
          inventory_management: 'shopify'
        },
        { id: 778, title: 'No identifier', available: false, price: 12500, sku: '' },
        { id: 779, title: 'Red', available: true, price: 12500, sku: '<b>RACE-RED-02</b>' },
        { id: 780, title: 'Unsafe', available: true, price: 12500, sku: 'javascript:alert(1)' }
      ]
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
assert.equal(detail.body.product.sku, null);
assert.equal(detail.body.product.skuCount, 3);
assert.equal(detail.body.product.skuState, 'multiple');
assert.deepEqual(detail.body.product.skus, ['RACE-KIT-PARENT', 'RACE-BLK-01', 'RACE-RED-02']);
assert.equal(detail.body.product.mpn, 'MFG-RACE-KIT');
assert.equal(detail.body.product.mpnCount, 1);
assert.deepEqual(detail.body.product.mpns, ['MFG-RACE-KIT']);
assert.deepEqual(detail.body.product.variants, [
  { title: 'Black', sku: 'RACE-BLK-01', mpn: null, available: true, price: { currency: 'GBP', amount: 125 }, cartProductId: null },
  { title: 'No identifier', sku: null, mpn: null, available: false, price: { currency: 'GBP', amount: 125 }, cartProductId: null },
  { title: 'Red', sku: 'RACE-RED-02', mpn: null, available: true, price: { currency: 'GBP', amount: 125 }, cartProductId: null },
  { title: 'Unsafe', sku: null, mpn: null, available: true, price: { currency: 'GBP', amount: 125 }, cartProductId: null }
]);
assert.deepEqual(detail.body.product.price, {
  currency: 'GBP', min: 125, max: 125, note: 'Tegiwa online price excluding UK VAT'
});
assert.equal(Object.hasOwn(detail.body.product, 'commerceObservation'), false,
  'Sanitized titles, invalid SKUs, or non-canonical media must never receive live cart provenance.');
assert.equal(detail.body.meta.catalogProductCount, 4_218);

const serializedDetail = JSON.stringify(detail.body).toLowerCase();
for (const forbidden of ['inventory_quantity', 'inventory_policy', 'inventory_management', 'javascript:alert', '"id"']) {
  assert.equal(serializedDetail.includes(forbidden), false, `Public detail leaked forbidden field: ${forbidden}`);
}
assert.equal(serializedDetail.includes('private.example'), false);
assert.equal(serializedDetail.includes('evil.example'), false);
assert.equal(serializedDetail.includes('<script'), false);

const consistentPriceTitle = 'Haltech Throttle Position Sensor';
const consistentPriceHandle = 'haltech-throttle-position-sensor';
const consistentPrice = { currency: 'GBP', min: 112.5, max: 112.5, note: 'Supplier price excluding UK VAT' };
const consistentPriceHandler = createTegiwaCatalogHandler({
  stockIndex: {
    version: 2,
    checkedAt: '2026-08-03',
    productCount: 1,
    skuProductCount: 1,
    availableProductCount: 1,
    leadTimes: [''],
    products: { [stockKeyForTitle(consistentPriceTitle)]: [11250, 11250, 1, 0, ['HT-011-012'], 1] }
  },
  sitemapManifest: ['https://www.tegiwa.com/sitemap_products_1.xml?from=1&to=1'],
  catalogSummary: { version: 1, shardCount: 1, shardProductCounts: [1], productCount: 1 },
  catalogLoader: async () => [[
    consistentPriceHandle,
    consistentPriceTitle,
    'https://cdn.shopify.com/s/files/1/0000/haltech-tps.jpg'
  ]],
  now: () => FIXED_NOW,
  fetchImpl: async (url, options) => {
    assert.equal(url, `https://www.tegiwa.com/products/${consistentPriceHandle}.js?country=KW`);
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return jsonResponse({
      handle: consistentPriceHandle,
      title: consistentPriceTitle,
      vendor: 'Haltech',
      type: 'Sensors',
      available: true,
      featured_image: 'https://cdn.shopify.com/s/files/1/0000/haltech-tps.jpg',
      variants: [{ title: 'Default', available: true, price: 11250, sku: 'HT-011-012' }]
    });
  }
});
const consistentPriceBrowse = await invoke(consistentPriceHandler);
assert.equal(consistentPriceBrowse.status, 200);
assert.equal(consistentPriceBrowse.body.items.length, 1);
assert.deepEqual(consistentPriceBrowse.body.items[0].price, consistentPrice);
const consistentPriceDetail = await invoke(consistentPriceHandler, { query: { handle: consistentPriceHandle } });
assert.equal(consistentPriceDetail.status, 200);
assert.deepEqual(consistentPriceDetail.body.product.price, {
  ...consistentPrice,
  note: 'Tegiwa online price excluding UK VAT'
});
assert.deepEqual(consistentPriceDetail.body.product.variants, [{
  title: 'Default',
  sku: 'HT-011-012',
  mpn: null,
  available: true,
  price: { currency: 'GBP', amount: 112.5 },
  cartProductId: 'tegiwa-live-ImmKCZE_OV7268opZyPVB4nb'
}]);
assert.deepEqual(consistentPriceDetail.body.product.commerceObservation, {
  source: 'official_tegiwa_product_detail',
  observedAt: new Date(FIXED_NOW).toISOString(),
  expiresAt: new Date(FIXED_NOW + 5 * 60_000).toISOString(),
  priceCurrency: 'GBP',
  availabilityMode: 'supplier_variant_boolean',
  paymentEligible: false
});
assert.equal(consistentPriceBrowse.body.items[0].price.min, consistentPriceDetail.body.product.variants[0].price.amount);

const duplicateVariantHandler = createTegiwaCatalogHandler({
  stockIndex: {
    version: 2,
    checkedAt: '2026-08-03',
    productCount: 1,
    skuProductCount: 1,
    availableProductCount: 1,
    leadTimes: [''],
    products: { [stockKeyForTitle('Duplicate Variant Product')]: [1000, 1000, 1, 0, ['DUP-SKU'], 1] }
  },
  sitemapManifest: ['https://www.tegiwa.com/sitemap_products_1.xml?from=1&to=1'],
  catalogSummary: { version: 1, shardCount: 1, shardProductCounts: [1], productCount: 1 },
  catalogLoader: async () => [['duplicate-variant-product', 'Duplicate Variant Product', '']],
  fetchImpl: async () => jsonResponse({
    handle: 'duplicate-variant-product',
    title: 'Duplicate Variant Product',
    vendor: 'Tegiwa',
    type: 'Test',
    featured_image: 'https://cdn.shopify.com/s/files/1/0000/duplicate.jpg',
    variants: [
      { title: 'First', available: true, price: 1000, sku: 'DUP-SKU' },
      { title: 'Second', available: true, price: 1000, sku: 'DUP-SKU' }
    ]
  })
});
const duplicateVariantDetail = await invoke(duplicateVariantHandler, { query: { handle: 'duplicate-variant-product' } });
assert.equal(duplicateVariantDetail.status, 200);
assert.deepEqual(duplicateVariantDetail.body.product.variants.map(item => item.cartProductId), [null, null]);
assert.equal(Object.hasOwn(duplicateVariantDetail.body.product, 'commerceObservation'), false);

function cartGateDetailHandler(handle, payload) {
  return createTegiwaCatalogHandler({
    stockIndex: { ...stockIndex, products: {} },
    now: () => FIXED_NOW,
    fetchImpl: async () => jsonResponse({
      handle,
      title: 'Cart Gate Fixture',
      featured_image: 'https://cdn.shopify.com/s/files/1/0000/cart-gate.jpg',
      ...payload
    })
  });
}

const nonBooleanAvailabilityDetail = await invoke(cartGateDetailHandler('non-boolean-availability', {
  variants: [{ title: 'Default', sku: 'BOOL-001', price: 1000, available: 'true' }]
}), { query: { handle: 'non-boolean-availability' } });
assert.equal(nonBooleanAvailabilityDetail.status, 200);
assert.equal(nonBooleanAvailabilityDetail.body.product.variants[0].cartProductId, null);
assert.equal(Object.hasOwn(nonBooleanAvailabilityDetail.body.product, 'commerceObservation'), false);

for (const variantCount of [101, 513]) {
  const handle = `variant-cap-${variantCount}`;
  const cappedDetail = await invoke(cartGateDetailHandler(handle, {
    variants: Array.from({ length: variantCount }, (_, index) => ({
      title: `Option ${index + 1}`,
      sku: `CAP-${variantCount}-${String(index + 1).padStart(3, '0')}`,
      price: 1000 + index,
      available: true
    }))
  }), { query: { handle } });
  assert.equal(cappedDetail.status, 200);
  assert.equal(cappedDetail.body.product.variants.length, variantCount);
  assert.ok(cappedDetail.body.product.variants.every(variant => variant.cartProductId === null));
  assert.equal(Object.hasOwn(cappedDetail.body.product, 'commerceObservation'), false);
}

const nonCanonicalCartImageDetail = await invoke(cartGateDetailHandler('non-canonical-cart-image', {
  featured_image: 'https://www.tegiwa.com/cdn/non-canonical-cart-image.jpg',
  variants: [{ title: 'Default', sku: 'IMAGE-001', price: 1000, available: true }]
}), { query: { handle: 'non-canonical-cart-image' } });
assert.equal(nonCanonicalCartImageDetail.status, 200);
assert.equal(nonCanonicalCartImageDetail.body.product.variants[0].cartProductId, null);
assert.equal(Object.hasOwn(nonCanonicalCartImageDetail.body.product, 'commerceObservation'), false);

const staleSupplierFreshOfficialHandler = createTegiwaCatalogHandler({
  stockIndex: {
    version: 2,
    checkedAt: '2026-08-03',
    productCount: 1,
    skuProductCount: 1,
    availableProductCount: 1,
    leadTimes: [''],
    products: { [stockKeyForTitle(consistentPriceTitle)]: [11250, 11250, 1, 0, ['HT-011-012'], 1] }
  },
  sitemapManifest: ['https://www.tegiwa.com/sitemap_products_1.xml?from=1&to=1'],
  catalogSummary: { version: 1, shardCount: 1, shardProductCounts: [1], productCount: 1 },
  catalogLoader: async () => [[consistentPriceHandle, consistentPriceTitle, '']],
  now: () => Date.parse('2026-08-12T00:00:00.000Z'),
  fetchImpl: async () => jsonResponse({
    handle: consistentPriceHandle,
    title: consistentPriceTitle,
    vendor: 'Haltech',
    type: 'Sensors',
    available: true,
    variants: [{ title: 'Default', available: true, price: 13500, sku: 'HT-011-012' }]
  })
});
const staleSupplierBrowse = await invoke(staleSupplierFreshOfficialHandler);
assert.deepEqual(staleSupplierBrowse.body.items[0].price, { currency: 'GBP', min: null, max: null, note: null });
const freshOfficialDetail = await invoke(staleSupplierFreshOfficialHandler, { query: { handle: consistentPriceHandle } });
assert.deepEqual(freshOfficialDetail.body.product.price, {
  currency: 'GBP', min: 135, max: 135, note: 'Tegiwa online price excluding UK VAT'
});
assert.equal(freshOfficialDetail.body.product.variants[0].price.amount, 135);

const dedupeTitle = 'Large Deduplicated SKU Product';
const dedupeSkus = Array.from({ length: 1_100 }, (_, index) => `DEDUP-${String(index).padStart(4, '0')}`);
const dedupeHandler = createTegiwaCatalogHandler({
  stockIndex: {
    version: 2,
    checkedAt: '2026-08-03',
    productCount: 1,
    skuProductCount: 1,
    availableProductCount: 1,
    leadTimes: [''],
    products: { [stockKeyForTitle(dedupeTitle)]: [1000, 1000, 1, 0, dedupeSkus, 1] }
  },
  now: () => FIXED_NOW,
  fetchImpl: async () => jsonResponse({
    handle: 'large-deduplicated-sku-product',
    title: dedupeTitle,
    sku: dedupeSkus[0],
    variants: dedupeSkus.map((sku, index) => ({ title: `Option ${index + 1}`, sku, available: true, price: 1000 }))
  })
});
const dedupeDetail = await invoke(dedupeHandler, { query: { handle: 'large-deduplicated-sku-product' } });
assert.equal(dedupeDetail.status, 200);
assert.equal(dedupeDetail.body.product.skuCount, 1_100);
assert.equal(dedupeDetail.body.product.skus[0], 'DEDUP-0000');
assert.equal(dedupeDetail.body.product.skus.at(-1), 'DEDUP-1099');

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

const missingOfficialHandler = createTegiwaCatalogHandler({
  stockIndex,
  now: () => FIXED_NOW,
  logger: { warn() {} },
  fetchImpl: async () => new Response('Not found', { status: 404 })
});
const missingOfficial = await invoke(missingOfficialHandler, { query: { handle: 'missing-official-product' } });
assert.equal(missingOfficial.status, 404);
assert.equal(missingOfficial.body.error.code, 'product_not_found');

const remoteStockTitle = 'Remote Stock Product';
const remoteStockHandle = 'remote-stock-product';
const remoteStockKey = stockKeyForTitle(remoteStockTitle);
const bundledRemoteFallback = {
  version: 2,
  priceBasis: 'gbp_ex_uk_vat',
  checkedAt: '2026-08-03',
  productCount: 1,
  skuProductCount: 1,
  availableProductCount: 1,
  leadTimes: ['', '2-3 working days'],
  products: { [remoteStockKey]: [1000, 1000, 1, 1, ['REMOTE-001'], 1] }
};
const validRemoteStock = {
  ...bundledRemoteFallback,
  checkedAt: '2026-08-05',
  products: { [remoteStockKey]: [1250, 1250, 2, 1, ['REMOTE-001'], 1] }
};
const remoteManifestUrl = 'https://catalogue.example.com/tegiwa/current.json';
const remoteArtifactUrl = 'https://catalogue.example.com/tegiwa/releases/release-1.json';
const remoteMappingFingerprint = tegiwaSkuMappingFingerprint(bundledRemoteFallback);
const remoteArtifactBuffer = Buffer.from(JSON.stringify(validRemoteStock), 'utf8');
const remoteArtifactSha256 = createHash('sha256').update(remoteArtifactBuffer).digest('hex');
const remoteManifestSecret = Buffer.alloc(48, 0x5a).toString('base64url');
let remoteClock = Date.parse('2026-08-05T12:00:00.000Z');

function remoteManifest(artifactBuffer = remoteArtifactBuffer, overrides = {}) {
  const unsigned = {
    version: 2,
    vendor: 'Tegiwa',
    releaseId: 'release-1',
    retrievedAt: '2026-08-05T11:50:00.000Z',
    publishedAt: '2026-08-05T11:55:00.000Z',
    expiresAt: '2026-08-05T13:50:00.000Z',
    counts: { productCount: 1, skuProductCount: 1, availableProductCount: 1 },
    artifact: {
      url: remoteArtifactUrl,
      bytes: artifactBuffer.length,
      sha256: createHash('sha256').update(artifactBuffer).digest('hex')
    },
    ...overrides
  };
  return { ...unsigned, signature: signTegiwaPublicManifest(unsigned, remoteManifestSecret) };
}

const canonicalManifestFixture = remoteManifest();
const canonicalManifestPayload = JSON.stringify([
  2,
  'Tegiwa',
  'release-1',
  '2026-08-05T11:50:00.000Z',
  '2026-08-05T11:55:00.000Z',
  '2026-08-05T13:50:00.000Z',
  1,
  1,
  1,
  remoteArtifactUrl,
  remoteArtifactBuffer.length,
  remoteArtifactSha256
]);
assert.equal(canonicalTegiwaPublicManifestPayload(canonicalManifestFixture), canonicalManifestPayload);
assert.equal(
  canonicalManifestFixture.signature,
  createHmac('sha256', remoteManifestSecret).update(canonicalManifestPayload, 'utf8').digest('hex')
);

function bufferResponse(buffer) {
  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(buffer.length)
    }
  });
}

function remoteBrowseHandler(remoteStockReader) {
  return createTegiwaCatalogHandler({
    fetchImpl: noFetch,
    stockIndex: bundledRemoteFallback,
    remoteStockReader,
    now: () => remoteClock,
    sitemapManifest: ['https://www.tegiwa.com/sitemap_products_1.xml?from=1&to=1'],
    catalogSummary: { version: 1, shardCount: 1, shardProductCounts: [1], productCount: 1 },
    catalogLoader: async () => [[remoteStockHandle, remoteStockTitle, '']]
  });
}

let remoteFetchCount = 0;
let remoteUpstreamAvailable = true;
const validRemoteReader = createRemoteTegiwaStockReader({
  manifestUrl: remoteManifestUrl,
  manifestSecret: remoteManifestSecret,
  expectedSkuMappingFingerprint: remoteMappingFingerprint,
  now: () => remoteClock,
  ttlMs: 60_000,
  failureTtlMs: 1_000,
  fetchImpl: async url => {
    remoteFetchCount += 1;
    if (!remoteUpstreamAvailable) throw new Error('Simulated remote outage');
    if (url === remoteManifestUrl) return jsonResponse(remoteManifest(), 200, { 'Content-Length': String(Buffer.byteLength(JSON.stringify(remoteManifest()))) });
    if (url === remoteArtifactUrl) return bufferResponse(remoteArtifactBuffer);
    throw new Error('Unexpected remote URL');
  }
});
const remoteBrowse = await invoke(remoteBrowseHandler(validRemoteReader));
assert.equal(remoteBrowse.status, 200);
assert.equal(remoteBrowse.body.meta.checkedAt, '2026-08-05T11:50:00.000Z');
assert.equal(remoteBrowse.body.meta.stockPublishedAt, '2026-08-05T11:55:00.000Z');
assert.equal(remoteBrowse.body.meta.stockExpiresAt, '2026-08-05T13:50:00.000Z');
assert.equal(remoteBrowse.body.items[0].price.min, 12.5);
assert.equal(remoteBrowse.body.items[0].availability.code, 'supplier_stock');
assert.equal(remoteFetchCount, 2);
const serializedRemoteBrowse = JSON.stringify(remoteBrowse.body);
assert.equal(serializedRemoteBrowse.includes('catalogue.example.com'), false);
assert.equal(serializedRemoteBrowse.includes('release-1'), false);
assert.equal(serializedRemoteBrowse.includes(remoteManifestSecret), false);
assert.equal(serializedRemoteBrowse.includes(canonicalManifestFixture.signature), false);
await invoke(remoteBrowseHandler(validRemoteReader));
assert.equal(remoteFetchCount, 2, 'A verified release should be served from the in-memory TTL cache.');
remoteClock += 60_001;
await invoke(remoteBrowseHandler(validRemoteReader));
assert.equal(remoteFetchCount, 4, 'The manifest and artifact should be checked again after the TTL.');

remoteClock += 60_001;
remoteUpstreamAvailable = false;
const retainedAfterFailure = await invoke(remoteBrowseHandler(validRemoteReader));
assert.equal(remoteFetchCount, 5, 'A failed refresh should perform only the failed manifest request.');
assert.equal(retainedAfterFailure.body.meta.checkedAt, '2026-08-05T11:50:00.000Z');
assert.equal(retainedAfterFailure.body.items[0].price.min, 12.5);
assert.equal(retainedAfterFailure.body.items[0].availability.code, 'supplier_stock');
await invoke(remoteBrowseHandler(validRemoteReader));
assert.equal(remoteFetchCount, 5, 'The bounded failure backoff should continue serving last-known-good data.');

remoteClock = Date.parse('2026-08-05T13:50:00.001Z');
const staleRemoteBrowse = await invoke(remoteBrowseHandler(validRemoteReader));
assert.equal(staleRemoteBrowse.body.meta.stockSnapshotStale, true);
assert.equal(staleRemoteBrowse.body.items[0].availability.code, 'check_availability');
assert.deepEqual(staleRemoteBrowse.body.items[0].price, { currency: 'GBP', min: null, max: null, note: null });
remoteClock = Date.parse('2026-08-06T13:50:00.001Z');
const retiredRemoteBrowse = await invoke(remoteBrowseHandler(validRemoteReader));
assert.equal(retiredRemoteBrowse.body.meta.checkedAt, '2026-08-03');
assert.equal(retiredRemoteBrowse.body.items[0].price.min, 10);
remoteUpstreamAvailable = true;
remoteClock = Date.parse('2026-08-05T12:00:00.000Z');

async function assertRemoteFallback({ manifest, artifact = remoteArtifactBuffer, manifestUrl = remoteManifestUrl, expectedFetchCount }) {
  let fetchCount = 0;
  const reader = createRemoteTegiwaStockReader({
    manifestUrl,
    manifestSecret: remoteManifestSecret,
    expectedSkuMappingFingerprint: remoteMappingFingerprint,
    now: () => remoteClock,
    failureTtlMs: 1_000,
    fetchImpl: async url => {
      fetchCount += 1;
      if (url === manifestUrl) return jsonResponse(manifest, 200, { 'Content-Length': String(Buffer.byteLength(JSON.stringify(manifest))) });
      return bufferResponse(artifact);
    }
  });
  const result = await invoke(remoteBrowseHandler(reader));
  assert.equal(result.status, 200);
  assert.equal(result.body.meta.checkedAt, '2026-08-03');
  assert.equal(result.body.items[0].price.min, 10);
  assert.equal(fetchCount, expectedFetchCount);
}

const incompatibleRemoteStock = {
  ...validRemoteStock,
  products: { [remoteStockKey]: [1250, 1250, 2, 1, ['REMOTE-002'], 1] }
};
const incompatibleArtifact = Buffer.from(JSON.stringify(incompatibleRemoteStock), 'utf8');
await assertRemoteFallback({
  manifest: remoteManifest(incompatibleArtifact),
  artifact: incompatibleArtifact,
  expectedFetchCount: 2
});
await assertRemoteFallback({
  manifest: remoteManifest(remoteArtifactBuffer, {
    artifact: { url: remoteArtifactUrl, bytes: remoteArtifactBuffer.length, sha256: '0'.repeat(64) }
  }),
  expectedFetchCount: 2
});
await assertRemoteFallback({
  manifest: remoteManifest(remoteArtifactBuffer, {
    artifact: { url: 'https://other.example.com/tegiwa/release.json', bytes: remoteArtifactBuffer.length, sha256: remoteArtifactSha256 }
  }),
  expectedFetchCount: 1
});

const signedBeforeTampering = remoteManifest();
await assertRemoteFallback({
  manifest: {
    ...signedBeforeTampering,
    counts: { productCount: 2, skuProductCount: 1, availableProductCount: 1 }
  },
  expectedFetchCount: 1
});

await assertRemoteFallback({
  manifest: { ...remoteManifest(), privateSource: { path: 'never-public', sha256: '0'.repeat(64) } },
  expectedFetchCount: 1
});

const launderedStock = { ...validRemoteStock, checkedAt: '2026-08-04' };
const launderedArtifact = Buffer.from(JSON.stringify(launderedStock), 'utf8');
await assertRemoteFallback({
  manifest: remoteManifest(launderedArtifact),
  artifact: launderedArtifact,
  expectedFetchCount: 2
});

await assertRemoteFallback({
  manifest: remoteManifest(remoteArtifactBuffer, {
    retrievedAt: '2026-08-02T11:50:00.000Z',
    publishedAt: '2026-08-02T11:55:00.000Z',
    expiresAt: '2026-08-02T13:50:00.000Z'
  }),
  expectedFetchCount: 1
});

await assertRemoteFallback({
  manifest: remoteManifest(remoteArtifactBuffer, {
    retrievedAt: '2026-08-05T12:10:00.000Z',
    publishedAt: '2026-08-05T12:11:00.000Z',
    expiresAt: '2026-08-05T13:10:00.000Z'
  }),
  expectedFetchCount: 1
});

await assertRemoteFallback({
  manifest: remoteManifest(remoteArtifactBuffer, {
    publishedAt: '2026-08-05T13:00:00.000Z',
    expiresAt: '2026-08-05T12:59:59.999Z'
  }),
  expectedFetchCount: 1
});

assert.throws(() => createRemoteTegiwaStockReader({
  manifestUrl: remoteManifestUrl,
  expectedSkuMappingFingerprint: remoteMappingFingerprint
}), /server-only stock-manifest secret/);
assert.throws(() => createRemoteTegiwaStockReader({
  manifestUrl: 'http://catalogue.example.com/tegiwa/current.json',
  manifestSecret: remoteManifestSecret,
  expectedSkuMappingFingerprint: remoteMappingFingerprint
}), /canonical public HTTPS/);

console.log('PASS: Tegiwa catalog API method, origin and parameter validation');
console.log('PASS: normalized-title stock/RRP join with the generated-key fixture');
console.log('PASS: local full-catalog title/SKU search, phrase ranking, typo correction and field sanitization');
console.log('PASS: 100-result search pagination has stable totals and no skips or duplicate products');
console.log('PASS: full-result stock/pricing filters and relevance/name/price sorts run before pagination');
console.log('PASS: local autocomplete, Arabic/Kuwaiti aliases, unknown Arabic safety, XSS rejection and bounded rate limiting');
console.log('PASS: bundled public-catalog browsing with numbered pages and compatible opaque cursors');
console.log('PASS: generated 199-shard catalog snapshot loads through the production file path');
console.log('PASS: product/variant SKU and MPN sanitization, missing identifiers, image allow-list and variant caps');
console.log('PASS: upstream failures return structured, non-cacheable errors');
console.log('PASS: duplicate-title SKU suppression keeps exact inventory, private URLs and raw stock data unexposed');
console.log('PASS: signed HTTPS stock releases reject tampering/timestamp laundering and retain bounded last-known-good data');
