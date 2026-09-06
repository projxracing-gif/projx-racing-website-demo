import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TEGIWA_LIVE_COMMERCE,
  TegiwaLiveCommerceError,
  canonicalizeTegiwaLiveProductPayload,
  canonicalTegiwaLiveProductId,
  decorateTegiwaLiveCatalogueProduct,
  isCanonicalTegiwaLiveHandle,
  isCanonicalTegiwaLiveSku,
  fetchTegiwaLiveProduct,
  resolveTegiwaLiveCartItem,
  resolveTegiwaLiveCartItems,
  validateTegiwaLiveCartItems
} from '../server/tegiwa-live-commerce.js';
import {
  TEGIWA_REFRESH_QUARANTINE,
  isTegiwaRefreshQuarantinedHandle,
  isTegiwaRefreshQuarantinedIdentity,
  isTegiwaRefreshQuarantinedSku,
  isTegiwaRefreshPriceOutlierSku
} from '../server/tegiwa-refresh-quarantine.js';

const HANDLE = 'tegiwa-2026-team-tegiwa-tsuki-t-shirt';
const OBSERVED_MS = Date.parse('2026-08-11T12:00:00.000Z');
const IMAGE = 'https://cdn.shopify.com/s/files/1/0715/5767/7352/files/Tsuki_Teamwear-2026-2.jpg?v=1769175846';
const SMALL_SKU = 'T-TSUKITEAM-TSHIRT-S';
const MEDIUM_SKU = 'T-TSUKITEAM-TSHIRT-M';
const SMALL_ID = 'tegiwa-live-DDwV-XJQ97P0W2r4JQzzg2Tq';
const MEDIUM_ID = 'tegiwa-live-mR0R-hyiDD2_pmItpUmWOgAn';
const SOURCE_URL = `https://www.tegiwa.com/products/${HANDLE}.js?country=KW`;
const QUARANTINED_HANDLE = 'king-engine-bearings-nissan-vq40de-thrustwasher';
const QUARANTINED_SKU = 'KING-TW1020AM';
const PBS_SKU = '1142PT';
const PBS_HANDLES = Object.freeze([
  'pbs-protrack-rear-brake-pads-honda-civic-type-r-ep3-fn2',
  'pbs-protrack-rear-brake-pads-honda-s2000',
  'pbs-protrack-rear-brake-pads-suzuki-swift-sport-06-12-swift-sport-challenge'
]);
const SAFE_HANDLE = 'tegiwa-live-commerce-quarantine-control';
const SAFE_SKU = 'QUARANTINE-CONTROL-SKU';

test('public detail and checkout share the exact supplier SKU grammar', () => {
  for (const sku of [SMALL_SKU, '034-401-1065', 'ABC_123', 'A+B / C']) assert.equal(isCanonicalTegiwaLiveSku(sku), true);
  for (const sku of ['', ' padded ', '<b>SKU</b>', 'javascript:alert(1)', 'x'.repeat(121)]) {
    assert.equal(isCanonicalTegiwaLiveSku(sku), false);
  }
});

test('public detail and checkout share the exact supplier handle grammar, including catalogued underscores', () => {
  assert.equal(isCanonicalTegiwaLiveHandle(HANDLE), true);
  assert.equal(isCanonicalTegiwaLiveHandle('catalogued_handle'), true);
  for (const handle of ['', 'double__underscore', 'Upper-Case', 'padded ', '../admin', 'x'.repeat(256)]) {
    assert.equal(isCanonicalTegiwaLiveHandle(handle), false);
  }
});

function productPayload(overrides = {}) {
  return {
    handle: HANDLE,
    title: '2026 Tegiwa Racing Tsuki Team T-Shirt',
    featured_image: IMAGE,
    variants: [
      {
        title: 'Small',
        sku: SMALL_SKU,
        price: 2749,
        available: true
      },
      {
        title: 'Medium',
        sku: MEDIUM_SKU,
        price: '2749',
        available: false,
        featured_image: { src: IMAGE }
      }
    ],
    ...overrides
  };
}

function jsonResponse(payload, { status = 200, headers = {}, url = '', redirected = false } = {}) {
  const response = new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  });
  if (url) Object.defineProperty(response, 'url', { configurable: true, value: url });
  if (redirected) Object.defineProperty(response, 'redirected', { configurable: true, value: true });
  return response;
}

function successFetch(payload = productPayload(), onCall = () => {}) {
  return async (url, options) => {
    onCall(url, options);
    return jsonResponse(payload);
  };
}

function submittedVariant({ size = 'Small', sku = SMALL_SKU, availableTitle = true } = {}) {
  return {
    productId: canonicalTegiwaLiveProductId(HANDLE, sku),
    sourceHandle: HANDLE,
    sku,
    quantity: 1,
    unitAmount: 27.49,
    currency: 'GBP',
    ...(availableTitle ? { title: `2026 Tegiwa Racing Tsuki Team T-Shirt — ${size}` } : {})
  };
}

function submittedIdentity(sourceHandle, sku) {
  return {
    productId: canonicalTegiwaLiveProductId(sourceHandle, sku),
    sourceHandle,
    sku,
    quantity: 1,
    unitAmount: 27.49,
    currency: 'GBP'
  };
}

async function rejectsCode(operation, code, status) {
  await assert.rejects(operation, error => {
    assert.ok(error instanceof TegiwaLiveCommerceError);
    assert.equal(error.code, code);
    if (status !== undefined) assert.equal(error.status, status);
    return true;
  });
}

test('creates stable opaque product identities from the exact handle and SKU', () => {
  const first = canonicalTegiwaLiveProductId(HANDLE, SMALL_SKU);
  const repeated = canonicalTegiwaLiveProductId(HANDLE, SMALL_SKU);
  const otherSize = canonicalTegiwaLiveProductId(HANDLE, MEDIUM_SKU);
  assert.equal(first, repeated);
  assert.equal(first, SMALL_ID);
  assert.equal(otherSize, MEDIUM_ID);
  assert.notEqual(SMALL_ID, MEDIUM_ID);
});

test('fetches only the fixed official detail URL with redirects and caching disabled', async () => {
  let calls = 0;
  const product = await fetchTegiwaLiveProduct(HANDLE, {
    fetchImpl: successFetch(productPayload(), (url, options) => {
      calls += 1;
      assert.equal(url, SOURCE_URL);
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'error');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.headers.Accept, 'application/json');
      assert.ok(options.signal instanceof AbortSignal);
    }),
    now: () => OBSERVED_MS
  });

  assert.equal(calls, 1);
  assert.equal(product.sourceHandle, HANDLE);
  assert.equal(product.sourceUrl, SOURCE_URL);
  assert.equal(product.currency, 'GBP');
  assert.deepEqual(product.supplier, {
    slug: 'tegiwa', name: 'Tegiwa', originId: 'tegiwa-gb', originCountryCode: 'GB', originCountryName: 'Great Britain'
  });
  assert.deepEqual(product.origin, { id: 'tegiwa-gb', countryCode: 'GB', countryName: 'Great Britain' });
  assert.equal(product.purchaseMode, 'availability-confirmation-required');
  assert.equal(product.paymentAllowed, false);
  assert.equal(product.paymentStatus, 'not_collected');
  assert.equal(product.stockReserved, false);
  assert.equal(product.observedAt, '2026-08-11T12:00:00.000Z');
  assert.equal(product.expiresAt, '2026-08-11T12:05:00.000Z');
  assert.equal(product.variants[0].unitAmount, 27.49);
  assert.equal(product.variants[0].productId, SMALL_ID);
  assert.equal(product.variants[0].sku, SMALL_SKU);
  assert.equal(product.variants[0].currency, 'GBP');
  assert.equal(product.variants[0].image.src, IMAGE);
  assert.equal(product.variants[1].productId, MEDIUM_ID);
  assert.equal(product.variants[1].sku, MEDIUM_SKU);
});

test('accepts Shopify product JSON served with its official JavaScript MIME type', async () => {
  const product = await fetchTegiwaLiveProduct(HANDLE, {
    fetchImpl: async () => jsonResponse(productPayload(), {
      headers: { 'content-type': 'text/javascript; charset=utf-8' }
    })
  });
  assert.equal(product.variants.length, 2);
});

test('resolves multiple variants with one supplier fetch per source handle', async () => {
  let calls = 0;
  const fetchImpl = successFetch(productPayload(), () => { calls += 1; });
  const items = await resolveTegiwaLiveCartItems([
    submittedVariant(),
    submittedVariant({ size: 'Medium', sku: MEDIUM_SKU })
  ], { fetchImpl, now: OBSERVED_MS });

  assert.equal(calls, 1);
  assert.equal(items.length, 2);
  assert.equal(items[0].variant.title, 'Small');
  assert.equal(items[0].variant.supplierAvailable, true);
  assert.equal(items[1].variant.title, 'Medium');
  assert.equal(items[1].supplierAvailable, false);
  assert.equal(items[1].purchaseMode, 'availability-confirmation-required');
  assert.equal(items[1].availabilityConfirmationRequired, true);
  assert.equal(items[1].paymentAllowed, false);
  assert.equal(items[1].paymentStatus, 'not_collected');
  assert.equal(items[1].stockReserved, false);
  assert.equal(items[1].image.src, IMAGE);
  assert.equal(items[1].observedAt, '2026-08-11T12:00:00.000Z');
  assert.equal(items[1].expiresAt, '2026-08-11T12:05:00.000Z');
  assert.deepEqual(items.map(item => item.productId), [SMALL_ID, MEDIUM_ID]);
  assert.ok(items.every(item => item.sourceUrl === SOURCE_URL));
  assert.ok(items.every(item => item.supplier.slug === 'tegiwa'));
  assert.ok(items.every(item => item.origin.id === 'tegiwa-gb'));
});

test('single-item resolver returns canonical live title, image, variant and origin', async () => {
  const item = await resolveTegiwaLiveCartItem(submittedVariant({ availableTitle: false }), {
    fetchImpl: successFetch(),
    now: OBSERVED_MS
  });
  assert.equal(item.title, '2026 Tegiwa Racing Tsuki Team T-Shirt — Small');
  assert.deepEqual(item.variant, {
    title: 'Small', sku: 'T-TSUKITEAM-TSHIRT-S', supplierAvailable: true
  });
  assert.deepEqual(item.origin, { id: 'tegiwa-gb', countryCode: 'GB', countryName: 'Great Britain' });
  assert.equal(item.image.alt, item.title);
  assert.equal(item.purchaseMode, 'availability-confirmation-required');
});

test('validation alias returns the same canonical result', async () => {
  const [item] = await validateTegiwaLiveCartItems([submittedVariant()], {
    fetchImpl: successFetch(),
    now: OBSERVED_MS
  });
  assert.equal(item.sku, SMALL_SKU);
});

test('rejects tampered product identity, SKU, price, currency and submitted title', async () => {
  const base = submittedVariant();
  const cases = [
    { ...base, productId: `${base.productId}x` },
    { ...base, sku: MEDIUM_SKU },
    { ...base, unitAmount: 1 },
    { ...base, currency: 'USD' },
    { ...base, title: 'Tampered title' }
  ];
  for (const submitted of cases) {
    await rejectsCode(
      resolveTegiwaLiveCartItem(submitted, { fetchImpl: successFetch(), now: OBSERVED_MS }),
      'tegiwa_cart_item_mismatch',
      409
    );
  }
});

test('rejects empty, oversized and duplicate cart batches before extra network work', async () => {
  let calls = 0;
  const fetchImpl = successFetch(productPayload(), () => { calls += 1; });
  await rejectsCode(resolveTegiwaLiveCartItems([], { fetchImpl }), 'invalid_tegiwa_cart_items', 400);
  await rejectsCode(
    resolveTegiwaLiveCartItems(Array.from({ length: 21 }, () => submittedVariant()), { fetchImpl }),
    'invalid_tegiwa_cart_items',
    400
  );
  await rejectsCode(
    resolveTegiwaLiveCartItems([submittedVariant(), submittedVariant()], { fetchImpl }),
    'duplicate_tegiwa_cart_item',
    409
  );
  assert.equal(calls, 0);
});

test('rejects unsafe handles without issuing a request', async () => {
  let calls = 0;
  await rejectsCode(fetchTegiwaLiveProduct('../admin', {
    fetchImpl: async () => { calls += 1; return jsonResponse(productPayload()); }
  }), 'invalid_tegiwa_handle', 400);
  assert.equal(calls, 0);
});

test('rejects redirects, non-JSON, oversized and malformed upstream responses', async () => {
  await rejectsCode(fetchTegiwaLiveProduct(HANDLE, {
    fetchImpl: async () => jsonResponse(productPayload(), { redirected: true }),
    now: OBSERVED_MS
  }), 'upstream_redirect_not_allowed');

  await rejectsCode(fetchTegiwaLiveProduct(HANDLE, {
    fetchImpl: async () => jsonResponse(productPayload(), {
      url: `https://www.tegiwa.com/products/${HANDLE}.js?country=US`
    }),
    now: OBSERVED_MS
  }), 'upstream_redirect_not_allowed');

  await rejectsCode(fetchTegiwaLiveProduct(HANDLE, {
    fetchImpl: async () => new Response('not json', { status: 200, headers: { 'content-type': 'text/html' } }),
    now: OBSERVED_MS
  }), 'upstream_invalid_content_type');

  await rejectsCode(fetchTegiwaLiveProduct(HANDLE, {
    fetchImpl: async () => jsonResponse(productPayload(), { headers: { 'content-length': '1000001' } }),
    now: OBSERVED_MS
  }), 'upstream_response_too_large');

  await rejectsCode(fetchTegiwaLiveProduct(HANDLE, {
    fetchImpl: async () => new Response('{', { status: 200, headers: { 'content-type': 'application/json' } }),
    now: OBSERVED_MS
  }), 'upstream_invalid_json');
});

test('rejects mismatched handles, invalid prices and non-allowlisted product media', async () => {
  await rejectsCode(fetchTegiwaLiveProduct(HANDLE, {
    fetchImpl: successFetch(productPayload({ handle: 'different-product' })),
    now: OBSERVED_MS
  }), 'upstream_product_mismatch');

  await rejectsCode(fetchTegiwaLiveProduct(HANDLE, {
    fetchImpl: successFetch(productPayload({ variants: [{ title: 'Small', sku: 'SKU-1', price: 0, available: true }] })),
    now: OBSERVED_MS
  }), 'upstream_invalid_price');

  await rejectsCode(fetchTegiwaLiveProduct(HANDLE, {
    fetchImpl: successFetch(productPayload({ featured_image: 'https://example.com/product.jpg', images: [] })),
    now: OBSERVED_MS
  }), 'upstream_invalid_image');
});

test('rejects duplicate upstream SKUs before they can alias one canonical product identity', async () => {
  await rejectsCode(fetchTegiwaLiveProduct(HANDLE, {
    fetchImpl: successFetch(productPayload({
      variants: [
        { title: 'Small', sku: SMALL_SKU, price: 2749, available: true },
        { title: 'Small duplicate', sku: SMALL_SKU, price: 2749, available: false }
      ]
    })),
    now: OBSERVED_MS
  }), 'upstream_duplicate_sku');
});

test('public cart decoration uses the checkout canonicalizer and caps exposed variants at 100', () => {
  const baseProduct = {
    handle: `tegiwa-${HANDLE}`,
    title: 'Stored snapshot title',
    variants: [],
    commerceObservation: { source: 'stale-client-value' }
  };
  const oneHundred = productPayload({
    variants: Array.from({ length: 100 }, (_, index) => ({
      title: `Option ${index + 1}`,
      sku: `CART-${String(index + 1).padStart(3, '0')}`,
      price: 2749 + index,
      available: index % 2 === 0
    }))
  });
  const eligible = decorateTegiwaLiveCatalogueProduct(baseProduct, oneHundred, HANDLE, { now: OBSERVED_MS });
  assert.equal(eligible.variants.length, 100);
  assert.ok(eligible.variants.every(variant => /^tegiwa-live-[A-Za-z0-9_-]{24}$/.test(variant.cartProductId)));
  assert.equal(eligible.commerceObservation.source, 'official_tegiwa_product_detail');
  assert.equal(eligible.commerceObservation.expiresAt, '2026-08-11T12:05:00.000Z');

  const oneHundredOne = productPayload({
    variants: Array.from({ length: 101 }, (_, index) => ({
      title: `Option ${index + 1}`,
      sku: `CART-${String(index + 1).padStart(3, '0')}`,
      price: 2749 + index,
      available: true
    }))
  });
  const withheld = decorateTegiwaLiveCatalogueProduct(baseProduct, oneHundredOne, HANDLE, { now: OBSERVED_MS });
  assert.equal(withheld.variants.length, 101);
  assert.ok(withheld.variants.every(variant => variant.cartProductId === null));
  assert.equal(Object.hasOwn(withheld, 'commerceObservation'), false);
});

test('September refresh quarantine is source-bound and covers audited outliers and the PBS conflict', () => {
  assert.equal(TEGIWA_REFRESH_QUARANTINE.refreshDate, '2026-09-06');
  assert.match(TEGIWA_REFRESH_QUARANTINE.audit.dealerStockSha256, /^[a-f0-9]{64}$/);
  assert.match(TEGIWA_REFRESH_QUARANTINE.audit.stockIndexSha256, /^[a-f0-9]{64}$/);
  assert.match(TEGIWA_REFRESH_QUARANTINE.audit.reportSha256, /^[a-f0-9]{64}$/);
  assert.match(TEGIWA_REFRESH_QUARANTINE.audit.priceOutlierAuditSha256, /^[a-f0-9]{64}$/);
  assert.equal(TEGIWA_REFRESH_QUARANTINE.auditedOutlierHandleCount, 37);
  assert.equal(TEGIWA_REFRESH_QUARANTINE.ambiguousHandleCount, 3);
  assert.equal(TEGIWA_REFRESH_QUARANTINE.handleCount, 40);
  assert.equal(TEGIWA_REFRESH_QUARANTINE.skuCount, 211);

  assert.equal(isTegiwaRefreshQuarantinedHandle(QUARANTINED_HANDLE), true);
  assert.equal(isTegiwaRefreshQuarantinedSku(QUARANTINED_SKU), true);
  assert.equal(isTegiwaRefreshQuarantinedSku(QUARANTINED_SKU.toLowerCase()), true);
  assert.equal(isTegiwaRefreshPriceOutlierSku(QUARANTINED_SKU), true);
  assert.equal(isTegiwaRefreshQuarantinedSku(PBS_SKU), true);
  assert.equal(isTegiwaRefreshPriceOutlierSku(PBS_SKU), false);
  assert.ok(PBS_HANDLES.every(handle => isTegiwaRefreshQuarantinedHandle(handle)));
  assert.equal(isTegiwaRefreshQuarantinedIdentity(SAFE_HANDLE, QUARANTINED_SKU), true);
  assert.equal(isTegiwaRefreshQuarantinedIdentity(QUARANTINED_HANDLE, SAFE_SKU), true);
  assert.equal(isTegiwaRefreshQuarantinedIdentity(SAFE_HANDLE, SAFE_SKU), false);
});

test('public decoration withholds cart identities and observations on either quarantine match', () => {
  const baseProduct = {
    title: 'Stored snapshot title',
    variants: [],
    commerceObservation: { source: 'stale-client-value' }
  };
  const cases = [
    {
      handle: QUARANTINED_HANDLE,
      skus: [SAFE_SKU]
    },
    {
      handle: SAFE_HANDLE,
      skus: [QUARANTINED_SKU, `${SAFE_SKU}-SIBLING`]
    },
    {
      handle: PBS_HANDLES[0],
      skus: [PBS_SKU]
    }
  ];

  for (const { handle, skus } of cases) {
    const decorated = decorateTegiwaLiveCatalogueProduct(baseProduct, productPayload({
      handle,
      variants: skus.map((sku, index) => ({ title: `Option ${index + 1}`, sku, price: 2749, available: true }))
    }), handle, { now: OBSERVED_MS });
    assert.ok(decorated.variants.every(variant => variant.cartProductId === null));
    assert.ok(decorated.variants.every(variant => variant.price === null));
    assert.ok(decorated.variants.every(variant => variant.available === true));
    assert.deepEqual(decorated.price, { currency: 'GBP', min: null, max: null, note: null });
    assert.equal(Object.hasOwn(decorated, 'commerceObservation'), false);
  }

  const unaffected = decorateTegiwaLiveCatalogueProduct(baseProduct, productPayload({
    handle: SAFE_HANDLE,
    variants: [{ title: 'Default Title', sku: SAFE_SKU, price: 2749, available: true }]
  }), SAFE_HANDLE, { now: OBSERVED_MS });
  assert.match(unaffected.variants[0].cartProductId, /^tegiwa-live-[A-Za-z0-9_-]{24}$/);
  assert.equal(unaffected.commerceObservation.source, 'official_tegiwa_product_detail');
});

test('cart resolution rejects handle and SKU quarantine matches before supplier network work', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse(productPayload());
  };

  for (const submitted of [
    submittedIdentity(QUARANTINED_HANDLE, SAFE_SKU),
    submittedIdentity(SAFE_HANDLE, QUARANTINED_SKU),
    submittedIdentity(PBS_HANDLES[1], PBS_SKU)
  ]) {
    await rejectsCode(
      resolveTegiwaLiveCartItem(submitted, { fetchImpl, now: OBSERVED_MS }),
      'tegiwa_refresh_quarantined',
      409
    );
  }
  assert.equal(calls, 0);
});

test('cart resolution still fetches and resolves an unaffected product', async () => {
  let calls = 0;
  const payload = productPayload({
    handle: SAFE_HANDLE,
    variants: [{ title: 'Default Title', sku: SAFE_SKU, price: 2749, available: true }]
  });
  const resolved = await resolveTegiwaLiveCartItem(submittedIdentity(SAFE_HANDLE, SAFE_SKU), {
    fetchImpl: successFetch(payload, () => { calls += 1; }),
    now: OBSERVED_MS
  });
  assert.equal(calls, 1);
  assert.equal(resolved.sourceHandle, SAFE_HANDLE);
  assert.equal(resolved.sku, SAFE_SKU);
});

test('public cart decoration withholds every identity when checkout validation rejects raw semantics', () => {
  for (const payload of [
    productPayload({ variants: [{ title: 'Small', sku: SMALL_SKU, price: 2749, available: 'true' }] }),
    productPayload({ title: '<b>Sanitized only by the public display</b>' }),
    productPayload({ featured_image: 'https://www.tegiwa.com/cdn/product.jpg', images: [] }),
    productPayload({ variants: Array.from({ length: 513 }, (_, index) => ({
      title: `Option ${index + 1}`, sku: `TOO-MANY-${index + 1}`, price: 2749, available: true
    })) })
  ]) {
    assert.throws(
      () => decorateTegiwaLiveCatalogueProduct({ handle: `tegiwa-${HANDLE}`, variants: [] }, payload, HANDLE, { now: OBSERVED_MS }),
      error => error instanceof TegiwaLiveCommerceError
    );
  }
  assert.throws(
    () => canonicalizeTegiwaLiveProductPayload(productPayload(), 'invalid--handle', { now: OBSERVED_MS }),
    error => error instanceof TegiwaLiveCommerceError && error.code === 'invalid_tegiwa_handle'
  );
});

test('aborts an upstream request at the configured timeout', async () => {
  const fetchImpl = async (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
  await rejectsCode(fetchTegiwaLiveProduct(HANDLE, { fetchImpl, timeoutMs: 10 }), 'upstream_timeout', 504);
});

test('public constants never claim payment, reservation, or immediate fulfilment', () => {
  assert.equal(TEGIWA_LIVE_COMMERCE.purchaseMode, 'availability-confirmation-required');
  assert.equal(TEGIWA_LIVE_COMMERCE.paymentAllowed, false);
  assert.equal(TEGIWA_LIVE_COMMERCE.paymentStatus, 'not_collected');
  assert.equal(TEGIWA_LIVE_COMMERCE.stockReserved, false);
  assert.equal(TEGIWA_LIVE_COMMERCE.maxPublicCartVariants, 100);
  assert.equal(TEGIWA_LIVE_COMMERCE.defaultTimeoutMs, 5_000);
  assert.equal(TEGIWA_LIVE_COMMERCE.defaultMaxBytes, 1_000_000);
  assert.equal(TEGIWA_LIVE_COMMERCE.defaultLiveTtlMs, 5 * 60_000);
});
