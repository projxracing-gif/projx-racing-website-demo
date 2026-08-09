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

for (const filter of ['sort', 'availability', 'pricing', 'supplier', 'brand', 'partType', 'currency', 'fitment']) {
  assert.match(partsPage, new RegExp(`data-tegiwa-filter="${filter}"`), `Unified ${filter} filter is missing.`);
}
assert.match(app, /params\.set\("brand", state\.tegiwaCatalog\.brand\)/,
  'Brand filters must be sent to the unified catalogue API.');
assert.match(app, /params\.set\("partType", state\.tegiwaCatalog\.partType\)/,
  'Part-type filters must be sent to the unified catalogue API.');
assert.match(app, /function syncTegiwaCatalogueUrl\(\)[\s\S]*for \(const \[key, defaultValue\] of Object\.entries\(TEGIWA_SEARCH_DEFAULTS\)\)[\s\S]*params\.set\(key, state\.tegiwaCatalog\[key\]\)/,
  'Successful catalogue interactions must persist the exact active filters in the shareable route.');
assert.match(app, /renderTegiwaControls\(payload\);\s*syncTegiwaCatalogueUrl\(\);/,
  'The shareable catalogue route must update only after a successful response is rendered.');
assert.match(app, /Math\.max\(state\.tegiwaCatalog\.catalogProductCount, count\)/,
  'The headline catalogue total must not collapse to one supplier when a scoped filter is applied.');
assert.match(app, /Math\.max\(state\.tegiwaCatalog\.availableProductCount, available\)/,
  'The headline availability total must remain the combined catalogue figure while browsing filters.');
assert.match(app, /state\.locale === "ar" \? item\.nameAr \|\| item\.name : item\.name/,
  'Arabic facet controls must prefer localized category names.');
assert.match(app, /data-tegiwa-directory-part-type=/,
  'Exact supplier part-type keys must be attached to directory controls.');
assert.match(app, /partType:\s*"exterior"/,
  'The Exterior directory must include an exact all-Exterior scope.');
const brakingDirectoryMatch = app.match(/\{\s*query:\s*"braking",\s*partType:\s*"g-series-braking",\s*en:\s*"Brakes",\s*ar:\s*"[^"]+",\s*items:\s*\[([\s\S]*?)\]\s*\n\s*\},\s*\n\s*\{\s*query:\s*"suspension"/);
assert.ok(brakingDirectoryMatch, 'The Brakes directory must include an exact G-Series braking scope.');
const brakingDirectoryEntries = [...brakingDirectoryMatch[1]
  .matchAll(/\["",\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\]/g)]
  .map(([, name, nameAr, slug]) => ({ slug, name, nameAr }));
const expectedBrakingDirectoryEntries = [
  ['braking-tools', 'Brake Tools'],
  ['braking-pads', 'Brake Pads'],
  ['braking-performance', 'Performance Brake Parts'],
  ['braking-fluid', 'Brake Fluids'],
  ['braking-rotors', 'Brake Rotors'],
  ['braking-calipers', 'Brake Calipers'],
  ['braking-compounds', 'Brake Compounds & Lubricants'],
  ['braking-lines', 'Brake Lines'],
  ['braking-big-brakes', 'Big Brake Upgrades'],
  ['braking-service-kits', 'Brake Service Kits'],
  ['braking-electrical', 'Electrical Brake Parts & Components'],
  ['braking-sensors', 'Brake Sensors'],
  ['braking-abs', 'ABS Brake Parts'],
  ['braking-master-cylinder', 'Brake Master Cylinder Parts'],
  ['braking-parking-brake', 'Emergency Parking Brake Parts']
];
assert.deepEqual(brakingDirectoryEntries.map(({ slug, name }) => [slug, name]),
  expectedBrakingDirectoryEntries,
  'Brakes directory controls must expose the 15 verified top-level Braking part types.');
assert.ok(brakingDirectoryEntries.every(({ nameAr }) => /[\u0600-\u06ff]/u.test(nameAr)),
  'Every Braking part-type control must preserve an Arabic label.');
const engineDirectoryMatch = app.match(/\{\s*query:\s*"engine",\s*partType:\s*"g-series-engine",\s*en:\s*"Engine",\s*ar:\s*"[^"]+",\s*items:\s*\[([\s\S]*?)\]\s*\n\s*\},\s*\n\s*\{\s*query:\s*"drivetrain"/);
assert.ok(engineDirectoryMatch, 'The Engine directory must include the exact G-Series Engine scope.');
const engineDirectoryEntries = [...engineDirectoryMatch[1]
  .matchAll(/\["",\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\]/g)]
  .map(([, name, nameAr, slug]) => ({ slug, name, nameAr }));
const expectedEngineDirectoryEntries = [
  ['engine-performance', 'Performance Engine Parts'],
  ['engine-intake', 'Engine Intake Parts'],
  ['engine-fuel', 'Engine Fuel Parts'],
  ['engine-tools', 'Engine Tools'],
  ['engine-electrical', 'Engine Electrical Parts'],
  ['engine-mechanical', 'Engine Mechanical Parts'],
  ['engine-cooling', 'Engine Cooling Parts'],
  ['engine-oil-service', 'Oil Change Service Kits and Accessories'],
  ['engine-covers', 'Engine Covers & Accessories'],
  ['engine-ignition', 'Engine Ignition Parts'],
  ['engine-turbocharger', 'Engine Turbocharger Parts'],
  ['engine-gaskets-seals', 'Engine Gaskets & Seals'],
  ['engine-filter', 'Engine Filter Parts'],
  ['engine-software', 'Engine Chips, Tunes & Software'],
  ['engine-drive-belts', 'Engine Drive Belt Parts'],
  ['engine-emissions', 'Engine Emission Parts'],
  ['engine-pulleys', 'Engine Pulley Parts'],
  ['engine-timing', 'Engine Timing Parts'],
  ['engine-mount', 'Engine Mount Parts'],
  ['engine-vacuum-system', 'Engine Vacuum System Parts'],
  ['engine-skid-plate', 'Engine Skid Plate Parts'],
  ['engine-fastener-kit', 'Engine Fastener Kit Parts'],
  ['engine-supercharger', 'Engine Supercharger Parts']
];
assert.deepEqual(engineDirectoryEntries.map(({ slug, name }) => [slug, name]),
  expectedEngineDirectoryEntries,
  'Engine directory controls must expose all 23 verified top-level Engine part types.');
assert.ok(engineDirectoryEntries.every(({ nameAr }) => /[\u0600-\u06ff]/u.test(nameAr)),
  'Every Engine part-type control must preserve an Arabic label.');
const drivetrainDirectoryMatch = app.match(/\{\s*query:\s*"drivetrain",\s*partType:\s*"g-series-drivetrain",\s*en:\s*"Drivetrain",\s*ar:\s*"[^"]+",\s*items:\s*\[([\s\S]*?)\]\s*\n\s*\},\s*\n\s*\{\s*query:\s*"cooling"/);
assert.ok(drivetrainDirectoryMatch, 'The Drivetrain directory must include an exact G-Series scope.');
const drivetrainDirectoryEntries = [...drivetrainDirectoryMatch[1]
  .matchAll(/\["",\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\]/g)]
  .map(([, name, nameAr, slug]) => ({ slug, name, nameAr }));
const expectedDrivetrainDirectoryEntries = [
  ['drivetrain-tools', 'Drivetrain Tools'],
  ['drivetrain-differential', 'Differential Parts'],
  ['drivetrain-manual-transmission', 'Manual Transmission Parts'],
  ['drivetrain-shifter', 'Shifter Parts'],
  ['drivetrain-automatic-transmission', 'Automatic Transmission Parts'],
  ['drivetrain-axles', 'Axle Parts'],
  ['drivetrain-clutch', 'Clutch Parts'],
  ['drivetrain-mounts', 'Drivetrain Mounts'],
  ['drivetrain-driveshafts', 'Driveshaft Parts'],
  ['drivetrain-wheel-bearings', 'Wheel Bearing Parts'],
  ['drivetrain-skid-plate', 'Skid Plates'],
  ['drivetrain-transfer-case', 'Transfer Case Parts']
];
assert.deepEqual(drivetrainDirectoryEntries.map(({ slug, name }) => [slug, name]),
  expectedDrivetrainDirectoryEntries,
  'Drivetrain directory controls must expose the 12 verified customer-facing part types.');
assert.ok(drivetrainDirectoryEntries.every(({ nameAr }) => /[\u0600-\u06ff]/u.test(nameAr)),
  'Every Drivetrain part-type control must preserve an Arabic label.');
assert.doesNotMatch(drivetrainDirectoryMatch[1], /drivetrain-pdk-transmission/,
  'The unverified PDK branch must not be exposed as a G-Series customer directory control.');
assert.doesNotMatch(app, /drivetrain-pdk-transmission|PDK Transmission Parts/,
  'The quarantined PDK taxonomy must not ship in the customer-facing application source.');
const interiorDirectoryMatch = app.match(/\{\s*query:\s*"interior",\s*partType:\s*"interior",\s*en:\s*"Interior",\s*ar:\s*"[^"]+",\s*items:\s*\[([\s\S]*?)\]\s*\n\s*\},\s*\n\s*\{\s*query:\s*"exterior"/);
assert.ok(interiorDirectoryMatch, 'The Interior directory must include an exact all-Interior scope.');
const interiorDirectoryEntries = [...interiorDirectoryMatch[1].matchAll(/\["",\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\]/g)]
  .map(([, name, nameAr, slug]) => ({ slug, name, nameAr }));
const expectedInteriorDirectoryEntries = [
  ['gauges', 'Gauges'], ['seats', 'Seats'], ['steering', 'Steering'], ['vinyl-wrap', 'Vinyl Wrap'],
  ['center-console', 'Center Console'], ['safety', 'Safety'], ['trim', 'Trim'], ['floor-mats', 'Floor Mats'],
  ['dashboard', 'Dashboard'], ['pedal', 'Pedal'], ['cellular-phone', 'Cellular Phone'], ['key-fob', 'Key Fob'],
  ['trunk', 'Trunk'], ['shifter', 'Shifter'], ['tools', 'Tools'], ['window', 'Window'],
  ['sound-system', 'Sound System'], ['sun-shade', 'Sun Shade'], ['electronic', 'Electronic'], ['door', 'Door'],
  ['hood-release', 'Hood Release'], ['lighting', 'Lighting'], ['storage', 'Storage'], ['convertible', 'Convertible'],
  ['headliner', 'Headliner'], ['mirror', 'Mirror'], ['sunroof', 'Sunroof'], ['airbag', 'Airbag'],
  ['carpet', 'Carpet'], ['navigation', 'Navigation'], ['armrest', 'Armrest'], ['hatch', 'Hatch']
];
assert.deepEqual(interiorDirectoryEntries.map(({ slug, name }) => [slug, name]), expectedInteriorDirectoryEntries,
  'Interior directory controls must use only the 32 verified ECS top-level part types.');
assert.ok(interiorDirectoryEntries.every(({ nameAr }) => /[\u0600-\u06ff]/.test(nameAr)),
  'Every Interior part-type control must preserve an Arabic label.');
assert.match(app, /Object\.assign\(state\.tegiwaCatalog, TEGIWA_SEARCH_DEFAULTS, \{\s*supplier: requestedSupplier,\s*partType: requestedPartType/s,
  'Directory choices must clear stale catalogue filters before applying an exact part type.');
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
assert.match(setupCatalogue, /const routeParams = currentRouteQueryParams\(\)/,
  'A copied catalogue URL must restore its search and filter state.');
assert.match(setupCatalogue, /cleanText\(routeParams\.get\("q"\) \|\| "", 120\)/,
  'A direct filter URL without a search term must not turn a missing query into the word null.');
assert.match(setupCatalogue, /catalogueFilterValue\(key, routeParams\.get\(key\)\)/,
  'Direct catalogue filter values must pass through the same allowlist as interactive filters.');
assert.match(setupCatalogue, /loadTegiwaCatalog\(\{ query: routeQuery, match: "any", page: routePage \}\)/,
  'Direct catalogue URLs must load their requested query, part type and page.');
assert.match(setupCatalogue, /compositionstart/);
assert.match(setupCatalogue, /compositionend/,
  'Autocomplete must wait for Arabic and other IME composition to finish before searching.');
assert.match(app, /suggestionCache\.get\(cacheKey\)/);
assert.match(app, /suggestionCache\.set\(cacheKey, payload\)/,
  'Repeated autocomplete requests must use the bounded in-memory suggestion cache.');
assert.match(app, /if \(handle && option\?\.dataset\.kind === "product"\) \{\s*openTegiwaProduct\(handle, input\);/,
  'Choosing a product autocomplete result must open that exact product instead of rerunning a broad text search.');
assert.match(app, /entry\.brand \|\| "", entry\.sku \|\| "", entry\.category \|\| "", entry\.supplier \|\| ""/,
  'Product suggestions must expose useful brand, SKU, category and supplier context.');

assert.match(app, /currencyDisplay:\s*"code"/);
assert.match(app, /price\.startingAt \? `\$\{storeText\(\)\.startingAt\}/,
  'Positive supplier starting prices must be clearly labelled as From prices.');
assert.match(app, /image\.status === "supplier-media-unavailable"/,
  'Official supplier placeholders must be visibly labelled.');
assert.match(app, /<h3 dir="auto">\$\{esc\(item\.title\)\}<\/h3>/,
  'Supplier product titles must isolate their own text direction inside Arabic catalogue cards.');
assert.match(app, /id="tegiwa-detail-title" dir="auto">\$\{esc\(product\.title\)\}<\/h2>/,
  'Supplier product titles must preserve their text direction inside Arabic product details.');
assert.match(styles, /\.tegiwa-image-placeholder/);
assert.match(styles, /\.tegiwa-stock-badge[^}]*max-width:\s*calc\(100% - 24px\)[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere/s,
  'Mobile stock badges must wrap inside their 12px card insets.');
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
