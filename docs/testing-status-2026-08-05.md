# Staging testing status — updated 9 August 2026

## Passed locally

The current local build and validation figures below include the Drivetrain and Braking staging releases. Public-preview browser results are recorded only after the branch deployment is verified.

- Production build: 101 routes in each language, 202 localized pages total.
- Production validation: 204 HTML files, 2,497 production files, 13 services, 12 projects, 46 brands, 44 curated Projx catalogue products, and 80 supplied Projx images.
- Catalogue data audit: 2,528 unique reviewed ECS products, 2,528 local primary images, 2,495 safe public USD price observations, 2,362 detailed supplier descriptions, zero duplicate ECS identities/handles/source URLs, zero structured or independently verified exact-fitment records, and zero live-stock claims.
- G-Series Exterior scope: all 1,725 observed placements across the 41 non-empty G87/G80/G82 Exterior branches were reconciled to 782 unique products. Of those, 643 have product-specific supplier media and 139 use a clearly labelled supplier-media-unavailable image.
- G-Series Interior scope: all 1,958 observed placements across 88 non-empty G87/G80/G82 Interior vehicle/category branches and 180 listing pages were reconciled to 678 unique products. Of those, 559 have product-specific supplier media, 119 use a clearly labelled supplier-media-unavailable image, 373 new local WebP files were materialized, and 31 merged-catalogue price conflicts are held at Request price.
- G-Series Drivetrain scope: all 64 public listing pages and 732 placements reconcile exactly as G80 244, G82 248 and G87 240. The raw evidence contains 253 unique ECS identities; ES#2019435 is quarantined and fully excluded, leaving 252 customer-facing products with 232 verified supplier images, 20 official placeholders, zero within-scope price or identity conflicts, public retail USD observations only and no wholesale data. English/Arabic parent and customer-facing child category mappings are present in the staging interface.
- G-Series Braking scope: all 77 public listing pages and 822 placements reconcile exactly as G80 289, G82 288 and G87 245. The 822 placements deduplicate to 253 customer-facing products with 216 verified supplier images, 37 official labelled placeholders, 253 public retail USD observations, zero price or supplier-identity conflicts and zero quarantined products. The exact English/Arabic parent and 15 child filters are present; G87 correctly retains explicit zero-count Electrical and ABS branches because ECS does not publish those two branches for that vehicle.
- Catalogue tests: Tegiwa API, unified catalogue, ECS review, vehicle directory, duplicate checks, stock publisher, and product-detail outage fallback.
- Commerce tests: cart add/change/remove/persistence, direct-product allowlist, quote-only policy, staging receipt, and duplicate-order prevention.
- Account tests: profile, addresses, saved cart, orders, quotations, authentication failure states, lifecycle retention, and private endpoint protection.
- Email tests: validation, idempotency, safe notification content, outbox retry, and fail-closed public-delivery controls.
- Browser journeys: English/Arabic, RTL, light/dark, desktop, 402-by-874 iPhone-class viewport, 412-by-915 Android viewport, mobile menus, catalogue filters, product detail, cart, checkout, account tabs, and 404 handling.
- Browser result: 13 pages, 33 interactions, 10 representative screenshots, zero page failures, zero interaction failures, zero console errors, zero broken images, and no horizontal overflow.
- Focused 6 August browser check: the four BMW M quick searches, F80/F82 and G80/G82 result separation, English and Arabic product details, RTL, dark/light persistence, official product images, prices, identifiers and dated stock observations all passed with zero local console errors, zero broken images and no horizontal overflow at the tested desktop viewport. Existing mobile regression coverage remains unchanged.
- Focused 8 August browser check: the unified catalogue showed 194,932 records, 100 products per page, 1,679 reviewed ECS records, 782 exact Exterior records and 580 exact Exterior Body records. Verified-image, labelled-placeholder and `From` price details passed; Arabic RTL product/category copy, LTR identifiers, light/dark switching, direct product refreshes, zero console errors and zero horizontal overflow passed at the tested desktop viewport. Existing iPhone-class and Android regression coverage remains in force; the new badge wrapping rule is covered by the UI regression test.
- Focused 9 August browser check: a copied `?partType=interior` URL restored the exact Interior filter and showed 678 products over seven 100-product pages while retaining the combined 195,380-product and 26,349-availability headline figures. The 32-option Interior directory, direct filter refresh, English and Arabic/Kuwaiti copy, RTL, light/dark switching, product-specific and labelled-unavailable images, ES#/MPN, price, dated availability, G87/G80/G82 fitment evidence, product modal and supplier link passed with zero browser-console errors at the tested desktop viewport. Existing iPhone-class and Android responsive regression coverage remains in force.
- Focused 9 August Braking browser check: the exact `?partType=braking-abs` deep link restored the two-product ABS result set, preserved the selected child filter in the shareable URL and updated the alternate-language link. English product details for ES#4900999 displayed the expected heading, manufacturer part number, public USD observation, G80/G82 possible-fitment evidence and confirmation warning. Arabic/Kuwaiti RTL, direct refresh, light-mode persistence, zero broken images and zero horizontal overflow passed locally; English and Arabic pages were also rendered at a 430-by-932 mobile viewport while the established iPhone-class and Android regression suite remained green.

## Direct cart policy

Direct Add to Cart is enabled only for:

- MagnusT GR Yaris GoPro headrest mount, LHD — supplier SKU `T-GOPRO-MOUNT-YARISGR-LHD`, GBP 31.19, with fitment confirmation required and a seven-day verification freshness limit.

All 2,528 reviewed ECS products and all other non-approved supplier products remain Request a Quote until their price, availability, shipping, and fitment data is sufficiently reliable.

## Activation still required

- Customer accounts: increase Neon capacity or approve safe database cleanup, apply the prepared migration on a temporary branch, and configure Clerk publishable/server keys, issuer, audience/authorized origins, and webhook secret.
- Transactional email: provide a Resend key, verified sender address/domain, SPF, DKIM, DMARC, durable CAPTCHA/WAF protection, and explicit enablement flags; then run real inbox delivery tests.
- Hourly supplier stock: provide a supported vendor feed or publication permission plus Vercel Blob token, manifest secret, and an approved scheduler.
- Payments: no payment gateway is connected. Staging checkout must remain non-charging until separate explicit approval and test credentials are supplied.
- ECS wider-catalogue completeness: the requested G87/G80/G82 Performance, Exterior, Interior, Drivetrain and Braking scopes are prepared as reviewed staging records, but this is not the entire multi-million-item ECS catalogue and is not a production deployment. ECS does not publish sales rank or units sold, and no API, stockfeed or FTP export has been supplied. Public price and availability observations are dated and require confirmation. Any broader ECS import still requires an approved repeatable source, field/update contract, scalable storage/import path and staged validation.

## Safety statement

The staging build does not charge cards, reserve stock, create a durable order, or send customer/admin transactional email. Account and email endpoints fail closed when their private configuration is absent.
