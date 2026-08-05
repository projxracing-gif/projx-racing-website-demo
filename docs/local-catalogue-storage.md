# Projx Racing local catalogue storage and stock-sync architecture

## Storage location

The working catalogue archive is stored at:

`D:\Projx-Racing-Website-Data`

The Desktop folder `Projx Racing Website Data` contains a shortcut to that location.

The Git website repository remains the approved source for application code. The D: drive is the large-data workspace for supplier files, normalized catalogues, stock snapshots, media, logs, and backups.

## Folder map

- `website-source-current` — a local mirror of the current website source, excluding generated dependencies and build output.
- `vendor-feeds\tegiwa\current` — the complete local Tegiwa catalogue, search shards, stock index, and manifests used by the website.
- `vendor-feeds\tegiwa\incoming` — new supplier snapshots awaiting validation.
- `vendor-feeds\tegiwa\archive` — retained dated source snapshots.
- `vendor-feeds\tegiwa\releases` — immutable, checksummed local public-stock releases.
- `vendor-feeds\tegiwa\current.json` — the atomic pointer to the last successfully promoted local release.
- `vendor-feeds\ecs\incoming` — authorized public ECS product snapshots awaiting validation.
- `vendor-feeds\ecs\current` — normalized, reviewed ECS catalogue data.
- `vendor-feeds\ecs\archive` — retained dated ECS snapshots.
- `catalogue-pipelines` — validated import, normalization, and catalogue test scripts.
- `stock-updates\normalized` — compact stock and price records ready for publication.
- `stock-updates\published` — the last successfully published stock snapshot and manifest.
- `stock-updates\archive` — dated stock snapshots for audit and rollback.
- `secure-private` — ignored supplier authorization and private processing state. Never publish this folder.
- `media\incoming` and `media\approved` — supplier media review workflow.
- `logs` — updater logs that contain no credentials or private dealer pricing.
- `exports` — generated public catalogue packages.
- `backups` — recoverable local catalogue backups.

## Verified Tegiwa stock source

Tegiwa confirmed the approved B2B stockfeed for Projx Racing as:

`https://scripts.tegiwa.de/dealer-stock/`

The local updater accepts this host and path only. It rejects redirects, non-CSV responses, oversized or truncated transfers, invalid UTF-8, and missing supplier headers before processing any rows.

The first local release was promoted on 5 August 2026 after both a dry-run and a fresh second download passed all gates. It contains 194,126 stock records, 188,829 safely mapped SKU products, and 26,292 products with direct or supplier availability. This release is local only; it has not been published to the website.

## Website delivery model

Vercel cannot read files directly from a drive on this PC. Local storage is therefore the master archive and processing workspace, not the public website endpoint.

The safe data flow is:

1. Download or receive the supplier feed into `incoming`.
2. Validate identity, price currency, stock status, images, and source timestamp.
3. Normalize it locally without adding tax, currency conversion, dealer pricing, or invented fitment.
4. Build compact public catalogue and stock artifacts.
5. Publish only the compact public artifacts to a website-accessible store or Preview deployment.
6. Retain the previous successful snapshot for immediate rollback.

The complete Tegiwa catalogue can continue using its existing sharded static files. Neon is not required to store those 193,253 catalogue products. A small online object store is still needed for frequently changing public stock because Vercel cannot read this PC drive directly.

The intended public release model is:

1. Keep all raw supplier exports and complete history on D:.
2. Upload one validated, immutable public stock artifact.
3. Update a small `current.json` manifest only after the artifact checksum is verified.
4. Make the website API read that manifest server-side and fall back to its bundled stock index if the remote release is missing, stale, incompatible, or invalid.
5. Retain the immediately previous public artifact for rollback and keep the full history only on D:.

This design avoids hourly Git commits, full Vercel deployments, and a database row for every supplier product.

## Update cadence

- Tegiwa: hourly is technically practical because the approved stockfeed is available. Product identity/catalogue rebuilds should run less frequently than stock-only refreshes. A SKU-mapping change must be held for a matching search-index release; ordinary price, availability, lead-time, and check-date changes do not rebuild search.
- ECS Tuning: ECS has approved automated product copying but has not supplied an API, downloadable catalogue/stock feed, sitemap index, complete URL source or approved hourly request cadence. Use bounded scheduled checks only for explicitly listed public SKUs while the private authorization gate is valid. Do not bypass access controls or label observations as live stock. A complete hourly update remains impractical without a supplier-provided feed.
- Other suppliers: enable hourly checks only when the supplier provides an authorized API, stockfeed, SFTP file, or scheduled export.

Every public stock record must include `supplier`, `supplier SKU`, `checked at`, `availability`, `lead time`, `currency`, and `source`. Stale or failed checks must retain the previous snapshot and display a confirmation-required state rather than guessing.

## Security rules

- Never place credentials, access tokens, dealer pricing, customer data, or private supplier files in the public website repository.
- Never expose the PC drive directly to the internet.
- Never remove supplier watermarks from copyrighted product imagery.
- Do not publish a new snapshot unless count, schema, and freshness validation pass.
- Keep the previous successful public snapshot for rollback.

## Neon retention decision

Do not delete or recreate the current Neon project as part of this local-storage design.

The incomplete Tegiwa import remains unpublished in staging. The current Free-plan branch is already slightly above its 512 MiB logical-size limit, and a full import is projected to exceed that limit. Continuing the full import would therefore require explicit approval for a paid Neon plan. The D: drive plus object-storage model avoids that requirement for the full supplier catalogue while preserving Neon for smaller dynamic data such as users, enquiries, quotes, and curated products.

Any later removal of the abandoned staging import is a separate destructive action and requires explicit approval.
