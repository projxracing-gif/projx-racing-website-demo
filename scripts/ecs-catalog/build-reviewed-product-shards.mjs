import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REVIEWED_SHARD_SCHEMA_VERSION = 1;
export const REVIEWED_SHARD_SIZE = 128;
export const REVIEWED_SHARD_MAX_BYTES = 4 * 1024 * 1024;
export const REVIEWED_INDEX_MAX_BYTES = 64 * 1024 * 1024;
export const REVIEWED_PRODUCT_MAX_COUNT = 50_000;
export const REVIEWED_BMW_M3_SECTIONS = Object.freeze([
  'braking', 'engine', 'exterior', 'interior', 'performance', 'suspension', 'steering'
]);

const PRODUCT_KEY = /^ecs-es-\d{3,12}$/;
const PRODUCT_SLUG = /^es-\d{3,12}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export class ReviewedShardBuildError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReviewedShardBuildError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ReviewedShardBuildError(code, message);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
}

function clean(value, maximum = 5_000) {
  return String(value ?? '').normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function identity(value) {
  return clean(value, 20_000).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function stableSearchDocument(product) {
  const values = [
    product.title, product.titleAr, product.brand, product.category, product.categoryAr,
    product.subcategory, product.subcategoryAr, product.ecsPartNumber, product.sku, product.mpn,
    product.description, product.descriptionAr, product.summary, product.summaryAr,
    ...(product.selectionSources || []).map(source => source?.category),
    ...(product.specifications || []).flatMap(item => [item?.name, item?.label, item?.value]),
    ...(product.fitments || []).flatMap(fitment => [
      fitment.make, fitment.model, fitment.generation,
      ...(fitment.models || []), ...(fitment.chassis || []), ...(fitment.engines || [])
    ])
  ];
  const tokens = new Set(identity(values.filter(Boolean).join(' ')).split(' ').filter(token => token.length > 1));
  return [...tokens].slice(0, 256).join(' ').slice(0, 6_000);
}

function compactFitment(fitment) {
  return {
    make: clean(fitment?.make, 80) || null,
    model: clean(fitment?.model, 100) || null,
    models: Array.isArray(fitment?.models) ? fitment.models.map(value => clean(value, 100)).filter(Boolean) : [],
    generation: clean(fitment?.generation, 120) || null,
    chassis: Array.isArray(fitment?.chassis) ? fitment.chassis.map(value => clean(value, 80)).filter(Boolean) : [],
    yearFrom: Number.isInteger(fitment?.yearFrom) ? fitment.yearFrom : null,
    yearTo: Number.isInteger(fitment?.yearTo) ? fitment.yearTo : null,
    engines: Array.isArray(fitment?.engines) ? fitment.engines.map(value => clean(value, 120)).filter(Boolean) : [],
    confidence: ['exact', 'possible'].includes(fitment?.confidence) ? fitment.confidence : 'possible'
  };
}

function routingProduct(product, sequence, productIndex) {
  return {
    shardedRoute: true,
    shardSequence: sequence,
    shardProductIndex: productIndex,
    publicKey: product.publicKey,
    slug: product.slug,
    title: clean(product.title, 300),
    titleAr: clean(product.titleAr, 300) || null,
    brand: clean(product.brand, 120),
    brandSlug: clean(product.brandSlug, 120),
    category: clean(product.category, 160),
    categoryAr: clean(product.categoryAr, 160) || null,
    categorySlug: clean(product.categorySlug, 160),
    subcategory: clean(product.subcategory, 200) || null,
    subcategoryAr: clean(product.subcategoryAr, 200) || null,
    subcategorySlug: clean(product.subcategorySlug, 200) || null,
    ecsPartNumber: clean(product.ecsPartNumber, 120),
    sku: clean(product.sku, 120),
    mpn: clean(product.mpn, 160) || null,
    priceAmount: Number.isFinite(Number(product.priceAmount)) ? Number(product.priceAmount) : null,
    priceCurrency: product.priceCurrency === 'USD' ? 'USD' : null,
    priceStartingAt: Boolean(product.priceStartingAt),
    priceConflict: Boolean(product.priceConflict),
    priceVerifiedAt: clean(product.priceVerifiedAt, 40) || null,
    quoteOnly: Boolean(product.quoteOnly),
    checkedAt: clean(product.checkedAt, 40) || null,
    staleAfterDays: Number.isFinite(Number(product.staleAfterDays)) ? Number(product.staleAfterDays) : 7,
    stockPolicy: clean(product.stockPolicy, 80) || 'manual-confirm',
    availabilityCode: clean(product.availabilityCode, 80) || 'check_availability',
    fitmentConfidence: ['exact', 'possible'].includes(product.fitmentConfidence)
      ? product.fitmentConfidence : 'possible',
    fitments: Array.isArray(product.fitments) ? product.fitments.map(compactFitment) : [],
    filters: {
      categories: Array.isArray(product.filters?.categories) ? [...product.filters.categories] : [],
      subcategories: Array.isArray(product.filters?.subcategories) ? [...product.filters.subcategories] : []
    },
    selectionRank: Number.isFinite(Number(product.selectionRank)) ? Number(product.selectionRank) : null,
    searchDocument: stableSearchDocument(product)
  };
}

function canonicalTimestamp(value) {
  const source = clean(value, 80);
  const milliseconds = Date.parse(source);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(source)
    || !Number.isFinite(milliseconds)) fail('invalid_audit', 'The aggregate audit generatedAt value is invalid.');
  return new Date(milliseconds).toISOString();
}

function validateProduct(product, seenKeys, seenSlugs) {
  if (!product || typeof product !== 'object' || !PRODUCT_KEY.test(product.publicKey)
    || !PRODUCT_SLUG.test(product.slug) || !clean(product.title, 300) || !clean(product.brand, 120)
    || product.priceCurrency !== 'USD' || !Array.isArray(product.selectionSources)) {
    fail('invalid_product', 'Every reviewed shard product requires a valid ECS identity, title, brand, USD policy and selection evidence.');
  }
  if (seenKeys.has(product.publicKey) || seenSlugs.has(product.slug)) {
    fail('duplicate_product', `Duplicate reviewed product identity: ${product.publicKey}.`);
  }
  seenKeys.add(product.publicKey);
  seenSlugs.add(product.slug);
}

function sectionState(audit) {
  const progress = audit?.captureProgress;
  if (!progress || typeof progress !== 'object' || !progress.sections) {
    fail('invalid_audit', 'The aggregate audit must include captureProgress section reconciliation.');
  }
  const included = new Set((progress.includedSections || []).map(value => clean(value, 40).toLowerCase()));
  const sections = {};
  for (const key of REVIEWED_BMW_M3_SECTIONS) {
    const source = progress.sections[key] || {};
    const complete = source.complete === true;
    if (included.has(key) && !complete) {
      fail('unverified_section', `BMW M3 ${key} cannot be included before reconciliation is complete.`);
    }
    sections[key] = {
      complete,
      included: included.has(key),
      capturedPages: Number.isSafeInteger(source.capturedPages) ? source.capturedPages : 0,
      expectedPages: Number.isSafeInteger(source.expectedPages) ? source.expectedPages : 0,
      capturedPlacements: Number.isSafeInteger(source.capturedPlacements) ? source.capturedPlacements : 0,
      expectedPlacements: Number.isSafeInteger(source.expectedPlacements) ? source.expectedPlacements : 0,
      productCount: Number.isSafeInteger(audit?.sections?.[key]?.productCount)
        ? audit.sections[key].productCount : 0
    };
  }
  const complete = REVIEWED_BMW_M3_SECTIONS.every(key => sections[key].complete && sections[key].included);
  if (Boolean(progress.complete) !== complete) {
    fail('invalid_audit', 'The aggregate audit complete flag does not match the seven reconciled sections.');
  }
  return { complete, included, sections };
}

function productSections(product) {
  return new Set((product.selectionSources || []).map(source => clean(source?.section, 40).toLowerCase()));
}

export function buildReviewedProductShardRelease(products, audit, { shardSize = REVIEWED_SHARD_SIZE } = {}) {
  if (!Array.isArray(products) || !products.length || products.length > REVIEWED_PRODUCT_MAX_COUNT) {
    fail('invalid_product_count', `Reviewed shard releases require 1-${REVIEWED_PRODUCT_MAX_COUNT} products.`);
  }
  if (!Number.isSafeInteger(shardSize) || shardSize < 32 || shardSize > 250) {
    fail('invalid_shard_size', 'Reviewed product shard size must be between 32 and 250.');
  }
  const generatedAt = canonicalTimestamp(audit?.generatedAt);
  const state = sectionState(audit);
  const seenKeys = new Set();
  const seenSlugs = new Set();
  for (const product of products) {
    validateProduct(product, seenKeys, seenSlugs);
    const sections = productSections(product);
    if (!sections.size || [...sections].some(section => !state.included.has(section))) {
      fail('unverified_product_scope', `${product.publicKey} references a section that is not reconciled and included.`);
    }
  }
  const ordered = [...products].sort((left, right) => left.title.localeCompare(right.title, 'en')
    || left.publicKey.localeCompare(right.publicKey, 'en'));
  const datasetSha256 = sha256(jsonBuffer({
    generatedAt,
    complete: state.complete,
    sections: state.sections,
    keys: ordered.map(product => [product.publicKey, sha256(jsonBuffer(product))])
  }));
  const releaseId = `${generatedAt.replace(/[-:.]/g, '').replace('Z', 'Z')}-${datasetSha256.slice(0, 16)}`;
  const shards = [];
  const routes = [];
  for (let offset = 0; offset < ordered.length; offset += shardSize) {
    const productsInShard = ordered.slice(offset, offset + shardSize);
    const sequence = shards.length + 1;
    const file = `shard-${String(sequence).padStart(5, '0')}.json`;
    const document = {
      schemaVersion: REVIEWED_SHARD_SCHEMA_VERSION,
      supplier: 'ECS Tuning',
      kind: 'ecs-reviewed-product-shard',
      releaseId,
      sequence,
      productCount: productsInShard.length,
      products: productsInShard
    };
    const buffer = jsonBuffer(document);
    if (buffer.length > REVIEWED_SHARD_MAX_BYTES) {
      fail('shard_too_large', `${file} exceeds the ${REVIEWED_SHARD_MAX_BYTES}-byte limit.`);
    }
    productsInShard.forEach((product, productIndex) => routes.push(routingProduct(product, sequence, productIndex)));
    shards.push({
      sequence, file, productCount: productsInShard.length, bytes: buffer.length,
      sha256: sha256(buffer), firstKey: productsInShard[0].publicKey,
      lastKey: productsInShard.at(-1).publicKey, buffer
    });
  }
  const indexDocument = {
    schemaVersion: REVIEWED_SHARD_SCHEMA_VERSION,
    supplier: 'ECS Tuning',
    kind: 'ecs-reviewed-product-routing-index',
    releaseId,
    routeCount: routes.length,
    routes
  };
  const indexBuffer = jsonBuffer(indexDocument);
  if (indexBuffer.length > REVIEWED_INDEX_MAX_BYTES) {
    fail('index_too_large', `The routing index exceeds the ${REVIEWED_INDEX_MAX_BYTES}-byte limit.`);
  }
  const manifest = {
    schemaVersion: REVIEWED_SHARD_SCHEMA_VERSION,
    supplier: 'ECS Tuning',
    kind: 'ecs-reviewed-product-shard-manifest',
    releaseId,
    generatedAt,
    publicationMode: state.complete ? 'complete' : 'verified-progress',
    complete: state.complete,
    requestedSections: [...REVIEWED_BMW_M3_SECTIONS],
    includedSections: REVIEWED_BMW_M3_SECTIONS.filter(key => state.sections[key].included),
    excludedSections: REVIEWED_BMW_M3_SECTIONS.filter(key => !state.sections[key].included),
    sections: state.sections,
    counts: {
      productCount: ordered.length,
      routeCount: routes.length,
      shardCount: shards.length,
      quarantinedIdentityCount: Number.isSafeInteger(audit?.quarantinedIdentityCount)
        ? audit.quarantinedIdentityCount : 0
    },
    index: { file: 'index.json', bytes: indexBuffer.length, sha256: sha256(indexBuffer) },
    shards: shards.map(({ buffer, ...descriptor }) => descriptor),
    contentSetSha256: sha256(Buffer.from([
      `index.json\0${indexBuffer.length}\0${sha256(indexBuffer)}`,
      ...shards.map(shard => `${shard.file}\0${shard.bytes}\0${shard.sha256}`)
    ].join('\n'), 'utf8'))
  };
  return { manifest, indexDocument, indexBuffer, shards, datasetSha256 };
}

async function writeAtomic(filename, buffer) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}`;
  await writeFile(temporary, buffer);
  await rename(temporary, filename);
}

export async function writeReviewedProductShardRelease(outputDirectory, release) {
  const root = path.resolve(outputDirectory);
  await mkdir(root, { recursive: true });
  await Promise.all(release.shards.map(shard => writeAtomic(path.join(root, shard.file), shard.buffer)));
  await writeAtomic(path.join(root, 'index.json'), release.indexBuffer);
  const manifestBuffer = Buffer.from(`${JSON.stringify(release.manifest, null, 2)}\n`, 'utf8');
  await writeAtomic(path.join(root, 'manifest.json'), manifestBuffer);
  await writeAtomic(path.join(root, 'manifest.json.sha256'), Buffer.from(`${sha256(manifestBuffer)}  manifest.json\n`, 'utf8'));
  return { outputDirectory: root, manifestBytes: manifestBuffer.length, ...release.manifest.counts };
}

export async function readReviewedProductsFromShardRelease(inputDirectory) {
  const root = path.resolve(inputDirectory);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  } catch {
    fail('invalid_input_release', 'The input reviewed shard manifest could not be read.');
  }
  if (manifest?.schemaVersion !== REVIEWED_SHARD_SCHEMA_VERSION || manifest?.supplier !== 'ECS Tuning'
    || manifest?.kind !== 'ecs-reviewed-product-shard-manifest' || !Array.isArray(manifest?.shards)
    || !safeIntegerForRead(manifest?.counts?.productCount, 1, REVIEWED_PRODUCT_MAX_COUNT)
    || manifest.shards.length !== manifest.counts.shardCount) {
    fail('invalid_input_release', 'The input reviewed shard manifest is invalid.');
  }
  const products = [];
  for (const descriptor of manifest.shards) {
    if (!/^shard-\d{5}\.json$/.test(descriptor?.file)
      || !safeIntegerForRead(descriptor?.bytes, 1, REVIEWED_SHARD_MAX_BYTES)
      || !SHA256.test(descriptor?.sha256 || '')) {
      fail('invalid_input_release', 'An input reviewed shard descriptor is invalid.');
    }
    const buffer = Buffer.from(await readFile(path.join(root, descriptor.file)));
    if (buffer.length !== descriptor.bytes || sha256(buffer) !== descriptor.sha256) {
      fail('input_checksum_mismatch', `${descriptor.file} failed input checksum validation.`);
    }
    const document = JSON.parse(buffer.toString('utf8'));
    if (document?.schemaVersion !== REVIEWED_SHARD_SCHEMA_VERSION || document?.supplier !== 'ECS Tuning'
      || document?.kind !== 'ecs-reviewed-product-shard' || document?.releaseId !== manifest.releaseId
      || document?.sequence !== descriptor.sequence || document?.productCount !== descriptor.productCount
      || !Array.isArray(document?.products) || document.products.length !== descriptor.productCount) {
      fail('invalid_input_release', `${descriptor.file} is not a valid reviewed product shard.`);
    }
    products.push(...document.products);
  }
  if (products.length !== manifest.counts.productCount) {
    fail('invalid_input_release', 'The input reviewed product shard counts do not reconcile.');
  }
  return products;
}

function safeIntegerForRead(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function argument(argv, name) {
  const positions = argv.flatMap((value, index) => value === name ? [index] : []);
  if (positions.length > 1) fail('invalid_arguments', `Duplicate option: ${name}.`);
  const index = positions[0];
  if (index === undefined) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) fail('invalid_arguments', `Missing value for ${name}.`);
  return value;
}

async function main() {
  const argv = process.argv.slice(2);
  const inputModule = argument(argv, '--input-module');
  const inputDirectory = argument(argv, '--input-dir');
  const auditPath = argument(argv, '--audit');
  const outputDirectory = argument(argv, '--output-dir');
  if (Boolean(inputModule) === Boolean(inputDirectory) || !auditPath || !outputDirectory) {
    fail('invalid_arguments', 'Usage: build-reviewed-product-shards.mjs (--input-module <products.js> | --input-dir <existing-release>) --audit <report.json> --output-dir <directory>.');
  }
  const products = inputModule
    ? (await import(`${pathToFileURL(path.resolve(inputModule)).href}?reviewed-shards=${Date.now()}`))
      .BMW_M3_AGGREGATE_PRODUCTS
    : await readReviewedProductsFromShardRelease(inputDirectory);
  const audit = JSON.parse(await readFile(path.resolve(auditPath), 'utf8'));
  const release = buildReviewedProductShardRelease(products, audit);
  const result = await writeReviewedProductShardRelease(outputDirectory, release);
  process.stdout.write(`${JSON.stringify({ releaseId: release.manifest.releaseId, complete: release.manifest.complete, ...result })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error?.code || 'unexpected_failure'}: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
