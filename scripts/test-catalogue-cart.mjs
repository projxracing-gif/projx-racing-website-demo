import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CatalogueCartError,
  resolveCatalogueCartItems,
  shippingItemsFromResolvedCart
} from '../server/catalogue-cart.js';
import { DIRECT_CART_PRODUCTS } from '../server/commerce-policy.js';
import { canonicalTegiwaLiveProductId } from '../server/tegiwa-live-commerce.js';

const NOW = Date.parse('2026-09-06T12:00:00.000Z');
const ECS_NOW = Date.parse('2026-08-21T12:00:00.000Z');
const HANDLE = 'network-free-catalogue-cart-fixture';
const IMAGE = 'https://cdn.shopify.com/s/files/1/0715/5767/7352/files/catalogue-cart-fixture.jpg?v=1';
const BLUE_SKU = 'LIVE-FIXTURE-BLUE';
const RED_SKU = 'LIVE-FIXTURE-RED';
const BLUE_ID = canonicalTegiwaLiveProductId(HANDLE, BLUE_SKU);
const RED_ID = canonicalTegiwaLiveProductId(HANDLE, RED_SKU);
const DIRECT = DIRECT_CART_PRODUCTS['tegiwa-2026-team-tegiwa-tsuki-t-shirt-m'];

function livePayload(overrides = {}) {
  return {
    handle: HANDLE,
    title: 'Network-free supplier fixture',
    featured_image: IMAGE,
    variants: [
      { title: 'Blue', sku: BLUE_SKU, price: 4599, available: true },
      { title: 'Red', sku: RED_SKU, price: '4999', available: false }
    ],
    ...overrides
  };
}

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

function fixtureFetch(payload = livePayload(), onCall = () => {}) {
  return async (url, options) => {
    onCall(url, options);
    return jsonResponse(payload);
  };
}

function liveItem({ sku = BLUE_SKU, productId = BLUE_ID, quantity = 1, unitAmount = 45.99,
  currency = 'GBP', sourceHandle = HANDLE, supplier = 'tegiwa' } = {}) {
  return { supplier, productId, sourceHandle, sku, quantity, unitAmount, currency };
}

function directItem(overrides = {}) {
  return {
    supplier: 'client-value-is-not-authoritative',
    productId: DIRECT.productId,
    sourceHandle: DIRECT.sourceHandle,
    sku: DIRECT.sku,
    quantity: 2,
    unitAmount: DIRECT.unitAmount,
    currency: DIRECT.currency,
    ...overrides
  };
}

function ecsItem(overrides = {}) {
  return {
    supplier: 'ecs',
    productId: 'ecs-mad-s55-catted-downpipes',
    sourceHandle: 'ecs-mad-s55-catted-downpipes',
    sku: 'ES#4630139',
    quantity: 1,
    unitAmount: 569,
    currency: 'USD',
    ...overrides
  };
}

async function rejectsCatalogue(operation, expectedCode = 'invalid_or_stale_cart') {
  await assert.rejects(operation, error => {
    assert.ok(error instanceof CatalogueCartError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

test('mixed direct and live variants resolve canonically in submitted order with one fetch per handle', async () => {
  let calls = 0;
  const submitted = [
    liveItem({ sku: RED_SKU, productId: RED_ID, unitAmount: 49.99, quantity: 3 }),
    directItem(),
    liveItem()
  ];
  const resolved = await resolveCatalogueCartItems(submitted, {
    now: NOW,
    fetchImpl: fixtureFetch(livePayload(), (url, options) => {
      calls += 1;
      assert.equal(url, `https://www.tegiwa.com/products/${HANDLE}.js?country=KW`);
      assert.equal(options.cache, 'no-store');
      assert.equal(options.redirect, 'error');
    })
  });

  assert.equal(calls, 1);
  assert.deepEqual(resolved.map(item => item.productId), [RED_ID, DIRECT.productId, BLUE_ID]);
  assert.deepEqual(resolved.map(item => item.source), [
    'official_tegiwa_product_detail', 'direct_policy', 'official_tegiwa_product_detail'
  ]);
  assert.deepEqual(resolved.map(item => item.sku), [RED_SKU, DIRECT.sku, BLUE_SKU]);
  assert.deepEqual(resolved.map(item => item.quantity), [3, 2, 1]);
  assert.equal(resolved[0].supplierAvailable, false);
  assert.equal(resolved[0].availabilityConfirmationRequired, true);
  assert.equal(resolved[0].paymentAllowed, false);
  assert.equal(resolved[0].stockReserved, false);
  assert.equal(resolved[1].supplier.slug, 'tegiwa', 'direct policy must replace the submitted supplier');
  assert.equal(resolved[1].supplier.originCountryCode, 'GB');
  assert.equal(resolved[1].supplierAvailable, true, 'current dealer evidence marks Medium available');
  assert.equal(resolved[2].supplierAvailable, true);
  assert.equal(resolved[2].sourceHandle, HANDLE);
  assert.equal(resolved[2].observedAt, '2026-09-06T12:00:00.000Z');
  assert.equal(resolved[2].expiresAt, '2026-09-06T12:05:00.000Z');
  assert.deepEqual(resolved[2].supplier, {
    slug: 'tegiwa',
    name: 'Tegiwa',
    originId: 'tegiwa-gb',
    originCountryCode: 'GB',
    originCountryName: 'Great Britain'
  });
});

test('shipping mapping preserves mixed cart order and only canonical fulfilment fields', async () => {
  const resolved = await resolveCatalogueCartItems([
    liveItem(),
    directItem({ quantity: 1 }),
    liveItem({ sku: RED_SKU, productId: RED_ID, unitAmount: 49.99, quantity: 4 })
  ], { now: NOW, fetchImpl: fixtureFetch() });
  const shipping = shippingItemsFromResolvedCart(resolved);

  assert.deepEqual(shipping.map(item => item.productId), [BLUE_ID, DIRECT.productId, RED_ID]);
  assert.deepEqual(shipping.map(item => item.sku), [BLUE_SKU, DIRECT.sku, RED_SKU]);
  assert.deepEqual(shipping.map(item => item.quantity), [1, 1, 4]);
  assert.deepEqual(shipping.map(item => item.purchaseMode), [
    'availability-confirmation-required', 'direct', 'availability-confirmation-required'
  ]);
  assert.deepEqual(shipping.map(item => item.variantId), [BLUE_SKU, DIRECT.variantId, RED_SKU]);
  assert.deepEqual(shipping.map(item => item.fitmentConfirmationRequired), [true, false, true]);
  assert.ok(shipping.every(item => item.supplier.slug === 'tegiwa'));
  assert.ok(shipping.every(item => item.supplier.originCountryCode === 'GB'));
  assert.deepEqual(Object.keys(shipping[0]).sort(), [
    'fitmentConfirmationRequired', 'packageData', 'productId', 'purchaseMode', 'quantity', 'sku', 'supplier', 'variantId'
  ]);
});

test('unavailable live variants remain confirmation-only and never become payment or stock promises', async () => {
  const [item] = await resolveCatalogueCartItems([
    liveItem({ sku: RED_SKU, productId: RED_ID, unitAmount: 49.99 })
  ], { now: NOW, fetchImpl: fixtureFetch() });

  assert.equal(item.supplierAvailable, false);
  assert.equal(item.availabilityConfirmationRequired, true);
  assert.equal(item.purchaseMode, 'availability-confirmation-required');
  assert.equal(item.paymentAllowed, false);
  assert.equal(item.paymentStatus, 'not_collected');
  assert.equal(item.stockReserved, false);
});

test('direct and live tampering fails closed while canonical direct provenance ignores client supplier fields', async () => {
  let calls = 0;
  const neverFetch = async () => { calls += 1; throw new Error('network must not be reached'); };
  for (const item of [
    directItem({ sku: 'TAMPERED' }),
    directItem({ unitAmount: 1 }),
    directItem({ currency: 'USD' }),
    { ...directItem(), productId: 'unknown-product' }
  ]) {
    await rejectsCatalogue(resolveCatalogueCartItems([item], { now: NOW, fetchImpl: neverFetch }));
  }
  assert.equal(calls, 0);

  for (const item of [
    liveItem({ productId: `${BLUE_ID}x` }),
    liveItem({ sourceHandle: 'different-handle' }),
    liveItem({ sku: RED_SKU }),
    liveItem({ unitAmount: 1 }),
    liveItem({ currency: 'USD' }),
    liveItem({ supplier: 'ecs' })
  ]) {
    await rejectsCatalogue(resolveCatalogueCartItems([item], { now: NOW, fetchImpl: fixtureFetch() }));
  }

  const [canonical] = await resolveCatalogueCartItems([directItem()], { now: NOW, fetchImpl: neverFetch });
  assert.equal(canonical.supplier.slug, 'tegiwa');
  assert.equal(canonical.supplier.name, 'Tegiwa');
  assert.equal(calls, 0);
});

test('duplicate live identities fail before supplier fetch while distinct variants share one fetch', async () => {
  let duplicateCalls = 0;
  await rejectsCatalogue(resolveCatalogueCartItems([
    liveItem(), liveItem({ quantity: 2 })
  ], { now: NOW, fetchImpl: fixtureFetch(livePayload(), () => { duplicateCalls += 1; }) }), 'duplicate_cart_item');
  assert.equal(duplicateCalls, 0);

  let distinctCalls = 0;
  const distinct = await resolveCatalogueCartItems([
    liveItem(), liveItem({ sku: RED_SKU, productId: RED_ID, unitAmount: 49.99 })
  ], { now: NOW, fetchImpl: fixtureFetch(livePayload(), () => { distinctCalls += 1; }) });
  assert.equal(distinctCalls, 1);
  assert.deepEqual(distinct.map(item => item.sku), [BLUE_SKU, RED_SKU]);
});

test('a legacy Tsuki policy line and the same live supplier SKU cannot coexist', async () => {
  const sourceHandle = DIRECT.sourceHandle;
  const liveProductId = canonicalTegiwaLiveProductId(sourceHandle, DIRECT.sku);
  let calls = 0;
  await rejectsCatalogue(resolveCatalogueCartItems([
    directItem({ quantity: 1 }),
    {
      supplier: 'tegiwa', productId: liveProductId, sourceHandle, sku: DIRECT.sku,
      quantity: 1, unitAmount: DIRECT.unitAmount, currency: DIRECT.currency
    }
  ], { now: NOW, fetchImpl: async () => { calls += 1; throw new Error('must not fetch'); } }), 'duplicate_cart_item');
  assert.equal(calls, 0);
});

test('raw handles with and without a tegiwa- prefix remain distinct catalogue identities', async () => {
  const handles = ['prefix-collision-fixture', 'tegiwa-prefix-collision-fixture'];
  const sku = 'SAME-SKU-DIFFERENT-PRODUCT';
  const submitted = handles.map(sourceHandle => ({
    supplier: 'tegiwa',
    productId: canonicalTegiwaLiveProductId(sourceHandle, sku),
    sourceHandle,
    sku,
    quantity: 1,
    unitAmount: 10,
    currency: 'GBP'
  }));
  const resolved = await resolveCatalogueCartItems(submitted, {
    now: NOW,
    fetchImpl: async url => {
      const match = String(url).match(/^https:\/\/www\.tegiwa\.com\/products\/([a-z0-9_-]+)\.js\?country=KW$/);
      assert.ok(match);
      return jsonResponse({
        handle: match[1],
        title: `Fixture ${match[1]}`,
        featured_image: IMAGE,
        variants: [{ title: 'Default', sku, price: 1000, available: true }]
      });
    }
  });
  assert.deepEqual(resolved.map(item => item.sourceHandle), handles);
  assert.equal(new Set(resolved.map(item => item.productId)).size, 2);
});

test('a changed live price is rejected against the submitted supplier observation', async () => {
  const changed = livePayload({
    variants: [
      { title: 'Blue', sku: BLUE_SKU, price: 4699, available: true },
      { title: 'Red', sku: RED_SKU, price: 4999, available: false }
    ]
  });
  await rejectsCatalogue(resolveCatalogueCartItems([liveItem()], {
    now: NOW,
    fetchImpl: fixtureFetch(changed)
  }));
});

test('an authoritative F8X selection resolves through the shared server index without supplier fetches', async () => {
  let calls = 0;
  const [resolved] = await resolveCatalogueCartItems([ecsItem()], {
    now: ECS_NOW,
    fetchImpl: async () => { calls += 1; throw new Error('ECS confirmation-cart must remain offline'); }
  });

  assert.equal(calls, 0);
  assert.equal(resolved.source, 'ecs_confirmation_cart_index');
  assert.equal(resolved.productId, 'ecs-mad-s55-catted-downpipes');
  assert.equal(resolved.sku, 'ES#4630139');
  assert.equal(resolved.title, 'MAD S55 Catted Downpipes M2C/M3/M4 With Flex Section');
  assert.equal(resolved.unitAmount, 569);
  assert.equal(resolved.currency, 'USD');
  assert.equal(resolved.purchaseMode, 'fitment-confirmation-required');
  assert.equal(resolved.fitmentConfirmationRequired, true);
  assert.equal(resolved.availabilityConfirmationRequired, true);
  assert.equal(resolved.paymentAllowed, false);
  assert.equal(resolved.paymentStatus, 'not_collected');
  assert.equal(resolved.stockReserved, false);
  assert.equal(resolved.supplier.originCountryCode, 'US');

  assert.deepEqual(shippingItemsFromResolvedCart([resolved]), [{
    productId: 'ecs-mad-s55-catted-downpipes',
    sku: 'ES#4630139',
    quantity: 1,
    variantId: 'ES#4630139',
    purchaseMode: 'fitment-confirmation-required',
    fitmentConfirmationRequired: true,
    packageData: null,
    supplier: {
      slug: 'ecs',
      name: 'ECS Tuning',
      originId: 'ecs-us',
      originCountryCode: 'US',
      originCountryName: 'United States'
    }
  }]);
});

test('F8X amount, identity, SKU, expiry, quarantine, and quote-only tampering fail closed', async () => {
  for (const item of [
    ecsItem({ unitAmount: 1 }),
    ecsItem({ currency: 'GBP' }),
    ecsItem({ sku: 'ES#4630140' }),
    ecsItem({ sourceHandle: 'ecs-es-4630139' }),
    ecsItem({ productId: 'ecs-es-129081', sourceHandle: 'ecs-es-129081', sku: 'ES#129081' }),
    ecsItem({ productId: 'ecs-es-4709083', sourceHandle: 'ecs-es-4709083', sku: 'ES#4709083' })
  ]) {
    await rejectsCatalogue(resolveCatalogueCartItems([item], { now: ECS_NOW }));
  }
  await rejectsCatalogue(resolveCatalogueCartItems([ecsItem()], {
    now: Date.parse('2026-09-21T00:00:00.000Z')
  }));

  const shippingOnly = { ...ecsItem() };
  delete shippingOnly.unitAmount;
  delete shippingOnly.currency;
  const [resolved] = await resolveCatalogueCartItems([shippingOnly], {
    now: ECS_NOW,
    requireMoney: false
  });
  assert.equal(resolved.unitAmount, 569);
  assert.equal(resolved.paymentAllowed, false);
});
