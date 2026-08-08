import { createHash } from 'node:crypto';
import {
  REVIEWED_ECS_PRODUCTS,
  ReviewedFallbackError,
  reviewedFallbackResponse
} from '../server/ecs-reviewed-catalog.js';

const PAGE_SIZE = 100;
const SUGGESTION_LIMIT = 8;
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_OFFSET = 10_000_000;
const CACHE_CONTROL = 'public, max-age=30, s-maxage=120, stale-while-revalidate=300';
const SEARCH_RATE_LIMIT = 120;
const SEARCH_RATE_WINDOW_MS = 60_000;
const SEARCH_RATE_BUCKETS = 512;
const ALLOWED_PARAMETERS = new Set([
  'q', 'handle', 'page', 'cursor', 'suggest', 'sort', 'availability', 'pricing', 'match',
  'supplier', 'brand', 'partType', 'currency', 'fitment', 'year', 'make', 'model', 'generation', 'engine',
  'discovery'
]);
const SORTS = new Set(['relevance', 'name_asc', 'name_desc', 'price_asc', 'price_desc']);
const AVAILABILITY_FILTERS = new Set(['all', 'available', 'in_stock', 'supplier_stock', 'check', 'unavailable']);
const PRICING_FILTERS = new Set(['all', 'priced', 'request_price']);
const MATCHES = new Set(['any', 'vehicle']);
const FITMENT_FILTERS = new Set(['all', 'exact', 'possible']);
const IDENTIFIER_KINDS = "'sku', 'mpn', 'ecs'";

class PublicApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'PublicApiError';
    this.status = status;
    this.code = code;
  }
}

function singleValue(value, code = 'invalid_parameters') {
  if (Array.isArray(value)) throw new PublicApiError(400, code, 'Only one value is allowed for each parameter.');
  return value;
}

function requestValues(req) {
  const values = Object.create(null);
  const supplied = new Set(Object.keys(req.query || {}));
  let parsed;
  try {
    parsed = new URL(req.url || '/', 'https://local.invalid');
    for (const key of parsed.searchParams.keys()) supplied.add(key);
  } catch {
    throw new PublicApiError(400, 'invalid_parameters', 'The catalog request URL is invalid.');
  }
  if ([...supplied].some(key => !ALLOWED_PARAMETERS.has(key))) {
    throw new PublicApiError(400, 'invalid_parameters', 'The catalog request contains an unsupported parameter.');
  }
  for (const key of supplied) {
    const direct = req.query?.[key];
    const urlValues = parsed.searchParams.getAll(key);
    if (Array.isArray(direct) || urlValues.length > 1) {
      throw new PublicApiError(400, 'invalid_parameters', 'Only one value is allowed for each parameter.');
    }
    values[key] = direct !== undefined ? singleValue(direct) : urlValues[0];
  }
  return values;
}

function cleanText(value, maximum, label, { minimum = 1, pattern = null } = {}) {
  if (value === undefined) return null;
  const text = String(singleValue(value)).normalize('NFKC').trim().replace(/\s+/g, ' ');
  const length = Array.from(text).length;
  if (length < minimum || length > maximum || /[\u0000-\u001F\u007F-\u009F]/u.test(text)
    || /[<>`{}]/u.test(text) || (pattern && !pattern.test(text))) {
    throw new PublicApiError(400, `invalid_${label}`, `The ${label.replace(/[A-Z]/g, letter => ` ${letter.toLowerCase()}`)} parameter is invalid.`);
  }
  return text;
}

function enumValue(value, allowed, fallback, code) {
  if (value === undefined) return fallback;
  const normalized = String(singleValue(value)).trim().toLowerCase();
  if (!allowed.has(normalized)) throw new PublicApiError(400, code, `The requested ${code.replace('invalid_', '')} value is not supported.`);
  return normalized;
}

function positiveInteger(value, fallback = null) {
  if (value === undefined) return fallback;
  const raw = String(singleValue(value)).trim();
  if (!/^\d{1,8}$/.test(raw)) throw new PublicApiError(400, 'invalid_page', 'Catalog pages must be positive whole numbers.');
  const number = Number(raw);
  if (!Number.isSafeInteger(number) || number < 1 || (number - 1) * PAGE_SIZE > MAX_OFFSET) {
    throw new PublicApiError(400, 'invalid_page', 'The requested catalog page is outside the supported range.');
  }
  return number;
}

function yearValue(value) {
  if (value === undefined) return null;
  const raw = String(singleValue(value)).trim();
  const year = /^\d{4}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(year) || year < 1886 || year > 2200) {
    throw new PublicApiError(400, 'invalid_year', 'The vehicle year must be between 1886 and 2200.');
  }
  return year;
}

function slugValue(value, label) {
  return cleanText(value, 100, label, { pattern: /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/ });
}

function currencyValue(value) {
  if (value === undefined) return null;
  const currency = String(singleValue(value)).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new PublicApiError(400, 'invalid_currency', 'The currency parameter must use a three-letter code.');
  return currency;
}

function discoveryCursorValue(value) {
  if (value === undefined) return null;
  const cursor = String(singleValue(value));
  if (!cursor || cursor.length > 1_024 || /[\u0000-\u001f\u007f]/.test(cursor)) {
    throw new PublicApiError(400, 'invalid_ecs_discovery_cursor', 'The ECS discovery cursor is invalid.');
  }
  return cursor;
}

function identifierIdentity(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, '');
}

function cursorFingerprint(request) {
  const stable = {
    mode: request.mode,
    q: request.query || null,
    sort: request.sort,
    availability: request.availability,
    pricing: request.pricing,
    match: request.match,
    supplier: request.supplier,
    brand: request.brand,
    partType: request.partType,
    currency: request.currency,
    fitment: request.fitment,
    year: request.year,
    make: request.make,
    model: request.model,
    generation: request.generation,
    engine: request.engine
  };
  return createHash('sha256').update(JSON.stringify(stable), 'utf8').digest('base64url').slice(0, 16);
}

function encodeCursor(offset, fingerprint) {
  return Buffer.from(JSON.stringify({ v: 1, o: offset, f: fingerprint }), 'utf8').toString('base64url');
}

function decodeCursor(value, fingerprint) {
  if (value === undefined) return 0;
  const raw = String(singleValue(value)).trim();
  if (!/^[A-Za-z0-9_-]{8,240}$/.test(raw)) throw new PublicApiError(400, 'invalid_cursor', 'The catalog cursor is invalid.');
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (parsed?.v !== 1 || parsed?.f !== fingerprint || !Number.isSafeInteger(parsed?.o)
      || parsed.o < 0 || parsed.o > MAX_OFFSET || parsed.o % PAGE_SIZE !== 0) throw new Error('invalid');
    return parsed.o;
  } catch {
    throw new PublicApiError(400, 'invalid_cursor', 'The catalog cursor is invalid.');
  }
}

function parseRequest(req) {
  const values = requestValues(req);
  if (values.discovery !== undefined) {
    if (String(singleValue(values.discovery)).trim() !== '1') {
      throw new PublicApiError(400, 'invalid_discovery', 'ECS discovery mode requires discovery=1.');
    }
    const unsupported = Object.keys(values).filter(key => !['discovery', 'cursor'].includes(key));
    if (unsupported.length) {
      throw new PublicApiError(400, 'discovery_filters_unsupported', 'ECS discovery references do not support product or vehicle filters.');
    }
    return { mode: 'discovery', cursor: discoveryCursorValue(values.cursor) };
  }
  const query = cleanText(values.q, 120, 'query', { minimum: 2 });
  if (query && !/[\p{L}\p{N}]/u.test(query)) throw new PublicApiError(400, 'invalid_query', 'Search queries must contain a letter or number.');
  const handle = cleanText(values.handle, 255, 'handle', { pattern: /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/ });
  const supplier = slugValue(values.supplier, 'supplier');
  const brand = slugValue(values.brand, 'brand');
  const partType = slugValue(values.partType, 'partType');
  const currency = currencyValue(values.currency);
  const make = cleanText(values.make, 80, 'make');
  const model = cleanText(values.model, 100, 'model');
  const generation = cleanText(values.generation, 120, 'generation');
  const engine = cleanText(values.engine, 120, 'engine');
  const year = yearValue(values.year);
  const sort = enumValue(values.sort, SORTS, 'relevance', 'invalid_sort');
  const availability = enumValue(values.availability, AVAILABILITY_FILTERS, 'all', 'invalid_availability');
  const pricing = enumValue(values.pricing, PRICING_FILTERS, 'all', 'invalid_pricing');
  const match = enumValue(values.match, MATCHES, 'any', 'invalid_match');
  const fitment = enumValue(values.fitment, FITMENT_FILTERS, 'all', 'invalid_fitment');
  const suggest = values.suggest === undefined ? false : String(singleValue(values.suggest)).trim() === '1';
  if (values.suggest !== undefined && !suggest) throw new PublicApiError(400, 'invalid_suggest', 'Suggestions require suggest=1.');

  const filters = { supplier, brand, partType, currency, fitment, year, make, model, generation, engine };
  const structuredVehicle = Boolean(year || make || model || generation || engine);
  if (handle) {
    const disallowed = Object.keys(values).filter(key => !['handle', 'supplier', 'currency'].includes(key));
    if (query || suggest || disallowed.length) throw new PublicApiError(400, 'invalid_parameters', 'Product detail accepts only handle, supplier and currency.');
    return { mode: 'detail', handle, supplier, currency };
  }
  if (suggest) {
    if (!query || values.page !== undefined || values.cursor !== undefined || values.sort !== undefined
      || values.availability !== undefined || values.pricing !== undefined || values.match !== undefined) {
      throw new PublicApiError(400, 'invalid_parameters', 'Suggestions require a query and cannot use paging or result sorting.');
    }
    return { mode: 'suggest', query, ...filters };
  }
  if (match === 'vehicle' && !query && !structuredVehicle) {
    throw new PublicApiError(400, 'invalid_parameters', 'Vehicle matching requires a search query or structured vehicle selection.');
  }

  const mode = query ? 'search' : 'browse';
  const request = { mode, query, sort, availability, pricing, match, ...filters };
  const page = positiveInteger(values.page, 1);
  if (values.page !== undefined && values.cursor !== undefined) {
    throw new PublicApiError(400, 'invalid_parameters', 'Use either a page or a catalog cursor, not both.');
  }
  const fingerprint = cursorFingerprint(request);
  const offset = values.cursor !== undefined ? decodeCursor(values.cursor, fingerprint) : (page - 1) * PAGE_SIZE;
  return {
    ...request,
    page: Math.floor(offset / PAGE_SIZE) + 1,
    offset,
    fingerprint,
    structuredVehicle,
    positionSource: values.cursor !== undefined ? 'cursor' : 'page'
  };
}

function requestIsSameOrigin(req) {
  const origin = String(req.headers?.origin || '').trim();
  const fetchSite = String(req.headers?.['sec-fetch-site'] || '').trim().toLowerCase();
  if (!origin) return fetchSite !== 'cross-site';
  const forwarded = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '').split(',')[0].trim().toLowerCase();
  try {
    const parsed = new URL(origin);
    return Boolean(forwarded) && ['https:', 'http:'].includes(parsed.protocol) && parsed.host.toLowerCase() === forwarded;
  } catch {
    return false;
  }
}

function setResponseHeaders(res, cacheable) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cacheable ? CACHE_CONTROL : 'no-store');
  if (cacheable) res.setHeader('CDN-Cache-Control', CACHE_CONTROL);
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Vary', 'Origin, Accept-Encoding');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
}

function sendJson(res, status, body, cacheable = false) {
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RESPONSE_BYTES) {
    return sendError(res, 500, 'response_too_large', 'The catalog response exceeded its safety limit.');
  }
  res.statusCode = status;
  setResponseHeaders(res, cacheable);
  res.end(serialized);
}

function sendError(res, status, code, message) {
  res.statusCode = status;
  setResponseHeaders(res, false);
  res.end(JSON.stringify({ error: { code, message } }));
}

function makeBinder() {
  const values = [];
  return {
    values,
    add(value) {
      values.push(value);
      return `$${values.length}`;
    }
  };
}

function offerJoin(binder, currency, alias = 'offer') {
  const currencyClause = currency
    ? `o.currency = ${binder.add(currency)}`
    : 'o.currency = s.default_currency';
  return `LEFT JOIN LATERAL (
    SELECT
      MIN(o.price_minor) FILTER (WHERE o.price_minor IS NOT NULL) AS price_min,
      MAX(o.price_minor) FILTER (WHERE o.price_minor IS NOT NULL) AS price_max,
      (array_agg(o.currency ORDER BY CASE WHEN o.price_minor IS NULL THEN 1 ELSE 0 END, o.price_minor, o.id))[1] AS currency,
      (array_agg(o.availability_code ORDER BY CASE WHEN o.stock_expires_at < now() THEN 1 ELSE 0 END, CASE o.availability_code
        WHEN 'in_stock' THEN 0 WHEN 'supplier_stock' THEN 1 WHEN 'available_to_order' THEN 2
        WHEN 'backorder' THEN 3 WHEN 'unknown' THEN 4 WHEN 'out_of_stock' THEN 5 ELSE 6 END, o.id))[1] AS availability_code,
      (array_agg(o.lead_time ORDER BY CASE WHEN o.stock_expires_at < now() THEN 1 ELSE 0 END, CASE o.availability_code
        WHEN 'in_stock' THEN 0 WHEN 'supplier_stock' THEN 1 WHEN 'available_to_order' THEN 2
        WHEN 'backorder' THEN 3 WHEN 'unknown' THEN 4 WHEN 'out_of_stock' THEN 5 ELSE 6 END, o.id))[1] AS lead_time,
      (array_agg(o.stock_checked_at ORDER BY CASE WHEN o.stock_expires_at < now() THEN 1 ELSE 0 END, CASE o.availability_code
        WHEN 'in_stock' THEN 0 WHEN 'supplier_stock' THEN 1 WHEN 'available_to_order' THEN 2
        WHEN 'backorder' THEN 3 WHEN 'unknown' THEN 4 WHEN 'out_of_stock' THEN 5 ELSE 6 END, o.id))[1] AS stock_checked_at,
      (array_agg(o.stock_expires_at ORDER BY CASE WHEN o.stock_expires_at < now() THEN 1 ELSE 0 END, CASE o.availability_code
        WHEN 'in_stock' THEN 0 WHEN 'supplier_stock' THEN 1 WHEN 'available_to_order' THEN 2
        WHEN 'backorder' THEN 3 WHEN 'unknown' THEN 4 WHEN 'out_of_stock' THEN 5 ELSE 6 END, o.id))[1] AS stock_expires_at
    FROM variants ov
    JOIN offers o ON o.variant_id = ov.id
    WHERE ov.product_id = p.id AND ov.active AND ${currencyClause}
  ) ${alias} ON TRUE`;
}

function structuredFitmentJoin(request, binder) {
  const requested = Boolean(
    request.year || request.make || request.model || request.generation || request.engine || request.fitment !== 'all'
  );
  if (!requested) return 'LEFT JOIN LATERAL (SELECT NULL::text AS confidence) fit ON TRUE';
  const conditions = ['pf.product_id = p.id'];
  if (request.fitment === 'exact') conditions.push("pf.confidence = 'exact'");
  if (request.fitment === 'possible') conditions.push("pf.confidence = 'possible'");
  if (request.year) {
    const year = binder.add(request.year);
    conditions.push(`(${year} >= COALESCE(va.year_from, ${year}) AND ${year} <= COALESCE(va.year_to, ${year}))`);
  }
  const make = request.make ? binder.add(request.make.toLocaleLowerCase('en-US')) : null;
  const model = request.model ? binder.add(request.model.toLocaleLowerCase('en-US')) : null;
  if (make) conditions.push(`(lower(vmk.name) = ${make} OR lower(vmk.slug) = ${make})`);
  if (model) conditions.push(`(lower(vm.name) = ${model} OR lower(vm.slug) = ${model})`);
  if (request.generation) conditions.push(`lower(va.generation) = ${binder.add(request.generation.toLocaleLowerCase('en-US'))}`);
  if (request.engine) conditions.push(`lower(va.engine) = ${binder.add(request.engine.toLocaleLowerCase('en-US'))}`);
  const possibleTextFallback = request.fitment !== 'exact' && make && model
    ? `
      UNION ALL
      SELECT 'possible'::text AS confidence, 1 AS source_priority, NULL::bigint AS fitment_id
      WHERE NOT EXISTS (
        SELECT 1 FROM product_fitments existing_pf WHERE existing_pf.product_id = p.id
      )
        AND ps.vehicle_vector @@ plainto_tsquery('simple', ${make})
        AND ps.vehicle_vector @@ plainto_tsquery('simple', ${model})`
    : '';
  return `LEFT JOIN LATERAL (
    SELECT candidate.confidence
    FROM (
      SELECT pf.confidence, 0 AS source_priority, pf.id AS fitment_id
      FROM product_fitments pf
      JOIN vehicle_applications va ON va.id = pf.vehicle_application_id
      JOIN vehicle_models vm ON vm.id = va.model_id
      JOIN vehicle_makes vmk ON vmk.id = vm.make_id
      WHERE ${conditions.join(' AND ')}${possibleTextFallback}
    ) candidate
    ORDER BY candidate.source_priority,
      CASE candidate.confidence WHEN 'exact' THEN 0 ELSE 1 END,
      candidate.fitment_id NULLS LAST
    LIMIT 1
  ) fit ON TRUE`;
}

function availabilityPredicate(filter) {
  const fresh = '(offer.stock_expires_at IS NULL OR offer.stock_expires_at >= now())';
  if (filter === 'available') return `(offer.availability_code IN ('in_stock', 'supplier_stock', 'available_to_order') AND ${fresh})`;
  if (filter === 'in_stock') return `(offer.availability_code = 'in_stock' AND ${fresh})`;
  if (filter === 'supplier_stock') return `(offer.availability_code IN ('supplier_stock', 'available_to_order') AND ${fresh})`;
  if (filter === 'check') return `(offer.availability_code IS NULL OR offer.availability_code IN ('backorder', 'unknown') OR offer.stock_expires_at < now())`;
  if (filter === 'unavailable') return "offer.availability_code IN ('out_of_stock', 'discontinued')";
  return null;
}

function productFilters(request, binder, { includeQuery = true } = {}) {
  const conditions = ['p.active'];
  if (request.supplier) conditions.push(`s.slug = ${binder.add(request.supplier)}`);
  if (request.brand) conditions.push(`b.slug = ${binder.add(request.brand)}`);
  if (request.partType) {
    const partType = binder.add(request.partType);
    conditions.push(`(pt.slug = ${partType} OR EXISTS (
      SELECT 1 FROM product_part_types ppt JOIN part_types fpt ON fpt.id = ppt.part_type_id
      WHERE ppt.product_id = p.id AND fpt.slug = ${partType}
    ))`);
  }
  if (request.currency) conditions.push('offer.currency IS NOT NULL');
  const availability = availabilityPredicate(request.availability);
  if (availability) conditions.push(availability);
  if (request.pricing === 'priced') conditions.push('offer.price_min IS NOT NULL');
  if (request.pricing === 'request_price') conditions.push('offer.price_min IS NULL');
  if (request.structuredVehicle || request.fitment !== 'all') conditions.push('fit.confidence IS NOT NULL');
  if (includeQuery && request.query) {
    const exactIdentity = binder.add(identifierIdentity(request.query));
    const rawIdentity = binder.add(request.query.toLocaleLowerCase('en-US'));
    const query = binder.add(request.query);
    const vector = request.match === 'vehicle' ? 'ps.vehicle_vector' : 'ps.search_vector';
    conditions.push(`(
      (EXISTS (SELECT 1 FROM exact_identifier) AND exact_identifier.product_id IS NOT NULL)
      OR
      (NOT EXISTS (SELECT 1 FROM exact_identifier)
        AND (${vector} @@ websearch_to_tsquery('simple', ${query}) OR ps.search_text % ${query}))
    )`);
    return {
      conditions,
      exactCte: `exact_identifier AS (
        SELECT DISTINCT pi.product_id
        FROM product_identifiers pi
        JOIN products exact_product ON exact_product.id = pi.product_id AND exact_product.active
        JOIN catalog_state exact_state
          ON exact_state.supplier_id = exact_product.supplier_id
          AND exact_state.current_import_id = exact_product.import_id
        WHERE pi.kind IN (${IDENTIFIER_KINDS})
          AND (pi.normalized_value = ${exactIdentity} OR lower(pi.value) = ${rawIdentity})
      )`,
      queryParameter: query
    };
  }
  return { conditions, exactCte: 'exact_identifier AS (SELECT NULL::bigint AS product_id WHERE false)', queryParameter: null };
}

function buildListQuery(request, limit = PAGE_SIZE) {
  const binder = makeBinder();
  const offer = offerJoin(binder, request.currency);
  const fitmentJoin = structuredFitmentJoin(request, binder);
  const filters = productFilters(request, binder);
  const offset = binder.add(request.offset || 0);
  const rowLimit = binder.add(limit);
  const relevance = request.query
    ? `(CASE WHEN exact_identifier.product_id IS NOT NULL THEN 1000 ELSE 0 END
      + ts_rank_cd(${request.match === 'vehicle' ? 'ps.vehicle_vector' : 'ps.search_vector'}, websearch_to_tsquery('simple', ${filters.queryParameter})))`
    : '0';
  const orderBy = {
    relevance: `${relevance} DESC, ps.browse_rank, p.id`,
    name_asc: 'ps.title_sort ASC, p.id',
    name_desc: 'ps.title_sort DESC, p.id',
    price_asc: 'offer.currency ASC NULLS LAST, offer.price_min ASC NULLS LAST, ps.title_sort, p.id',
    price_desc: 'offer.currency ASC NULLS LAST, offer.price_max DESC NULLS LAST, ps.title_sort, p.id'
  }[request.sort] || 'ps.title_sort ASC, p.id';
  const scopedOrderBy = !request.supplier && !request.currency
    ? `s.slug ASC, ${orderBy}`
    : orderBy;

  return {
    text: `/* parts-catalog:list */
      WITH ${filters.exactCte}
      SELECT
        p.id, p.public_key, p.title, p.description, p.source_url,
        s.slug AS supplier_slug, s.display_name AS supplier_name, s.default_currency AS supplier_currency,
        b.name AS brand_name, pt.name_en AS part_type_name,
        image.url AS image_url, image.width AS image_width, image.height AS image_height,
        image.alt_en AS image_alt,
        identifiers.skus, identifiers.mpns,
        offer.price_min, offer.price_max, offer.currency, offer.availability_code,
        offer.lead_time, offer.stock_checked_at, offer.stock_expires_at,
        fit.confidence AS fitment_confidence
      FROM products p
      JOIN catalog_state cs ON cs.supplier_id = p.supplier_id AND cs.current_import_id = p.import_id
      JOIN suppliers s ON s.id = p.supplier_id
      JOIN product_search ps ON ps.product_id = p.id
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN part_types pt ON pt.id = p.primary_part_type_id
      ${offer}
      LEFT JOIN LATERAL (
        SELECT pi.url, pi.width, pi.height, pi.alt_en
        FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.position, pi.id LIMIT 1
      ) image ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          array_agg(DISTINCT pi.value ORDER BY pi.value) FILTER (WHERE pi.kind = 'sku') AS skus,
          array_agg(DISTINCT pi.value ORDER BY pi.value) FILTER (WHERE pi.kind = 'mpn') AS mpns
        FROM (
          SELECT kind, value FROM product_identifiers
          WHERE product_id = p.id ORDER BY id LIMIT 4096
        ) pi
      ) identifiers ON TRUE
      ${fitmentJoin}
      LEFT JOIN exact_identifier ON exact_identifier.product_id = p.id
      WHERE ${filters.conditions.join(' AND ')}
      ORDER BY ${scopedOrderBy}
      LIMIT ${rowLimit} OFFSET ${offset}`,
    values: binder.values
  };
}

function buildCountQuery(request) {
  const binder = makeBinder();
  const needsOffer = Boolean(request.currency || request.availability !== 'all' || request.pricing !== 'all');
  const offer = needsOffer
    ? offerJoin(binder, request.currency)
    : `LEFT JOIN LATERAL (
      SELECT NULL::bigint AS price_min, NULL::bigint AS price_max, NULL::char(3) AS currency,
        NULL::text AS availability_code, NULL::text AS lead_time,
        NULL::timestamptz AS stock_checked_at, NULL::timestamptz AS stock_expires_at
    ) offer ON TRUE`;
  const fitmentJoin = structuredFitmentJoin(request, binder);
  const filters = productFilters(request, binder);
  return {
    text: `/* parts-catalog:count */
      WITH ${filters.exactCte}
      SELECT COUNT(*) AS total_results
      FROM products p
      JOIN catalog_state cs ON cs.supplier_id = p.supplier_id AND cs.current_import_id = p.import_id
      JOIN suppliers s ON s.id = p.supplier_id
      JOIN product_search ps ON ps.product_id = p.id
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN part_types pt ON pt.id = p.primary_part_type_id
      ${offer}
      ${fitmentJoin}
      LEFT JOIN exact_identifier ON exact_identifier.product_id = p.id
      WHERE ${filters.conditions.join(' AND ')}`,
    values: binder.values
  };
}

function buildStatsQuery() {
  return {
    text: `/* parts-catalog:stats */
      WITH current_products AS (
        SELECT p.id, p.supplier_id
        FROM products p
        JOIN catalog_state cs ON cs.supplier_id = p.supplier_id AND cs.current_import_id = p.import_id
        WHERE p.active
      ), current_offers AS (
        SELECT cp.id AS product_id, o.currency, o.price_minor, o.availability_code,
          o.stock_checked_at, o.stock_expires_at
        FROM current_products cp
        JOIN variants v ON v.product_id = cp.id AND v.active
        JOIN offers o ON o.variant_id = v.id
      )
      SELECT
        (SELECT COUNT(*) FROM current_products) AS catalog_product_count,
        (SELECT COUNT(DISTINCT product_id) FROM current_offers
          WHERE availability_code IN ('in_stock', 'supplier_stock', 'available_to_order')
            AND (stock_expires_at IS NULL OR stock_expires_at >= now())) AS available_product_count,
        (SELECT COUNT(DISTINCT product_id) FROM current_offers WHERE price_minor IS NOT NULL) AS priced_product_count,
        (SELECT COUNT(DISTINCT pi.product_id) FROM product_identifiers pi JOIN current_products cp ON cp.id = pi.product_id
          WHERE pi.kind = 'sku') AS sku_product_count,
        (SELECT MAX(stock_checked_at) FROM current_offers) AS checked_at,
        (SELECT COUNT(*) FROM current_offers WHERE stock_expires_at IS NOT NULL AND stock_expires_at < now()) AS stale_offer_count,
        (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'slug', x.slug, 'name', x.display_name, 'productCount', x.product_count
        ) ORDER BY x.display_name), '[]'::jsonb)
          FROM (
            SELECT s.slug, s.display_name, COUNT(*) AS product_count
            FROM suppliers s JOIN current_products cp ON cp.supplier_id = s.id
            GROUP BY s.id, s.slug, s.display_name
          ) x) AS suppliers,
        (SELECT COALESCE(jsonb_agg(x.currency ORDER BY x.currency), '[]'::jsonb)
          FROM (SELECT DISTINCT currency FROM current_offers) x) AS currencies`,
    values: []
  };
}

function buildDetailQuery(request) {
  const binder = makeBinder();
  const handle = binder.add(request.handle);
  const supplier = request.supplier ? `AND s.slug = ${binder.add(request.supplier)}` : '';
  const offer = offerJoin(binder, request.currency);
  const variantCurrency = request.currency ? binder.add(request.currency) : 's.default_currency';
  return {
    text: `/* parts-catalog:detail */
      SELECT
        p.id, p.public_key, p.title, p.description, p.source_url,
        s.slug AS supplier_slug, s.display_name AS supplier_name, s.default_currency AS supplier_currency,
        b.name AS brand_name, pt.name_en AS part_type_name,
        first_image.url AS image_url, first_image.width AS image_width,
        first_image.height AS image_height, first_image.alt_en AS image_alt,
        identifiers.skus, identifiers.mpns,
        offer.price_min, offer.price_max, offer.currency, offer.availability_code,
        offer.lead_time, offer.stock_checked_at, offer.stock_expires_at,
        images.images, detail_variants.variants, fitments.fitments
      FROM products p
      JOIN catalog_state cs ON cs.supplier_id = p.supplier_id AND cs.current_import_id = p.import_id
      JOIN suppliers s ON s.id = p.supplier_id
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN part_types pt ON pt.id = p.primary_part_type_id
      ${offer}
      LEFT JOIN LATERAL (
        SELECT pi.url, pi.width, pi.height, pi.alt_en FROM product_images pi
        WHERE pi.product_id = p.id ORDER BY pi.position, pi.id LIMIT 1
      ) first_image ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          array_agg(DISTINCT pi.value ORDER BY pi.value) FILTER (WHERE pi.kind = 'sku') AS skus,
          array_agg(DISTINCT pi.value ORDER BY pi.value) FILTER (WHERE pi.kind = 'mpn') AS mpns
        FROM (
          SELECT kind, value FROM product_identifiers
          WHERE product_id = p.id ORDER BY id LIMIT 4096
        ) pi
      ) identifiers ON TRUE
      LEFT JOIN LATERAL (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'src', ix.url, 'width', ix.width, 'height', ix.height, 'alt', ix.alt_en
        ) ORDER BY ix.position, ix.id), '[]'::jsonb) AS images
        FROM (SELECT * FROM product_images WHERE product_id = p.id ORDER BY position, id LIMIT 16) ix
      ) images ON TRUE
      LEFT JOIN LATERAL (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'title', vx.title, 'sku', vx.sku, 'mpn', vx.mpn,
          'available', vx.availability_code IN ('in_stock', 'supplier_stock', 'available_to_order'),
          'availabilityCode', vx.availability_code,
          'price', CASE WHEN vx.price_minor IS NULL THEN NULL ELSE jsonb_build_object('currency', vx.currency, 'amount', vx.price_minor) END
        ) ORDER BY vx.position, vx.id), '[]'::jsonb) AS variants
        FROM (
          SELECT v.id, v.title, v.position, vo.currency, vo.price_minor, vo.availability_code,
            (SELECT value FROM product_identifiers WHERE variant_id = v.id AND kind = 'sku' ORDER BY id LIMIT 1) AS sku,
            (SELECT value FROM product_identifiers WHERE variant_id = v.id AND kind = 'mpn' ORDER BY id LIMIT 1) AS mpn
          FROM variants v
          LEFT JOIN LATERAL (
            SELECT o.currency, o.price_minor, o.availability_code FROM offers o
            WHERE o.variant_id = v.id AND o.currency = ${variantCurrency}
            ORDER BY CASE WHEN o.price_minor IS NULL THEN 1 ELSE 0 END, o.id LIMIT 1
          ) vo ON TRUE
          WHERE v.product_id = p.id AND v.active ORDER BY v.position, v.id LIMIT 2048
        ) vx
      ) detail_variants ON TRUE
      LEFT JOIN LATERAL (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'confidence', fx.confidence, 'yearFrom', fx.year_from, 'yearTo', fx.year_to,
          'make', fx.make_name, 'model', fx.model_name, 'generation', fx.generation,
          'engine', fx.engine, 'note', fx.note
        ) ORDER BY fx.make_name, fx.model_name, fx.year_from, fx.generation, fx.engine), '[]'::jsonb) AS fitments
        FROM (
          SELECT pf.confidence, pf.note, va.year_from, va.year_to, va.generation, va.engine,
            vm.name AS model_name, vmk.name AS make_name
          FROM product_fitments pf
          JOIN vehicle_applications va ON va.id = pf.vehicle_application_id
          JOIN vehicle_models vm ON vm.id = va.model_id
          JOIN vehicle_makes vmk ON vmk.id = vm.make_id
          WHERE pf.product_id = p.id
          ORDER BY CASE pf.confidence WHEN 'exact' THEN 0 ELSE 1 END, pf.id LIMIT 500
        ) fx
      ) fitments ON TRUE
      WHERE p.active AND p.public_key = ${handle} ${supplier}
      ORDER BY p.id LIMIT 2`,
    values: binder.values
  };
}

async function defaultQueryAdapter(databaseUrl) {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(databaseUrl);
  return (text, values) => sql.query(text, values);
}

function normalizeRows(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.rows)) return result.rows;
  throw new Error('invalid_database_result');
}

async function execute(adapter, statement) {
  return normalizeRows(await adapter(statement.text, statement.values));
}

function boundedInteger(value, fallback = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= maximum ? number : fallback;
}

function safeOutputText(value, maximum = 300) {
  return String(value ?? '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function safeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' || url.username || url.password || String(value).length > 2048) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function parseArray(value, maximum = 2048) {
  let candidate = value;
  if (typeof candidate === 'string') {
    try { candidate = JSON.parse(candidate); } catch { candidate = []; }
  }
  return Array.isArray(candidate) ? candidate.slice(0, maximum) : [];
}

function availabilityObject(row, nowValue) {
  const expiry = row.stock_expires_at ? Date.parse(row.stock_expires_at) : NaN;
  const stale = Number.isFinite(expiry) && expiry < nowValue;
  const raw = stale ? 'unknown' : safeOutputText(row.availability_code, 40);
  const code = {
    in_stock: 'in_stock', supplier_stock: 'supplier_stock', available_to_order: 'supplier_stock',
    out_of_stock: 'out_of_stock', discontinued: 'out_of_stock', backorder: 'check_availability', unknown: 'check_availability'
  }[raw] || 'check_availability';
  return {
    code,
    checkedAt: row.stock_checked_at || null,
    leadTime: safeOutputText(row.lead_time, 120) || null,
    snapshotStale: stale
  };
}

function priceObject(row) {
  const rawCurrency = String(row.currency || row.supplier_currency || '');
  const currency = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : null;
  const minimum = row.price_min === null || row.price_min === undefined ? null : boundedInteger(row.price_min, null, 100_000_000_000);
  const maximum = row.price_max === null || row.price_max === undefined ? minimum : boundedInteger(row.price_max, minimum, 100_000_000_000);
  return {
    currency,
    min: minimum === null ? null : minimum / 100,
    max: maximum === null ? null : maximum / 100,
    note: null
  };
}

function imageObject(row) {
  const src = safeUrl(row.image_url);
  if (!src) return null;
  const width = boundedInteger(row.image_width, null, 20_000);
  const height = boundedInteger(row.image_height, null, 20_000);
  return { src, width, height, alt: safeOutputText(row.image_alt || row.title, 220) };
}

function cardFromRow(row, nowValue) {
  const handle = safeOutputText(row.public_key, 255);
  if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(handle)) throw new Error('invalid_public_product_key');
  const skus = parseArray(row.skus).map(value => safeOutputText(value, 120)).filter(Boolean);
  const mpns = parseArray(row.mpns).map(value => safeOutputText(value, 120)).filter(Boolean);
  const supplierSlug = safeOutputText(row.supplier_slug, 100);
  return {
    handle,
    publicKey: handle,
    title: safeOutputText(row.title, 300),
    vendor: safeOutputText(row.brand_name, 160) || null,
    category: safeOutputText(row.part_type_name, 160) || null,
    image: imageObject(row),
    sku: skus.length === 1 ? skus[0] : null,
    skuCount: skus.length,
    skuState: skus.length === 1 ? 'exact' : (skus.length > 1 ? 'multiple' : 'not_supplied'),
    mpn: mpns.length === 1 ? mpns[0] : null,
    mpnCount: mpns.length,
    price: priceObject(row),
    availability: availabilityObject(row, nowValue),
    sourceUrl: safeUrl(row.source_url),
    supplier: { slug: supplierSlug, name: safeOutputText(row.supplier_name, 160) },
    fitmentConfidence: ['exact', 'possible'].includes(row.fitment_confidence) ? row.fitment_confidence : null
  };
}

function statsFromRow(row = {}) {
  const suppliers = parseArray(row.suppliers, 100).map(value => {
    const supplier = {
      slug: safeOutputText(value?.slug, 100), name: safeOutputText(value?.name, 160)
    };
    const productCount = boundedInteger(value?.productCount, null, 100_000_000);
    return productCount === null ? supplier : { ...supplier, productCount };
  }).filter(value => value.slug && value.name);
  const currencies = parseArray(row.currencies, 30).map(value => safeOutputText(value, 3))
    .filter(value => /^[A-Z]{3}$/.test(value));
  return {
    catalogProductCount: boundedInteger(row.catalog_product_count, 0, 100_000_000),
    stockIndexedProductCount: boundedInteger(row.priced_product_count, 0, 100_000_000),
    skuIndexedProductCount: boundedInteger(row.sku_product_count, 0, 100_000_000),
    availableProductCount: boundedInteger(row.available_product_count, 0, 100_000_000),
    checkedAt: row.checked_at || null,
    stockSnapshotStale: boundedInteger(row.stale_offer_count, 0, 100_000_000) > 0,
    suppliers,
    currencies
  };
}

function requirePublishedCatalogue(row) {
  const stats = statsFromRow(row);
  if (stats.catalogProductCount < 1) {
    throw new PublicApiError(503, 'catalogue_unpublished', 'The unified parts catalogue has not been published yet.');
  }
  return stats;
}

function catalogueIncludesReviewedEcs(stats, expectedCount = REVIEWED_ECS_PRODUCTS.length) {
  const ecs = stats.suppliers.find(supplier => supplier.slug === 'ecs');
  return Boolean(ecs) && (ecs.productCount === undefined || ecs.productCount >= expectedCount);
}

function filtersMeta(request) {
  return {
    supplier: request.supplier, brand: request.brand, partType: request.partType,
    currency: request.currency, fitment: request.fitment, year: request.year,
    make: request.make, model: request.model, generation: request.generation, engine: request.engine
  };
}

function sortMeta(mixedSupplierResults = false) {
  if (!mixedSupplierResults) return { sortScope: 'single-supplier-or-currency' };
  return {
    sortScope: 'supplier-groups',
    sortNote: 'Mixed-currency results are grouped by supplier. Sorting is applied within each supplier; USD and GBP prices are not converted or compared.'
  };
}

let defaultLegacyHandlerPromise = null;
async function loadDefaultLegacyHandler() {
  defaultLegacyHandlerPromise ||= import('./tegiwa-catalog.js').then(module => module.default);
  return defaultLegacyHandlerPromise;
}

function createRateLimiter(now, { limit = SEARCH_RATE_LIMIT, windowMs = SEARCH_RATE_WINDOW_MS } = {}) {
  const buckets = new Map();
  return req => {
    const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    const identity = forwarded || String(req.headers?.host || 'anonymous');
    const key = createHash('sha256').update(identity, 'utf8').digest('base64url').slice(0, 16);
    const timestamp = Number(now());
    const previous = buckets.get(key);
    const bucket = !previous || timestamp >= previous.resetAt ? { count: 0, resetAt: timestamp + windowMs } : previous;
    bucket.count += 1;
    buckets.delete(key);
    buckets.set(key, bucket);
    while (buckets.size > SEARCH_RATE_BUCKETS) buckets.delete(buckets.keys().next().value);
    return { allowed: bucket.count <= limit, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1000)), limit, windowMs };
  };
}

export function createPartsCatalogHandler({
  query = null,
  databaseUrl = process.env.DATABASE_URL || '',
  now = () => Date.now(),
  searchRateLimit,
  reviewedFallback = true,
  reviewedProducts = REVIEWED_ECS_PRODUCTS,
  legacyHandler,
  legacyHandlerLoader = loadDefaultLegacyHandler,
  logger = console
} = {}) {
  if (query !== null && typeof query !== 'function') throw new TypeError('The query adapter must be a function.');
  if (typeof now !== 'function') throw new TypeError('A clock function is required.');
  if (!Array.isArray(reviewedProducts)) throw new TypeError('Reviewed fallback products must be an array.');
  if (legacyHandler !== undefined && legacyHandler !== null && legacyHandler !== false && typeof legacyHandler !== 'function') {
    throw new TypeError('The legacy catalog handler must be a function, null or false.');
  }
  if (typeof legacyHandlerLoader !== 'function') throw new TypeError('The legacy catalog loader must be a function.');
  let adapter = query;
  let adapterPromise = null;
  let loadedLegacyHandler = typeof legacyHandler === 'function' ? legacyHandler : null;
  let legacyHandlerPromise = null;
  const rateLimit = createRateLimiter(now, searchRateLimit);
  const getAdapter = async () => {
    if (adapter) return adapter;
    if (!databaseUrl) return null;
    adapterPromise ||= defaultQueryAdapter(databaseUrl);
    adapter = await adapterPromise;
    return adapter;
  };
  const getLegacyHandler = async () => {
    if (legacyHandler === false || legacyHandler === null) return null;
    if (loadedLegacyHandler) return loadedLegacyHandler;
    legacyHandlerPromise ||= legacyHandlerLoader();
    loadedLegacyHandler = await legacyHandlerPromise;
    return typeof loadedLegacyHandler === 'function' ? loadedLegacyHandler : null;
  };
  const withEcsReferenceStats = async stats => stats;
  return async function partsCatalogHandler(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return sendError(res, 405, 'method_not_allowed', 'Only GET requests are allowed.');
    }
    if (!requestIsSameOrigin(req)) return sendError(res, 403, 'origin_not_allowed', 'Cross-origin catalog requests are not allowed.');
    let request;
    try {
      request = parseRequest(req);
    } catch (error) {
      if (error instanceof PublicApiError) return sendError(res, error.status, error.code, error.message);
      return sendError(res, 400, 'invalid_parameters', 'The catalog request is invalid.');
    }
    if (request.mode === 'search' || request.mode === 'suggest' || request.mode === 'discovery') {
      const rate = rateLimit(req);
      res.setHeader('RateLimit-Policy', `${rate.limit};w=${Math.ceil(rate.windowMs / 1000)}`);
      if (!rate.allowed) {
        res.setHeader('Retry-After', String(rate.retryAfter));
        return sendError(res, 429, 'rate_limited', 'Too many catalog searches were requested. Please try again shortly.');
      }
    }

    if (request.mode === 'discovery') {
      return sendError(res, 404, 'discovery_unavailable', 'URL-only supplier references are private ingestion data and are not storefront products.');
    }

    const sendReviewedFallback = async reason => {
      if (!reviewedFallback || reviewedProducts.length === 0) {
        const unavailable = reason === 'database_unavailable';
        return sendError(
          res,
          503,
          unavailable ? 'service_unavailable' : 'service_unconfigured',
          unavailable
            ? 'The unified parts catalog is temporarily unavailable.'
            : 'The unified parts catalog database has not been configured.'
        );
      }
      let fallbackLegacyHandler = null;
      try {
        fallbackLegacyHandler = await getLegacyHandler();
      } catch (error) {
        logger?.warn?.('Legacy supplier fallback could not be loaded', {
          message: error instanceof Error ? error.message : 'unknown_error'
        });
      }
      try {
        const body = await reviewedFallbackResponse({
          request,
          req,
          nowValue: Number(now()),
          reason,
          legacyHandler: fallbackLegacyHandler,
          products: reviewedProducts
        });
        if (Object.hasOwn(body, 'nextOffset')) {
          body.nextCursor = body.nextOffset === null ? null : encodeCursor(body.nextOffset, request.fingerprint);
          delete body.nextOffset;
        }
        body.meta = await withEcsReferenceStats(body.meta);
        return sendJson(res, 200, body, true);
      } catch (error) {
        if (error instanceof ReviewedFallbackError) return sendError(res, error.status, error.code, error.message);
        logger?.error?.('Reviewed parts fallback failed', {
          message: error instanceof Error ? error.message : 'unknown_error'
        });
        return sendError(res, 503, 'service_unavailable', 'The parts catalog is temporarily unavailable.');
      }
    };

    if (!query && !databaseUrl) return sendReviewedFallback('database_unconfigured');

    try {
      const sql = await getAdapter();
      if (!sql) return sendError(res, 503, 'service_unconfigured', 'The unified parts catalog database has not been configured.');
      const nowValue = Number(now());
      if (request.mode === 'detail') {
        const [rows, statsRows] = await Promise.all([
          execute(sql, buildDetailQuery(request)), execute(sql, buildStatsQuery())
        ]);
        const stats = await withEcsReferenceStats(requirePublishedCatalogue(statsRows[0]));
        if (!rows.length && (request.handle.startsWith('ecs-') || request.supplier === 'ecs')) {
          return sendReviewedFallback('reviewed_ecs_not_seeded');
        }
        if (!rows.length) return sendError(res, 404, 'product_not_found', 'The requested product was not found.');
        if (rows.length > 1) return sendError(res, 409, 'ambiguous_product', 'Select a supplier to identify this product.');
        const row = rows[0];
        const product = {
          ...cardFromRow(row, nowValue),
          description: safeOutputText(row.description, 5_000),
          images: parseArray(row.images, 16).map(image => ({
            src: safeUrl(image?.src), width: boundedInteger(image?.width, null, 20_000),
            height: boundedInteger(image?.height, null, 20_000), alt: safeOutputText(image?.alt || row.title, 220)
          })).filter(image => image.src),
          variants: parseArray(row.variants, 2_048).map(variant => {
            const rawPrice = variant?.price;
            const amountMinor = rawPrice?.amount === null || rawPrice?.amount === undefined
              ? null : boundedInteger(rawPrice.amount, null, 100_000_000_000);
            return {
              title: safeOutputText(variant?.title, 200) || 'Default',
              sku: safeOutputText(variant?.sku, 120) || null,
              mpn: safeOutputText(variant?.mpn, 120) || null,
              available: Boolean(variant?.available),
              availabilityCode: safeOutputText(variant?.availabilityCode, 40) || 'unknown',
              price: amountMinor === null ? null : {
                currency: /^[A-Z]{3}$/.test(String(rawPrice?.currency || '')) ? rawPrice.currency : null,
                amount: amountMinor / 100
              }
            };
          }),
          fitments: parseArray(row.fitments, 500).map(fitment => ({
            confidence: ['exact', 'possible'].includes(fitment?.confidence) ? fitment.confidence : 'possible',
            yearFrom: boundedInteger(fitment?.yearFrom, null, 2200), yearTo: boundedInteger(fitment?.yearTo, null, 2200),
            make: safeOutputText(fitment?.make, 80), model: safeOutputText(fitment?.model, 100),
            generation: safeOutputText(fitment?.generation, 120), engine: safeOutputText(fitment?.engine, 120),
            note: safeOutputText(fitment?.note, 300) || null
          }))
        };
        return sendJson(res, 200, { mode: 'detail', product, meta: { count: 1, ...stats } }, true);
      }

      if (request.mode === 'suggest') {
        const suggestionRequest = {
          ...request, mode: 'search', sort: 'relevance', availability: 'all', pricing: 'all', match: 'any',
          offset: 0, structuredVehicle: Boolean(request.year || request.make || request.model || request.generation || request.engine)
        };
        const [rows, statsRows] = await Promise.all([
          execute(sql, buildListQuery(suggestionRequest, SUGGESTION_LIMIT)), execute(sql, buildStatsQuery())
        ]);
        const stats = await withEcsReferenceStats(requirePublishedCatalogue(statsRows[0]));
        if (!catalogueIncludesReviewedEcs(stats, reviewedProducts.length)) return sendReviewedFallback('reviewed_ecs_not_seeded');
        const suggestions = rows.slice(0, SUGGESTION_LIMIT).map(row => {
          const card = cardFromRow(row, nowValue);
          return { query: card.title, label: card.title, kind: 'product', handle: card.handle, supplier: card.supplier };
        });
        return sendJson(res, 200, {
          mode: 'suggest', suggestions,
          correction: { query: request.query, canonicalQuery: request.query, translated: false, corrected: false, corrections: [] },
          meta: { count: suggestions.length, limit: SUGGESTION_LIMIT, ...stats }, nextCursor: null
        }, true);
      }

      const [rows, statsRows, countRows] = await Promise.all([
        execute(sql, buildListQuery(request)), execute(sql, buildStatsQuery()), execute(sql, buildCountQuery(request))
      ]);
      const stats = await withEcsReferenceStats(requirePublishedCatalogue(statsRows[0]));
      if (!catalogueIncludesReviewedEcs(stats, reviewedProducts.length)) return sendReviewedFallback('reviewed_ecs_not_seeded');
      const totalResults = boundedInteger(countRows[0]?.total_results, 0, 100_000_000);
      if (request.offset > 0 && request.offset >= totalResults) {
        return sendError(
          res,
          400,
          request.positionSource === 'cursor' ? 'invalid_cursor' : 'invalid_page',
          'The requested catalog position does not exist.'
        );
      }
      const items = rows.slice(0, PAGE_SIZE).map(row => cardFromRow(row, nowValue));
      const nextOffset = request.offset + items.length;
      const nextCursor = items.length === PAGE_SIZE && nextOffset < totalResults
        ? encodeCursor(nextOffset, request.fingerprint) : null;
      return sendJson(res, 200, {
        mode: request.mode,
        items,
        meta: {
          count: items.length, ...stats,
          query: request.query || null, canonicalQuery: request.query || null,
          translated: false, corrected: false, corrections: [],
          page: request.page, pageSize: PAGE_SIZE, totalResults,
          totalPages: Math.ceil(totalResults / PAGE_SIZE), sort: request.sort,
          ...sortMeta(!request.supplier && !request.currency && stats.suppliers.length > 1),
          availability: request.availability, pricing: request.pricing, match: request.match,
          filters: filtersMeta(request)
        },
        nextCursor
      }, true);
    } catch (error) {
      if (error instanceof PublicApiError) {
        if (error.code === 'catalogue_unpublished' && reviewedFallback && reviewedProducts.length) {
          return sendReviewedFallback('database_unpublished');
        }
        return sendError(res, error.status, error.code, error.message);
      }
      logger?.error?.('Unified parts catalog query failed', { message: error instanceof Error ? error.message : 'unknown_error' });
      return sendReviewedFallback('database_unavailable');
    }
  };
}

export const __test = Object.freeze({
  parseRequest, encodeCursor, decodeCursor, cursorFingerprint,
  buildListQuery, buildCountQuery, buildDetailQuery, buildStatsQuery
});

export default createPartsCatalogHandler();
