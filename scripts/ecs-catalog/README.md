# ECS catalogue ingestion workspace

The original isolated ingestion workflow prepares public ECS product records for later storefront review and never publishes them directly. The separate, explicit G-Series preparation and media-materialization commands generate reviewable storefront assets only after their bounded source and integrity checks pass.

Complete BMW M3 reviewed-product payloads must use the bounded shard path documented in
`docs/ecs-reviewed-shard-storage.md`; they must not be embedded in
`server/data/ecs-bmw-m3-aggregate-products.js`.

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

## Resumable BMW M3 family section capture

`capture-bmw-m3-section.mjs` is an injected-browser capture runner for exactly one public BMW M3 family section at a time: `Braking`, `Engine`, `Exterior`, `Interior`, `Performance`, `Suspension` or `Steering`. It does not provide a command-line network client. For the first run, open `https://www.ecstuning.com/BMW-M3/` or one of its actual visible section links in a persistent browser tab, then pass that tab through `createCodexTabEcsCaptureAdapter`.

The runner:

- discovers the requested section and every direct child category from visible existing ECS anchors;
- requires the supplier-rendered count for every child and never constructs a child slug;
- follows only visible paginator anchors and never constructs a page URL; when resuming, it may reopen only an exact validated checkpoint URL, or capture the exact next uncaptured category/page already open in the persistent tab after validating it against the stored category order and page count;
- keeps one atomic, create-only raw-page checkpoint per leaf, so a later call resumes rather than replacing evidence even when two writers race;
- records a separate create-only terminal-pagination proof for every child category, including a reported zero-count category; each proof binds the exact terminal URL and rendered-card count and rejects any visible higher numeric page or `rel=next` link;
- waits 1.2 seconds after navigation by default and supports independent `pageBudget` and `terminalProofBudget` limits for bounded resumable batches;
- provides opt-in `reloadBeforePagination` recovery for stubborn ECS overlays: it reloads only the exact current checkpoint, proves the URL and rendered-card count are unchanged, then re-reads and clicks the visible paginator;
- after all exact-locator retries fail, may use the browser's visible-DOM click capability only when exactly one parsed visible anchor has a raw href identical to an already-observed link; it then verifies the canonical destination and challenge state;
- retries transient incomplete card rendering three times without refreshing or changing routes;
- stops immediately if ECS presents an interactive access challenge;
- writes an aggregate capture, exact manifest and reconciliation report after every new page; and
- refuses to mark a scope complete when any category lacks a validated terminal proof, or when page counts, required public listing fields, supplier identities or placement uniqueness do not reconcile.

Browser-runner usage:

```js
const captureModule = await import('file:///ABSOLUTE/REPOSITORY/scripts/ecs-catalog/capture-bmw-m3-section.mjs');
const result = await captureModule.captureEcsBmwM3Section(
  captureModule.createCodexTabEcsCaptureAdapter(tab),
  {
    section: 'Engine',
    outputDir: 'private-imports/ecs-bmw-m3-20260809/engine',
    pageBudget: 25,
    navigationDelayMs: 5000,
    paginationSettleDelayMs: 5000,
    reloadBeforePagination: true,
    reloadSettleDelayMs: 2500,
  },
);
```

Re-run the same call and output directory to continue. The runner accepts the section root, a validated checkpoint/terminal page, or the exact next uncaptured page in the first incomplete stored category. For the last case, page 1 must equal that category's stored child href; a later page must be the exact next numeric page under the same stored category path. The runner validates the page state and expected rendered-card count before writing its checkpoint. Any other child page fails closed. A completed child category is skipped, but an older completed capture without terminal proofs can be safely augmented with `pageBudget: 0`; root and raw-page checkpoints remain unchanged. Use `terminalProofBudget` to bound that evidence-only resume. If the visible root category manifest changes, the runner stops and requires a new output directory instead of mixing observations. The output directory contains `section-root.json`, create-only `raw-pages/*.json`, create-only `terminal-proofs/*.json`, `bmw-m3-<section>-records.json`, `bmw-m3-<section>-manifest.json` and `bmw-m3-<section>-reconciliation-report.json`. These are private capture inputs only; this runner does not merge or publish product data.

The deterministic offline tests do not contact ECS:

```text
node --test scripts/ecs-catalog/capture-bmw-m3-section.test.mjs
```

### Exact F8X M3/M4 section capture

`capture-f8x-section.mjs` reuses the same fail-closed runner with three isolated, frozen vehicle profiles:

- `f80-m3` — `https://www.ecstuning.com/BMW-F80-M3-S55_3.0L/`
- `f82-m4` — `https://www.ecstuning.com/BMW-F82-M4-S55_3.0L/`
- `f83-m4` — `https://www.ecstuning.com/BMW-F83-M4-S55_3.0L/`

Each profile accepts only the same seven documented sections. Open the exact vehicle root or requested visible section in one persistent Codex Chrome tab, then run a bounded batch:

```js
const f8xCapture = await import('file:///ABSOLUTE/REPOSITORY/scripts/ecs-catalog/capture-f8x-section.mjs');
const result = await f8xCapture.captureEcsF8xSection(
  f8xCapture.createCodexTabEcsCaptureAdapter(f8xChromeTab),
  {
    vehicleKey: 'f80-m3',
    section: 'Braking',
    privateRoot: 'ABSOLUTE/WORKSPACE/private-imports',
    pageBudget: 25,
    navigationDelayMs: 5000,
    paginationSettleDelayMs: 5000,
    reloadBeforePagination: true,
    reloadSettleDelayMs: 2500,
  },
);
```

Re-run the same call with the tab on one of the accepted resume positions to continue. A relative private root is accepted only as the repository's canonical `private-imports`; an external work root must be an explicit absolute, existing directory also named `private-imports`. The wrapper rejects linked/junction-backed roots, descendants and capture artifacts, and requires the exact section path `private-imports/ecs-f8x-m3-m4-20260820/<vehicle-key>/<section-key>/`; an optional explicit `outputDir` is accepted only when it resolves to that same path. Files are isolated by vehicle, for example `bmw-f80-m3-braking-records.json`, `bmw-f82-m4-engine-manifest.json` and `bmw-f83-m4-steering-reconciliation-report.json`; raw checkpoint and terminal-proof kinds also carry the exact vehicle prefix. Never reuse one vehicle's section directory for another profile.

For a completed legacy F80 Braking capture that has raw pages but no terminal proofs, open the exact F80 Braking section in the approved persistent browser tab and rerun with `pageBudget: 0` and a bounded `terminalProofBudget`. This adds only missing create-only proof files; it does not replace `section-root.json` or any raw page. Review the resulting report and require both `completeness.complete: true` and `safeguards.nextUncheckpointPageValidated: true` before normalization.

The focused offline compatibility tests do not contact ECS:

```text
node --test scripts/ecs-catalog/capture-bmw-m3-section.test.mjs scripts/ecs-catalog/capture-f8x-section.test.mjs
```

### BMW M3 product-media materialization

Do not start media requests until all seven section reconciliation reports say `complete`. The BMW M3 media wrapper reads the seven standard capture files below the capture directory, proves every category has all expected pages and placements, rejects non-ECS media hosts, and then calls the existing checksum-based ECS materializer. It writes only below the approved `assets/products/ecs/` tree and produces the schema-version-1 media index consumed by the BMW M3 normalizer.

Run the no-network preflight first. The optional existing index reuses already verified G-Series files and avoids downloading the same supplier image again:

```text
npm run catalog:ecs:bmw-m3-media -- \
  --capture-dir private-imports/ecs-bmw-m3-20260809 \
  --existing-media-index private-imports/ecs-g-series-engine-20260809/media-index.json \
  --output-dir assets/products/ecs/bmw-m3 \
  --index private-imports/ecs-bmw-m3-20260809/media-index.json \
  --max-images 25000 \
  --max-total-bytes 2147483648 \
  --concurrency 2 \
  --dry-run
```

After the preflight count is reviewed, remove only `--dry-run` from that command to materialize the images. A later rerun may omit `--existing-media-index`; when the output index already exists, the wrapper automatically uses it as its resume index and preserves every matching verified mapping.

The safeguards are intentionally fail-closed: at most 25,000 required image mappings, at most 2 GiB downloaded in one run, at most 25 MB for one file, only HTTPS `assets.ecstuning.com` URLs without credentials/query strings, only JPEG/PNG/WebP bytes, a minimum 100-by-100 decoded image, content-addressed filenames, atomic index writes, and a maximum concurrency of eight (two in the documented command). If a supplier image fails, the strict command does not publish a complete index. Use `--allow-missing` only for a reviewed follow-up so every failure is recorded and the storefront can retain its labelled supplier-media-unavailable state.

If the official ECS image host refuses a standalone request while the same exact image renders on its public listing page, use the browser page-assets runner instead of weakening the HTTP safeguards. It revisits only already-validated raw-page checkpoint URLs, verifies the page and rendered product count, inventories the images the browser actually observed, bundles only exact matching `assets.ecstuning.com` URLs, verifies the bytes and dimensions, and writes the same content-addressed media-index schema. It never opens an image URL directly and stops on an access challenge. Run it only in a persistent browser session that is not being used by a product-capture runner:

```js
const mediaModule = await import('file:///ABSOLUTE/REPOSITORY/scripts/ecs-catalog/capture-bmw-m3-page-assets.mjs?media-v1');
const result = await mediaModule.captureEcsBmwM3PageAssets(
  mediaModule.createCodexTabPageAssetsAdapter(tab),
  {
    captureDir: 'ABSOLUTE/REPOSITORY/private-imports/ecs-bmw-m3-20260809',
    outputDir: 'ABSOLUTE/REPOSITORY/assets/products/ecs/bmw-m3',
    indexPath: 'ABSOLUTE/REPOSITORY/private-imports/ecs-bmw-m3-20260809/media-index.json',
    statePath: 'ABSOLUTE/REPOSITORY/private-imports/ecs-bmw-m3-20260809/media-capture-state.json',
    sections: ['braking', 'steering'],
    pageBudget: 10,
    navigationDelayMs: 4000,
    assetSettleDelayMs: 1500,
  },
);
```

The browser runner accepts partial durable checkpoints, so completed sections can be materialized while other sections are still being captured. Re-running the same call resumes from the verified index and state. A page remains `partial` when ECS advertises a non-placeholder product image but the browser does not observe or bundle it; those pages are retried rather than silently treated as complete. The focused no-network tests are `node --test scripts/ecs-catalog/capture-bmw-m3-page-assets.test.mjs`.

Do not commit the eventual multi-gigabyte local media directory to GitHub. After the completed media index passes local review, run the preview publisher in dry-run mode. It re-reads every local file, verifies its SHA-256 checksum and dimensions, deduplicates identical bytes, and reports the exact upload size without needing credentials:

```text
npm run catalog:ecs:publish-bmw-m3-media -- \
  --index private-imports/ecs-bmw-m3-20260809/media-index.json
```

A real staging upload additionally requires `--output private-imports/ecs-bmw-m3-20260809/media-index-published.json --preview` and server-only Blob credentials. Prefer the short-lived `VERCEL_OIDC_TOKEN` plus `BLOB_STORE_ID` pair; `BLOB_READ_WRITE_TOKEN` remains a legacy fallback. An optional `--concurrency 1` through `--concurrency 8` controls bounded uploads; the default is four. This is an important external write and must be explicitly approved. The publisher uploads immutable content-hash paths under `projx-racing/ecs-media/bmw-m3/`, reads every object back to verify its checksum, and writes a local published index only after all objects pass. Credentials are never written to the index, repository, product data or logs. The BMW M3 normalizer accepts that published index and allows only exact public `*.public.blob.vercel-storage.com` URLs.

### Offline BMW M3 seven-section normalization

After all seven reconciliation reports say `complete`, pass the seven direct `bmw-m3-<section>-records.json` files to the offline normalizer. These raw capture JSON files are the accepted inputs; no conversion or network request is needed. The command requires exactly one reconciled capture for each of `Braking`, `Engine`, `Exterior`, `Interior`, `Performance`, `Suspension` and `Steering`:

```text
npm run catalog:ecs:bmw-m3 -- \
  --input private-imports/ecs-bmw-m3-20260809/braking/bmw-m3-braking-records.json \
  --input private-imports/ecs-bmw-m3-20260809/engine/bmw-m3-engine-records.json \
  --input private-imports/ecs-bmw-m3-20260809/exterior/bmw-m3-exterior-records.json \
  --input private-imports/ecs-bmw-m3-20260809/interior/bmw-m3-interior-records.json \
  --input private-imports/ecs-bmw-m3-20260809/performance/bmw-m3-performance-records.json \
  --input private-imports/ecs-bmw-m3-20260809/suspension/bmw-m3-suspension-records.json \
  --input private-imports/ecs-bmw-m3-20260809/steering/bmw-m3-steering-records.json \
  --media-index private-imports/ecs-bmw-m3-20260809/media-index.json \
  --output server/data/ecs-bmw-m3-aggregate-products.js \
  --report docs/ecs-bmw-m3-aggregate-catalogue-report.json
```

`--media-index` is optional. Without it, captured product-specific `assets.ecstuning.com` URLs remain usable in the generated product records. With a verified index from the existing media materializer, each matching CDN URL is replaced by its local asset path and verified dimensions. The official ECS no-image asset is never presented as a verified product photo.

The generator also accepts one precombined document whose kind is `bmw-m3-aggregate-listing-capture`. It deduplicates by ES number, retains every section/subcategory observation, and quarantines conflicting MPNs, canonical product URLs or same-day public prices. `server/ecs-reviewed-catalog.js` imports the tracked empty-safe module at `server/data/ecs-bmw-m3-aggregate-products.js`; keep its exports empty until the audit is approved, then replace that module with the generator output. Both generated product and quarantine exports are included in the reviewed merge, and the public API reports their source, unique-contribution, quarantine and published counts under `reviewedEcsCatalogueStatus`.

Every generated fitment stays at model-level `BMW M3` with `possible` confidence. Year, generation, chassis, engine and drivetrain remain empty because the generic family pages do not establish them. Public USD prices and supplier availability retain their observation dates; availability remains confirmation-required and is never represented as live stock.

Supplier price text is preserved semantically. A positive `Starting at` amount is emitted only as a labelled starting-from reference, remains quote-only, and requires exact-variant confirmation; it is never represented as a fixed unit price or a direct-purchase offer. A `Starting at $0.00` observation is not a publishable price and becomes controlled `Request price` state while the raw dated observation remains in the audit evidence. Conflicting same-day public amounts remain quarantined.

Focused offline test:

```text
node --test scripts/ecs-catalog/prepare-bmw-m3-aggregate.test.mjs
```

## Current reviewed storefront collection

The local staging storefront contains 2,528 unique ECS products after duplicate-safe merging of 41 legacy manually reviewed products with the generated G-Series Performance, Exterior, Interior, Drivetrain and Braking scopes. The generated sets cover every captured branch in those bounded scopes for G87 M2, G80 M3 Competition and G82 M4 Competition. ECS category placement is not represented as a supplier-published sales ranking, and this staging collection is not a production deployment.

The Performance report is `docs/ecs-g-series-performance-catalogue-report.json`: 2,656 listing observations, 1,109 unique products, 824 verified product-specific images, 285 labelled supplier placeholders, 1,101 public-price records and 8 request-price records. The Exterior report is `docs/ecs-g-series-exterior-catalogue-report.json`: 1,725 listing observations, 782 unique products, 643 verified product-specific images, 139 labelled supplier placeholders, 782 public-price observations, 71 missing supplier descriptions and 28 missing supplier brands. The Interior report is `docs/ecs-g-series-interior-catalogue-report.json`: 1,958 listing observations, 678 unique products, 559 verified product-specific images, 119 labelled supplier placeholders, 677 public-price observations, 42 missing supplier descriptions and 670 missing supplier brands. The Drivetrain report is `docs/ecs-g-series-drivetrain-catalogue-report.json`: 64 public listing pages, 732 placements (G80 244, G82 248 and G87 240), 253 unique raw ECS identities, one fully excluded quarantined identity and 252 customer-facing products, 232 verified supplier images, 20 official placeholders, 252 public retail USD observations, zero price conflicts and zero supplier-identity conflicts. The Braking report is `docs/ecs-g-series-braking-catalogue-report.json`: 77 public listing pages, 822 placements (G80 289, G82 288 and G87 245), 253 customer-facing products, 216 verified supplier images, 37 official labelled placeholders, 253 public retail USD observations, zero price conflicts and zero quarantined identities. No wholesale data is present. Thirty-one same-day price differences elsewhere in the final merged catalogue remain held at `Request price` rather than publishing an ambiguous amount.

### Bounded Drivetrain staging workflow

The capture directory and its source evidence stay under ignored `private-imports/`. Combine the three exact vehicle captures, then generate the tracked staging module and report:

```text
npm run catalog:ecs:combine-g-series-drivetrain -- \
  --capture-dir private-imports/ecs-g-series-drivetrain-20260809 \
  --manifest private-imports/ecs-g-series-drivetrain-20260809/g-series-drivetrain-scope-manifest.json \
  --output private-imports/ecs-g-series-drivetrain-20260809/g-series-drivetrain-listing-capture.json

npm run catalog:ecs:g-series-drivetrain -- \
  --input private-imports/ecs-g-series-drivetrain-20260809/g-series-drivetrain-listing-capture.json \
  --media-index private-imports/ecs-g-series-drivetrain-20260809/media-index.json \
  --scope-manifest private-imports/ecs-g-series-drivetrain-20260809/g-series-drivetrain-scope-manifest.json \
  --output server/data/ecs-g-series-drivetrain-products.js \
  --report docs/ecs-g-series-drivetrain-catalogue-report.json \
  --minimum-products 252
```

The shared scope manifest has 13 English/Arabic category definitions and exact keyed counts totalling 732. ES#2019435 is retained only in the private raw evidence, then quarantined and excluded before module generation. The customer-facing category directory and API must not expose its PDK category or product.

The generated vehicle-category records deliberately retain these limitations:

- supplier-title/application fitment is `possible`, never `exact`;
- supplier availability is an observation and the API returns `check_availability`;
- prices are public supplier USD retail observations, not a Projx selling price;
- no live ECS stock feed exists;
- no independently verified detailed specifications, options, variations or exact drivetrain fitment are available; and
- product-specific media is used only when captured and verified; otherwise the storefront shows a labelled ECS placeholder.

### Bounded Braking staging workflow

Keep the three exact vehicle captures, shared scope manifest and media indexes under ignored `private-imports/`. Combine the reconciled G80, G82 and G87 captures before generating the tracked Braking module and report:

```text
npm run catalog:ecs:combine-g-series-braking -- \
  --capture-dir private-imports/ecs-g-series-braking-20260809 \
  --manifest private-imports/ecs-g-series-braking-20260809/g-series-braking-scope-manifest.json \
  --output private-imports/ecs-g-series-braking-20260809/g-series-braking-listing-capture.json

npm run catalog:ecs:g-series-braking -- \
  --input private-imports/ecs-g-series-braking-20260809/g-series-braking-listing-capture.json \
  --media-index private-imports/ecs-g-series-braking-20260809/media-index.json \
  --scope-manifest private-imports/ecs-g-series-braking-20260809/g-series-braking-scope-manifest.json \
  --output server/data/ecs-g-series-braking-products.js \
  --report docs/ecs-g-series-braking-catalogue-report.json \
  --minimum-products 253
```

The Braking manifest has 15 English/Arabic category definitions and exact keyed counts totalling 822 placements. It uses exact `Braking/.../` vehicle-relative paths and collision-safe `braking-*` child slugs; the generated records keep the same possible-fitment, dated-price, confirmation-only availability and verified-media safeguards as the other bounded G-Series scopes. G87 publishes 13 of the 15 branches, so Electrical and ABS remain explicit verified zero-count entries rather than being silently omitted.

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
