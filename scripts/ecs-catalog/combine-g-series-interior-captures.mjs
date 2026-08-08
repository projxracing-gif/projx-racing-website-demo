import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const VEHICLES = Object.freeze([
  Object.freeze({ key: 'g80', name: 'BMW G80 M3 Competition S58 3.0L', root: 'https://www.ecstuning.com/BMW-G80-M3_Competition-S58_3.0L/Interior/' }),
  Object.freeze({ key: 'g82', name: 'BMW G82 M4 Competition S58 3.0L', root: 'https://www.ecstuning.com/BMW-G82-M4_Competition-S58_3.0L/Interior/' }),
  Object.freeze({ key: 'g87', name: 'BMW G87 M2 S58 3.0L', root: 'https://www.ecstuning.com/BMW-G87-M2-S58_3.0L/Interior/' })
]);

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function latestTimestamp(values) {
  return values.filter(value => Number.isFinite(Date.parse(value))).sort().at(-1) || null;
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, 'utf8'));
}

function canonical(value) {
  try {
    const url = new URL(String(value ?? ''));
    url.hash = '';
    url.search = '';
    return url.toString();
  } catch {
    return '';
  }
}

function validateCapture(document, vehicle) {
  if (document?.schemaVersion !== 1 || document?.kind !== `${vehicle.key}-interior-listing-capture`
    || !Array.isArray(document?.records) || document.records.length < 1
    || document.records.some(record => record?.vehicle !== vehicle.name)
    || !Array.isArray(document?.categories) || document.categories.length !== 32) {
    throw new Error(`The ${vehicle.key.toUpperCase()} Interior capture is incomplete or invalid.`);
  }
  const categoryKeys = new Set();
  for (const category of document.categories) {
    const key = String(category?.key || '').trim();
    const name = String(category?.name || '').trim();
    const count = Number(category?.count);
    const pages = Number(category?.pages);
    const pageCounts = Array.isArray(category?.pageCounts) ? category.pageCounts.map(Number) : [];
    const pageUrls = Array.isArray(category?.pageUrls) ? category.pageUrls.map(canonical) : [];
    if (!key || !name || categoryKeys.has(key) || !Number.isInteger(count) || count < 0
      || !Number.isInteger(pages) || pages < 0 || category?.positionsContiguous !== true
      || pageCounts.length !== pages || pageUrls.length !== pages
      || pageCounts.some(value => !Number.isInteger(value) || value < 1 || value > 16)
      || pageCounts.reduce((total, value) => total + value, 0) !== count
      || pages !== (count ? Math.ceil(count / 16) : 0)
      || pageUrls.some(url => !url.startsWith(vehicle.root))) {
      throw new Error(`The ${vehicle.key.toUpperCase()} Interior category manifest is invalid for ${name || key || 'an entry'}.`);
    }
    categoryKeys.add(key);
  }
  const placementKeys = new Set();
  for (const record of document.records) {
    const key = `${record.vehicle}|${record.category}|${record.ecsPartNumber}`;
    if (placementKeys.has(key)) throw new Error(`Duplicate Interior placement detected for ${key}.`);
    placementKeys.add(key);
  }
}

function assertSupplierIdentities(records) {
  const identities = new Map();
  for (const record of records) {
    const ecs = String(record?.ecsPartNumber || '').trim();
    const identity = {
      mpn: String(record?.manufacturerPartNumber || '').trim().toLocaleLowerCase('en-US'),
      url: canonical(record?.productUrl)
    };
    const existing = identities.get(ecs);
    if (existing && (existing.mpn !== identity.mpn || existing.url !== identity.url)) {
      throw new Error(`Conflicting supplier identity for ES#${ecs}.`);
    }
    identities.set(ecs, identity);
  }
  return identities.size;
}

async function writeAtomic(filename, value) {
  const temporary = `${filename}.tmp-${process.pid}`;
  await writeFile(temporary, value, 'utf8');
  await rename(temporary, filename);
}

async function main() {
  const captureDirectory = option('--capture-dir');
  const output = option('--output');
  if (!captureDirectory || !output) {
    throw new Error('Usage: combine-g-series-interior-captures.mjs --capture-dir <directory> --output <capture.json>');
  }
  const directory = path.resolve(captureDirectory);
  const captures = [];
  for (const vehicle of VEHICLES) {
    const capture = await readJson(path.join(directory, `${vehicle.key}-records.json`));
    validateCapture(capture, vehicle);
    captures.push(capture);
  }
  const records = captures.flatMap(document => document.records.map(record => ({ ...record })));
  const uniqueProductCount = assertSupplierIdentities(records);
  const generatedAt = latestTimestamp([
    ...captures.map(document => document.generatedAt),
    ...records.map(record => record?.observedAt)
  ]);
  if (!generatedAt) throw new Error('The Interior capture has no valid observation timestamp.');
  const vehicleCategories = captures.map((document, index) => ({
    vehicle: VEHICLES[index].name,
    categories: document.categories.filter(category => category.count > 0).map(category => ({
      name: category.name,
      count: category.count,
      url: category.pageUrls[0]
    }))
  }));
  const combined = {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    kind: 'g-series-interior-listing-capture',
    generatedAt,
    vehicleCategories,
    records
  };
  await writeAtomic(path.resolve(output), `${JSON.stringify(combined, null, 2)}\n`);
  console.log(JSON.stringify({
    rawRecordCount: records.length,
    uniqueEcsProductCount: uniqueProductCount,
    vehicleCounts: Object.fromEntries(VEHICLES.map(vehicle => [vehicle.key,
      records.filter(record => record.vehicle === vehicle.name).length])),
    nonEmptyCategoryCounts: Object.fromEntries(VEHICLES.map((vehicle, index) => [vehicle.key,
      vehicleCategories[index].categories.length])),
    generatedAt
  }));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
