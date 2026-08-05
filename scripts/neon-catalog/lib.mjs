import { createHash } from 'node:crypto';

export const DEFAULT_BATCH_ROWS = 250;
export const DEFAULT_BATCH_BYTES = 4_000_000;
export const MAX_BATCH_ROWS = 1_000;
export const MAX_BATCH_BYTES = 16_000_000;
export const CATALOG_CURRENCY = 'GBP';
export const STOCK_FRESHNESS_DAYS = 7;

const knownBrandPrefixes = [
  ['aem electronics', 'AEM Electronics'],
  ['air lift performance', 'Air Lift Performance'],
  ['airtec motorsport', 'AIRTEC Motorsport'],
  ['apr performance', 'APR Performance'],
  ['bc racing', 'BC Racing'],
  ['blackline performance', 'Blackline Performance'],
  ['cobra sport', 'Cobra Sport'],
  ['competition clutch', 'Competition Clutch'],
  ['eibach pro', 'Eibach'],
  ['eibach sportline', 'Eibach'],
  ['forge motorsport', 'Forge Motorsport'],
  ['gfb go fast bits', 'GFB'],
  ['goodridge', 'Goodridge'],
  ['h&r', 'H&R'],
  ['hardrace', 'Hardrace'],
  ['hawk performance', 'Hawk Performance'],
  ['hel performance', 'HEL Performance'],
  ['kw suspension', 'KW Suspension'],
  ['mishimoto', 'Mishimoto'],
  ['motion motorsport', 'Motion Motorsport'],
  ['powerflex black series', 'Powerflex'],
  ['powerflex heritage collection', 'Powerflex'],
  ['powerflex', 'Powerflex'],
  ['pro alloy', 'Pro Alloy'],
  ['race safety accessories', 'Race Safety Accessories'],
  ['ramair', 'Ramair'],
  ['samco sport', 'Samco Sport'],
  ['superpro', 'SuperPro'],
  ['tein', 'TEIN'],
  ['tegiwa imports', 'Tegiwa'],
  ['tegiwa', 'Tegiwa'],
  ['turbosmart', 'Turbosmart'],
  ['vibratechnics', 'Vibra-Technics'],
  ['whiteline', 'Whiteline'],
  ['wilwood', 'Wilwood']
].sort((left, right) => right[0].length - left[0].length);

export function normalizeWhitespace(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTitleKey(value) {
  return normalizeWhitespace(value).toLocaleLowerCase('en-US');
}

export function normalizeSearchText(value) {
  return normalizeWhitespace(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeIdentifier(value) {
  return normalizeWhitespace(value).toLocaleLowerCase('en-US');
}

export function slugify(value, fallback = 'unknown') {
  const slug = normalizeSearchText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return slug || fallback;
}

export function stockKeyForTitle(title) {
  return createHash('sha256')
    .update(normalizeTitleKey(title), 'utf8')
    .digest('base64url')
    .slice(0, 16);
}

export function stockKeyBytesForTitle(title) {
  return createHash('sha256')
    .update(normalizeTitleKey(title), 'utf8')
    .digest()
    .subarray(0, 12);
}

export function deterministicImportUuid(fingerprint) {
  if (!/^[a-f0-9]{64}$/.test(String(fingerprint || ''))) {
    throw new Error('A canonical SHA-256 source fingerprint is required.');
  }
  const bytes = Buffer.from(fingerprint.slice(0, 32), 'hex');
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function inferBrand(title) {
  const cleanTitle = normalizeWhitespace(title);
  const normalized = normalizeSearchText(cleanTitle);
  for (const [prefix, displayName] of knownBrandPrefixes) {
    if (normalized === prefix || normalized.startsWith(`${prefix} `)) {
      return { slug: slugify(displayName), name: displayName };
    }
  }

  const firstToken = cleanTitle
    .split(/\s+/)[0]
    ?.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}&+.-]+$/gu, '')
    .slice(0, 80);
  const name = firstToken || 'Unclassified';
  return { slug: slugify(name, 'unclassified'), name };
}

export function availabilityFromStockCode(statusCode) {
  if (statusCode === 1) return 'in_stock';
  if (statusCode === 2) return 'supplier_stock';
  if (statusCode === 0) return 'out_of_stock';
  return 'unknown';
}

export function checkedAtIsoDate(value) {
  const date = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Stock checkedAt must use YYYY-MM-DD.');
  const timestamp = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) {
    throw new Error('Stock checkedAt is not a real calendar date.');
  }
  return `${date}T00:00:00.000Z`;
}

export function expiresAtFromCheckedAt(checkedAt, freshnessDays = STOCK_FRESHNESS_DAYS) {
  if (!Number.isInteger(freshnessDays) || freshnessDays < 1 || freshnessDays > 90) {
    throw new Error('Stock freshness must be between 1 and 90 days.');
  }
  const timestamp = Date.parse(checkedAt);
  if (!Number.isFinite(timestamp)) throw new Error('A valid stock timestamp is required.');
  return new Date(timestamp + freshnessDays * 24 * 60 * 60 * 1_000).toISOString();
}

export function decodeStockRecord(record, stockIndex) {
  if (record === undefined) {
    return {
      priceMinor: null,
      maximumPriceMinor: null,
      availabilityCode: 'unknown',
      leadTime: null,
      skus: [],
      skuState: 0,
      hasStockRecord: false
    };
  }
  if (!Array.isArray(record) || record.length !== 6) throw new Error('A Tegiwa stock row has an unsupported shape.');
  const [minimum, maximum, statusCode, leadTimeIndex, rawSkus, skuState] = record;
  const validPrice = value => value === null || (Number.isSafeInteger(value) && value > 0);
  if (!validPrice(minimum) || !validPrice(maximum)
    || ((minimum === null) !== (maximum === null))
    || (minimum !== null && maximum < minimum)) {
    throw new Error('A Tegiwa stock row contains an invalid GBP price range.');
  }
  if (![null, 0, 1, 2, 3].includes(statusCode)) throw new Error('A Tegiwa stock row has an invalid availability code.');
  if (!Number.isInteger(leadTimeIndex) || leadTimeIndex < 0 || leadTimeIndex >= stockIndex.leadTimes.length) {
    throw new Error('A Tegiwa stock row has an invalid lead-time index.');
  }
  if (!Array.isArray(rawSkus) || ![0, 1, 2].includes(skuState)) throw new Error('A Tegiwa stock row has an invalid SKU payload.');
  const skuMap = new Map();
  if (skuState === 1) {
    for (const value of rawSkus) {
      const clean = normalizeWhitespace(value);
      const key = normalizeIdentifier(clean);
      if (clean && (clean.length > 120 || !/[\p{L}\p{N}]/u.test(clean)
        || /^(?:data|file|ftp|https?|javascript|vbscript):/i.test(clean) || /[<>`{}]/.test(clean))) {
        throw new Error('A Tegiwa stock row contains an unsafe public SKU.');
      }
      if (key && clean && !skuMap.has(key)) skuMap.set(key, clean);
    }
  }
  const skus = [...skuMap.values()];
  return {
    priceMinor: minimum,
    maximumPriceMinor: maximum,
    availabilityCode: availabilityFromStockCode(statusCode),
    leadTime: normalizeWhitespace(stockIndex.leadTimes[leadTimeIndex]) || null,
    skus,
    skuState,
    hasStockRecord: true
  };
}

export function normalizeCatalogProduct({
  record,
  stockIndex,
  browseRank,
  catalogGeneratedAt,
  stockCheckedAt
}) {
  if (!Array.isArray(record) || record.length !== 3) throw new Error('A catalog product record must contain handle, title and image.');
  const [handle, rawTitle, rawImageUrl] = record;
  if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(String(handle || '')) || String(handle).length > 255) {
    throw new Error('A catalog product has an invalid source handle.');
  }
  const title = normalizeWhitespace(rawTitle);
  if (!title || title.length > 300) throw new Error(`Catalog product ${handle} has an invalid title.`);
  if (!Number.isSafeInteger(browseRank) || browseRank < 0) throw new Error(`Catalog product ${handle} has an invalid search rank.`);

  let imageUrl = null;
  if (rawImageUrl) {
    const parsed = new URL(String(rawImageUrl));
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash
      || !['cdn.shopify.com', 'www.tegiwa.com', 'tegiwa.com'].includes(parsed.hostname)) {
      throw new Error(`Catalog product ${handle} has an unapproved image URL.`);
    }
    imageUrl = parsed.toString();
  }

  const stockKey = stockKeyForTitle(title);
  const stock = decodeStockRecord(stockIndex.products[stockKey], stockIndex);
  const brand = inferBrand(title);
  const sourceUrl = `https://www.tegiwa.com/products/${handle}`;
  const normalizedSkus = stock.skus.map(normalizeIdentifier).filter(Boolean);
  const titleSort = normalizeSearchText(title);
  const searchText = normalizeSearchText(`${title} ${handle.replace(/[-_]+/g, ' ')} ${stock.skus.join(' ')}`);

  return {
    public_key: `tegiwa:${handle}`,
    supplier_product_key: handle,
    source_handle: handle,
    source_url: sourceUrl,
    title,
    brand_slug: brand.slug,
    brand_name: brand.name,
    checked_at: catalogGeneratedAt,
    browse_rank: browseRank,
    variant_key: 'default',
    variant_title: 'Default',
    currency: CATALOG_CURRENCY,
    price_minor: stock.priceMinor,
    maximum_price_minor: stock.maximumPriceMinor,
    availability_code: stock.availabilityCode,
    lead_time: stock.leadTime,
    price_checked_at: stock.priceMinor === null ? null : stockCheckedAt,
    stock_checked_at: stock.hasStockRecord ? stockCheckedAt : null,
    stock_expires_at: stock.hasStockRecord ? expiresAtFromCheckedAt(stockCheckedAt) : null,
    image_url: imageUrl,
    image_alt_en: imageUrl ? title : null,
    title_sort: titleSort,
    search_text: searchText,
    vehicle_text: searchText,
    skus: stock.skus,
    normalized_skus: normalizedSkus,
    mpns: [],
    normalized_mpns: [],
    has_stock_record: stock.hasStockRecord,
    price_is_range: stock.priceMinor !== null && stock.maximumPriceMinor !== null && stock.priceMinor !== stock.maximumPriceMinor,
    is_available: stock.availabilityCode === 'in_stock' || stock.availabilityCode === 'supplier_stock'
  };
}

export function chunkByJsonBytes(records, { maxRows = DEFAULT_BATCH_ROWS, maxBytes = DEFAULT_BATCH_BYTES } = {}) {
  if (!Array.isArray(records)) throw new TypeError('Records must be an array.');
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > MAX_BATCH_ROWS) throw new Error('Invalid maximum batch row count.');
  if (!Number.isInteger(maxBytes) || maxBytes < 1_024 || maxBytes > MAX_BATCH_BYTES) throw new Error('Invalid maximum batch byte count.');
  const chunks = [];
  let chunk = [];
  let bytes = 2;
  for (const record of records) {
    const recordBytes = Buffer.byteLength(JSON.stringify(record), 'utf8');
    if (recordBytes + 2 > maxBytes) throw new Error('A single normalized product exceeds the safe database request size.');
    const separatorBytes = chunk.length ? 1 : 0;
    if (chunk.length && (chunk.length >= maxRows || bytes + separatorBytes + recordBytes > maxBytes)) {
      chunks.push(chunk);
      chunk = [];
      bytes = 2;
    }
    chunk.push(record);
    bytes += (chunk.length > 1 ? 1 : 0) + recordBytes;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

export function expectedCountsFromAccumulator(accumulator) {
  return {
    products: accumulator.products,
    variants: accumulator.products,
    offers: accumulator.products,
    images: accumulator.images,
    searchRows: accumulator.products,
    skuIdentifiers: accumulator.skuIdentifiers,
    mpnIdentifiers: 0,
    pricedOffers: accumulator.pricedOffers,
    availableOffers: accumulator.availableOffers,
    distinctBrands: accumulator.brands.size
  };
}

export function validateImportCounts(expected, actual) {
  const keys = [
    'products', 'variants', 'offers', 'images', 'searchRows', 'skuIdentifiers',
    'mpnIdentifiers', 'pricedOffers', 'availableOffers', 'distinctBrands'
  ];
  const mismatches = [];
  for (const key of keys) {
    const expectedValue = Number(expected[key]);
    const actualValue = Number(actual[key]);
    if (!Number.isSafeInteger(expectedValue) || expectedValue < 0) throw new Error(`Invalid expected count: ${key}.`);
    if (!Number.isSafeInteger(actualValue) || actualValue < 0) mismatches.push(`${key}: invalid database value ${actual[key]}`);
    else if (expectedValue !== actualValue) mismatches.push(`${key}: expected ${expectedValue}, found ${actualValue}`);
  }
  if (mismatches.length) throw new Error(`Staged catalogue validation failed (${mismatches.join('; ')}).`);
  return true;
}

export function resumeRequiresFullReplay(expectedPrefix, actual) {
  try {
    validateImportCounts(expectedPrefix, actual);
    return false;
  } catch {
    return true;
  }
}

function canonicalTimestamp(value, label) {
  const timestamp = Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be a valid timestamp.`);
  return timestamp;
}

export function publicationCandidateAllowed({
  candidateImportId,
  candidateGeneratedAt,
  candidateStartedAt,
  currentImportId = null,
  currentGeneratedAt = null,
  currentStartedAt = null,
  baseCurrentImportId = null
}) {
  if (!candidateImportId) throw new Error('A candidate import ID is required.');
  if (!currentImportId || currentImportId === candidateImportId) return true;
  const candidateGenerated = canonicalTimestamp(candidateGeneratedAt, 'candidateGeneratedAt');
  const candidateStarted = canonicalTimestamp(candidateStartedAt, 'candidateStartedAt');
  const currentGenerated = currentGeneratedAt === null ? Number.NEGATIVE_INFINITY : canonicalTimestamp(currentGeneratedAt, 'currentGeneratedAt');
  const currentStarted = currentStartedAt === null ? Number.NEGATIVE_INFINITY : canonicalTimestamp(currentStartedAt, 'currentStartedAt');
  const isFresher = candidateGenerated > currentGenerated
    || (candidateGenerated === currentGenerated && candidateStarted > currentStarted);
  const isNotOlder = isFresher
    || (candidateGenerated === currentGenerated && candidateStarted === currentStarted);
  const compareAndSwapMatches = currentImportId === baseCurrentImportId;
  return isNotOlder && (compareAndSwapMatches || isFresher);
}

export function safeJsonForDatabase(product) {
  return {
    public_key: product.public_key,
    supplier_product_key: product.supplier_product_key,
    source_handle: product.source_handle,
    source_url: product.source_url,
    title: product.title,
    brand_slug: product.brand_slug,
    brand_name: product.brand_name,
    checked_at: product.checked_at,
    browse_rank: product.browse_rank,
    variant_key: product.variant_key,
    variant_title: product.variant_title,
    currency: product.currency,
    price_minor: product.price_minor,
    availability_code: product.availability_code,
    lead_time: product.lead_time,
    price_checked_at: product.price_checked_at,
    stock_checked_at: product.stock_checked_at,
    stock_expires_at: product.stock_expires_at,
    image_url: product.image_url,
    image_alt_en: product.image_alt_en,
    title_sort: product.title_sort,
    search_text: product.search_text,
    vehicle_text: product.vehicle_text,
    skus: product.skus,
    normalized_skus: product.normalized_skus,
    mpns: product.mpns,
    normalized_mpns: product.normalized_mpns
  };
}
