# Catalogue scale foundation

## Status

`migrations/003_catalogue_scale_foundation.sql` is an **additive, local migration design**. It has not been applied to Neon and does not change the current website API. Existing catalogue imports, offers, pages, and the 41 reviewed ECS products remain authoritative.

The migration prepares the data layer for multi-million-product supplier feeds without claiming that an ECS feed has been received or imported.

## What it adds

- Stable supplier product and variant identities that survive immutable import snapshots.
- Explicit supplier-wide uniqueness for supplier keys, ES numbers, and SKUs, with item-scoped uniqueness available for manufacturer numbers that legitimately repeat.
- Independent stock snapshots and a supplier-scoped publication pointer. Hourly stock can be refreshed without republishing all product content.
- Dated public retail-price evidence, separate from legacy offers.
- A separately revoked `catalog_private` schema for dealer-cost evidence. Dealer cost is never stored in a public projection or public retail table.
- A compact listing projection with stable browse, name, price, and availability sort keys.
- Importer-built total and facet counts, including make, model, year, generation, chassis, engine, and drivetrain.
- Structured chassis/drivetrain/transmission/body/trim configurations layered onto existing fitments.
- Product option definitions, option values, and variant selections.
- Structured specifications, package weight and dimensions, SEO fields, and stable related-product links.

## Keyset pagination contract

The current public API still uses its existing cursor contract. At the scale cutover, a new cursor should pin:

1. the ordered set of published supplier import IDs;
2. a canonical-filter fingerprint;
3. the selected sort;
4. the last projection sort value(s); and
5. the last `product_id` tie-breaker.

Queries then seek from the last tuple rather than calculating a growing offset:

- Browse: `(browse_rank, product_id) > (:rank, :id)`
- Name ascending: `(title_sort, product_id) > (:title, :id)`
- Name descending: `(title_sort, product_id) < (:title, :id)`
- Price ascending: `(price_asc_sort, product_id) > (:price_key, :id)`
- Price descending: `(price_desc_sort, product_id) > (:price_key, :id)`

The generated price keys put missing prices last for both directions. Cursors must be rejected when their publication IDs or filter fingerprint differ from the request. Numbered deep pages should be retired or capped after the keyset endpoint is verified.

## Facet-count policy

`catalog_facet_counts` stores counts for a canonical filter scope identified by a SHA-256 `scope_hash`. Importers should materialize only the base scope and approved high-value filter combinations; they must not generate the complete combinatorial filter space.

Customer requests read these rows instead of performing live `COUNT(DISTINCT ...)` work across millions of products and fitments. Counts are published with the same catalogue import they describe.

## Identifier policy

- ECS ES number, supplier product key, supplier handle, and a demonstrably unique supplier SKU: `uniqueness_scope = 'supplier'`.
- Manufacturer part number, UPC, or EAN that a supplier legitimately repeats across bundles/listings: `uniqueness_scope = 'catalog_item'` unless the feed contract guarantees supplier-wide uniqueness.
- Any conflicting supplier-scoped claim is quarantined during staging. It must never be resolved by silently overwriting another product.

## Stock and price policy

Stock publication is independent of product publication. A valid refresh stages every stock row under one `catalog_stock_imports` ID, validates counts/freshness, and changes `catalog_stock_state` in one guarded transaction.

Public retail/list/sale evidence includes its observation date and optional validity window. It does not imply that a price is current after expiry. Exact inventory quantities should be exposed only when supplier policy permits; otherwise the customer API returns the mapped availability state.

Dealer cost is stored only in `catalog_private.supplier_cost_evidence`. Before live use:

- create a non-owner runtime role for the website;
- grant it only the required public tables/views;
- do not grant `USAGE` on `catalog_private`;
- keep migration-owner credentials out of Vercel runtime variables; and
- add a permission test proving the runtime role cannot select dealer-cost rows.

Database revocation cannot protect costs when the website connects as the database owner, because owners retain access to their objects.

## Safe rollout sequence

1. Obtain an authorized structured supplier feed and a written update/access policy.
2. Provision enough database and object-storage capacity; do not use the current full free database for a two-million-product import.
3. Apply migrations 001–003 to an isolated Neon branch using the migration owner.
4. Backfill stable product/variant identities in bounded, resumable batches.
5. Populate the identifier registry and quarantine collisions before adding links to historical rows.
6. Import one supplier catalogue into staging; validate products, variants, images, fitments, options, identifiers, retail evidence, and logistics counts.
7. Import and validate an independent stock snapshot.
8. Build listing projections, total counts, and approved facet scopes offline.
9. Validate row counts, referential checks, duplicate identifiers, stale evidence, query plans, and runtime-role permissions.
10. Add and test a versioned keyset API while the current endpoint remains available.
11. Cut over only after English/Arabic storefront, search, filtering, direct routes, and rollback tests pass.

## Local contract test

```powershell
node --test scripts/neon-catalog/catalog-scale-migration.test.mjs
```

The test verifies that the migration is additive, stock is independent, keyset indexes and precomputed counts exist, required catalogue structures are present, and dealer cost stays outside public retail tables.
