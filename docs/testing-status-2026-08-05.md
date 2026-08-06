# Staging testing status — updated 6 August 2026

## Passed locally

- Production build: 101 routes in each language, 202 localized pages total.
- Production validation: 204 HTML files, 560 generated files, 13 services, 12 projects, 46 brands, 44 reviewed catalogue products, and 80 supplied Projx images.
- Catalogue data audit: 41 reviewed ECS products, 43 unique local ECS images, 41 public USD price observations, 41 bilingual descriptions, zero duplicate image hashes, zero structured independently verified exact-fitment records, and zero live-stock claims.
- Catalogue tests: Tegiwa API, unified catalogue, ECS review, vehicle directory, duplicate checks, stock publisher, and product-detail outage fallback.
- Commerce tests: cart add/change/remove/persistence, direct-product allowlist, quote-only policy, staging receipt, and duplicate-order prevention.
- Account tests: profile, addresses, saved cart, orders, quotations, authentication failure states, lifecycle retention, and private endpoint protection.
- Email tests: validation, idempotency, safe notification content, outbox retry, and fail-closed public-delivery controls.
- Browser journeys: English/Arabic, RTL, light/dark, desktop, 402-by-874 iPhone-class viewport, 412-by-915 Android viewport, mobile menus, catalogue filters, product detail, cart, checkout, account tabs, and 404 handling.
- Browser result: 13 pages, 33 interactions, 10 representative screenshots, zero page failures, zero interaction failures, zero console errors, zero broken images, and no horizontal overflow.
- Focused 6 August browser check: the four BMW M quick searches, F80/F82 and G80/G82 result separation, English and Arabic product details, RTL, dark/light persistence, official product images, prices, identifiers and dated stock observations all passed with zero local console errors, zero broken images and no horizontal overflow at the tested desktop viewport. Existing mobile regression coverage remains unchanged.

## Direct cart policy

Direct Add to Cart is enabled only for:

- MagnusT GR Yaris GoPro headrest mount, LHD — supplier SKU `T-GOPRO-MOUNT-YARISGR-LHD`, GBP 31.19, with fitment confirmation required and a seven-day verification freshness limit.

All 41 reviewed ECS products and all other supplier products remain Request a Quote until their price, availability, shipping, and fitment data is sufficiently reliable.

## Activation still required

- Customer accounts: increase Neon capacity or approve safe database cleanup, apply the prepared migration on a temporary branch, and configure Clerk publishable/server keys, issuer, audience/authorized origins, and webhook secret.
- Transactional email: provide a Resend key, verified sender address/domain, SPF, DKIM, DMARC, durable CAPTCHA/WAF protection, and explicit enablement flags; then run real inbox delivery tests.
- Hourly supplier stock: provide a supported vendor feed or publication permission plus Vercel Blob token, manifest secret, and an approved scheduler.
- Payments: no payment gateway is connected. Staging checkout must remain non-charging until separate explicit approval and test credentials are supplied.
- ECS completeness: 41 reviewed products are currently published, including 26 manually reviewed BMW M3/M4 F80/F82/G80/G82 selections added on 6 August 2026. ECS does not publish sales rank or units sold, so these are labelled featured reviewed selections rather than verified best sellers. Public price and availability observations are dated and require confirmation. ECS has approved manual copying and advised that an FTP export may be possible, but FTP access is not yet approved or delivered. The complete ECS catalogue cannot be represented accurately until a supported source, field/update contract, scalable storage/import path and staged validation are available.

## Safety statement

The staging build does not charge cards, reserve stock, create a durable order, or send customer/admin transactional email. Account and email endpoints fail closed when their private configuration is absent.
