import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { __test as mediaValidation } from './materialize-remote-assets.mjs';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const MATERIALIZER = path.join(REPO, 'scripts', 'ecs-catalog', 'materialize-remote-assets.mjs');
const BMW_M3_SECTIONS = Object.freeze([
  'braking',
  'engine',
  'exterior',
  'interior',
  'performance',
  'suspension',
  'steering'
]);

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function hasOption(name) {
  return process.argv.includes(name);
}

function exactTimestamp(value) {
  const source = String(value || '').trim();
  return Number.isFinite(Date.parse(source)) && /(?:Z|[+-]\d{2}:\d{2})$/i.test(source) ? source : null;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function validateBmwM3SectionCapture(document, expectedSectionKey) {
  const section = expectedSectionKey[0].toLocaleUpperCase('en-US') + expectedSectionKey.slice(1);
  if (document?.schemaVersion !== 1 || document?.supplier !== 'ECS Tuning'
    || document?.accessClass !== 'public-retail'
    || document?.kind !== `bmw-m3-${expectedSectionKey}-listing-capture`
    || document?.vehicle !== 'BMW M3' || document?.section !== section
    || !exactTimestamp(document?.generatedAt)
    || !Array.isArray(document?.categories) || document.categories.length < 1
    || !Array.isArray(document?.records) || document.records.length < 1) {
    throw new Error(`BMW M3 ${section} capture is invalid or incomplete.`);
  }
  const categoryKeys = new Set();
  let expectedPlacements = 0;
  for (const category of document.categories) {
    const count = Number(category?.count);
    const pages = Number(category?.pages);
    const expectedPages = Number(category?.expectedPages);
    const pageCounts = category?.pageCounts;
    if (!category?.key || categoryKeys.has(category.key)
      || !Number.isInteger(count) || count < 1
      || !Number.isInteger(expectedPages) || expectedPages < 1
      || pages !== expectedPages || !Array.isArray(pageCounts) || pageCounts.length !== expectedPages
      || pageCounts.some(value => !Number.isInteger(value) || value < 1 || value > 16)
      || sum(pageCounts) !== count || category?.positionsContiguous !== true) {
      throw new Error(`BMW M3 ${section} category ${String(category?.key || '(unknown)')} is not fully reconciled.`);
    }
    categoryKeys.add(category.key);
    expectedPlacements += count;
  }
  if (document.records.length !== expectedPlacements) {
    throw new Error(`BMW M3 ${section} captured ${document.records.length} of ${expectedPlacements} expected placements.`);
  }
  for (const [index, record] of document.records.entries()) {
    if (record?.section !== section || record?.vehicle !== 'BMW M3'
      || !categoryKeys.has(record?.categoryKey) || !mediaValidation.ecsIdentity(record)
      || !exactTimestamp(record?.observedAt)
      || !(mediaValidation.officialImageUrl(record?.imageUrl)
        || mediaValidation.officialImageUrl(record?.imageFallbackUrl))) {
      throw new Error(`BMW M3 ${section} record ${index + 1} is not safe to materialize.`);
    }
  }
  return document;
}

function combinedCapture(documents) {
  if (!Array.isArray(documents) || documents.length !== BMW_M3_SECTIONS.length) {
    throw new Error('Exactly seven BMW M3 section captures are required.');
  }
  const validated = documents.map((document, index) =>
    validateBmwM3SectionCapture(document, BMW_M3_SECTIONS[index]));
  return {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    accessClass: 'public-retail',
    kind: 'bmw-m3-all-sections-media-capture',
    generatedAt: validated.map(document => document.generatedAt).sort().at(-1),
    records: validated.flatMap(document => document.records)
  };
}

async function fileExists(filename) {
  try {
    return (await stat(filename)).isFile();
  } catch {
    return false;
  }
}

async function writeAtomic(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}`;
  await writeFile(temporary, value, 'utf8');
  await rename(temporary, filename);
}

async function runChild(arguments_) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, arguments_, { cwd: REPO, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0
      ? resolve()
      : reject(new Error(`BMW M3 media materializer exited with code ${code ?? 'unknown'}.`)));
  });
}

async function main() {
  const captureDirOption = option('--capture-dir');
  if (!captureDirOption) {
    throw new Error('Usage: materialize-bmw-m3-assets.mjs --capture-dir <seven-section-capture-directory> [--existing-media-index <media-index.json>] [--output-dir <repo-directory>] [--index <media-index.json>] [--dry-run] [--allow-missing] [--concurrency <1-8>] [--max-images <count>] [--max-total-bytes <bytes>]');
  }
  const captureDir = path.resolve(captureDirOption);
  const outputDirectory = path.resolve(option('--output-dir') || path.join(REPO, 'assets', 'products', 'ecs', 'bmw-m3'));
  const indexPath = path.resolve(option('--index') || path.join(captureDir, 'media-index.json'));
  const combinedPath = path.join(captureDir, 'bmw-m3-all-sections-media-capture.json');
  const documents = await Promise.all(BMW_M3_SECTIONS.map(async section => {
    const filename = path.join(captureDir, section, `bmw-m3-${section}-records.json`);
    if (!(await fileExists(filename))) throw new Error(`Missing BMW M3 ${section} capture: ${filename}`);
    return JSON.parse(await readFile(filename, 'utf8'));
  }));
  const document = combinedCapture(documents);
  await writeAtomic(combinedPath, `${JSON.stringify(document, null, 2)}\n`);
  const arguments_ = [
    MATERIALIZER,
    '--input', combinedPath,
    '--output-dir', outputDirectory,
    '--index', indexPath,
    '--concurrency', option('--concurrency') || '2',
    '--max-images', option('--max-images') || '25000',
    '--max-total-bytes', option('--max-total-bytes') || String(2 * 1024 * 1024 * 1024)
  ];
  const requestedExistingIndex = option('--existing-media-index');
  const existingIndex = requestedExistingIndex
    ? path.resolve(requestedExistingIndex)
    : await fileExists(indexPath) ? indexPath : null;
  if (requestedExistingIndex && !(await fileExists(existingIndex))) {
    throw new Error(`Existing ECS media index does not exist: ${existingIndex}`);
  }
  if (existingIndex) arguments_.push('--existing-media-index', existingIndex);
  if (hasOption('--dry-run')) arguments_.push('--dry-run');
  if (hasOption('--allow-missing')) arguments_.push('--allow-missing');
  console.log(JSON.stringify({
    preflight: true,
    sections: BMW_M3_SECTIONS,
    capturedPlacements: document.records.length,
    capture: path.relative(REPO, combinedPath).replaceAll('\\', '/'),
    outputDirectory: path.relative(REPO, outputDirectory).replaceAll('\\', '/'),
    index: path.relative(REPO, indexPath).replaceAll('\\', '/'),
    existingIndex: existingIndex ? path.relative(REPO, existingIndex).replaceAll('\\', '/') : null
  }));
  await runChild(arguments_);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export const __test = Object.freeze({
  BMW_M3_SECTIONS,
  exactTimestamp,
  validateBmwM3SectionCapture,
  combinedCapture
});
