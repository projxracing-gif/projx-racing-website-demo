import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(repo, 'dist');
const failures = [];
const warnings = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

function filesRecursive(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesRecursive(full) : [full];
  });
}

function loadProjectData() {
  const context = { window: {} };
  vm.createContext(context);
  for (const file of ['assets/data.js', 'assets/site-config.js', 'assets/i18n/en.js', 'assets/i18n/ar.js']) {
    vm.runInContext(fs.readFileSync(path.join(repo, file), 'utf8'), context, { filename: file });
  }
  return context.window;
}

for (const file of [
  'assets/app.js', 'assets/data.js', 'assets/site-config.js', 'assets/styles.css',
  'assets/i18n/en.js', 'assets/i18n/ar.js', 'template.html', 'sw.js',
  'api/enquiry.js', 'api/tegiwa-catalog.js', 'api/data/tegiwa-stock-index.json', 'api/data/tegiwa-sitemap-manifest.json',
  'api/data/tegiwa-catalog-summary.json', 'scripts/build.mjs', 'scripts/build-tegiwa-stock-index.mjs',
  'scripts/build-tegiwa-sitemap-manifest.mjs', 'scripts/build-tegiwa-catalog-snapshot.mjs', 'scripts/test-tegiwa-catalog-api.mjs',
  'manifest.webmanifest', 'vercel.json'
]) assert(fs.existsSync(path.join(repo, file)), `Missing source file: ${file}`);

assert(fs.existsSync(dist), 'dist/ does not exist; run npm run build first.');
if (!fs.existsSync(dist)) {
  console.error(failures.join('\n'));
  process.exit(1);
}

const htmlFiles = filesRecursive(dist).filter(file => file.endsWith('.html'));
const distFiles = filesRecursive(dist);

const titlesByLocale = { en: new Map(), ar: new Map() };
const canonicals = new Map();
const placeholderTerms = [
  ['lorem', 'ipsum'].join(' '),
  ['insert', 'image', 'here'].join(' '),
  ['fake', 'review'].join(' '),
  ['coming', 'soon'].join(' ')
];
const placeholderPatterns = placeholderTerms.map(term => new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
const removedFeatureTerms = [
  ['simu', 'lator'].join(''),
  ['engine', 'builder'].join(' '),
  ['basic', 'builder'].join(' '),
  ['advanced', 'builder'].join(' '),
  ['dyno', 'cell'].join(' '),
  ['build', 'your', 'engine'].join(' '),
  ['start', 'engine'].join(' '),
  ['reset', 'builder'].join(' '),
  ['estimated', 'whp'].join(' '),
  ['estimated', 'wtq'].join(' ')
];
const removedFeaturePatterns = removedFeatureTerms.map(term => new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

for (const file of htmlFiles) {
  const rel = path.relative(dist, file).replaceAll(path.sep, '/');
  const html = fs.readFileSync(file, 'utf8');
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
  const description = html.match(/<meta name="description" content="([^"]+)"/i)?.[1]?.trim();
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/i)?.[1]?.trim();
  const locale = rel.startsWith('ar/') ? 'ar' : rel.startsWith('en/') ? 'en' : null;

  assert(title, `${rel}: missing title.`);
  assert(description && description.length >= 35 && description.length <= 165, `${rel}: invalid meta description length (${description?.length || 0}).`);
  assert(/<h1[\s>]/i.test(html), `${rel}: missing H1 fallback content.`);

  if (locale) {
    assert(canonical, `${rel}: missing canonical URL.`);
    assert(new RegExp(`<html[^>]+lang="${locale === 'ar' ? 'ar-KW' : 'en'}"`, 'i').test(html), `${rel}: incorrect html language.`);
    assert(new RegExp(`<html[^>]+dir="${locale === 'ar' ? 'rtl' : 'ltr'}"`, 'i').test(html), `${rel}: incorrect text direction.`);
    assert(new RegExp(`data-locale="${locale}"`, 'i').test(html), `${rel}: missing locale marker.`);
    assert(/hreflang="en-KW"/i.test(html), `${rel}: missing en-KW hreflang.`);
    assert(/hreflang="ar-KW"/i.test(html), `${rel}: missing ar-KW hreflang.`);
    assert(/hreflang="x-default"/i.test(html), `${rel}: missing x-default hreflang.`);
    assert(/application\/ld\+json/i.test(html), `${rel}: missing structured data.`);
    assert(/assets\/i18n\/en\.js/i.test(html) && /assets\/i18n\/ar\.js/i.test(html), `${rel}: translation dictionaries are not loaded.`);
    assert(/dataset\.theme/i.test(html) && /projxTheme/i.test(html), `${rel}: early theme bootstrap is missing.`);

    if (title) {
      if (titlesByLocale[locale].has(title)) failures.push(`${rel}: duplicate ${locale} title also used by ${titlesByLocale[locale].get(title)}.`);
      else titlesByLocale[locale].set(title, rel);
    }
    if (canonical) {
      if (canonicals.has(canonical)) failures.push(`${rel}: duplicate canonical also used by ${canonicals.get(canonical)}.`);
      else canonicals.set(canonical, rel);
    }
  }

  for (const pattern of placeholderPatterns) assert(!pattern.test(html), `${rel}: placeholder text matched ${pattern}.`);
  for (const pattern of removedFeaturePatterns) assert(!pattern.test(html), `${rel}: removed feature text matched ${pattern}.`);
}

const routeManifestPath = path.join(dist, 'route-manifest.json');
assert(fs.existsSync(routeManifestPath), 'Missing route-manifest.json.');
const routeManifest = fs.existsSync(routeManifestPath) ? JSON.parse(fs.readFileSync(routeManifestPath, 'utf8')) : [];
assert(routeManifest.length > 0 && routeManifest.length % 2 === 0, `Localized route manifest is empty or unbalanced; found ${routeManifest.length} records.`);
assert(htmlFiles.length === routeManifest.length + 2, `Expected ${routeManifest.length + 2} HTML files (${routeManifest.length} localized pages, root and 404); found ${htmlFiles.length}.`);
for (const page of routeManifest) {
  const output = path.join(dist, page.output);
  assert(fs.existsSync(output), `Generated route is missing: ${page.locale} ${page.route}`);
  assert(!page.route.startsWith('/engines'), `Removed interactive engine route remains: ${page.route}`);
  assert(page.route !== '/services/engine-building' && page.route !== '/services/online-tuning', `Duplicate service route remains: ${page.route}`);
}
for (const locale of ['en', 'ar']) {
  const localeRoutes = routeManifest.filter(page => page.locale === locale);
  assert(localeRoutes.length === routeManifest.length / 2, `Expected ${routeManifest.length / 2} ${locale} routes; found ${localeRoutes.length}.`);
  assert(localeRoutes.some(page => page.route === '/account'), `${locale}: missing account portal route.`);
}

const { PROJX_DATA: data, PROJX_TRANSLATIONS: translations } = loadProjectData();
const appSource = fs.readFileSync(path.join(repo, 'assets/app.js'), 'utf8');
const tegiwaApiSource = fs.readFileSync(path.join(repo, 'api/tegiwa-catalog.js'), 'utf8');
const tegiwaIndexSource = fs.readFileSync(path.join(repo, 'api/data/tegiwa-stock-index.json'), 'utf8');
const tegiwaIndex = JSON.parse(tegiwaIndexSource);
const tegiwaManifest = JSON.parse(fs.readFileSync(path.join(repo, 'api/data/tegiwa-sitemap-manifest.json'), 'utf8'));
const tegiwaCatalogSummary = JSON.parse(fs.readFileSync(path.join(repo, 'api/data/tegiwa-catalog-summary.json'), 'utf8'));
const tegiwaCatalogDirectory = path.join(repo, 'api/data/tegiwa-catalog-pages');
const vercelConfig = JSON.parse(fs.readFileSync(path.join(repo, 'vercel.json'), 'utf8'));
const tegiwaEntries = Object.entries(tegiwaIndex.products || {});
const tegiwaLeadTimes = Array.isArray(tegiwaIndex.leadTimes) ? tegiwaIndex.leadTimes : [];
assert(tegiwaIndex.version === 1, 'Tegiwa public stock-index version is invalid.');
assert(/^\d{4}-\d{2}-\d{2}$/.test(tegiwaIndex.checkedAt || ''), 'Tegiwa stock-index check date is missing.');
assert(tegiwaEntries.length === tegiwaIndex.productCount && tegiwaEntries.length > 100_000, 'Tegiwa stock-index product count is incomplete.');
assert(Number(tegiwaIndex.availableProductCount) > 0 && tegiwaIndex.availableProductCount <= tegiwaIndex.productCount, 'Tegiwa available-product count is invalid.');
assert(tegiwaLeadTimes.length > 0 && tegiwaLeadTimes.every(value => typeof value === 'string' && value.length <= 120), 'Tegiwa public lead-time table is invalid.');
assert(tegiwaEntries.every(([key, value]) => /^[A-Za-z0-9_-]{16}$/.test(key)
  && Array.isArray(value) && value.length === 4
  && Number.isInteger(value[0]) && value[0] >= 0
  && Number.isInteger(value[1]) && value[1] >= value[0]
  && [0, 1, 2, 3].includes(value[2])
  && Number.isInteger(value[3]) && value[3] >= 0 && value[3] < tegiwaLeadTimes.length), 'Tegiwa public stock-index record contract is invalid.');
assert(tegiwaEntries.filter(([, value]) => value[2] === 1 || value[2] === 2).length === tegiwaIndex.availableProductCount, 'Tegiwa available-product aggregate does not match its records.');
assert(tegiwaManifest.version === 1 && tegiwaManifest.sitemapCount === tegiwaManifest.sitemaps?.length && tegiwaManifest.sitemapCount > 100 && tegiwaManifest.sitemapCount <= 512, 'Tegiwa public sitemap manifest is incomplete.');
assert(tegiwaManifest.sitemaps.every(value => /^https:\/\/www\.tegiwa\.com\/sitemap_products[^/]*\.xml\?/.test(value)), 'Tegiwa sitemap manifest contains an unapproved source.');
const tegiwaCatalogShardFiles = fs.existsSync(tegiwaCatalogDirectory)
  ? fs.readdirSync(tegiwaCatalogDirectory).filter(value => /^\d{3}\.json$/.test(value)).sort()
  : [];
assert(tegiwaCatalogShardFiles.length === tegiwaManifest.sitemapCount, 'Tegiwa public catalog shard count does not match its manifest.');
const tegiwaCatalogHandles = new Set();
let tegiwaCatalogProductCount = 0;
let tegiwaCatalogImageCount = 0;
let tegiwaCatalogRecordsValid = true;
for (const [shardIndex, filename] of tegiwaCatalogShardFiles.entries()) {
  if (filename !== `${String(shardIndex).padStart(3, '0')}.json`) tegiwaCatalogRecordsValid = false;
  const shard = JSON.parse(fs.readFileSync(path.join(tegiwaCatalogDirectory, filename), 'utf8'));
  if (!Array.isArray(shard) || shard.length > 50_000) {
    tegiwaCatalogRecordsValid = false;
    continue;
  }
  for (const record of shard) {
    if (!Array.isArray(record) || record.length !== 3
      || !/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(record[0] || '')
      || record[0].length > 255
      || typeof record[1] !== 'string' || !record[1].trim() || record[1].length > 300
      || (record[2] !== null && record[2] !== '' && (typeof record[2] !== 'string' || !/^https:\/\/(?:cdn\.shopify\.com|(?:www\.)?tegiwa\.com)\//.test(record[2])))) {
      tegiwaCatalogRecordsValid = false;
      continue;
    }
    if (tegiwaCatalogHandles.has(record[0])) tegiwaCatalogRecordsValid = false;
    tegiwaCatalogHandles.add(record[0]);
    tegiwaCatalogProductCount += 1;
    if (record[2]) tegiwaCatalogImageCount += 1;
  }
}
assert(tegiwaCatalogRecordsValid, 'Tegiwa public catalog shards contain invalid or duplicate records.');
assert(tegiwaCatalogProductCount > 100_000 && tegiwaCatalogHandles.size === tegiwaCatalogProductCount, 'Tegiwa public catalog snapshot is incomplete.');
assert(tegiwaCatalogSummary.version === 1
  && tegiwaCatalogSummary.shardCount === tegiwaCatalogShardFiles.length
  && tegiwaCatalogSummary.productCount === tegiwaCatalogProductCount
  && tegiwaCatalogSummary.imageCount === tegiwaCatalogImageCount
  && tegiwaCatalogSummary.uniqueHandleCount === tegiwaCatalogHandles.size, 'Tegiwa public catalog summary does not match its shards.');
assert(vercelConfig.functions?.['api/tegiwa-catalog.js']?.includeFiles === 'api/data/**', 'Vercel must bundle the complete public Tegiwa data directory with one supported includeFiles glob.');
assert(!/(?:Variant SKU|Inventory Qty|External Supplier Stock|dealer.?cost|wholesale|password|credential|api.?key)/i.test(tegiwaIndexSource), 'Private dealer fields leaked into the Tegiwa public stock index.');
assert(tegiwaApiSource.includes("const OFFICIAL_ORIGIN = 'https://www.tegiwa.com'") && tegiwaApiSource.includes("const SHOPIFY_ORIGIN = 'https://tegiwa.myshopify.com'") && tegiwaApiSource.includes('MAX_SITEMAPS = 512'), 'Tegiwa API origin restriction or full-sitemap cap is missing.');
assert(tegiwaApiSource.includes("digest('base64url').slice(0, 16)"), 'Tegiwa API stock-key contract does not match the feed-index builder.');
const brandLogoBlock = appSource.match(/const BRAND_LOGOS = Object\.freeze\(\{([\s\S]*?)\n\s*\}\);/)?.[1] || '';
const brandLogoNames = new Set([...brandLogoBlock.matchAll(/^\s+"([^"]+)":/gm)].map(match => JSON.parse(`"${match[1]}"`)));
const brandLogoPaths = [...new Set([...brandLogoBlock.matchAll(/"(assets\/brand\/partners\/[^"]+)"/g)].map(match => match[1]))];
assert(data.media.length >= 50, `Expected at least 50 supplied media records; found ${data.media.length}.`);
assert(data.services.length === 13, `Expected 13 service records; found ${data.services.length}.`);
assert(data.projects.length === 12, `Expected 12 project records; found ${data.projects.length}.`);
assert(data.brands.length >= 44, `Expected at least 44 brand records; found ${data.brands.length}.`);
assert(Array.isArray(data.storeProducts), 'Verified store-products model is missing.');
assert(!Object.hasOwn(data, 'engineProducts'), 'Removed engine-product catalogue remains in data.js.');

const catalogueSlugs = new Set();
for (const [index, part] of data.parts.entries()) {
  assert(part.catalogType === 'quote-package', `Quote package ${index + 1} has an invalid catalogue type.`);
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(part.slug || ''), `Quote package ${index + 1} has an invalid slug.`);
  assert(!catalogueSlugs.has(part.slug), `Duplicate catalogue slug: ${part.slug}`);
  catalogueSlugs.add(part.slug);
  assert(['confirm', 'universal-confirm'].includes(part.fitmentStatus), `${part.slug}: quote package overstates or omits fitment status.`);
  assert(Array.isArray(part.applications), `${part.slug}: package applications must be a structured array.`);
}

for (const product of data.storeProducts) {
  assert(product.catalogType === 'product', `${product.slug || 'Unnamed product'}: invalid catalogue type.`);
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(product.slug || ''), `${product.title || 'Product'}: invalid slug.`);
  assert(!catalogueSlugs.has(product.slug), `Duplicate catalogue slug: ${product.slug}`);
  catalogueSlugs.add(product.slug);
  for (const field of ['title', 'titleAr', 'summary', 'summaryAr', 'brand', 'category', 'status', 'statusAr', 'sku']) {
    assert(String(product[field] || '').trim(), `${product.slug}: missing ${field}.`);
  }
  for (const privateField of ['sourceUrl', 'sourceCurrency', 'sourceRrp', 'vatIncluded', 'imageProvenance', 'tradeCost', 'wholesalePrice']) assert(!Object.hasOwn(product, privateField), `${product.slug}: private supplier field exposed in public data: ${privateField}.`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(product.checkedAt || ''), `${product.slug}: missing source check date.`);
  assert(['supplier-title-confirm', 'universal-confirm', 'verified'].includes(product.fitmentStatus), `${product.slug}: invalid fitment status.`);
  assert(Array.isArray(product.fitments) && product.fitments.length > 0, `${product.slug}: structured fitment is missing.`);
  assert(product.fitments?.every(fitment => fitment.make && fitment.model && fitment.generation && Array.isArray(fitment.engines) && fitment.engines.length), `${product.slug}: incomplete fitment record.`);
  const hasVerifiedPrice = /^[A-Z]{3}$/.test(product.priceCurrency || '') && Number(product.priceAmount) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(product.priceVerifiedAt || '');
  assert(product.quoteOnly === true || hasVerifiedPrice, `${product.slug}: use request-price state or a verified price in the supplier's original currency.`);
  if (hasVerifiedPrice) assert(String(product.priceNote || '').trim() && String(product.priceNoteAr || '').trim(), `${product.slug}: priced products need a bilingual currency/tax note.`);
  assert(Array.isArray(product.images) && product.images.length > 0, `${product.slug}: exact product image is missing.`);
  for (const image of (product.images || [])) {
    assert(/^assets\/(?:products|catalog)\/[A-Za-z0-9_./-]+\.(?:avif|jpe?g|png|webp)$/i.test(image.src || ''), `${product.slug}: image must be an approved local catalogue asset.`);
    assert(!/^https?:/i.test(image.src || ''), `${product.slug}: image hotlink is not allowed.`);
    assert(fs.existsSync(path.join(repo, image.src || '')), `${product.slug}: product image is missing: ${image.src}`);
    assert(fs.existsSync(path.join(dist, image.src || '')), `${product.slug}: product image was not copied to production: ${image.src}`);
    assert(Number(image.width) > 0 && Number(image.height) > 0, `${product.slug}: product image dimensions are missing.`);
    assert(String(image.alt || '').trim().length >= 8 && String(image.altAr || '').trim().length >= 8, `${product.slug}: bilingual product image text is incomplete.`);
  }
  for (const locale of ['en', 'ar']) assert(routeManifest.some(page => page.locale === locale && page.route === `/parts/${product.slug}`), `${product.slug}: missing ${locale} product route.`);
}
for (const part of data.parts) for (const locale of ['en', 'ar']) assert(routeManifest.some(page => page.locale === locale && page.route === `/parts/${part.slug}`), `${part.slug}: missing ${locale} package route.`);
for (const brand of data.brands) assert(brandLogoNames.has(brand.name), `Brand logo mapping is missing: ${brand.name}`);
for (const dealerName of ['xHP Flashtool', 'Motion Raceworks', 'ECS Tuning']) {
  assert(data.brands.some(brand => brand.name === dealerName && brand.relationship === 'Dealer'), `${dealerName} is not marked as a dealer.`);
}
for (const logo of brandLogoPaths) {
  assert(fs.existsSync(path.join(repo, logo)), `Brand logo asset is missing: ${logo}`);
  assert(fs.existsSync(path.join(dist, logo)), `Brand logo was not copied to production: ${logo}`);
}
assert(data.tuningPlatforms.mhd.tuneTypes.includes('xHP Transmission Tune — Compatibility Review'), 'MHD/xHP transmission tune option is missing.');
assert(translations.ar.tuning.mhd.tuneTypes.includes('برمجة قير xHP — مراجعة التوافق'), 'Arabic MHD/xHP transmission tune option is missing.');
assert(appSource.includes('data-parts-shop') && appSource.includes('data-parts-vehicle-form'), 'Vehicle-first parts finder is missing.');
assert(appSource.includes('<select id="parts-vehicle-year"') && appSource.includes('name="year" required'), 'Required vehicle-year dropdown is missing.');
assert(appSource.includes('new Date().getFullYear() + 1') && appSource.includes('const oldestModelYear = 1950'), 'Vehicle-year dropdown range is not current-model-year aware or does not reach 1950.');
assert(appSource.includes('data-tegiwa-catalog') && appSource.includes('/api/tegiwa-catalog') && appSource.includes('data-action="tegiwa-next"'), 'Paginated Tegiwa storefront integration is missing.');
assert(appSource.includes(`data-tegiwa-catalog-count>${tegiwaCatalogSummary.productCount.toLocaleString('en-US')}<`), 'Tegiwa storefront fallback count does not match the public catalog summary.');
assert(appSource.includes(`data-tegiwa-available-count>${tegiwaIndex.availableProductCount.toLocaleString('en-US')}<`), 'Tegiwa storefront fallback availability count does not match the stock index.');
assert(appSource.includes('(?:[-_][a-z0-9]+)*$/.test(String(handle || ""))'), 'Tegiwa storefront product-detail guard does not support all validated official handles.');
assert(appSource.includes('select-parts-category') && appSource.includes('select-parts-brand'), 'Category or brand parts browsing is missing.');
assert(appSource.includes('data-filter-attribute="brand"'), 'Parts brand filtering is missing.');
assert(appSource.includes('data-parts-sort') && appSource.includes('adjust-quote-quantity'), 'Store sorting or quantity-aware quote basket is missing.');
assert(appSource.includes('Parts Shipping Quote') && appSource.includes('data-fitment-makes'), 'Shipping quote or preliminary fitment workflow is missing.');

for (const locale of ['en', 'ar']) {
  const t = translations[locale];
  assert(t, `Missing ${locale} translation dictionary.`);
  assert(t.dir === (locale === 'ar' ? 'rtl' : 'ltr'), `${locale}: incorrect dictionary direction.`);
  assert(Object.keys(t.services || {}).length === data.services.length, `${locale}: incomplete service translations.`);
  assert(Object.keys(t.projects || {}).length === data.projects.length, `${locale}: incomplete project translations.`);
  if (locale === 'ar') assert(Object.keys(t.media || {}).length === data.media.length, `${locale}: incomplete media translations.`);
  assert((t.parts || []).length === data.parts.length, `${locale}: incomplete parts translations.`);
  assert(t.pages?.parts?.finder?.byVehicle && t.pages?.parts?.finder?.byCategory && t.pages?.parts?.finder?.byBrand && t.pages?.parts?.finder?.chooseYear, `${locale}: incomplete parts-finder translations.`);
  assert(Object.keys(t.tuning || {}).length === Object.keys(data.tuningPlatforms).length, `${locale}: incomplete tuning translations.`);
}

for (const item of data.media) {
  const file = path.join(repo, item.full);
  assert(fs.existsSync(file), `Media ${item.id} missing: ${item.full}`);
  assert(Number(item.width) > 0 && Number(item.height) > 0, `Media ${item.id} missing intrinsic dimensions.`);
}

for (const required of [
  'assets/styles.css', 'assets/app.js', 'assets/data.js', 'assets/site-config.js',
  'assets/i18n/en.js', 'assets/i18n/ar.js', 'assets/media/projx-thumbs.webp',
  'assets/media/og/projx-racing-og.jpg', 'assets/brand/projx-racing-logo.png',
  'manifest.webmanifest', 'sitemap.xml', 'robots.txt', '.nojekyll', 'en/index.html', 'ar/index.html'
]) assert(fs.existsSync(path.join(dist, required)), `Missing production asset: ${required}`);

const productionConfig = fs.readFileSync(path.join(dist, 'assets/site-config.js'), 'utf8');
assert(!productionConfig.includes('__CLERK_PUBLISHABLE_KEY__'), 'Unresolved Clerk build placeholder remains in production config.');

const css = fs.readFileSync(path.join(repo, 'assets/styles.css'), 'utf8');
assert(/:root\[data-theme="light"\]/.test(css), 'Light-theme design tokens are missing.');
assert(/html\[dir="rtl"\]/.test(css), 'RTL layout styles are missing.');
assert(/prefers-reduced-motion/.test(css), 'Reduced-motion support is missing.');
assert(/viewport-fit=cover/.test(fs.readFileSync(path.join(repo, 'template.html'), 'utf8')), 'iOS safe-area viewport support is missing.');

const sourceFiles = filesRecursive(repo).filter(file => !file.includes(`${path.sep}dist${path.sep}`) && !file.includes(`${path.sep}.git${path.sep}`) && !file.includes(`${path.sep}node_modules${path.sep}`));
const searchableSource = sourceFiles
  .filter(file => /\.(?:js|mjs|html|css|json|webmanifest)$/i.test(file))
  .filter(file => !file.endsWith(`${path.sep}scripts${path.sep}validate.mjs`))
  .filter(file => !file.includes(`${path.sep}api${path.sep}data${path.sep}tegiwa-catalog-pages${path.sep}`))
  .map(file => fs.readFileSync(file, 'utf8'))
  .join('\n');
for (const pattern of removedFeaturePatterns) assert(!pattern.test(searchableSource), `Removed feature remains in source: ${pattern}.`);

const totalMediaBytes = data.media.reduce((sum, item) => sum + fs.statSync(path.join(repo, item.full)).size, 0);
if (totalMediaBytes > 16_000_000) warnings.push(`Full media payload is ${(totalMediaBytes / 1e6).toFixed(1)} MB.`);

if (failures.length) {
  console.error(`Validation failed with ${failures.length} issue(s):`);
  failures.forEach(item => console.error(`- ${item}`));
  warnings.forEach(item => console.warn(`Warning: ${item}`));
  process.exit(1);
}
console.log(`Validation passed: ${routeManifest.length / 2} routes × 2 languages, ${htmlFiles.length} HTML files and ${distFiles.length} production files.`);
console.log(`Content passed: ${data.services.length} services, ${data.projects.length} verified projects, ${data.brands.length} brands, ${data.storeProducts.length} reviewed catalogue products and ${data.media.length} supplied images.`);
console.log(`Brand logos passed: ${brandLogoNames.size} mapped brands and ${brandLogoPaths.length} local logo assets.`);
console.log('Themes passed: complete light/dark token sets, early theme bootstrap and RTL-specific layout rules detected.');
console.log(`Source package passed: ${sourceFiles.length} files, ready for Git-based GitHub upload.`);
warnings.forEach(item => console.warn(`Warning: ${item}`));
