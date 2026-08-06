import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { tegiwaSkuMappingFingerprint } from '../server/tegiwa-sku-mapping.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(repo, 'dist');
const failures = [];
const warnings = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const isIsoDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

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
  for (const file of ['assets/data.js', 'assets/ecs-products.js', 'assets/tegiwa-vehicle-directory.js', 'assets/site-config.js', 'assets/i18n/en.js', 'assets/i18n/ar.js']) {
    vm.runInContext(fs.readFileSync(path.join(repo, file), 'utf8'), context, { filename: file });
  }
  return context.window;
}

for (const file of [
  'assets/app.js', 'assets/data.js', 'assets/ecs-products.js', 'assets/tegiwa-vehicle-directory.js', 'assets/site-config.js', 'assets/styles.css',
  'assets/i18n/en.js', 'assets/i18n/ar.js', 'template.html', 'sw.js',
  'api/enquiry.js', 'api/tegiwa-catalog.js', 'server/tegiwa-sku-mapping.js', 'api/parts-catalog.js', 'api/data/tegiwa-stock-index.json', 'api/data/tegiwa-sitemap-manifest.json',
  'api/data/tegiwa-catalog-summary.json', 'api/data/tegiwa-search-summary.json', 'api/data/tegiwa-search-terms.json',
  'api/data/tegiwa-search-term-postings.bin', 'api/data/tegiwa-search-pairs.bin',
  'api/data/tegiwa-search-pair-postings.bin', 'api/data/tegiwa-search-metadata.bin',
  'scripts/build.mjs', 'scripts/build-tegiwa-stock-index.mjs', 'scripts/build-tegiwa-search-index.mjs',
  'scripts/build-tegiwa-sitemap-manifest.mjs', 'scripts/build-tegiwa-catalog-snapshot.mjs', 'scripts/test-tegiwa-catalog-api.mjs',
  'manifest.webmanifest', 'vercel.json'
]) assert(fs.existsSync(path.join(repo, file)), `Missing source file: ${file}`);

const vercelFunctionFiles = fs.readdirSync(path.join(repo, 'api'), { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
  .map(entry => entry.name);
assert(vercelFunctionFiles.length <= 12,
  `Vercel Hobby preview limit exceeded: ${vercelFunctionFiles.length} deployable API files found (maximum 12). Move non-route helpers out of api/.`);

assert(fs.existsSync(dist), 'dist/ does not exist; run npm run build first.');
if (!fs.existsSync(dist)) {
  console.error(failures.join('\n'));
  process.exit(1);
}

const htmlFiles = filesRecursive(dist).filter(file => file.endsWith('.html'));
const distFiles = filesRecursive(dist);
const notFoundHtml = fs.readFileSync(path.join(dist, '404.html'), 'utf8');
assert(/href="\/assets\/brand\/favicon-32\.png\?v=[a-f0-9]{12}"/.test(notFoundHtml)
  && /href="\/assets\/styles\.css\?v=[a-f0-9]{12}"/.test(notFoundHtml)
  && /src="\/assets\/brand\/projx-racing-logo-header\.png\?v=[a-f0-9]{12}"/.test(notFoundHtml)
  && /href="\/en\/"/.test(notFoundHtml)
  && /href="\/ar\/"/.test(notFoundHtml)
  && /location\.pathname/.test(notFoundHtml)
  && /document\.documentElement\.dir=a\?'rtl':'ltr'/.test(notFoundHtml), 'Nested 404 recovery assets, locale direction or language links are invalid.');

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
    const expectedLocaleBundle = new RegExp(`assets/i18n/${locale}\\.js`, 'i');
    const otherLocaleBundle = new RegExp(`assets/i18n/${locale === 'ar' ? 'en' : 'ar'}\\.js`, 'i');
    assert(expectedLocaleBundle.test(html) && !otherLocaleBundle.test(html), `${rel}: the route-specific translation dictionary is not loaded cleanly.`);
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

const { PROJX_DATA: data, PROJX_ECS_PRODUCTS: ecsProducts, PROJX_TRANSLATIONS: translations } = loadProjectData();
const appSource = fs.readFileSync(path.join(repo, 'assets/app.js'), 'utf8');
const stylesSource = fs.readFileSync(path.join(repo, 'assets/styles.css'), 'utf8');
const templateSource = fs.readFileSync(path.join(repo, 'template.html'), 'utf8');
const tegiwaApiSource = fs.readFileSync(path.join(repo, 'api/tegiwa-catalog.js'), 'utf8');
const partsCatalogApiSource = fs.readFileSync(path.join(repo, 'api/parts-catalog.js'), 'utf8');
const tegiwaIndexSource = fs.readFileSync(path.join(repo, 'api/data/tegiwa-stock-index.json'), 'utf8');
const tegiwaIndex = JSON.parse(tegiwaIndexSource);
const tegiwaManifest = JSON.parse(fs.readFileSync(path.join(repo, 'api/data/tegiwa-sitemap-manifest.json'), 'utf8'));
const tegiwaCatalogSummary = JSON.parse(fs.readFileSync(path.join(repo, 'api/data/tegiwa-catalog-summary.json'), 'utf8'));
const tegiwaSearchSummary = JSON.parse(fs.readFileSync(path.join(repo, 'api/data/tegiwa-search-summary.json'), 'utf8'));
const tegiwaSearchTermsSource = fs.readFileSync(path.join(repo, 'api/data/tegiwa-search-terms.json'));
const tegiwaSearchTerms = JSON.parse(tegiwaSearchTermsSource.toString('utf8'));
const tegiwaSearchTermPostings = fs.readFileSync(path.join(repo, 'api/data/tegiwa-search-term-postings.bin'));
const tegiwaSearchPairs = fs.readFileSync(path.join(repo, 'api/data/tegiwa-search-pairs.bin'));
const tegiwaSearchPairPostings = fs.readFileSync(path.join(repo, 'api/data/tegiwa-search-pair-postings.bin'));
const tegiwaSearchMetadata = fs.readFileSync(path.join(repo, 'api/data/tegiwa-search-metadata.bin'));
const tegiwaCatalogDirectory = path.join(repo, 'api/data/tegiwa-catalog-pages');
const vercelConfig = JSON.parse(fs.readFileSync(path.join(repo, 'vercel.json'), 'utf8'));
const tegiwaEntries = Object.entries(tegiwaIndex.products || {});
const tegiwaLeadTimes = Array.isArray(tegiwaIndex.leadTimes) ? tegiwaIndex.leadTimes : [];
assert(tegiwaIndex.version === 2, 'Tegiwa public stock/SKU-index version is invalid.');
assert(tegiwaIndex.priceBasis === 'gbp_ex_uk_vat', 'Tegiwa public prices must use the UK-VAT-excluded GBP basis.');
assert(/^\d{4}-\d{2}-\d{2}$/.test(tegiwaIndex.checkedAt || ''), 'Tegiwa stock-index check date is missing.');
const tegiwaPricedEntries = tegiwaEntries.filter(([, value]) => Number.isInteger(value?.[0]) && Number.isInteger(value?.[1]));
const tegiwaSkuEntries = tegiwaEntries.filter(([, value]) => value?.[5] === 1);
assert(tegiwaPricedEntries.length === tegiwaIndex.productCount && tegiwaEntries.length >= tegiwaIndex.productCount && tegiwaEntries.length > 100_000, 'Tegiwa stock-index product count is incomplete.');
assert(tegiwaSkuEntries.length === tegiwaIndex.skuProductCount && tegiwaIndex.skuProductCount > 100_000, 'Tegiwa customer-safe SKU coverage count is invalid.');
assert(Number(tegiwaIndex.availableProductCount) > 0 && tegiwaIndex.availableProductCount <= tegiwaIndex.productCount, 'Tegiwa available-product count is invalid.');
assert(tegiwaLeadTimes.length > 0 && tegiwaLeadTimes.every(value => typeof value === 'string' && value.length <= 120), 'Tegiwa public lead-time table is invalid.');
assert(tegiwaEntries.every(([key, value]) => /^[A-Za-z0-9_-]{16}$/.test(key)
  && Array.isArray(value) && value.length === 6
  && ((Number.isInteger(value[0]) && value[0] >= 0
    && Number.isInteger(value[1]) && value[1] >= value[0]
    && [0, 1, 2, 3].includes(value[2]))
    || (value[0] === null && value[1] === null && value[2] === null))
  && Number.isInteger(value[3]) && value[3] >= 0 && value[3] < tegiwaLeadTimes.length
  && Array.isArray(value[4]) && value[4].length <= 2_048
  && value[4].every(sku => typeof sku === 'string' && sku.length > 0 && sku.length <= 120
    && /[\p{L}\p{N}]/u.test(sku) && !/^(?:data|file|ftp|https?|javascript|vbscript):/i.test(sku) && !/[<>`{}]/.test(sku))
  && [0, 1, 2].includes(value[5])
  && (value[5] === 1 ? value[4].length > 0 : value[4].length === 0)), 'Tegiwa public stock/SKU-index record contract is invalid.');
assert(tegiwaEntries.filter(([, value]) => value[2] === 1 || value[2] === 2).length === tegiwaIndex.availableProductCount, 'Tegiwa available-product aggregate does not match its records.');
assert(tegiwaManifest.version === 1 && tegiwaManifest.sitemapCount === tegiwaManifest.sitemaps?.length && tegiwaManifest.sitemapCount > 100 && tegiwaManifest.sitemapCount <= 512, 'Tegiwa public sitemap manifest is incomplete.');
assert(tegiwaManifest.sitemaps.every(value => /^https:\/\/www\.tegiwa\.com\/sitemap_products[^/]*\.xml\?/.test(value)), 'Tegiwa sitemap manifest contains an unapproved source.');
const tegiwaCatalogShardFiles = fs.existsSync(tegiwaCatalogDirectory)
  ? fs.readdirSync(tegiwaCatalogDirectory).filter(value => /^\d{3}\.json$/.test(value)).sort()
  : [];
assert(tegiwaCatalogShardFiles.length === tegiwaManifest.sitemapCount, 'Tegiwa public catalog shard count does not match its manifest.');
const tegiwaCatalogHandles = new Set();
const tegiwaCatalogTitleCounts = new Map();
const tegiwaCatalogShardCounts = [];
let tegiwaCatalogProductCount = 0;
let tegiwaCatalogImageCount = 0;
let tegiwaCatalogRecordsValid = true;
let tegiwaSearchStockKeysMatch = true;
for (const [shardIndex, filename] of tegiwaCatalogShardFiles.entries()) {
  if (filename !== `${String(shardIndex).padStart(3, '0')}.json`) tegiwaCatalogRecordsValid = false;
  const shard = JSON.parse(fs.readFileSync(path.join(tegiwaCatalogDirectory, filename), 'utf8'));
  if (!Array.isArray(shard) || shard.length > 50_000) {
    tegiwaCatalogRecordsValid = false;
    continue;
  }
  tegiwaCatalogShardCounts.push(shard.length);
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
    const normalizedTitle = record[1].normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
    const publicStockKey = createHash('sha256').update(normalizedTitle, 'utf8').digest('base64url').slice(0, 16);
    tegiwaCatalogTitleCounts.set(publicStockKey, (tegiwaCatalogTitleCounts.get(publicStockKey) || 0) + 1);
    const expectedStockKey = createHash('sha256').update(normalizedTitle, 'utf8').digest().subarray(0, 12);
    const metadataOffset = tegiwaCatalogProductCount * 16;
    if (metadataOffset + 16 > tegiwaSearchMetadata.length
      || !tegiwaSearchMetadata.subarray(metadataOffset + 4, metadataOffset + 16).equals(expectedStockKey)) {
      tegiwaSearchStockKeysMatch = false;
    }
    tegiwaCatalogProductCount += 1;
    if (record[2]) tegiwaCatalogImageCount += 1;
  }
}
assert(tegiwaCatalogRecordsValid, 'Tegiwa public catalog shards contain invalid or duplicate records.');
assert(tegiwaSkuEntries.every(([key]) => tegiwaCatalogTitleCounts.get(key) === 1), 'A public SKU was assigned through an ambiguous or unmatched title join.');
assert(tegiwaEntries.filter(([, value]) => value[5] === 2).every(([key]) => (tegiwaCatalogTitleCounts.get(key) || 0) > 1), 'An exact-SKU prompt was assigned without a duplicate catalog title.');
assert([...tegiwaCatalogTitleCounts].every(([key, count]) => count === 1 || tegiwaIndex.products?.[key]?.[5] !== 1), 'A duplicate-title catalog group exposes a stockfeed SKU.');
assert(tegiwaCatalogProductCount > 100_000 && tegiwaCatalogHandles.size === tegiwaCatalogProductCount, 'Tegiwa public catalog snapshot is incomplete.');
assert(tegiwaCatalogSummary.version === 1
  && tegiwaCatalogSummary.shardCount === tegiwaCatalogShardFiles.length
  && Array.isArray(tegiwaCatalogSummary.shardProductCounts)
  && tegiwaCatalogSummary.shardProductCounts.length === tegiwaCatalogShardCounts.length
  && tegiwaCatalogSummary.shardProductCounts.every((count, index) => count === tegiwaCatalogShardCounts[index])
  && tegiwaCatalogSummary.productCount === tegiwaCatalogProductCount
  && tegiwaCatalogSummary.imageCount === tegiwaCatalogImageCount
  && tegiwaCatalogSummary.uniqueHandleCount === tegiwaCatalogHandles.size, 'Tegiwa public catalog summary does not match its shards.');

const tegiwaSearchFiles = {
  terms: tegiwaSearchTermsSource,
  termPostings: tegiwaSearchTermPostings,
  pairs: tegiwaSearchPairs,
  pairPostings: tegiwaSearchPairPostings,
  metadata: tegiwaSearchMetadata
};
let tegiwaSearchFilesValid = tegiwaSearchSummary.version === 2
  && tegiwaSearchSummary.productCount === tegiwaCatalogProductCount
  && tegiwaSearchSummary.skuIndexedProductCount === tegiwaIndex.skuProductCount
  && tegiwaSearchSummary.skuMappingSha256 === tegiwaSkuMappingFingerprint(tegiwaIndex)
  && tegiwaSearchSummary.pageSize === 100
  && tegiwaSearchSummary.metadataRecordBytes === 16
  && tegiwaSearchSummary.pairRecordBytes === 16
  && tegiwaSearchSummary.generatedAt === tegiwaCatalogSummary.generatedAt;
for (const [name, buffer] of Object.entries(tegiwaSearchFiles)) {
  const specification = tegiwaSearchSummary.files?.[name];
  if (!specification || specification.bytes !== buffer.length
    || specification.sha256 !== createHash('sha256').update(buffer).digest('hex')) tegiwaSearchFilesValid = false;
}
assert(tegiwaSearchFilesValid, 'Tegiwa local search-index files do not match their checksummed summary.');

let tegiwaSearchTermsValid = tegiwaSearchTerms.version === 1
  && Array.isArray(tegiwaSearchTerms.terms)
  && tegiwaSearchTerms.terms.length === tegiwaSearchSummary.termCount
  && tegiwaSearchTermPostings.length === tegiwaSearchSummary.termPostingCount * 4;
let termPostingOffset = 0;
let previousTerm = '';
for (const entry of (tegiwaSearchTerms.terms || [])) {
  if (!Array.isArray(entry) || entry.length !== 3) {
    tegiwaSearchTermsValid = false;
    continue;
  }
  const [term, offset, count] = entry;
  if (typeof term !== 'string' || !term || term.includes(' ') || (previousTerm && term <= previousTerm)
    || offset !== termPostingOffset || !Number.isInteger(count) || count < 1
    || offset + count > tegiwaSearchSummary.termPostingCount) {
    tegiwaSearchTermsValid = false;
    continue;
  }
  let previousDocumentId = -1;
  for (let index = 0; index < count; index += 1) {
    const documentId = tegiwaSearchTermPostings.readUInt32LE((offset + index) * 4);
    if (documentId >= tegiwaCatalogProductCount || documentId <= previousDocumentId) tegiwaSearchTermsValid = false;
    previousDocumentId = documentId;
  }
  termPostingOffset += count;
  previousTerm = term;
}
if (termPostingOffset !== tegiwaSearchSummary.termPostingCount) tegiwaSearchTermsValid = false;
assert(tegiwaSearchTermsValid, 'Tegiwa local term dictionary or postings are invalid.');

let tegiwaSearchPairsValid = tegiwaSearchPairs.length === tegiwaSearchSummary.pairCount * 16
  && tegiwaSearchPairPostings.length === tegiwaSearchSummary.pairPostingCount * 4;
let pairPostingOffset = 0;
let previousPairHash = -1n;
for (let index = 0; index < tegiwaSearchSummary.pairCount; index += 1) {
  const offset = index * 16;
  const hash = tegiwaSearchPairs.readBigUInt64LE(offset);
  const postingOffset = tegiwaSearchPairs.readUInt32LE(offset + 8);
  const postingCount = tegiwaSearchPairs.readUInt32LE(offset + 12);
  if (hash <= previousPairHash || postingOffset !== pairPostingOffset || postingCount < 1
    || postingOffset + postingCount > tegiwaSearchSummary.pairPostingCount) tegiwaSearchPairsValid = false;
  let previousDocumentId = -1;
  for (let postingIndex = 0; postingIndex < postingCount; postingIndex += 1) {
    const documentId = tegiwaSearchPairPostings.readUInt32LE((postingOffset + postingIndex) * 4);
    if (documentId >= tegiwaCatalogProductCount || documentId <= previousDocumentId) tegiwaSearchPairsValid = false;
    previousDocumentId = documentId;
  }
  pairPostingOffset += postingCount;
  previousPairHash = hash;
}
if (pairPostingOffset !== tegiwaSearchSummary.pairPostingCount) tegiwaSearchPairsValid = false;
assert(tegiwaSearchPairsValid, 'Tegiwa local phrase dictionary or postings are invalid.');

const tegiwaSearchNameRanks = new Set();
let tegiwaSearchMetadataValid = tegiwaSearchMetadata.length === tegiwaCatalogProductCount * 16 && tegiwaSearchStockKeysMatch;
for (let documentId = 0; documentId < tegiwaCatalogProductCount && documentId * 16 + 16 <= tegiwaSearchMetadata.length; documentId += 1) {
  const nameRank = tegiwaSearchMetadata.readUInt32LE(documentId * 16);
  if (nameRank >= tegiwaCatalogProductCount || tegiwaSearchNameRanks.has(nameRank)) tegiwaSearchMetadataValid = false;
  tegiwaSearchNameRanks.add(nameRank);
}
if (tegiwaSearchNameRanks.size !== tegiwaCatalogProductCount) tegiwaSearchMetadataValid = false;
assert(tegiwaSearchMetadataValid, 'Tegiwa local search metadata, name ranks or stock joins are invalid.');

assert(vercelConfig.functions?.['api/tegiwa-catalog.js']?.includeFiles === 'api/data/**', 'Vercel must bundle the complete public Tegiwa data directory with one supported includeFiles glob.');
assert(vercelConfig.functions?.['api/parts-catalog.js']?.includeFiles === 'api/data/**', 'Vercel must bundle the local unified-catalogue fallback data.');
assert(!/(?:Variant SKU|Inventory Qty|External Supplier Stock|dealer.?cost|wholesale|password|credential|api.?key)/i.test(tegiwaIndexSource), 'Private dealer fields leaked into the Tegiwa public stock index.');
assert(tegiwaApiSource.includes("const OFFICIAL_ORIGIN = 'https://www.tegiwa.com'")
  && !tegiwaApiSource.includes('tegiwa.myshopify.com')
  && tegiwaApiSource.includes('MAX_SITEMAPS = 512')
  && tegiwaApiSource.includes('loadDefaultSearchProvider')
  && tegiwaApiSource.includes("'rate_limited'"), 'Tegiwa API local-search, origin restriction or request safeguards are missing.');
assert(tegiwaApiSource.includes("digest('base64url').slice(0, 16)"), 'Tegiwa API stock-key contract does not match the feed-index builder.');
const brandLogoBlock = appSource.match(/const BRAND_LOGOS = Object\.freeze\(\{([\s\S]*?)\n\s*\}\);/)?.[1] || '';
const brandLogoNames = new Set([...brandLogoBlock.matchAll(/^\s+"([^"]+)":/gm)].map(match => JSON.parse(`"${match[1]}"`)));
const brandLogoPaths = [...new Set([...brandLogoBlock.matchAll(/"(assets\/brand\/partners\/[^"]+)"/g)].map(match => match[1]))];
assert(data.media.length >= 50, `Expected at least 50 supplied media records; found ${data.media.length}.`);
assert(data.services.length === 13, `Expected 13 service records; found ${data.services.length}.`);
assert(data.projects.length === 12, `Expected 12 project records; found ${data.projects.length}.`);
assert(data.brands.length >= 44, `Expected at least 44 brand records; found ${data.brands.length}.`);
const mediaIds = new Set(data.media.map(item => item.id));
for (const project of data.projects) {
  assert(mediaIds.has(project.cover), `${project.slug}: project cover does not reference supplied media.`);
  assert((project.media || []).includes(project.cover), `${project.slug}: project cover is not included in its reviewed media set.`);
}
assert(Array.isArray(data.storeProducts), 'Verified store-products model is missing.');
assert(Array.isArray(ecsProducts) && ecsProducts.length > 0, 'Manual ECS product collection is missing or empty.');
assert(!Object.hasOwn(data, 'engineProducts'), 'Removed engine-product catalogue remains in data.js.');
assert(translations.en?.ui?.nav?.parts === 'Performance Parts', 'English catalogue card label must remain Performance Parts.');
assert(translations.ar?.ui?.nav?.parts === 'قطع الأداء', 'Arabic catalogue card label must remain قطع الأداء.');
assert(appSource.includes('${esc(U().nav.parts)} · '), 'Product cards and details must use the localized Performance Parts label.');
assert(appSource.includes('storeProductPriceCheckIsFresh(product)')
  && appSource.includes('storeProductStockCheckIsFresh(product)'), 'Independent manual price and stock freshness checks are missing.');
assert(appSource.includes('const observedAvailability = storeProductStockCheckIsFresh(product)')
  && appSource.includes('!storeProductPriceCheckIsFresh(product) ? "quote" : "published"'), 'Stale stock or price data can still leak into catalogue cards.');
assert(stylesSource.includes('.parts-paths { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));'), 'The three parts pathways are not using three desktop columns.');

const catalogueSlugs = new Set();
const ecsPartNumbers = new Set();
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
  assert(isIsoDate(product.checkedAt), `${product.slug}: missing or invalid source check date.`);
  assert(['supplier-title-confirm', 'universal-confirm', 'verified'].includes(product.fitmentStatus), `${product.slug}: invalid fitment status.`);
  assert(Array.isArray(product.fitments) && product.fitments.length > 0, `${product.slug}: structured fitment is missing.`);
  assert(product.fitments?.every(fitment => fitment.make && fitment.model && fitment.generation && Array.isArray(fitment.engines) && fitment.engines.length), `${product.slug}: incomplete fitment record.`);
  const hasVerifiedPrice = /^[A-Z]{3}$/.test(product.priceCurrency || '') && Number(product.priceAmount) > 0 && isIsoDate(product.priceVerifiedAt);
  assert(product.quoteOnly === true || hasVerifiedPrice, `${product.slug}: use request-price state or a verified price in the supplier's original currency.`);
  if (hasVerifiedPrice) assert(String(product.priceNote || '').trim() && String(product.priceNoteAr || '').trim(), `${product.slug}: priced products need a bilingual currency and confirmation note.`);
  if (product.provider === 'ECS Tuning') {
    assert(/^ES#\d+$/.test(product.ecsPartNumber || ''), `${product.slug}: missing or invalid ECS part number.`);
    assert(!ecsPartNumbers.has(product.ecsPartNumber), `${product.slug}: duplicate ECS part number ${product.ecsPartNumber}.`);
    ecsPartNumbers.add(product.ecsPartNumber);
    assert(product.stockPolicy === 'manual-confirm', `${product.slug}: ECS availability must remain confirmation-only without a stock feed.`);
    assert(Number.isInteger(product.staleAfterDays) && product.staleAfterDays === 7, `${product.slug}: ECS manual review must expire after seven days.`);
    assert(isIsoDate(product.checkedAt), `${product.slug}: ECS stock review date is missing or invalid.`);
    assert(isIsoDate(product.priceVerifiedAt), `${product.slug}: ECS price review date is missing or invalid.`);
    assert(String(product.observedAvailability || '').trim() && String(product.observedAvailabilityAr || '').trim(), `${product.slug}: bilingual manually observed supplier stock information is missing.`);
    assert(product.priceCurrency === 'USD', `${product.slug}: manually reviewed ECS prices must remain in USD.`);
    assert(!/(?:dealer|trade|wholesale|vat|tax)/i.test(product.priceNote || ''), `${product.slug}: public ECS price note exposes tax or dealer-pricing language.`);
    assert(/^https:\/\/(?:www\.)?ecstuning\.com\/[A-Za-z0-9_./%?=&+~:-]+$/.test(product.originalUrl || ''), `${product.slug}: missing official ECS product URL.`);
  }
  assert(Array.isArray(product.images) && product.images.length > 0, `${product.slug}: exact product image is missing.`);
  for (const image of (product.images || [])) {
    assert(/^assets\/(?:products|catalog)\/[A-Za-z0-9_./-]+\.(?:avif|jpe?g|png|webp)$/i.test(image.src || ''), `${product.slug}: image must be an approved local catalogue asset.`);
    assert(!/^https?:/i.test(image.src || ''), `${product.slug}: image hotlink is not allowed.`);
    assert(fs.existsSync(path.join(repo, image.src || '')), `${product.slug}: product image is missing: ${image.src}`);
    assert(fs.existsSync(path.join(dist, image.src || '')), `${product.slug}: product image was not copied to production: ${image.src}`);
    assert(Number(image.width) > 0 && Number(image.height) > 0, `${product.slug}: product image dimensions are missing.`);
    if (product.provider === 'ECS Tuning') {
      assert(Number(image.width) >= 800 && Number(image.height) >= 600, `${product.slug}: ECS product image is below the approved review resolution.`);
      assert(fs.statSync(path.join(repo, image.src || '')).size >= 20_000, `${product.slug}: ECS product image appears to be a low-resolution thumbnail.`);
    }
    assert(String(image.alt || '').trim().length >= 8 && String(image.altAr || '').trim().length >= 8, `${product.slug}: bilingual product image text is incomplete.`);
  }
  for (const locale of ['en', 'ar']) assert(routeManifest.some(page => page.locale === locale && page.route === `/parts/${product.slug}`), `${product.slug}: missing ${locale} product route.`);
}
for (const product of (ecsProducts || [])) {
  assert(product.provider === 'ECS Tuning', `${product.slug || 'ECS product'}: ECS collection entry has the wrong supplier.`);
  assert(data.storeProducts.filter(entry => entry.slug === product.slug).length === 1, `${product.slug || 'ECS product'}: ECS collection entry was not appended exactly once.`);
}
assert((data.storeProducts || []).filter(product => product.provider === 'ECS Tuning').length === (ecsProducts || []).length, 'ECS products exist outside the manual ECS collection.');
for (const part of data.parts) for (const locale of ['en', 'ar']) assert(routeManifest.some(page => page.locale === locale && page.route === `/parts/${part.slug}`), `${part.slug}: missing ${locale} package route.`);
for (const brand of data.brands) assert(brandLogoNames.has(brand.name), `Brand logo mapping is missing: ${brand.name}`);
for (const dealerName of ['xHP Flashtool', 'Motion Raceworks', 'ECS Tuning']) {
  assert(data.brands.some(brand => brand.name === dealerName && brand.relationship === 'Dealer'), `${dealerName} is not marked as a dealer.`);
}
for (const logo of brandLogoPaths) {
  assert(fs.existsSync(path.join(repo, logo)), `Brand logo asset is missing: ${logo}`);
  assert(fs.existsSync(path.join(dist, logo)), `Brand logo was not copied to production: ${logo}`);
  const bytes = fs.readFileSync(path.join(repo, logo));
  const extension = path.extname(logo).toLowerCase();
  const signatureMatches = extension === '.png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : extension === '.webp' ? bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
      : extension === '.jpg' || extension === '.jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : extension === '.svg' ? /<svg[\s>]/i.test(bytes.toString('utf8').slice(0, 1000)) : true;
  assert(signatureMatches, `Brand logo extension does not match its encoded format: ${logo}`);
}
assert(data.tuningPlatforms.mhd.tuneTypes.includes('xHP Transmission Tune — Compatibility Review'), 'MHD/xHP transmission tune option is missing.');
assert(translations.ar.tuning.mhd.tuneTypes.includes('برمجة قير xHP — مراجعة التوافق'), 'Arabic MHD/xHP transmission tune option is missing.');
assert(appSource.includes('data-parts-shop') && appSource.includes('data-parts-vehicle-form'), 'Vehicle-first parts finder is missing.');
assert(appSource.includes('TEGIWA_VEHICLE_DIRECTORY.makes')
  && appSource.includes('SUPPLIER_DIRECTORY_GENERATION')
  && appSource.includes('SUPPLIER_CONFIRM_ENGINE')
  && appSource.includes('vehicleDirectoryChoiceLabel'), 'The supplier vehicle directory is not integrated into the saved-vehicle flow.');
assert(templateSource.includes('assets/tegiwa-vehicle-directory.js')
  && templateSource.indexOf('assets/tegiwa-vehicle-directory.js') < templateSource.indexOf('assets/app.js'), 'The supplier vehicle directory must load before the application.');
assert(templateSource.includes('assets/ecs-products.js')
  && templateSource.indexOf('assets/data.js') < templateSource.indexOf('assets/ecs-products.js')
  && templateSource.indexOf('assets/ecs-products.js') < templateSource.indexOf('assets/app.js'), 'The manual ECS catalogue must load after base data and before the application.');
assert(appSource.includes('<select id="parts-vehicle-year"') && appSource.includes('name="year" required'), 'Required vehicle-year dropdown is missing.');
assert(appSource.includes('new Date().getFullYear() + 1') && appSource.includes('const oldestModelYear = 1950'), 'Vehicle-year dropdown range is not current-model-year aware or does not reach 1950.');
assert(appSource.includes('data-tegiwa-catalog')
  && appSource.includes('/api/parts-catalog')
  && appSource.includes('params.set("page"')
  && appSource.includes('data-tegiwa-pages')
  && appSource.includes('data-action="tegiwa-page"')
  && appSource.includes('aria-current="page"'), 'Numbered Tegiwa storefront pagination is missing.');
assert(appSource.includes('data-tegiwa-catalog-count aria-label="${esc(labels.tegiwaLoading)}">—<')
  && appSource.includes('const count = Number(meta.catalogProductCount)')
  && appSource.includes('catalogueStat.textContent = tegiwaNumber(state.tegiwaCatalog.catalogProductCount)'), 'Unified product totals must load from the verified API product count instead of a stale or URL-reference total.');
assert(appSource.includes('data-tegiwa-available-count aria-label="${esc(labels.tegiwaLoading)}">—<')
  && appSource.includes('availableStat.textContent = tegiwaNumber(state.tegiwaCatalog.availableProductCount)'), 'Unified availability totals must load from the API instead of a stale hard-coded count.');
assert(appSource.includes('(?:[-_][a-z0-9]+)*$/.test(String(handle || ""))'), 'Tegiwa storefront product-detail guard does not support all validated official handles.');
assert(appSource.includes('type="radio"')
  && appSource.includes('data-tegiwa-variant')
  && appSource.includes('data-tegiwa-selected-price')
  && appSource.includes('data-tegiwa-selected-availability')
  && appSource.includes('updateTegiwaVariantSelection')
  && appSource.includes('data-tegiwa-variant-quote')
  && appSource.includes('-variant-${input.dataset.variantKey}'), 'Tegiwa product options are not accessible, selectable, or variant-specific in quote requests.');
assert(!appSource.includes('id="parts-categories"')
  && !appSource.includes('select-parts-category')
  && appSource.includes('parts-brand-card')
  && appSource.includes('data-tegiwa-directory-query="${esc(brand.name)}"'), 'The removed category-card section returned or unified brand browsing is missing.');
assert(appSource.includes('data-tegiwa-filter="supplier"') && appSource.includes('data-tegiwa-filter="currency"'), 'Unified supplier or currency filtering is missing.');
assert(appSource.includes('data-tegiwa-filter="sort"') && appSource.includes('adjust-quote-quantity'), 'Store sorting or quantity-aware quote basket is missing.');
assert(appSource.includes('PARTS_CATALOGUE_DIRECTORY')
  && appSource.includes('data-tegiwa-directory')
  && appSource.includes('data-action="search-tegiwa-directory"')
  && appSource.includes('searchTegiwaDirectory'), 'Interactive Shop by Part catalogue directory is missing.');
assert(appSource.includes('data-action="toggle-parts-directory-group"')
  && appSource.includes('data-parts-directory-toggle')
  && appSource.includes('aria-expanded="false"')
  && appSource.includes('parts-directory-panel')
  && appSource.includes('partDirectoryViewAll')
  && appSource.includes('togglePartsDirectoryGroup')
  && stylesSource.includes('.parts-directory-panel[hidden]'), 'The compact, single-open Part Type Directory accordion is incomplete.');
assert(appSource.includes('tegiwaHeading: "Browse the parts catalogue."')
  && (appSource.match(/tegiwaHeading:/g) || []).length === 2
  && appSource.includes('PARTS_CATALOG_ENDPOINT = "/api/parts-catalog/"')
  && appSource.includes('id="parts-results" data-tegiwa-results')
  && !appSource.includes('store-catalogue-review" id="parts-results"')
  && !appSource.includes('<div class="store-grid" data-filter-grid="parts"')
  && !appSource.includes('Browse the complete parts catalogue.')
  && !appSource.includes('Browse the complete Tegiwa catalogue.'), 'The supplier-neutral unified Parts Catalogue presentation is incomplete.');
assert(appSource.includes('partsVehicleApiFields')
  && appSource.includes('match: "vehicle"')
  && appSource.includes('params.set("match", vehicleMatch ? "vehicle" : "any")')
  && appSource.includes('params.set("fitment", state.tegiwaCatalog.fitment')
  && partsCatalogApiSource.includes("MATCHES = new Set(['any', 'vehicle'])"), 'Saved vehicles do not drive structured unified-catalogue matching.');
assert(appSource.includes('currencyDisplay: "code"')
  && appSource.includes('no automatic conversion or tax addition')
  && partsCatalogApiSource.includes('price: priceObject(row)'), 'Customer-facing supplier pricing is not preserved in its original currency.');
assert(appSource.includes('tegiwaSearchLabel: "Search products"')
  && appSource.includes('tegiwaSearchLabel: "ابحث في المنتجات"')
  && !appSource.includes('Search Tegiwa products'), 'The customer-facing product search label still exposes the supplier name.');
assert(appSource.includes('data-tegiwa-search-input')
  && appSource.includes('role="combobox"')
  && appSource.includes('role="listbox"')
  && appSource.includes('params.set("suggest", "1")')
  && appSource.includes('fetchPartsCatalogue(request')
  && appSource.includes('handleTegiwaSuggestionKeydown'), 'The accessible predictive catalogue search is incomplete.');
assert(appSource.includes('data-action="toggle-tegiwa-filters"')
  && appSource.includes('data-tegiwa-filter="sort"')
  && appSource.includes('data-tegiwa-filter="availability"')
  && appSource.includes('data-tegiwa-filter="pricing"')
  && appSource.includes('data-tegiwa-filter="supplier"')
  && appSource.includes('data-tegiwa-filter="currency"')
  && appSource.includes('data-tegiwa-filter="fitment"')
  && appSource.includes('"in_stock", "supplier_stock"')
  && appSource.includes('"priced", "request_price"'), 'The catalogue sort and filter drawer is incomplete.');
assert(appSource.includes('meta.totalResults')
  && appSource.includes('meta.totalPages')
  && appSource.includes('tegiwaPaginationMarkup(currentPage, totalPages, labels)')
  && !appSource.includes('pagination.hidden = isSearch'), 'Full search-result pagination is not enabled.');
assert(stylesSource.includes('.tegiwa-suggestions')
  && stylesSource.includes('min-height: 48px')
  && stylesSource.includes('.tegiwa-filter-panel')
  && stylesSource.includes('.tegiwa-filter-toggle'), 'Responsive catalogue search controls are missing their production styles.');
for (const group of ['Brakes', 'Suspension', 'Intake', 'Engine', 'Drivetrain', 'Cooling', 'Fueling', 'Exhaust', 'Interior', 'Exterior', 'Fluids & Filters', 'Electronics', 'Forced Induction', 'Wheels & Tyres', 'Motorsport', 'Racewear', 'Merchandise', 'Service Kits']) {
  assert(appSource.includes(`en: "${group}"`), `Shop by Part directory is missing the ${group} group.`);
}
assert(appSource.includes('الفرامل') && appSource.includes('رياضة المحركات') && appSource.includes('أطقم الصيانة'), 'Shop by Part Arabic labels are incomplete.');
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
  if (item.thumb) {
    assert(fs.existsSync(path.join(repo, item.thumb)), `Media ${item.id} thumbnail metadata points to a missing file.`);
    assert(fs.existsSync(path.join(dist, item.thumb)), `Media ${item.id} thumbnail was not copied to production.`);
  }
  const basename = path.basename(item.full, path.extname(item.full));
  for (const width of [480, 960]) {
    const responsive = path.join('assets', 'media', 'responsive', `${basename}-${width}.webp`);
    assert(fs.existsSync(path.join(repo, responsive)), `Media ${item.id} missing ${width}px responsive derivative.`);
    assert(fs.existsSync(path.join(dist, responsive)), `Media ${item.id} ${width}px derivative was not copied to production.`);
  }
}

assert(appSource.includes('assets/media/responsive/') && appSource.includes('srcset='), 'Responsive local-media srcsets are not integrated into rendered images.');

for (const required of [
  'assets/styles.css', 'assets/app.js', 'assets/data.js', 'assets/tegiwa-vehicle-directory.js', 'assets/site-config.js',
  'assets/i18n/en.js', 'assets/i18n/ar.js', 'assets/media/projx-thumbs.webp',
  'assets/media/og/projx-racing-og.jpg', 'assets/brand/projx-racing-logo.png',
  'manifest.webmanifest', 'sitemap.xml', 'robots.txt', '.nojekyll', 'en/index.html', 'ar/index.html'
]) assert(fs.existsSync(path.join(dist, required)), `Missing production asset: ${required}`);

const productionConfig = fs.readFileSync(path.join(dist, 'assets/site-config.js'), 'utf8');
assert(!productionConfig.includes('__CLERK_PUBLISHABLE_KEY__') && !productionConfig.includes('__ASSET_VERSION__'), 'Unresolved build placeholder remains in production config.');
const productionServiceWorker = fs.readFileSync(path.join(dist, 'sw.js'), 'utf8');
assert(!productionServiceWorker.includes('__ASSET_VERSION__')
  && /const ASSET_VERSION = "[a-f0-9]{12}"/.test(productionServiceWorker)
  && productionServiceWorker.includes('assets/app.js?v=${ASSET_VERSION}'), 'Service-worker core assets are not tied to the current build version.');
const productionAssetVersion = productionServiceWorker.match(/const ASSET_VERSION = "([a-f0-9]{12})"/)?.[1] || '';
assert(productionConfig.includes(`assetVersion: "${productionAssetVersion}"`), 'Runtime asset version does not match the service-worker build version.');
const productionServiceWorkerCore = productionServiceWorker.match(/const CORE_ASSETS = \[([\s\S]*?)\];/)?.[1] || '';
assert(!productionServiceWorkerCore.includes('assets/i18n/'), 'Service-worker install still downloads both locale bundles.');
assert(productionServiceWorker.includes('key.startsWith("projx-racing-bilingual-")')
  && productionServiceWorker.includes('await cache.put(event.request, response.clone())')
  && productionServiceWorker.includes('Response.redirect(new URL(fallbackPath, self.registration.scope).href, 302)'), 'Service-worker cache or offline-navigation safeguards are missing.');
const productionEnglishHome = fs.readFileSync(path.join(dist, 'en', 'index.html'), 'utf8');
assert(new RegExp(`href="assets/media/[^"]+\\?v=${productionAssetVersion}`).test(productionEnglishHome)
  && appSource.includes('function versionedAsset('), 'Versioned local-media delivery is not integrated into HTML and runtime rendering.');
assert(appSource.includes('versionedAsset(String(image.src).replace(/^\\//, ""))'), 'Local catalogue-product images are not tied to the current asset version.');
assert(appSource.includes('id="engine-family-select"') && !appSource.includes('select id="engine-family"'), 'Engine-family label and scroll target still share a duplicate ID.');

const productionSitemap = fs.readFileSync(path.join(dist, 'sitemap.xml'), 'utf8');
for (const route of ['account', 'cart', 'checkout']) {
  assert(!productionSitemap.includes(`/en/${route}/`) && !productionSitemap.includes(`/ar/${route}/`), `${route} must not appear in the public sitemap.`);
  for (const locale of ['en', 'ar']) {
    const html = fs.readFileSync(path.join(dist, locale, route, 'index.html'), 'utf8');
    assert(/<meta name="robots" content="noindex,nofollow,noarchive">/.test(html), `${locale}/${route} must be noindex.`);
  }
}

const localPreviewSource = fs.readFileSync(path.join(repo, 'scripts/serve.mjs'), 'utf8');
for (const route of ['/api/enquiry', '/api/account', '/api/addresses', '/api/cart', '/api/quotes', '/api/orders']) {
  assert(localPreviewSource.includes(`'${route}'`), `Local preview does not route ${route}.`);
}

const css = fs.readFileSync(path.join(repo, 'assets/styles.css'), 'utf8');
assert(/:root\[data-theme="light"\]/.test(css), 'Light-theme design tokens are missing.');
assert(/html\[dir="rtl"\]/.test(css), 'RTL layout styles are missing.');
assert(/prefers-reduced-motion/.test(css), 'Reduced-motion support is missing.');
assert(/viewport-fit=cover/.test(fs.readFileSync(path.join(repo, 'template.html'), 'utf8')), 'iOS safe-area viewport support is missing.');

const sourceFiles = filesRecursive(repo).filter(file => !file.includes(`${path.sep}dist${path.sep}`)
  && !file.includes(`${path.sep}.git${path.sep}`)
  && !file.includes(`${path.sep}node_modules${path.sep}`)
  && !file.includes(`${path.sep}private-imports${path.sep}`));
const searchableSource = sourceFiles
  .filter(file => /\.(?:js|mjs|html|css|json|webmanifest)$/i.test(file))
  .filter(file => !file.endsWith(`${path.sep}scripts${path.sep}validate.mjs`))
  .filter(file => !file.includes(`${path.sep}api${path.sep}data${path.sep}tegiwa-catalog-pages${path.sep}`))
  .filter(file => !file.includes(`${path.sep}api${path.sep}data${path.sep}tegiwa-search-`))
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
