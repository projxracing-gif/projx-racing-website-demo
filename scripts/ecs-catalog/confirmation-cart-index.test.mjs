import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  ECS_CONFIRMATION_CART_BASE_EXPECTED_PRODUCT_COUNT,
  ECS_CONFIRMATION_CART_EXPECTED_PRODUCT_COUNT,
  ECS_CONFIRMATION_CART_F8X_COVERAGE_COUNT,
  ECS_CONFIRMATION_CART_F8X_EXPECTED_PRODUCT_COUNT,
  ECS_CONFIRMATION_CART_PROJECTED_QUARANTINE_COUNT,
  ECS_CONFIRMATION_CART_SCHEMA_VERSION,
  buildEcsConfirmationCartBaseSnapshot,
  classifyEcsObservedAvailability,
  createEcsConfirmationCartResolver,
  ecsConfirmationCartIndexSha256,
  evaluateEcsConfirmationCartEligibility,
  selectEcsConfirmationCartPrimaryImage,
  validateEcsConfirmationCartBaseSnapshot,
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
import {
  generateEcsConfirmationCartIndex,
  loadStableHandleOverrides
} from './build-confirmation-cart-index.mjs';

const AS_OF = '2026-08-21T12:00:00.000Z';
const AS_OF_MS = Date.parse(AS_OF);
const SOURCE_HASH = 'a'.repeat(64);
const BASE_HASH = 'b'.repeat(64);
const BASE_SNAPSHOT_PATH = new URL('../../server/data/ecs-confirmation-cart-base-20260811.json', import.meta.url);
const STABLE_HANDLES_PATH = new URL('../../server/data/ecs-confirmation-cart-stable-handles.json', import.meta.url);
const STATIC_CATALOGUE_PATH = new URL('../../assets/ecs-products.js', import.meta.url);
const PRIVATE_OVERLAY_PATH = new URL(
  '../../private-imports/ecs-f8x-release-20260821-cart-v2/f8x-overlay-candidate/manifest.json', import.meta.url
);

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
    priceVerifiedAt: '2026-08-21',
    checkedAt: '2026-08-21',
    stockObservedAt: '2026-08-21',
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
    priceObservedAt: '2026-08-21',
    availabilityObservedAt: '2026-08-21',
    expiresAt: '2026-09-20T23:59:59.999Z',
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
    [{ priceVerifiedAt: '2026-08-12' }, 'stale_price'],
    [{ stockObservedAt: '2026-08-12' }, 'stale_availability'],
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
      priceVerifiedAt: '2026-08-21', stockObservedAt: '2026-08-21', checkedAt: '2026-08-21'
    }), { nowValue: AS_OF_MS }).eligible,
    true,
    'a date-only observation represents the observed UTC day, not a future end-of-day timestamp'
  );
});

test('supplier-media primary selection only collapses verified variants of one ECS asset', () => {
  const primary = 'https://assets.ecstuning.com/product_library/123456_x300.jpg';
  const sameAsset = eligibleProduct({
    imageSourceUrl: primary,
    images: [
      { src: primary },
      { src: 'https://assets.ecstuning.com/product_library/123456_x300.webp' }
    ]
  });
  assert.equal(selectEcsConfirmationCartPrimaryImage(sameAsset), primary);
  assert.equal(
    evaluateEcsConfirmationCartEligibility(sameAsset, { nowValue: AS_OF_MS }).entry.imageSrc,
    primary
  );

  for (const product of [
    eligibleProduct({
      imageSourceUrl: primary,
      images: [
        { src: primary },
        { src: 'https://assets.ecstuning.com/product_library/654321_x300.webp' }
      ]
    }),
    eligibleProduct({
      imageSourceUrl: 'https://assets.ecstuning.com/product_library/123456_x300.webp',
      images: [{ src: primary }, { src: 'https://assets.ecstuning.com/product_library/123456_x600.jpg' }]
    })
  ]) {
    assert.equal(selectEcsConfirmationCartPrimaryImage(product), null);
    assert.deepEqual(
      evaluateEcsConfirmationCartEligibility(product, { nowValue: AS_OF_MS }),
      { eligible: false, reason: 'unverified_image' }
    );
  }
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
  const forward = buildEcsConfirmationCartBaseSnapshot(products, options);
  const reverse = buildEcsConfirmationCartBaseSnapshot([...products].reverse(), options);
  assert.deepEqual(forward, reverse);
  validateEcsConfirmationCartBaseSnapshot(forward, { expectedCount: 2 });
  assert.equal(forward.productCount, 2);
  assert.deepEqual(forward.availabilityCounts, {
    observedStock: 1,
    observedDispatchWindow: 1,
    observedFutureShipDate: 0
  });
});

test('checked-in release is source-bound and contains the audited combined cohort', async () => {
  assert.equal(ECS_CONFIRMATION_CART_INDEX_DOCUMENT.schemaVersion, ECS_CONFIRMATION_CART_SCHEMA_VERSION);
  assert.equal(ECS_CONFIRMATION_CART_INDEX_DOCUMENT.productCount, ECS_CONFIRMATION_CART_EXPECTED_PRODUCT_COUNT);
  assert.deepEqual(ECS_CONFIRMATION_CART_INDEX_DOCUMENT.availabilityCounts, {
    observedStock: 4543,
    observedDispatchWindow: 5098,
    observedFutureShipDate: 850
  });
  assert.deepEqual(ECS_CONFIRMATION_CART_INDEX_DOCUMENT.composition, {
    baseEntryCount: 9790,
    supersededBaseEntryCount: 2571,
    quarantinedBaseEntryCount: 319,
    retainedBaseEntryCount: 6900,
    authoritativeF8xIdentityCount: 4545,
    projectedQuarantineIdentityCount: 508,
    f8xEligibleCount: 3591,
    f8xExcludedCount: 954,
    f8xExistingBaseEligibleCount: 2538,
    newF8xEligibleCount: 1053,
    stableHandleOverrideCount: 10,
    stableHandleEligibleCount: 9,
    f8xExclusionCounts: {
      unconfirmed_availability: 452,
      unsafe_purchase_policy: 139,
      unverified_image: 363
    }
  });
  assert.equal(
    ECS_CONFIRMATION_CART_INDEX_DOCUMENT.source.baseCart.productCount,
    ECS_CONFIRMATION_CART_BASE_EXPECTED_PRODUCT_COUNT
  );
  assert.equal(
    ECS_CONFIRMATION_CART_INDEX_DOCUMENT.source.f8xOverlay.productCount,
    ECS_CONFIRMATION_CART_F8X_COVERAGE_COUNT
  );
  assert.equal(
    ECS_CONFIRMATION_CART_INDEX_DOCUMENT.composition.f8xEligibleCount,
    ECS_CONFIRMATION_CART_F8X_EXPECTED_PRODUCT_COUNT
  );
  assert.equal(
    ECS_CONFIRMATION_CART_INDEX_DOCUMENT.source.f8xOverlay.projectedQuarantineIdentityCount,
    ECS_CONFIRMATION_CART_PROJECTED_QUARANTINE_COUNT
  );
  validateEcsConfirmationCartIndex(ECS_CONFIRMATION_CART_INDEX_DOCUMENT);

  const baseSnapshot = JSON.parse(await readFile(BASE_SNAPSHOT_PATH, 'utf8'));
  validateEcsConfirmationCartBaseSnapshot(baseSnapshot, {
    expectedCount: ECS_CONFIRMATION_CART_BASE_EXPECTED_PRODUCT_COUNT
  });
  assert.equal(
    baseSnapshot.contentSha256,
    ECS_CONFIRMATION_CART_INDEX_DOCUMENT.source.baseCart.contentSha256
  );
});

test('private source release deterministically regenerates the checked-in index', {
  skip: !existsSync(PRIVATE_OVERLAY_PATH)
}, async () => {
  const generated = await generateEcsConfirmationCartIndex({
    evaluatedAt: AS_OF,
    expectedCount: ECS_CONFIRMATION_CART_EXPECTED_PRODUCT_COUNT,
    expectedF8xCount: ECS_CONFIRMATION_CART_F8X_EXPECTED_PRODUCT_COUNT,
    expectedCoverageCount: ECS_CONFIRMATION_CART_F8X_COVERAGE_COUNT,
    expectedQuarantineCount: ECS_CONFIRMATION_CART_PROJECTED_QUARANTINE_COUNT
  });
  const checkedIn = await readFile(ECS_CONFIRMATION_CART_INDEX_PATH);
  assert.equal(generated.bytes.equals(checkedIn), true);
});

test('stable handles are checksum-bound to the authoritative static ECS catalogue', async () => {
  const validated = await loadStableHandleOverrides(STABLE_HANDLES_PATH, {
    staticCatalogue: STATIC_CATALOGUE_PATH
  });
  assert.equal(validated.document.entryCount, 10);
  assert.equal(validated.staticProductCount, 41);

  const changed = JSON.parse(await readFile(STABLE_HANDLES_PATH, 'utf8'));
  changed.entries[0][1] = 'ecs-wrong-but-syntactically-valid-handle';
  delete changed.contentSha256;
  changed.contentSha256 = createHash('sha256').update(JSON.stringify(changed)).digest('hex');
  await assert.rejects(
    loadStableHandleOverrides('tampered-stable-handles.json', {
      staticCatalogue: STATIC_CATALOGUE_PATH,
      readFileImpl: filename => filename === 'tampered-stable-handles.json'
        ? Promise.resolve(Buffer.from(JSON.stringify(changed)))
        : readFile(filename)
    }),
    /does not match the checksum-bound static ECS catalogue/
  );

});

test('private composition rejects an omitted required stable handle', {
  skip: !existsSync(PRIVATE_OVERLAY_PATH)
}, async () => {
  const missing = JSON.parse(await readFile(STABLE_HANDLES_PATH, 'utf8'));
  missing.entries.shift();
  missing.entryCount = missing.entries.length;
  delete missing.contentSha256;
  missing.contentSha256 = createHash('sha256').update(JSON.stringify(missing)).digest('hex');
  await assert.rejects(
    generateEcsConfirmationCartIndex({
      evaluatedAt: AS_OF,
      stableHandles: 'missing-stable-handles.json',
      readFileImpl: filename => filename === 'missing-stable-handles.json'
        ? Promise.resolve(Buffer.from(JSON.stringify(missing)))
        : readFile(filename)
    }),
    /does not exactly cover every noncanonical static\/F8X intersection/
  );
});

test('authoritative F8X rows replace old commerce, preserve stable handles, and fail closed', () => {
  const current = lookupEcsConfirmationCartCommerce('ecs-dinan-s55-high-flow-filter', { nowValue: AS_OF_MS });
  assert.equal(current.sku, 'ES#4690610');
  assert.equal(current.price.unitAmountMinor, 9599);
  assert.equal(current.title, 'Dinan High Flow Drop-in Replacement Air Filter - F06/F10/F12/F13/F80/F82/F83/F87 - S55/S63');
  assert.equal(current.image.src, 'https://assets.ecstuning.com/product_library/1861370_x300.jpg');
  assert.equal(lookupEcsConfirmationCartCommerce('ecs-es-4690610', { nowValue: AS_OF_MS }), null);

  const newlyEligible = lookupEcsConfirmationCartCommerce('ecs-mad-s55-catted-downpipes', { nowValue: AS_OF_MS });
  assert.equal(newlyEligible.sku, 'ES#4630139');
  assert.equal(newlyEligible.price.unitAmountMinor, 56900);
  assert.equal(lookupEcsConfirmationCartCommerce('ecs-es-196057', { nowValue: AS_OF_MS }).sku, 'ES#196057');

  for (const handle of [
    'ecs-burger-s55-jb4',
    'ecs-es-3508709',
    'ecs-es-129081',
    'ecs-es-5446682',
    'ecs-es-4709083'
  ]) {
    assert.equal(lookupEcsConfirmationCartCommerce(handle, { nowValue: AS_OF_MS }), null, handle);
  }
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

  const crossAlias = structuredClone(ECS_CONFIRMATION_CART_INDEX_DOCUMENT);
  crossAlias.entries[0][1] = crossAlias.entries[1][0];
  crossAlias.contentSha256 = ecsConfirmationCartIndexSha256(crossAlias);
  assert.throws(() => validateEcsConfirmationCartIndex(crossAlias), /Duplicate ECS confirmation-cart identity/);

  const invalidComposition = structuredClone(ECS_CONFIRMATION_CART_INDEX_DOCUMENT);
  invalidComposition.composition.retainedBaseEntryCount += 1;
  invalidComposition.contentSha256 = ecsConfirmationCartIndexSha256(invalidComposition);
  assert.throws(() => createEcsConfirmationCartResolver(invalidComposition), /Invalid or modified/);

  for (const mutate of [
    document => { document.source.runtimeProductCount = 1; },
    document => { document.source.baseCart.sourceContentSha256 = 'f'.repeat(64); },
    document => { document.source.stableHandles.contentSha256 = 'e'.repeat(64); },
    document => {
      document.composition.f8xExistingBaseEligibleCount = 3000;
      document.composition.newF8xEligibleCount = 591;
    }
  ]) {
    const changedBinding = structuredClone(ECS_CONFIRMATION_CART_INDEX_DOCUMENT);
    mutate(changedBinding);
    changedBinding.contentSha256 = ecsConfirmationCartIndexSha256(changedBinding);
    assert.throws(() => createEcsConfirmationCartResolver(changedBinding), /Invalid or modified/);
  }
});
