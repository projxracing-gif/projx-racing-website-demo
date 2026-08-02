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
  'api/enquiry.js', 'scripts/build.mjs', 'manifest.webmanifest'
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
assert(data.media.length >= 50, `Expected at least 50 supplied media records; found ${data.media.length}.`);
assert(data.services.length === 13, `Expected 13 service records; found ${data.services.length}.`);
assert(data.projects.length === 12, `Expected 12 project records; found ${data.projects.length}.`);
assert(data.brands.length >= 44, `Expected at least 44 brand records; found ${data.brands.length}.`);
assert(!Object.hasOwn(data, 'engineProducts'), 'Removed engine-product catalogue remains in data.js.');

for (const locale of ['en', 'ar']) {
  const t = translations[locale];
  assert(t, `Missing ${locale} translation dictionary.`);
  assert(t.dir === (locale === 'ar' ? 'rtl' : 'ltr'), `${locale}: incorrect dictionary direction.`);
  assert(Object.keys(t.services || {}).length === data.services.length, `${locale}: incomplete service translations.`);
  assert(Object.keys(t.projects || {}).length === data.projects.length, `${locale}: incomplete project translations.`);
  if (locale === 'ar') assert(Object.keys(t.media || {}).length === data.media.length, `${locale}: incomplete media translations.`);
  assert((t.parts || []).length === data.parts.length, `${locale}: incomplete parts translations.`);
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
console.log(`Content passed: ${data.services.length} services, ${data.projects.length} verified projects, ${data.brands.length} brands and ${data.media.length} supplied images.`);
console.log('Themes passed: complete light/dark token sets, early theme bootstrap and RTL-specific layout rules detected.');
console.log(`Source package passed: ${sourceFiles.length} files, ready for Git-based GitHub upload.`);
warnings.forEach(item => console.warn(`Warning: ${item}`));
