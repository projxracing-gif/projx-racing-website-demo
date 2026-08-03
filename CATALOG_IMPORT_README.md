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
- `api/data/tegiwa-catalog-pages/` contains 194 compact public-data shards with only product handle, title and allowlisted image URL. It contains no SKU, exact quantity, dealer pricing or account data.
- `api/data/tegiwa-catalog-summary.json` records snapshot counts and generation time so validation can detect partial or mismatched updates.
- Browse results are sanitised and returned 24 at a time with opaque cursor pagination; search follows Shopify's official 10-product predictive-search limit and includes variant-SKU matching.
- The parts page fetches results only when it is open, so the full catalogue does not slow down the rest of the website.
- Product names stay in their official technical English form in both locales; the interface, status labels and quote workflow are bilingual.
- Product images use the official live catalogue source in this preview. Production image copies require confirmed dealer publication rights and an approved storage workflow.
- Vehicle fitment is not inferred from titles. Projx Racing must confirm fitment before quotation or order.

The customer-safe availability index is generated from an authorised Tegiwa stockfeed with:

```text
node scripts/build-tegiwa-stock-index.mjs <private-stock.csv> YYYY-MM-DD
```

The generated `api/data/tegiwa-stock-index.json` contains only anonymous title hashes, GBP RRP ranges, broad availability codes and safe lead-time buckets. It never contains product titles, SKUs, exact stock quantities, account details, credentials or trade costs. Conflicting variants, missing SKUs and invalid/zero prices are quarantined instead of guessed.

Public availability means one of:

- at least one variant in stock at Tegiwa;
- at least one variant with supplier stock indicated;
- availability confirmation required; or
- currently out of stock.

It never means the item is physically stocked at Projx Racing. Every result also carries the stockfeed check date, and the final Projx quotation confirms price, fitment, shipping, Kuwait duties and delivery timing.

Availability badges automatically fall back to **confirm availability** once the stock snapshot is more than seven days old. GBP RRP remains visible as a reference, but stale inventory and lead-time claims are never presented as current.

To refresh the snapshot, download the authorised feed privately, rerun the generator with the new check date, run all checks, inspect the aggregate counts and privacy assertions, then deploy only the generated anonymous index. Never commit the raw feed.

Refresh the public sitemap manifest independently with `npm run catalog:tegiwa-sitemaps -- YYYY-MM-DD`. It contains only official public sitemap URLs, not account data or dealer credentials.

After downloading those public product sitemaps to a private temporary directory, rebuild the sanitized browse snapshot with:

```text
npm run catalog:tegiwa-snapshot -- <local-product-sitemap-directory> <generated-at-ISO>
```

The generator validates every source URL, product handle, title and image host, rejects duplicate handles, writes to a staging directory, and replaces the snapshot atomically. Never commit the downloaded XML files; commit only the generated JSON shards and summary after `npm run check` passes.
