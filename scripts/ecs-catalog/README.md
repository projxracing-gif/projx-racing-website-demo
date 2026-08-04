# ECS catalogue ingestion workspace

This isolated workflow prepares public ECS product records for later storefront review. It does not edit or publish the website catalogue.

## Important access rule

The supplier permission currently on file authorizes **manual copying**. It does not grant automated access. The normal workflow is therefore deliberately offline and accepts:

- saved HTML snapshots collected manually from public product pages;
- allowlisted manual JSON records; or
- a supplier-provided export, converted into manifest records.

Do not use `--fetch` unless ECS Tuning provides a new written grant that explicitly permits automated access. Network mode requires a separate authorization JSON file, an exact acknowledgement, the approved host, the grantor, a permission reference and a future expiry. The included example is intentionally invalid and cannot unlock network access by itself.

No login, dealer portal, session cookie, dealer price, wholesale price, tax, VAT, credential or private customer data belongs in any manifest, snapshot or normalized product.

## Offline manifest

```json
{
  "entries": [
    {
      "sourceUrl": "https://www.ecstuning.com/b-brand-parts/example/example/",
      "snapshotPath": "snapshots/example.html",
      "collectedAt": "2026-08-04T09:30:00.000Z",
      "collectionMethod": "manual-public-page"
    }
  ]
}
```

`snapshotPath` is resolved relative to the manifest. A manually prepared entry can instead contain a `record` object with only the normalized public fields demonstrated in `lib.mjs`.

## Run

Use the Node 24 runtime configured for this project:

```text
node scripts/ecs-catalog/ingest.mjs \
  --manifest scripts/ecs-catalog/fixtures/manifest.json \
  --output private-imports/ecs-catalog-review
```

If the output is inside this repository, the command accepts only the ignored
`private-imports/` area. An external review directory is also allowed. This
prevents raw snapshots, checkpoints or supplier review data from being added to
Git accidentally.

The output directory contains:

- `checkpoint.json` — per-URL processing state, attempts, failures and resume information;
- `raw/` — immutable-by-convention timestamped copies of the input snapshot or manual record;
- `catalog.json` — normalized, ECS-SKU/URL-deduplicated public product records;
- `validation.json` — field, URL, currency and duplicate checks.

Run the same command again to resume. Completed URLs are skipped. Failed entries are retried. Use `--refresh` only when intentionally collecting a newer public snapshot.

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

## Tests

```text
node --test scripts/ecs-catalog/test.mjs
```

The fixtures exercise parsing, canonical URLs, sensitive-field rejection, the automated-access gate, raw snapshot retention, checkpoint/resume and ECS-SKU deduplication without contacting ECS Tuning.
