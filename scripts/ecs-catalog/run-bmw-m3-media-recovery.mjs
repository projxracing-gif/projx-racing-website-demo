import { createHash, randomBytes } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const PRIVATE_ROOT_NAME = 'private-imports';
const SCHEMA_VERSION = 1;
const SUPPLIER = 'ECS Tuning';
const QUEUE_KIND = 'bmw-m3-supplier-media-recovery-queue';
const CHECKPOINT_KIND = 'bmw-m3-media-recovery-product-checkpoint';
const QUARANTINE_KIND = 'bmw-m3-media-recovery-conflict';
const PROGRESS_KIND = 'bmw-m3-media-recovery-progress';
const PRODUCT_NUMBER = /^ES#(\d{3,12})$/;
const SHARD_FILE = /^shard-\d{5}\.json$/;
const SHA256 = /^[a-f0-9]{64}$/;
const RELEASE_ID = /^\d{8}T\d{9}Z-[a-f0-9]{16}$/;
const PRODUCT_PATH = /^\/b-[^/?#]+\/[^/?#]+\/[^/?#]+\/$/i;
const PRODUCT_MEDIA_PATH = /^\/product_library\/[^/?#]+\.(?:jpe?g|png|webp)$/i;
const GENERIC_MEDIA = /(?:^|[._-])(?:ecs[_-]?box[_-]?no[_-]?image|no[_-]?image|placeholder|loading|spacer|transparent|logo)(?:[._-]|$)/i;
const CHALLENGE_TITLE = /^(?:just a moment|attention required|access denied)/i;
const CURRENT_QUEUE_EXPECTATIONS = Object.freeze({
  queueSha256: 'cf7fa9f04332ae04270c49bc837f7272bf469861859c54855ed250612449da32',
  releaseId: '20260809T185719876Z-974a9b9a8fabb2f2',
  recoveryCandidateCount: 832,
  identitySetSha256: '7efa7f5f10770f61ee294856434fbee358239f23864d147402e09d6e1087f145',
  recordsSha256: 'fdd3146293749ef0c60aafdf2a42b3104eadfdf0a90606eb04a3d8423661e69a',
});
const PAGE_EVIDENCE_KEYS = new Set([
  'url', 'canonicalUrl', 'documentTitle', 'challenge', 'product', 'media'
]);
const PRODUCT_EVIDENCE_KEYS = new Set([
  'ecsPartNumber', 'mpn', 'title', 'brand', 'description'
]);
const MEDIA_EVIDENCE_KEYS = new Set(['url', 'role', 'evidence']);
const CHECKPOINT_KEYS = new Set(['schemaVersion', 'supplier', 'kind', 'payload', 'payloadSha256']);
const CHECKPOINT_PAYLOAD_KEYS = new Set([
  'queue', 'observedAt', 'identity', 'status', 'media', 'recovered', 'evidence'
]);
const CHECKPOINT_QUEUE_KEYS = new Set(['sha256', 'identitySetSha256', 'recordsSha256', 'releaseId']);
const CHECKPOINT_IDENTITY_KEYS = new Set(['ecsPartNumber', 'mpn', 'productUrl', 'title']);
const CHECKPOINT_RECOVERED_KEYS = new Set(['brand', 'description']);
const CHECKPOINT_EVIDENCE_KEYS = new Set(['pageUrl', 'canonicalUrl']);
const MEDIA_EVIDENCE = new Set([
  'product-gallery-source', 'product-gallery-image', 'product-jsonld-image'
]);

export class BmwM3MediaRecoveryRunnerError extends Error {
  constructor(code, message, { quarantine = false, details = null } = {}) {
    super(message);
    this.name = 'BmwM3MediaRecoveryRunnerError';
    this.code = code;
    this.quarantine = quarantine;
    this.details = details;
  }
}

function fail(code, message, options) {
  throw new BmwM3MediaRecoveryRunnerError(code, message, options);
}

function clean(value, maximum = 20_000) {
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

function hasExactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === expected.size
    && Object.keys(value).every(key => expected.has(key));
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
    fail('unsafe_private_path', 'Recovery runner directories cannot be links or non-directories.');
  }
}

async function ensurePrivateDirectory(directory, repositoryRoot = REPOSITORY_ROOT) {
  const root = path.resolve(repositoryRoot);
  const privateRoot = path.join(root, PRIVATE_ROOT_NAME);
  const target = path.resolve(directory);
  if (!pathIsWithin(privateRoot, target)) {
    fail('unsafe_private_path', 'Recovery runner output must stay below this repository\'s private-imports directory.');
  }
  const rootStatus = await lstatIfPresent(root);
  if (!rootStatus || (!rootStatus.isDirectory() && !rootStatus.isSymbolicLink())) {
    fail('unsafe_private_path', 'The recovery runner repository root is unavailable.');
  }
  const resolvedRoot = await realpath(root);
  const relativeTarget = path.relative(privateRoot, target);
  const segments = [PRIVATE_ROOT_NAME, ...relativeTarget.split(path.sep).filter(Boolean)];
  let current = root;
  let resolvedPrivateRoot = null;
  for (const [position, segment] of segments.entries()) {
    current = path.join(current, segment);
    await ensureDirectoryWithoutLinks(current);
    const resolvedCurrent = await realpath(current);
    if (position === 0) {
      if (!pathIsWithin(resolvedRoot, resolvedCurrent)) {
        fail('unsafe_private_path', 'The private-imports directory resolves outside the repository.');
      }
      resolvedPrivateRoot = resolvedCurrent;
    } else if (!pathIsWithin(resolvedPrivateRoot, resolvedCurrent, true)) {
      fail('unsafe_private_path', 'A recovery runner directory resolves outside private-imports.');
    }
  }
  return target;
}

async function assertPrivateFile(filename, repositoryRoot = REPOSITORY_ROOT) {
  const root = path.resolve(repositoryRoot);
  const privateRoot = path.join(root, PRIVATE_ROOT_NAME);
  const target = path.resolve(filename);
  if (!pathIsWithin(privateRoot, target)) {
    fail('unsafe_private_path', 'Recovery queue input must stay below this repository\'s private-imports directory.');
  }
  const relative = path.relative(privateRoot, target);
  const segments = [PRIVATE_ROOT_NAME, ...relative.split(path.sep).filter(Boolean)];
  let current = root;
  const resolvedRoot = await realpath(root);
  let resolvedPrivateRoot = null;
  for (const [position, segment] of segments.entries()) {
    current = path.join(current, segment);
    const status = await lstatIfPresent(current);
    if (!status || status.isSymbolicLink()
      || (position < segments.length - 1 ? !status.isDirectory() : !status.isFile())) {
      fail('unsafe_private_path', 'Recovery queue input is missing, linked, or not a regular private file.');
    }
    const resolvedCurrent = await realpath(current);
    if (position === 0) {
      if (!pathIsWithin(resolvedRoot, resolvedCurrent)) {
        fail('unsafe_private_path', 'The private-imports directory resolves outside the repository.');
      }
      resolvedPrivateRoot = resolvedCurrent;
    } else if (!pathIsWithin(resolvedPrivateRoot, resolvedCurrent, true)) {
      fail('unsafe_private_path', 'Recovery queue input resolves outside private-imports.');
    }
  }
  return target;
}

function canonicalProductUrl(value) {
  if (typeof value !== 'string' || clean(value, 2_000) !== value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'www.ecstuning.com'
      || url.username || url.password || url.port || url.search || url.hash
      || !PRODUCT_PATH.test(url.pathname) || url.toString() !== value) return null;
    return value;
  } catch {
    return null;
  }
}

function canonicalProductMediaUrl(value) {
  if (typeof value !== 'string' || clean(value, 2_000) !== value) return null;
  try {
    const url = new URL(value);
    const filename = path.posix.basename(url.pathname);
    if (url.protocol !== 'https:' || url.hostname !== 'assets.ecstuning.com'
      || url.username || url.password || url.port || url.search || url.hash
      || !PRODUCT_MEDIA_PATH.test(url.pathname) || GENERIC_MEDIA.test(filename)
      || url.toString() !== value) return null;
    return value;
  } catch {
    return null;
  }
}

function orderedCounts(items, field) {
  const counts = new Map();
  for (const item of items) counts.set(item[field], (counts.get(item[field]) || 0) + 1);
  return Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right, 'en')));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateQueueDocument(document, queueSha256, expectations) {
  const source = document?.sourceRelease;
  const policy = document?.policy;
  const counts = document?.counts;
  if (document?.schemaVersion !== SCHEMA_VERSION || document?.supplier !== SUPPLIER
    || document?.kind !== QUEUE_KIND || !source || !policy || !counts
    || !Array.isArray(document?.items) || !document.items.length
    || !SHA256.test(clean(document?.identitySetSha256, 100))
    || !SHA256.test(clean(document?.recordsSha256, 100))
    || !RELEASE_ID.test(clean(source?.releaseId, 100))
    || !SHA256.test(clean(source?.manifestSha256, 100))
    || !SHA256.test(clean(source?.contentSetSha256, 100))
    || !Number.isSafeInteger(source?.reviewedProductCount) || source.reviewedProductCount < 1
    || !Array.isArray(source?.includedSections) || !source.includedSections.length
    || policy.access !== 'public-product-detail-pages-only'
    || policy.media !== 'verified-supplier-media-only'
    || policy.noFabrication !== true || policy.noChallengeBypass !== true) {
    fail('invalid_queue', 'The BMW M3 media-recovery queue schema or policy is invalid.');
  }
  const identities = new Set();
  const urls = new Set();
  for (const [position, item] of document.items.entries()) {
    const identity = clean(item?.ecsPartNumber, 100).match(PRODUCT_NUMBER);
    const mpn = clean(item?.mpn, 200);
    const title = clean(item?.title, 500);
    const section = clean(item?.section, 80);
    const sectionKey = clean(item?.sectionKey, 80);
    const category = clean(item?.category, 300);
    const brand = item?.brand === null ? null : clean(item?.brand, 200);
    const url = canonicalProductUrl(item?.productUrl);
    if (!identity || item.ecsPartNumber !== `ES#${identity[1]}` || !mpn || item.mpn !== mpn
      || !title || item.title !== title || !section || item.section !== section
      || !sectionKey || item.sectionKey !== sectionKey || sectionKey !== section.toLocaleLowerCase('en-US')
      || !source.includedSections.includes(sectionKey) || !category || item.category !== category
      || !url || typeof item?.missingDescription !== 'boolean' || typeof item?.missingBrand !== 'boolean'
      || (item.missingBrand ? item.brand !== null : !brand || item.brand !== brand)
      || !SHARD_FILE.test(item?.sourceShard)
      || !Number.isSafeInteger(item?.sourceProductIndex) || item.sourceProductIndex < 0) {
      fail('invalid_queue', `Recovery queue item ${position + 1} is invalid.`);
    }
    if (identities.has(identity[1]) || urls.has(url)) {
      fail('duplicate_queue_identity', `Recovery queue item ${position + 1} duplicates an identity or URL.`);
    }
    identities.add(identity[1]);
    urls.add(url);
  }
  const ordered = [...document.items].sort((left, right) => left.sectionKey.localeCompare(right.sectionKey, 'en')
    || left.category.localeCompare(right.category, 'en')
    || Number(left.ecsPartNumber.slice(3)) - Number(right.ecsPartNumber.slice(3)));
  if (!sameJson(ordered, document.items)) fail('invalid_queue_order', 'Recovery queue items are not deterministic.');
  const identitySet = [...identities].map(value => `ES#${value}`).sort((left, right) => left.localeCompare(right, 'en'));
  const identitySetSha256 = sha256(Buffer.from(identitySet.join('\n'), 'utf8'));
  const recordsSha256 = sha256(compactJsonBuffer(document.items));
  const expectedCounts = {
    recoveryCandidateCount: document.items.length,
    missingDescriptionCount: document.items.filter(item => item.missingDescription).length,
    missingBrandCount: document.items.filter(item => item.missingBrand).length,
    bySection: orderedCounts(document.items, 'section'),
    byCategory: orderedCounts(document.items, 'category'),
  };
  if (identitySetSha256 !== document.identitySetSha256 || recordsSha256 !== document.recordsSha256
    || !sameJson(expectedCounts, counts)) {
    fail('queue_content_mismatch', 'Recovery queue counts or content checksums do not reconcile.');
  }
  if (expectations && (queueSha256 !== expectations.queueSha256
    || source.releaseId !== expectations.releaseId
    || counts.recoveryCandidateCount !== expectations.recoveryCandidateCount
    || identitySetSha256 !== expectations.identitySetSha256
    || recordsSha256 !== expectations.recordsSha256)) {
    fail('unexpected_queue', 'The recovery queue does not match the approved BMW M3 handoff.');
  }
  return document;
}

export async function loadBmwM3MediaRecoveryQueue(queuePath, {
  repositoryRoot = REPOSITORY_ROOT,
  expectations = CURRENT_QUEUE_EXPECTATIONS,
} = {}) {
  const filename = await assertPrivateFile(queuePath, repositoryRoot);
  const sidecar = await assertPrivateFile(`${filename}.sha256`, repositoryRoot);
  const buffer = await readFile(filename);
  const digest = sha256(buffer);
  const expectedSidecar = `${digest}  ${path.basename(filename)}\n`;
  if (await readFile(sidecar, 'utf8') !== expectedSidecar) {
    fail('queue_checksum_mismatch', 'The media-recovery queue checksum sidecar is invalid.');
  }
  let document;
  try {
    document = JSON.parse(buffer.toString('utf8'));
  } catch {
    fail('invalid_queue', 'The media-recovery queue is not valid JSON.');
  }
  return {
    filename,
    sidecar,
    sha256: digest,
    document: validateQueueDocument(document, digest, expectations),
  };
}

function integerOption(value, name, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail('invalid_options', `${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

function timestamp(now) {
  const date = new Date(typeof now === 'function' ? now() : now ?? Date.now());
  if (!Number.isFinite(date.getTime())) fail('invalid_options', 'Recovery runner time is invalid.');
  return date.toISOString();
}

async function writeTemporary(filename, buffer) {
  const temporary = `${filename}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`;
  const handle = await open(temporary, 'wx');
  try {
    await handle.writeFile(buffer);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return temporary;
}

async function writeCreateOnlyAtomic(filename, value) {
  const buffer = jsonBuffer(value);
  if (await lstatIfPresent(filename)) fail('checkpoint_exists', `Private artifact already exists: ${path.basename(filename)}.`);
  const temporary = await writeTemporary(filename, buffer);
  try {
    await link(temporary, filename);
  } catch (error) {
    if (error?.code === 'EEXIST') fail('checkpoint_exists', `Private artifact already exists: ${path.basename(filename)}.`);
    throw error;
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
  return { bytes: buffer.length, sha256: sha256(buffer) };
}

async function writeReplaceAtomic(filename, value) {
  const status = await lstatIfPresent(filename);
  if (status?.isSymbolicLink() || (status && !status.isFile())) {
    fail('unsafe_private_path', `Private progress path is linked or not a file: ${path.basename(filename)}.`);
  }
  const temporary = await writeTemporary(filename, jsonBuffer(value));
  try {
    await rename(temporary, filename);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

function checkpointFilename(directory, item) {
  const digits = item.ecsPartNumber.match(PRODUCT_NUMBER)[1];
  return path.join(directory, `es-${digits}.json`);
}

function makeCheckpoint(item, queue, page, observedAt) {
  const payload = {
    queue: {
      sha256: queue.sha256,
      identitySetSha256: queue.document.identitySetSha256,
      recordsSha256: queue.document.recordsSha256,
      releaseId: queue.document.sourceRelease.releaseId,
    },
    observedAt,
    identity: {
      ecsPartNumber: item.ecsPartNumber,
      mpn: item.mpn,
      productUrl: item.productUrl,
      title: item.title,
    },
    status: page.media.length ? 'media-recovered' : 'no-supplier-media-observed',
    media: page.media,
    recovered: {
      brand: item.missingBrand ? page.brand : null,
      description: item.missingDescription ? page.description : null,
    },
    evidence: {
      pageUrl: page.url,
      canonicalUrl: page.canonicalUrl,
    },
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    supplier: SUPPLIER,
    kind: CHECKPOINT_KIND,
    payload,
    payloadSha256: sha256(compactJsonBuffer(payload)),
  };
}

function validateCheckpoint(document, item, queue) {
  const payload = document?.payload;
  if (!hasExactKeys(document, CHECKPOINT_KEYS) || !hasExactKeys(payload, CHECKPOINT_PAYLOAD_KEYS)
    || !hasExactKeys(payload?.queue, CHECKPOINT_QUEUE_KEYS)
    || !hasExactKeys(payload?.identity, CHECKPOINT_IDENTITY_KEYS)
    || !hasExactKeys(payload?.recovered, CHECKPOINT_RECOVERED_KEYS)
    || !hasExactKeys(payload?.evidence, CHECKPOINT_EVIDENCE_KEYS)
    || document?.schemaVersion !== SCHEMA_VERSION || document?.supplier !== SUPPLIER
    || document?.kind !== CHECKPOINT_KIND || !payload
    || document?.payloadSha256 !== sha256(compactJsonBuffer(payload))
    || payload?.queue?.sha256 !== queue.sha256
    || payload?.queue?.identitySetSha256 !== queue.document.identitySetSha256
    || payload?.queue?.recordsSha256 !== queue.document.recordsSha256
    || payload?.queue?.releaseId !== queue.document.sourceRelease.releaseId
    || payload?.identity?.ecsPartNumber !== item.ecsPartNumber
    || payload?.identity?.mpn !== item.mpn || payload?.identity?.productUrl !== item.productUrl
    || payload?.identity?.title !== item.title
    || !['media-recovered', 'no-supplier-media-observed'].includes(payload?.status)
    || !Array.isArray(payload?.media)
    || canonicalProductUrl(payload?.evidence?.pageUrl) !== item.productUrl
    || canonicalProductUrl(payload?.evidence?.canonicalUrl) !== item.productUrl
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(payload?.observedAt || '')) {
    fail('invalid_checkpoint', `Checkpoint for ${item.ecsPartNumber} is invalid or belongs to another queue.`);
  }
  for (const media of payload.media) {
    if (!canonicalProductMediaUrl(media?.url) || !['primary', 'fallback'].includes(media?.role)
      || !MEDIA_EVIDENCE.has(media?.evidence)) {
      fail('invalid_checkpoint', `Checkpoint media for ${item.ecsPartNumber} is invalid.`);
    }
  }
  if ((payload.status === 'media-recovered') !== Boolean(payload.media.length)
    || (payload.recovered?.brand !== null && (!item.missingBrand || !clean(payload.recovered.brand, 200)))
    || (payload.recovered?.description !== null
      && (!item.missingDescription || !clean(payload.recovered.description, 20_000)))) {
    fail('invalid_checkpoint', `Checkpoint recovery fields for ${item.ecsPartNumber} are invalid.`);
  }
  return document;
}

async function readCheckpoints(directory, queue) {
  const itemsByDigits = new Map(queue.document.items.map(item => [item.ecsPartNumber.slice(3), item]));
  const checkpoints = new Map();
  for (const filename of (await readdir(directory)).sort()) {
    if (/\.tmp-\d+-[a-f0-9]{16}$/.test(filename)) continue;
    const match = filename.match(/^es-(\d{3,12})\.json$/);
    if (!match || !itemsByDigits.has(match[1])) {
      fail('invalid_checkpoint', `Unexpected private checkpoint file: ${filename}.`);
    }
    const status = await lstat(path.join(directory, filename));
    if (status.isSymbolicLink() || !status.isFile()) fail('invalid_checkpoint', `Unsafe checkpoint file: ${filename}.`);
    let document;
    try {
      document = JSON.parse(await readFile(path.join(directory, filename), 'utf8'));
    } catch {
      fail('invalid_checkpoint', `Checkpoint ${filename} is not valid JSON.`);
    }
    validateCheckpoint(document, itemsByDigits.get(match[1]), queue);
    checkpoints.set(match[1], document);
  }
  return checkpoints;
}

async function countQuarantine(directory) {
  const files = (await readdir(directory)).filter(filename => filename.endsWith('.json'));
  for (const filename of files) {
    const status = await lstat(path.join(directory, filename));
    if (!/^es-\d{3,12}-[a-z0-9_-]+\.json$/.test(filename)
      || status.isSymbolicLink() || !status.isFile()) {
      fail('invalid_quarantine', `Unexpected quarantine artifact: ${filename}.`);
    }
  }
  return files.length;
}

function safeDetails(error) {
  const result = {};
  const source = error?.details;
  if (source?.actualUrl) result.actualUrl = clean(source.actualUrl, 2_000);
  if (source?.mediaUrl) result.mediaUrl = clean(source.mediaUrl, 2_000);
  return result;
}

async function quarantineConflict(directory, item, queue, error) {
  const code = clean(error?.code, 80).toLocaleLowerCase('en-US').replace(/[^a-z0-9_-]+/g, '-') || 'conflict';
  const document = {
    schemaVersion: SCHEMA_VERSION,
    supplier: SUPPLIER,
    kind: QUARANTINE_KIND,
    queueSha256: queue.sha256,
    identitySetSha256: queue.document.identitySetSha256,
    identity: {
      ecsPartNumber: item.ecsPartNumber,
      mpn: item.mpn,
      productUrl: item.productUrl,
      title: item.title,
    },
    error: { code, message: clean(error?.message, 500), details: safeDetails(error) },
  };
  const filename = path.join(directory, `es-${item.ecsPartNumber.slice(3)}-${code}.json`);
  const existing = await lstatIfPresent(filename);
  if (existing) {
    if (existing.isSymbolicLink() || !existing.isFile()
      || !sameJson(JSON.parse(await readFile(filename, 'utf8')), document)) {
      fail('quarantine_conflict', `Conflicting quarantine evidence exists for ${item.ecsPartNumber}.`);
    }
    return filename;
  }
  await writeCreateOnlyAtomic(filename, document);
  return filename;
}

function normalizeRecoveredText(value, maximum) {
  if (value === null || value === undefined || value === '') return null;
  const result = clean(value, maximum + 1);
  if (result.length > maximum) {
    fail('adapter_contract_conflict', 'Authoritative product text exceeds the recovery field limit.', {
      quarantine: true,
    });
  }
  if (/<[!/?A-Za-z][^>]*>/.test(result)) {
    fail('adapter_contract_conflict', 'Authoritative product recovery fields must be plain text.', {
      quarantine: true,
    });
  }
  return result || null;
}

function validatePageEvidence(evidence, item) {
  if (!hasExactKeys(evidence, PAGE_EVIDENCE_KEYS)) {
    fail('adapter_contract_conflict', 'Product-page evidence contains unexpected or missing fields.', {
      quarantine: true,
    });
  }
  if (evidence.challenge === true || CHALLENGE_TITLE.test(clean(evidence.documentTitle, 300))) {
    fail('interactive_challenge', 'ECS presented an interactive access challenge; recovery stopped without bypass.');
  }
  const actualUrl = canonicalProductUrl(evidence.url);
  const canonicalUrl = canonicalProductUrl(evidence.canonicalUrl);
  if (actualUrl !== item.productUrl || canonicalUrl !== item.productUrl) {
    fail('canonical_page_conflict', `Browser page identity does not match ${item.ecsPartNumber}.`, {
      quarantine: true,
      details: { actualUrl: evidence.url },
    });
  }
  if (!hasExactKeys(evidence.product, PRODUCT_EVIDENCE_KEYS)) {
    fail('adapter_contract_conflict', 'Product identity evidence is incomplete.', { quarantine: true });
  }
  const ecsPartNumber = clean(evidence.product.ecsPartNumber, 200);
  const mpn = clean(evidence.product.mpn, 1_000);
  const title = clean(evidence.product.title, 2_000);
  if (ecsPartNumber !== item.ecsPartNumber || mpn !== item.mpn || title !== item.title) {
    fail('product_identity_conflict', `Authoritative page fields conflict with ${item.ecsPartNumber}.`, {
      quarantine: true,
      details: { actualUrl },
    });
  }
  if (!Array.isArray(evidence.media)) {
    fail('adapter_contract_conflict', 'Product media evidence is not an array.', { quarantine: true });
  }
  const media = [];
  const roles = new Set();
  const urls = new Set();
  for (const observation of evidence.media) {
    if (!hasExactKeys(observation, MEDIA_EVIDENCE_KEYS)
      || !['primary', 'fallback'].includes(observation?.role)
      || !MEDIA_EVIDENCE.has(observation?.evidence)) {
      fail('product_media_conflict', `Product media evidence for ${item.ecsPartNumber} is invalid.`, {
        quarantine: true,
        details: { mediaUrl: observation?.url },
      });
    }
    const url = canonicalProductMediaUrl(observation.url);
    if (!url) {
      fail('product_media_conflict', `Product media for ${item.ecsPartNumber} is foreign, generic or non-canonical.`, {
        quarantine: true,
        details: { mediaUrl: observation.url },
      });
    }
    if (roles.has(observation.role)) {
      fail('product_media_conflict', `Product media for ${item.ecsPartNumber} has conflicting ${observation.role} evidence.`, {
        quarantine: true,
        details: { mediaUrl: url },
      });
    }
    if (urls.has(url)) continue;
    roles.add(observation.role);
    urls.add(url);
    media.push({ url, role: observation.role, evidence: observation.evidence });
  }
  media.sort((left, right) => ['primary', 'fallback'].indexOf(left.role)
    - ['primary', 'fallback'].indexOf(right.role));
  return {
    url: actualUrl,
    canonicalUrl,
    media,
    brand: normalizeRecoveredText(evidence.product.brand, 200),
    description: normalizeRecoveredText(evidence.product.description, 20_000),
  };
}

function progressReport(queue, checkpoints, {
  status,
  attemptedThisRun,
  resumedCount,
  quarantineCount,
  updatedAt,
  stoppedAt = null,
  stoppedCode = null,
} = {}) {
  const values = [...checkpoints.values()].map(checkpoint => checkpoint.payload);
  return {
    schemaVersion: SCHEMA_VERSION,
    supplier: SUPPLIER,
    kind: PROGRESS_KIND,
    queue: {
      sha256: queue.sha256,
      releaseId: queue.document.sourceRelease.releaseId,
      recoveryCandidateCount: queue.document.counts.recoveryCandidateCount,
      identitySetSha256: queue.document.identitySetSha256,
      recordsSha256: queue.document.recordsSha256,
    },
    status,
    counts: {
      completed: checkpoints.size,
      remaining: queue.document.items.length - checkpoints.size,
      mediaRecovered: values.filter(value => value.status === 'media-recovered').length,
      noSupplierMediaObserved: values.filter(value => value.status === 'no-supplier-media-observed').length,
      descriptionsRecovered: values.filter(value => value.recovered.description).length,
      brandsRecovered: values.filter(value => value.recovered.brand).length,
      quarantined: quarantineCount,
      attemptedThisRun,
      resumedAtStart: resumedCount,
    },
    stoppedAt,
    stoppedCode,
    updatedAt,
  };
}

export async function runBmwM3MediaRecoveryBrowser(adapter, {
  queuePath = path.join(REPOSITORY_ROOT,
    'private-imports/ecs-bmw-m3-20260809/media-recovery-queue.json'),
  outputDir = path.join(REPOSITORY_ROOT,
    'private-imports/ecs-bmw-m3-20260809/media-recovery-browser'),
  pageBudget = 10,
  navigationDelayMs = 4_000,
  now = () => new Date(),
  repositoryRoot = REPOSITORY_ROOT,
  expectations = CURRENT_QUEUE_EXPECTATIONS,
} = {}) {
  if (!adapter || !['getCurrentUrl', 'goto', 'wait', 'getProductPageEvidence']
    .every(name => typeof adapter[name] === 'function')) {
    fail('invalid_adapter', 'An injected BMW M3 product-page browser adapter is required.');
  }
  const budget = integerOption(pageBudget, 'pageBudget', 1, 50);
  const navigationDelay = integerOption(navigationDelayMs, 'navigationDelayMs', 0, 60_000);
  const queue = await loadBmwM3MediaRecoveryQueue(queuePath, { repositoryRoot, expectations });
  const output = await ensurePrivateDirectory(outputDir, repositoryRoot);
  const checkpointsDirectory = await ensurePrivateDirectory(path.join(output, 'checkpoints'), repositoryRoot);
  const quarantineDirectory = await ensurePrivateDirectory(path.join(output, 'quarantine'), repositoryRoot);
  const progressPath = path.join(output, 'progress.json');
  const checkpoints = await readCheckpoints(checkpointsDirectory, queue);
  let quarantineCount = await countQuarantine(quarantineDirectory);
  if (quarantineCount) {
    fail('existing_quarantine', 'Recovery runner has unresolved quarantined evidence; review it before resuming.');
  }
  const resumedCount = checkpoints.size;
  let attemptedThisRun = 0;

  for (const item of queue.document.items) {
    const digits = item.ecsPartNumber.slice(3);
    if (checkpoints.has(digits)) continue;
    if (attemptedThisRun >= budget) break;
    attemptedThisRun += 1;
    try {
      const current = canonicalProductUrl(await adapter.getCurrentUrl());
      if (current !== item.productUrl) await adapter.goto(item.productUrl);
      if (navigationDelay) await adapter.wait(navigationDelay);
      const evidence = await adapter.getProductPageEvidence();
      let page;
      try {
        page = validatePageEvidence(evidence, item);
      } catch (error) {
        if (error?.code === 'interactive_challenge') {
          const report = progressReport(queue, checkpoints, {
            status: 'challenge-stopped', attemptedThisRun, resumedCount, quarantineCount,
            updatedAt: timestamp(now), stoppedAt: item.ecsPartNumber, stoppedCode: error.code,
          });
          await writeReplaceAtomic(progressPath, report);
          return { ...report, outputDir: output, progressPath };
        }
        throw error;
      }
      const checkpoint = makeCheckpoint(item, queue, page, timestamp(now));
      await writeCreateOnlyAtomic(checkpointFilename(checkpointsDirectory, item), checkpoint);
      checkpoints.set(digits, checkpoint);
      await writeReplaceAtomic(progressPath, progressReport(queue, checkpoints, {
        status: checkpoints.size === queue.document.items.length ? 'complete' : 'in-progress',
        attemptedThisRun, resumedCount, quarantineCount, updatedAt: timestamp(now),
      }));
    } catch (error) {
      if (error?.quarantine) {
        await quarantineConflict(quarantineDirectory, item, queue, error);
        quarantineCount += 1;
      }
      await writeReplaceAtomic(progressPath, progressReport(queue, checkpoints, {
        status: error?.quarantine ? 'conflict-stopped' : 'error-stopped',
        attemptedThisRun, resumedCount, quarantineCount, updatedAt: timestamp(now),
        stoppedAt: item.ecsPartNumber, stoppedCode: clean(error?.code || 'adapter_error', 80),
      }));
      throw error;
    }
  }
  const status = checkpoints.size === queue.document.items.length ? 'complete' : 'budget-exhausted';
  const report = progressReport(queue, checkpoints, {
    status, attemptedThisRun, resumedCount, quarantineCount, updatedAt: timestamp(now),
  });
  await writeReplaceAtomic(progressPath, report);
  return { ...report, outputDir: output, progressPath };
}

export function createCodexTabBmwM3MediaRecoveryAdapter(tab) {
  if (!tab?.playwright || typeof tab.url !== 'function' || typeof tab.goto !== 'function') {
    fail('invalid_adapter', 'A Codex browser tab with Playwright is required.');
  }
  return Object.freeze({
    async getCurrentUrl() { return tab.url(); },
    async goto(url) { await tab.goto(url); },
    async wait(milliseconds) { await tab.playwright.waitForTimeout(milliseconds); },
    async getProductPageEvidence() {
      const browserUrl = await tab.url();
      const evidence = await tab.playwright.evaluate(() => {
        const text = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
        const plainText = (value) => {
          if (value === null || value === undefined) return '';
          const template = document.createElement('template');
          template.innerHTML = String(value);
          return text(template.content.textContent);
        };
        const firstText = (selectors) => {
          for (const selector of selectors) {
            const element = document.querySelector(selector);
            const value = text(element?.content || element?.textContent);
            if (value) return value;
          }
          return null;
        };
        const products = [];
        for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
          try {
            const parsed = JSON.parse(script.textContent || 'null');
            const visit = (value) => {
              if (!value || typeof value !== 'object') return;
              if (Array.isArray(value)) return value.forEach(visit);
              const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
              if (types.includes('Product')) products.push(value);
              if (value['@graph']) visit(value['@graph']);
            };
            visit(parsed);
          } catch {
            // Invalid unrelated structured-data blocks are ignored; identity still must be explicit below.
          }
        }
        const product = products[0] || {};
        const brandValue = typeof product.brand === 'string' ? product.brand : product.brand?.name;
        const skuText = text(product.sku) || firstText([
          '[itemprop="sku"]', '[data-ecs-part-number]', '.ecs-part-number', '.product-code'
        ]);
        const ecsMatch = text(skuText).match(/\bES#\s*(\d{3,12})\b/i);
        const mpn = text(product.mpn) || firstText([
          '[itemprop="mpn"]', '[data-mpn]', '.manufacturer-part-number', '.product-mpn'
        ]);
        const title = firstText(['h1[itemprop="name"]', 'h1.product-title', 'main h1']) || text(product.name);
        const gallery = document.querySelector([
          '[data-product-gallery]', '.product-gallery', '.product-image-gallery',
          '.product-detail-image', '.productImage', '#product-image'
        ].join(','));
        const observations = [];
        const add = (url, role, source) => {
          const value = text(url).split(',')[0].trim().split(/\s+/)[0];
          if (value) observations.push({ url: value, role, evidence: source });
        };
        const picture = gallery?.querySelector('picture');
        const source = picture?.querySelector('source[srcset]');
        const image = picture?.querySelector('img[src], img[srcset]') || gallery?.querySelector('img[src], img[srcset]');
        if (source) add(source.srcset, 'primary', 'product-gallery-source');
        if (image) add(image.currentSrc || image.src || image.srcset,
          source ? 'fallback' : 'primary', 'product-gallery-image');
        if (!observations.length) {
          const imageValue = Array.isArray(product.image) ? product.image[0]
            : (typeof product.image === 'object' ? product.image?.url : product.image);
          add(imageValue, 'primary', 'product-jsonld-image');
        }
        const body = text(document.body?.innerText).slice(0, 2_000);
        return {
          url: location.href,
          canonicalUrl: document.querySelector('link[rel="canonical"]')?.href || null,
          documentTitle: document.title,
          challenge: /^(?:just a moment|attention required|access denied)/i.test(document.title)
            || /(?:verify you are human|performing security verification|cloudflare ray id)/i.test(body),
          product: {
            ecsPartNumber: ecsMatch ? `ES#${ecsMatch[1]}` : null,
            mpn: mpn || null,
            title: title || null,
            brand: text(brandValue) || firstText(['[itemprop="brand"]', '.product-brand']),
            description: firstText(['[itemprop="description"]', '.product-description'])
              || plainText(product.description) || null,
          },
          media: observations,
        };
      }, undefined, { timeoutMs: 15_000 });
      if (evidence?.url !== browserUrl) {
        return { ...evidence, url: browserUrl, canonicalUrl: evidence?.canonicalUrl };
      }
      return evidence;
    },
  });
}

function parseArguments(args) {
  const options = { verifyOnly: false };
  const values = new Set(['--queue', '--output-dir', '--page-budget']);
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === '--verify-only') {
      if (options.verifyOnly) fail('invalid_arguments', 'Duplicate --verify-only option.');
      options.verifyOnly = true;
      continue;
    }
    if (name === '--help') return { help: true };
    if (!values.has(name) || !args[index + 1] || args[index + 1].startsWith('--')) {
      fail('invalid_arguments', `Unknown or incomplete argument: ${name || '(empty)'}.`);
    }
    const key = name === '--queue' ? 'queuePath' : name === '--output-dir' ? 'outputDir' : 'pageBudget';
    if (Object.hasOwn(options, key)) fail('invalid_arguments', `Duplicate option: ${name}.`);
    options[key] = args[index + 1];
    index += 1;
  }
  return options;
}

function usage() {
  return [
    'Offline verification only:',
    '  run-bmw-m3-media-recovery.mjs --verify-only [--queue <private JSON>] [--output-dir <private directory>] [--page-budget <1-50>]',
    '',
    'Live product-page work requires an explicitly injected browser tab through',
    'runBmwM3MediaRecoveryBrowser(createCodexTabBmwM3MediaRecoveryAdapter(tab), options).',
    'This command never starts a browser or network client.',
  ].join('\n');
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args.verifyOnly) fail('injected_adapter_required', usage());
  const queuePath = args.queuePath || path.join(REPOSITORY_ROOT,
    'private-imports/ecs-bmw-m3-20260809/media-recovery-queue.json');
  const queue = await loadBmwM3MediaRecoveryQueue(queuePath);
  if (args.outputDir) {
    const privateRoot = path.join(REPOSITORY_ROOT, PRIVATE_ROOT_NAME);
    if (!pathIsWithin(privateRoot, path.resolve(args.outputDir))) {
      fail('unsafe_private_path', 'Recovery runner output must stay below private-imports.');
    }
  }
  if (args.pageBudget !== undefined) integerOption(args.pageBudget, 'pageBudget', 1, 50);
  process.stdout.write(`${JSON.stringify({
    verified: true,
    queue: queue.filename,
    queueSha256: queue.sha256,
    releaseId: queue.document.sourceRelease.releaseId,
    recoveryCandidateCount: queue.document.counts.recoveryCandidateCount,
    identitySetSha256: queue.document.identitySetSha256,
    recordsSha256: queue.document.recordsSha256,
    browserStarted: false,
    networkAccessed: false,
  }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error?.code || 'media_recovery_error'}: ${error?.message || error}\n`);
    process.exitCode = 1;
  });
}

export const __test = Object.freeze({
  canonicalProductUrl,
  canonicalProductMediaUrl,
  validatePageEvidence,
  validateQueueDocument,
  makeCheckpoint,
  validateCheckpoint,
  CURRENT_QUEUE_EXPECTATIONS,
});
