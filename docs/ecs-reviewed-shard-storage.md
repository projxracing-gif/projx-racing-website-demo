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

When a shard route has the same ES number as an existing static G-Series/curated product, the storefront keeps the static public key and slug but unions the shard's structured fitments and filters into that product. Hydrating the detail view applies the same merge to the full shard payload. This prevents duplicate SKUs without losing newly reviewed F80/F82/F83 chassis evidence.

An F8X release is a second, distinct overlay rather than a replacement for this base. The runtime verifies its exact F80/F82/F83 by seven-section scope, final-audit checksum, unchanged base release hashes and inline projected-quarantine identity set. It then removes that authorized quarantine from static and base inputs and merges static, surviving base and F8X overlay in that order. The overlay cannot contain a quarantined identity, and every surviving existing public handle must remain unchanged. When no F8X overlay is configured, the existing base path remains lazy and unchanged.

A separately approved signed overlay pointer is enabled only when both server-side values are present: `ECS_REVIEWED_F8X_OVERLAY_CURRENT_URL` and `ECS_REVIEWED_F8X_OVERLAY_MANIFEST_SECRET`. Supplying only one fails closed instead of leaving a partial configuration active. Neither value is returned by catalogue status or diagnostics, and neither belongs in browser code or the repository.

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

To build a separate F8X overlay candidate, use the existing reviewed release only as an immutable verification base. The builder recomputes the exact static-plus-base-plus-overlay runtime projection, but writes only the F8X overlay products. The generic BMW M3 base stays `verified-progress` and is never copied into or relabelled by the complete F8X artifact.

First create the checksum-bound F8X final audit described in `docs/ecs-f8x-final-release-audit.md`; the raw normalizer audit is intentionally not a builder authorization.

```powershell
node scripts/ecs-catalog/build-reviewed-product-shards.mjs `
  --input-dir api/data/ecs-bmw-m3-reviewed `
  --overlay-module D:\Projx-Racing-Website-Data\f8x\ecs-bmw-f8x-aggregate-products.js `
  --audit D:\Projx-Racing-Website-Data\f8x\ecs-bmw-f8x-final-release-audit.json `
  --output-dir D:\Projx-Racing-Website-Data\f8x\f8x-overlay-candidate
```

The overlay module must be the exact finalized canonical data module and may export either `F8X_AGGREGATE_PRODUCTS` or `BMW_F8X_AGGREGATE_PRODUCTS` with its matching quarantine export. It is checksum-checked before parsing and is never executed. A recognizable F8X audit cannot use the generic executable `--input-module` path or generic `--input-dir` build; `--overlay-module` is mandatory. Before finalization, all 21 exact records/manifest/report sibling bundles are reopened and normalized again, including the per-scope and global `[vehicle, section, categoryKey, page, position, ecsPartNumber]` digests. The builder recomputes that capture-identity binding and the detailed 21-scope observation binding, checks the live static module graph against the finalized checksum and applies the shared runtime F8X product contract to every shard product and compact route. Added code, a legacy `BMW_M3_AGGREGATE_PRODUCTS` alias, stale evidence or graph checksums, a changed base or a public/linked/existing output path fail closed. The output uses distinct F8X manifest, index and shard kinds and stores the sorted projected-quarantine identities with their checksum. Privileged local-filesystem race boundaries are documented in `docs/ecs-f8x-final-release-audit.md`.

## Complete-release Vercel Blob cutover

Do **not** commit a large reviewed payload to GitHub or add it to the Vercel function bundle. For the existing complete-base workflow, build it in the private data workspace, validate it, then dry-run the Blob publisher:

```powershell
npm run catalog:ecs:publish-reviewed-shards -- --directory D:\Projx-Racing-Website-Data\ecs-reviewed-release
```

The real preview-only base publish requires explicit `--preview` plus these server-only values:

- either `VERCEL_OIDC_TOKEN` with `BLOB_STORE_ID`, or `BLOB_READ_WRITE_TOKEN`
- `ECS_REVIEWED_SHARD_MANIFEST_SECRET` (at least 32 bytes)

The publisher uploads immutable index/shard objects, reads each one back, verifies its checksum, signs the complete current manifest, and writes the preview pointer last. It has no production mode.

The same command performs a structural, credential-free dry run for a local F8X overlay candidate. After separate operational approval, `--preview` publishes that candidate with Blob authentication and `ECS_REVIEWED_F8X_OVERLAY_MANIFEST_SECRET`. The base signing secret is not accepted as a fallback. Overlay artifacts are written only below `projx-racing/ecs-reviewed/f8x-overlay/releases/`, and the publisher updates only `projx-racing/ecs-reviewed/f8x-overlay/preview/current.json` through a guarded compare-and-swap. It never reads or writes the base `projx-racing/ecs-reviewed/preview/current.json` pointer for an F8X release.

```powershell
npm run catalog:ecs:publish-reviewed-shards -- `
  --directory D:\Projx-Racing-Website-Data\f8x\f8x-overlay-candidate `
  --preview
```

The successful command returns the verified public overlay `currentUrl`. Configure that exact URL and its matching secret in the Vercel Preview environment as:

- `ECS_REVIEWED_F8X_OVERLAY_CURRENT_URL`
- `ECS_REVIEWED_F8X_OVERLAY_MANIFEST_SECRET`

Both values are required; partial overlay configuration fails closed. The existing reviewed-base pointer and environment values remain unchanged.

Configure the Vercel Preview environment with:

- `ECS_REVIEWED_SHARD_CURRENT_URL` — the public URL for `projx-racing/ecs-reviewed/preview/current.json`
- `ECS_REVIEWED_SHARD_MANIFEST_SECRET` — the matching server-only verification secret

When the remote URL is configured, the API ignores the bundled progress release. Keep the small current progress fallback only until the signed complete release and rollback path have been verified. Never commit either secret.

## Verification

```powershell
node --test scripts/ecs-catalog/reviewed-product-shards.test.mjs
node --test scripts/ecs-catalog/build-f8x-overlay-release.test.mjs
node --test scripts/ecs-catalog/f8x-overlay-runtime.test.mjs
node scripts/test-parts-catalog-api.mjs
```

The focused tests cover deterministic bounded shards, one-shard page reads, exact-identifier routing, checksum failure, incomplete-release rejection, scope reconciliation, ES-number deduplication, and the complete API fallback journey.
