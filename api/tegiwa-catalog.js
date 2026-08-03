import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const OFFICIAL_ORIGIN = 'https://www.tegiwa.com';
const SHOPIFY_ORIGIN = 'https://tegiwa.myshopify.com';
const PAGE_SIZE = 24;
const MAX_SEARCH_RESULTS = 10;
const MAX_SITEMAPS = 512;
const MAX_SITEMAP_PRODUCTS = 50_000;
const MAX_PRODUCT_HANDLE_LENGTH = 255;
const MAX_CATALOG_SHARDS_PER_REQUEST = 8;
const MAX_CACHED_CATALOG_SHARDS = 4;
const MAX_DETAIL_IMAGES = 16;
const MAX_DETAIL_VARIANTS = 50;
const MAX_STOCK_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const DEFAULT_TIMEOUT_MS = 7_000;
const JSON_RESPONSE_BYTES = 2_000_000;
const CACHE_CONTROL = 'public, max-age=60, s-maxage=300, stale-while-revalidate=300';
const STOCK_INDEX_URL = new URL('./data/tegiwa-stock-index.json', import.meta.url);
const SITEMAP_MANIFEST_URL = new URL('./data/tegiwa-sitemap-manifest.json', import.meta.url);
const CATALOG_SHARD_DIRECTORY_URL = new URL('./data/tegiwa-catalog-pages/', import.meta.url);

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
    checkedAt: null,
    productCount: 0,
    availableProductCount: 0,
    leadTimes: [],
    products: Object.create(null)
  };
}

function validateStockIndex(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || candidate.version !== 1) return emptyStockIndex();
  const products = candidate.products && typeof candidate.products === 'object' && !Array.isArray(candidate.products)
    ? candidate.products
    : Object.create(null);
  return {
    checkedAt: safeCheckedAt(candidate.checkedAt),
    productCount: safeInteger(candidate.productCount, 0, 10_000_000) ?? 0,
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
    if (!defaultStockIndex.checkedAt || defaultStockIndex.productCount < 1) throw new Error('empty_stock_index');
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

function stockSnapshotIsFresh(index, nowValue) {
  if (!index.checkedAt) return false;
  const endOfCheckedDay = Date.parse(`${index.checkedAt.slice(0, 10)}T23:59:59.999Z`);
  return Number.isFinite(endOfCheckedDay) && Number.isFinite(nowValue) && nowValue <= endOfCheckedDay + MAX_STOCK_AGE_MS;
}

function stockForTitle(index, title) {
  const key = stockKeyForTitle(title);
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
      note: 'RRP'
    };
  }
  if (officialMin === null) return { currency: 'GBP', min: null, max: null, note: null };
  const maximum = officialMax === null ? officialMin : officialMax;
  return {
    currency: 'GBP',
    min: Math.min(officialMin, maximum),
    max: Math.max(officialMin, maximum),
    note: 'Tegiwa online price'
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

function baseCard({ handle, title, vendor, category, image, officialMin, officialMax, officialAvailable }, index) {
  const stock = stockForTitle(index, title);
  return {
    handle,
    title: safeText(title, 300),
    vendor: safeText(vendor, 160) || null,
    category: safeText(category, 160) || null,
    image: imageObject(image, title),
    price: priceObject(stock, officialMin, officialMax),
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

function isAllowedUpstreamUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    if (url.hostname === 'tegiwa.myshopify.com') return url.pathname === '/search/suggest.json';
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

function determineMode(req) {
  const rawQuery = requestParameter(req, 'q');
  const rawHandle = requestParameter(req, 'handle');
  const rawCursor = requestParameter(req, 'cursor');
  const supplied = [rawQuery !== undefined, rawHandle !== undefined, rawCursor !== undefined].filter(Boolean).length;
  if (supplied > 1) throw new PublicApiError(400, 'invalid_parameters', 'Use only one catalog mode per request.');

  if (rawQuery !== undefined) {
    const query = cleanSingleParameter(rawQuery, 81);
    const length = Array.from(query).length;
    if (length < 2 || length > 80) throw new PublicApiError(400, 'invalid_query', 'Search queries must contain between 2 and 80 characters.');
    return { mode: 'search', query };
  }

  if (rawHandle !== undefined) {
    const raw = Array.isArray(rawHandle) ? '' : String(rawHandle).trim();
    if (raw.length > MAX_PRODUCT_HANDLE_LENGTH || !productHandle(raw)) throw new PublicApiError(400, 'invalid_handle', 'The product handle is invalid.');
    return { mode: 'detail', handle: raw };
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
    stockSnapshotStale: Boolean(index.checkedAt && !index.stockSnapshotFresh),
    catalogProductCount: index.productCount,
    availableProductCount: index.availableProductCount,
    ...extra
  };
}

async function searchCatalog(fetchImpl, index, query) {
  const url = new URL('/search/suggest.json', SHOPIFY_ORIGIN);
  url.searchParams.set('q', query);
  url.searchParams.set('resources[type]', 'product');
  url.searchParams.set('resources[limit]', String(MAX_SEARCH_RESULTS));
  url.searchParams.set('resources[options][unavailable_products]', 'last');
  url.searchParams.set('resources[options][fields]', 'title,product_type,variants.title,variants.sku,vendor');
  const payload = await fetchJson(fetchImpl, url.toString(), { maxBytes: 1_500_000 });
  const source = payload?.resources?.results?.products;
  const items = (Array.isArray(source) ? source : [])
    .slice(0, MAX_SEARCH_RESULTS)
    .map(product => normalizeSearchProduct(product, index))
    .filter(Boolean);
  return {
    mode: 'search',
    items,
    meta: metaFor(index, items.length, { query }),
    nextCursor: null
  };
}

async function browseCatalog(index, sitemaps, sitemapIndex, offset, catalogLoader) {
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
    meta: metaFor(index, items.length),
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
  return product.variants.slice(0, MAX_DETAIL_VARIANTS).map(variant => {
    if (!variant || typeof variant !== 'object') return null;
    const amount = parseShopifyPence(variant.price);
    if (amount === null) return null;
    return {
      title: safeText(variant.title, 200) || 'Default',
      available: Boolean(variant.available),
      price: { currency: 'GBP', amount }
    };
  }).filter(Boolean);
}

async function detailCatalog(fetchImpl, index, handle) {
  const payload = await fetchJson(fetchImpl, `${officialProductUrl(handle)}.js`, { maxBytes: 2_000_000 });
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new UpstreamError('upstream_invalid_response');
  const officialHandle = productHandle(payload.handle) || handle;
  if (officialHandle !== handle) throw new UpstreamError('upstream_invalid_response');
  const title = safeText(payload.title, 300);
  if (!title) throw new UpstreamError('upstream_invalid_response');
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
    officialAvailable
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

export function createTegiwaCatalogHandler({ fetchImpl = globalThis.fetch, stockIndex, sitemapManifest, catalogLoader = loadDefaultCatalogShard, now = () => Date.now(), logger = console } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
  if (typeof catalogLoader !== 'function') throw new TypeError('A catalog loader is required.');
  if (typeof now !== 'function') throw new TypeError('A clock function is required.');
  const index = stockIndex ? validateStockIndex(stockIndex) : loadDefaultStockIndex();
  const sitemaps = sitemapManifest ? validateSitemapManifest({ version: 1, sitemaps: sitemapManifest }) : loadDefaultSitemapManifest();

  return async function tegiwaCatalogHandler(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return sendError(res, 405, 'method_not_allowed', 'Only GET requests are allowed.');
    }
    if (!requestIsSameOrigin(req)) return sendError(res, 403, 'origin_not_allowed', 'Cross-origin catalog requests are not allowed.');

    try {
      const request = determineMode(req);
      const requestIndex = { ...index, stockSnapshotFresh: stockSnapshotIsFresh(index, Number(now())) };
      let body;
      if (request.mode === 'search') body = await searchCatalog(fetchImpl, requestIndex, request.query);
      else if (request.mode === 'detail') body = await detailCatalog(fetchImpl, requestIndex, request.handle);
      else body = await browseCatalog(requestIndex, sitemaps, request.sitemapIndex, request.offset, catalogLoader);
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

const handler = createTegiwaCatalogHandler();
export default handler;
