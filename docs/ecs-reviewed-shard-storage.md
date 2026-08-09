# ECS reviewed catalogue shard storage

## Current staging state

The verified BMW M3 progress release is not imported as one large JavaScript module. It is stored under `api/data/ecs-bmw-m3-reviewed/` as:

- one 24 KB manifest;
- one 13.9 MiB compact routing index;
- 81 deterministic product shards, each capped at 128 products and 4 MiB; and
- SHA-256 checksums for the routing index and every shard.

The progress release contains 10,267 reviewed BMW M3 products. Braking, Engine, Suspension, and Steering are reconciled and included. Exterior, Interior, and Performance remain excluded until their capture reports reconcile exactly. After ES-number deduplication against the existing reviewed ECS collection, the storefront exposes 8,674 new identities and 12,057 total reviewed ECS identities.

The bundled release is deliberately marked `verified-progress`, not complete. It is a bounded fallback for the current staging preview only.

## Runtime behavior

`server/ecs-reviewed-shard-catalog.js` loads the small manifest and routing index once per warm function instance. Filtering, search, identifier lookup, sorting, and page selection run against compact routes. Only product shards containing products needed for that page, suggestion set, or detail are read and checksum-verified.

The full product payload is therefore not parsed into the function at startup. A normal 100-product first page currently reads one product shard. An exact ECS/MPN lookup reads only the shard containing that identity. Requests spanning more than 100 product shards fail closed and require narrower filters.

The existing static G-Series/curated collection remains authoritative when a BMW M3 shard route has the same ES number. This prevents duplicate SKUs and preserves the more specific reviewed fitment evidence.

## Completion and fail-closed rules

- A section can be included only when its capture report says `complete: true` and its expected pages and placements have reconciled.
- Product routes may reference only included sections.
- A remote release must include all seven requested BMW M3 sections.
- Every manifest, index, shard count, key position, byte count, and SHA-256 checksum is validated before data is returned.
- Remote manifests require an HMAC-SHA256 signature, a bounded seven-day lifetime, HTTPS, and official public Vercel Blob URLs.
- Invalid, expired, unsigned, incomplete, oversized, duplicate, or checksum-mismatched remote data returns a service error; it is never silently published.
- A partially configured remote environment fails closed instead of silently using an unverified remote source.

## Building a local verified release

Run this only after the aggregate normalizer has produced its audited product module:

```powershell
npm run catalog:ecs:reviewed-shards -- `
  --input-module server/data/ecs-bmw-m3-aggregate-products.js `
  --audit docs/ecs-bmw-m3-aggregate-catalogue-report.json `
  --output-dir api/data/ecs-bmw-m3-reviewed
```

The build is deterministic for the same products and audit: release ID, routing index, shard boundaries, and checksums remain identical regardless of input order.

## Complete-release Vercel Blob cutover

Do **not** commit the eventual 15,000–20,000-product payload to GitHub or add it to the Vercel function bundle. Build it in the private data workspace, validate it, then dry-run the Blob publisher:

```powershell
npm run catalog:ecs:publish-reviewed-shards -- --directory D:\Projx-Racing-Website-Data\ecs-reviewed-release
```

The real preview-only publish requires explicit `--preview` plus these server-only values:

- `BLOB_READ_WRITE_TOKEN`
- `ECS_REVIEWED_SHARD_MANIFEST_SECRET` (at least 32 bytes)

The publisher uploads immutable index/shard objects, reads each one back, verifies its checksum, signs the complete current manifest, and writes the preview pointer last. It has no production mode.

Configure the Vercel Preview environment with:

- `ECS_REVIEWED_SHARD_CURRENT_URL` — the public URL for `projx-racing/ecs-reviewed/preview/current.json`
- `ECS_REVIEWED_SHARD_MANIFEST_SECRET` — the matching server-only verification secret

When the remote URL is configured, the API ignores the bundled progress release. Keep the small current progress fallback only until the signed complete release and rollback path have been verified. Never commit either secret.

## Verification

```powershell
node --test scripts/ecs-catalog/reviewed-product-shards.test.mjs
node scripts/test-parts-catalog-api.mjs
```

The focused tests cover deterministic bounded shards, one-shard page reads, exact-identifier routing, checksum failure, incomplete-release rejection, scope reconciliation, ES-number deduplication, and the complete API fallback journey.
