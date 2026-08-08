import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const VEHICLES = Object.freeze([
  Object.freeze({ key: 'g80', name: 'BMW G80 M3 Competition S58 3.0L' }),
  Object.freeze({ key: 'g82', name: 'BMW G82 M4 Competition S58 3.0L' }),
  Object.freeze({ key: 'g87', name: 'BMW G87 M2 S58 3.0L' })
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

function validateCapture(document, vehicle) {
  if (document?.schemaVersion !== 1 || document?.supplier !== 'ECS Tuning'
    || document?.kind !== `${vehicle.key}-exterior-listing-capture`
    || !Array.isArray(document?.vehicleCategories) || document.vehicleCategories.length !== 1
    || document.vehicleCategories[0]?.vehicle !== vehicle.name
    || !Array.isArray(document?.records) || document.records.length < 1
    || document.records.some(record => record?.vehicle !== vehicle.name)) {
    throw new Error(`The ${vehicle.key.toUpperCase()} Exterior capture is incomplete or invalid.`);
  }
}

function validateBundleMap(document, vehicle) {
  if (document?.schemaVersion !== 1 || document?.supplier !== 'ECS Tuning'
    || !Array.isArray(document?.images)) {
    throw new Error(`The ${vehicle.key.toUpperCase()} Exterior media bundle map is invalid.`);
  }
}

async function writeAtomic(filename, value) {
  const temporary = `${filename}.tmp-${process.pid}`;
  await writeFile(temporary, value, 'utf8');
  await rename(temporary, filename);
}

async function main() {
  const captureDirectory = option('--capture-dir');
  const output = option('--output');
  const mediaOutput = option('--media-output');
  const existingMediaIndexPath = option('--existing-media-index');
  const enrichmentReportPath = option('--enrichment-report');
  if (!captureDirectory || !output || !mediaOutput) {
    throw new Error('Usage: combine-g-series-exterior-captures.mjs --capture-dir <directory> --output <capture.json> --media-output <bundle-map.json> [--existing-media-index <media-index.json>] [--enrichment-report <audit.json>]');
  }

  const directory = path.resolve(captureDirectory);
  const captures = [];
  const mediaMaps = [];
  for (const vehicle of VEHICLES) {
    const capture = await readJson(path.join(directory, `${vehicle.key}-records.json`));
    const mediaMap = await readJson(path.join(directory, `${vehicle.key}-media-bundle-map.json`));
    validateCapture(capture, vehicle);
    validateBundleMap(mediaMap, vehicle);
    captures.push(capture);
    mediaMaps.push(mediaMap);
  }

  const records = captures.flatMap(document => document.records.map(record => ({ ...record })));
  let enrichedBrandPlacements = 0;
  if (enrichmentReportPath) {
    const enrichment = await readJson(path.resolve(enrichmentReportPath));
    if (enrichment?.schemaVersion !== 1 || enrichment?.supplier !== 'ECS Tuning'
      || enrichment?.kind !== 'g87-exterior-enrichment-audit'
      || !Array.isArray(enrichment?.enrichmentCandidates)) {
      throw new Error('The G87 Exterior enrichment report is invalid.');
    }
    for (const candidate of enrichment.enrichmentCandidates) {
      const value = String(candidate?.brandCandidate?.value || '').trim();
      if (!value) continue;
      const ecsPartNumber = String(candidate?.ecsPartNumber || '').replace(/^ES#/i, '');
      const manufacturerPartNumber = String(candidate?.manufacturerPartNumber || '').trim();
      const productUrl = String(candidate?.productUrl || '').trim();
      const matching = records.filter(record => String(record?.ecsPartNumber || '').replace(/^ES#/i, '') === ecsPartNumber);
      if (!matching.length || matching.some(record =>
        String(record?.manufacturerPartNumber || '').trim().toLocaleLowerCase('en-US')
          !== manufacturerPartNumber.toLocaleLowerCase('en-US')
        || String(record?.productUrl || '').trim() !== productUrl
        || (String(record?.brand || '').trim()
          && String(record.brand).trim().toLocaleLowerCase('en-US') !== value.toLocaleLowerCase('en-US')))) {
        throw new Error(`Brand enrichment evidence conflicts with ES#${ecsPartNumber}.`);
      }
      for (const record of matching) {
        if (String(record.brand || '').trim()) continue;
        record.brand = value;
        enrichedBrandPlacements += 1;
      }
    }
  }
  const vehicleCategories = captures.flatMap(document => document.vehicleCategories);
  const generatedAt = latestTimestamp([
    ...captures.map(document => document.generatedAt),
    ...records.map(record => record?.observedAt)
  ]);
  const combined = {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    kind: 'g-series-exterior-listing-capture',
    generatedAt,
    vehicleCategories,
    records
  };

  const existingMedia = existingMediaIndexPath
    ? await readJson(path.resolve(existingMediaIndexPath))
    : { schemaVersion: 1, supplier: 'ECS Tuning', images: [] };
  if (existingMedia?.schemaVersion !== 1 || existingMedia?.supplier !== 'ECS Tuning'
    || !Array.isArray(existingMedia?.images)) {
    throw new Error('The existing ECS media index is invalid.');
  }
  const existingMediaUrls = new Set(existingMedia.images.map(image => String(image?.sourceUrl || '').trim()));
  const mediaByUrl = new Map();
  for (const image of mediaMaps.flatMap(document => document.images)) {
    const sourceUrl = String(image?.sourceUrl || '').trim();
    if (!sourceUrl || existingMediaUrls.has(sourceUrl) || mediaByUrl.has(sourceUrl)) continue;
    mediaByUrl.set(sourceUrl, image);
  }
  const combinedMedia = {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    generatedAt,
    images: [...mediaByUrl.values()]
  };

  await Promise.all([
    writeAtomic(path.resolve(output), `${JSON.stringify(combined, null, 2)}\n`),
    writeAtomic(path.resolve(mediaOutput), `${JSON.stringify(combinedMedia, null, 2)}\n`)
  ]);
  console.log(JSON.stringify({
    rawRecordCount: records.length,
    uniqueEcsProductCount: new Set(records.map(record => record.ecsPartNumber)).size,
    vehicleCounts: Object.fromEntries(VEHICLES.map(vehicle => [vehicle.key,
      records.filter(record => record.vehicle === vehicle.name).length])),
    enrichedBrandPlacements,
    existingMediaUrlCount: existingMediaUrls.size,
    uniqueNewMediaUrls: mediaByUrl.size,
    generatedAt
  }));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
