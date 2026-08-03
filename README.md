# Projx Racing Website — Final Bilingual Draft

Production-oriented static website for **Projx Racing Co.**, Shuwaikh Industrial, Kuwait.

This version keeps the verified workshop, tuning, engine-building, wiring, fabrication, chassis, project, supplier and contact content while providing a complete English/Arabic experience, true RTL layout, and independently designed light and dark themes.

## Included

- English routes using `en-KW` content
- Arabic routes using `ar-KW` content and native RTL layout
- 59 logical pages in each language: 118 localized pages in total
- Dark and light themes with system-preference detection and saved user choice
- Responsive layouts from 320 px through large desktop screens
- 13 workshop-service records and detailed service pages
- MHD, COBB and HP Tuners compatibility-review flows
- Real engine-building service information and a direct technical consultation form
- 12 verified project records based on supplied company information and media
- 46 brands, suppliers and technical-platform records with relationship labels
- 80 verified Projx Racing photographs, including 30 newly selected high-resolution workshop, engine, dyno and track images
- Searchable services, projects, parts, brands and gallery sections
- A paginated full-range Tegiwa preview catalogue using official product data, GBP prices and a customer-safe stock snapshot without exposing exact dealer inventory
- Quote basket, enquiry forms, secure customer-account portal shell, mobile navigation, lightbox and FAQ controls
- Verified telephone, WhatsApp, Instagram and map actions
- Localized metadata, canonical URLs, hreflang, structured data, sitemap and robots rules
- Vercel email endpoint routed to `projxracing@gmail.com`, with WhatsApp as the automatic fallback until Resend is connected
- GitHub Pages and Vercel deployment configuration

The retired interactive calculation and visualization module is not included in this project. Engine-building and Mainline Dyno services remain as real workshop services.

## Project structure

```text
api/
  enquiry.js                 Secure Vercel enquiry-email endpoint
  tegiwa-catalog.js          Restricted Tegiwa search/browse/detail proxy
  data/                      Anonymous customer-safe stock/RRP index
assets/
  app.js                     Page rendering and interactions
  data.js                    Verified shared business/content records
  site-config.js             Contact, URLs and deployment settings
  styles.css                 Theme, RTL and responsive design system
  i18n/en.js                 Complete English dictionary
  i18n/ar.js                 Complete Arabic/Kuwaiti dictionary
  brand/                     Official supplied logo and app icons
  media/                     All approved supplied media
scripts/
  build.mjs                  Generates localized static pages
  lint.mjs                   JavaScript/source checks
  validate.mjs               Route, metadata, content and asset validation
  test-api.mjs               Enquiry endpoint tests
  test-tegiwa-catalog-api.mjs Tegiwa API security and contract tests
  build-tegiwa-stock-index.mjs Private-feed to public-safe index builder
  serve.mjs                  Local static preview server
template.html                Shared production HTML shell
manifest.webmanifest         Web-app metadata
sw.js                        Static asset cache support
vercel.json                  Vercel build, routes and security headers
.github/workflows/           GitHub Pages workflow
```

`dist/` is generated. Edit the source files, then rebuild it.

## Local setup

Requires Node.js 24.x.

```bash
npm ci
npm run check
npm run preview
```

Open:

```text
http://127.0.0.1:4173/
```

The root page directs visitors to English or Arabic. The primary routes are:

```text
/en/
/ar/
```

## Build commands

```bash
npm run lint        # JavaScript/source checks
npm run build       # Generate dist/
npm run validate    # Validate routes, translations, metadata and media
npm run test:api    # Test the enquiry and Tegiwa catalogue endpoints
npm run check       # Run all checks in sequence
npm run preview     # Serve dist/ locally
```

## Content editing

- Shared verified records: `assets/data.js`
- English visible copy and metadata: `assets/i18n/en.js`
- Arabic/Kuwaiti visible copy and metadata: `assets/i18n/ar.js`
- Contact and deployment settings: `assets/site-config.js`
- Visual design: `assets/styles.css`
- Tegiwa catalogue import and privacy contract: `CATALOG_IMPORT_README.md`

Keep brand names, engine codes, product names, software names, units, email addresses and phone numbers in their approved form. Do not add prices, warranties, results, dealer claims or technical limits without written approval.

## Enquiry delivery

All website enquiry forms first use the secure Vercel endpoint. The recipient defaults to `projxracing@gmail.com` and can later be changed through `ENQUIRY_TO_EMAIL` without editing the website. Until Resend and an approved sender are connected, the same structured request opens in WhatsApp and the website does not claim that an email was sent.

## Customer accounts

The bilingual `/account/` route includes sign-in, registration and profile-management mounting points for Clerk. Account credentials are never stored in the static website. Add `CLERK_PUBLISHABLE_KEY` in Vercel to activate the portal; never commit keys to GitHub. See `.env.example` and `DEPLOYMENT.md`.

## Important launch inputs

The remaining company approvals are listed in `MISSING_BUSINESS_INFORMATION.md`. Complete `PRE_LAUNCH_CHECKLIST.md` before connecting the public domain.
