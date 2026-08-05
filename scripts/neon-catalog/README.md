# Unified catalogue: Tegiwa snapshot importer

This directory contains the staged, resumable importer for the existing approved Tegiwa artifacts in `api/data/`.

It does not download supplier data. It reads and cross-validates the local catalog shards, public GBP stock index, and all local search-index checksums before opening a database connection.

## Safe preflight

```powershell
node scripts/neon-catalog/import-tegiwa.mjs --dry-run
```

Dry-run validates every product, image, search rank, stock join, SKU and expected database count. It does not require `DATABASE_URL`, write a checkpoint, or make a network request.

## Import

Set `DATABASE_URL` in the process environment, then run:

```powershell
node scripts/neon-catalog/import-tegiwa.mjs
```

Optional bounded batching controls:

```powershell
node scripts/neon-catalog/import-tegiwa.mjs --batch-size 250 --max-batch-bytes 4000000
```

The URL is passed only in the encrypted request header expected by Neon's official HTTPS SQL endpoint. It is never logged or saved.

## Guarantees

- A SHA-256 fingerprint creates a deterministic import UUID, making reruns idempotent.
- Every catalog shard is hashed during preflight and re-hashed immediately before its normalized rows are batched, preventing a changed file from being published under an earlier fingerprint.
- Each database batch upserts products and all dependent rows, so replaying a committed batch is safe.
- Resume progress is saved atomically under ignored `private-imports/neon-catalog/`.
- Resume compares every expected dependent-row count at the checkpoint. Any missing product, variant, offer, image, identifier or search row triggers a safe full replay that repairs the stage.
- Every catalog product receives one default variant and one GBP offer.
- The stock index prices are already UK-VAT-excluded GBP pence; the importer does not subtract or add tax again.
- Search rows include the product title, handle and safe public SKUs. Vehicle text is marked only through supplier title text; no exact structured fitment is invented.
- `catalog_state` is changed by one guarded SQL statement only after products, variants, offers, images, identifiers, search rows, brands, priced offers and available offers match the exact preflight counts.
- Publication holds a supplier-scoped transaction advisory lock and uses both compare-and-swap state and source-generation freshness checks, so an older overlapping import cannot replace a newer catalogue.
- If the prior current import exists, it is retired only inside the successful publish statement.
- Existing global brand names are reused without being updated; title-based Tegiwa inference cannot rename a brand shared by another supplier.

## Source limitations retained deliberately

- The public local stock artifact exposes `Variant SKU` values but no separate manufacturer-part-number field. SKU identifiers are imported; MPN identifiers remain empty instead of duplicating or inventing values.
- Stock is aggregated by title and exposes a minimum/maximum price range, while the current database schema stores one price per default variant. The minimum source price is stored and the number of range-priced products is retained in `validation_summary` for later schema/API work.
- The local sitemap snapshot has no structured year/make/model fitment table. Product title text is searchable for possible vehicle matches, but no `exact` fitment row is created.

## Offline tests

```powershell
node --test scripts/neon-catalog/test.mjs
```

The tests cover source normalization, GBP price preservation, identifier handling, deterministic import IDs, byte-safe batching, fail-closed count validation, CLI safety, and the dependency-free Neon HTTPS request shape. They use no database or network.
