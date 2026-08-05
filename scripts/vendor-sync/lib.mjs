import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import {
  appendFile,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  statfs,
  unlink
} from 'node:fs/promises';
import path from 'node:path';

const VENDOR = 'tegiwa';
const POINTER_VERSION = 1;
const RELEASE_VERSION = 1;
const INDEX_VERSION = 2;
const MAX_PRODUCTS = 2_000_000;
const MAX_LEAD_TIMES = 2_000;
const MAX_SKUS_PER_PRODUCT = 2_048;
const MAX_SKU_LENGTH = 120;
const MAX_BUILDER_OUTPUT_BYTES = 64 * 1024;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const RELEASE_ID_PATTERN = /^\d{8}T\d{9}Z-[a-f0-9]{8}$/;

export const TEGIWA_STOCKFEED_URL = 'https://scripts.tegiwa.de/dealer-stock/';
export const TEGIWA_REQUIRED_HEADERS = Object.freeze([
  'Title',
  'Variant SKU',
  'Variant Inventory Qty',
  'RRP Inc VAT',
  'External Supplier Stock',
  'External Supplier Lead Time'
]);

export const DEFAULT_THRESHOLDS = Object.freeze({
  maxInputBytes: 1_500_000_000,
  maxAgeDays: 3,
  maxFutureDays: 1,
  maxProductDropRatio: 0.15,
  maxProductGrowthRatio: 0.35,
  maxSkuDropRatio: 0.15,
  maxSkuGrowthRatio: 0.35,
  maxAvailableDropRatio: 0.50,
  maxAvailableGrowthRatio: 1.50,
  maxKeyRemovalRatio: 0.15,
  maxKeyAdditionRatio: 0.35,
  maxChangedRecordRatio: 0.80,
  maxIndividualPriceChangeRatio: 0.50,
  maxCatastrophicPriceChangeRatio: 0.90,
  minIndividualPriceChangePence: 5_000,
  materialPriceChangeThresholdRatio: 0.10,
  maxMaterialPriceChangeProductRatio: 0.08,
  minPriceAggregateSampleSize: 20,
  maxMedianPriceChangeRatio: 0.10,
  maxPriceChangeP90Ratio: 0.35,
  maxNullPriceRegressionRatio: 0.02,
  maxNullPriceRegressionCount: 250,
  minFreeDiskBytes: 5_000_000_000,
  diskReserveMultiplier: 2,
  maxPrivateArchiveFiles: 9_000,
  maxReleaseDirectories: 9_000
});

const THRESHOLD_RANGES = Object.freeze({
  maxInputBytes: [1, 10_000_000_000],
  maxAgeDays: [0, 31],
  maxFutureDays: [0, 2],
  maxProductDropRatio: [0, 1],
  maxProductGrowthRatio: [0, 5],
  maxSkuDropRatio: [0, 1],
  maxSkuGrowthRatio: [0, 5],
  maxAvailableDropRatio: [0, 1],
  maxAvailableGrowthRatio: [0, 10],
  maxKeyRemovalRatio: [0, 1],
  maxKeyAdditionRatio: [0, 5],
  maxChangedRecordRatio: [0, 1],
  maxIndividualPriceChangeRatio: [0, 10],
  maxCatastrophicPriceChangeRatio: [0, 10],
  minIndividualPriceChangePence: [1, 100_000_000_000],
  materialPriceChangeThresholdRatio: [0, 10],
  maxMaterialPriceChangeProductRatio: [0, 1],
  minPriceAggregateSampleSize: [1, 100_000],
  maxMedianPriceChangeRatio: [0, 5],
  maxPriceChangeP90Ratio: [0, 10],
  maxNullPriceRegressionRatio: [0, 1],
  maxNullPriceRegressionCount: [0, 2_000_000],
  minFreeDiskBytes: [1, 1_000_000_000_000_000],
  diskReserveMultiplier: [1, 10],
  maxPrivateArchiveFiles: [1, 1_000_000],
  maxReleaseDirectories: [1, 1_000_000]
});

const INTEGER_THRESHOLDS = new Set([
  'maxInputBytes',
  'minIndividualPriceChangePence',
  'minPriceAggregateSampleSize',
  'maxNullPriceRegressionCount',
  'minFreeDiskBytes',
  'diskReserveMultiplier',
  'maxPrivateArchiveFiles',
  'maxReleaseDirectories'
]);

const INDEX_KEYS = new Set([
  'version', 'priceBasis', 'checkedAt', 'productCount', 'skuProductCount',
  'availableProductCount', 'leadTimes', 'products'
]);

export class VendorSyncError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'VendorSyncError';
    this.code = code;
    this.details = details;
  }
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isoTimestamp(value) {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) throw new VendorSyncError('invalid_clock', 'The sync clock is invalid.');
  return timestamp.toISOString();
}

function compactTimestamp(value) {
  return isoTimestamp(value).replace(/[-:.]/g, '');
}

function checkedAtDate(value, { now = Date.now(), maxAgeDays = 3, maxFutureDays = 1, freshness = true } = {}) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new VendorSyncError('invalid_checked_at', 'The stock check date must use YYYY-MM-DD.');
  }
  const timestamp = Date.parse(`${text}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== text) {
    throw new VendorSyncError('invalid_checked_at', 'The stock check date is invalid.');
  }
  if (freshness) {
    const today = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00.000Z`);
    const ageDays = Math.floor((today - timestamp) / 86_400_000);
    if (ageDays > maxAgeDays) throw new VendorSyncError('stale_stock_snapshot', 'The staged stock snapshot is too old.');
    if (ageDays < -maxFutureDays) throw new VendorSyncError('future_stock_snapshot', 'The staged stock snapshot is dated too far in the future.');
  }
  return text;
}

function finiteNumber(value, label, minimum, maximum, { integer = false } = {}) {
  if (!Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    throw new VendorSyncError('invalid_stock_index', `The ${label} field is invalid.`);
  }
  return value;
}

function safeSku(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_SKU_LENGTH
    && /[\p{L}\p{N}]/u.test(value)
    && !/[\u0000-\u001F\u007F-\u009F<>`{}]/u.test(value)
    && !/^(?:data|file|ftp|https?|javascript|vbscript):/i.test(value);
}

export function mergeThresholds(overrides = {}) {
  if (!plainObject(overrides)) throw new VendorSyncError('invalid_thresholds', 'Threshold settings must be a JSON object.');
  for (const key of Object.keys(overrides)) {
    if (!Object.hasOwn(THRESHOLD_RANGES, key)) throw new VendorSyncError('invalid_thresholds', `Unsupported threshold: ${key}`);
  }
  const merged = { ...DEFAULT_THRESHOLDS, ...overrides };
  for (const [key, [minimum, maximum]] of Object.entries(THRESHOLD_RANGES)) {
    const value = merged[key];
    if (!Number.isFinite(value) || value < minimum || value > maximum
      || (INTEGER_THRESHOLDS.has(key) && !Number.isSafeInteger(value))) {
      throw new VendorSyncError('invalid_thresholds', `Threshold ${key} is outside its safe range.`);
    }
  }
  return Object.freeze(merged);
}

export function validateTegiwaIndex(index, {
  now = Date.now(), thresholds = DEFAULT_THRESHOLDS, freshness = true, expectedCheckedAt = null
} = {}) {
  const limits = mergeThresholds(thresholds);
  if (!plainObject(index)) throw new VendorSyncError('invalid_stock_index', 'The Tegiwa stock index must be a JSON object.');
  for (const key of Object.keys(index)) {
    if (!INDEX_KEYS.has(key)) throw new VendorSyncError('invalid_stock_index', `Unexpected stock-index field: ${key}`);
  }
  if (index.version !== INDEX_VERSION || index.priceBasis !== 'gbp_ex_uk_vat') {
    throw new VendorSyncError('invalid_stock_index', 'The stock-index version or GBP price basis is unsupported.');
  }
  const checkedAt = checkedAtDate(index.checkedAt, {
    now,
    maxAgeDays: limits.maxAgeDays,
    maxFutureDays: limits.maxFutureDays,
    freshness
  });
  if (expectedCheckedAt && checkedAt !== expectedCheckedAt) {
    throw new VendorSyncError('checked_at_mismatch', 'The candidate check date does not match the requested date.');
  }
  finiteNumber(index.productCount, 'productCount', 1, MAX_PRODUCTS, { integer: true });
  finiteNumber(index.skuProductCount, 'skuProductCount', 0, MAX_PRODUCTS, { integer: true });
  finiteNumber(index.availableProductCount, 'availableProductCount', 0, MAX_PRODUCTS, { integer: true });
  if (!Array.isArray(index.leadTimes) || index.leadTimes.length < 1 || index.leadTimes.length > MAX_LEAD_TIMES
    || index.leadTimes[0] !== ''
    || index.leadTimes.some(value => typeof value !== 'string' || value.length > 120
      || /[\u0000-\u001F\u007F-\u009F<>`{}]/u.test(value))) {
    throw new VendorSyncError('invalid_stock_index', 'The public lead-time table is invalid.');
  }
  if (!plainObject(index.products)) throw new VendorSyncError('invalid_stock_index', 'The products map is invalid.');
  const entries = Object.entries(index.products);
  if (entries.length < index.productCount || entries.length > MAX_PRODUCTS) {
    throw new VendorSyncError('invalid_stock_index', 'The product-key count is inconsistent or outside its safe limit.');
  }

  let priced = 0;
  let available = 0;
  let skuIndexed = 0;
  for (const [key, record] of entries) {
    if (!/^[A-Za-z0-9_-]{16}$/.test(key) || !Array.isArray(record) || record.length !== 6) {
      throw new VendorSyncError('invalid_stock_index', 'A public product record has an invalid key or shape.');
    }
    const [minimum, maximum, statusCode, leadTimeIndex, skus, skuState] = record;
    const pricedRecord = minimum !== null || maximum !== null;
    if (pricedRecord) {
      finiteNumber(minimum, 'minimum price', 1, 100_000_000_000, { integer: true });
      finiteNumber(maximum, 'maximum price', minimum, 100_000_000_000, { integer: true });
      finiteNumber(statusCode, 'availability status', 0, 3, { integer: true });
      priced += 1;
      if (statusCode === 1 || statusCode === 2) available += 1;
    } else if (minimum !== null || maximum !== null || statusCode !== null || leadTimeIndex !== 0) {
      throw new VendorSyncError('invalid_stock_index', 'A SKU-only record contains price or availability data.');
    }
    finiteNumber(leadTimeIndex, 'lead-time index', 0, index.leadTimes.length - 1, { integer: true });
    if (!Array.isArray(skus) || skus.length > MAX_SKUS_PER_PRODUCT || skus.some(value => !safeSku(value))) {
      throw new VendorSyncError('invalid_stock_index', 'A product contains an invalid public SKU list.');
    }
    const skuIdentities = new Set(skus.map(value => value.toLocaleLowerCase('en-US')));
    if (skuIdentities.size !== skus.length || ![0, 1, 2].includes(skuState)
      || (skuState === 1 && skus.length === 0) || (skuState !== 1 && skus.length !== 0)) {
      throw new VendorSyncError('invalid_stock_index', 'A product contains ambiguous or inconsistent public SKU state.');
    }
    if (skuState === 1) skuIndexed += 1;
  }
  if (priced !== index.productCount || available !== index.availableProductCount || skuIndexed !== index.skuProductCount) {
    throw new VendorSyncError('invalid_stock_index', 'The stock-index aggregates do not match the product records.');
  }
  return Object.freeze({
    checkedAt,
    productCount: priced,
    totalKeyCount: entries.length,
    skuProductCount: skuIndexed,
    availableProductCount: available
  });
}

function ratioIncrease(current, baseline) {
  return baseline > 0 && current > baseline ? (current - baseline) / baseline : 0;
}

function ratioDecrease(current, baseline) {
  return baseline > 0 && current < baseline ? (baseline - current) / baseline : 0;
}

function quantile(sortedValues, probability) {
  if (!sortedValues.length) return 0;
  const position = (sortedValues.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) return sortedValues[lowerIndex];
  const weight = position - lowerIndex;
  return sortedValues[lowerIndex] * (1 - weight) + sortedValues[upperIndex] * weight;
}

function nearestRankQuantile(sortedValues, probability) {
  if (!sortedValues.length) return 0;
  const index = Math.max(0, Math.ceil(probability * sortedValues.length) - 1);
  return sortedValues[index];
}

function priceChangeMetrics(candidate, baseline, limits) {
  const signedRatios = [];
  const absoluteRatios = [];
  let comparablePriceCount = 0;
  let baselinePricedCount = 0;
  let nullPriceRegressionCount = 0;
  let largeIndividualPriceChangeCount = 0;
  let catastrophicPriceChangeCount = 0;
  let materialPriceChangeCount = 0;
  let maximumIndividualPriceChangeRatio = 0;
  for (const [key, baselineRecord] of Object.entries(baseline.products)) {
    const baselinePriced = Array.isArray(baselineRecord)
      && Number.isFinite(baselineRecord[0]) && Number.isFinite(baselineRecord[1]);
    if (!baselinePriced) continue;
    baselinePricedCount += 1;
    const candidateRecord = candidate.products[key];
    const candidatePriced = Array.isArray(candidateRecord)
      && Number.isFinite(candidateRecord[0]) && Number.isFinite(candidateRecord[1]);
    if (!candidatePriced) {
      nullPriceRegressionCount += 1;
      continue;
    }
    comparablePriceCount += 1;
    const minimumDifference = Math.abs(candidateRecord[0] - baselineRecord[0]);
    const maximumDifference = Math.abs(candidateRecord[1] - baselineRecord[1]);
    const minimumRatio = minimumDifference / baselineRecord[0];
    const maximumRatio = maximumDifference / baselineRecord[1];
    const individualRatio = Math.max(minimumRatio, maximumRatio);
    const individualAbsoluteChange = Math.max(minimumDifference, maximumDifference);
    maximumIndividualPriceChangeRatio = Math.max(maximumIndividualPriceChangeRatio, individualRatio);
    if (individualRatio > limits.maxCatastrophicPriceChangeRatio) catastrophicPriceChangeCount += 1;
    if (individualRatio > limits.materialPriceChangeThresholdRatio) materialPriceChangeCount += 1;
    if (individualAbsoluteChange >= limits.minIndividualPriceChangePence
      && individualRatio > limits.maxIndividualPriceChangeRatio) {
      largeIndividualPriceChangeCount += 1;
    }
    const baselineRepresentative = (baselineRecord[0] + baselineRecord[1]) / 2;
    const candidateRepresentative = (candidateRecord[0] + candidateRecord[1]) / 2;
    const signedRatio = (candidateRepresentative - baselineRepresentative) / baselineRepresentative;
    signedRatios.push(signedRatio);
    absoluteRatios.push(individualRatio);
  }
  signedRatios.sort((left, right) => left - right);
  absoluteRatios.sort((left, right) => left - right);
  return Object.freeze({
    comparablePriceCount,
    baselinePricedCount,
    nullPriceRegressionCount,
    nullPriceRegressionRatio: baselinePricedCount ? nullPriceRegressionCount / baselinePricedCount : 0,
    largeIndividualPriceChangeCount,
    catastrophicPriceChangeCount,
    materialPriceChangeCount,
    materialPriceChangeProductRatio: comparablePriceCount ? materialPriceChangeCount / comparablePriceCount : 0,
    maximumIndividualPriceChangeRatio,
    medianPriceChangeRatio: quantile(signedRatios, 0.5),
    p90AbsolutePriceChangeRatio: nearestRankQuantile(absoluteRatios, 0.9)
  });
}

export function evaluateAbnormalChange(candidate, baseline, thresholds = DEFAULT_THRESHOLDS) {
  const limits = mergeThresholds(thresholds);
  const candidateKeys = Object.keys(candidate.products);
  const baselineKeys = Object.keys(baseline.products);
  const candidateSet = new Set(candidateKeys);
  const baselineSet = new Set(baselineKeys);
  let removed = 0;
  let added = 0;
  let changed = 0;
  for (const key of baselineKeys) {
    if (!candidateSet.has(key)) removed += 1;
    else if (JSON.stringify(candidate.products[key]) !== JSON.stringify(baseline.products[key])) changed += 1;
  }
  for (const key of candidateKeys) if (!baselineSet.has(key)) added += 1;
  const shared = Math.max(1, baselineKeys.length - removed);
  const priceMetrics = priceChangeMetrics(candidate, baseline, limits);
  const metrics = {
    productDropRatio: ratioDecrease(candidate.productCount, baseline.productCount),
    productGrowthRatio: ratioIncrease(candidate.productCount, baseline.productCount),
    skuDropRatio: ratioDecrease(candidate.skuProductCount, baseline.skuProductCount),
    skuGrowthRatio: ratioIncrease(candidate.skuProductCount, baseline.skuProductCount),
    availableDropRatio: ratioDecrease(candidate.availableProductCount, baseline.availableProductCount),
    availableGrowthRatio: ratioIncrease(candidate.availableProductCount, baseline.availableProductCount),
    keyRemovalRatio: baselineKeys.length ? removed / baselineKeys.length : 0,
    keyAdditionRatio: baselineKeys.length ? added / baselineKeys.length : 0,
    changedRecordRatio: changed / shared,
    removedKeyCount: removed,
    addedKeyCount: added,
    changedRecordCount: changed,
    ...priceMetrics
  };
  const gates = [
    ['product_drop', metrics.productDropRatio, limits.maxProductDropRatio],
    ['product_growth', metrics.productGrowthRatio, limits.maxProductGrowthRatio],
    ['sku_drop', metrics.skuDropRatio, limits.maxSkuDropRatio],
    ['sku_growth', metrics.skuGrowthRatio, limits.maxSkuGrowthRatio],
    ['available_drop', metrics.availableDropRatio, limits.maxAvailableDropRatio],
    ['available_growth', metrics.availableGrowthRatio, limits.maxAvailableGrowthRatio],
    ['key_removal', metrics.keyRemovalRatio, limits.maxKeyRemovalRatio],
    ['key_addition', metrics.keyAdditionRatio, limits.maxKeyAdditionRatio],
    ['record_change', metrics.changedRecordRatio, limits.maxChangedRecordRatio]
  ];
  const failures = gates
    .filter(([, actual, maximum]) => actual > maximum)
    .map(([code, actual, maximum]) => ({ code, actual, maximum }));
  if (candidate.checkedAt < baseline.checkedAt) {
    failures.push({ code: 'checked_at_regressed', actual: candidate.checkedAt, minimum: baseline.checkedAt });
  }
  if (priceMetrics.largeIndividualPriceChangeCount > 0) {
    failures.push({
      code: 'individual_price_change',
      actual: priceMetrics.largeIndividualPriceChangeCount,
      maximum: 0
    });
  }
  if (priceMetrics.catastrophicPriceChangeCount > 0) {
    failures.push({
      code: 'catastrophic_price_change',
      actual: priceMetrics.catastrophicPriceChangeCount,
      maximum: 0
    });
  }
  if (priceMetrics.materialPriceChangeProductRatio > limits.maxMaterialPriceChangeProductRatio) {
    failures.push({
      code: 'material_price_change_share',
      actual: priceMetrics.materialPriceChangeProductRatio,
      maximum: limits.maxMaterialPriceChangeProductRatio
    });
  }
  if (priceMetrics.comparablePriceCount >= limits.minPriceAggregateSampleSize
    && Math.abs(priceMetrics.medianPriceChangeRatio) > limits.maxMedianPriceChangeRatio) {
    failures.push({
      code: 'median_price_change',
      actual: Math.abs(priceMetrics.medianPriceChangeRatio),
      maximum: limits.maxMedianPriceChangeRatio
    });
  }
  if (priceMetrics.comparablePriceCount >= limits.minPriceAggregateSampleSize
    && priceMetrics.p90AbsolutePriceChangeRatio > limits.maxPriceChangeP90Ratio) {
    failures.push({
      code: 'price_change_p90',
      actual: priceMetrics.p90AbsolutePriceChangeRatio,
      maximum: limits.maxPriceChangeP90Ratio
    });
  }
  if (priceMetrics.nullPriceRegressionRatio > limits.maxNullPriceRegressionRatio) {
    failures.push({
      code: 'null_price_regression_ratio',
      actual: priceMetrics.nullPriceRegressionRatio,
      maximum: limits.maxNullPriceRegressionRatio
    });
  }
  if (priceMetrics.nullPriceRegressionCount > limits.maxNullPriceRegressionCount) {
    failures.push({
      code: 'null_price_regression_count',
      actual: priceMetrics.nullPriceRegressionCount,
      maximum: limits.maxNullPriceRegressionCount
    });
  }
  return Object.freeze({ passed: failures.length === 0, metrics: Object.freeze(metrics), failures: Object.freeze(failures) });
}

async function sha256File(filePath, maximumBytes) {
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new VendorSyncError('invalid_input_file', 'The vendor input must be a regular, non-symbolic file.');
  }
  if (metadata.size < 1 || metadata.size > maximumBytes) {
    throw new VendorSyncError('invalid_input_size', 'The vendor input size is outside the configured safety limit.');
  }
  const hash = createHash('sha256');
  let bytes = 0;
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maximumBytes) stream.destroy(new VendorSyncError('invalid_input_size', 'The vendor input exceeded its configured safety limit.'));
      else hash.update(chunk);
    });
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return { bytes, sha256: hash.digest('hex') };
}

function validateStockfeedUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new VendorSyncError('unapproved_feed_url', 'The configured Tegiwa stockfeed URL is invalid.');
  }
  if (url.href !== TEGIWA_STOCKFEED_URL || url.protocol !== 'https:'
    || url.hostname !== 'scripts.tegiwa.de' || url.port || url.pathname !== '/dealer-stock/'
    || url.search || url.hash || url.username || url.password) {
    throw new VendorSyncError('unapproved_feed_url', 'The Tegiwa download URL is outside the approved HTTPS host and path.');
  }
  return url.href;
}

function parseCsvHeader(text) {
  const values = [];
  let field = '';
  let quoted = false;
  let closingQuote = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (index === 0 && character === '\uFEFF') continue;
    if (quoted) {
      if (closingQuote) {
        if (character === '"') {
          field += '"';
          closingQuote = false;
          continue;
        }
        quoted = false;
        closingQuote = false;
        if (character !== ',' && character !== '\r' && character !== '\n') {
          throw new VendorSyncError('invalid_feed_headers', 'The Tegiwa CSV header row is malformed.');
        }
      } else if (character === '"') {
        closingQuote = true;
        continue;
      } else {
        field += character;
        continue;
      }
    }
    if (character === '"') {
      if (field) throw new VendorSyncError('invalid_feed_headers', 'The Tegiwa CSV header row is malformed.');
      quoted = true;
    } else if (character === ',') {
      values.push(field);
      field = '';
    } else if (character === '\r' || character === '\n') {
      values.push(field);
      return values;
    } else {
      field += character;
    }
  }
  throw new VendorSyncError('invalid_feed_headers', 'The Tegiwa CSV header row is incomplete or too large.');
}

async function validateDownloadedHeaders(filePath) {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(256 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead));
    } catch {
      throw new VendorSyncError('invalid_feed_encoding', 'The Tegiwa stockfeed is not valid UTF-8 text.');
    }
    const headers = parseCsvHeader(text);
    const unique = new Set(headers);
    if (unique.size !== headers.length || TEGIWA_REQUIRED_HEADERS.some(header => !unique.has(header))) {
      throw new VendorSyncError('invalid_feed_headers', 'The Tegiwa stockfeed does not contain the exact required public-index source headers.');
    }
    return headers;
  } finally {
    await handle.close();
  }
}

export async function downloadTegiwaStockfeed({
  destination,
  maximumBytes = DEFAULT_THRESHOLDS.maxInputBytes,
  fetchImpl = globalThis.fetch,
  timeoutMs = DOWNLOAD_TIMEOUT_MS
}) {
  if (typeof fetchImpl !== 'function') throw new VendorSyncError('download_unavailable', 'No HTTPS fetch implementation is available.');
  finiteNumber(maximumBytes, 'maximum download bytes', 1, 10_000_000_000, { integer: true });
  finiteNumber(timeoutMs, 'download timeout', 1_000, 600_000, { integer: true });
  const url = validateStockfeedUrl(TEGIWA_STOCKFEED_URL);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        accept: 'text/csv',
        'accept-encoding': 'identity',
        'cache-control': 'no-cache',
        'user-agent': 'ProjxRacingVendorStockSync/1.0'
      },
      redirect: 'manual',
      signal: controller.signal
    });
  } catch {
    clearTimeout(timeout);
    throw new VendorSyncError('download_failed', 'The approved Tegiwa stockfeed could not be downloaded.');
  }
  try {
    if (response && response.status >= 300 && response.status < 400) {
      throw new VendorSyncError('redirect_blocked', 'A Tegiwa stockfeed redirect was blocked.');
    }
    if (!response || response.status !== 200 || !response.ok) {
      throw new VendorSyncError('download_failed', 'The approved Tegiwa stockfeed returned an unexpected HTTP status.');
    }
    if (response.url && response.url !== url) {
      throw new VendorSyncError('redirect_blocked', 'A Tegiwa stockfeed redirect was blocked.');
    }
    const contentType = String(response.headers?.get?.('content-type') || '');
    if (!/^text\/csv(?:\s*;|$)/i.test(contentType)) {
      throw new VendorSyncError('invalid_feed_content_type', 'The Tegiwa stockfeed response was not CSV.');
    }
    const contentEncoding = String(response.headers?.get?.('content-encoding') || '').trim();
    if (contentEncoding && contentEncoding.toLowerCase() !== 'identity') {
      throw new VendorSyncError('invalid_feed_content_encoding', 'The Tegiwa stockfeed ignored the required identity transfer encoding.');
    }
    const declaredLength = String(response.headers?.get?.('content-length') || '').trim();
    let declaredBytes = null;
    if (declaredLength) {
      declaredBytes = Number(declaredLength);
      if (!/^\d+$/.test(declaredLength) || !Number.isSafeInteger(declaredBytes)
        || declaredBytes < 1 || declaredBytes > maximumBytes) {
        throw new VendorSyncError('invalid_input_size', 'The Tegiwa stockfeed content length is outside the safety limit.');
      }
    }
    if (!response.body || typeof response.body[Symbol.asyncIterator] !== 'function') {
      throw new VendorSyncError('download_failed', 'The Tegiwa stockfeed response body was unavailable.');
    }
    let handle = null;
    const hash = createHash('sha256');
    let bytes = 0;
    try {
      handle = await open(destination, 'wx', 0o600);
      for await (const value of response.body) {
        const chunk = Buffer.from(value);
        bytes += chunk.length;
        if (bytes > maximumBytes) throw new VendorSyncError('invalid_input_size', 'The Tegiwa stockfeed exceeded the streamed size limit.');
        hash.update(chunk);
        let offset = 0;
        while (offset < chunk.length) {
          const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset, null);
          if (bytesWritten < 1) throw new VendorSyncError('download_failed', 'The staged Tegiwa stockfeed could not be written completely.');
          offset += bytesWritten;
        }
      }
      await handle.sync();
      await handle.close();
      handle = null;
      if (bytes < 1 || (declaredBytes !== null && bytes !== declaredBytes)) {
        throw new VendorSyncError('invalid_input_size', 'The Tegiwa stockfeed length did not match the validated response size.');
      }
      await validateDownloadedHeaders(destination);
      return { bytes, sha256: hash.digest('hex'), contentType };
    } catch (error) {
      if (handle) {
        try { await handle.close(); } catch { /* Preserve the download or validation failure. */ }
      }
      try { await rm(destination, { force: true }); } catch { /* Preserve the download or validation failure. */ }
      throw error;
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(filePath, { maximumBytes = 500_000_000, label = 'JSON file' } = {}) {
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > maximumBytes) {
    throw new VendorSyncError('invalid_json_file', `${label} is missing or outside its safe size limit.`);
  }
  try {
    const text = await readFile(filePath, 'utf8');
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    if (error instanceof VendorSyncError) throw error;
    throw new VendorSyncError('invalid_json_file', `${label} is not valid JSON.`);
  }
}

function pathContains(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function validatePrivateArchiveDirectory(archiveDirectory, { workspace, repoRoot }) {
  if (!archiveDirectory) {
    throw new VendorSyncError('private_archive_required', 'Approved downloads require an explicit private archive directory.');
  }
  const archiveRoot = path.resolve(archiveDirectory);
  if (archiveRoot === path.dirname(archiveRoot)) {
    throw new VendorSyncError('unsafe_private_archive', 'A filesystem or drive root cannot be used as the private archive directory.');
  }
  const workspaceRoot = path.resolve(workspace);
  const repositoryRoot = path.resolve(repoRoot);
  if (pathContains(archiveRoot, workspaceRoot) || pathContains(workspaceRoot, archiveRoot)
    || pathContains(archiveRoot, repositoryRoot) || pathContains(repositoryRoot, archiveRoot)) {
    throw new VendorSyncError('unsafe_private_archive', 'The private archive must be separate from the repository and vendor workspace.');
  }
  let metadata;
  try {
    metadata = await lstat(archiveRoot);
  } catch {
    throw new VendorSyncError('private_archive_unavailable', 'The private archive directory is unavailable.');
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new VendorSyncError('unsafe_private_archive', 'The private archive must be a real local directory, not a file or symbolic link.');
  }
  return archiveRoot;
}

export async function archiveApprovedDownload({
  sourcePath,
  archiveDirectory,
  expectedBytes,
  expectedSha256,
  now = Date.now(),
  maximumBytes = DEFAULT_THRESHOLDS.maxInputBytes
}) {
  if (!/^[a-f0-9]{64}$/.test(String(expectedSha256 || ''))
    || !Number.isSafeInteger(expectedBytes) || expectedBytes < 1) {
    throw new VendorSyncError('invalid_archive_source', 'The validated download metadata is invalid.');
  }
  let archiveMetadata;
  try {
    archiveMetadata = await lstat(archiveDirectory);
  } catch {
    throw new VendorSyncError('private_archive_unavailable', 'The private archive directory is unavailable.');
  }
  if (!archiveMetadata.isDirectory() || archiveMetadata.isSymbolicLink()) {
    throw new VendorSyncError('unsafe_private_archive', 'The private archive changed after its initial safety validation.');
  }
  const sourceVerification = await sha256File(sourcePath, maximumBytes);
  if (sourceVerification.bytes !== expectedBytes || sourceVerification.sha256 !== expectedSha256) {
    throw new VendorSyncError('invalid_archive_source', 'The staged download changed before private archival.');
  }
  const filename = `${VENDOR}-stock-${compactTimestamp(now)}-${expectedSha256}.csv`;
  const destination = path.join(archiveDirectory, filename);
  let created = false;
  try {
    await copyFile(sourcePath, destination, fs.constants.COPYFILE_EXCL);
    created = true;
    const verification = await sha256File(destination, maximumBytes);
    if (verification.bytes !== expectedBytes || verification.sha256 !== expectedSha256) {
      throw new VendorSyncError('private_archive_checksum_failed', 'The private archive copy failed checksum verification.');
    }
    const handle = await open(destination, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    const finalVerification = await sha256File(destination, maximumBytes);
    if (finalVerification.bytes !== expectedBytes || finalVerification.sha256 !== expectedSha256) {
      throw new VendorSyncError('private_archive_checksum_failed', 'The private archive changed during durable verification.');
    }
    return Object.freeze({ filename, bytes: finalVerification.bytes, sha256: finalVerification.sha256 });
  } catch (error) {
    if (created) {
      try { await rm(destination, { force: true }); } catch { /* Preserve the archival failure. */ }
    }
    if (error instanceof VendorSyncError) throw error;
    if (error?.code === 'EEXIST') {
      throw new VendorSyncError('private_archive_exists', 'The immutable private archive name already exists.');
    }
    throw new VendorSyncError('private_archive_failed', 'The validated download could not be written to the private archive.');
  }
}

async function writeExclusive(filePath, data) {
  const handle = await open(filePath, 'wx', 0o600);
  try {
    await handle.writeFile(data, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeExclusiveJson(filePath, value) {
  await writeExclusive(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function atomicWriteJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  try {
    await writeExclusiveJson(temporary, value);
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

function releaseIdFor(now, candidateSha256) {
  return `${compactTimestamp(now)}-${candidateSha256.slice(0, 8)}`;
}

function assertReleaseId(value) {
  if (!RELEASE_ID_PATTERN.test(String(value || ''))) {
    throw new VendorSyncError('invalid_release_id', 'The release identifier is invalid.');
  }
  return String(value);
}

function workspacePaths(workspace) {
  const root = path.resolve(workspace);
  const parent = path.dirname(root);
  if (root === parent) throw new VendorSyncError('unsafe_workspace', 'A drive or filesystem root cannot be used as the sync workspace.');
  return Object.freeze({
    root,
    lock: path.join(root, '.vendor-sync.lock'),
    staging: path.join(root, 'staging'),
    releases: path.join(root, 'releases'),
    history: path.join(root, 'history'),
    health: path.join(root, 'health'),
    current: path.join(root, 'current.json')
  });
}

async function countRetainedEntries(directory, predicate) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return 0;
    throw new VendorSyncError('retention_check_failed', 'Retained local data could not be counted safely.');
  }
  return entries.filter(predicate).length;
}

function diskBytes(stats) {
  const availableBlocks = typeof stats?.bavail === 'bigint'
    ? stats.bavail
    : (Number.isSafeInteger(stats?.bavail) && stats.bavail >= 0 ? BigInt(stats.bavail) : null);
  const blockSize = typeof stats?.bsize === 'bigint'
    ? stats.bsize
    : (Number.isSafeInteger(stats?.bsize) && stats.bsize > 0 ? BigInt(stats.bsize) : null);
  if (availableBlocks === null || blockSize === null || availableBlocks < 0n || blockSize < 1n) {
    throw new VendorSyncError('disk_space_unavailable', 'Available local disk space could not be measured safely.');
  }
  return availableBlocks * blockSize;
}

async function availableDiskBytes(target, diskSpaceProvider) {
  try {
    return diskBytes(await diskSpaceProvider(target));
  } catch (error) {
    if (error instanceof VendorSyncError) throw error;
    throw new VendorSyncError('disk_space_unavailable', 'Available local disk space could not be measured safely.');
  }
}

async function validatePromotionCapacity({
  paths,
  privateArchiveDirectory,
  sourceBytes,
  candidateBytes,
  thresholds,
  diskSpaceProvider
}) {
  const releaseCount = await countRetainedEntries(
    paths.releases,
    entry => entry.isDirectory() && RELEASE_ID_PATTERN.test(entry.name)
  );
  if (releaseCount >= thresholds.maxReleaseDirectories) {
    throw new VendorSyncError('release_retention_limit', 'The retained release limit was reached; promotion stopped without deleting data.');
  }
  if (privateArchiveDirectory) {
    const archivePattern = new RegExp(`^${VENDOR}-stock-\\d{8}T\\d{9}Z-[a-f0-9]{64}\\.csv$`);
    const archiveCount = await countRetainedEntries(
      privateArchiveDirectory,
      entry => (entry.isFile() || entry.isSymbolicLink()) && archivePattern.test(entry.name)
    );
    if (archiveCount >= thresholds.maxPrivateArchiveFiles) {
      throw new VendorSyncError('private_archive_retention_limit', 'The private archive retention limit was reached; promotion stopped without deleting data.');
    }
  }
  const projectedBytes = BigInt(sourceBytes + candidateBytes) * BigInt(thresholds.diskReserveMultiplier);
  const requiredAvailable = BigInt(thresholds.minFreeDiskBytes) + projectedBytes;
  if (await availableDiskBytes(paths.root, diskSpaceProvider) < requiredAvailable) {
    throw new VendorSyncError('disk_space_low', 'The vendor workspace does not have the configured free-space reserve.');
  }
  if (privateArchiveDirectory
    && await availableDiskBytes(privateArchiveDirectory, diskSpaceProvider) < requiredAvailable) {
    throw new VendorSyncError('disk_space_low', 'The private archive does not have the configured free-space reserve.');
  }
  return Object.freeze({ releaseCount });
}

export async function acquireRunLock(workspace, { runId, now = Date.now() } = {}) {
  const paths = workspacePaths(workspace);
  await mkdir(paths.root, { recursive: true });
  const token = randomUUID();
  let handle;
  try {
    handle = await open(paths.lock, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new VendorSyncError('run_locked', 'Another vendor-sync run may still be active; the lock was not removed automatically.');
    }
    throw error;
  }
  try {
    await handle.writeFile(`${JSON.stringify({ version: 1, vendor: VENDOR, runId, token, pid: process.pid, startedAt: isoTimestamp(now) })}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try {
      const lock = await readJson(paths.lock, { maximumBytes: 16_384, label: 'Run lock' });
      if (lock?.token === token) await unlink(paths.lock);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  };
}

function healthMonth(now) {
  return isoTimestamp(now).slice(0, 7);
}

function safeFailure(error) {
  if (error instanceof VendorSyncError) return { code: error.code, message: error.message };
  return { code: 'unexpected_failure', message: 'The vendor sync stopped because of an unexpected local error.' };
}

const HEALTH_COUNT_KEYS = Object.freeze([
  'productCount', 'totalKeyCount', 'skuProductCount', 'availableProductCount'
]);
const HEALTH_METRIC_KEYS = Object.freeze([
  'productDropRatio', 'productGrowthRatio', 'skuDropRatio', 'skuGrowthRatio',
  'availableDropRatio', 'availableGrowthRatio', 'keyRemovalRatio', 'keyAdditionRatio',
  'changedRecordRatio', 'removedKeyCount', 'addedKeyCount', 'changedRecordCount',
  'comparablePriceCount', 'baselinePricedCount', 'nullPriceRegressionCount',
  'nullPriceRegressionRatio', 'largeIndividualPriceChangeCount',
  'catastrophicPriceChangeCount', 'materialPriceChangeCount',
  'materialPriceChangeProductRatio', 'maximumIndividualPriceChangeRatio',
  'medianPriceChangeRatio', 'p90AbsolutePriceChangeRatio'
]);

function healthCode(value, fallback = null) {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : fallback;
}

function healthNumbers(value, keys) {
  if (!plainObject(value)) return null;
  const result = {};
  for (const key of keys) {
    if (Number.isFinite(value[key]) && (value[key] >= 0 || key === 'medianPriceChangeRatio')) {
      result[key] = value[key];
    }
  }
  return Object.keys(result).length ? result : null;
}

function healthFailure(value) {
  if (!plainObject(value)) return null;
  const code = healthCode(value.code, 'unexpected_failure');
  const failureCodes = Array.isArray(value.failureCodes)
    ? [...new Set(value.failureCodes.map(item => healthCode(item)).filter(Boolean))].slice(0, 20)
    : [];
  return { code, failureCodes };
}

async function appendHealth(paths, event) {
  await mkdir(paths.health, { recursive: true });
  const safe = {
    version: 1,
    vendor: VENDOR,
    timestamp: event.timestamp,
    runId: event.runId,
    mode: event.mode,
    status: event.status,
    releaseId: event.releaseId || null,
    previousReleaseId: event.previousReleaseId || null,
    checkedAt: event.checkedAt || null,
    inputKind: event.inputKind || null,
    inputBytes: Number.isSafeInteger(event.inputBytes) ? event.inputBytes : null,
    candidate: healthNumbers(event.candidate, HEALTH_COUNT_KEYS),
    changeMetrics: healthNumbers(event.changeMetrics, HEALTH_METRIC_KEYS),
    failure: healthFailure(event.failure)
  };
  await appendFile(path.join(paths.health, `${VENDOR}-${healthMonth(event.timestamp)}.jsonl`), `${JSON.stringify(safe)}\n`, { encoding: 'utf8', mode: 0o600 });
}

async function loadRelease(paths, releaseId, pointer = null) {
  const safeReleaseId = assertReleaseId(releaseId);
  const directory = path.join(paths.releases, safeReleaseId);
  const manifestPath = path.join(directory, 'manifest.json');
  const indexPath = path.join(directory, 'tegiwa-stock-index.json');
  const manifestBuffer = await readFile(manifestPath);
  const indexBuffer = await readFile(indexPath);
  const manifestSha256 = createHash('sha256').update(manifestBuffer).digest('hex');
  const indexSha256 = createHash('sha256').update(indexBuffer).digest('hex');
  let manifest;
  let index;
  try {
    manifest = JSON.parse(manifestBuffer.toString('utf8'));
    index = JSON.parse(indexBuffer.toString('utf8'));
  } catch {
    throw new VendorSyncError('corrupt_release', 'A retained vendor release is not valid JSON.');
  }
  if (!plainObject(manifest) || manifest.version !== RELEASE_VERSION || manifest.vendor !== VENDOR
    || manifest.releaseId !== safeReleaseId || manifest.artifact?.sha256 !== indexSha256
    || manifest.artifact?.bytes !== indexBuffer.length
    || (pointer && (pointer.manifestSha256 !== manifestSha256 || pointer.indexSha256 !== indexSha256))) {
    throw new VendorSyncError('corrupt_release', 'A retained vendor release failed its checksum or manifest validation.');
  }
  return { releaseId: safeReleaseId, manifest, index, manifestSha256, indexSha256, indexBytes: indexBuffer.length };
}

async function loadCurrent(paths) {
  let pointer;
  try {
    pointer = await readJson(paths.current, { maximumBytes: 64 * 1024, label: 'Current release pointer' });
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  const currentHashesValid = /^[a-f0-9]{64}$/.test(String(pointer?.manifestSha256 || ''))
    && /^[a-f0-9]{64}$/.test(String(pointer?.indexSha256 || ''));
  const hasPrevious = pointer?.previousReleaseId !== null && pointer?.previousReleaseId !== undefined;
  const previousHashesValid = hasPrevious
    ? /^[a-f0-9]{64}$/.test(String(pointer?.previousManifestSha256 || ''))
      && /^[a-f0-9]{64}$/.test(String(pointer?.previousIndexSha256 || ''))
    : (pointer?.previousManifestSha256 === null && pointer?.previousIndexSha256 === null);
  if (!plainObject(pointer) || pointer.version !== POINTER_VERSION || pointer.vendor !== VENDOR
    || !RELEASE_ID_PATTERN.test(String(pointer.releaseId || ''))
    || !currentHashesValid || !previousHashesValid
    || (hasPrevious && (!RELEASE_ID_PATTERN.test(String(pointer.previousReleaseId))
      || pointer.previousReleaseId === pointer.releaseId))) {
    throw new VendorSyncError('corrupt_current_pointer', 'The current vendor release pointer is invalid.');
  }
  const release = await loadRelease(paths, pointer.releaseId, pointer);
  return { pointer, release };
}

async function archivePointer(paths, pointer, now) {
  if (!pointer) return;
  await mkdir(paths.history, { recursive: true });
  const filename = `${compactTimestamp(now)}-${pointer.releaseId}-${randomUUID().slice(0, 8)}.json`;
  await writeExclusiveJson(path.join(paths.history, filename), pointer);
}

async function promotePointer(paths, release, previousPointer, now) {
  const pointer = {
    version: POINTER_VERSION,
    vendor: VENDOR,
    releaseId: release.releaseId,
    previousReleaseId: previousPointer?.releaseId || null,
    previousManifestSha256: previousPointer?.manifestSha256 || null,
    previousIndexSha256: previousPointer?.indexSha256 || null,
    manifestSha256: release.manifestSha256,
    indexSha256: release.indexSha256,
    promotedAt: isoTimestamp(now)
  };
  await archivePointer(paths, previousPointer, now);
  await atomicWriteJson(paths.current, pointer);
  return pointer;
}

async function runBuilder({ repoRoot, inputPath, checkedAt, outputPath }) {
  const builder = path.join(repoRoot, 'scripts', 'build-tegiwa-stock-index.mjs');
  const metadata = await stat(builder);
  if (!metadata.isFile()) throw new VendorSyncError('builder_missing', 'The local Tegiwa stock-index builder is missing.');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [builder, inputPath, checkedAt, outputPath], {
      cwd: repoRoot,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let outputBytes = 0;
    let stoppedForOutput = false;
    const consume = chunk => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_BUILDER_OUTPUT_BYTES && !stoppedForOutput) {
        stoppedForOutput = true;
        child.kill();
      }
    };
    child.stdout.on('data', consume);
    child.stderr.on('data', consume);
    child.on('error', () => reject(new VendorSyncError('builder_failed', 'The local Tegiwa stock-index builder could not start.')));
    child.on('close', code => {
      if (stoppedForOutput) reject(new VendorSyncError('builder_output_limit', 'The local builder exceeded its bounded diagnostic-output limit.'));
      else if (code === 0) resolve();
      else reject(new VendorSyncError('builder_failed', 'The local Tegiwa stock-index builder rejected the staged input.'));
    });
  });
}

async function createRelease(paths, {
  releaseId, candidateBuffer, candidateSha256, source, summary, baselineReference, change, thresholds, now
}) {
  await mkdir(paths.releases, { recursive: true });
  const finalDirectory = path.join(paths.releases, releaseId);
  const temporaryDirectory = path.join(paths.releases, `.staging-${releaseId}-${randomUUID().slice(0, 8)}`);
  await mkdir(temporaryDirectory, { recursive: false });
  try {
    await writeExclusive(path.join(temporaryDirectory, 'tegiwa-stock-index.json'), candidateBuffer.toString('utf8'));
    const manifest = {
      version: RELEASE_VERSION,
      vendor: VENDOR,
      releaseId,
      createdAt: isoTimestamp(now),
      checkedAt: summary.checkedAt,
      source: {
        kind: source.kind,
        bytes: source.bytes,
        sha256: source.sha256,
        privateArchiveVerified: source.privateArchiveVerified === true
      },
      artifact: {
        name: 'tegiwa-stock-index.json',
        bytes: candidateBuffer.length,
        sha256: candidateSha256
      },
      counts: summary,
      baseline: baselineReference,
      gates: { thresholds, metrics: change?.metrics || null }
    };
    await writeExclusiveJson(path.join(temporaryDirectory, 'manifest.json'), manifest);
    await rename(temporaryDirectory, finalDirectory);
    return loadRelease(paths, releaseId);
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    if (error?.code === 'EEXIST') throw new VendorSyncError('release_exists', 'The immutable release identifier already exists.');
    throw error;
  }
}

async function cleanStage(paths, stagePath) {
  const relative = path.relative(paths.staging, stagePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new VendorSyncError('unsafe_stage_path', 'The temporary staging path failed its safety check.');
  }
  await rm(stagePath, { recursive: true, force: true });
}

export async function runTegiwaSync({
  workspace,
  repoRoot,
  inputPath,
  inputKind,
  privateArchivePath = null,
  checkedAt = null,
  baselinePath = null,
  thresholdOverrides = {},
  dryRun = false,
  allowInitial = false,
  now = Date.now(),
  fetchImpl = globalThis.fetch,
  buildStockIndex = runBuilder,
  diskSpaceProvider = statfs
}) {
  if (!workspace || !repoRoot || !['stock-csv', 'public-index', 'approved-download'].includes(inputKind)
    || (inputKind !== 'approved-download' && !inputPath) || typeof buildStockIndex !== 'function') {
    throw new VendorSyncError('invalid_arguments', 'Workspace, repository, input and input kind are required.');
  }
  const thresholds = mergeThresholds(thresholdOverrides);
  const paths = workspacePaths(workspace);
  const resolvedPrivateArchive = inputKind === 'approved-download'
    ? await validatePrivateArchiveDirectory(privateArchivePath, { workspace: paths.root, repoRoot })
    : null;
  const startedAt = isoTimestamp(now);
  const provisionalRunId = `${compactTimestamp(now)}-${randomUUID().replaceAll('-', '').slice(0, 8)}`;
  const releaseLock = await acquireRunLock(paths.root, { runId: provisionalRunId, now });
  let stagePath = null;
  let primaryError = null;
  let healthContext = {
    timestamp: startedAt,
    runId: provisionalRunId,
    mode: dryRun ? 'dry-run' : 'promote',
    status: 'failed',
    inputKind
  };
  try {
    await mkdir(paths.staging, { recursive: true });
    stagePath = path.join(paths.staging, provisionalRunId);
    await mkdir(stagePath, { recursive: false });
    const stagedInput = path.join(stagePath, inputKind === 'public-index' ? 'source-index.json' : 'source.csv');
    let sourceMetadata;
    if (inputKind === 'approved-download') {
      sourceMetadata = await downloadTegiwaStockfeed({
        destination: stagedInput,
        maximumBytes: thresholds.maxInputBytes,
        fetchImpl
      });
    } else {
      sourceMetadata = await sha256File(path.resolve(inputPath), thresholds.maxInputBytes);
      await copyFile(path.resolve(inputPath), stagedInput, fs.constants.COPYFILE_EXCL);
      const stagedMetadata = await sha256File(stagedInput, thresholds.maxInputBytes);
      if (stagedMetadata.sha256 !== sourceMetadata.sha256 || stagedMetadata.bytes !== sourceMetadata.bytes) {
        throw new VendorSyncError('staged_input_changed', 'The staged input changed during the local copy.');
      }
    }
    healthContext.inputBytes = sourceMetadata.bytes;

    const candidatePath = path.join(stagePath, 'candidate-tegiwa-stock-index.json');
    if (inputKind === 'stock-csv' || inputKind === 'approved-download') {
      const safeCheckedAt = checkedAtDate(checkedAt || new Date(now).toISOString().slice(0, 10), {
        now,
        maxAgeDays: thresholds.maxAgeDays,
        maxFutureDays: thresholds.maxFutureDays
      });
      await buildStockIndex({ repoRoot: path.resolve(repoRoot), inputPath: stagedInput, checkedAt: safeCheckedAt, outputPath: candidatePath });
    } else {
      await copyFile(stagedInput, candidatePath, fs.constants.COPYFILE_EXCL);
    }

    const candidateMetadata = await sha256File(candidatePath, thresholds.maxInputBytes);
    const candidate = await readJson(candidatePath, { maximumBytes: thresholds.maxInputBytes, label: 'Candidate Tegiwa stock index' });
    const summary = validateTegiwaIndex(candidate, {
      now,
      thresholds,
      freshness: true,
      expectedCheckedAt: checkedAt || null
    });
    healthContext.checkedAt = summary.checkedAt;
    healthContext.candidate = summary;

    const current = await loadCurrent(paths);
    if (current && candidateMetadata.sha256 === current.release.indexSha256) {
      healthContext.releaseId = current.pointer.releaseId;
      healthContext.previousReleaseId = current.pointer.previousReleaseId || null;
      healthContext.status = 'no_change';
      await appendHealth(paths, healthContext);
      return {
        dryRun,
        noChange: true,
        releaseId: current.pointer.releaseId,
        previousReleaseId: current.pointer.previousReleaseId || null,
        summary,
        change: { passed: true, metrics: null, failures: [] }
      };
    }
    let baseline = null;
    let baselineReference = null;
    if (current) {
      baseline = current.release.index;
      baselineReference = { kind: 'release', releaseId: current.release.releaseId };
    } else if (baselinePath) {
      baseline = await readJson(path.resolve(baselinePath), { maximumBytes: thresholds.maxInputBytes, label: 'Baseline Tegiwa stock index' });
      baselineReference = { kind: 'external-baseline', releaseId: null };
    } else if (!allowInitial) {
      throw new VendorSyncError('baseline_required', 'An initial promotion requires a validated baseline or explicit allow-initial approval.');
    }
    if (baseline) validateTegiwaIndex(baseline, { now, thresholds, freshness: false });
    const change = baseline ? evaluateAbnormalChange(candidate, baseline, thresholds) : null;
    healthContext.changeMetrics = change?.metrics || null;
    if (change && !change.passed) {
      throw new VendorSyncError('abnormal_change_blocked', 'The candidate exceeded one or more abnormal-change safety thresholds.', {
        failureCodes: change.failures.map(failure => failure.code)
      });
    }

    const releaseId = releaseIdFor(now, candidateMetadata.sha256);
    healthContext.releaseId = releaseId;
    healthContext.previousReleaseId = current?.pointer.releaseId || null;
    if (dryRun) {
      healthContext.status = 'dry_run_passed';
      await appendHealth(paths, healthContext);
      return {
        dryRun: true,
        noChange: false,
        releaseId,
        previousReleaseId: healthContext.previousReleaseId,
        summary,
        change: change || { passed: true, metrics: null, failures: [] }
      };
    }

    await validatePromotionCapacity({
      paths,
      privateArchiveDirectory: resolvedPrivateArchive,
      sourceBytes: sourceMetadata.bytes,
      candidateBytes: candidateMetadata.bytes,
      thresholds,
      diskSpaceProvider
    });

    const candidateBuffer = await readFile(candidatePath);
    if (createHash('sha256').update(candidateBuffer).digest('hex') !== candidateMetadata.sha256) {
      throw new VendorSyncError('candidate_changed', 'The candidate changed after validation.');
    }
    if (inputKind === 'approved-download') {
      await archiveApprovedDownload({
        sourcePath: stagedInput,
        archiveDirectory: resolvedPrivateArchive,
        expectedBytes: sourceMetadata.bytes,
        expectedSha256: sourceMetadata.sha256,
        now,
        maximumBytes: thresholds.maxInputBytes
      });
    }
    const release = await createRelease(paths, {
      releaseId,
      candidateBuffer,
      candidateSha256: candidateMetadata.sha256,
      source: {
        kind: inputKind,
        ...sourceMetadata,
        privateArchiveVerified: inputKind === 'approved-download'
      },
      summary,
      baselineReference,
      change,
      thresholds,
      now
    });
    const pointer = await promotePointer(paths, release, current?.pointer || null, now);
    healthContext.status = 'promoted';
    await appendHealth(paths, healthContext);
    return {
      dryRun: false,
      noChange: false,
      releaseId,
      previousReleaseId: pointer.previousReleaseId,
      summary,
      change: change || { passed: true, metrics: null, failures: [] }
    };
  } catch (error) {
    primaryError = error;
    const failure = safeFailure(error);
    healthContext.failure = {
      ...failure,
      failureCodes: error instanceof VendorSyncError && Array.isArray(error.details?.failureCodes)
        ? error.details.failureCodes.slice(0, 20) : []
    };
    try { await appendHealth(paths, healthContext); } catch { /* Health logging must not replace the original failure. */ }
    throw error;
  } finally {
    let finalizationError = null;
    try {
      if (stagePath) await cleanStage(paths, stagePath);
    } catch (error) {
      finalizationError = error;
    }
    try {
      await releaseLock();
    } catch (error) {
      if (!finalizationError) finalizationError = error;
    }
    if (finalizationError && !primaryError) throw finalizationError;
  }
}

export async function rollbackTegiwaRelease({
  workspace,
  releaseId = null,
  previous = false,
  dryRun = false,
  now = Date.now()
}) {
  const paths = workspacePaths(workspace);
  const runId = `${compactTimestamp(now)}-${randomUUID().replaceAll('-', '').slice(0, 8)}`;
  const releaseLock = await acquireRunLock(paths.root, { runId, now });
  try {
    const current = await loadCurrent(paths);
    if (!current) throw new VendorSyncError('current_release_missing', 'There is no current release to roll back.');
    const targetId = previous ? current.pointer.previousReleaseId : releaseId;
    if (!targetId) throw new VendorSyncError('rollback_target_missing', 'No retained rollback target was selected.');
    const targetTrust = previous ? {
      manifestSha256: current.pointer.previousManifestSha256,
      indexSha256: current.pointer.previousIndexSha256
    } : null;
    if (previous && (!/^[a-f0-9]{64}$/.test(String(targetTrust.manifestSha256 || ''))
      || !/^[a-f0-9]{64}$/.test(String(targetTrust.indexSha256 || '')))) {
      throw new VendorSyncError('rollback_target_untrusted', 'The previous release does not have retained trusted checksums.');
    }
    const target = await loadRelease(paths, targetId, targetTrust);
    validateTegiwaIndex(target.index, { now, thresholds: DEFAULT_THRESHOLDS, freshness: false });
    const event = {
      timestamp: isoTimestamp(now),
      runId,
      mode: dryRun ? 'rollback-dry-run' : 'rollback',
      status: dryRun ? 'dry_run_passed' : 'rolled_back',
      releaseId: target.releaseId,
      previousReleaseId: current.pointer.releaseId,
      checkedAt: target.manifest.checkedAt,
      candidate: target.manifest.counts
    };
    if (!dryRun) await promotePointer(paths, target, current.pointer, now);
    await appendHealth(paths, event);
    return { dryRun, releaseId: target.releaseId, previousReleaseId: current.pointer.releaseId };
  } catch (error) {
    try {
      await appendHealth(paths, {
        timestamp: isoTimestamp(now), runId, mode: dryRun ? 'rollback-dry-run' : 'rollback',
        status: 'failed', failure: safeFailure(error)
      });
    } catch { /* Preserve the rollback error. */ }
    throw error;
  } finally {
    await releaseLock();
  }
}
