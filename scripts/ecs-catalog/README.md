# ECS catalogue ingestion workspace

This isolated workflow prepares public ECS product records for later storefront review. It does not edit or publish the website catalogue.

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

The storefront currently contains 14 manually reviewed ECS products in `assets/ecs-products.js`. They are unique by public handle, ECS part number, manufacturer MPN, source URL and local image content.

All 14 deliberately retain these limitations:

- supplier-title/application fitment is `possible`, never `exact`;
- supplier availability is an observation and the API returns `check_availability`;
- prices are public supplier USD retail observations, not a Projx selling price;
- no live ECS stock feed exists;
- no verified detailed specifications, options, variations or drivetrain fitment are available; and
- each product has one approved local primary image, not a complete gallery.

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

Source URLs must use HTTPS, the default HTTPS port, no embedded credentials, an ECS public host and an ECS product path beginning with `/b-…-parts/`. Search, account and category-only URLs are rejected.

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

The queue reconciles candidates against the 14 current products by ECS part number, canonical source URL and manufacturer MPN. Existing items become `review_existing`; only unmatched items become `review_new`. It records field changes and the missing bilingual content, local images, structured fitment, selling price, shipping, installation and human approvals.

This step never edits the storefront, database or public assets. `publishApproved` remains false for every candidate. A person must review the evidence, approve local media, add bilingual copy and sign off before any separate publication/import change is made.

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

The public fallback API adds storefront-safe normalized fields to the 14 reviewed products: globally unique `ecs-...` handles, supplier/brand/category slugs, possible-only fitment records, available year/chassis/engine filters, USD retail-price metadata, confirmation-only availability, local images, SEO metadata and related products. Missing specifications, variants, drivetrain data and exact fitment remain empty rather than inferred.

## Tests

```text
node --test scripts/ecs-catalog/test.mjs
node scripts/ecs-catalog/audit-reviewed.mjs --output private-imports/ecs-catalog-review/reviewed-audit.json
```

The tests use local fixtures and injected network responses. They do not contact ECS Tuning.
