# Projx Racing Performance Parts Store — Implementation Order

## Authority and source project

Use the current completed Projx Racing website on the preview branch as the only source project. Preserve its approved bilingual English–Arabic content, RTL behaviour, light and dark themes, branding, contact information, media, responsive layouts, enquiry delivery and existing routes. Do not rebuild the website, alter the production branch, or reintroduce removed simulator functionality.

This brief is the active implementation order for the Performance Parts upgrade.

## Objective

Transform the existing Performance Parts page into a clear, premium, store-like catalogue that helps customers reach the correct part quickly by vehicle, category or brand. The first release remains a quotation/enquiry store rather than pretending to offer automated checkout, stock reservation or carrier prices that are not yet connected.

## Authorised data sources

1. Use the current Projx catalogue and verified business information already in the project.
2. Use the authorised Tegiwa B2B stockfeed and dealer-portal files supplied to Projx Racing.
3. Use other dealer, distributor or manufacturer feeds only when Projx has access and the data is licensed for customer-facing publication.
4. Treat public ECS Tuning pages as UX and process research only unless an authorised ECS catalogue/media feed is supplied.
5. Never scrape, clone or republish proprietary ECS code, fitment records, product copy, photographs or hidden shipping systems.
6. Do not commit raw dealer exports, trade costs, portal credentials, tokens, private stock data or private files to GitHub.

## Product publication rules

Every published product must have:

- A stable slug.
- Brand, product title, supplier SKU and manufacturer part number where supplied.
- A verified customer-facing price in the supplier's original selling currency and verification date, or an explicit “Request price” state. Keep ECS prices in USD and Tegiwa prices in GBP, show the currency and known tax basis clearly, never perform an unapproved conversion, and never expose trade cost.
- At least one correct, product-specific image that Projx is permitted to use. Do not substitute workshop photographs, competitor imagery or a similar-looking item.
- A category and subcategory.
- A sourced stock/lead-time state with a timestamp, written honestly and without implying reservation.
- A clear English description and accurate Arabic/Kuwaiti presentation. Translate labels and concise summaries; keep SKUs, part numbers and technical identifiers left-to-right.
- Structured fitment or an explicit “Universal / Confirm fitment” state. Do not infer fitment from a product title alone.
- Image provenance and source references retained in the private import workflow.

Do not publish a product when its image, price currency, identity or fitment would be misleading.

## Catalogue model and supplier deduplication

Store one canonical public product per brand plus manufacturer part number. Keep supplier offers private. When multiple dealers supply the same item, choose the preferred offer using verified fitment, authorised media quality, landed cost, stock, lead time, warranty and support. Escalate genuinely material supplier choices to Projx Racing instead of publishing duplicates.

Keep raw imports outside the repository and generate a small, sanitised, reviewable catalogue for the static preview. The full Tegiwa export is too large for the current static architecture and lacks images and structured fitment, so only curated, fully verified items may enter this release.

## Store experience

Implement an original Projx design with the useful customer journey found in leading performance-parts stores:

1. A persistent “My Vehicle” bar.
2. Cascading Year → Make → Model → Generation/Chassis → Engine selection derived only from published, verified fitment data.
3. Clear Shop by Vehicle, Shop by Category and Shop by Brand entrances.
4. Search, category, brand, fitment, availability and price filters, plus useful sorting.
5. Photo-first product cards with the verified original-currency price or “Request price”, stock/lead time, fitment status, SKU and a clear product link.
6. Bilingual product-detail pages with product gallery, price, SKU/MPN, stock/lead time, fitment, details, shipping status, quantity and related products.
7. A quote basket with quantity controls, selected vehicle context and a direct “Request quote” path.
8. Responsive desktop and mobile behaviour, including modern iPhone widths, without horizontal overflow.
9. Correct image containment and responsive sizing so product photography is never stretched or ambiguously cropped.

## Vehicle directory

For this release, create a local, versioned vehicle dataset from supplier-confirmed applications for published products. A general year/make/model service may normalise names but must not be treated as proof that a part fits.

Use this hierarchy:

Year → Make → Model → Generation/Chassis → Engine/Variant

Retain market, source, verification date, provider IDs and fitment qualifiers. Mark each product as Verified fit, Universal or Confirm fitment. A licensed TecDoc integration is the preferred scale-up option for GCC/global coverage and Arabic; it requires a separate commercial licence and must be connected server-side.

## Shipping implementation

Reproduce the useful shopping flow, not another company’s proprietary backend. No reliable public source identifies ECS Tuning’s universal shipping-rate provider, so do not claim or copy one.

For this preview:

- Add a shipping-quote workflow capturing product SKU, quantity, destination country, city and postcode; workshop installation or courier; vehicle/VIN when required; and customer contact details.
- Route the completed request through the existing secure enquiry endpoint to `projxracing@gmail.com`.
- Show “Shipping quoted after destination and item review” until authorised carrier APIs, product weight/dimensions, origin rules, customs data and Projx credentials are available.
- Model future fulfilment groups for Projx stock, supplier-direct, backorder, hazardous and oversized items; hold-complete versus split shipment; DDP/DAP; and immutable carrier quote IDs.
- Never display invented shipping prices, delivery times, duties or carrier names.

## Privacy and security

- Add a dedicated ignored `private-imports/` path and ignore dealer CSV, XLS/XLSX and XML exports by default.
- Keep secrets in hosted environment variables only and list variable names without values in `.env.example` when needed.
- Do not expose dealer costs, private stock quantities, emails, account identifiers, credentials or access tokens.
- Product-source audit records must remain private unless explicitly approved for publication.

## SEO, accessibility and performance

- Generate unique bilingual product URLs, titles, descriptions, canonicals, breadcrumbs and Product structured data.
- Emit Offer pricing/availability only for verified current data.
- Use accessible form labels, keyboard controls, focus states, alt text, RTL-safe layouts and `<bdi>` for technical identifiers.
- Optimise authorised images locally, preserve aspect ratio and intrinsic dimensions, lazy-load below-the-fold media and avoid third-party hotlinks.
- Keep the initial curated catalogue small enough for the current static build to remain fast.

## Validation and release

Before publishing the preview:

1. Validate unique slugs, SKUs/MPNs, original-currency prices or explicit quote-only states, image existence/dimensions, translation coverage and fitment shapes.
2. Build all English and Arabic catalogue/detail routes and verify direct loading and refreshes.
3. Test filters, vehicle selection and persistence, sorting, product pages, quantity changes, quote basket, shipping request and enquiry submission handling.
4. Test English/Arabic, light/dark, desktop/mobile, RTL, image clarity, keyboard use, console and failed requests.
5. Run lint, production build, route validation and API tests.
6. Commit and push only to `demo-preview`; deploy a Vercel Preview Deployment and verify the live URL. Do not modify or promote the production branch.

## Known inputs still required for full catalogue commerce

- Authorised dealer-portal access to product media, descriptions and application/fitment files.
- Written confirmation of public image/content reuse rights for each supplier feed.
- An authorised ECS product/media/feed source if ECS products are to be published.
- An approved exchange-rate and rounding policy only when Projx later chooses to convert supplier currencies; until then ECS remains USD and Tegiwa remains GBP.
- Projx shipping origin, package weights/dimensions, customs data and selected carrier/rating provider credentials for live rates.
- A licensed GCC/global vehicle-fitment provider if catalogue-wide coverage is required.
