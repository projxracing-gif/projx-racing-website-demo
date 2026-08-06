import '../assets/ecs-products.js';

const PAGE_SIZE = 100;
const SUGGESTION_LIMIT = 8;
const PRICE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

export const REVIEWED_ECS_PRODUCTS = Object.freeze([...(globalThis.PROJX_ECS_PRODUCTS || [])]);

export class ReviewedFallbackError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ReviewedFallbackError';
    this.status = status;
    this.code = code;
  }
}

function text(value, maximum = 500) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function identity(value) {
  return text(value, 2_000).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function identifierIdentity(value) {
  return identity(value).replace(/\s+/g, '');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function rootAsset(value) {
  const source = text(value, 1_000).replace(/^\/+/, '');
  return source ? `/${source}` : null;
}

function dateValue(value) {
  const source = text(value, 40);
  if (!source) return NaN;
  return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(source) ? `${source}T23:59:59.999Z` : source);
}

function priceIsFresh(product, nowValue) {
  const checkedAt = dateValue(product.priceVerifiedAt);
  const staleAfter = Number(product.staleAfterDays) * 24 * 60 * 60 * 1_000;
  const maximumAge = Number.isFinite(staleAfter) && staleAfter > 0 ? staleAfter : PRICE_MAX_AGE_MS;
  return Number.isFinite(checkedAt) && Number(nowValue) - checkedAt <= maximumAge;
}

function productSearchText(product) {
  return identity([
    product.title, product.brand, product.category, product.subcategory,
    product.ecsPartNumber, product.sku, product.mpn,
    ...(product.fitments || []).flatMap(fitment => [
      fitment.make, fitment.model, fitment.generation,
      ...(fitment.models || []), ...(fitment.chassis || []), ...(fitment.engines || [])
    ])
  ].join(' '));
}

function equalsOrContains(candidate, requested) {
  const left = identity(candidate);
  const right = identity(requested);
  if (!left || !right) return false;
  const leftTokens = new Set(left.split(' '));
  return left === right || right.split(' ').every(token => leftTokens.has(token));
}

function fitmentMatchesRequest(fitment, request) {
  if (request.make && !equalsOrContains(fitment.make, request.make)) return false;
  if (request.model && ![fitment.model, ...(fitment.models || [])].some(value => equalsOrContains(value, request.model))) return false;
  if (request.generation && ![
    fitment.generation, ...(fitment.chassis || [])
  ].some(value => equalsOrContains(value, request.generation))) return false;
  if (request.engine && !(fitment.engines || []).some(value => equalsOrContains(value, request.engine))) return false;
  if (request.year) {
    const hasRange = Number.isInteger(fitment.yearFrom) || Number.isInteger(fitment.yearTo);
    const hasOtherVehicleField = Boolean(request.make || request.model || request.generation || request.engine);
    if (!hasRange && !hasOtherVehicleField) return false;
    if (fitment.yearFrom && request.year < fitment.yearFrom) return false;
    if (fitment.yearTo && request.year > fitment.yearTo) return false;
  }
  return true;
}

function productVehicleMatches(product, request) {
  if (!request.structuredVehicle) return true;
  return (product.fitments || []).some(fitment => fitmentMatchesRequest(fitment, request));
}

function availabilityMatches(requested) {
  return requested === 'all' || requested === 'check';
}

function productMatches(product, request, nowValue) {
  if (request.supplier && request.supplier !== 'ecs') return false;
  if (request.currency && request.currency !== 'USD') return false;
  if (request.brand && request.brand !== product.brandSlug) return false;
  if (request.partType && ![product.categorySlug, product.subcategorySlug].includes(request.partType)) return false;
  if (!availabilityMatches(request.availability || 'all')) return false;
  const priced = priceIsFresh(product, nowValue) && Number.isFinite(Number(product.priceAmount));
  if (request.pricing === 'priced' && !priced) return false;
  if (request.pricing === 'request_price' && priced) return false;
  if (request.fitment === 'exact') return false;
  if (!productVehicleMatches(product, request)) return false;
  if (!request.query) return true;
  const exact = [product.ecsPartNumber, product.sku, product.mpn]
    .some(value => identifierIdentity(value) === identifierIdentity(request.query));
  if (exact) return true;
  const haystack = productSearchText(product);
  return unique(identity(request.query).split(' ')).every(token => haystack.includes(token));
}

function relevanceScore(product, query) {
  if (!query) return 0;
  const queryIdentifier = identifierIdentity(query);
  if ([product.ecsPartNumber, product.sku, product.mpn]
    .some(value => identifierIdentity(value) === queryIdentifier)) return 10_000;
  const haystack = productSearchText(product);
  return unique(identity(query).split(' ')).reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function sortProducts(products, request, nowValue) {
  return [...products].sort((left, right) => {
    if (request.sort === 'name_asc') return left.title.localeCompare(right.title);
    if (request.sort === 'name_desc') return right.title.localeCompare(left.title);
    if (request.sort === 'price_asc' || request.sort === 'price_desc') {
      const leftPrice = priceIsFresh(left, nowValue) ? Number(left.priceAmount) : null;
      const rightPrice = priceIsFresh(right, nowValue) ? Number(right.priceAmount) : null;
      if (leftPrice === null && rightPrice !== null) return 1;
      if (rightPrice === null && leftPrice !== null) return -1;
      if (leftPrice !== null && rightPrice !== null && leftPrice !== rightPrice) {
        return request.sort === 'price_asc' ? leftPrice - rightPrice : rightPrice - leftPrice;
      }
    }
    if (request.query) {
      const difference = relevanceScore(right, request.query) - relevanceScore(left, request.query);
      if (difference) return difference;
    }
    return left.title.localeCompare(right.title);
  });
}

function price(product, nowValue) {
  if (!priceIsFresh(product, nowValue)) return { currency: 'USD', min: null, max: null, note: 'Contact us for current price' };
  const amount = Number(product.priceAmount);
  return {
    currency: 'USD',
    min: Number.isFinite(amount) ? amount : null,
    max: Number.isFinite(amount) ? amount : null,
    note: `Public supplier retail price observed on ${text(product.priceVerifiedAt, 40)}; Projx selling price, shipping, customs and delivery are confirmed before order.`
  };
}

function availability(product, nowValue) {
  const checkedAt = text(product.checkedAt, 40) || null;
  const checkedValue = dateValue(checkedAt);
  const staleAfter = Number(product.staleAfterDays) * 24 * 60 * 60 * 1_000;
  const maximumAge = Number.isFinite(staleAfter) && staleAfter > 0 ? staleAfter : PRICE_MAX_AGE_MS;
  const snapshotStale = !Number.isFinite(checkedValue) || Number(nowValue) - checkedValue > maximumAge;
  const observation = text(product.observedAvailability, 180);
  return {
    code: 'check_availability',
    checkedAt,
    leadTime: snapshotStale
      ? 'Availability confirmation required; the previous supplier observation has expired.'
      : observation
      ? `Supplier listing observed: ${observation}. Availability and lead time require confirmation.`
      : 'Availability and lead time require confirmation.',
    snapshotStale
  };
}

function image(product) {
  const source = product.images?.[0];
  if (!source) return null;
  return {
    src: rootAsset(source.src),
    width: Number(source.width) || null,
    height: Number(source.height) || null,
    alt: text(source.alt || product.title, 220)
  };
}

function card(product, request, nowValue) {
  const hasVehicleContext = Boolean(request.structuredVehicle || request.fitment !== 'all');
  return {
    handle: product.publicKey,
    publicKey: product.publicKey,
    title: text(product.title, 300),
    vendor: text(product.brand, 160) || null,
    category: text([product.category, product.subcategory].filter(Boolean).join(' / '), 160) || null,
    image: image(product),
    sku: text(product.ecsPartNumber, 120) || null,
    skuCount: product.ecsPartNumber ? 1 : 0,
    skuState: product.ecsPartNumber ? 'exact' : 'not_supplied',
    mpn: text(product.mpn, 120) || null,
    mpnCount: product.mpn ? 1 : 0,
    price: price(product, nowValue),
    availability: availability(product, nowValue),
    sourceUrl: text(product.originalUrl, 2_048) || null,
    supplier: { slug: 'ecs', name: 'ECS Tuning' },
    fitmentConfidence: hasVehicleContext ? 'possible' : null
  };
}

export function reviewedEcsProductCard(product, request, nowValue) {
  if (!product || typeof product !== 'object' || !request || typeof request !== 'object') {
    throw new ReviewedFallbackError(500, 'invalid_reviewed_product', 'A reviewed ECS product could not be rendered.');
  }
  return card(product, request, nowValue);
}

function detailFitments(product) {
  return (product.fitments || []).map(fitment => ({
    confidence: 'possible',
    yearFrom: fitment.yearFrom || null,
    yearTo: fitment.yearTo || null,
    make: text(fitment.make, 80),
    model: text(fitment.model, 100),
    generation: text(fitment.generation, 120),
    chassis: unique((fitment.chassis || []).map(value => text(value, 40))),
    engine: text((fitment.engines || []).join(' / '), 120) || null,
    drivetrain: null,
    note: text(fitment.note, 300) || 'Fitment confirmation required before order.'
  }));
}

function detail(product, products, request, nowValue) {
  const base = card(product, request, nowValue);
  return {
    ...base,
    description: text(product.description || product.summary, 5_000),
    descriptionAr: text(product.descriptionAr || product.summaryAr, 5_000),
    images: (product.images || []).map(source => ({
      src: rootAsset(source.src), width: Number(source.width) || null, height: Number(source.height) || null,
      alt: text(source.alt || product.title, 220), altAr: text(source.altAr, 220) || null
    })).filter(item => item.src),
    variants: [],
    options: [],
    specifications: Array.isArray(product.specifications) ? product.specifications : [],
    fitments: detailFitments(product),
    relatedProducts: (product.relatedProductSlugs || []).map(slug => products.find(candidate => candidate.slug === slug))
      .filter(Boolean).map(candidate => card(candidate, { ...request, structuredVehicle: false, fitment: 'all' }, nowValue)),
    installation: product.installation || { status: 'confirmation-required' },
    shipping: product.shipping || { status: 'quote-required' },
    seo: product.seo || null,
    dataQuality: {
      status: 'reviewed-partial',
      detailedDescriptionAvailable: Boolean(product.detailedDescriptionAvailable),
      specificationsAvailable: Boolean(product.specifications?.length),
      exactFitmentAvailable: false,
      stockFeedAvailable: false
    }
  };
}

function responseRecorder() {
  return {
    statusCode: 0,
    headers: Object.create(null),
    body: '',
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    end(value = '') { this.body = String(value); }
  };
}

async function invokeLegacy(handler, originalRequest, parameters) {
  if (typeof handler !== 'function') return null;
  const query = Object.fromEntries(parameters.entries());
  const req = {
    ...originalRequest,
    method: 'GET',
    query,
    url: `/api/tegiwa-catalog?${parameters.toString()}`
  };
  const res = responseRecorder();
  await handler(req, res);
  let body;
  try { body = JSON.parse(res.body || '{}'); } catch { body = {}; }
  const status = Number(res.statusCode) || 500;
  if (status >= 400) {
    throw new ReviewedFallbackError(
      status,
      text(body?.error?.code, 80) || 'supplier_fallback_unavailable',
      text(body?.error?.message, 300) || 'The supplier fallback catalogue is unavailable.'
    );
  }
  return body;
}

function tegiwaHandle(value) {
  const source = text(value, 255);
  return source.startsWith('tegiwa-') ? source : `tegiwa-${source}`;
}

function normalizedLegacyCard(value, request) {
  const handle = tegiwaHandle(value?.handle || value?.publicKey);
  return {
    ...value,
    handle,
    publicKey: handle,
    supplier: value?.supplier || { slug: 'tegiwa', name: 'Tegiwa' },
    fitmentConfidence: request.structuredVehicle ? 'possible' : (value?.fitmentConfidence || null)
  };
}

function normalizedLegacyPayload(payload, request) {
  if (!payload) return null;
  if (Array.isArray(payload.items)) {
    return { ...payload, items: payload.items.map(item => normalizedLegacyCard(item, request)) };
  }
  if (payload.product) {
    return { ...payload, product: normalizedLegacyCard(payload.product, request) };
  }
  if (Array.isArray(payload.suggestions)) {
    return {
      ...payload,
      suggestions: payload.suggestions.map(item => ({
        ...item,
        handle: tegiwaHandle(item.handle),
        supplier: item.supplier || { slug: 'tegiwa', name: 'Tegiwa' }
      }))
    };
  }
  return payload;
}

function legacyEligible(request) {
  if (request.supplier && request.supplier !== 'tegiwa') return false;
  if (request.currency && request.currency !== 'GBP') return false;
  if (request.brand || request.partType || request.fitment === 'exact') return false;
  if (request.fitment === 'possible' && !request.structuredVehicle) return false;
  const hasQuery = Boolean(request.query || request.structuredVehicle);
  if (!hasQuery && (request.availability !== 'all' || request.pricing !== 'all' || request.sort !== 'relevance')) return false;
  return true;
}

function legacySearchQuery(request) {
  return text([
    request.query,
    request.structuredVehicle ? request.make : null,
    request.structuredVehicle ? request.model : null,
    request.structuredVehicle ? request.generation : null,
    request.structuredVehicle ? request.engine : null,
    request.structuredVehicle && !request.make && !request.model ? request.year : null
  ].filter(Boolean).join(' '), 120);
}

function legacyListParameters(request, page) {
  const parameters = new URLSearchParams();
  const query = legacySearchQuery(request);
  if (query) {
    parameters.set('q', query);
    parameters.set('page', String(page));
    parameters.set('sort', request.sort || 'relevance');
    parameters.set('availability', request.availability || 'all');
    parameters.set('pricing', request.pricing || 'all');
    parameters.set('match', request.structuredVehicle ? 'vehicle' : (request.match || 'any'));
  } else {
    parameters.set('page', String(page));
  }
  return parameters;
}

function overallMeta({ request, localProducts, legacyMeta, count, totalResults, reason, nowValue, legacyError = null }) {
  const legacyCatalogCount = Number(legacyMeta?.catalogProductCount) || 0;
  const legacyAvailableCount = Number(legacyMeta?.availableProductCount) || 0;
  const legacyStockCount = Number(legacyMeta?.stockIndexedProductCount) || 0;
  const legacySkuCount = Number(legacyMeta?.skuIndexedProductCount) || 0;
  const localSkuCount = localProducts.filter(product => product.ecsPartNumber).length;
  const localPriceCount = localProducts.filter(product => priceIsFresh(product, nowValue)
    && Number.isFinite(Number(product.priceAmount))).length;
  const localSnapshotStale = localProducts.some(product => availability(product, nowValue).snapshotStale);
  const suppliers = unique([
    ...(legacyCatalogCount ? [{ slug: 'tegiwa', name: 'Tegiwa' }] : []),
    ...(localProducts.length ? [{ slug: 'ecs', name: 'ECS Tuning' }] : [])
  ].map(value => JSON.stringify(value))).map(value => JSON.parse(value));
  return {
    count,
    catalogProductCount: legacyCatalogCount + localProducts.length,
    stockIndexedProductCount: legacyStockCount + localPriceCount,
    skuIndexedProductCount: legacySkuCount + localSkuCount,
    availableProductCount: legacyAvailableCount,
    checkedAt: [legacyMeta?.checkedAt, ...localProducts.map(product => product.checkedAt)]
      .filter(Boolean).sort().at(-1) || null,
    stockSnapshotStale: Boolean(legacyMeta?.stockSnapshotStale || localSnapshotStale),
    suppliers,
    currencies: unique([...(legacyCatalogCount ? ['GBP'] : []), ...(localProducts.length ? ['USD'] : [])]),
    query: request.query || null,
    canonicalQuery: request.query || null,
    translated: false,
    corrected: false,
    corrections: [],
    page: request.page,
    pageSize: PAGE_SIZE,
    totalResults,
    totalPages: Math.ceil(totalResults / PAGE_SIZE),
    sort: request.sort,
    availability: request.availability,
    pricing: request.pricing,
    match: request.match,
    filters: {
      supplier: request.supplier, brand: request.brand, partType: request.partType,
      currency: request.currency, fitment: request.fitment, year: request.year,
      make: request.make, model: request.model, generation: request.generation, engine: request.engine
    },
    partialCatalogue: true,
    catalogueSource: 'reviewed-local-fallback',
    fallbackReason: reason,
    fallbackOrdering: 'reviewed-ecs-first-then-tegiwa',
    reviewedEcsProductCount: localProducts.length,
    fitmentPolicy: 'supplier-title-possible',
    ...(legacyError ? { supplierFallbackError: legacyError.code } : {})
  };
}

async function listResponse({ request, req, nowValue, reason, legacyHandler, products }) {
  const localAll = sortProducts(products.filter(product => productMatches(product, request, nowValue)), request, nowValue);
  const localSlice = localAll.slice(request.offset, request.offset + PAGE_SIZE);
  const items = localSlice.map(product => card(product, request, nowValue));
  let legacyMeta = null;
  let legacyTotal = 0;
  let legacyError = null;

  if (legacyHandler && legacyEligible(request) && items.length < PAGE_SIZE) {
    let legacyOffset = Math.max(0, request.offset - localAll.length);
    let page = Math.floor(legacyOffset / PAGE_SIZE) + 1;
    let skip = legacyOffset % PAGE_SIZE;
    while (items.length < PAGE_SIZE) {
      let payload;
      try {
        payload = normalizedLegacyPayload(
          await invokeLegacy(legacyHandler, req, legacyListParameters(request, page)),
          request
        );
      } catch (error) {
        if (error instanceof ReviewedFallbackError && error.status >= 500) {
          legacyError = error;
          break;
        }
        throw error;
      }
      legacyMeta ||= payload?.meta || {};
      legacyTotal = Number(payload?.meta?.totalResults ?? payload?.meta?.catalogProductCount) || 0;
      const pageItems = (payload?.items || []).slice(skip);
      items.push(...pageItems.slice(0, PAGE_SIZE - items.length));
      if (!pageItems.length || items.length >= PAGE_SIZE || page * PAGE_SIZE >= legacyTotal) break;
      page += 1;
      skip = 0;
    }
  }

  const totalResults = localAll.length + legacyTotal;
  if (request.offset > 0 && request.offset >= totalResults) {
    throw new ReviewedFallbackError(
      400,
      request.positionSource === 'cursor' ? 'invalid_cursor' : 'invalid_page',
      'The requested catalog position does not exist.'
    );
  }
  const nextOffset = request.offset + items.length;
  return {
    mode: request.mode,
    items,
    meta: overallMeta({
      request, localProducts: products, legacyMeta, count: items.length,
      totalResults, reason, nowValue, legacyError
    }),
    nextOffset: items.length === PAGE_SIZE && nextOffset < totalResults ? nextOffset : null
  };
}

async function suggestionResponse({ request, req, nowValue, reason, legacyHandler, products }) {
  const local = sortProducts(products.filter(product => productMatches(product, {
    ...request, availability: 'all', pricing: 'all', fitment: 'all', structuredVehicle: Boolean(
      request.year || request.make || request.model || request.generation || request.engine
    )
  }, nowValue)), { ...request, sort: 'relevance' }, nowValue).slice(0, SUGGESTION_LIMIT);
  const suggestions = local.map(product => ({
    query: product.title, label: product.title, kind: 'product',
    handle: product.publicKey, supplier: { slug: 'ecs', name: 'ECS Tuning' }
  }));
  let legacyMeta = null;
  let legacyError = null;
  if (legacyHandler && legacyEligible(request) && suggestions.length < SUGGESTION_LIMIT) {
    const parameters = new URLSearchParams({ q: request.query, suggest: '1' });
    try {
      const payload = normalizedLegacyPayload(await invokeLegacy(legacyHandler, req, parameters), request);
      legacyMeta = payload?.meta || {};
      const seen = new Set(suggestions.map(item => item.handle));
      for (const suggestion of payload?.suggestions || []) {
        if (!seen.has(suggestion.handle)) suggestions.push(suggestion);
        seen.add(suggestion.handle);
        if (suggestions.length === SUGGESTION_LIMIT) break;
      }
    } catch (error) {
      if (error instanceof ReviewedFallbackError && error.status >= 500) legacyError = error;
      else throw error;
    }
  }
  return {
    mode: 'suggest', suggestions,
    correction: { query: request.query, canonicalQuery: request.query, translated: false, corrected: false, corrections: [] },
    meta: {
      count: suggestions.length, limit: SUGGESTION_LIMIT,
      ...overallMeta({
        request: { ...request, page: 1, sort: 'relevance', availability: 'all', pricing: 'all', match: 'any' },
        localProducts: products, legacyMeta, count: suggestions.length,
        totalResults: suggestions.length, reason, nowValue, legacyError
      })
    },
    nextCursor: null
  };
}

async function detailResponse({ request, req, nowValue, reason, legacyHandler, products }) {
  const local = products.find(product => [product.publicKey, product.slug].includes(request.handle));
  const localAllowed = (!request.supplier || request.supplier === 'ecs') && (!request.currency || request.currency === 'USD');
  if (local && localAllowed) {
    return {
      mode: 'detail',
      product: detail(local, products, { ...request, structuredVehicle: false, fitment: 'all' }, nowValue),
      meta: {
        ...overallMeta({
          request: { ...request, page: 1, sort: 'relevance', availability: 'all', pricing: 'all', match: 'any' },
          localProducts: products, legacyMeta: null, count: 1, totalResults: 1, reason, nowValue
        }),
        count: 1
      }
    };
  }
  if (request.handle.startsWith('ecs-') || request.supplier === 'ecs' || !legacyHandler) {
    throw new ReviewedFallbackError(404, 'product_not_found', 'The requested product was not found.');
  }
  const sourceHandle = request.handle.startsWith('tegiwa-') ? request.handle.slice('tegiwa-'.length) : request.handle;
  let payload;
  try {
    payload = normalizedLegacyPayload(
      await invokeLegacy(legacyHandler, req, new URLSearchParams({ handle: sourceHandle })),
      request
    );
  } catch (detailError) {
    if (!(detailError instanceof ReviewedFallbackError) || detailError.status < 500) throw detailError;
    const snapshot = normalizedLegacyPayload(
      await invokeLegacy(legacyHandler, req, new URLSearchParams({ q: sourceHandle, page: '1' })),
      request
    );
    const card = (snapshot?.items || []).find(item => item.handle === tegiwaHandle(sourceHandle));
    if (!card) throw detailError;
    payload = {
      mode: 'detail',
      product: {
        ...card,
        description: '',
        images: card.image ? [card.image] : [],
        variants: [],
        detailSnapshotOnly: true
      },
      meta: {
        ...(snapshot?.meta || {}),
        count: 1,
        detailSnapshotOnly: true,
        detailFallbackReason: detailError.code
      }
    };
  }
  return {
    ...payload,
    meta: {
      ...(payload?.meta || {}),
      partialCatalogue: true,
      catalogueSource: 'reviewed-local-fallback',
      fallbackReason: reason,
      reviewedEcsProductCount: products.length,
      fitmentPolicy: 'supplier-title-possible',
      suppliers: [{ slug: 'tegiwa', name: 'Tegiwa' }, { slug: 'ecs', name: 'ECS Tuning' }],
      currencies: ['GBP', 'USD']
    }
  };
}

export async function reviewedFallbackResponse({
  request,
  req,
  nowValue,
  reason,
  legacyHandler = null,
  products = REVIEWED_ECS_PRODUCTS
}) {
  if (!Array.isArray(products) || products.length === 0) {
    throw new ReviewedFallbackError(503, 'service_unconfigured', 'No reviewed fallback products are configured.');
  }
  if (request.mode === 'detail') return detailResponse({ request, req, nowValue, reason, legacyHandler, products });
  if (request.mode === 'suggest') return suggestionResponse({ request, req, nowValue, reason, legacyHandler, products });
  return listResponse({ request, req, nowValue, reason, legacyHandler, products });
}

export const __test = Object.freeze({
  productMatches,
  sortProducts,
  card,
  detail,
  legacyEligible,
  legacySearchQuery
});
