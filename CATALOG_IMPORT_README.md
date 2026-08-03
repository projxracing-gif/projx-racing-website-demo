# Private catalogue import contract

Raw supplier CSV, XLS/XLSX, XML, JSON, image archives and portal exports belong under `private-imports/`, which is ignored by Git. Never place a complete dealer stockfeed in `assets/`, `dist/` or a commit.

The public site uses the small `storeProducts` array in `assets/data.js`. A product may be copied into that array only after a human confirms:

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
