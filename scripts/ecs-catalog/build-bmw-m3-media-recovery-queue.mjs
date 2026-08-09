import { createHash } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA_VERSION = 1;
const SUPPLIER = 'ECS Tuning';
const PRODUCT_KEY = /^ecs-es-(\d{3,12})$/;
const PRODUCT_SLUG = /^es-(\d{3,12})$/;
const ECS_NUMBER = /^ES#(\d{3,12})$/;
const SHARD_FILE = /^shard-(\d{5})\.json$/;
const SHA256 = /^[a-f0-9]{64}$/;
const RELEASE_ID = /^\d{8}T\d{9}Z-[a-f0-9]{16}$/;
const PRODUCT_PATH = /^\/b-[^/?#]+\/[^/?#]+\/[^/?#]+\/$/i;
const ALLOWED_SECTIONS = new Set([
  'braking', 'engine', 'exterior', 'interior', 'performance', 'suspension', 'steering'
]);

export class BmwM3MediaRecoveryQueueError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BmwM3MediaRecoveryQueueError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new BmwM3MediaRecoveryQueueError(code, message);
}

function clean(value, maximum = 5_000) {
  return String(value ?? '').normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function compactJsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
}

function pathIsWithin(root, candidate, allowRoot = false) {
  const relative = path.relative(root, candidate);
  return (allowRoot && relative === '') || (relative !== '' && relative !== '..'
    && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function lstatIfPresent(filename) {
  try {
    return await lstat(filename);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function ensureDirectoryWithoutLinks(directory) {
  let status = await lstatIfPresent(directory);
  if (!status) {
    try {
      await mkdir(directory);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    status = await lstat(directory);
  }
  if (status.isSymbolicLink() || !status.isDirectory()) {
    fail('unsafe_output_path', 'Recovery queue output directories cannot be links or non-directories.');
  }
}

async function safePrivateOutput(filename, repositoryRoot) {
  const root = path.resolve(repositoryRoot || '');
  const privateRoot = path.join(root, 'private-imports');
  const output = path.resolve(filename);
  if (!repositoryRoot || !pathIsWithin(privateRoot, output)) {
    fail('unsafe_output_path', 'Recovery queue output must stay below this repository\'s private-imports directory.');
  }
  const rootStatus = await lstatIfPresent(root);
  if (!rootStatus || (!rootStatus.isDirectory() && !rootStatus.isSymbolicLink())) {
    fail('unsafe_output_path', 'The recovery queue repository root is unavailable.');
  }
  const resolvedRoot = await realpath(root);
  const relativeParent = path.relative(privateRoot, path.dirname(output));
  const segments = ['private-imports', ...relativeParent.split(path.sep).filter(Boolean)];
  let current = root;
  let resolvedPrivateRoot = null;
  for (const [position, segment] of segments.entries()) {
    current = path.join(current, segment);
    await ensureDirectoryWithoutLinks(current);
    const resolvedCurrent = await realpath(current);
    if (position === 0) {
      if (!pathIsWithin(resolvedRoot, resolvedCurrent)) {
        fail('unsafe_output_path', 'The private-imports directory resolves outside the repository.');
      }
      resolvedPrivateRoot = resolvedCurrent;
    } else if (!pathIsWithin(resolvedPrivateRoot, resolvedCurrent, true)) {
      fail('unsafe_output_path', 'A recovery queue output directory resolves outside private-imports.');
    }
  }
  return output;
}

function canonicalEcsProductUrl(value) {
  const source = clean(value, 2_000);
  try {
    const url = new URL(source);
    const canonical = url.toString();
    if (url.protocol !== 'https:' || url.hostname !== 'www.ecstuning.com'
      || url.username || url.password || url.port || url.search || url.hash
      || !PRODUCT_PATH.test(url.pathname) || canonical !== source) return null;
    return canonical;
  } catch {
    return null;
  }
}

function exactIdentity(product) {
  const publicKey = clean(product?.publicKey, 100).match(PRODUCT_KEY);
  const slug = clean(product?.slug, 100).match(PRODUCT_SLUG);
  const ecsPartNumber = clean(product?.ecsPartNumber, 100).match(ECS_NUMBER);
  const sku = clean(product?.sku, 100).match(ECS_NUMBER);
  const identifierEcs = clean(product?.identifiers?.ecs, 100).match(ECS_NUMBER);
  const identifierSku = clean(product?.identifiers?.sku, 100).match(ECS_NUMBER);
  const values = [publicKey, slug, ecsPartNumber, sku, identifierEcs, identifierSku]
    .map(match => match?.[1] || null);
  if (values.some(value => !value) || new Set(values).size !== 1) {
    fail('conflicting_identity', 'A reviewed product has conflicting or missing ECS identities.');
  }
  return { digits: values[0], ecsPartNumber: `ES#${values[0]}` };
}

function exactMpn(product, ecsPartNumber) {
  const mpn = clean(product?.mpn, 200);
  const identifierMpn = clean(product?.identifiers?.mpn, 200);
  if (!mpn || !identifierMpn || mpn !== identifierMpn) {
    fail('conflicting_identity', `${ecsPartNumber} has a missing or conflicting manufacturer part number.`);
  }
  return mpn;
}

function queueSection(product, includedSections, ecsPartNumber) {
  const section = clean(product?.section, 80);
  const key = section.toLocaleLowerCase('en-US');
  const category = clean(product?.subcategory, 300);
  if (!section || !ALLOWED_SECTIONS.has(key) || !includedSections.has(key) || !category) {
    fail('invalid_scope', `${ecsPartNumber} does not have an included BMW M3 section and category.`);
  }
  return { section, sectionKey: key, category };
}

function unavailableMedia(product, ecsPartNumber) {
  const images = Array.isArray(product?.images) ? product.images : null;
  const sourceUrl = clean(product?.imageSourceUrl, 2_000);
  if (!images) fail('invalid_media_state', `${ecsPartNumber} does not have an images array.`);
  if (product?.imageStatus === 'supplier-media-unavailable') {
    if (images.length || sourceUrl) {
      fail('invalid_media_state', `${ecsPartNumber} conflicts: unavailable media has a source image.`);
    }
    return true;
  }
  if (product?.imageStatus !== 'supplier-media-verified') {
    fail('invalid_media_state', `${ecsPartNumber} has an unsupported supplier-media state.`);
  }
  if (!images.length || !sourceUrl) {
    fail('invalid_media_state', `${ecsPartNumber} conflicts: verified media has no source image.`);
  }
  return false;
}

function orderedCounts(items, field) {
  const counts = new Map();
  for (const item of items) counts.set(item[field], (counts.get(item[field]) || 0) + 1);
  return Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right, 'en')));
}

function validateManifest(manifest) {
  const includedSections = Array.isArray(manifest?.includedSections)
    ? manifest.includedSections.map(value => clean(value, 40).toLocaleLowerCase('en-US')) : [];
  if (manifest?.schemaVersion !== SCHEMA_VERSION || manifest?.supplier !== SUPPLIER
    || manifest?.kind !== 'ecs-reviewed-product-shard-manifest'
    || !RELEASE_ID.test(clean(manifest?.releaseId, 100))
    || !SHA256.test(clean(manifest?.contentSetSha256, 100))
    || !includedSections.length || includedSections.some(section => !ALLOWED_SECTIONS.has(section))
    || new Set(includedSections).size !== includedSections.length
    || !Array.isArray(manifest?.shards) || !manifest.shards.length
    || !Number.isSafeInteger(manifest?.counts?.productCount) || manifest.counts.productCount < 1
    || manifest?.counts?.routeCount !== manifest.counts.productCount
    || manifest?.counts?.shardCount !== manifest.shards.length) {
    fail('invalid_manifest', 'The reviewed BMW M3 shard manifest is invalid.');
  }
  return new Set(includedSections);
}

function validateIndex(index, manifest, products) {
  if (index?.schemaVersion !== SCHEMA_VERSION || index?.supplier !== SUPPLIER
    || index?.kind !== 'ecs-reviewed-product-routing-index'
    || index?.releaseId !== manifest.releaseId || !Array.isArray(index?.routes)
    || index.routeCount !== products.length || index.routes.length !== products.length) {
    fail('invalid_index', 'The reviewed BMW M3 routing index does not match its manifest and shards.');
  }
  const productsBySource = new Map(products.map(product => [product.sourceKey, product]));
  if (productsBySource.size !== products.length) {
    fail('invalid_index', 'The reviewed BMW M3 shard source positions are not unique.');
  }
  const seenSourcePositions = new Set();
  for (const [position, route] of index.routes.entries()) {
    const shardSequence = Number(route?.shardSequence);
    const shardProductIndex = Number(route?.shardProductIndex);
    const key = `${shardSequence}:${shardProductIndex}`;
    const product = productsBySource.get(key);
    if (seenSourcePositions.has(key) || route?.shardedRoute !== true || !product
      || route.publicKey !== product.product.publicKey
      || route.slug !== product.product.slug || route.ecsPartNumber !== product.product.ecsPartNumber) {
      fail('invalid_index', `Routing index entry ${position + 1} conflicts with its product shard.`);
    }
    seenSourcePositions.add(key);
  }
}

export function buildBmwM3MediaRecoveryQueue(sourceProducts, manifest, manifestSha256) {
  if (!Array.isArray(sourceProducts) || !sourceProducts.length || !SHA256.test(clean(manifestSha256, 100))) {
    fail('invalid_input', 'A reviewed product set, manifest and manifest checksum are required.');
  }
  const includedSections = validateManifest(manifest);
  const seenIdentities = new Set();
  const seenUrls = new Map();
  const items = [];
  for (const source of sourceProducts) {
    const product = source?.product;
    const { digits, ecsPartNumber } = exactIdentity(product);
    if (seenIdentities.has(digits)) fail('duplicate_identity', `Duplicate reviewed identity: ${ecsPartNumber}.`);
    seenIdentities.add(digits);
    const mpn = exactMpn(product, ecsPartNumber);
    const productUrl = canonicalEcsProductUrl(product?.originalUrl);
    if (!productUrl) fail('invalid_product_url', `${ecsPartNumber} has a non-canonical ECS product URL.`);
    const existingUrlIdentity = seenUrls.get(productUrl);
    if (existingUrlIdentity && existingUrlIdentity !== digits) {
      fail('conflicting_identity', `${productUrl} is assigned to multiple ECS identities.`);
    }
    seenUrls.set(productUrl, digits);
    const { section, sectionKey, category } = queueSection(product, includedSections, ecsPartNumber);
    const missingMedia = unavailableMedia(product, ecsPartNumber);
    if (!missingMedia) continue;
    const sourceShard = clean(source?.sourceShard, 40);
    const sourceProductIndex = Number(source?.sourceProductIndex);
    const title = clean(product?.title, 500);
    if (!SHARD_FILE.test(sourceShard) || !Number.isSafeInteger(sourceProductIndex)
      || sourceProductIndex < 0 || !title) {
      fail('invalid_source_reference', `${ecsPartNumber} has an invalid shard source reference or title.`);
    }
    const brandSupplied = product?.brandSupplied === true;
    const brand = clean(product?.brand, 200);
    if (brandSupplied && !brand) fail('conflicting_identity', `${ecsPartNumber} has an empty supplied brand.`);
    items.push({
      ecsPartNumber,
      mpn,
      productUrl,
      title,
      brand: brandSupplied ? brand : null,
      section,
      sectionKey,
      category,
      missingDescription: product?.detailedDescriptionAvailable !== true,
      missingBrand: !brandSupplied,
      sourceShard,
      sourceProductIndex
    });
  }
  if (sourceProducts.length !== manifest.counts.productCount) {
    fail('count_mismatch', 'The reviewed shard product count does not match its manifest.');
  }
  const ordered = items.sort((left, right) => left.sectionKey.localeCompare(right.sectionKey, 'en')
    || left.category.localeCompare(right.category, 'en')
    || Number(left.ecsPartNumber.slice(3)) - Number(right.ecsPartNumber.slice(3)));
  const identitySet = [...ordered].map(item => item.ecsPartNumber).sort((left, right) => left.localeCompare(right, 'en'));
  const recordsSha256 = sha256(compactJsonBuffer(ordered));
  const identitySetSha256 = sha256(Buffer.from(identitySet.join('\n'), 'utf8'));
  return {
    schemaVersion: SCHEMA_VERSION,
    supplier: SUPPLIER,
    kind: 'bmw-m3-supplier-media-recovery-queue',
    sourceRelease: {
      releaseId: manifest.releaseId,
      generatedAt: manifest.generatedAt,
      manifestSha256,
      contentSetSha256: manifest.contentSetSha256,
      reviewedProductCount: sourceProducts.length,
      includedSections: [...includedSections].sort()
    },
    policy: {
      access: 'public-product-detail-pages-only',
      media: 'verified-supplier-media-only',
      noFabrication: true,
      noChallengeBypass: true
    },
    counts: {
      recoveryCandidateCount: ordered.length,
      missingDescriptionCount: ordered.filter(item => item.missingDescription).length,
      missingBrandCount: ordered.filter(item => item.missingBrand).length,
      bySection: orderedCounts(ordered, 'section'),
      byCategory: orderedCounts(ordered, 'category')
    },
    identitySetSha256,
    recordsSha256,
    items: ordered
  };
}

export async function loadBmwM3ReviewedShardRelease(directory) {
  const sourceDirectory = path.resolve(directory);
  const manifestPath = path.join(sourceDirectory, 'manifest.json');
  const manifestBuffer = await readFile(manifestPath);
  const manifestSha256 = sha256(manifestBuffer);
  const sidecar = clean(await readFile(`${manifestPath}.sha256`, 'utf8'), 500);
  const sidecarMatch = sidecar.match(/^([a-f0-9]{64})\s+manifest\.json$/);
  if (!sidecarMatch || sidecarMatch[1] !== manifestSha256) {
    fail('manifest_checksum_mismatch', 'The reviewed BMW M3 manifest checksum sidecar is invalid.');
  }
  const manifest = JSON.parse(manifestBuffer.toString('utf8'));
  validateManifest(manifest);
  const products = [];
  for (const [position, entry] of manifest.shards.entries()) {
    const fileMatch = clean(entry?.file, 80).match(SHARD_FILE);
    const sequence = position + 1;
    if (!fileMatch || Number(fileMatch[1]) !== sequence || entry?.sequence !== sequence
      || !Number.isSafeInteger(entry?.bytes) || entry.bytes < 1
      || !Number.isSafeInteger(entry?.productCount) || entry.productCount < 1
      || !SHA256.test(clean(entry?.sha256, 100))) {
      fail('invalid_manifest', `Shard manifest entry ${sequence} is invalid.`);
    }
    const shardPath = path.join(sourceDirectory, entry.file);
    if (path.dirname(shardPath) !== sourceDirectory) fail('invalid_manifest', 'Shard path traversal is not allowed.');
    const shardBuffer = await readFile(shardPath);
    if (shardBuffer.length !== entry.bytes || sha256(shardBuffer) !== entry.sha256) {
      fail('shard_checksum_mismatch', `${entry.file} failed byte or checksum verification.`);
    }
    const shard = JSON.parse(shardBuffer.toString('utf8'));
    if (shard?.schemaVersion !== SCHEMA_VERSION || shard?.supplier !== SUPPLIER
      || shard?.kind !== 'ecs-reviewed-product-shard' || shard?.releaseId !== manifest.releaseId
      || shard?.sequence !== sequence || !Array.isArray(shard?.products)
      || shard.productCount !== shard.products.length || shard.productCount !== entry.productCount
      || entry.firstKey !== shard.products[0]?.publicKey
      || entry.lastKey !== shard.products.at(-1)?.publicKey) {
      fail('invalid_shard', `${entry.file} does not match its manifest.`);
    }
    shard.products.forEach((product, sourceProductIndex) => products.push({
      product,
      sourceShard: entry.file,
      sourceProductIndex,
      sourceKey: `${sequence}:${sourceProductIndex}`
    }));
  }
  const indexEntry = manifest.index;
  if (indexEntry?.file !== 'index.json' || !Number.isSafeInteger(indexEntry?.bytes)
    || !SHA256.test(clean(indexEntry?.sha256, 100))) {
    fail('invalid_manifest', 'The reviewed BMW M3 routing-index manifest entry is invalid.');
  }
  const indexBuffer = await readFile(path.join(sourceDirectory, 'index.json'));
  if (indexBuffer.length !== indexEntry.bytes || sha256(indexBuffer) !== indexEntry.sha256) {
    fail('index_checksum_mismatch', 'The reviewed BMW M3 routing index failed byte or checksum verification.');
  }
  const contentSetSha256 = sha256(Buffer.from([
    `index.json\0${indexBuffer.length}\0${sha256(indexBuffer)}`,
    ...manifest.shards.map(entry => `${entry.file}\0${entry.bytes}\0${entry.sha256}`)
  ].join('\n'), 'utf8'));
  if (contentSetSha256 !== manifest.contentSetSha256) {
    fail('content_set_checksum_mismatch', 'The reviewed BMW M3 release content-set checksum is invalid.');
  }
  validateIndex(JSON.parse(indexBuffer.toString('utf8')), manifest, products);
  return { manifest, manifestSha256, products };
}

export async function writeBmwM3MediaRecoveryQueue(outputPath, queue, { repositoryRoot } = {}) {
  const filename = await safePrivateOutput(outputPath, repositoryRoot);
  const buffer = jsonBuffer(queue);
  const checksum = sha256(buffer);
  const sidecar = `${filename}.sha256`;
  if (await lstatIfPresent(filename) || await lstatIfPresent(sidecar)) {
    fail('output_exists', 'Recovery queue output and checksum files are create-only and cannot be overwritten.');
  }
  let outputHandle = null;
  let sidecarHandle = null;
  try {
    outputHandle = await open(filename, 'wx');
    sidecarHandle = await open(sidecar, 'wx');
    await outputHandle.writeFile(buffer);
    await outputHandle.sync();
    await sidecarHandle.writeFile(`${checksum}  ${path.basename(filename)}\n`, 'utf8');
    await sidecarHandle.sync();
  } catch (error) {
    await outputHandle?.close().catch(() => {});
    await sidecarHandle?.close().catch(() => {});
    if (outputHandle) await rm(filename, { force: true }).catch(() => {});
    if (sidecarHandle) await rm(sidecar, { force: true }).catch(() => {});
    if (error?.code === 'EEXIST') {
      fail('output_exists', 'Recovery queue output and checksum files are create-only and cannot be overwritten.');
    }
    throw error;
  }
  await outputHandle.close();
  await sidecarHandle.close();
  return { filename, bytes: buffer.length, sha256: checksum, sidecar };
}

function option(args, name, fallback = null) {
  const position = args.indexOf(name);
  if (position === -1) return fallback;
  const value = args[position + 1];
  if (!value || value.startsWith('--')) fail('invalid_arguments', `${name} requires a value.`);
  return value;
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const args = process.argv.slice(2);
  const known = new Set([
    '--source-dir', '--output', '--expect-count', '--expect-identity-sha256'
  ]);
  for (let index = 0; index < args.length; index += 2) {
    if (!known.has(args[index]) || args[index + 1] === undefined) {
      fail('invalid_arguments', `Unknown or incomplete argument: ${args[index] || '(empty)'}.`);
    }
  }
  const sourceDirectory = option(args, '--source-dir', path.join(root, 'api/data/ecs-bmw-m3-reviewed'));
  const outputPath = option(args, '--output',
    path.join(root, 'private-imports/ecs-bmw-m3-20260809/media-recovery-queue.json'));
  const expectedCountSource = option(args, '--expect-count');
  const expectedCount = expectedCountSource === null ? null : Number(expectedCountSource);
  const expectedIdentitySha256 = option(args, '--expect-identity-sha256');
  if (expectedCount !== null && (!Number.isSafeInteger(expectedCount) || expectedCount < 0)) {
    fail('invalid_arguments', '--expect-count must be a non-negative integer.');
  }
  if (expectedIdentitySha256 !== null && !SHA256.test(expectedIdentitySha256)) {
    fail('invalid_arguments', '--expect-identity-sha256 must be a lowercase SHA-256 value.');
  }
  const source = await loadBmwM3ReviewedShardRelease(sourceDirectory);
  const queue = buildBmwM3MediaRecoveryQueue(source.products, source.manifest, source.manifestSha256);
  if (expectedCount !== null && queue.counts.recoveryCandidateCount !== expectedCount) {
    fail('unexpected_recovery_count',
      `Expected ${expectedCount} recovery candidates; found ${queue.counts.recoveryCandidateCount}.`);
  }
  if (expectedIdentitySha256 !== null && queue.identitySetSha256 !== expectedIdentitySha256) {
    fail('unexpected_identity_set', 'The recovery identity set does not match the approved checksum.');
  }
  const written = await writeBmwM3MediaRecoveryQueue(outputPath, queue, { repositoryRoot: root });
  console.log(JSON.stringify({
    output: written.filename,
    checksumFile: written.sidecar,
    bytes: written.bytes,
    sha256: written.sha256,
    counts: queue.counts,
    identitySetSha256: queue.identitySetSha256,
    recordsSha256: queue.recordsSha256
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`${error?.code || 'recovery_queue_error'}: ${error?.message || error}`);
    process.exitCode = 1;
  });
}

export const __test = Object.freeze({ canonicalEcsProductUrl, sha256 });
