# Catalogue import contract

Raw supplier CSV, XLS/XLSX, XML, JSON, image archives and portal exports belong under `private-imports/` or another ignored local location. Never place a complete dealer stockfeed in `assets/`, `dist/` or a commit.

## Reviewed Projx catalogue records

The public site keeps a small reviewed `storeProducts` array in `assets/data.js`. A product may be copied into that array only after a human confirms:

- one stable slug and one canonical brand plus SKU/MPN identity;
- an exact local product image with confirmed publication rights and intrinsic dimensions;
- either a verified customer-facing price in the supplier's original currency, with currency/tax note and verification date, or `quoteOnly: true`;
- a current stock/lead-time label with its check date;
- supplier-sourced fitment records and a fitment status that does not overstate compatibility;
- complete English and Arabic customer-facing copy; and
- that no trade cost, wholesale quantity, account identifier, token or portal credential is present.

The generated review file remains private. Before manually publishing a record, remove the supplier source URL, raw source-currency/RRP fields, VAT flags, image provenance notes and exact supplier quantities from the client-visible object. Publish only the reviewed customer price fields and a clear currency/tax note. Public stock text may only state that supplier stock was indicated and when it was checked.

Prepare a small private review batch with:

```text
npm run catalog:prepare -- private-imports/curated-candidates.json
```

The tool rejects raw-size batches, private fields, remote/hotlinked images, missing original-currency/quote-only pricing and incomplete fitment. It writes only to ignored `private-imports/sanitized/catalog-products.json`. It never publishes products automatically.

## Full Tegiwa preview catalogue

Tegiwa's catalogue is too large for `assets/data.js` and static per-product routes. The preview therefore uses a restricted server-side catalogue endpoint plus a sanitized public browse snapshot:

- `api/tegiwa-catalog.js` loads bundled public browse shards and calls only Tegiwa's official Shopify predictive-search JSON and validated product JSON URLs at request time.
- `api/data/tegiwa-sitemap-manifest.json` records the validated official product-sitemap sources used to create the browse snapshot.
- `api/data/tegiwa-catalog-pages/` contains 199 compact public-data shards with only product handle, title and allowlisted image URL. It contains no SKU, exact quantity, dealer pricing or account data.
- `api/data/tegiwa-catalog-summary.json` records snapshot counts, per-shard product counts and generation time so validation can detect partial or mismatched updates and resolve numbered pages without scanning preceding shards.
- Browse results are sanitised and returned 100 at a time. The endpoint accepts validated `?page=N` requests for direct numbered navigation, retains opaque cursor compatibility, and returns current-page, page-size and total-page metadata. Search follows Shopify's official 10-product predictive-search limit and includes variant-SKU matching.
- The parts page fetches results only when it is open, so the full catalogue does not slow down the rest of the website.
- Product names stay in their official technical English form in both locales; the interface, status labels and quote workflow are bilingual.
- Product images use the official live catalogue source in this preview. Production image copies require confirmed dealer publication rights and an approved storage workflow.
- Vehicle fitment is not inferred from titles. Projx Racing must confirm fitment before quotation or order.

The customer-safe availability index is generated from an authorised Tegiwa stockfeed with:

```text
node scripts/build-tegiwa-stock-index.mjs <private-stock.csv> YYYY-MM-DD
```

The generated `api/data/tegiwa-stock-index.json` contains only anonymous title hashes, customer-safe SKUs for unambiguous exact-title joins, GBP RRP ranges, broad availability codes and safe lead-time buckets. It never contains product titles, exact stock quantities, account details, credentials or trade costs. Ambiguous SKU joins are suppressed, and conflicting variants, missing SKUs and invalid/zero prices are quarantined instead of guessed.

Public availability means one of:

- at least one variant in stock at Tegiwa;
- at least one variant with supplier stock indicated;
- availability confirmation required; or
- currently out of stock.

It never means the item is physically stocked at Projx Racing. Every result also carries the stockfeed check date, and the final Projx quotation confirms price, fitment, shipping, Kuwait duties and delivery timing.

Once the stock snapshot is more than seven days old, availability automatically falls back to **confirm availability** and supplier GBP RRP is replaced with **confirm price**. Stale supplier price, inventory and lead-time claims are never presented as current. A product-detail request may still show an official price returned by Tegiwa's live public product endpoint during that request.

To refresh the snapshot, download the authorised feed privately, rerun the generator with the new check date, run all checks, inspect the aggregate counts and privacy assertions, then deploy only the generated anonymous index. Never commit the raw feed.

The search summary fingerprints only the customer-safe product-to-SKU mapping. Price, availability, lead-time and check-date changes therefore do not require rebuilding the large search dictionaries or postings. If an SKU is added, removed, renamed or assigned to a different product, validation deliberately reports a stale search index; run `npm run catalog:tegiwa-search` and validate again before publishing.

Refresh the public sitemap manifest independently with `npm run catalog:tegiwa-sitemaps -- YYYY-MM-DD`. It contains only official public sitemap URLs, not account data or dealer credentials.

After downloading those public product sitemaps to a private temporary directory, rebuild the sanitized browse snapshot with:

```text
npm run catalog:tegiwa-snapshot -- <local-product-sitemap-directory> <generated-at-ISO>
```

The generator validates every source URL, product handle, title and image host, rejects duplicate handles, writes to a staging directory, and replaces the snapshot atomically. Never commit the downloaded XML files; commit only the generated JSON shards and summary after `npm run check` passes.

## Optional verified remote Tegiwa stock release

The website can read a current, customer-safe stock index from a small public release manifest without writing to the catalogue database. Set both server-only environment variables:

- `TEGIWA_STOCK_MANIFEST_URL` — the absolute public HTTPS URL of the current manifest.
- `TEGIWA_STOCK_MANIFEST_SECRET` — the exact UTF-8 HMAC key shared only by the publisher and website function. It must be 32–1,024 bytes.

The URL is not enabled without the secret. Never prefix either name with `NEXT_PUBLIC_`, put the secret in a URL, log it, return it from an API, or expose a private supplier-feed address.

The manifest and immutable JSON artifact must use the same public hostname. Only the exact fields below are accepted; private source hashes, paths, thresholds, credentials, raw quantities, dealer costs, and other extra fields are rejected.

```json
{
  "version": 2,
  "vendor": "Tegiwa",
  "releaseId": "2026-08-05T09-00-00Z",
  "retrievedAt": "2026-08-05T09:00:00.000Z",
  "publishedAt": "2026-08-05T09:05:00.000Z",
  "expiresAt": "2026-08-05T11:00:00.000Z",
  "counts": {
    "productCount": 193844,
    "skuProductCount": 188832,
    "availableProductCount": 26349
  },
  "artifact": {
    "url": "https://catalogue.example.com/tegiwa/releases/2026-08-05T09-00-00Z.json",
    "bytes": 12270000,
    "sha256": "<64 lowercase hexadecimal characters>"
  },
  "signature": "<64 lowercase hexadecimal HMAC-SHA256>"
}
```

`retrievedAt` is when the supplier snapshot was actually obtained and becomes the customer-visible stock `checkedAt`. `publishedAt` is when this public release was created. `expiresAt` is when price and availability claims must become stale. All timestamps are canonical UTC ISO strings. They must satisfy `retrievedAt <= publishedAt < expiresAt`; publication must occur within two hours of retrieval; validity may not exceed 24 hours; and retrieval/publication may not be more than five minutes ahead of the website clock. Normal expiry is accepted so the API can degrade safely rather than invent freshness.

### Canonical HMAC payload

The signing and verification implementation is shared in `server/tegiwa-public-manifest.js`. The publisher must calculate HMAC-SHA256 with the exact UTF-8 bytes of `TEGIWA_STOCK_MANIFEST_SECRET` over this one-line JSON value with no BOM, whitespace, or trailing newline:

```text
JSON.stringify([
  version,
  vendor,
  releaseId,
  retrievedAt,
  publishedAt,
  expiresAt,
  counts.productCount,
  counts.skuProductCount,
  counts.availableProductCount,
  artifact.url,
  artifact.bytes,
  artifact.sha256
])
```

The lowercase hexadecimal digest becomes `signature`. `artifact.url` must already be in the canonical form returned by `new URL(value).toString()`. A future publisher should import `signTegiwaPublicManifest` instead of reimplementing this contract.

Publish a new immutable artifact first, verify its remote byte count and SHA-256, then conditionally replace the small current-manifest file. The server rejects unsigned or altered manifests, redirects, non-JSON responses, oversized files, impossible timestamps, releases older than the bundled snapshot, warm-instance rollbacks, changed SKU-to-product mappings, and SHA-256 mismatches.

A valid release is kept in server memory for five minutes. If refresh fails, the last verified remote index is retained rather than immediately replaced by older bundled data. At `expiresAt`, stock and supplier-price claims naturally become confirmation-required; the verified index may remain as bounded stale-if-error data for at most another 24 hours. After that hard limit it is removed from memory and the bundled verified index is used.

This connection is intentionally read-only. The public API response may show `checkedAt`, `stockPublishedAt`, and `stockExpiresAt`, but never includes the manifest URL, artifact URL, release identifier, signature, HMAC secret, or supplier credentials. Catalogue search dictionaries remain bundled; only price, availability, lead time, and stock timing can change through a compatible signed release.
