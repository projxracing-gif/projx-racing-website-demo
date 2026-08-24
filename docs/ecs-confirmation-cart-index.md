# ECS confirmation-cart sellability index

This release is one server-owned, fail-closed eligibility index for ECS products that may enter the existing staging cart only after the customer accepts fitment, availability, final-price and shipping confirmation. It combines the preserved reviewed-base cart snapshot with the authoritative F80/F82/F83 overlay, so every consumer receives the same current decision. It does not authorize payment or claim live ECS stock.

## Current release

- Projected reviewed ECS runtime after the F8X overlay: **13,028**
- Combined eligible confirmation-cart products: **10,491**
- Preserved non-F8X base entries: **6,900**
- Authoritative F8X identities evaluated: **4,545**
- Eligible F8X products: **3,591**
- Projected quarantine tombstones applied: **508**
- Dated `In Stock` / `In Stock at Vendor` observations: **4,543**
- Dated relative dispatch observations: **5,098**
- Future supplier ship-date observations: **850**
- Generated index size: **2,420,576 bytes**
- Evaluation time: `2026-08-21T12:00:00.000Z`
- Per-item expiry range: `2026-09-07T23:59:59.999Z` through `2026-09-20T23:59:59.999Z`
- Content SHA-256: `438d50bec3d8cfa1f7ab7464744860cdc33e6fe4909d1a11c223bb2d2f4e59c8`

The F8X exclusions are explicit and exhaustive for the 4,545-product overlay: **452** unconfirmed availability observations, **139** unsafe purchase-policy rows (quote-only, starting-price, or request-price), and **363** rows without verified supplier media. The combined builder removes all **2,571** base entries superseded by an F8X identity and all **319** retained-base entries that appear in the projected quarantine before adding the 3,591 current F8X decisions. This yields exactly 10,491 unique rows.

Only source observations that were no more than seven days old at generation were admitted. Because this is a no-payment, confirmation-only cart, those admitted reference prices remain selectable for a bounded 30-day window; Projx Racing still confirms the current price and availability before approving any order. The checked-in snapshot then expires and the product is no longer returned as eligible, even if its row remains in the file.

## Admission rules

Every admitted product has all of the following:

- ECS supplier identity, a stable public product ID/handle, a stable slug, and one exact `ES#...` SKU;
- one exact positive USD public retail price, represented as integer minor units;
- no starting-price flag, price conflict, quote-only flag, options, or unresolved variants;
- a price observation and an availability observation no older than seven days when the index was generated;
- a positive supplier observation: dated stock, a relative dispatch window, or a future ship date;
- verified supplier media hosted locally, by ECS, or by the approved Vercel Blob host. A single image is accepted directly. Multiple image URLs are accepted only when the declared primary URL is one of them and every URL is a format variant of the same ECS `product_library` asset identity;
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

The product API, browser cart, account-cart restore, shipping estimate/revalidation and staging-order endpoint all use this same resolver interface. The staging-order endpoint resolves the exact product ID and SKU again before accepting a line. Its amount remains a supplier-reference price and no payment is enabled. Future payment activation must additionally use an immediate supplier price/availability refresh and a validated shipping quote; this snapshot alone is not sufficient.

Stable public handles are not free-form aliases. The ten legacy F8X handles are checksum-bound to `assets/ecs-products.js`; the builder rejects an override unless its ECS identity, public key and slug exactly match that authoritative static catalogue. The combined document also binds the base snapshot, reviewed base release, F8X overlay manifest, final-audit input, full projected quarantine and stable-handle source hashes.

## Rebuild and verification

The deterministic package commands are:

```text
npm run catalog:ecs:confirmation-cart
npm run catalog:ecs:confirmation-cart:check
npm run test:ecs-confirmation-cart
```

The generator validates the immutable 9,790-row base snapshot, every F8X candidate shard checksum and route, the final audit, the complete 508-identity projected quarantine, and the checksum-bound stable handles. It treats all 4,545 F8X identities as authoritative: an ineligible current F8X row removes any former base cart decision instead of inheriting stale commerce. It then sorts by stable product ID, writes packed schema-v2 rows, and checksums the complete payload with SHA-256.

The F8X candidate and final audit are create-only private release inputs under `private-imports/` and are intentionally not committed. A clean checkout can validate and serve the checked-in combined index, but deterministic source regeneration requires the corresponding private release bundle. Any sellability-policy or trusted-graph change requires a new private work directory, a fresh final audit and overlay candidate, and a regenerated combined index; an older audit must not be reused as publication authorization. Refresh automation must advance the explicit `--as-of` value and expected audited counts only after reviewing a new supplier observation release.
