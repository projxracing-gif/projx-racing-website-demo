# Production Test Report

## Final result

All automated source, build, route, responsive and interaction checks completed without failures after the final responsive fixes.

## Build and source checks

Command:

```bash
npm ci
npm run check
```

Result:

```text
Source modules checked: 12
Logical routes: 42
Languages: 2
Localized route records: 84
Generated HTML files: 86
Services: 13
Projects: 12
Brands/suppliers/platforms: 44
Supplied photographs: 50
Endpoint tests: 6/6 passed
Dependency vulnerabilities: 0
```

The build validates:

- Required source files
- JavaScript syntax
- Route generation
- Unique localized page titles
- Unique canonical URLs
- Meta-description length
- English and Arabic language/direction attributes
- `en-KW`, `ar-KW` and `x-default` alternate links
- Localized structured data
- English and Arabic dictionary completeness
- Light-theme design tokens
- RTL layout rules
- Reduced-motion support
- iOS safe-area viewport support
- Media file existence and intrinsic dimensions
- Removal of obsolete interactive-tool routes, data and text
- Source package remaining below GitHub’s 100-file browser-upload limit when preview screenshots are excluded

## Browser route sweep

A lightweight version of the real application was rendered in headless Chromium for route and layout checks.

### Complete route coverage

Every one of the 84 localized pages was rendered at:

- 390 × 844 px
- 1440 × 1000 px

Each rendered page was checked for:

- Non-empty H1
- Correct `lang`
- Correct `dir`
- No horizontal document overflow
- No duplicate element IDs
- No broken local images
- No browser console errors

### Responsive/theme matrix

Representative high-value pages were checked at:

```text
320 × 740
375 × 812
430 × 900
768 × 1024
1024 × 900
1366 × 900
1920 × 1080
```

For each size, the following combinations were rendered:

- English + dark
- English + light
- Arabic + dark
- Arabic + light

Representative pages included:

- Home
- Services
- MHD tuning
- Engine building
- Projects
- Contact

Result:

```text
Browser route/layout checks: 336
Route/layout failures: 0
Console errors: 0
```

The detailed machine-readable result is stored in:

```text
preview/qa-route-report.json
```

## Interaction testing

Thirteen high-value interaction flows were tested in mobile Chromium:

1. Mobile navigation opens, closes and updates accessibility state.
2. Theme control applies and stores the choice.
3. Language control switches to Arabic, applies RTL and stores the choice.
4. Gallery lightbox opens, advances and closes with Escape.
5. Project search/filter returns the expected visible and hidden states.
6. Brand-category filter updates the directory.
7. Quote basket adds an item, opens, and closes with Escape.
8. Enquiry modal opens and closes.
9. Required form fields trigger native validation.
10. Valid enquiry prepares the verified WhatsApp handoff.
11. FAQ accordion expands correctly.
12. Map loads only after user action.
13. Telephone, WhatsApp, Instagram and map links are present and correctly formed.

Result:

```text
Interaction checks: 13
Interaction failures: 0
Console errors: 0
```

The detailed machine-readable result is stored in:

```text
preview/qa-interactions-report.json
```

## Endpoint testing

The optional Vercel enquiry endpoint passed six tests covering:

- Allowed request type
- Invalid request type
- Oversized request rejection
- Anti-spam honeypot rejection
- Unrealistically fast submission rejection
- Safe response behaviour when email environment variables are not configured

Result:

```text
6/6 passed
```

## Defects found and corrected during final QA

- Hidden mobile navigation enlarged the document canvas.
- The off-screen anti-spam field caused extreme RTL overflow.
- Technical gallery content forced tuning and engine pages wider than small phones.
- RTL hero margins overrode mobile centring.
- Long hero words could break incorrectly at narrow widths.
- Hero shortcut arrows inherited oversized SVG dimensions.
- Capability-panel headings and descriptions ran together.
- Fixed contact controls overlapped the desktop hero capability panel.

Each issue was corrected and the complete route/layout sweep was rerun.

## Visual review

Final screenshots were generated for:

- English desktop dark
- English desktop light
- Arabic desktop dark
- Arabic desktop light
- English mobile dark
- Arabic mobile dark

They are stored under `preview/`.

## Limitations of local QA

- Browser tests used current headless Chromium viewport emulation, not physical iOS Safari or a physical Android handset.
- A production Lighthouse score was not fabricated. Performance, Accessibility, Best Practices and SEO should be measured against the final deployed domain because DNS, TLS, CDN cache and network conditions affect the result.
- Optional email delivery cannot be tested end-to-end until approved email addresses, a verified sender domain and private environment variables are configured.
- Public review integration cannot be tested until approved review content or an official review source is provided.

These remaining checks are included in `PRE_LAUNCH_CHECKLIST.md`.
