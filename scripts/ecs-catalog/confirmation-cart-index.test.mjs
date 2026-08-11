import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  ECS_CONFIRMATION_CART_EXPECTED_PRODUCT_COUNT,
  buildEcsConfirmationCartIndex,
  classifyEcsObservedAvailability,
  createEcsConfirmationCartResolver,
  evaluateEcsConfirmationCartEligibility,
  validateEcsConfirmationCartIndex
} from '../../server/ecs-confirmation-cart-sellability.js';
import {
  ECS_CONFIRMATION_CART_INDEX_DOCUMENT,
  ECS_CONFIRMATION_CART_INDEX_PATH,
  decorateEcsConfirmationCartProduct,
  getEcsConfirmationCartIndexStatus,
  lookupEcsConfirmationCartCommerce,
  lookupEcsConfirmationCartEligibility,
  resolveEcsConfirmationCartSelection
} from '../../server/ecs-confirmation-cart-index.js';
import { generateEcsConfirmationCartIndex } from './build-confirmation-cart-index.mjs';

const AS_OF = '2026-08-11T12:00:00.000Z';
const AS_OF_MS = Date.parse(AS_OF);
const SOURCE_HASH = 'a'.repeat(64);
const BASE_HASH = 'b'.repeat(64);

function eligibleProduct(overrides = {}) {
  return {
    provider: 'ECS Tuning',
    providerSlug: 'ecs',
    publicKey: 'ecs-test-product',
    slug: 'test-product',
    sku: 'ES#123456',
    ecsPartNumber: 'ES#123456',
    title: 'Verified ECS test product',
    quoteOnly: false,
    purchaseMode: 'fitment-confirmation-required',
    priceAmount: 129.99,
    priceCurrency: 'USD',
    priceStartingAt: false,
    priceConflict: false,
    priceVerifiedAt: '2026-08-09',
    checkedAt: '2026-08-09',
    stockObservedAt: '2026-08-09',
    staleAfterDays: 7,
    observedAvailability: 'In Stock at Vendor',
    imageStatus: 'supplier-media-verified',
    images: [{ src: 'assets/products/ecs/test-product.jpg' }],
    options: [],
    variants: [],
    shipping: { origin: 'United States' },
    ...overrides
  };
}

test('eligibility is fail-closed and preserves exact supplier observations', () => {
  const result = evaluateEcsConfirmationCartEligibility(eligibleProduct(), { nowValue: AS_OF_MS });
  assert.equal(result.eligible, true);
  assert.deepEqual(result.entry, {
    productId: 'ecs-test-product',
    slug: 'test-product',
    sku: 'ES#123456',
    title: 'Verified ECS test product',
    imageSrc: '/assets/products/ecs/test-product.jpg',
    unitAmountMinor: 12999,
    priceObservedAt: '2026-08-09',
    availabilityObservedAt: '2026-08-09',
    expiresAt: '2026-09-08T23:59:59.999Z',
    observedAvailability: 'In Stock at Vendor',
    availabilityClass: 'observed-stock'
  });

  const failures = [
    [{ provider: 'Other' }, 'invalid_supplier'],
    [{ sku: '123456' }, 'invalid_identity'],
    [{ priceAmount: 0 }, 'invalid_price'],
    [{ priceCurrency: 'GBP' }, 'invalid_price'],
    [{ priceStartingAt: true }, 'unsafe_purchase_policy'],
    [{ priceConflict: true }, 'unsafe_purchase_policy'],
    [{ quoteOnly: true }, 'unsafe_purchase_policy'],
    [{ purchaseMode: 'direct' }, 'unsafe_purchase_policy'],
    [{ options: [{ name: 'Size' }] }, 'unresolved_options'],
    [{ variants: [{ sku: 'ES#123457' }] }, 'unresolved_options'],
    [{ priceVerifiedAt: '2026-08-01' }, 'stale_price'],
    [{ stockObservedAt: '2026-08-01' }, 'stale_availability'],
    [{ observedAvailability: 'Back Ordered' }, 'unconfirmed_availability'],
    [{ imageStatus: 'supplier-media-unavailable' }, 'unverified_image'],
    [{ images: [] }, 'unverified_image'],
    [{ shipping: { origin: 'Unknown' } }, 'invalid_supplier']
  ];
  for (const [overrides, reason] of failures) {
    assert.deepEqual(
      evaluateEcsConfirmationCartEligibility(eligibleProduct(overrides), { nowValue: AS_OF_MS }),
      { eligible: false, reason }
    );
  }
  assert.equal(
    evaluateEcsConfirmationCartEligibility(eligibleProduct({
      priceVerifiedAt: '2026-08-11', stockObservedAt: '2026-08-11', checkedAt: '2026-08-11'
    }), { nowValue: AS_OF_MS }).eligible,
    true,
    'a date-only observation represents the observed UTC day, not a future end-of-day timestamp'
  );
});

test('only positive dated supplier observations are admitted', () => {
  assert.equal(classifyEcsObservedAvailability('In Stock', AS_OF_MS), 'observed-stock');
  assert.equal(classifyEcsObservedAvailability('In Stock at Vendor', AS_OF_MS), 'observed-stock');
  assert.equal(classifyEcsObservedAvailability('Ships in 1-2 days', AS_OF_MS), 'observed-dispatch-window');
  assert.equal(classifyEcsObservedAvailability('Ships in 7 Business Days', AS_OF_MS), 'observed-dispatch-window');
  assert.equal(classifyEcsObservedAvailability('Ships on Aug 25, 2026', AS_OF_MS), 'observed-future-ship-date');
  assert.equal(classifyEcsObservedAvailability('Ships on Aug 10, 2026', AS_OF_MS), null);
  assert.equal(classifyEcsObservedAvailability('Back Ordered', AS_OF_MS), null);
  assert.equal(classifyEcsObservedAvailability('Special Order: No Guaranteed ETA', AS_OF_MS), null);
});

test('small index builds are deterministic regardless of source order', () => {
  const products = [
    eligibleProduct(),
    eligibleProduct({
      publicKey: 'ecs-another-product', slug: 'another-product', sku: 'ES#123457',
      ecsPartNumber: 'ES#123457', title: 'Another product', priceAmount: 10,
      observedAvailability: 'Ships in 3 Business Days'
    })
  ];
  const options = {
    evaluatedAt: AS_OF,
    sourceReleaseId: 'test-release',
    sourceContentSha256: SOURCE_HASH,
    baseContentSha256: BASE_HASH,
    sourceProductCount: products.length
  };
  const forward = buildEcsConfirmationCartIndex(products, options);
  const reverse = buildEcsConfirmationCartIndex([...products].reverse(), options);
  assert.deepEqual(forward, reverse);
  assert.equal(forward.productCount, 2);
  assert.deepEqual(forward.availabilityCounts, {
    observedStock: 1,
    observedDispatchWindow: 1,
    observedFutureShipDate: 0
  });
});

test('checked-in release is deterministic, checksummed, and contains the audited 9,790 cohort', async () => {
  assert.equal(ECS_CONFIRMATION_CART_INDEX_DOCUMENT.productCount, ECS_CONFIRMATION_CART_EXPECTED_PRODUCT_COUNT);
  assert.deepEqual(ECS_CONFIRMATION_CART_INDEX_DOCUMENT.availabilityCounts, {
    observedStock: 4517,
    observedDispatchWindow: 4452,
    observedFutureShipDate: 821
  });
  validateEcsConfirmationCartIndex(ECS_CONFIRMATION_CART_INDEX_DOCUMENT);

  const generated = await generateEcsConfirmationCartIndex({
    evaluatedAt: AS_OF,
    expectedCount: ECS_CONFIRMATION_CART_EXPECTED_PRODUCT_COUNT
  });
  const checkedIn = await readFile(ECS_CONFIRMATION_CART_INDEX_PATH);
  assert.equal(generated.bytes.equals(checkedIn), true);
});

test('resolver supports O(1) handle decoration and exact productId plus SKU validation', () => {
  const row = ECS_CONFIRMATION_CART_INDEX_DOCUMENT.entries[0];
  const [productId, slug, sku] = row;
  const byProductId = lookupEcsConfirmationCartEligibility(productId, { nowValue: AS_OF_MS });
  const bySlug = lookupEcsConfirmationCartEligibility(slug, { nowValue: AS_OF_MS });
  assert.equal(byProductId.eligible, true);
  assert.equal(bySlug.eligible, true);
  assert.deepEqual(byProductId.commerce, bySlug.commerce);
  assert.equal(byProductId.commerce.mode, 'confirmation-cart');
  assert.equal(byProductId.commerce.eligible, true);
  assert.equal(byProductId.commerce.action, 'add-to-cart');
  assert.equal(byProductId.commerce.purchaseMode, 'fitment-confirmation-required');
  assert.equal(byProductId.commerce.fitmentConfirmationRequired, true);
  assert.equal(byProductId.commerce.availabilityConfirmationRequired, true);
  assert.equal(byProductId.commerce.paymentAllowed, false);
  assert.equal(byProductId.commerce.supplier.origin, 'United States');
  assert.equal(byProductId.commerce.supplier.originCountryCode, 'US');
  assert.equal(lookupEcsConfirmationCartCommerce('not-a-product', { nowValue: AS_OF_MS }), null);

  const decorated = decorateEcsConfirmationCartProduct(
    { handle: productId, title: 'Existing API card' }, { nowValue: AS_OF_MS }
  );
  assert.equal(decorated.commerce.sku, sku);

  const selection = resolveEcsConfirmationCartSelection(
    { productId, handle: slug, sku, quantity: 2 }, { nowValue: AS_OF_MS }
  );
  assert.equal(selection.ok, true);
  assert.equal(selection.selection.lineTotalMinor, selection.selection.price.unitAmountMinor * 2);
  assert.deepEqual(
    resolveEcsConfirmationCartSelection({ productId, sku: sku.toLowerCase() }, { nowValue: AS_OF_MS }),
    { ok: false, reason: 'sku_mismatch' }
  );
});

test('resolver rejects expired observations and a modified index', () => {
  const row = ECS_CONFIRMATION_CART_INDEX_DOCUMENT.entries[0];
  const [productId] = row;
  const afterExpiry = Date.parse(row[8]) + 1;
  assert.deepEqual(
    lookupEcsConfirmationCartEligibility(productId, { nowValue: afterExpiry }),
    { eligible: false, reason: 'expired' }
  );
  const status = getEcsConfirmationCartIndexStatus({
    nowValue: Date.parse(ECS_CONFIRMATION_CART_INDEX_DOCUMENT.latestExpiryAt) + 1
  });
  assert.equal(status.eligibleProductCount, 0);
  assert.equal(status.expiredProductCount, ECS_CONFIRMATION_CART_EXPECTED_PRODUCT_COUNT);

  const changed = structuredClone(ECS_CONFIRMATION_CART_INDEX_DOCUMENT);
  changed.entries[0][5] += 1;
  assert.throws(() => createEcsConfirmationCartResolver(changed), /Invalid or modified/);
});
