import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGSeriesBrakingScope } from './prepare-g-series-performance.mjs';

const ECS_HOST = 'www.ecstuning.com';
const PRODUCT_PATH = /^\/b-[^/?#]+-parts\/[^/?#]+\/[^/?#]+\/$/i;
const PAGE_SIZE = 16;

export const BRAKING_CAPTURE_VEHICLES = Object.freeze([
  Object.freeze({
    key: 'g80',
    name: 'BMW G80 M3 Competition S58 3.0L',
    baseUrl: 'https://www.ecstuning.com/BMW-G80-M3_Competition-S58_3.0L/'
  }),
  Object.freeze({
    key: 'g82',
    name: 'BMW G82 M4 Competition S58 3.0L',
    baseUrl: 'https://www.ecstuning.com/BMW-G82-M4_Competition-S58_3.0L/'
  }),
  Object.freeze({
    key: 'g87',
    name: 'BMW G87 M2 S58 3.0L',
    baseUrl: 'https://www.ecstuning.com/BMW-G87-M2-S58_3.0L/'
  })
]);

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, 'utf8'));
}

function canonicalEcsUrl(value, pattern = null) {
  try {
    const url = new URL(String(value ?? ''));
    if (url.protocol !== 'https:' || url.hostname !== ECS_HOST || url.username || url.password
      || url.port || url.search || url.hash || (pattern && !pattern.test(url.pathname))) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function exactTimestamp(value) {
  const source = String(value ?? '').trim();
  const milliseconds = Date.parse(source);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== source
    || milliseconds > Date.now() + 5 * 60 * 1_000) return null;
  return source;
}

function ecsDigits(value) {
  const digits = String(value ?? '').trim().replace(/^ES#/i, '');
  return /^\d{3,12}$/.test(digits) ? digits : null;
}

function categoryPageRoot(vehicle, scope, category) {
  const relativePath = scope.categorySourcePaths[category];
  return relativePath ? new URL(relativePath, vehicle.baseUrl).toString() : null;
}

function expectedPageUrl(root, pageNumber) {
  return pageNumber === 1 ? root : `${root}${pageNumber}`;
}

function validateCategoryManifest(document, vehicle, scope) {
  const expectedEntries = Object.entries(scope.categoryKeys);
  if (!Array.isArray(document.categories) || document.categories.length !== expectedEntries.length) {
    throw new Error(`The ${vehicle.key.toUpperCase()} Braking category manifest is incomplete.`);
  }
  const seenNames = new Set();
  return document.categories.map((category, index) => {
    const [expectedKey, expectedName] = expectedEntries[index];
    const expectedCategory = scope.scopeManifest.categories[expectedKey];
    const key = String(category?.key ?? '').trim();
    const name = String(category?.name ?? '').trim();
    const count = Number(category?.count);
    const pages = Number(category?.pages);
    const pageCounts = Array.isArray(category?.pageCounts) ? category.pageCounts.map(Number) : [];
    const pageUrls = Array.isArray(category?.pageUrls)
      ? category.pageUrls.map(url => canonicalEcsUrl(url))
      : [];
    const expectedCount = scope.expectedCategoryCounts[vehicle.name]?.[expectedName];
    const pageRoot = categoryPageRoot(vehicle, scope, expectedName);
    const expectedPages = expectedCount ? Math.ceil(expectedCount / PAGE_SIZE) : 0;
    const finalPageCount = expectedCount ? ((expectedCount - 1) % PAGE_SIZE) + 1 : 0;
    const countsMatchPages = pageCounts.every((value, pageIndex) => Number.isInteger(value)
      && value === (pageIndex === pages - 1 ? finalPageCount : PAGE_SIZE));
    const urlsMatchPages = pageUrls.every((url, pageIndex) => url === expectedPageUrl(pageRoot, pageIndex + 1));
    const expectedQuarantine = expectedCategory?.excludeFromCustomerFacing === true;
    const categoryCarriesQuarantine = category?.excludeFromCustomerFacing === true
        && category?.catalogueDisposition === 'quarantined'
        && category?.quarantineReason === expectedCategory?.quarantineReason;
    const categoryHasNoQuarantine = category?.excludeFromCustomerFacing !== true
      && category?.catalogueDisposition !== 'quarantined';
    const quarantineMatches = expectedQuarantine
      ? categoryCarriesQuarantine || (count === 0 && categoryHasNoQuarantine)
      : category?.excludeFromCustomerFacing !== true
        && category?.catalogueDisposition !== 'quarantined';
    if (key !== expectedKey || name !== expectedName || seenNames.has(name)
      || !Number.isInteger(count) || count !== expectedCount
      || !Number.isInteger(pages) || pages !== expectedPages
      || category?.positionsContiguous !== true
      || pageCounts.length !== pages || pageUrls.length !== pages
      || pageCounts.reduce((total, value) => total + value, 0) !== count
      || !countsMatchPages || !urlsMatchPages || !quarantineMatches) {
      throw new Error(`The ${vehicle.key.toUpperCase()} Braking category manifest is invalid for ${name || key || 'an entry'}.`);
    }
    seenNames.add(name);
    return {
      key, name, count, pageRoot,
      ...(expectedQuarantine ? {
        catalogueDisposition: 'quarantined',
        excludeFromCustomerFacing: true,
        quarantineReason: expectedCategory.quarantineReason
      } : {})
    };
  });
}

function validateRecord(record, vehicle, scope, categories, index) {
  const category = String(record?.category ?? '').trim();
  const declaredCategory = categories.find(entry => entry.name === category);
  const digits = ecsDigits(record?.ecsPartNumber);
  const productUrl = canonicalEcsUrl(record?.productUrl, PRODUCT_PATH);
  const manufacturerPartNumber = String(record?.manufacturerPartNumber ?? '').trim();
  const position = Number(record?.relevancePosition);
  const timestamp = exactTimestamp(record?.observedAt);
  const root = declaredCategory ? categoryPageRoot(vehicle, scope, category) : null;
  const expectedSourceUrl = root && Number.isInteger(position) && position > 0
    ? expectedPageUrl(root, Math.ceil(position / PAGE_SIZE))
    : null;
  const sourceUrl = canonicalEcsUrl(record?.sourceUrl);
  const quarantineMatches = declaredCategory?.excludeFromCustomerFacing === true
    ? record?.excludeFromCustomerFacing === true
      && record?.catalogueDisposition === 'quarantined'
      && record?.quarantineReason === declaredCategory.quarantineReason
    : record?.excludeFromCustomerFacing !== true
      && record?.catalogueDisposition !== 'quarantined';
  if (record?.vehicle !== vehicle.name || !declaredCategory || !digits || !productUrl
    || !manufacturerPartNumber || !Number.isInteger(position) || position < 1
    || position > declaredCategory.count || !timestamp || sourceUrl !== expectedSourceUrl
    || !quarantineMatches) {
    throw new Error(`The ${vehicle.key.toUpperCase()} Braking record ${index + 1} is invalid or unreconciled.`);
  }
  return { digits, category, position, productUrl, manufacturerPartNumber };
}

function validateCapture(document, vehicle, scope) {
  if (document?.schemaVersion !== 1 || document?.supplier !== 'ECS Tuning'
    || document?.kind !== `${vehicle.key}-braking-listing-capture`
    || !exactTimestamp(document?.generatedAt) || !Array.isArray(document?.records)) {
    throw new Error(`The ${vehicle.key.toUpperCase()} Braking capture is incomplete or invalid.`);
  }
  const categories = validateCategoryManifest(document, vehicle, scope);
  const expectedRecordCount = categories.reduce((total, category) => total + category.count, 0);
  if (document.records.length !== expectedRecordCount) {
    throw new Error(`The ${vehicle.key.toUpperCase()} Braking record count does not reconcile with its manifest.`);
  }
  const placements = new Set();
  const validatedRecords = document.records.map((record, index) => {
    const validated = validateRecord(record, vehicle, scope, categories, index);
    const placement = `${vehicle.name}|${validated.category}|${validated.digits}`;
    if (placements.has(placement)) throw new Error(`Duplicate Braking placement detected for ${placement}.`);
    placements.add(placement);
    return validated;
  });
  for (const category of categories) {
    const positions = validatedRecords.filter(record => record.category === category.name)
      .map(record => record.position).sort((left, right) => left - right);
    if (positions.length !== category.count
      || positions.some((position, index) => position !== index + 1)) {
      throw new Error(`The ${vehicle.key.toUpperCase()} Braking positions do not reconcile for ${category.name}.`);
    }
  }
  return categories;
}

function assertSupplierIdentities(records) {
  const identities = new Map();
  for (const record of records) {
    const digits = ecsDigits(record?.ecsPartNumber);
    const identity = {
      mpn: String(record?.manufacturerPartNumber ?? '').trim().toLocaleLowerCase('en-US'),
      url: canonicalEcsUrl(record?.productUrl, PRODUCT_PATH)
    };
    const existing = identities.get(digits);
    if (existing && (existing.mpn !== identity.mpn || existing.url !== identity.url)) {
      throw new Error(`Conflicting supplier identity for ES#${digits}.`);
    }
    identities.set(digits, identity);
  }
  return identities.size;
}

function latestTimestamp(values) {
  return values.map(exactTimestamp).filter(Boolean).sort().at(-1) || null;
}

export function combineGSeriesBrakingCaptures(capturesByVehicle, manifestDocument) {
  const scope = createGSeriesBrakingScope(manifestDocument);
  const captures = BRAKING_CAPTURE_VEHICLES.map(vehicle => {
    const capture = capturesByVehicle?.[vehicle.key];
    validateCapture(capture, vehicle, scope);
    return capture;
  });
  const records = captures.flatMap(document => document.records.map(record => ({ ...record })));
  const uniqueProductCount = assertSupplierIdentities(records);
  const generatedAt = latestTimestamp([
    ...captures.map(document => document.generatedAt),
    ...records.map(record => record?.observedAt)
  ]);
  if (!generatedAt) throw new Error('The Braking capture has no valid observation timestamp.');
  const vehicleCategories = captures.map((document, index) => ({
    vehicle: BRAKING_CAPTURE_VEHICLES[index].name,
    categories: document.categories.filter(category => category.count > 0).map(category => ({
      name: category.name, count: category.count, url: category.pageUrls[0],
      ...(category.excludeFromCustomerFacing === true ? {
        catalogueDisposition: 'quarantined',
        excludeFromCustomerFacing: true,
        quarantineReason: category.quarantineReason
      } : {})
    }))
  }));
  const quarantinedCategories = Object.values(scope.scopeManifest.categories)
    .filter(category => category.excludeFromCustomerFacing === true)
    .map(category => ({ ...category }));
  const quarantinedCategoryNames = new Set(quarantinedCategories.map(category => category.name));
  const quarantinedRecords = records.filter(record => quarantinedCategoryNames.has(record.category));
  const quarantinedEcsIdentities = [...new Set(quarantinedRecords.map(record => ecsDigits(record.ecsPartNumber)))];
  const combined = {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    kind: 'g-series-braking-listing-capture',
    generatedAt,
    scopeManifest: scope.scopeManifest,
    quarantinedCategories,
    vehicleCategories,
    records
  };
  const summary = {
    rawRecordCount: records.length,
    uniqueEcsProductCount: uniqueProductCount,
    vehicleCounts: Object.fromEntries(BRAKING_CAPTURE_VEHICLES.map(vehicle => [vehicle.key,
      records.filter(record => record.vehicle === vehicle.name).length])),
    nonEmptyCategoryCounts: Object.fromEntries(BRAKING_CAPTURE_VEHICLES.map((vehicle, index) => [vehicle.key,
      vehicleCategories[index].categories.length])),
    quarantinedPlacementCount: quarantinedRecords.length,
    quarantinedProductCount: quarantinedEcsIdentities.length,
    customerFacingRawRecordCount: records.length - records
      .filter(record => quarantinedEcsIdentities.includes(ecsDigits(record.ecsPartNumber))).length,
    generatedAt
  };
  return { combined, summary };
}

async function writeAtomic(filename, value) {
  const temporary = `${filename}.tmp-${process.pid}`;
  await writeFile(temporary, value, 'utf8');
  await rename(temporary, filename);
}

async function main() {
  const captureDirectory = option('--capture-dir');
  const manifestPath = option('--manifest');
  const output = option('--output');
  if (!captureDirectory || !manifestPath || !output) {
    throw new Error('Usage: combine-g-series-braking-captures.mjs --capture-dir <directory> --manifest <scope-manifest.json> --output <capture.json>');
  }
  const directory = path.resolve(captureDirectory);
  const [manifestDocument, ...captures] = await Promise.all([
    readJson(path.resolve(manifestPath)),
    ...BRAKING_CAPTURE_VEHICLES.map(vehicle => readJson(path.join(directory, `${vehicle.key}-records.json`)))
  ]);
  const capturesByVehicle = Object.fromEntries(BRAKING_CAPTURE_VEHICLES.map((vehicle, index) => [
    vehicle.key,
    captures[index]
  ]));
  const { combined, summary } = combineGSeriesBrakingCaptures(capturesByVehicle, manifestDocument);
  await writeAtomic(path.resolve(output), `${JSON.stringify(combined, null, 2)}\n`);
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
