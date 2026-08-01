# Files Changed

## Core application

### `assets/app.js`

- Rebuilt page rendering around localized clean routes.
- Added language-aware navigation and saved preference.
- Added theme control and saved preference.
- Added real RTL behaviour.
- Reworked home, services, tuning, engine-building, project, parts, brands, gallery, reviews, about, contact, FAQ, legal and 404 pages.
- Removed obsolete interactive calculation and visualization routes and controls.
- Added direct engine technical-consultation workflow.
- Repaired filters, lightbox, quote basket, modal focus, mobile menu, forms, map loading and WhatsApp handoff.

### `assets/data.js`

- Preserved verified services, projects, brands, media, parts and platform scopes.
- Removed obsolete product-calculation data.
- Clarified supplier relationship labels.
- Kept verified project figures contextualized rather than generalized.
- Removed unconfirmed public opening-day claims.

### `assets/styles.css`

- Added complete dark and light theme token sets.
- Added responsive layouts and true RTL rules.
- Standardized components, typography, spacing and focus states.
- Corrected mobile overflow from galleries, hidden anti-spam input, page heroes and off-canvas navigation.
- Corrected hero icon sizing, technical-panel spacing and fixed-action overlap.
- Added iOS safe-area handling and reduced-motion support.

### `assets/site-config.js`

- Centralized verified telephone, WhatsApp, location, Instagram and Google Business links.
- Added locale and theme configuration.
- Preserved WhatsApp as the verified default form delivery method.

## Translation files

### `assets/i18n/en.js`

Complete English interface, page copy, forms, validation, projects, media descriptions, parts, platform content, FAQs and SEO metadata.

### `assets/i18n/ar.js`

Complete professional Arabic/Kuwaiti interface and copy with technical English retained where it improves accuracy.

## Build and routing

### `scripts/build.mjs`

- Generates 42 logical routes in English and Arabic.
- Generates localized metadata, canonical URLs, alternate-language links, static fallback content and structured data.
- Generates bilingual sitemap and root language entry.

### `template.html`

- Added dynamic language and direction attributes.
- Added early theme initialization.
- Added localized metadata placeholders and dictionaries.
- Added iOS safe-area viewport support.

### `scripts/validate.mjs`

- Validates route count, locale attributes, translations, metadata, media, themes, RTL support and source-file limit.
- Confirms removed obsolete features do not return in source or generated output.

### `scripts/lint.mjs`, `scripts/test-api.mjs`, `scripts/serve.mjs`

- Retained and verified source checks, endpoint tests and local preview support.

## Form endpoint and deployment

### `api/enquiry.js`

- Sanitizes and length-limits submitted content.
- Checks request origin and payload size.
- Includes honeypot and elapsed-time protection.
- Escapes HTML sent by the optional email service.
- Returns truthful fallback behaviour when email is not configured.

### `.github/workflows/deploy-pages.yml`

Builds, checks and deploys `dist/` through GitHub Actions.

### `vercel.json`

Defines build/output configuration, clean localized routes, cache rules and security headers.

### `.env.example`

Lists only optional email-delivery variable names with blank values.

### `package.json`, `package-lock.json`

Updated project description and final-draft version metadata.

## Web and SEO support

- `manifest.webmanifest`
- `sw.js`
- generated `robots.txt`
- generated `sitemap.xml`
- official icons under `assets/brand/`
- social-sharing image under `assets/media/og/`

## Media

All 50 supplied WebP photographs remain under `assets/media/full/`. The official supplied logo and application icons remain under `assets/brand/`.
