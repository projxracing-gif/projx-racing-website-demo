import { createHash } from 'node:crypto';

const OFFICIAL_ORIGIN = 'https://www.tegiwa.com';
const OFFICIAL_IMAGE_HOSTS = new Set(['cdn.shopify.com']);
const COUNTRY_CODE = 'KW';
const CURRENCY = 'GBP';
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BYTES = 1_000_000;
const DEFAULT_LIVE_TTL_MS = 5 * 60_000;
const PUBLIC_CART_VARIANT_LIMIT = 100;
const MAX_CART_ITEMS = 20;
const MAX_HANDLE_LENGTH = 255;
const MAX_VARIANTS = 512;
const MAX_SKU_LENGTH = 120;
const MAX_TITLE_LENGTH = 300;
const HANDLE_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+:/#()& -]*$/;

const SUPPLIER = Object.freeze({
  slug: 'tegiwa',
  name: 'Tegiwa',
  originId: 'tegiwa-gb',
  originCountryCode: 'GB',
  originCountryName: 'Great Britain'
});

const ORIGIN = Object.freeze({
  id: 'tegiwa-gb',
  countryCode: 'GB',
  countryName: 'Great Britain'
});

export const TEGIWA_LIVE_COMMERCE = Object.freeze({
  officialOrigin: OFFICIAL_ORIGIN,
  countryCode: COUNTRY_CODE,
  currency: CURRENCY,
  maxCartItems: MAX_CART_ITEMS,
  maxPublicCartVariants: PUBLIC_CART_VARIANT_LIMIT,
  defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
  defaultMaxBytes: DEFAULT_MAX_BYTES,
  defaultLiveTtlMs: DEFAULT_LIVE_TTL_MS,
  purchaseMode: 'availability-confirmation-required',
  paymentAllowed: false,
  paymentStatus: 'not_collected',
  stockReserved: false,
  supplier: SUPPLIER,
  origin: ORIGIN
});

export class TegiwaLiveCommerceError extends Error {
  constructor(code, status = 502, cause = undefined) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = 'TegiwaLiveCommerceError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, status = 502, cause = undefined) {
  throw new TegiwaLiveCommerceError(code, status, cause);
}

function strictHandle(value) {
  if (!isCanonicalTegiwaLiveHandle(value)) {
    fail('invalid_tegiwa_handle', 400);
  }
  return value;
}

export function isCanonicalTegiwaLiveHandle(value) {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= MAX_HANDLE_LENGTH
    && HANDLE_PATTERN.test(value);
}

function upstreamHandle(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_HANDLE_LENGTH || !HANDLE_PATTERN.test(value)) {
    fail('upstream_invalid_response');
  }
  return value;
}

function strictSku(value) {
  if (!isCanonicalTegiwaLiveSku(value)) {
    fail('upstream_invalid_sku');
  }
  return value;
}

export function isCanonicalTegiwaLiveSku(value) {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= MAX_SKU_LENGTH
    && value === value.trim()
    && SKU_PATTERN.test(value)
    && !/^(?:javascript|data|vbscript):/i.test(value);
}

function canonicalText(value, limit = MAX_TITLE_LENGTH) {
  if (typeof value !== 'string') fail('upstream_invalid_response');
  const text = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (!text || text.length > limit || /[\u0000-\u001F\u007F<>]/u.test(text)) fail('upstream_invalid_response');
  return text;
}

function submittedText(value, limit) {
  if (typeof value !== 'string' || value.length < 1 || value.length > limit || value !== value.trim()
      || /[\u0000-\u001F\u007F]/u.test(value)) {
    fail('invalid_tegiwa_cart_item', 400);
  }
  return value;
}

function positivePence(value, upstream = true) {
  const validString = typeof value === 'string' && /^[1-9]\d{0,8}$/.test(value);
  const number = validString ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number < 1 || number > 100_000_000) {
    fail(upstream ? 'upstream_invalid_price' : 'invalid_tegiwa_cart_item', upstream ? 502 : 400);
  }
  return number;
}

function submittedPence(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) fail('invalid_tegiwa_cart_item', 400);
  const pence = Math.round(value * 100);
  if (!Number.isSafeInteger(pence) || Math.abs(value * 100 - pence) > 1e-7) fail('invalid_tegiwa_cart_item', 400);
  return pence;
}

function resolverNow(now) {
  const value = typeof now === 'function' ? Number(now()) : Number(now ?? Date.now());
  if (!Number.isFinite(value) || value < 0 || value > 8_640_000_000_000_000) fail('invalid_resolver_clock', 500);
  return value;
}

function boundedOption(value, fallback, minimum, maximum, code) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) fail(code, 500);
  return number;
}

function officialProductUrl(handle) {
  const safeHandle = strictHandle(handle);
  const url = new URL(`/products/${safeHandle}.js`, OFFICIAL_ORIGIN);
  url.searchParams.set('country', COUNTRY_CODE);
  return url;
}

function isExactOfficialProductUrl(value, handle) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.origin === OFFICIAL_ORIGIN
      && !url.username
      && !url.password
      && !url.port
      && url.pathname === `/products/${handle}.js`
      && url.searchParams.size === 1
      && url.searchParams.get('country') === COUNTRY_CODE
      && !url.hash;
  } catch {
    return false;
  }
}

function canonicalImageUrl(value) {
  const candidate = value && typeof value === 'object' && !Array.isArray(value)
    ? (value.src || value.url)
    : value;
  if (typeof candidate !== 'string' || candidate.length < 1 || candidate.length > 2_000) return null;
  const absolute = candidate.startsWith('//') ? `https:${candidate}` : candidate;
  try {
    const url = new URL(absolute);
    if (url.protocol !== 'https:' || !OFFICIAL_IMAGE_HOSTS.has(url.hostname) || url.username || url.password || url.port || url.hash) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function firstProductImage(payload) {
  const candidates = [payload.featured_image, payload.image, ...(Array.isArray(payload.images) ? payload.images : [])];
  for (const candidate of candidates) {
    const src = canonicalImageUrl(candidate);
    if (src) return src;
  }
  return null;
}

function itemTitle(productTitle, variantTitle) {
  return /^(?:default|default title)$/i.test(variantTitle)
    ? productTitle
    : `${productTitle} — ${variantTitle}`;
}

export function canonicalTegiwaLiveProductId(sourceHandle, sku) {
  const handle = strictHandle(sourceHandle);
  const safeSku = strictSku(sku);
  const digest = createHash('sha256').update(`${handle}\u0000${safeSku}`, 'utf8').digest('base64url').slice(0, 24);
  return `tegiwa-live-${digest}`;
}

async function cappedResponseText(response, maxBytes) {
  const rawLength = response.headers?.get?.('content-length');
  if (rawLength && /^\d+$/.test(rawLength) && Number(rawLength) > maxBytes) fail('upstream_response_too_large');

  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array)) fail('upstream_invalid_response');
        total += value.byteLength;
        if (total > maxBytes) {
          try { await reader.cancel(); } catch { /* best effort */ }
          fail('upstream_response_too_large');
        }
        chunks.push(value);
      }
    } finally {
      try { reader.releaseLock(); } catch { /* best effort */ }
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) {
      fail('upstream_invalid_encoding', 502, error);
    }
  }

  if (typeof response.arrayBuffer === 'function') {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) fail('upstream_response_too_large');
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch (error) {
      fail('upstream_invalid_encoding', 502, error);
    }
  }

  fail('upstream_invalid_response');
}

function canonicalizeLiveProduct(payload, requestedHandle, sourceUrl, observedAtMs, liveTtlMs) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('upstream_invalid_response');
  const responseHandle = upstreamHandle(payload.handle);
  if (responseHandle !== requestedHandle) fail('upstream_product_mismatch');
  const productTitle = canonicalText(payload.title);
  if (!Array.isArray(payload.variants) || payload.variants.length < 1 || payload.variants.length > MAX_VARIANTS) {
    fail('upstream_invalid_variants');
  }
  const fallbackImage = firstProductImage(payload);
  const seenSkus = new Set();
  const seenProductIds = new Set();
  const variants = payload.variants.map(rawVariant => {
    if (!rawVariant || typeof rawVariant !== 'object' || Array.isArray(rawVariant) || typeof rawVariant.available !== 'boolean') {
      fail('upstream_invalid_variant');
    }
    const variantTitle = canonicalText(rawVariant.title || 'Default Title', 200);
    const sku = strictSku(rawVariant.sku);
    if (seenSkus.has(sku)) fail('upstream_duplicate_sku');
    seenSkus.add(sku);
    const pricePence = positivePence(rawVariant.price);
    const productId = canonicalTegiwaLiveProductId(requestedHandle, sku);
    if (seenProductIds.has(productId)) fail('upstream_duplicate_product_id');
    seenProductIds.add(productId);
    const title = itemTitle(productTitle, variantTitle);
    const imageSrc = canonicalImageUrl(rawVariant.featured_image) || fallbackImage;
    if (!imageSrc) fail('upstream_invalid_image');
    return {
      productId,
      title,
      variantTitle,
      sku,
      currency: CURRENCY,
      unitAmount: pricePence / 100,
      pricePence,
      supplierAvailable: rawVariant.available,
      image: { src: imageSrc, alt: title }
    };
  });
  const observedAt = new Date(observedAtMs).toISOString();
  const expiresAt = new Date(observedAtMs + liveTtlMs).toISOString();
  return {
    sourceHandle: requestedHandle,
    sourceUrl: sourceUrl.toString(),
    productTitle,
    currency: CURRENCY,
    supplier: { ...SUPPLIER },
    origin: { ...ORIGIN },
    purchaseMode: TEGIWA_LIVE_COMMERCE.purchaseMode,
    availabilityConfirmationRequired: true,
    paymentAllowed: false,
    paymentStatus: TEGIWA_LIVE_COMMERCE.paymentStatus,
    stockReserved: false,
    observedAt,
    expiresAt,
    variants
  };
}

export function canonicalizeTegiwaLiveProductPayload(payload, sourceHandle, options = {}) {
  const handle = strictHandle(sourceHandle);
  const observedAtMs = resolverNow(options.now);
  const liveTtlMs = boundedOption(options.liveTtlMs, DEFAULT_LIVE_TTL_MS, 1_000, 10 * 60_000, 'invalid_tegiwa_live_ttl');
  return canonicalizeLiveProduct(payload, handle, officialProductUrl(handle), observedAtMs, liveTtlMs);
}

function publicCatalogueImage(image, fallbackTitle) {
  return {
    src: image.src,
    alt: image.alt || fallbackTitle
  };
}

export function decorateTegiwaLiveCatalogueProduct(product, payload, sourceHandle, options = {}) {
  if (!product || typeof product !== 'object' || Array.isArray(product)) fail('invalid_tegiwa_catalogue_product', 500);
  const live = canonicalizeTegiwaLiveProductPayload(payload, sourceHandle, options);
  const existingVariants = Array.isArray(product.variants) ? product.variants : [];
  const existingBySku = new Map(existingVariants
    .filter(variant => variant && typeof variant === 'object' && typeof variant.sku === 'string')
    .map(variant => [variant.sku, variant]));
  const cartEligible = live.variants.length <= PUBLIC_CART_VARIANT_LIMIT;
  const variants = live.variants.map(variant => ({
    ...(existingBySku.get(variant.sku) || {}),
    title: variant.variantTitle,
    sku: variant.sku,
    available: variant.supplierAvailable,
    price: { currency: variant.currency, amount: variant.unitAmount },
    cartProductId: cartEligible ? variant.productId : null
  }));
  const canonicalImages = [];
  const seenImages = new Set();
  for (const variant of live.variants) {
    if (seenImages.has(variant.image.src)) continue;
    seenImages.add(variant.image.src);
    canonicalImages.push(publicCatalogueImage(variant.image, live.productTitle));
  }
  const minimum = Math.min(...live.variants.map(variant => variant.unitAmount));
  const maximum = Math.max(...live.variants.map(variant => variant.unitAmount));
  const { commerceObservation: _discardedObservation, ...baseProduct } = product;
  return {
    ...baseProduct,
    title: live.productTitle,
    image: canonicalImages[0],
    images: canonicalImages,
    sku: variants.length === 1 ? variants[0].sku : null,
    skuCount: variants.length,
    skuState: variants.length === 1 ? 'exact' : 'multiple',
    skus: variants.map(variant => variant.sku),
    price: { currency: CURRENCY, min: minimum, max: maximum, note: 'Tegiwa online price excluding UK VAT' },
    sourceUrl: live.sourceUrl.replace(/\.js\?country=KW$/, ''),
    supplier: { slug: SUPPLIER.slug, name: SUPPLIER.name },
    variants,
    ...(cartEligible ? {
      commerceObservation: {
        source: 'official_tegiwa_product_detail',
        observedAt: live.observedAt,
        expiresAt: live.expiresAt,
        priceCurrency: CURRENCY,
        availabilityMode: 'supplier_variant_boolean',
        paymentEligible: false
      }
    } : {})
  };
}

export async function fetchOfficialTegiwaProductPayload(sourceHandle, options = {}) {
  const handle = strictHandle(sourceHandle);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') fail('tegiwa_fetch_unavailable', 500);
  const timeoutMs = boundedOption(options.timeoutMs, DEFAULT_TIMEOUT_MS, 10, 15_000, 'invalid_tegiwa_timeout');
  const maxBytes = boundedOption(options.maxBytes, DEFAULT_MAX_BYTES, 1_024, 2_000_000, 'invalid_tegiwa_max_bytes');
  const sourceUrl = officialProductUrl(handle);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetchImpl(sourceUrl.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal
    });
    if (!response || typeof response !== 'object') fail('upstream_invalid_response');
    if (response.redirected === true || (response.url && !isExactOfficialProductUrl(response.url, handle))) {
      fail('upstream_redirect_not_allowed');
    }
    if (response.status === 404) fail('upstream_product_not_found', 404);
    if (response.status !== 200 || response.ok !== true) fail('upstream_unavailable');
    const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
    const isOfficialProductJson = /^(?:application\/(?:[a-z0-9!#$&^_.+-]+\+)?json|(?:application|text)\/javascript)(?:\s*;|$)/i.test(contentType);
    if (!isOfficialProductJson) {
      fail('upstream_invalid_content_type');
    }
    const text = await cappedResponseText(response, maxBytes);
    try {
      return JSON.parse(text);
    } catch (error) {
      fail('upstream_invalid_json', 502, error);
    }
  } catch (error) {
    if (error instanceof TegiwaLiveCommerceError) throw error;
    if (controller.signal.aborted || error?.name === 'AbortError') fail('upstream_timeout', 504, error);
    fail('upstream_fetch_failed', 502, error);
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchTegiwaLiveProduct(sourceHandle, options = {}) {
  const payload = await fetchOfficialTegiwaProductPayload(sourceHandle, options);
  return canonicalizeTegiwaLiveProductPayload(payload, sourceHandle, options);
}

function normalizeSubmittedItem(submitted) {
  if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) fail('invalid_tegiwa_cart_item', 400);
  const sourceHandle = strictHandle(submitted.sourceHandle);
  const sku = submittedText(submitted.sku, MAX_SKU_LENGTH);
  if (!SKU_PATTERN.test(sku)) fail('invalid_tegiwa_cart_item', 400);
  const productId = submittedText(submitted.productId, 100);
  if (productId !== canonicalTegiwaLiveProductId(sourceHandle, sku)) fail('tegiwa_cart_item_mismatch', 409);
  const quantity = Number(submitted.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) fail('invalid_tegiwa_cart_item', 400);
  const pricePence = submittedPence(submitted.unitAmount);
  if (submitted.currency !== CURRENCY) fail('tegiwa_cart_item_mismatch', 409);
  const title = submitted.title === undefined ? null : submittedText(submitted.title, MAX_TITLE_LENGTH + 203);
  return { productId, sourceHandle, sku, quantity, pricePence, currency: CURRENCY, title };
}

function canonicalCartItem(submitted, product) {
  const variant = product.variants.find(item => item.sku === submitted.sku);
  if (!variant || variant.productId !== submitted.productId || variant.pricePence !== submitted.pricePence
      || variant.currency !== submitted.currency || (submitted.title !== null && submitted.title !== variant.title)) {
    fail('tegiwa_cart_item_mismatch', 409);
  }
  return {
    productId: variant.productId,
    sourceHandle: product.sourceHandle,
    sourceUrl: product.sourceUrl,
    title: variant.title,
    sku: variant.sku,
    quantity: submitted.quantity,
    unitAmount: variant.unitAmount,
    currency: variant.currency,
    image: { ...variant.image },
    variant: {
      title: variant.variantTitle,
      sku: variant.sku,
      supplierAvailable: variant.supplierAvailable
    },
    supplierAvailable: variant.supplierAvailable,
    supplier: { ...product.supplier },
    origin: { ...product.origin },
    purchaseMode: product.purchaseMode,
    availabilityConfirmationRequired: true,
    paymentAllowed: false,
    paymentStatus: product.paymentStatus,
    stockReserved: false,
    observedAt: product.observedAt,
    expiresAt: product.expiresAt
  };
}

export async function resolveTegiwaLiveCartItems(submittedItems, options = {}) {
  if (!Array.isArray(submittedItems) || submittedItems.length < 1 || submittedItems.length > MAX_CART_ITEMS) {
    fail('invalid_tegiwa_cart_items', 400);
  }
  const submitted = submittedItems.map(normalizeSubmittedItem);
  const seenProductIds = new Set();
  for (const item of submitted) {
    if (seenProductIds.has(item.productId)) fail('duplicate_tegiwa_cart_item', 409);
    seenProductIds.add(item.productId);
  }

  const productsByHandle = new Map();
  for (const item of submitted) {
    if (!productsByHandle.has(item.sourceHandle)) {
      productsByHandle.set(item.sourceHandle, fetchTegiwaLiveProduct(item.sourceHandle, options));
    }
  }
  await Promise.all(productsByHandle.values());
  const resolvedByHandle = new Map();
  for (const [handle, promise] of productsByHandle) resolvedByHandle.set(handle, await promise);
  return submitted.map(item => canonicalCartItem(item, resolvedByHandle.get(item.sourceHandle)));
}

export async function resolveTegiwaLiveCartItem(submittedItem, options = {}) {
  const [resolved] = await resolveTegiwaLiveCartItems([submittedItem], options);
  return resolved;
}

export const validateTegiwaLiveCartItems = resolveTegiwaLiveCartItems;
