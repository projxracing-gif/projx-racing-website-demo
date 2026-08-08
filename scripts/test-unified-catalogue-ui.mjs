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
assert.match(app, /TEGIWA_SEARCH_DEFAULTS\s*=\s*Object\.freeze\(\{[^}]*supplier:\s*""/s,
  'All suppliers must be the default catalogue scope.');

assert.equal((partsPage.match(/class="tegiwa-product-grid"/g) || []).length, 1, 'Parts page must render one live result grid.');
assert.doesNotMatch(partsPage, /store-catalogue-review|data-filter-grid="parts"/);
assert.doesNotMatch(partsPage, /\.map\(productCard\)|\.map\(partCard\)/);
assert.match(partsPage, /id="parts-results" data-tegiwa-results/);
assert.equal((partsPage.match(/data-tegiwa-pagination/g) || []).length, 1, 'Parts page must render one pagination region.');

assert.doesNotMatch(partsPage, /data-ecs-discovery-section|data-ecs-discovery-panel/);
assert.doesNotMatch(partsPage, /data-action="browse-ecs-catalogue"/);
for (const removedReferenceIdentifier of [
  'browseFullEcsCatalogue', 'ecsDiscoveryReferenceUrl', 'ecsReferencePathEvidence',
  'ecsReferenceCatalogueCard', 'referenceCatalogue', 'ecsDiscovery', 'ecsReference',
  'ecsUrlDerived', 'ECS Parts Reference Enquiry'
]) {
  assert.doesNotMatch(app, new RegExp(removedReferenceIdentifier),
    `Dormant URL-reference client code must not ship: ${removedReferenceIdentifier}`);
}
assert.match(app, /items\.map\(partsCatalogueCard\)/);
assert.match(app, /item\?\.dataStatus === "url_discovered"/);
assert.match(app, /unverified_reference_data/,
  'A stale API response containing URL-only records must be rejected before rendering.');
assert.match(app, /function partsCatalogueCard\(item\)\s*\{\s*return tegiwaProductCard\(item\);\s*\}/s,
  'Only structured catalogue products may reach the normal product-card renderer.');
for (const field of ['year', 'make', 'model', 'generation', 'engine']) {
  assert.match(app, new RegExp(`result\\.${field}|\\[key, value\\].*params\\.set`, 's'), `Structured vehicle field ${field} is not wired.`);
}
assert.match(app, /params\.set\("fitment", state\.tegiwaCatalog\.fitment/);
assert.match(app, /params\.set\("match", vehicleMatch \? "vehicle" : "any"\)/);
assert.match(app, /state\.tegiwaCatalog\.match === "vehicle"/);
assert.match(app, /\["M2 \(22-26\)", \{ model: "M2", generation: "G87" \}\]/,
  'BMW G87 M2 directory selections must map to the structured ECS vehicle filter.');
assert.doesNotMatch(app, /state\.tegiwaCatalog\.supplier === "ecs" \? "any"/,
  'Selecting ECS must not bypass the saved vehicle filter.');
assert.match(partsPage, /\["BMW M2 G87", "M2", "G87", "S58"\]/,
  'The reviewed BMW M shortcuts must include G87 M2.');
assert.match(partsPage, /data-tegiwa-directory-match="any"/,
  'Featured BMW M shortcuts must not inherit a different saved vehicle filter.');
assert.match(app, /const requestedMatch = trigger\?\.dataset\.tegiwaDirectoryMatch === "any"/,
  'Directory searches must distinguish featured-vehicle shortcuts from saved-vehicle part searches.');
assert.doesNotMatch(app.slice(app.indexOf('function savePartsVehicle'), app.indexOf('function updatePartsVehicleCascades')), /partsVehicleCatalogueQuery\(\)/);

for (const filter of ['sort', 'availability', 'pricing', 'supplier', 'currency', 'fitment']) {
  assert.match(partsPage, new RegExp(`data-tegiwa-filter="${filter}"`), `Unified ${filter} filter is missing.`);
}
assert.match(partsPage, /data-tegiwa-sort-note/,
  'Mixed-supplier sort qualification must be visible beside the sort control.');
assert.match(app, /tegiwaSortSupplierOrder:\s*"Supplier catalogue order"/);
assert.match(app, /tegiwaSortPriceAscSupplier:\s*"Price: low to high within currency"/);
assert.match(app, /USD and GBP prices are not converted or compared/,
  'Mixed USD and GBP results must not imply a converted global price order.');
assert.match(app, /state\.tegiwaCatalog\.sortScope === "supplier-groups"/);
assert.match(styles, /\.catalogue-sort-note/);
assert.match(app, /loadTegiwaCatalog\(\{ query: state\.tegiwaCatalog\.query, match: partsVehicleLabel\(\) \? "vehicle" : "any"/);
assert.match(app, /syncCatalogueFacetOptions\(meta\)/);
assert.match(app, /Number\(meta\.catalogProductCount\)/,
  'The global catalogue statistic must use verified structured product records only.');
assert.doesNotMatch(app, /Number\(meta\.catalogueListingCount\)/);
assert.doesNotMatch(app, /products or references in the catalogue/);
assert.match(app, /verified products in the catalogue/);
assert.match(app, /tegiwaShowingRange[^;]+total:\s*tegiwaNumber\(totalResults\)/s,
  'Result ranges must use scoped totalResults instead of the global catalogue total.');
const syncFilterStart = app.indexOf('  function syncTegiwaFilterUi()');
const syncFilterEnd = app.indexOf('\n  function syncCatalogueFacetOptions(', syncFilterStart);
const syncFilterUi = app.slice(syncFilterStart, syncFilterEnd);
assert.ok(syncFilterUi.indexOf('state.tegiwaCatalog.fitment = "all"') < syncFilterUi.indexOf('const count = tegiwaFilterCount()'),
  'Disabled fitment must be normalized before the active-filter badge is counted.');
const setupStart = app.indexOf('  function setupTegiwaCatalog()');
const setupEnd = app.indexOf('\n  function partsCatalogueCard(', setupStart);
const setupCatalogue = app.slice(setupStart, setupEnd);
assert.match(setupCatalogue, /supplier:\s*""|TEGIWA_SEARCH_DEFAULTS/);
assert.doesNotMatch(setupCatalogue, /referenceCatalogue/);

assert.match(app, /currencyDisplay:\s*"code"/);
assert.match(app, /price\.startingAt \? `\$\{storeText\(\)\.startingAt\}/,
  'Positive supplier starting prices must be clearly labelled as From prices.');
assert.match(app, /image\.status === "supplier-media-unavailable"/,
  'Official supplier placeholders must be visibly labelled.');
assert.match(styles, /\.tegiwa-image-placeholder/);
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
assert.doesNotMatch(styles, /\.ecs-reference-/);

console.log('Unified catalogue UI source checks passed.');
