# ECS catalogue ingestion workspace

The original isolated ingestion workflow prepares public ECS product records for later storefront review and never publishes them directly. The separate, explicit G-Series preparation and media-materialization commands generate reviewable storefront assets only after their bounded source and integrity checks pass.

## Important access rule

Projx Racing has retained written ECS approval dated 5 August 2026 for automated copying of ECS products onto the Projx website. The approval evidence and reviewed authorization record are private, ignored by Git and required by the `--fetch` safety gate.

The approval does not provide an API, approved feed, accessible complete URL list, collection-rate agreement or access to non-public dealer data. ECS publishes a sitemap index, but its product shards encounter an interactive Cloudflare challenge during normal automated access; this workflow must not bypass it. ECS Wholesale has separately advised that a private FTP catalogue export may be possible, but access is not yet approved or delivered. Network mode is limited to explicitly listed public ECS product URLs on the approved host and must stop when authorization validation or normal HTTP access fails. Dealer cost from any future FTP file is private input and must never enter public catalogue artifacts.

Permission evidence must remain under the ignored `private-imports/ecs-catalog-authorization/` directory and must never be committed.

The offline workflow remains available and accepts:

- saved HTML snapshots collected manually from public product pages;
- allowlisted manual JSON records; or
- a supplier-provided export, converted into manifest records.

Use `--fetch` only after the retained grant has been reviewed and the private authorization record passes validation. The authorization file is a safety gate; creating or filling it in does not itself create permission or a complete product source.

Network mode requires all of the following:

- the exact acknowledgement printed by `--help`;
- the person at ECS who granted automated access;
- a retained evidence reference beginning with `email:`, `file:`, `https:` or `document:`;
- the Projx person who reviewed the grant and the review time;
- only `www.ecstuning.com` in `allowedHosts`; and
- a future internal re-review deadline in `validUntil`.

`validUntil` is Projx Racing's safety re-review date. It is not an expiry date stated by ECS Tuning.

Only the documented authorization keys are accepted. A human must review the written grant before network mode is enabled.

No login, dealer portal, session cookie, dealer price, wholesale price, tax, VAT, credential or private customer data belongs in any manifest, snapshot or normalized product.

## Current reviewed storefront collection

The storefront contains 2,127 unique ECS products after duplicate-safe merging of 41 legacy manually reviewed products, 1,109 generated G-Series Performance products, 782 generated G-Series Exterior products, and 678 generated G-Series Interior products. The Interior set overlaps 230 identities already present in the established collection; those records merge by ECS number while retaining the established public handle and all vehicle/category evidence. The generated sets cover every captured Performance, Exterior and Interior branch for G87 M2, G80 M3 Competition and G82 M4 Competition. ECS category placement is not represented as a supplier-published sales ranking.

The Performance report is `docs/ecs-g-series-performance-catalogue-report.json`: 2,656 listing observations, 1,109 unique products, 824 verified product-specific images, 285 labelled supplier placeholders, 1,101 public-price records and 8 request-price records. The Exterior report is `docs/ecs-g-series-exterior-catalogue-report.json`: 1,725 listing observations, 782 unique products, 643 verified product-specific images, 139 labelled supplier placeholders, 782 public-price observations, 71 missing supplier descriptions and 28 missing supplier brands. The Interior report is `docs/ecs-g-series-interior-catalogue-report.json`: 1,958 listing observations, 678 unique products, 559 verified product-specific images, 119 labelled supplier placeholders, 677 public-price observations, 42 missing supplier descriptions and 670 missing supplier brands. Thirty-one same-day price differences in the final merged catalogue are held at `Request price` rather than publishing an ambiguous amount.

The generated vehicle-category records deliberately retain these limitations:

- supplier-title/application fitment is `possible`, never `exact`;
- supplier availability is an observation and the API returns `check_availability`;
- prices are public supplier USD retail observations, not a Projx selling price;
- no live ECS stock feed exists;
- no verified detailed specifications, options, variations or drivetrain fitment are available; and
- product-specific media is used only when captured and verified; otherwise the storefront shows a labelled ECS placeholder.

Run the deterministic audit without contacting ECS:

```text
node scripts/ecs-catalog/audit-reviewed.mjs \
  --output private-imports/ecs-catalog-review/reviewed-audit.json
```

The audit checks required fields, declared image dimensions, image hashes, duplicate identifiers, possible-only fitment, confirmation-only availability, SEO fields and related-product references. Known supplier-data gaps are reported but do not become invented values.

## Offline manifest

Every offline entry must include a real `collectedAt` ISO date-time with a timezone. Dates more than five minutes in the future are rejected. A bad timestamp fails only that entry, so the remaining batch can still finish.

```json
{
  "entries": [
    {
      "sourceUrl": "https://www.ecstuning.com/b-brand-parts/example/example~brand/",
      "snapshotPath": "snapshots/example.html",
      "collectedAt": "2026-08-04T09:30:00.000Z",
      "collectionMethod": "manual-public-page"
    }
  ]
}
```

`snapshotPath` is resolved relative to the manifest and, after resolving links, must remain inside the manifest's folder. This prevents a supplied manifest from reading unrelated local or network files. A manually prepared entry can instead contain a `record` object with only the normalized public fields demonstrated in `lib.mjs`. Unknown or sensitive field names are rejected recursively before the raw manual record is written.

Source URLs must use HTTPS, the default HTTPS port, no embedded credentials, an ECS public host and a sitemap-observed ECS product path beginning with `/b-`. Search, account and category-only URLs are rejected.

## Run

Use the Node runtime configured for this project:

```text
node scripts/ecs-catalog/ingest.mjs \
  --manifest scripts/ecs-catalog/fixtures/manifest.json \
  --output private-imports/ecs-catalog-review
```

If the output is inside this repository, it must stay under the ignored `private-imports/` area. An external review directory is also allowed. This prevents raw snapshots, checkpoints or supplier review data from being added to Git accidentally.

The output directory contains:

- `checkpoint.json` — per-URL state, attempts, failures and resume information;
- `raw/` — immutable snapshots whose names include the full content SHA-256 hash;
- `catalog.json` — normalized, ECS-SKU/URL-deduplicated public product records;
- `validation.json` — field, URL, currency and duplicate checks.

Run the same command again to resume. A completed checkpoint is skipped only when its product is still present and valid in the durable catalogue. If the catalogue record is missing, the entry is reprocessed. Failed entries are retried. Use `--refresh` only when intentionally collecting a newer public snapshot.

## Duplicate-safe manual review queue

After an offline ingestion run succeeds, prepare a private review queue:

```text
node scripts/ecs-catalog/prepare-review.mjs \
  --catalog private-imports/ecs-catalog-review/catalog.json \
  --output private-imports/ecs-catalog-review/review-queue.json
```

The queue reconciles candidates against the complete merged ECS collection by ECS part number, canonical source URL and manufacturer MPN. Existing items become `review_existing`; only unmatched items become `review_new`. It records field changes and the missing bilingual content, local images, structured fitment, selling price, shipping, installation and human approvals.

This step never edits the storefront, database or public assets. `publishApproved` remains false for every candidate. A person must review the evidence, approve local media, add bilingual copy and sign off before any separate publication/import change is made.

## Public sitemap discovery

With the retained written automated-copy approval, the public sitemap collector can create a checksum-bound, private URL directory without opening any product page:

```text
node scripts/ecs-catalog/collect-sitemaps.mjs \
  --output private-imports/ecs-sitemap-collection/<snapshot> \
  --authorization-file private-imports/ecs-catalog-authorization/authorization.json \
  --fetch
```

It requests the one official sitemap index and exactly 177 product sitemap shards. ECS currently lists each shard with a trailing slash even though the ordinary XML response is available only after removing that one final slash; every other host, path, redirect and shard number is rejected. Requests are serialized at a minimum two-second start-to-start interval, the authorization is hash-bound and revalidated before each attempt, interactive challenges stop the run, and completed shard files are checksum-verified when resuming.

The collector produces `product-urls.txt`, per-sitemap private URL shards, a resumable checkpoint and `url-manifests/index.json`. These are discovery records only. They contain no verified price, stock, image, detailed specification or vehicle fitment and must remain outside Git, Vercel function bundles and the public storefront until a separately reviewed storage and enrichment release is approved.

### Preview-only discovery release

The completed, checksum-bound URL manifests can be staged in Vercel Blob without adding the private files to Git or a Function bundle. First validate the entire local set without credentials or network access:

```powershell
npm run catalog:ecs:publish-discovery -- --index private-imports/ecs-sitemap-collection/<snapshot>/url-manifests/index.json --dry-run
```

A real release is intentionally preview-only and requires both server-side secrets plus an explicit confirmation:

```powershell
$env:BLOB_READ_WRITE_TOKEN = '<server-only token>'
$env:ECS_DISCOVERY_MANIFEST_SECRET = '<independent high-entropy secret>'
npm run catalog:ecs:publish-discovery -- --index private-imports/ecs-sitemap-collection/<snapshot>/url-manifests/index.json --preview
```

The publisher validates the index, sidecar checksum, every shard checksum, exact URL-only schema and every canonical public ECS URL. Each shard and the index are uploaded with deterministic immutable names below `projx-racing/ecs-discovery/releases/<release>/`, then read back and checksum-verified. Only after every object verifies does it conditionally move the HMAC-signed `projx-racing/ecs-discovery/preview/current.json` pointer. The signature is the lowercase SHA-256 HMAC produced from the strict ordered-array payload exported by `server/ecs-discovery-catalog.js`, so publisher and reader cannot disagree because of object key insertion order. Interrupted runs safely resume by verifying existing immutable objects; invalid remote signatures, checksum drift and concurrent pointer changes fail closed. Known-safe failures before the pointer write make a best-effort conditional cleanup of only the immutable objects created by that run; pre-existing, ambiguous and possibly referenced objects are never deleted. It never publishes credentials and has no production mode.

Direct ECS product pages currently return an interactive Cloudflare challenge to normal automated requests. Do not use cookies, CAPTCHA handling, a logged-in dealer session or another workaround. Product-page enrichment remains disabled when this happens.

## Bounded shard jobs

After `build-url-manifests.mjs` creates a checksum-bound `index.json`, prepare independent jobs in a new private workspace:

```text
npm run catalog:ecs:shards -- plan \
  --index private-imports/ecs-url-manifests/<snapshot>/index.json \
  --workspace private-imports/ecs-shard-jobs/<snapshot> \
  --authorization-file private-imports/ecs-catalog-authorization/authorization.json
```

The planner verifies the index sidecar, every shard checksum, canonical URL and the retained authorization separately for each shard. It creates immutable job bindings and one checkpoint per shard, but stores no URLs in the plan. Run only one bounded shard per process; there is deliberately no `--all` or URL discovery mode:

```text
npm run catalog:ecs:shards -- run \
  --workspace private-imports/ecs-shard-jobs/<snapshot> \
  --shard 1 \
  --authorization-file private-imports/ecs-catalog-authorization/authorization.json \
  --fetch
```

Each shard has its own lock, ingestion checkpoint, raw evidence, normalized private review catalogue and result marker. A completed shard is skipped only when its checksum-bound result is still durable; failed or interrupted ingestion resumes through the existing per-URL checkpoint. Authorization is revalidated when the plan is made, when a shard starts and before each request. The workspace never edits the database, `assets/`, `dist/` or any storefront file.

The plan schema identifies the source adapter as `ecs-public-url-v1`, so a separately reviewed supplier-export adapter can be added later without treating the URL list as the only possible source. Any future FTP/export adapter must quarantine private source rows, strip dealer cost, wholesale pricing, credentials, tax and VAT from normalized review data, and keep those fields out of every public artifact.

## Automated-access safeguards

With a valid retained automated-access grant, `--fetch` additionally enforces:

- a minimum two-second request interval;
- authorization revalidation immediately before every request;
- bounded retry, timeout and response-size options;
- retries only for network errors, HTTP 408, 429 and 5xx responses;
- final redirect validation back to an approved ECS product URL;
- HTML/XHTML content types; and
- a default maximum response size of 5 MiB (configurable from 1 KiB to 10 MiB).

Invalid numeric options are rejected rather than silently clamped.

## Normalized record

Every accepted product has exactly these fields:

- title and manufacturer brand;
- ECS part number in `ES#123` form;
- manufacturer MPN;
- public USD price and formatted value;
- public availability text as observed;
- canonical ECS source URL and checked timestamp;
- public HTTPS image URLs;
- fitment/application values and category.

Unexpected fields are rejected. Sensitive or non-public field names—including dealer, wholesale, trade, tax, VAT, cost, credentials, cookies and tokens—are rejected.

The public fallback API adds storefront-safe normalized fields to the merged reviewed collection: globally unique `ecs-...` handles, supplier/brand/category slugs, possible-only fitment records, available year/chassis/engine filters, USD retail-price metadata, confirmation-only availability, local images, SEO metadata and related products. Missing specifications, variants, drivetrain data and exact fitment remain empty rather than inferred.

## Tests

```text
node --test scripts/ecs-catalog/test.mjs
node scripts/ecs-catalog/audit-reviewed.mjs --output private-imports/ecs-catalog-review/reviewed-audit.json
```

The tests use local fixtures and injected network responses. They do not contact ECS Tuning.
