# ECS catalogue ingestion workspace

This isolated workflow prepares public ECS product records for later storefront review. It does not edit or publish the website catalogue.

## Important access rule

The written supplier permission reviewed on 5 August 2026 authorizes Projx Racing to automate copying ECS public product listings onto the Projx website. It does not authorize access to private or authenticated dealer data. The permission evidence and active authorization record must remain under the ignored `private-imports/ecs-catalog-authorization/` directory and must never be committed.

The offline workflow remains available and accepts:

- saved HTML snapshots collected manually from public product pages;
- allowlisted manual JSON records; or
- a supplier-provided export, converted into manifest records.

Use `--fetch` only while the retained written grant has been reviewed and the private authorization record passes validation. The authorization file is a safety gate; creating or filling it in does not itself create permission.

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

## Authorized network safeguards

When a valid written grant exists, `--fetch` additionally enforces:

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

## Tests

```text
node --test scripts/ecs-catalog/test.mjs
```

The tests use local fixtures and injected network responses. They do not contact ECS Tuning.
