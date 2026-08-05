# Projx Racing staging changelog

## 5 August 2026

### Unified parts catalogue

- Combined the existing Tegiwa snapshot and the reviewed ECS catalogue behind one catalogue endpoint and one customer search/filter experience.
- Preserved 193,253 Tegiwa catalogue records and added 14 manually reviewed ECS products without duplicate handles, supplier IDs, manufacturer part numbers, source URLs, or image hashes.
- Added vehicle, make, model, chassis, year, engine, brand, category, price, and availability filtering where the supplier data supports those fields.
- Added a last-known-good Tegiwa product-detail fallback so supplier downtime does not leave product cards unusable.
- Kept unknown fitment, stock, lead-time, specifications, and prices explicitly unconfirmed rather than inventing data.

### Cart and staging checkout

- Added a bilingual, persistent browser cart with quantity changes, removal, continue-shopping, saved-cart support, and mobile layouts.
- Enabled direct cart purchase for one recently verified, low-risk Tegiwa product only.
- Kept the 14 ECS products and all uncertain, custom, oversized, variable-price, or fitment-sensitive products on Request a Quote.
- Added a safe staging checkout receipt that performs no payment, stock reservation, customer email, or durable order creation.
- Added clear fitment, freight, customs, installation, returnability, availability, and special-order notices.

### Customer accounts and private backend

- Added bilingual account, address, saved-cart, quotation, order-history, and profile interfaces.
- Added protected account, address, cart, quote, order, Clerk webhook, and email retry endpoints.
- Added Clerk audience/origin validation, lifecycle synchronization, deletion anonymization, least-privilege database templates, and retained legal order/quote snapshots.
- Added a private Neon migration for customer commerce data. It is prepared but intentionally not applied until storage capacity and credentials are approved.

### Transactional email safeguards

- Added Resend-compatible contact, quotation, account, and staging commerce email paths.
- Removed customer-supplied prices from shop notifications.
- Added durable outbox retry and idempotency protections.
- Public email delivery remains fail-closed until anti-abuse controls, a verified sending domain, DNS authentication, and production credentials are configured.

### Media, bilingual UI, accessibility, and SEO

- Audited 80 supplied Projx Racing images, retained 74 context-appropriate uses, corrected project covers, and preserved image proportions with responsive derivatives.
- Added accurate alt text and versioned local product-image URLs.
- Kept English/Arabic, RTL, light/dark themes, desktop, tablet, iPhone, and Android layouts.
- Marked account, cart, and checkout pages `noindex` and removed them from the sitemap.
- Corrected duplicate form IDs and connected signed-in quotation submissions to account history.

### Supplier synchronization tooling

- Added local snapshot validation, Neon import, Vercel Blob publication, SKU mapping, manifest verification, and scheduler-ready scripts.
- Hourly synchronization is not active until a supplier-supported feed, Blob credentials, manifest secret, and scheduler are configured.

### Preview deployment compatibility

- Moved internal catalogue and commerce helpers out of the deployable API-route directory, leaving 11 serverless routes within the Vercel Hobby preview limit of 12.
- Added a production validator guard so a future helper cannot silently exceed that deployment limit again.

### Main areas modified

- `assets/`: catalogue, account, cart, checkout, bilingual interface, media, and responsive styles.
- `api/`: unified catalogue, enquiry, customer commerce, Clerk lifecycle, staging order, and email retry routes.
- `server/`: shared authentication, database, commerce, email, and validation services.
- `migrations/`: private customer-commerce schema and least-privilege role template.
- `scripts/`: build, validation, catalogue audit/import, supplier sync, and focused test suites.
- `docs/`: catalogue status, private backend, security, local storage, and stock-sync handover notes.
- `vercel.json`, `.env.example`, and package scripts: staging-safe deployment configuration without credentials.
