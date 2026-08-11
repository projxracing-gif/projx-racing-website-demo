# ECS confirmation-cart sellability index

This release is a server-owned, fail-closed eligibility index for ECS products that may enter the existing staging cart only after the customer accepts fitment, availability, final-price and shipping confirmation. It does not authorize payment or claim live ECS stock.

## Current release

- Merged reviewed ECS products evaluated: **12,057**
- Eligible confirmation-cart products: **9,790**
- Dated `In Stock` / `In Stock at Vendor` observations: **4,517**
- Dated relative dispatch observations: **4,452**
- Future supplier ship-date observations: **821**
- Generated index size: approximately **2.20 MB**
- Evaluation time: `2026-08-11T12:00:00.000Z`
- Per-item expiry range: `2026-09-07T23:59:59.999Z` through `2026-09-08T23:59:59.999Z`
- Content SHA-256: `95d635dcfb405923451a7f5abd0250cb68fb09a02fafad421ddd7ef661bf67a5`

Only source observations that were no more than seven days old at generation were admitted. Because this is a no-payment, confirmation-only cart, those admitted reference prices remain selectable for a bounded 30-day window; Projx Racing still confirms the current price and availability before approving any order. The checked-in snapshot then expires and the product is no longer returned as eligible, even if its row remains in the file.

## Admission rules

Every admitted product has all of the following:

- ECS supplier identity, a stable public product ID/handle, a stable slug, and one exact `ES#...` SKU;
- one exact positive USD public retail price, represented as integer minor units;
- no starting-price flag, price conflict, quote-only flag, options, or unresolved variants;
- a price observation and an availability observation no older than seven days when the index was generated;
- a positive supplier observation: dated stock, a relative dispatch window, or a future ship date;
- exactly one image marked `supplier-media-verified`, hosted locally, by ECS, or by the approved Vercel Blob host;
- supplier origin recorded as the United States; and
- `fitment-confirmation-required` purchase mode.

Back orders, special orders without a guaranteed ETA, stale observations, missing/ambiguous prices, unverified media, configurable products, and products with conflicting identities fail closed.

## Runtime contract

`server/ecs-confirmation-cart-index.js` exposes:

- `lookupEcsConfirmationCartEligibility(handle, options)` — O(1) lookup by existing public product ID or slug;
- `lookupEcsConfirmationCartCommerce(handle, options)` — compact API-decoration payload or `null`;
- `decorateEcsConfirmationCartProduct(product, options)` — adds the server commerce decision to an existing card/detail payload;
- `resolveEcsConfirmationCartSelection(selection, options)` — requires the product ID/handle and exact SKU, validates quantity and freshness, and returns canonical integer pricing;
- `getEcsConfirmationCartIndexStatus(options)` — total, eligible, and expired counts; and
- the validated document and resolver constants for server composition.

The returned commerce payload always states:

- `mode: confirmation-cart`;
- `purchaseMode: fitment-confirmation-required`;
- fitment and supplier availability confirmation are required;
- shipping quote is required; and
- payment is not allowed.

The staging-order endpoint resolves the exact product ID and SKU again before accepting a line. Its amount remains a supplier-reference price and no payment is enabled. Future payment activation must additionally use an immediate supplier price/availability refresh and a validated shipping quote; this snapshot alone is not sufficient.

## Rebuild and verification

The deterministic package commands are:

```text
npm run catalog:ecs:confirmation-cart
npm run catalog:ecs:confirmation-cart:check
npm run test:ecs-confirmation-cart
```

The generator verifies every reviewed source shard checksum, merges it with the existing reviewed ECS catalogue, applies the fail-closed gates, sorts by stable product ID, writes packed rows, and checksums the payload with SHA-256. Refresh automation must advance the explicit `--as-of` value and expected audited count only after reviewing a new supplier observation release.
