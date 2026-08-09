# Projx Racing staging changelog

## 9 August 2026

### Complete G-Series Engine catalogue scope

- Captured and reconciled all 355 public ECS Engine listing pages for BMW G80 M3 Competition, G82 M4 Competition and G87 M2: 5,052 vehicle/category placements across all 23 Engine branches.
- Deduplicated those observations by ECS number to 1,260 Engine products with zero supplier-identity conflicts or same-category duplicates. Of these, 405 merge with an existing reviewed identity and 855 are new, bringing the reviewed ECS storefront to 3,383 unique products.
- Preserved ECS and manufacturer part numbers, canonical source URLs, public USD observations, dated supplier availability, descriptions where supplied, and separate G80/G82/G87 selection evidence. Fitment remains possible-only and availability remains confirmation-required.
- Added 734 new checksum-verified supplier image mappings, reused 309 existing mappings, and retained 1,079 product-specific images. The 180 listings without supplier media plus one image that returned HTTP 403 use the clearly labelled ECS media-unavailable fallback.
- Preserved 1,230 fixed public USD price observations and 14 positive public `Starting at` observations. All 14 configurable starting-price products remain quote-only; 13 conflicting-price products plus three zero/variable-price products suppress the amount and remain at `Request price`, for 30 Engine products in the quotation flow and no ambiguous price or live-stock promise.
- Added an exact bilingual Engine parent filter and 23 bilingual child filters for performance, intake, fuel, tools, electrical, mechanical, cooling, oil service, covers, ignition, turbocharger, gaskets, filters, software, drive belts, emissions, pulleys, timing, mounts, vacuum, skid plates, fasteners and superchargers.
- Added complete scope-manifest, route, page-count, identity, media, price, API, pagination, filter and bilingual UI checks. This remains a staging/preview release and does not activate production payments.

### Complete G-Series Drivetrain catalogue scope

- Captured all 64 public ECS Drivetrain listing pages for BMW G80 M3 Competition, G82 M4 Competition and G87 M2, reconciling 732 vehicle/category placements: 244 for G80, 248 for G82 and 240 for G87.
- Reconciled the raw observations to 253 unique ECS identities with zero price or supplier-identity conflicts. The anomalous G82 PDK record, ES#2019435, remains in the private evidence set but is quarantined and fully excluded from customer-facing output, leaving 252 staging products.
- Materialized 232 checksum-verified supplier product images and 20 clearly labelled official ECS placeholders. No guessed image replaces a supplier-media gap.
- Preserved canonical product URLs, ECS and manufacturer part numbers, public retail USD observations, dated supplier availability wording and possible-only vehicle/category evidence. No wholesale, dealer-cost or authenticated supplier data is present.
- Added an English/Arabic Drivetrain parent filter and bilingual customer-facing child categories while keeping the quarantined PDK taxonomy out of search, API results and the category directory.
- Added repeatable scope-manifest, pagination, 732-row reconciliation, three-digit ECS identity, quarantine, image, price, merge, API and category-filter checks.
- This release remains staging-only. It does not authorize or perform a production deployment.

### Complete G-Series Interior catalogue scope

- Added every product placement shown in the public ECS Interior roots for BMW G87 M2, G80 M3 Competition and G82 M4 Competition: 1,958 category placements across 88 non-empty vehicle/category branches and 180 rendered catalogue pages, reconciled to 678 unique ECS products.
- Merged 230 overlapping ECS identities with the established reviewed, Performance and Exterior collection. This adds 448 new storefront products and brings the customer-facing ECS total to 2,127 unique products without changing existing handles.
- Added 373 new checksum-verified local 300-by-225 WebP files and reused matching verified Performance and Exterior media. Of the 678 Interior products, 559 display product-specific supplier media and 119 display a clearly labelled supplier-media-unavailable image instead of a guessed image.
- Preserved ECS number, manufacturer part number, canonical product URL, public USD price observation, dated supplier availability wording, descriptions where supplied, and separate G87/G80/G82 category evidence.
- Kept all generated fitment at possible/confirmation-required and all availability as a dated observation rather than live stock. The merged catalogue holds 31 price conflicts at Request price instead of exposing an ambiguous amount.
- Added an exact bilingual Interior parent filter plus 32 bilingual child filters, while retaining merged category evidence for products already present in another ECS scope.
- Added repeatable Interior capture-combination, frozen category-count, pagination, source-path, identity-conflict, media, merge, API and UI regression checks.

## 8 August 2026

### Complete G-Series Exterior catalogue scope

- Added every product placement shown in the public ECS Exterior roots for BMW G87 M2, G80 M3 Competition and G82 M4 Competition: 1,725 category placements across 41 non-empty category branches and 130 rendered catalogue pages, deduplicated to 782 unique ECS products.
- Merged 237 overlapping ECS identities with the existing reviewed/Performance collection, bringing the customer-facing ECS total to 1,679 unique products without changing established handles.
- Added 436 new checksum-verified local product images and reused matching verified Performance media. The 139 products for which ECS supplied no product image display a clearly labelled local placeholder instead of a guessed image.
- Preserved ECS number, manufacturer part number, canonical source URL, public USD price observation, dated supplier availability phrase, description where supplied, and separate G87/G80/G82 category evidence.
- Kept all generated fitment at possible/confirmation-required, kept dated availability from being represented as live stock, and held all 10 same-day merged-catalogue price conflicts at Request price (6 from the Performance capture and 4 additional cross-scope conflicts).
- Wired the 14 Exterior supplier categories into exact part-type filters, added Brand and Part type controls to the unified catalogue, and added an exact all-Exterior scope covering all 782 Exterior products.
- Added strict repeatable capture-combination, media-index merge, identity-conflict, price-conflict, placeholder-upgrade, and category-filter validation.

## 6 August 2026

### Featured BMW M catalogue batch

- Added 26 manually reviewed ECS products for BMW M3/M4 F80, F82, G80 and G82, bringing the reviewed ECS collection to 41 products and the structured ECS-plus-Tegiwa total to 193,294.
- The separately reviewed 034Motorsport exhaust clamp became the 15th ECS product before this 26-item batch; the 5 August entry below records the earlier 14-product state.
- Added official local 800-by-600 product media, bilingual descriptions and alternative text, ECS and manufacturer part numbers, public USD price observations, and dated supplier-stock observations for every new item.
- Excluded the Akrapovič candidate because its supplier image and availability evidence conflicted; no blank image or guessed stock state was published.
- Added four bilingual one-tap ECS catalogue searches for the reviewed BMW M chassis and clearly described them as featured relevance-based selections, not a supplier-published sales ranking.
- Corrected the BMW M vehicle-directory mapping so M3/M4 generation selections send F80, F82, G80 or G82 structured fitment evidence to the unified catalogue.
- Kept all new items on fitment and supplier confirmation; no ECS item was added to the direct-cart allowlist.

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
- Rebalanced the 402px mobile header so all six actions remain fully visible in English and Arabic with 44px touch targets; the duplicate header WhatsApp action is hidden on narrower phones while the persistent WhatsApp action remains available.
- Constrained the partial-catalogue status icon to its intended 18px size so it cannot expand across the catalogue panel while supplier data is loading or running from the reviewed fallback.
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
