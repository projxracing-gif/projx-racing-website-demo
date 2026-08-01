# Projx Racing Website — Final Bilingual Draft

Production-oriented static website for **Projx Racing Co.**, Shuwaikh Industrial, Kuwait.

This version keeps the verified workshop, tuning, engine-building, wiring, fabrication, chassis, project, supplier and contact content while providing a complete English/Arabic experience, true RTL layout, and independently designed light and dark themes.

## Included

- English routes using `en-KW` content
- Arabic routes using `ar-KW` content and native RTL layout
- 42 logical pages in each language: 84 localized pages in total
- Dark and light themes with system-preference detection and saved user choice
- Responsive layouts from 320 px through large desktop screens
- 13 workshop-service records and detailed service pages
- MHD, COBB and HP Tuners compatibility-review flows
- Real engine-building service information and a direct technical consultation form
- 12 verified project records based on supplied company information and media
- 44 brands, suppliers and technical-platform records with relationship labels
- All 50 supplied Projx Racing photographs
- Searchable services, projects, parts, brands and gallery sections
- Quote basket, enquiry forms, mobile navigation, lightbox and FAQ controls
- Verified telephone, WhatsApp, Instagram and map actions
- Localized metadata, canonical URLs, hreflang, structured data, sitemap and robots rules
- Optional Vercel email endpoint with WhatsApp as the verified default delivery method
- GitHub Pages and Vercel deployment configuration

The retired interactive calculation and visualization module is not included in this project. Engine-building and Mainline Dyno services remain as real workshop services.

## Project structure

```text
api/
  enquiry.js                 Optional Vercel email endpoint
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
  serve.mjs                  Local static preview server
template.html                Shared production HTML shell
manifest.webmanifest         Web-app metadata
sw.js                        Static asset cache support
vercel.json                  Vercel build, routes and security headers
.github/workflows/           GitHub Pages workflow
```

`dist/` is generated. Edit the source files, then rebuild it.

## Local setup

Requires Node.js 20 or newer.

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
npm run test:api    # Test the optional enquiry endpoint
npm run check       # Run all checks in sequence
npm run preview     # Serve dist/ locally
```

## Content editing

- Shared verified records: `assets/data.js`
- English visible copy and metadata: `assets/i18n/en.js`
- Arabic/Kuwaiti visible copy and metadata: `assets/i18n/ar.js`
- Contact and deployment settings: `assets/site-config.js`
- Visual design: `assets/styles.css`

Keep brand names, engine codes, product names, software names, units, email addresses and phone numbers in their approved form. Do not add prices, warranties, results, dealer claims or technical limits without written approval.

## Enquiry delivery

The default website mode prepares a structured WhatsApp message to the verified public number. It does not claim that an email was sent.

Vercel email delivery can be activated only after an approved public inbox and verified sender domain are supplied. See `.env.example` and `DEPLOYMENT.md`.

## Important launch inputs

The remaining company approvals are listed in `MISSING_BUSINESS_INFORMATION.md`. Complete `PRE_LAUNCH_CHECKLIST.md` before connecting the public domain.
