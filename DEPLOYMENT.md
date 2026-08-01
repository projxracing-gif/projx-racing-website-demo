# Deployment Guide

## 1. Local verification

Install Node.js 20 or newer, extract the source project, then run:

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

The editable source package contains fewer than 100 files when generated screenshots are excluded, so it can be uploaded through GitHub’s browser interface.

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

GitHub Pages is suitable for the static website and WhatsApp form handoff. The optional serverless email endpoint requires Vercel or another backend host.

## 4. Vercel

1. Import the GitHub repository into Vercel.
2. Use:

```text
Framework preset: Other
Build command: npm run build
Output directory: dist
Node.js: 20 or newer
```

3. Deploy the preview.
4. Test `/en/`, `/ar/`, direct nested-route refreshes, forms, media and mobile navigation.
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

## 6. Optional Vercel email delivery

The default mode prepares a verified WhatsApp message. To enable email delivery, add these Vercel environment variables only after the recipient and sender are approved:

```text
RESEND_API_KEY
ENQUIRY_TO_EMAIL
ENQUIRY_FROM_EMAIL
```

Then set in `assets/site-config.js`:

```js
formMode: "auto"
```

Do not commit secret values to GitHub. Add them in Vercel **Project Settings → Environment Variables**.

## 7. Deployment verification

After deployment:

1. Open the final English and Arabic URLs.
2. Test direct refresh on nested routes.
3. Test both themes.
4. Submit a controlled test enquiry.
5. Test telephone, WhatsApp, Instagram and maps on a real phone.
6. Confirm sitemap and robots URLs.
7. Inspect browser console and failed network requests.
8. Run Lighthouse against the actual production domain.
9. Confirm analytics and cookie behaviour only after approval.
