import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'assets', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'assets', 'styles.css'), 'utf8');
const partsStart = app.indexOf('  function partsPage()');
const partsEnd = app.indexOf('\n  function brandsPage()', partsStart);
assert.ok(partsStart >= 0 && partsEnd > partsStart, 'Parts page source could not be isolated.');
const partsPage = app.slice(partsStart, partsEnd);

assert.match(app, /PARTS_CATALOG_ENDPOINT\s*=\s*"\/api\/parts-catalog\/"/);
assert.match(app, /PARTS_CATALOG_FALLBACK_ENDPOINT\s*=\s*"\/api\/tegiwa-catalog\/"/);
assert.match(app, /async function fetchPartsCatalogue\(/);
assert.match(app, /function catalogueFallbackEligible\(/);
assert.match(app, /\[404, 501, 503\]\.includes\(Number\(error\?\.status\)\)/);
assert.match(app, /"catalogue_unpublished"/);
assert.match(app, /error\?\.name === "AbortError"/);
assert.match(app, /error instanceof TypeError/);

assert.equal((partsPage.match(/class="tegiwa-product-grid"/g) || []).length, 1, 'Parts page must render one live result grid.');
assert.doesNotMatch(partsPage, /store-catalogue-review|data-filter-grid="parts"/);
assert.doesNotMatch(partsPage, /\.map\(productCard\)|\.map\(partCard\)/);
assert.match(partsPage, /id="parts-results" data-tegiwa-results/);
assert.equal((partsPage.match(/data-tegiwa-pagination/g) || []).length, 1, 'Parts page must render one pagination region.');

const discoveryStart = app.indexOf('  function ecsDiscoveryReferenceUrl(');
const discoveryEnd = app.indexOf('\n  function tegiwaVariantAvailability(', discoveryStart);
assert.ok(discoveryStart >= 0 && discoveryEnd > discoveryStart, 'ECS discovery UI source could not be isolated.');
const discoveryUi = app.slice(discoveryStart, discoveryEnd);
const referenceCardStart = app.indexOf('  function ecsReferenceCatalogueCard(');
const referenceCardEnd = app.indexOf('\n  function partsCatalogueCard(', referenceCardStart);
assert.ok(referenceCardStart >= 0 && referenceCardEnd > referenceCardStart, 'Integrated ECS reference card could not be isolated.');
const referenceCard = app.slice(referenceCardStart, referenceCardEnd);
assert.doesNotMatch(partsPage, /data-ecs-discovery-section|data-ecs-discovery-panel/);
assert.match(partsPage, /data-action="browse-ecs-catalogue"/);
assert.match(app, /function browseFullEcsCatalogue\(\)/);
assert.match(app, /supplier:\s*"ecs"/);
assert.match(app, /items\.map\(partsCatalogueCard\)/);
assert.match(app, /item\?\.dataStatus === "url_discovered"/);
assert.match(referenceCard, /target="_blank" rel="noopener noreferrer"/);
assert.match(referenceCard, /data-form-type="ECS Parts Reference Enquiry"/);
assert.match(referenceCard, /ecsUrlDerived/);
assert.match(referenceCard, /ecsDiscoveryNotice/);
assert.doesNotMatch(referenceCard, /Add to Cart|add-cart|data-action="add-cart"|tegiwaPriceLabel|view-tegiwa-product/);
for (const field of ['title', 'sku', 'mpn', 'brand', 'category', 'subcategory', 'price', 'stock', 'image', 'images', 'fitment', 'fitments']) {
  assert.match(discoveryUi, new RegExp(`"${field}"`), `Discovery UI must fail closed when ${field} is unexpectedly populated.`);
}
assert.match(app, /ecsDiscoveryHeading: "Browse every ECS catalogue reference\."/);
assert.match(app, /ecsDiscoveryHeading: "تصفح جميع مراجع كتالوج ECS\."/);

for (const field of ['year', 'make', 'model', 'generation', 'engine']) {
  assert.match(app, new RegExp(`result\\.${field}|\\[key, value\\].*params\\.set`, 's'), `Structured vehicle field ${field} is not wired.`);
}
assert.match(app, /params\.set\("fitment", state\.tegiwaCatalog\.fitment/);
assert.match(app, /params\.set\("match", vehicleMatch \? "vehicle" : "any"\)/);
assert.match(app, /state\.tegiwaCatalog\.match === "vehicle"/);
assert.doesNotMatch(app.slice(app.indexOf('function savePartsVehicle'), app.indexOf('function updatePartsVehicleCascades')), /partsVehicleCatalogueQuery\(\)/);

for (const filter of ['sort', 'availability', 'pricing', 'supplier', 'currency', 'fitment']) {
  assert.match(partsPage, new RegExp(`data-tegiwa-filter="${filter}"`), `Unified ${filter} filter is missing.`);
}
assert.match(app, /loadTegiwaCatalog\(\{ query: state\.tegiwaCatalog\.query, match: partsVehicleLabel\(\) \? "vehicle" : "any"/);
assert.match(app, /syncCatalogueFacetOptions\(meta\)/);

assert.match(app, /currencyDisplay:\s*"code"/);
assert.match(app, /item\.supplier\?\.name/);
assert.match(app, /item\.fitmentConfidence === "exact"/);
assert.match(app, /selectedVehicleFitmentConfidence\(product\)/);
assert.match(app, /data-kind="\$\{esc\(`\$\{supplier\} Parts Product`\)\}"/);
assert.match(app, /originalSupplierListing:\s*"Original supplier listing"/);
assert.match(app, /originalSupplierListing:\s*"صفحة المورد الأصلية"/);
assert.match(app, /catalogueFallback:\s*"The complete multi-supplier catalogue is temporarily unavailable/);
assert.match(app, /catalogueFallback:\s*"الكتالوج الكامل متعدد الموردين غير متاح مؤقتاً/);

assert.match(styles, /\.tegiwa-fitment-badge\.is-exact/);
assert.match(styles, /\.tegiwa-fitment-badge\.is-possible/);
assert.match(styles, /\.catalogue-fallback-notice/);
assert.match(styles, /\.tegiwa-fitment-list/);
assert.match(styles, /\.ecs-reference-product-card/);
assert.match(styles, /\.ecs-reference-url/);
assert.match(styles, /\.ecs-reference-actions/);

console.log('Unified catalogue UI source checks passed.');
