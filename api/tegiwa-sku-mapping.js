import { createHash } from 'node:crypto';

const MAX_PUBLIC_SKUS_PER_PRODUCT = 2_048;
const MAX_SKU_LENGTH = 120;
const STOCK_KEY_PATTERN = /^[A-Za-z0-9_-]{16}$/;
const UNSAFE_SKU_PATTERN = /[<>`{}]/;
const UNSAFE_SCHEME_PATTERN = /^(?:data|file|ftp|https?|javascript|vbscript):/i;

function parseStockIndex(source) {
  if (Buffer.isBuffer(source) || typeof source === 'string') {
    try {
      return JSON.parse(Buffer.isBuffer(source) ? source.toString('utf8') : source);
    } catch {
      throw new Error('invalid_search_sku_index');
    }
  }
  return source;
}

function validPublicSku(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_SKU_LENGTH
    && /[\p{L}\p{N}]/u.test(value)
    && !UNSAFE_SCHEME_PATTERN.test(value)
    && !UNSAFE_SKU_PATTERN.test(value);
}

function writeLengthPrefixed(hash, value) {
  const buffer = Buffer.from(value, 'utf8');
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(buffer.length);
  hash.update(length);
  hash.update(buffer);
}

/**
 * Fingerprint only the safe public SKU-to-product mapping consumed by search.
 * Price, availability, lead-time and stock-check metadata are deliberately
 * excluded so a stock-only refresh does not require rebuilding the search
 * dictionaries and postings.
 */
export function tegiwaSkuMappingFingerprint(source) {
  const stockIndex = parseStockIndex(source);
  if (!stockIndex || stockIndex.version !== 2
    || !stockIndex.products || typeof stockIndex.products !== 'object'
    || Array.isArray(stockIndex.products)) {
    throw new Error('invalid_search_sku_index');
  }

  const hash = createHash('sha256');
  hash.update('projx-tegiwa-public-sku-mapping-v1\0', 'utf8');
  let mappedProductCount = 0;

  for (const key of Object.keys(stockIndex.products).sort()) {
    const record = stockIndex.products[key];
    if (!STOCK_KEY_PATTERN.test(key)
      || !Array.isArray(record) || record.length !== 6
      || !Array.isArray(record[4]) || record[4].length > MAX_PUBLIC_SKUS_PER_PRODUCT
      || ![0, 1, 2].includes(record[5])) {
      throw new Error('invalid_search_sku_index');
    }

    const skus = record[4];
    if (!skus.every(validPublicSku)
      || (record[5] === 1 ? skus.length < 1 : skus.length !== 0)) {
      throw new Error('invalid_search_sku_index');
    }
    if (record[5] !== 1) continue;

    mappedProductCount += 1;
    writeLengthPrefixed(hash, key);
    const count = Buffer.allocUnsafe(4);
    count.writeUInt32BE(skus.length);
    hash.update(count);
    for (const sku of skus) writeLengthPrefixed(hash, sku);
  }

  if (!Number.isInteger(stockIndex.skuProductCount)
    || stockIndex.skuProductCount !== mappedProductCount) {
    throw new Error('invalid_search_sku_index');
  }

  return hash.digest('hex');
}
