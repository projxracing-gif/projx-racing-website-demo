import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import {
  validTegiwaManifestSecret,
  verifyTegiwaPublicManifestSignature
} from '../server/tegiwa-public-manifest.js';
import { tegiwaSkuMappingFingerprint } from '../server/tegiwa-sku-mapping.js';

const OFFICIAL_ORIGIN = 'https://www.tegiwa.com';
const PAGE_SIZE = 100;
const SEARCH_SUGGESTION_LIMIT = 8;
const MAX_QUERY_TOKENS = 20;
const MAX_PREFIX_TERMS_PER_TOKEN = 4_096;
const MAX_SEARCH_CARD_SHARDS = 100;
const SEARCH_METADATA_RECORD_BYTES = 16;
const SEARCH_PAIR_RECORD_BYTES = 16;
const SEARCH_RATE_LIMIT = 120;
const SEARCH_RATE_WINDOW_MS = 60_000;
const SEARCH_RATE_BUCKETS = 512;
const MAX_SITEMAPS = 512;
const MAX_SITEMAP_PRODUCTS = 50_000;
const MAX_PRODUCT_HANDLE_LENGTH = 255;
const MAX_CATALOG_SHARDS_PER_REQUEST = 8;
const MAX_CACHED_CATALOG_SHARDS = 4;
const MAX_DETAIL_IMAGES = 16;
const MAX_DETAIL_VARIANTS = 2_048;
const MAX_PART_NUMBER_LENGTH = 120;
const MAX_PART_NUMBERS_PER_PRODUCT = MAX_DETAIL_VARIANTS * 2 + 1;
const MAX_STOCK_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const DEFAULT_TIMEOUT_MS = 7_000;
const JSON_RESPONSE_BYTES = 2_000_000;
const CACHE_CONTROL = 'public, max-age=60, s-maxage=300, stale-while-revalidate=300';
const REMOTE_STOCK_MANIFEST_BYTES = 64 * 1_024;
const REMOTE_STOCK_ARTIFACT_BYTES = 20_000_000;
const REMOTE_STOCK_TIMEOUT_MS = 10_000;
const REMOTE_STOCK_CACHE_TTL_MS = 5 * 60 * 1_000;
const REMOTE_STOCK_FAILURE_TTL_MS = 30 * 1_000;
const REMOTE_STOCK_STALE_IF_ERROR_MS = 24 * 60 * 60 * 1_000;
const REMOTE_STOCK_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const REMOTE_STOCK_MAX_PUBLISH_DELAY_MS = 2 * 60 * 60 * 1_000;
const REMOTE_STOCK_MAX_VALIDITY_MS = 24 * 60 * 60 * 1_000;
const STOCK_INDEX_URL = new URL('./data/tegiwa-stock-index.json', import.meta.url);
const SITEMAP_MANIFEST_URL = new URL('./data/tegiwa-sitemap-manifest.json', import.meta.url);
const CATALOG_SUMMARY_URL = new URL('./data/tegiwa-catalog-summary.json', import.meta.url);
const CATALOG_SHARD_DIRECTORY_URL = new URL('./data/tegiwa-catalog-pages/', import.meta.url);
const SEARCH_SUMMARY_URL = new URL('./data/tegiwa-search-summary.json', import.meta.url);
const SEARCH_TERMS_URL = new URL('./data/tegiwa-search-terms.json', import.meta.url);
const SEARCH_TERM_POSTINGS_URL = new URL('./data/tegiwa-search-term-postings.bin', import.meta.url);
const SEARCH_PAIRS_URL = new URL('./data/tegiwa-search-pairs.bin', import.meta.url);
const SEARCH_PAIR_POSTINGS_URL = new URL('./data/tegiwa-search-pair-postings.bin', import.meta.url);
const SEARCH_METADATA_URL = new URL('./data/tegiwa-search-metadata.bin', import.meta.url);

const SEARCH_SORTS = new Set(['relevance', 'name_asc', 'name_desc', 'price_asc', 'price_desc']);
const SEARCH_AVAILABILITY_FILTERS = new Set(['all', 'available', 'in_stock', 'supplier_stock', 'check', 'unavailable']);
const SEARCH_PRICING_FILTERS = new Set(['all', 'priced', 'request_price']);
const SEARCH_MATCHES = new Set(['any', 'vehicle']);

const STATUS_CODES = Object.freeze({
  0: 'out_of_stock',
  1: 'in_stock',
  2: 'supplier_stock',
  3: 'check_availability',
  o: 'out_of_stock',
  i: 'in_stock',
  s: 'supplier_stock',
  c: 'check_availability',
  out_of_stock: 'out_of_stock',
  in_stock: 'in_stock',
  supplier_stock: 'supplier_stock',
  check_availability: 'check_availability'
});

class PublicApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'PublicApiError';
    this.status = status;
    this.code = code;
  }
}

class UpstreamError extends Error {
  constructor(code = 'upstream_unavailable', upstreamStatus = 0) {
    super(code);
    this.name = 'UpstreamError';
    this.code = code;
    this.upstreamStatus = upstreamStatus;
  }
}

function decodeEntities(value) {
  const named = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"'
  };
  return String(value ?? '').replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi, (match, entity) => {
    const lowered = entity.toLowerCase();
    if (lowered[0] !== '#') return named[lowered] ?? '';
    const hexadecimal = lowered.startsWith('#x');
    const codePoint = Number.parseInt(lowered.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return '';
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return '';
    }
  });
}

function safeText(value, limit = 300) {
  return decodeEntities(String(value ?? '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<[^>]*>/g, ' '))
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function safePartNumber(value) {
  const text = safeText(value, MAX_PART_NUMBER_LENGTH + 1).normalize('NFKC').trim();
  if (!text || text.length > MAX_PART_NUMBER_LENGTH || !/[\p{L}\p{N}]/u.test(text)) return null;
  if (/^(?:data|file|ftp|https?|javascript|vbscript):/i.test(text) || /[<>`{}]/.test(text)) return null;
  return text;
}

function safePartNumberList(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const partNumbers = [];
  for (const value of values) {
    const partNumber = safePartNumber(value);
    if (!partNumber) continue;
    const identity = partNumber.toLocaleLowerCase('en-US');
    if (seen.has(identity)) continue;
    seen.add(identity);
    partNumbers.push(partNumber);
    if (partNumbers.length > MAX_PART_NUMBERS_PER_PRODUCT) return [];
  }
  return partNumbers;
}

function mergePartNumbers(...lists) {
  const merged = [];
  for (const list of lists) {
    if (Array.isArray(list)) merged.push(...list);
  }
  return safePartNumberList(merged);
}

export function normalizeTitleForStock(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-US');
}

export function stockKeyForTitle(value) {
  const normalized = normalizeTitleForStock(value);
  return normalized ? createHash('sha256').update(normalized, 'utf8').digest('base64url').slice(0, 16) : '';
}

function safeInteger(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : null;
}

function safeDimension(value) {
  return safeInteger(value, 1, 20_000);
}

function safeCheckedAt(value) {
  const text = safeText(value, 40);
  if (!text || Number.isNaN(Date.parse(text))) return null;
  return text;
}

function emptyStockIndex() {
  return {
    priceBasis: null,
    checkedAt: null,
    productCount: 0,
    skuProductCount: 0,
    availableProductCount: 0,
    leadTimes: [],
    products: Object.create(null)
  };
}

function validateStockIndex(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || ![1, 2].includes(candidate.version)) return emptyStockIndex();
  const products = candidate.products && typeof candidate.products === 'object' && !Array.isArray(candidate.products)
    ? candidate.products
    : Object.create(null);
  return {
    version: candidate.version,
    priceBasis: candidate.priceBasis === 'gbp_ex_uk_vat' ? candidate.priceBasis : null,
    checkedAt: safeCheckedAt(candidate.checkedAt),
    productCount: safeInteger(candidate.productCount, 0, 10_000_000) ?? 0,
    skuProductCount: candidate.version === 2
      ? (safeInteger(candidate.skuProductCount, 0, 10_000_000) ?? 0)
      : 0,
    availableProductCount: safeInteger(candidate.availableProductCount, 0, 10_000_000) ?? 0,
    leadTimes: Array.isArray(candidate.leadTimes)
      ? candidate.leadTimes.slice(0, 256).map(value => safeText(value, 120))
      : [],
    products
  };
}

let defaultStockIndex;
function loadDefaultStockIndex() {
  if (defaultStockIndex) return defaultStockIndex;
  try {
    defaultStockIndex = validateStockIndex(JSON.parse(readFileSync(STOCK_INDEX_URL, 'utf8')));
    if (!defaultStockIndex.checkedAt || defaultStockIndex.productCount < 1 || defaultStockIndex.priceBasis !== 'gbp_ex_uk_vat') {
      throw new Error('empty_or_unsafe_stock_index');
    }
  } catch (error) {
    throw new Error('The public Tegiwa stock index could not be loaded.', { cause: error });
  }
  return defaultStockIndex;
}

function validateSitemapManifest(candidate) {
  if (!candidate || typeof candidate !== 'object' || candidate.version !== 1 || !Array.isArray(candidate.sitemaps)) {
    throw new Error('invalid_sitemap_manifest');
  }
  const sitemaps = candidate.sitemaps.map(productSitemapUrl);
  if (!sitemaps.length || sitemaps.length > MAX_SITEMAPS || sitemaps.some(value => !value) || new Set(sitemaps).size !== sitemaps.length) {
    throw new Error('invalid_sitemap_manifest');
  }
  return sitemaps;
}

let defaultSitemapManifest;
function loadDefaultSitemapManifest() {
  if (defaultSitemapManifest) return defaultSitemapManifest;
  try {
    defaultSitemapManifest = validateSitemapManifest(JSON.parse(readFileSync(SITEMAP_MANIFEST_URL, 'utf8')));
  } catch (error) {
    throw new Error('The public Tegiwa sitemap manifest could not be loaded.', { cause: error });
  }
  return defaultSitemapManifest;
}

function validateCatalogSummary(candidate) {
  const productCount = safeInteger(candidate?.productCount, 1, 10_000_000);
  const shardCount = safeInteger(candidate?.shardCount, 1, MAX_SITEMAPS);
  const shardProductCounts = Array.isArray(candidate?.shardProductCounts)
    ? candidate.shardProductCounts.map(value => safeInteger(value, 1, MAX_SITEMAP_PRODUCTS))
    : null;
  if (!candidate || candidate.version !== 1 || productCount === null || shardCount === null
    || !shardProductCounts || shardProductCounts.length !== shardCount
    || shardProductCounts.some(value => value === null)
    || shardProductCounts.reduce((total, value) => total + value, 0) !== productCount) {
    throw new Error('invalid_catalog_summary');
  }
  return { productCount, shardProductCounts };
}

let defaultCatalogSummary;
function loadDefaultCatalogSummary() {
  if (defaultCatalogSummary) return defaultCatalogSummary;
  try {
    defaultCatalogSummary = validateCatalogSummary(JSON.parse(readFileSync(CATALOG_SUMMARY_URL, 'utf8')));
  } catch (error) {
    throw new Error('The public Tegiwa catalog summary could not be loaded.', { cause: error });
  }
  return defaultCatalogSummary;
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function searchTokens(value) {
  return normalizeSearchText(value).split(' ').filter(Boolean);
}

function normalizedPartNumberIdentity(value) {
  const partNumber = safePartNumber(value);
  return partNumber ? partNumber.toLocaleLowerCase('en-US') : '';
}

function exactPartNumberSearch(value) {
  const partNumber = safePartNumber(value);
  if (!partNumber) return null;
  const identity = normalizedPartNumberIdentity(partNumber);
  return {
    partNumber,
    identity,
    term: `projxsku${createHash('sha256').update(identity, 'utf8').digest('hex')}`
  };
}

// The supplier catalogue is English-only, while the storefront is bilingual.
// Keep this list deliberately limited to common automotive terms used by
// customers in Kuwait; it changes only the search query, never product data.
const LOCALIZED_SEARCH_ALIASES = new Map([
  ['فرامل', ['brake']], ['مكابح', ['brake']], ['بريك', ['brake']],
  ['فحمات', ['brake', 'pads']], ['دسكات', ['brake', 'discs']], ['هوبات', ['brake', 'discs']],
  ['تعليق', ['suspension']], ['سسبنشن', ['suspension']], ['مساعدات', ['shock', 'absorbers']],
  ['يايات', ['springs']], ['كويلوفر', ['coilovers']], ['كويلوفرز', ['coilovers']],
  ['سحب', ['intake']], ['انتيك', ['intake']], ['فلتر', ['filter']], ['فلاتر', ['filters']],
  ['عادم', ['exhaust']], ['اكزوز', ['exhaust']], ['هدرز', ['headers']], ['مانيفولد', ['manifold']],
  ['محرك', ['engine']], ['مكينة', ['engine']], ['مكينه', ['engine']],
  ['قير', ['transmission']], ['جير', ['transmission']], ['ناقل', ['transmission']],
  ['كلتش', ['clutch']], ['دفرنس', ['differential']], ['درايفشافت', ['driveshaft']],
  ['تبريد', ['cooling']], ['رديتر', ['radiator']], ['راديتر', ['radiator']],
  ['انتركولر', ['intercooler']], ['ثرموستات', ['thermostat']], ['خراطيم', ['hoses']],
  ['زيت', ['oil']], ['وقود', ['fuel']], ['بنزين', ['fuel']], ['بترول', ['fuel']],
  ['بخاخ', ['injector']], ['بخاخات', ['injectors']], ['طرمبة', ['pump']], ['طلمبة', ['pump']],
  ['تيربو', ['turbo']], ['توربو', ['turbo']], ['سوبرتشارجر', ['supercharger']],
  ['برمجة', ['tuning']], ['كمبيوتر', ['ecu']], ['حساس', ['sensor']], ['حساسات', ['sensors']],
  ['عداد', ['gauge']], ['عدادات', ['gauges']], ['داتا', ['data']], ['لوقر', ['logger']],
  ['جنوط', ['wheels']], ['رنجات', ['wheels']], ['كفرات', ['tyres']], ['تواير', ['tyres']],
  ['اطارات', ['tyres']], ['إطارات', ['tyres']], ['بواجي', ['spark', 'plugs']], ['كويلات', ['coilpacks']],
  ['كام', ['camshaft']], ['كامات', ['camshafts']], ['كرنك', ['crankshaft']],
  ['بستم', ['piston']], ['بساتم', ['pistons']], ['رودات', ['rods']], ['جوانات', ['gaskets']],
  ['مسامير', ['bolts']], ['رولكيج', ['roll', 'cage']], ['خوذة', ['helmet']], ['خوذ', ['helmets']],
  ['مقاعد', ['seats']], ['احزمة', ['harnesses']], ['أحزمة', ['harnesses']],
  ['جناح', ['wing']], ['سبويلر', ['spoiler']], ['ايرو', ['aero']],
  ['حلبة', ['motorsport']], ['سباق', ['racing']], ['درفت', ['drift']], ['دريفت', ['drift']],
  ['صيانة', ['service']], ['سيرفس', ['service']], ['طقم', ['kit']], ['كت', ['kit']]
].map(([source, targets]) => [normalizeSearchText(source), targets]));

const LOCALIZED_SEARCH_STOP_WORDS = new Set([
  'قطع', 'قطعة', 'غيار', 'سيارة', 'سيارات', 'للسيارة', 'للسيارات', 'حق', 'مال'
].map(normalizeSearchText));

function localizedSearchTokens(tokens) {
  const expanded = [];
  const corrections = [];
  for (const token of tokens) {
    if (LOCALIZED_SEARCH_STOP_WORDS.has(token)) continue;
    const alias = LOCALIZED_SEARCH_ALIASES.get(token);
    if (!alias) {
      expanded.push(token);
      continue;
    }
    expanded.push(...alias);
    corrections.push({ from: token, to: alias.join(' ') });
  }
  return { tokens: [...new Set(expanded)], corrections };
}

function fnv1a64(value) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of Buffer.from(value, 'utf8')) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash;
}

function validatePostingIds(ids, productCount) {
  if (!Array.isArray(ids)) throw new Error('invalid_search_index');
  let previous = -1;
  return ids.map(value => {
    const documentId = safeInteger(value, 0, productCount - 1);
    if (documentId === null || documentId <= previous) throw new Error('invalid_search_index');
    previous = documentId;
    return documentId;
  });
}

function injectedSearchProvider(candidate) {
  const productCount = safeInteger(candidate?.productCount, 1, 10_000_000);
  if (!candidate || candidate.version !== 1 || productCount === null
    || !candidate.terms || typeof candidate.terms !== 'object' || Array.isArray(candidate.terms)
    || !candidate.pairs || typeof candidate.pairs !== 'object' || Array.isArray(candidate.pairs)
    || !Array.isArray(candidate.nameRanks) || candidate.nameRanks.length !== productCount
    || !Array.isArray(candidate.stockKeys) || candidate.stockKeys.length !== productCount) {
    throw new Error('invalid_search_index');
  }
  const terms = new Map();
  for (const [term, ids] of Object.entries(candidate.terms)) {
    if (!term || term !== normalizeSearchText(term) || term.includes(' ')) throw new Error('invalid_search_index');
    terms.set(term, validatePostingIds(ids, productCount));
  }
  const pairs = new Map();
  for (const [pair, ids] of Object.entries(candidate.pairs)) {
    if (!/^.+\u0001.+$/u.test(pair)) throw new Error('invalid_search_index');
    pairs.set(fnv1a64(pair), validatePostingIds(ids, productCount));
  }
  const vocabulary = [...terms.keys()].sort();
  const metadata = candidate.nameRanks.map((nameRank, documentId) => {
    const rank = safeInteger(nameRank, 0, productCount - 1);
    const stockKey = String(candidate.stockKeys[documentId] || '');
    if (rank === null || !/^[A-Za-z0-9_-]{16}$/.test(stockKey)) throw new Error('invalid_search_index');
    return { nameRank: rank, stockKey };
  });
  if (new Set(metadata.map(value => value.nameRank)).size !== productCount) throw new Error('invalid_search_index');
  return {
    productCount,
    vocabulary,
    termCount(term) { return terms.get(term)?.length || 0; },
    termPostings(term) { return terms.get(term) || []; },
    pairPostings(left, right) { return pairs.get(fnv1a64(`${left}\u0001${right}`)) || []; },
    metadata(documentId) { return metadata[documentId]; }
  };
}

function validateSearchSummary(candidate) {
  const productCount = safeInteger(candidate?.productCount, 1, 10_000_000);
  const termCount = safeInteger(candidate?.termCount, 1, 1_000_000);
  const termPostingCount = safeInteger(candidate?.termPostingCount, 1, 100_000_000);
  const pairCount = safeInteger(candidate?.pairCount, 1, 10_000_000);
  const pairPostingCount = safeInteger(candidate?.pairPostingCount, 1, 100_000_000);
  const skuMappingSha256 = String(candidate?.skuMappingSha256 || '');
  const files = candidate?.files;
  if (!candidate || candidate.version !== 2 || candidate.pageSize !== PAGE_SIZE
    || candidate.metadataRecordBytes !== SEARCH_METADATA_RECORD_BYTES
    || candidate.pairRecordBytes !== SEARCH_PAIR_RECORD_BYTES
    || [productCount, termCount, termPostingCount, pairCount, pairPostingCount].some(value => value === null)
    || !/^[a-f0-9]{64}$/.test(skuMappingSha256)
    || !files || typeof files !== 'object') throw new Error('invalid_search_summary');
  const file = name => {
    const value = files[name];
    const bytes = safeInteger(value?.bytes, 1, 250_000_000);
    if (!value || typeof value.name !== 'string' || bytes === null || !/^[a-f0-9]{64}$/.test(value.sha256 || '')) {
      throw new Error('invalid_search_summary');
    }
    return { ...value, bytes };
  };
  return {
    productCount, termCount, termPostingCount, pairCount, pairPostingCount, skuMappingSha256,
    files: {
      terms: file('terms'), termPostings: file('termPostings'), pairs: file('pairs'),
      pairPostings: file('pairPostings'), metadata: file('metadata')
    }
  };
}

export function assertSkuSearchIndexFresh(expectedFingerprint, stockIndexSource) {
  if (!/^[a-f0-9]{64}$/.test(String(expectedFingerprint || ''))) throw new Error('invalid_search_sku_fingerprint');
  const actual = tegiwaSkuMappingFingerprint(stockIndexSource);
  if (actual !== expectedFingerprint) throw new Error('stale_search_sku_index');
  return true;
}

function publicHttpsUrl(value, sameHostname = null) {
  if (typeof value !== 'string' || value.length < 9 || value.length > 4_096) return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLocaleLowerCase('en-US');
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port) return null;
    if (!hostname || isIP(hostname.replace(/^\[|\]$/g, ''))
      || hostname === 'localhost' || hostname.endsWith('.localhost')
      || hostname.endsWith('.local') || hostname.endsWith('.internal')) return null;
    if (sameHostname && hostname !== sameHostname) return null;
    return url;
  } catch {
    return null;
  }
}

function canonicalIsoTimestamp(value) {
  if (typeof value !== 'string' || value.length > 40) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) return null;
  return { value, timestamp };
}

function validateRemoteStockManifest(candidate, manifestUrl, manifestSecret, nowValue, maximumArtifactBytes) {
  if (!verifyTegiwaPublicManifestSignature(candidate, manifestSecret)) {
    throw new Error('invalid_remote_stock_signature');
  }
  const retrievedAt = canonicalIsoTimestamp(candidate.retrievedAt);
  const publishedAt = canonicalIsoTimestamp(candidate.publishedAt);
  const expiresAt = canonicalIsoTimestamp(candidate.expiresAt);
  const artifactUrl = publicHttpsUrl(candidate?.artifact?.url, manifestUrl.hostname.toLocaleLowerCase('en-US'));
  const futureLimit = nowValue + REMOTE_STOCK_CLOCK_SKEW_MS;
  if (!retrievedAt || !publishedAt || !expiresAt || !artifactUrl
    || candidate.artifact.bytes > maximumArtifactBytes
    || retrievedAt.timestamp > futureLimit || publishedAt.timestamp > futureLimit
    || publishedAt.timestamp < retrievedAt.timestamp
    || publishedAt.timestamp - retrievedAt.timestamp > REMOTE_STOCK_MAX_PUBLISH_DELAY_MS
    || expiresAt.timestamp <= publishedAt.timestamp
    || expiresAt.timestamp - retrievedAt.timestamp > REMOTE_STOCK_MAX_VALIDITY_MS) {
    throw new Error('invalid_remote_stock_manifest');
  }
  return {
    releaseId: candidate.releaseId,
    retrievedAt: retrievedAt.value,
    retrievedAtTimestamp: retrievedAt.timestamp,
    publishedAt: publishedAt.value,
    publishedAtTimestamp: publishedAt.timestamp,
    expiresAt: expiresAt.value,
    expiresAtTimestamp: expiresAt.timestamp,
    counts: { ...candidate.counts },
    artifact: {
      url: artifactUrl,
      bytes: candidate.artifact.bytes,
      sha256: candidate.artifact.sha256
    }
  };
}

async function readRemoteBuffer(response, maximumBytes) {
  const contentLengthHeader = response.headers?.get?.('content-length');
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > maximumBytes) {
      throw new Error('invalid_remote_stock_size');
    }
  }
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => {});
        throw new Error('remote_stock_response_too_large');
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, total);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maximumBytes) throw new Error('remote_stock_response_too_large');
  return buffer;
}

async function fetchRemoteJsonBuffer(fetchImpl, url, { maximumBytes, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'Projx-Racing-Stock-Reader/1.0' }
    });
    if (!response?.ok) throw new Error('remote_stock_http_error');
    if (response.url) {
      const finalUrl = publicHttpsUrl(response.url, url.hostname.toLocaleLowerCase('en-US'));
      if (!finalUrl || finalUrl.toString() !== url.toString()) throw new Error('remote_stock_redirect_rejected');
    }
    const contentType = String(response.headers?.get?.('content-type') || '').toLocaleLowerCase('en-US');
    if (!/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/.test(contentType)) {
      throw new Error('invalid_remote_stock_content_type');
    }
    return await readRemoteBuffer(response, maximumBytes);
  } finally {
    clearTimeout(timeout);
  }
}

function validateCompleteRemoteStockIndex(index, manifest) {
  if (!index || index.version !== 2 || index.priceBasis !== 'gbp_ex_uk_vat'
    || index.checkedAt !== manifest.retrievedAt.slice(0, 10)
    || index.productCount !== manifest.counts.productCount
    || index.skuProductCount !== manifest.counts.skuProductCount
    || index.availableProductCount !== manifest.counts.availableProductCount
    || !Array.isArray(index.leadTimes) || index.leadTimes.length < 1
    || index.leadTimes.some(value => typeof value !== 'string' || value.length > 120)) {
    throw new Error('invalid_remote_stock_index');
  }
  let pricedProducts = 0;
  let availableProducts = 0;
  for (const record of Object.values(index.products)) {
    if (!Array.isArray(record) || record.length !== 6
      || !Number.isInteger(record[3]) || record[3] < 0 || record[3] >= index.leadTimes.length) {
      throw new Error('invalid_remote_stock_index');
    }
    const priced = Number.isInteger(record[0]) && record[0] >= 0
      && Number.isInteger(record[1]) && record[1] >= record[0]
      && [0, 1, 2, 3].includes(record[2]);
    const skuOnly = record[0] === null && record[1] === null && record[2] === null;
    if (!priced && !skuOnly) throw new Error('invalid_remote_stock_index');
    if (priced) pricedProducts += 1;
    if (record[2] === 1 || record[2] === 2) availableProducts += 1;
  }
  if (pricedProducts !== index.productCount || availableProducts !== index.availableProductCount) {
    throw new Error('invalid_remote_stock_index');
  }
  return {
    ...index,
    checkedAt: manifest.retrievedAt,
    stockPublishedAt: manifest.publishedAt,
    stockExpiresAt: manifest.expiresAt
  };
}

function stockCheckedAtFloor(index) {
  if (!index?.checkedAt) return 0;
  const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(index.checkedAt)
    ? Date.parse(`${index.checkedAt}T00:00:00.000Z`)
    : Date.parse(index.checkedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function createRemoteTegiwaStockReader({
  manifestUrl,
  manifestSecret,
  expectedSkuMappingFingerprint,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  ttlMs = REMOTE_STOCK_CACHE_TTL_MS,
  failureTtlMs = REMOTE_STOCK_FAILURE_TTL_MS,
  staleIfErrorMs = REMOTE_STOCK_STALE_IF_ERROR_MS,
  timeoutMs = REMOTE_STOCK_TIMEOUT_MS,
  maximumManifestBytes = REMOTE_STOCK_MANIFEST_BYTES,
  maximumArtifactBytes = REMOTE_STOCK_ARTIFACT_BYTES
} = {}) {
  const configuredManifestUrl = publicHttpsUrl(manifestUrl);
  if (!configuredManifestUrl) throw new TypeError('A canonical public HTTPS stock-manifest URL is required.');
  if (!validTegiwaManifestSecret(manifestSecret)) throw new TypeError('A strong server-only stock-manifest secret is required.');
  if (typeof fetchImpl !== 'function' || typeof now !== 'function'
    || !/^[a-f0-9]{64}$/.test(String(expectedSkuMappingFingerprint || ''))
    || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 24 * 60 * 60 * 1_000
    || !Number.isSafeInteger(failureTtlMs) || failureTtlMs < 1 || failureTtlMs > 60 * 60 * 1_000
    || !Number.isSafeInteger(staleIfErrorMs) || staleIfErrorMs < 1 || staleIfErrorMs > 7 * 24 * 60 * 60 * 1_000
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000
    || !Number.isSafeInteger(maximumManifestBytes) || maximumManifestBytes < 1_024 || maximumManifestBytes > 1_000_000
    || !Number.isSafeInteger(maximumArtifactBytes) || maximumArtifactBytes < 1_024 || maximumArtifactBytes > 50_000_000) {
    throw new TypeError('The remote Tegiwa stock-reader configuration is invalid.');
  }

  let cacheRecord = null;
  let refreshAfter = 0;
  let retryAfter = 0;
  let newestRetrievedAt = 0;
  let newestPublishedAt = 0;
  let inFlight = null;

  async function load(fallbackIndex) {
    const requestTime = Number(now());
    if (!Number.isFinite(requestTime)) throw new Error('invalid_remote_stock_clock');
    const manifestBuffer = await fetchRemoteJsonBuffer(fetchImpl, configuredManifestUrl, {
      maximumBytes: maximumManifestBytes,
      timeoutMs
    });
    let manifestPayload;
    try {
      manifestPayload = JSON.parse(manifestBuffer.toString('utf8'));
    } catch {
      throw new Error('invalid_remote_stock_manifest');
    }
    const manifest = validateRemoteStockManifest(
      manifestPayload,
      configuredManifestUrl,
      manifestSecret,
      requestTime,
      maximumArtifactBytes
    );
    const bundledFloor = stockCheckedAtFloor(fallbackIndex);
    if (manifest.retrievedAtTimestamp < bundledFloor
      || manifest.retrievedAtTimestamp < newestRetrievedAt
      || (manifest.retrievedAtTimestamp === newestRetrievedAt
        && manifest.publishedAtTimestamp < newestPublishedAt)) {
      throw new Error('remote_stock_release_rollback');
    }
    const retireAt = manifest.expiresAtTimestamp + staleIfErrorMs;
    if (!Number.isSafeInteger(retireAt) || requestTime > retireAt) throw new Error('remote_stock_release_expired');
    const artifactBuffer = await fetchRemoteJsonBuffer(fetchImpl, manifest.artifact.url, {
      maximumBytes: maximumArtifactBytes,
      timeoutMs
    });
    if (artifactBuffer.length !== manifest.artifact.bytes
      || createHash('sha256').update(artifactBuffer).digest('hex') !== manifest.artifact.sha256) {
      throw new Error('invalid_remote_stock_artifact');
    }
    let stockPayload;
    try {
      stockPayload = JSON.parse(artifactBuffer.toString('utf8'));
    } catch {
      throw new Error('invalid_remote_stock_artifact');
    }
    const remoteIndex = validateCompleteRemoteStockIndex(validateStockIndex(stockPayload), manifest);
    assertSkuSearchIndexFresh(expectedSkuMappingFingerprint, remoteIndex);
    newestRetrievedAt = manifest.retrievedAtTimestamp;
    newestPublishedAt = manifest.publishedAtTimestamp;
    return { index: remoteIndex, retireAt };
  }

  function lastKnownGood(currentTime) {
    if (!cacheRecord) return null;
    if (currentTime <= cacheRecord.retireAt) return cacheRecord.index;
    cacheRecord = null;
    refreshAfter = 0;
    return null;
  }

  return Object.freeze({
    async getIndex(fallbackIndex) {
      const currentTime = Number(now());
      if (!Number.isFinite(currentTime) || !fallbackIndex) return fallbackIndex;
      const retainedIndex = lastKnownGood(currentTime);
      if (retainedIndex && currentTime < refreshAfter) return retainedIndex;
      if (currentTime < retryAfter) return retainedIndex || fallbackIndex;
      if (!inFlight) inFlight = load(fallbackIndex);
      try {
        cacheRecord = await inFlight;
        refreshAfter = Math.min(currentTime + ttlMs, cacheRecord.retireAt);
        retryAfter = 0;
        return cacheRecord.index;
      } catch {
        retryAfter = currentTime + failureTtlMs;
        return lastKnownGood(currentTime) || fallbackIndex;
      } finally {
        inFlight = null;
      }
    }
  });
}

function checkedSearchFile(url, specification) {
  const buffer = readFileSync(url);
  if (buffer.length !== specification.bytes
    || createHash('sha256').update(buffer).digest('hex') !== specification.sha256) {
    throw new Error('invalid_search_index_file');
  }
  return buffer;
}

let defaultSearchProvider;
function loadDefaultSearchProvider() {
  if (defaultSearchProvider) return defaultSearchProvider;
  try {
    const summary = validateSearchSummary(JSON.parse(readFileSync(SEARCH_SUMMARY_URL, 'utf8')));
    assertSkuSearchIndexFresh(summary.skuMappingSha256, loadDefaultStockIndex());
    const termsBuffer = checkedSearchFile(SEARCH_TERMS_URL, summary.files.terms);
    const termPostingsBuffer = checkedSearchFile(SEARCH_TERM_POSTINGS_URL, summary.files.termPostings);
    const pairDictionary = checkedSearchFile(SEARCH_PAIRS_URL, summary.files.pairs);
    const pairPostingsBuffer = checkedSearchFile(SEARCH_PAIR_POSTINGS_URL, summary.files.pairPostings);
    const metadataBuffer = checkedSearchFile(SEARCH_METADATA_URL, summary.files.metadata);
    const termPayload = JSON.parse(termsBuffer.toString('utf8'));
    if (!termPayload || termPayload.version !== 1 || !Array.isArray(termPayload.terms)
      || termPayload.terms.length !== summary.termCount
      || termPostingsBuffer.length !== summary.termPostingCount * 4
      || pairDictionary.length !== summary.pairCount * SEARCH_PAIR_RECORD_BYTES
      || pairPostingsBuffer.length !== summary.pairPostingCount * 4
      || metadataBuffer.length !== summary.productCount * SEARCH_METADATA_RECORD_BYTES) {
      throw new Error('invalid_search_index');
    }

    const terms = new Map();
    const vocabulary = [];
    let previousTerm = '';
    for (const entry of termPayload.terms) {
      if (!Array.isArray(entry) || entry.length !== 3) throw new Error('invalid_search_index');
      const [term, offsetValue, countValue] = entry;
      const offset = safeInteger(offsetValue, 0, summary.termPostingCount);
      const count = safeInteger(countValue, 1, summary.productCount);
      if (typeof term !== 'string' || !term || term !== normalizeSearchText(term) || term.includes(' ')
        || (previousTerm && term <= previousTerm) || offset === null || count === null
        || offset + count > summary.termPostingCount) throw new Error('invalid_search_index');
      previousTerm = term;
      terms.set(term, { offset, count });
      vocabulary.push(term);
    }

    const readPostings = (buffer, offset, count) => {
      const ids = new Array(count);
      let previous = -1;
      for (let index = 0; index < count; index += 1) {
        const documentId = buffer.readUInt32LE((offset + index) * 4);
        if (documentId >= summary.productCount || documentId <= previous) throw new Error('invalid_search_postings');
        ids[index] = documentId;
        previous = documentId;
      }
      return ids;
    };
    const findPair = hash => {
      let low = 0;
      let high = summary.pairCount - 1;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const position = middle * SEARCH_PAIR_RECORD_BYTES;
        const candidate = pairDictionary.readBigUInt64LE(position);
        if (candidate === hash) {
          return {
            offset: pairDictionary.readUInt32LE(position + 8),
            count: pairDictionary.readUInt32LE(position + 12)
          };
        }
        if (candidate < hash) low = middle + 1;
        else high = middle - 1;
      }
      return null;
    };
    defaultSearchProvider = {
      productCount: summary.productCount,
      vocabulary,
      termCount(term) { return terms.get(term)?.count || 0; },
      termPostings(term) {
        const entry = terms.get(term);
        return entry ? readPostings(termPostingsBuffer, entry.offset, entry.count) : [];
      },
      pairPostings(left, right) {
        const entry = findPair(fnv1a64(`${left}\u0001${right}`));
        return entry ? readPostings(pairPostingsBuffer, entry.offset, entry.count) : [];
      },
      metadata(documentId) {
        if (!Number.isInteger(documentId) || documentId < 0 || documentId >= summary.productCount) throw new Error('invalid_search_document');
        const offset = documentId * SEARCH_METADATA_RECORD_BYTES;
        return {
          nameRank: metadataBuffer.readUInt32LE(offset),
          stockKey: metadataBuffer.subarray(offset + 4, offset + 16).toString('base64url')
        };
      }
    };
  } catch (error) {
    throw new Error('The public Tegiwa search index could not be loaded.', { cause: error });
  }
  return defaultSearchProvider;
}

function stockSnapshotIsFresh(index, nowValue) {
  if (!index.checkedAt) return false;
  if (index.stockExpiresAt) {
    const expiresAtTimestamp = Date.parse(index.stockExpiresAt);
    return Number.isFinite(expiresAtTimestamp) && Number.isFinite(nowValue) && nowValue <= expiresAtTimestamp;
  }
  const checkedAtTimestamp = /^\d{4}-\d{2}-\d{2}$/.test(index.checkedAt)
    ? Date.parse(`${index.checkedAt}T23:59:59.999Z`)
    : Date.parse(index.checkedAt);
  return Number.isFinite(checkedAtTimestamp) && Number.isFinite(nowValue)
    && nowValue <= checkedAtTimestamp + MAX_STOCK_AGE_MS;
}

function stockForTitle(index, title) {
  const key = stockKeyForTitle(title);
  return stockForKey(index, key);
}

function stockForKey(index, key) {
  const record = key && Object.prototype.hasOwnProperty.call(index.products, key) ? index.products[key] : null;
  if (!Array.isArray(record) || record.length < 4) return null;
  const minPence = safeInteger(record[0], 0, 100_000_000);
  const maxPence = safeInteger(record[1], 0, 100_000_000);
  const code = STATUS_CODES[record[2]];
  const leadTimeIndex = safeInteger(record[3], 0, Math.max(0, index.leadTimes.length - 1));
  if (minPence === null || maxPence === null || !code) return null;
  return {
    minPence: Math.min(minPence, maxPence),
    maxPence: Math.max(minPence, maxPence),
    code,
    leadTime: leadTimeIndex === null ? null : (index.leadTimes[leadTimeIndex] || null)
  };
}

function partNumbersForKey(index, key) {
  const record = key && Object.prototype.hasOwnProperty.call(index.products, key) ? index.products[key] : null;
  if (!Array.isArray(record) || record.length < 6 || record[5] !== 1) return [];
  return safePartNumberList(record[4]);
}

function partNumbersForTitle(index, title) {
  return partNumbersForKey(index, stockKeyForTitle(title));
}

function skuJoinStateForTitle(index, title) {
  const key = stockKeyForTitle(title);
  const record = key && Object.prototype.hasOwnProperty.call(index.products, key) ? index.products[key] : null;
  return Array.isArray(record) && record[5] === 2 ? 'open_for_exact' : 'not_supplied';
}

function gbp(value) {
  return Math.round(value) / 100;
}

function parseDisplayedPrice(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value >= 1_000 ? gbp(value) : Math.round(value * 100) / 100;
  }
  const text = safeText(value, 80).replace(/,/g, '');
  const match = text.match(/-?\d+(?:\.\d{1,2})?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) && number >= 0 && number <= 1_000_000 ? Math.round(number * 100) / 100 : null;
}

function parseShopifyPence(value) {
  const pence = safeInteger(value, 0, 100_000_000);
  return pence === null ? null : gbp(pence);
}

function priceObject(stock, officialMin = null, officialMax = officialMin) {
  if (stock) {
    return {
      currency: 'GBP',
      min: gbp(stock.minPence),
      max: gbp(stock.maxPence),
      note: 'Supplier price excluding UK VAT'
    };
  }
  if (officialMin === null) return { currency: 'GBP', min: null, max: null, note: null };
  const maximum = officialMax === null ? officialMin : officialMax;
  return {
    currency: 'GBP',
    min: Math.min(officialMin, maximum),
    max: Math.max(officialMin, maximum),
    note: 'Tegiwa online price excluding UK VAT'
  };
}

function fallbackAvailability(available) {
  if (available === false) return 'out_of_stock';
  return 'check_availability';
}

function availabilityObject(index, stock, officialAvailable) {
  const freshStock = index.stockSnapshotFresh ? stock : null;
  return {
    code: freshStock?.code || fallbackAvailability(officialAvailable),
    checkedAt: index.checkedAt,
    leadTime: freshStock?.leadTime || null,
    snapshotStale: Boolean(index.checkedAt && !index.stockSnapshotFresh)
  };
}

function officialProductUrl(handle) {
  return `${OFFICIAL_ORIGIN}/products/${handle}`;
}

function productHandle(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > MAX_PRODUCT_HANDLE_LENGTH) return null;
  const handle = safeText(raw, MAX_PRODUCT_HANDLE_LENGTH);
  return /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(handle) ? handle : null;
}

function handleFromProductUrl(value) {
  try {
    const url = new URL(decodeEntities(value));
    if (url.protocol !== 'https:' || url.hostname !== 'www.tegiwa.com') return null;
    const match = url.pathname.match(/^\/products\/([a-z0-9]+(?:[-_][a-z0-9]+)*)\/?$/);
    return match ? productHandle(match[1]) : null;
  } catch {
    return null;
  }
}

function safeImageUrl(value) {
  try {
    const url = new URL(decodeEntities(value), OFFICIAL_ORIGIN);
    const hostAllowed = url.hostname === 'cdn.shopify.com' || url.hostname === 'www.tegiwa.com' || url.hostname === 'tegiwa.com';
    if (url.protocol !== 'https:' || !hostAllowed || url.username || url.password) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function imageObject(value, fallbackAlt = '') {
  if (!value) return null;
  const candidate = typeof value === 'string' ? { src: value } : value;
  const src = safeImageUrl(candidate.url || candidate.src || candidate.image);
  if (!src) return null;
  return {
    src,
    width: safeDimension(candidate.width),
    height: safeDimension(candidate.height),
    alt: safeText(candidate.alt || candidate.altText || fallbackAlt, 220)
  };
}

function partNumberFields(index, title, officialSkus = [], officialMpns = [], { includeAll = false } = {}) {
  const skus = mergePartNumbers(partNumbersForTitle(index, title), officialSkus);
  const mpns = mergePartNumbers(officialMpns);
  const skuState = skus.length === 1 ? 'exact' : (skus.length > 1 ? 'multiple' : skuJoinStateForTitle(index, title));
  return {
    sku: skus.length === 1 ? skus[0] : null,
    skuCount: skus.length,
    skuState,
    mpn: mpns.length === 1 ? mpns[0] : null,
    mpnCount: mpns.length,
    ...(includeAll ? { skus, mpns } : {})
  };
}

function baseCard({
  handle, title, vendor, category, image, officialMin, officialMax, officialAvailable,
  officialSkus = [], officialMpns = [], includeAllPartNumbers = false
}, index) {
  const stock = stockForTitle(index, title);
  const currentStock = index.stockSnapshotFresh ? stock : null;
  return {
    handle,
    title: safeText(title, 300),
    vendor: safeText(vendor, 160) || null,
    category: safeText(category, 160) || null,
    image: imageObject(image, title),
    ...partNumberFields(index, title, officialSkus, officialMpns, { includeAll: includeAllPartNumbers }),
    price: priceObject(currentStock, officialMin, officialMax),
    availability: availabilityObject(index, stock, officialAvailable),
    sourceUrl: officialProductUrl(handle)
  };
}

function normalizeSearchProduct(product, index) {
  if (!product || typeof product !== 'object') return null;
  const handle = productHandle(product.handle) || handleFromProductUrl(product.url);
  const title = safeText(product.title, 300);
  if (!handle || !title) return null;
  const price = parseDisplayedPrice(product.price_min ?? product.price);
  const priceMaximum = parseDisplayedPrice(product.price_max ?? product.price);
  return baseCard({
    handle,
    title,
    vendor: product.vendor,
    category: product.type,
    image: product.featured_image || product.image,
    officialMin: price,
    officialMax: priceMaximum,
    officialAvailable: typeof product.available === 'boolean' ? product.available : null
  }, index);
}

function productSitemapUrl(value) {
  try {
    const url = new URL(decodeEntities(value));
    if (url.protocol !== 'https:' || url.hostname !== 'www.tegiwa.com') return null;
    if (!/^\/sitemap_products[^/]*\.xml$/.test(url.pathname)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function validateCatalogShard(candidate) {
  if (!Array.isArray(candidate) || candidate.length > MAX_SITEMAP_PRODUCTS) throw new Error('invalid_catalog_shard');
  const products = [];
  const seen = new Set();
  for (const record of candidate) {
    if (!Array.isArray(record) || record.length !== 3) throw new Error('invalid_catalog_shard');
    const handle = productHandle(record[0]);
    const title = safeText(record[1], 300);
    const imageUrl = record[2] ? safeImageUrl(record[2]) : null;
    if (!handle || !title || (record[2] && !imageUrl) || seen.has(handle)) throw new Error('invalid_catalog_shard');
    seen.add(handle);
    products.push({ handle, title, imageUrl });
  }
  return products;
}

const defaultCatalogShardCache = new Map();
function loadDefaultCatalogShard(shardIndex) {
  const index = safeInteger(shardIndex, 0, MAX_SITEMAPS - 1);
  if (index === null) throw new Error('invalid_catalog_shard_index');
  if (defaultCatalogShardCache.has(index)) return defaultCatalogShardCache.get(index);
  const filename = `${String(index).padStart(3, '0')}.json`;
  let records;
  try {
    records = JSON.parse(readFileSync(new URL(filename, CATALOG_SHARD_DIRECTORY_URL), 'utf8'));
  } catch (error) {
    throw new Error(`The public Tegiwa catalog shard ${filename} could not be loaded.`, { cause: error });
  }
  defaultCatalogShardCache.set(index, records);
  if (defaultCatalogShardCache.size > MAX_CACHED_CATALOG_SHARDS) {
    defaultCatalogShardCache.delete(defaultCatalogShardCache.keys().next().value);
  }
  return records;
}

function encodeCursor(sitemapIndex, offset) {
  return Buffer.from(JSON.stringify({ v: 1, s: sitemapIndex, o: offset }), 'utf8').toString('base64url');
}

function decodeCursor(value) {
  if (value === undefined || value === null || value === '') return { sitemapIndex: 0, offset: 0 };
  const text = Array.isArray(value) ? '' : String(value);
  if (!/^[A-Za-z0-9_-]{4,200}$/.test(text)) throw new PublicApiError(400, 'invalid_cursor', 'The catalog cursor is invalid.');
  try {
    const parsed = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
    const sitemapIndex = safeInteger(parsed?.s, 0, MAX_SITEMAPS - 1);
    const offset = safeInteger(parsed?.o, 0, MAX_SITEMAP_PRODUCTS);
    if (parsed?.v !== 1 || sitemapIndex === null || offset === null) throw new Error('invalid');
    return { sitemapIndex, offset };
  } catch {
    throw new PublicApiError(400, 'invalid_cursor', 'The catalog cursor is invalid.');
  }
}

function catalogPositionForPage(summary, page, sitemapCount) {
  const totalPages = Math.ceil(summary.productCount / PAGE_SIZE);
  if (page > totalPages) throw new PublicApiError(400, 'invalid_page', 'The requested catalog page does not exist.');
  if (!Array.isArray(summary.shardProductCounts) || summary.shardProductCounts.length !== sitemapCount) {
    throw new Error('catalog_page_index_unavailable');
  }

  let remaining = (page - 1) * PAGE_SIZE;
  for (let sitemapIndex = 0; sitemapIndex < summary.shardProductCounts.length; sitemapIndex += 1) {
    const shardProductCount = summary.shardProductCounts[sitemapIndex];
    if (remaining < shardProductCount) return { sitemapIndex, offset: remaining };
    remaining -= shardProductCount;
  }
  throw new PublicApiError(400, 'invalid_page', 'The requested catalog page does not exist.');
}

function catalogPageForPosition(summary, sitemapIndex, offset, sitemapCount) {
  if (!Array.isArray(summary.shardProductCounts)) return null;
  if (summary.shardProductCounts.length !== sitemapCount) throw new Error('catalog_page_index_unavailable');
  const shardProductCount = summary.shardProductCounts[sitemapIndex];
  if (!Number.isInteger(shardProductCount) || offset > shardProductCount) {
    throw new PublicApiError(400, 'invalid_cursor', 'The catalog cursor is invalid.');
  }
  const absoluteOffset = summary.shardProductCounts
    .slice(0, sitemapIndex)
    .reduce((total, value) => total + value, offset);
  return Math.floor(absoluteOffset / PAGE_SIZE) + 1;
}

function isAllowedUpstreamUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    if (url.hostname !== 'www.tegiwa.com') return false;
    return /^\/products\/[a-z0-9]+(?:[-_][a-z0-9]+)*\.js$/.test(url.pathname);
  } catch {
    return false;
  }
}

async function readCappedResponse(response, maxBytes) {
  const contentLength = Number(response.headers?.get?.('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new UpstreamError('upstream_response_too_large');

  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new UpstreamError('upstream_response_too_large');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }

  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new UpstreamError('upstream_response_too_large');
  return text;
}

async function fetchText(fetchImpl, url, { maxBytes, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!isAllowedUpstreamUrl(url)) throw new UpstreamError('upstream_url_rejected');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        Accept: 'application/json, application/xml, text/xml;q=0.9',
        'User-Agent': 'Projx-Racing-Catalog/1.0'
      }
    });
    if (!response?.ok) throw new UpstreamError('upstream_http_error', Number(response?.status || 0));
    return await readCappedResponse(response, maxBytes);
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    if (error?.name === 'AbortError' || controller.signal.aborted) throw new UpstreamError('upstream_timeout');
    throw new UpstreamError('upstream_unavailable');
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(fetchImpl, url, options) {
  const text = await fetchText(fetchImpl, url, options);
  try {
    return JSON.parse(text);
  } catch {
    throw new UpstreamError('upstream_invalid_response');
  }
}

function requestParameter(req, key) {
  const direct = req.query?.[key];
  if (direct !== undefined) return direct;
  try {
    return new URL(req.url || '/', 'https://local.invalid').searchParams.get(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function cleanSingleParameter(value, limit) {
  if (Array.isArray(value)) throw new PublicApiError(400, 'invalid_parameters', 'Only one value is allowed for each parameter.');
  return safeText(value, limit);
}

function positivePage(value, defaultValue = null) {
  if (value === undefined) return defaultValue;
  const text = Array.isArray(value) ? '' : String(value).trim();
  const page = /^\d+$/.test(text) ? safeInteger(text, 1, 10_000_000) : null;
  if (page === null) throw new PublicApiError(400, 'invalid_page', 'Catalog pages must be positive whole numbers.');
  return page;
}

function enumParameter(value, allowed, fallback, code, message) {
  if (value === undefined) return fallback;
  if (Array.isArray(value)) throw new PublicApiError(400, 'invalid_parameters', 'Only one value is allowed for each parameter.');
  const normalized = String(value).trim().toLowerCase();
  if (!allowed.has(normalized)) throw new PublicApiError(400, code, message);
  return normalized;
}

function determineMode(req) {
  const allowedParameters = new Set(['q', 'handle', 'cursor', 'page', 'suggest', 'sort', 'availability', 'pricing', 'match']);
  const suppliedParameters = new Set(Object.keys(req.query || {}));
  try {
    for (const key of new URL(req.url || '/', 'https://local.invalid').searchParams.keys()) suppliedParameters.add(key);
  } catch {}
  if ([...suppliedParameters].some(key => !allowedParameters.has(key))) {
    throw new PublicApiError(400, 'invalid_parameters', 'The catalog request contains an unsupported parameter.');
  }
  const rawQuery = requestParameter(req, 'q');
  const rawHandle = requestParameter(req, 'handle');
  const rawCursor = requestParameter(req, 'cursor');
  const rawPage = requestParameter(req, 'page');
  const rawSuggest = requestParameter(req, 'suggest');
  const rawSort = requestParameter(req, 'sort');
  const rawAvailability = requestParameter(req, 'availability');
  const rawPricing = requestParameter(req, 'pricing');
  const rawMatch = requestParameter(req, 'match');
  const hasSearchOption = [rawSuggest, rawSort, rawAvailability, rawPricing, rawMatch].some(value => value !== undefined);

  if (rawQuery !== undefined) {
    const query = cleanSingleParameter(rawQuery, MAX_PART_NUMBER_LENGTH + 1);
    const length = Array.from(query).length;
    if (length < 2 || length > MAX_PART_NUMBER_LENGTH) {
      throw new PublicApiError(400, 'invalid_query', `Search queries must contain between 2 and ${MAX_PART_NUMBER_LENGTH} characters.`);
    }
    if (rawHandle !== undefined || rawCursor !== undefined) {
      throw new PublicApiError(400, 'invalid_parameters', 'Search cannot be combined with a product handle or catalog cursor.');
    }
    if (rawSuggest !== undefined) {
      if (Array.isArray(rawSuggest) || String(rawSuggest).trim() !== '1'
        || rawPage !== undefined || rawSort !== undefined || rawAvailability !== undefined || rawPricing !== undefined || rawMatch !== undefined) {
        throw new PublicApiError(400, 'invalid_parameters', 'Suggestions accept only q and suggest=1.');
      }
      return { mode: 'suggest', query };
    }
    return {
      mode: 'search',
      query,
      page: positivePage(rawPage, 1),
      sort: enumParameter(rawSort, SEARCH_SORTS, 'relevance', 'invalid_sort', 'The requested search sort is not supported.'),
      availability: enumParameter(rawAvailability, SEARCH_AVAILABILITY_FILTERS, 'all', 'invalid_availability', 'The requested availability filter is not supported.'),
      pricing: enumParameter(rawPricing, SEARCH_PRICING_FILTERS, 'all', 'invalid_pricing', 'The requested pricing filter is not supported.'),
      match: enumParameter(rawMatch, SEARCH_MATCHES, 'any', 'invalid_match', 'The requested search matching mode is not supported.')
    };
  }

  if (hasSearchOption) throw new PublicApiError(400, 'invalid_parameters', 'Search options require a search query.');

  const supplied = [rawHandle !== undefined, rawCursor !== undefined, rawPage !== undefined].filter(Boolean).length;
  if (supplied > 1) throw new PublicApiError(400, 'invalid_parameters', 'Use only one catalog mode per request.');

  if (rawHandle !== undefined) {
    const raw = Array.isArray(rawHandle) ? '' : String(rawHandle).trim();
    if (raw.length > MAX_PRODUCT_HANDLE_LENGTH || !productHandle(raw)) throw new PublicApiError(400, 'invalid_handle', 'The product handle is invalid.');
    return { mode: 'detail', handle: raw };
  }

  if (rawPage !== undefined) {
    return { mode: 'browse', page: positivePage(rawPage) };
  }

  return { mode: 'browse', ...decodeCursor(rawCursor) };
}

function requestIsSameOrigin(req) {
  const origin = safeText(req.headers?.origin, 500);
  if (!origin) return safeText(req.headers?.['sec-fetch-site'], 30).toLowerCase() !== 'cross-site';
  const host = safeText(req.headers?.host || req.headers?.['x-forwarded-host'], 255).toLowerCase();
  try {
    const parsed = new URL(origin);
    return Boolean(host) && (parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.host.toLowerCase() === host;
  } catch {
    return false;
  }
}

function responseHeaders(res, cacheable) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cacheable ? CACHE_CONTROL : 'no-store');
  if (cacheable) res.setHeader('CDN-Cache-Control', CACHE_CONTROL);
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Vary', 'Origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
}

function sendJson(res, status, body, cacheable = false) {
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized, 'utf8') > JSON_RESPONSE_BYTES) {
    return sendError(res, 500, 'response_too_large', 'The catalog response exceeded its safety limit.');
  }
  res.statusCode = status;
  responseHeaders(res, cacheable);
  res.end(serialized);
}

function sendError(res, status, code, message) {
  res.statusCode = status;
  responseHeaders(res, false);
  res.end(JSON.stringify({ error: { code, message } }));
}

function metaFor(index, count, extra = {}) {
  return {
    count,
    checkedAt: index.checkedAt,
    ...(index.stockPublishedAt ? { stockPublishedAt: index.stockPublishedAt } : {}),
    ...(index.stockExpiresAt ? { stockExpiresAt: index.stockExpiresAt } : {}),
    stockSnapshotStale: Boolean(index.checkedAt && !index.stockSnapshotFresh),
    catalogProductCount: index.catalogProductCount,
    stockIndexedProductCount: index.productCount,
    skuIndexedProductCount: index.skuProductCount,
    availableProductCount: index.availableProductCount,
    ...extra
  };
}

function lowerBound(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function prefixTerms(provider, prefix) {
  const matches = [];
  const start = lowerBound(provider.vocabulary, prefix);
  for (let index = start; index < provider.vocabulary.length; index += 1) {
    const term = provider.vocabulary[index];
    if (!term.startsWith(prefix)) break;
    matches.push(term);
  }
  matches.sort((left, right) => {
    if (left === prefix) return -1;
    if (right === prefix) return 1;
    const countDifference = provider.termCount(right) - provider.termCount(left);
    return countDifference || left.length - right.length || (left < right ? -1 : 1);
  });
  return matches.slice(0, MAX_PREFIX_TERMS_PER_TOKEN);
}

function damerauLevenshteinWithin(left, right, maximum) {
  const leftCharacters = Array.from(left);
  const rightCharacters = Array.from(right);
  if (Math.abs(leftCharacters.length - rightCharacters.length) > maximum) return maximum + 1;
  let previousPrevious = null;
  let previous = Array.from({ length: rightCharacters.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= leftCharacters.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = current[0];
    for (let rightIndex = 1; rightIndex <= rightCharacters.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1] + (leftCharacters[leftIndex - 1] === rightCharacters[rightIndex - 1] ? 0 : 1);
      let distance = Math.min(previous[rightIndex] + 1, current[rightIndex - 1] + 1, substitution);
      if (previousPrevious && leftIndex > 1 && rightIndex > 1
        && leftCharacters[leftIndex - 1] === rightCharacters[rightIndex - 2]
        && leftCharacters[leftIndex - 2] === rightCharacters[rightIndex - 1]) {
        distance = Math.min(distance, previousPrevious[rightIndex - 2] + 1);
      }
      current[rightIndex] = distance;
      rowMinimum = Math.min(rowMinimum, distance);
    }
    if (rowMinimum > maximum) return maximum + 1;
    previousPrevious = previous;
    previous = current;
  }
  return previous[rightCharacters.length];
}

function correctedToken(provider, token) {
  if (provider.termCount(token) > 0 || prefixTerms(provider, token).length > 0 || Array.from(token).length < 3) return token;
  const length = Array.from(token).length;
  const maximum = length >= 8 ? 2 : 1;
  const firstCharacter = Array.from(token)[0];
  let best = null;
  for (const candidate of provider.vocabulary) {
    const candidateCharacters = Array.from(candidate);
    if (candidateCharacters[0] !== firstCharacter || Math.abs(candidateCharacters.length - length) > maximum) continue;
    const distance = damerauLevenshteinWithin(token, candidate, maximum);
    if (distance > maximum) continue;
    const frequency = provider.termCount(candidate);
    if (!best || distance < best.distance
      || (distance === best.distance && frequency > best.frequency)
      || (distance === best.distance && frequency === best.frequency && candidate < best.term)) {
      best = { term: candidate, distance, frequency };
    }
  }
  return best?.term || token;
}

function unionPostingLists(lists) {
  if (!lists.length) return [];
  if (lists.length === 1) return [...lists[0]];
  const values = new Set();
  for (const list of lists) for (const documentId of list) values.add(documentId);
  return [...values].sort((left, right) => left - right);
}

function intersectPostingLists(lists) {
  if (!lists.length || lists.some(list => !list.length)) return [];
  const sorted = [...lists].sort((left, right) => left.length - right.length);
  let result = [...sorted[0]];
  for (let listIndex = 1; listIndex < sorted.length && result.length; listIndex += 1) {
    const next = sorted[listIndex];
    const intersection = [];
    let leftIndex = 0;
    let rightIndex = 0;
    while (leftIndex < result.length && rightIndex < next.length) {
      if (result[leftIndex] === next[rightIndex]) {
        intersection.push(result[leftIndex]);
        leftIndex += 1;
        rightIndex += 1;
      } else if (result[leftIndex] < next[rightIndex]) leftIndex += 1;
      else rightIndex += 1;
    }
    result = intersection;
  }
  return result;
}

function searchPlan(provider, query) {
  const normalizedQuery = normalizeSearchText(query);
  const originalTokens = searchTokens(normalizedQuery);
  const exactPartNumber = exactPartNumberSearch(query);
  if (exactPartNumber && provider.termCount(exactPartNumber.term) > 0) {
    const exact = provider.termPostings(exactPartNumber.term);
    return {
      query,
      normalizedQuery,
      originalTokens,
      canonicalTokens: [exactPartNumber.identity],
      canonicalQuery: exactPartNumber.partNumber,
      translated: false,
      corrected: false,
      corrections: [],
      tokenGroups: [exact],
      exactGroups: [exact],
      exactSkuIdentity: exactPartNumber.identity
    };
  }
  if (!originalTokens.length || originalTokens.length > MAX_QUERY_TOKENS) {
    throw new PublicApiError(400, 'invalid_query', `Search queries may contain up to ${MAX_QUERY_TOKENS} searchable words.`);
  }
  const localized = localizedSearchTokens(originalTokens);
  if (!localized.tokens.length || localized.tokens.length > MAX_QUERY_TOKENS) {
    throw new PublicApiError(400, 'invalid_query', `Search queries may contain up to ${MAX_QUERY_TOKENS} searchable words.`);
  }
  const canonicalTokens = localized.tokens.map(token => correctedToken(provider, token));
  const corrections = localized.corrections.concat(localized.tokens
    .map((from, index) => ({ from, to: canonicalTokens[index] }))
    .filter(value => value.from !== value.to));
  const tokenGroups = canonicalTokens.map(token => {
    const terms = prefixTerms(provider, token);
    if (!terms.length && provider.termCount(token)) terms.push(token);
    return unionPostingLists(terms.map(term => provider.termPostings(term)));
  });
  const exactGroups = canonicalTokens.map(token => provider.termPostings(token));
  return {
    query,
    normalizedQuery,
    originalTokens,
    canonicalTokens,
    canonicalQuery: canonicalTokens.join(' '),
    translated: localized.corrections.length > 0,
    corrected: corrections.length > 0,
    corrections,
    tokenGroups,
    exactGroups,
    exactSkuIdentity: null
  };
}

function availabilityCodeForSearch(index, stock) {
  return index.stockSnapshotFresh && stock ? stock.code : 'check_availability';
}

function availabilityMatches(filter, code) {
  if (filter === 'all') return true;
  if (filter === 'available') return code === 'in_stock' || code === 'supplier_stock';
  if (filter === 'in_stock') return code === 'in_stock';
  if (filter === 'supplier_stock') return code === 'supplier_stock';
  if (filter === 'check') return code === 'check_availability';
  return code === 'out_of_stock';
}

function rankedSearchDocuments(provider, index, plan, { sort, availability, pricing, match = 'any' }) {
  const candidates = match === 'vehicle'
    ? intersectPostingLists(plan.tokenGroups)
    : unionPostingLists(plan.tokenGroups);
  const matchedTokenCounts = new Uint8Array(provider.productCount);
  for (const group of plan.tokenGroups) for (const documentId of group) matchedTokenCounts[documentId] += 1;
  const allPrefix = new Uint8Array(provider.productCount);
  for (const documentId of intersectPostingLists(plan.tokenGroups)) allPrefix[documentId] = 1;
  const allExact = new Uint8Array(provider.productCount);
  for (const documentId of intersectPostingLists(plan.exactGroups)) allExact[documentId] = 1;
  const phrase = new Uint8Array(provider.productCount);
  if (plan.canonicalTokens.length === 1) {
    for (const documentId of plan.exactGroups[0]) phrase[documentId] = 1;
  } else {
    const pairs = [];
    for (let index = 0; index + 1 < plan.canonicalTokens.length; index += 1) {
      pairs.push(provider.pairPostings(plan.canonicalTokens[index], plan.canonicalTokens[index + 1]));
    }
    for (const documentId of intersectPostingLists(pairs)) phrase[documentId] = 1;
  }

  const records = [];
  for (const documentId of candidates) {
    const metadata = provider.metadata(documentId);
    const stock = stockForKey(index, metadata.stockKey);
    const currentStock = index.stockSnapshotFresh ? stock : null;
    const matchedSku = plan.exactSkuIdentity
      ? partNumbersForKey(index, metadata.stockKey)
        .find(sku => normalizedPartNumberIdentity(sku) === plan.exactSkuIdentity) || null
      : null;
    if (plan.exactSkuIdentity && !matchedSku) continue;
    const availabilityCode = availabilityCodeForSearch(index, stock);
    if (!availabilityMatches(availability, availabilityCode)) continue;
    const priced = Boolean(currentStock);
    if ((pricing === 'priced' && !priced) || (pricing === 'request_price' && priced)) continue;
    records.push({
      documentId,
      nameRank: metadata.nameRank,
      price: currentStock?.minPence ?? null,
      matchedSku,
      relevanceTier: phrase[documentId] ? 0 : (allExact[documentId] ? 1 : (allPrefix[documentId] ? 2 : 3)),
      matchedTokens: matchedTokenCounts[documentId]
    });
  }

  records.sort((left, right) => {
    if (sort === 'name_asc') return left.nameRank - right.nameRank || left.documentId - right.documentId;
    if (sort === 'name_desc') return right.nameRank - left.nameRank || left.documentId - right.documentId;
    if (sort === 'price_asc' || sort === 'price_desc') {
      if (left.price === null && right.price !== null) return 1;
      if (right.price === null && left.price !== null) return -1;
      if (left.price !== null && right.price !== null && left.price !== right.price) {
        return sort === 'price_asc' ? left.price - right.price : right.price - left.price;
      }
      return left.nameRank - right.nameRank || left.documentId - right.documentId;
    }
    return left.relevanceTier - right.relevanceTier
      || right.matchedTokens - left.matchedTokens
      || left.nameRank - right.nameRank
      || left.documentId - right.documentId;
  });
  return records;
}

function documentPosition(summary, documentId) {
  let remaining = documentId;
  for (let shardIndex = 0; shardIndex < summary.shardProductCounts.length; shardIndex += 1) {
    if (remaining < summary.shardProductCounts[shardIndex]) return { shardIndex, offset: remaining };
    remaining -= summary.shardProductCounts[shardIndex];
  }
  throw new Error('invalid_search_document');
}

async function cardsForDocumentIds(documentIds, index, summary, catalogLoader) {
  const groups = new Map();
  for (const documentId of documentIds) {
    const position = documentPosition(summary, documentId);
    if (!groups.has(position.shardIndex)) groups.set(position.shardIndex, []);
    groups.get(position.shardIndex).push({ documentId, offset: position.offset });
  }
  if (groups.size > MAX_SEARCH_CARD_SHARDS) throw new Error('search_card_shard_limit_exceeded');
  const cards = new Map();
  for (const [shardIndex, positions] of groups) {
    const products = validateCatalogShard(await catalogLoader(shardIndex));
    for (const position of positions) {
      const product = products[position.offset];
      if (!product) throw new Error('invalid_search_document');
      cards.set(position.documentId, baseCard({
        handle: product.handle,
        title: product.title,
        vendor: null,
        category: null,
        image: product.imageUrl,
        officialMin: null,
        officialMax: null,
        officialAvailable: null
      }, index));
    }
  }
  return documentIds.map(documentId => cards.get(documentId));
}

async function searchCatalog(provider, index, summary, request, catalogLoader) {
  const plan = searchPlan(provider, request.query);
  const ranked = rankedSearchDocuments(provider, index, plan, request);
  const totalResults = ranked.length;
  const totalPages = Math.ceil(totalResults / PAGE_SIZE);
  if (request.page > Math.max(1, totalPages)) {
    throw new PublicApiError(400, 'invalid_page', 'The requested search page does not exist.');
  }
  const start = (request.page - 1) * PAGE_SIZE;
  const pageRecords = ranked.slice(start, start + PAGE_SIZE);
  const pageIds = pageRecords.map(record => record.documentId);
  const items = await cardsForDocumentIds(pageIds, index, summary, catalogLoader);
  if (plan.exactSkuIdentity) {
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      items[itemIndex] = { ...items[itemIndex], matchedSku: pageRecords[itemIndex].matchedSku };
    }
  }
  return {
    mode: 'search',
    items,
    meta: metaFor(index, items.length, {
      query: request.query,
      canonicalQuery: plan.canonicalQuery,
      translated: plan.translated,
      corrected: plan.corrected,
      corrections: plan.corrections,
      page: request.page,
      pageSize: PAGE_SIZE,
      totalResults,
      totalPages,
      sort: request.sort,
      availability: request.availability,
      pricing: request.pricing,
      match: request.match
    }),
    nextCursor: null
  };
}

async function suggestCatalog(provider, index, summary, query, catalogLoader) {
  const plan = searchPlan(provider, query);
  const ranked = rankedSearchDocuments(provider, index, plan, {
    sort: 'relevance', availability: 'all', pricing: 'all', match: 'any'
  });
  const documentIds = ranked.slice(0, SEARCH_SUGGESTION_LIMIT).map(record => record.documentId);
  const cards = await cardsForDocumentIds(documentIds, index, summary, catalogLoader);
  return {
    mode: 'suggest',
    suggestions: cards.map(card => ({ query: card.title, label: card.title, kind: 'product', handle: card.handle })),
    correction: {
      query,
      canonicalQuery: plan.canonicalQuery,
      translated: plan.translated,
      corrected: plan.corrected,
      corrections: plan.corrections
    },
    meta: { count: cards.length, limit: SEARCH_SUGGESTION_LIMIT },
    nextCursor: null
  };
}

async function browseCatalog(index, sitemaps, sitemapIndex, offset, page, catalogLoader) {
  if (sitemapIndex >= sitemaps.length) throw new PublicApiError(400, 'invalid_cursor', 'The catalog cursor is invalid.');

  const items = [];
  let currentSitemap = sitemapIndex;
  let currentOffset = offset;
  let nextCursor = null;
  let shardReads = 0;

  while (items.length < PAGE_SIZE && currentSitemap < sitemaps.length && shardReads < MAX_CATALOG_SHARDS_PER_REQUEST) {
    const products = validateCatalogShard(await catalogLoader(currentSitemap));
    shardReads += 1;
    if (currentOffset > products.length) throw new PublicApiError(400, 'invalid_cursor', 'The catalog cursor is invalid.');

    const take = products.slice(currentOffset, currentOffset + (PAGE_SIZE - items.length));
    for (const product of take) {
      items.push(baseCard({
        handle: product.handle,
        title: product.title,
        vendor: null,
        category: null,
        image: product.imageUrl,
        officialMin: null,
        officialMax: null,
        officialAvailable: null
      }, index));
    }

    const consumedOffset = currentOffset + take.length;
    if (consumedOffset < products.length) {
      nextCursor = encodeCursor(currentSitemap, consumedOffset);
      break;
    }

    currentSitemap += 1;
    currentOffset = 0;
    nextCursor = currentSitemap < sitemaps.length ? encodeCursor(currentSitemap, 0) : null;
  }

  return {
    mode: 'browse',
    items,
    meta: metaFor(index, items.length, {
      page,
      pageSize: PAGE_SIZE,
      totalPages: Math.ceil(index.catalogProductCount / PAGE_SIZE)
    }),
    nextCursor
  };
}

function detailImages(product, title) {
  const sources = [];
  if (product.featured_image) sources.push(product.featured_image);
  if (Array.isArray(product.images)) sources.push(...product.images.slice(0, MAX_DETAIL_IMAGES));
  const seen = new Set();
  const images = [];
  for (const source of sources) {
    const image = imageObject(source, title);
    if (!image || seen.has(image.src)) continue;
    seen.add(image.src);
    images.push(image);
    if (images.length === MAX_DETAIL_IMAGES) break;
  }
  return images;
}

function detailVariants(product) {
  if (!Array.isArray(product.variants)) return [];
  if (product.variants.length > MAX_DETAIL_VARIANTS) throw new UpstreamError('upstream_response_too_large');
  return product.variants.map(variant => {
    if (!variant || typeof variant !== 'object') return null;
    const amount = parseShopifyPence(variant.price);
    if (amount === null) return null;
    return {
      title: safeText(variant.title, 200) || 'Default',
      sku: safePartNumber(variant.sku),
      mpn: safePartNumber(variant.mpn),
      available: Boolean(variant.available),
      price: { currency: 'GBP', amount }
    };
  }).filter(Boolean);
}

async function detailCatalog(fetchImpl, index, handle) {
  const payload = await fetchJson(fetchImpl, `${officialProductUrl(handle)}.js?country=KW`, { maxBytes: 2_000_000 });
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new UpstreamError('upstream_invalid_response');
  const officialHandle = productHandle(payload.handle) || handle;
  if (officialHandle !== handle) throw new UpstreamError('upstream_invalid_response');
  const title = safeText(payload.title, 300);
  if (!title) throw new UpstreamError('upstream_invalid_response');
  if (Array.isArray(payload.variants) && payload.variants.length > MAX_DETAIL_VARIANTS) {
    throw new UpstreamError('upstream_response_too_large');
  }
  const officialSkus = mergePartNumbers(
    [payload.sku],
    Array.isArray(payload.variants) ? payload.variants.map(variant => variant?.sku) : []
  );
  const officialMpns = mergePartNumbers(
    [payload.mpn],
    Array.isArray(payload.variants) ? payload.variants.map(variant => variant?.mpn) : []
  );
  const variants = detailVariants(payload);
  const variantPrices = variants.map(variant => variant.price.amount);
  const officialMin = variantPrices.length ? Math.min(...variantPrices) : parseShopifyPence(payload.price);
  const officialMax = variantPrices.length ? Math.max(...variantPrices) : officialMin;
  const officialAvailable = typeof payload.available === 'boolean'
    ? payload.available
    : (variants.length ? variants.some(variant => variant.available) : null);
  const images = detailImages(payload, title);
  const card = baseCard({
    handle,
    title,
    vendor: payload.vendor,
    category: payload.type,
    image: images[0],
    officialMin,
    officialMax,
    officialAvailable,
    officialSkus,
    officialMpns,
    includeAllPartNumbers: true
  }, index);
  return {
    mode: 'detail',
    product: {
      ...card,
      description: safeText(payload.description || payload.content || payload.body_html, 5_000),
      images,
      variants
    },
    meta: metaFor(index, 1)
  };
}

function createSearchRateLimiter(now, { limit = SEARCH_RATE_LIMIT, windowMs = SEARCH_RATE_WINDOW_MS } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowMs) || windowMs < 1_000) throw new Error('invalid_search_rate_limit');
  const buckets = new Map();
  return req => {
    const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    const identity = forwarded || String(req.headers?.host || req.headers?.['x-forwarded-host'] || 'anonymous');
    const key = createHash('sha256').update(identity, 'utf8').digest('base64url').slice(0, 16);
    const timestamp = Number(now());
    const current = buckets.get(key);
    const bucket = !current || timestamp >= current.resetAt
      ? { count: 0, resetAt: timestamp + windowMs }
      : current;
    bucket.count += 1;
    buckets.delete(key);
    buckets.set(key, bucket);
    while (buckets.size > SEARCH_RATE_BUCKETS) buckets.delete(buckets.keys().next().value);
    return { allowed: bucket.count <= limit, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1_000)), limit, windowMs };
  };
}

export function createTegiwaCatalogHandler({
  fetchImpl = globalThis.fetch,
  stockIndex,
  remoteStockReader = null,
  sitemapManifest,
  catalogSummary,
  catalogLoader = loadDefaultCatalogShard,
  searchIndex,
  searchProviderLoader = loadDefaultSearchProvider,
  searchRateLimit,
  now = () => Date.now(),
  logger = console
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
  if (typeof catalogLoader !== 'function') throw new TypeError('A catalog loader is required.');
  if (typeof searchProviderLoader !== 'function') throw new TypeError('A search-index loader is required.');
  if (typeof now !== 'function') throw new TypeError('A clock function is required.');
  if (remoteStockReader !== null && typeof remoteStockReader?.getIndex !== 'function') {
    throw new TypeError('A remote stock reader with getIndex is required.');
  }
  const index = stockIndex ? validateStockIndex(stockIndex) : loadDefaultStockIndex();
  const sitemaps = sitemapManifest ? validateSitemapManifest({ version: 1, sitemaps: sitemapManifest }) : loadDefaultSitemapManifest();
  const summary = catalogSummary
    ? validateCatalogSummary(catalogSummary)
    : (stockIndex ? { productCount: index.productCount, shardProductCounts: null } : loadDefaultCatalogSummary());
  if (summary.shardProductCounts && summary.shardProductCounts.length !== sitemaps.length) throw new Error('invalid_catalog_summary');
  let provider = searchIndex ? injectedSearchProvider(searchIndex) : null;
  const rateLimit = createSearchRateLimiter(now, searchRateLimit);
  const searchProvider = () => {
    if (!provider) provider = searchProviderLoader();
    if (!provider || provider.productCount !== summary.productCount) throw new Error('search_catalog_count_mismatch');
    if (!Array.isArray(summary.shardProductCounts)) throw new Error('search_catalog_page_index_unavailable');
    return provider;
  };

  return async function tegiwaCatalogHandler(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return sendError(res, 405, 'method_not_allowed', 'Only GET requests are allowed.');
    }
    if (!requestIsSameOrigin(req)) return sendError(res, 403, 'origin_not_allowed', 'Cross-origin catalog requests are not allowed.');

    try {
      const request = determineMode(req);
      let currentIndex = index;
      if (remoteStockReader) {
        try {
          currentIndex = await remoteStockReader.getIndex(index) || index;
        } catch {
          currentIndex = index;
        }
      }
      const requestIndex = {
        ...currentIndex,
        catalogProductCount: summary.productCount,
        stockSnapshotFresh: stockSnapshotIsFresh(currentIndex, Number(now()))
      };
      let body;
      if (request.mode === 'search' || request.mode === 'suggest') {
        const rate = rateLimit(req);
        res.setHeader('RateLimit-Policy', `${rate.limit};w=${Math.ceil(rate.windowMs / 1_000)}`);
        if (!rate.allowed) {
          res.setHeader('Retry-After', String(rate.retryAfter));
          return sendError(res, 429, 'rate_limited', 'Too many catalog searches were requested. Please try again shortly.');
        }
        const localProvider = searchProvider();
        body = request.mode === 'search'
          ? await searchCatalog(localProvider, requestIndex, summary, request, catalogLoader)
          : await suggestCatalog(localProvider, requestIndex, summary, request.query, catalogLoader);
      }
      else if (request.mode === 'detail') body = await detailCatalog(fetchImpl, requestIndex, request.handle);
      else {
        const position = request.page === undefined
          ? { sitemapIndex: request.sitemapIndex, offset: request.offset }
          : catalogPositionForPage(summary, request.page, sitemaps.length);
        const page = request.page ?? catalogPageForPosition(summary, position.sitemapIndex, position.offset, sitemaps.length);
        body = await browseCatalog(requestIndex, sitemaps, position.sitemapIndex, position.offset, page, catalogLoader);
      }
      return sendJson(res, 200, body, true);
    } catch (error) {
      if (error instanceof PublicApiError) return sendError(res, error.status, error.code, error.message);
      if (error instanceof UpstreamError) {
        logger?.warn?.('Tegiwa upstream request failed', { code: error.code, status: error.upstreamStatus || 0 });
        if (error.upstreamStatus === 404) return sendError(res, 404, 'product_not_found', 'The requested Tegiwa product was not found.');
        if (error.code === 'upstream_timeout') return sendError(res, 504, 'upstream_timeout', 'The official Tegiwa catalog took too long to respond.');
        return sendError(res, 502, 'upstream_unavailable', 'The official Tegiwa catalog is temporarily unavailable.');
      }
      console.error('Tegiwa catalog proxy failed', error instanceof Error ? error.message : 'unknown_error');
      return sendError(res, 500, 'internal_error', 'The catalog request could not be completed.');
    }
  };
}

function loadConfiguredRemoteStockReader() {
  const manifestUrl = process.env.TEGIWA_STOCK_MANIFEST_URL;
  if (!manifestUrl) return null;
  const manifestSecret = process.env.TEGIWA_STOCK_MANIFEST_SECRET;
  if (!validTegiwaManifestSecret(manifestSecret)) {
    throw new Error('TEGIWA_STOCK_MANIFEST_SECRET is required when TEGIWA_STOCK_MANIFEST_URL is configured.');
  }
  const summary = validateSearchSummary(JSON.parse(readFileSync(SEARCH_SUMMARY_URL, 'utf8')));
  return createRemoteTegiwaStockReader({
    manifestUrl,
    manifestSecret,
    expectedSkuMappingFingerprint: summary.skuMappingSha256
  });
}

const handler = createTegiwaCatalogHandler({ remoteStockReader: loadConfiguredRemoteStockReader() });
export default handler;
