# Deployment Guide

## 1. Local verification

Install Node.js 24.x, extract the source project, then run:

```bash
npm ci
npm run check
npm run preview
```

Open:

```text
http://127.0.0.1:4173/
```

`npm run check` performs source checks, the production build, route/content validation and endpoint tests.

## 2. GitHub repository upload

The repository is maintained with Git. Do not upload raw dealer feeds, generated ZIP files or `node_modules` through GitHub’s browser interface.

1. Create an empty repository.
2. Extract the source ZIP.
3. Upload the **contents inside** the extracted folder, not the ZIP and not an additional outer folder.
4. Confirm these are visible at the repository root:

```text
package.json
package-lock.json
template.html
assets/
api/
scripts/
.github/
vercel.json
README.md
```

5. Commit to the `main` branch.

## 3. GitHub Pages

The repository includes `.github/workflows/deploy-pages.yml`.

1. Open **Settings → Pages**.
2. Under **Build and deployment**, choose **GitHub Actions**.
3. Open the **Actions** tab.
4. Run or wait for **Deploy Projx Racing website to GitHub Pages**.

The workflow performs:

```text
npm ci
npm run check
upload dist/
deploy Pages artifact
```

Because the site is generated, do not select a raw branch folder as the publishing source.

GitHub Pages is suitable only for the static website and WhatsApp form handoff. The serverless email delivery and live Tegiwa catalogue require Vercel or another compatible backend host.

## 4. Vercel

1. Import the GitHub repository into Vercel.
2. Use:

```text
Framework preset: Other
Build command: npm run build
Output directory: dist
Node.js: 24.x
```

3. Deploy the preview.
4. Test `/en/`, `/ar/`, direct nested-route refreshes, forms, media, mobile navigation and the Tegiwa catalogue search/browse/detail API.
5. Add the approved public domain.

## 5. Final domain configuration

Edit `assets/site-config.js`:

```js
siteUrl: "https://approved-domain.example/"
```

Replace that example with the real approved domain, then run:

```bash
npm run check
```

Redeploy so canonical URLs, sitemap entries, alternate-language links and structured data use the production domain.

## 6. Vercel enquiry-email delivery

The website attempts secure server-side email delivery first and falls back to the verified WhatsApp workflow when the email service is unavailable. Add these Vercel environment variables after connecting Resend:

```text
RESEND_API_KEY
ENQUIRY_TO_EMAIL
ENQUIRY_FROM_EMAIL
```

`ENQUIRY_TO_EMAIL` should initially be `projxracing@gmail.com`. `ENQUIRY_FROM_EMAIL` must be a Resend-approved sender. Do not commit secret values to GitHub; add them in Vercel **Project Settings → Environment Variables**.

## 7. Customer account activation

Connect Clerk to the same Vercel project and add:

```text
CLERK_PUBLISHABLE_KEY
```

The key is inserted into the generated public configuration during the Vercel build. Clerk handles sign-in, registration, email verification, password recovery and account-profile controls; passwords are never stored by this repository.

## 8. Deployment verification

After deployment:

1. Open the final English and Arabic URLs.
2. Test direct refresh on nested routes.
3. Test both themes.
4. Test sign-in, registration, verification and sign-out with a controlled account.
5. Submit a controlled test enquiry and confirm delivery at `projxracing@gmail.com`.
6. Test telephone, WhatsApp, Instagram and maps on a real phone.
7. Confirm sitemap and robots URLs.
8. Inspect browser console and failed network requests.
9. Run Lighthouse against the actual production domain.
10. Confirm analytics and cookie behaviour only after approval.
