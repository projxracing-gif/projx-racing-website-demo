# Staging testing status — updated 8 August 2026

## Passed locally

- Production build: 101 routes in each language, 202 localized pages total.
- Production validation: 204 HTML files, 1,763 production files, 13 services, 12 projects, 46 brands, 44 curated Projx catalogue products, and 80 supplied Projx images.
- Catalogue data audit: 1,679 unique reviewed ECS products, 1,679 local primary images, 1,667 safe public USD price observations, 1,573 detailed supplier descriptions, zero duplicate ECS identities/handles/source URLs, zero independently verified exact-fitment records, and zero live-stock claims.
- G-Series Exterior scope: all 1,725 observed placements across the 41 non-empty G87/G80/G82 Exterior branches were reconciled to 782 unique products. Of those, 643 have product-specific supplier media and 139 use a clearly labelled supplier-media-unavailable image.
- Catalogue tests: Tegiwa API, unified catalogue, ECS review, vehicle directory, duplicate checks, stock publisher, and product-detail outage fallback.
- Commerce tests: cart add/change/remove/persistence, direct-product allowlist, quote-only policy, staging receipt, and duplicate-order prevention.
- Account tests: profile, addresses, saved cart, orders, quotations, authentication failure states, lifecycle retention, and private endpoint protection.
- Email tests: validation, idempotency, safe notification content, outbox retry, and fail-closed public-delivery controls.
- Browser journeys: English/Arabic, RTL, light/dark, desktop, 402-by-874 iPhone-class viewport, 412-by-915 Android viewport, mobile menus, catalogue filters, product detail, cart, checkout, account tabs, and 404 handling.
- Browser result: 13 pages, 33 interactions, 10 representative screenshots, zero page failures, zero interaction failures, zero console errors, zero broken images, and no horizontal overflow.
- Focused 6 August browser check: the four BMW M quick searches, F80/F82 and G80/G82 result separation, English and Arabic product details, RTL, dark/light persistence, official product images, prices, identifiers and dated stock observations all passed with zero local console errors, zero broken images and no horizontal overflow at the tested desktop viewport. Existing mobile regression coverage remains unchanged.
- Focused 8 August browser check: the unified catalogue showed 194,932 records, 100 products per page, 1,679 reviewed ECS records, 782 exact Exterior records and 580 exact Exterior Body records. Verified-image, labelled-placeholder and `From` price details passed; Arabic RTL product/category copy, LTR identifiers, light/dark switching, direct product refreshes, zero console errors and zero horizontal overflow passed at the tested desktop viewport. Existing iPhone-class and Android regression coverage remains in force; the new badge wrapping rule is covered by the UI regression test.

## Direct cart policy

Direct Add to Cart is enabled only for:

- MagnusT GR Yaris GoPro headrest mount, LHD — supplier SKU `T-GOPRO-MOUNT-YARISGR-LHD`, GBP 31.19, with fitment confirmation required and a seven-day verification freshness limit.

All 1,679 reviewed ECS products and all other non-approved supplier products remain Request a Quote until their price, availability, shipping, and fitment data is sufficiently reliable.

## Activation still required

- Customer accounts: increase Neon capacity or approve safe database cleanup, apply the prepared migration on a temporary branch, and configure Clerk publishable/server keys, issuer, audience/authorized origins, and webhook secret.
- Transactional email: provide a Resend key, verified sender address/domain, SPF, DKIM, DMARC, durable CAPTCHA/WAF protection, and explicit enablement flags; then run real inbox delivery tests.
- Hourly supplier stock: provide a supported vendor feed or publication permission plus Vercel Blob token, manifest secret, and an approved scheduler.
- Payments: no payment gateway is connected. Staging checkout must remain non-charging until separate explicit approval and test credentials are supplied.
- ECS wider-catalogue completeness: the requested G87/G80/G82 Performance and Exterior scopes are published as reviewed records, but this is not the entire multi-million-item ECS catalogue. ECS does not publish sales rank or units sold, and no API, stockfeed or FTP export has been supplied. Public price and availability observations are dated and require confirmation. Any broader ECS import still requires an approved repeatable source, field/update contract, scalable storage/import path and staged validation.

## Safety statement

The staging build does not charge cards, reserve stock, create a durable order, or send customer/admin transactional email. Account and email endpoints fail closed when their private configuration is absent.
