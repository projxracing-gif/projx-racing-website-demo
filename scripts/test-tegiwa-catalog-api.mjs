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
assert.equal((await invoke(validationHandler, { query: { q: 'brake', page: '1' } })).body.error.code, 'invalid_parameters');
assert.equal((await invoke(validationHandler, {
  query: { q: 'brake' },
  headers: { host: 'preview.projxracing.com', origin: 'https://attacker.example' }
})).status, 403);

let searchRequestUrl;
const searchHandler = createTegiwaCatalogHandler({
  stockIndex,
  now: () => FIXED_NOW,
  fetchImpl: async url => {
    searchRequestUrl = new URL(url);
    assert.equal(searchRequestUrl.origin, 'https://tegiwa.myshopify.com');
    assert.equal(searchRequestUrl.pathname, '/search/suggest.json');
    return jsonResponse({
      resources: {
        results: {
          products: [{
            id: 999,
            handle: 'tegiwa-bmw-b58-service-kit',
            title: '<b>TEGIWA</b> BMW B58 Service Kit',
            vendor: '<i>Tegiwa</i>',
            type: 'Service <strong>Kits</strong>',
            price: '99.00',
            compare_at_price: '199.00',
            available: true,
            inventory_quantity: 83,
            sku: 'PRIVATE-SKU',
            featured_image: {
              url: 'https://cdn.shopify.com/s/files/1/0000/product.jpg',
              width: 1200,
              height: 800,
              alt: '<em>B58 service kit</em>'
            },
            url: '/products/tegiwa-bmw-b58-service-kit'
          }]
        }
      }
    });
  }
});

const search = await invoke(searchHandler, { query: { q: 'B58 service kit' } });
assert.equal(search.status, 200);
assert.equal(search.body.mode, 'search');
assert.equal(search.body.items.length, 1);
assert.equal(search.body.items[0].title, 'TEGIWA BMW B58 Service Kit');
assert.equal(search.body.items[0].vendor, 'Tegiwa');
assert.equal(search.body.items[0].category, 'Service Kits');
assert.deepEqual(search.body.items[0].price, { currency: 'GBP', min: 117.96, max: 129.99, note: 'RRP' });
assert.deepEqual(search.body.items[0].availability, {
  code: 'in_stock', checkedAt: '2026-08-03', leadTime: '2-3 working days', snapshotStale: false
});
assert.equal(search.body.items[0].image.src, 'https://cdn.shopify.com/s/files/1/0000/product.jpg');
assert.equal(search.body.items[0].sourceUrl, 'https://www.tegiwa.com/products/tegiwa-bmw-b58-service-kit');
assert.equal(search.body.meta.catalogProductCount, 4_218);
assert.equal(search.body.meta.stockIndexedProductCount, 4_218);
assert.equal(search.body.meta.availableProductCount, 2_601);
assert.equal(search.body.nextCursor, null);
assert.equal(searchRequestUrl.searchParams.get('q'), 'B58 service kit');
assert.equal(searchRequestUrl.searchParams.get('resources[limit]'), '10');
assert.match(searchRequestUrl.searchParams.get('resources[options][fields]'), /variants\.sku/);
assert.match(search.headers['cache-control'], /s-maxage=300/);
assert.equal(search.headers['x-content-type-options'], 'nosniff');
assert.equal(search.headers['cross-origin-resource-policy'], 'same-origin');
assert.equal(search.headers['access-control-allow-origin'], undefined);

const publicPriceHandler = createTegiwaCatalogHandler({
  stockIndex: { ...stockIndex, products: {} },
  now: () => FIXED_NOW,
  fetchImpl: async () => jsonResponse({
    resources: {
      results: {
        products: [{
          available: true,
          handle: 'public-price-range',
          title: 'Public price range',
          price: '89.00',
          price_min: '89.00',
          price_max: '109.00',
          compare_at_price_min: '149.00',
          compare_at_price_max: '169.00'
        }]
      }
    }
  })
});
const publicPrice = await invoke(publicPriceHandler, { query: { q: 'public price range' } });
assert.deepEqual(publicPrice.body.items[0].price, {
  currency: 'GBP', min: 89, max: 109, note: 'Tegiwa online price'
});

const staleStockHandler = createTegiwaCatalogHandler({
  stockIndex,
  now: () => Date.parse('2026-08-12T00:00:00Z'),
  fetchImpl: async () => jsonResponse({
    resources: {
      results: {
        products: [{
          available: true,
          handle: 'tegiwa-bmw-b58-service-kit',
          title: 'TEGIWA BMW B58 Service Kit',
          price: '99.00'
        }]
      }
    }
  })
});
const staleStock = await invoke(staleStockHandler, { query: { q: 'B58 service kit' } });
assert.equal(staleStock.body.items[0].availability.code, 'check_availability');
assert.equal(staleStock.body.items[0].availability.snapshotStale, true);
assert.equal(staleStock.body.meta.stockSnapshotStale, true);
assert.deepEqual(staleStock.body.items[0].price, { currency: 'GBP', min: 117.96, max: 129.99, note: 'RRP' });

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
const upstreamFailure = await invoke(failingHandler, { query: { q: 'brakes' } });
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
console.log('PASS: official search normalization and field sanitization');
console.log('PASS: bundled public-catalog browsing with numbered pages and compatible opaque cursors');
console.log('PASS: generated 194-shard catalog snapshot loads through the production file path');
console.log('PASS: product-detail sanitization, image allow-list and variant caps');
console.log('PASS: upstream failures return structured, non-cacheable errors');
console.log('PASS: exact inventory, SKU, private URLs and raw stock data are not exposed');
