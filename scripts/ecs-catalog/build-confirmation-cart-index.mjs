import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REVIEWED_ECS_PRODUCTS,
  mergeReviewedEcsProducts
} from '../../server/ecs-reviewed-catalog.js';
import {
  buildEcsConfirmationCartIndex,
  validateEcsConfirmationCartIndex
} from '../../server/ecs-confirmation-cart-sellability.js';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..', '..');
const DEFAULT_SOURCE_DIRECTORY = path.join(PROJECT_ROOT, 'api', 'data', 'ecs-bmw-m3-reviewed');
const DEFAULT_OUTPUT = path.join(PROJECT_ROOT, 'server', 'data', 'ecs-confirmation-cart-index.json');
const SHA256 = /^[a-f0-9]{64}$/;

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseArguments(values) {
  const options = {
    sourceDirectory: DEFAULT_SOURCE_DIRECTORY,
    output: DEFAULT_OUTPUT,
    evaluatedAt: null,
    expectedCount: null,
    check: false
  };
  for (const value of values) {
    if (value === '--check') options.check = true;
    else if (value.startsWith('--source=')) options.sourceDirectory = path.resolve(value.slice(9));
    else if (value.startsWith('--output=')) options.output = path.resolve(value.slice(9));
    else if (value.startsWith('--as-of=')) options.evaluatedAt = value.slice(8);
    else if (value.startsWith('--expected-count=')) options.expectedCount = Number(value.slice(17));
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!options.evaluatedAt) throw new Error('--as-of=<canonical UTC timestamp> is required.');
  if (options.expectedCount !== null
    && (!Number.isSafeInteger(options.expectedCount) || options.expectedCount < 1)) {
    throw new Error('--expected-count must be a positive safe integer.');
  }
  return options;
}

function requireManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.supplier !== 'ECS Tuning'
    || manifest.kind !== 'ecs-reviewed-product-shard-manifest'
    || typeof manifest.releaseId !== 'string' || !manifest.releaseId
    || !SHA256.test(String(manifest.contentSetSha256 || ''))
    || !Array.isArray(manifest.shards) || manifest.shards.length === 0) {
    throw new Error('The ECS reviewed shard manifest is invalid.');
  }
  return manifest;
}

export async function loadMergedReviewedEcsProducts({
  sourceDirectory = DEFAULT_SOURCE_DIRECTORY,
  readFileImpl = readFile
} = {}) {
  const manifestBytes = await readFileImpl(path.join(sourceDirectory, 'manifest.json'));
  const manifest = requireManifest(JSON.parse(String(manifestBytes)));
  const generatedProducts = [];
  let previousSequence = 0;
  for (const descriptor of manifest.shards) {
    if (!Number.isSafeInteger(descriptor.sequence) || descriptor.sequence !== previousSequence + 1
      || !/^shard-\d{5}\.json$/.test(String(descriptor.file || ''))
      || !Number.isSafeInteger(descriptor.productCount) || descriptor.productCount < 1
      || !SHA256.test(String(descriptor.sha256 || ''))) {
      throw new Error('The ECS reviewed shard descriptor is invalid.');
    }
    previousSequence = descriptor.sequence;
    const bytes = await readFileImpl(path.join(sourceDirectory, descriptor.file));
    if (digest(bytes) !== descriptor.sha256) {
      throw new Error(`ECS reviewed shard checksum mismatch: ${descriptor.file}`);
    }
    const shard = JSON.parse(String(bytes));
    if (shard.schemaVersion !== 1 || shard.supplier !== 'ECS Tuning'
      || shard.kind !== 'ecs-reviewed-product-shard' || shard.releaseId !== manifest.releaseId
      || shard.sequence !== descriptor.sequence || !Array.isArray(shard.products)
      || shard.products.length !== descriptor.productCount) {
      throw new Error(`Invalid ECS reviewed product shard: ${descriptor.file}`);
    }
    generatedProducts.push(...shard.products);
  }
  const expectedShardProducts = manifest.counts?.productCount;
  if (!Number.isSafeInteger(expectedShardProducts) || generatedProducts.length !== expectedShardProducts) {
    throw new Error('The ECS reviewed shard product count does not match its manifest.');
  }
  const products = mergeReviewedEcsProducts(REVIEWED_ECS_PRODUCTS, generatedProducts);
  return Object.freeze({ manifest, products: Object.freeze(products), generatedProductCount: generatedProducts.length });
}

export async function generateEcsConfirmationCartIndex(options = {}) {
  const source = await loadMergedReviewedEcsProducts(options);
  const baseContentSha256 = digest(JSON.stringify(REVIEWED_ECS_PRODUCTS));
  const document = buildEcsConfirmationCartIndex(source.products, {
    evaluatedAt: options.evaluatedAt,
    sourceReleaseId: source.manifest.releaseId,
    sourceContentSha256: source.manifest.contentSetSha256,
    baseContentSha256,
    sourceProductCount: source.products.length,
    expectedCount: options.expectedCount
  });
  validateEcsConfirmationCartIndex(document);
  return Object.freeze({
    document,
    bytes: Buffer.from(`${JSON.stringify(document)}\n`, 'utf8'),
    source
  });
}

async function writeAtomically(filename, bytes) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, filename);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const generated = await generateEcsConfirmationCartIndex(options);
  if (options.check) {
    const existing = await readFile(options.output);
    if (!existing.equals(generated.bytes)) {
      throw new Error('The checked-in ECS confirmation-cart index is not deterministic or is out of date.');
    }
  } else {
    await writeAtomically(options.output, generated.bytes);
  }
  const status = {
    output: path.relative(PROJECT_ROOT, options.output).replaceAll('\\', '/'),
    productCount: generated.document.productCount,
    bytes: generated.bytes.length,
    contentSha256: generated.document.contentSha256,
    sourceReleaseId: generated.document.source.releaseId,
    sourceProductCount: generated.document.source.mergedProductCount,
    evaluatedAt: generated.document.evaluatedAt,
    earliestExpiryAt: generated.document.earliestExpiryAt,
    latestExpiryAt: generated.document.latestExpiryAt,
    check: options.check
  };
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  return status;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch(error => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
