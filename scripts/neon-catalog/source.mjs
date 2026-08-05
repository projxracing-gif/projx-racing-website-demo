import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { tegiwaSkuMappingFingerprint } from '../../api/tegiwa-sku-mapping.js';
import {
  checkedAtIsoDate,
  decodeStockRecord,
  expectedCountsFromAccumulator,
  normalizeCatalogProduct,
  stockKeyBytesForTitle
} from './lib.mjs';

const MAX_PRODUCTS = 10_000_000;
const MAX_SHARDS = 512;
const SEARCH_METADATA_RECORD_BYTES = 16;
const IMPORT_FORMAT_VERSION = 1;
const REQUIRED_SEARCH_FILES = new Set([
  'tegiwa-search-terms.json',
  'tegiwa-search-term-postings.bin',
  'tegiwa-search-pairs.bin',
  'tegiwa-search-pair-postings.bin',
  'tegiwa-search-metadata.bin'
]);

function readFile(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`Required catalogue artifact is missing: ${path.basename(file)}`);
  return fs.readFileSync(file);
}

function parseJson(buffer, label) {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

export function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function assertBufferSha256(buffer, expected, label = 'Catalogue artifact') {
  const actual = sha256Buffer(buffer);
  if (!/^[a-f0-9]{64}$/.test(String(expected || '')) || actual !== expected) {
    throw new Error(`${label} changed after validation.`);
  }
  return true;
}

function snapshotAccumulator(accumulator) {
  return {
    products: accumulator.products,
    images: accumulator.images,
    skuIdentifiers: accumulator.skuIdentifiers,
    skuIndexedProducts: accumulator.skuIndexedProducts,
    pricedOffers: accumulator.pricedOffers,
    availableOffers: accumulator.availableOffers,
    productsWithStock: accumulator.productsWithStock,
    productsWithoutStock: accumulator.productsWithoutStock,
    priceRangeProducts: accumulator.priceRangeProducts,
    brands: [...accumulator.brands]
  };
}

function accumulatorFromSnapshot(snapshot) {
  return { ...snapshot, brands: new Set(snapshot.brands) };
}

function accumulateProduct(accumulator, product) {
  accumulator.products += 1;
  accumulator.images += product.image_url ? 1 : 0;
  accumulator.skuIdentifiers += product.skus.length;
  accumulator.skuIndexedProducts += product.skus.length ? 1 : 0;
  accumulator.pricedOffers += product.price_minor === null ? 0 : 1;
  accumulator.availableOffers += product.is_available ? 1 : 0;
  accumulator.productsWithStock += product.has_stock_record ? 1 : 0;
  accumulator.productsWithoutStock += product.has_stock_record ? 0 : 1;
  accumulator.priceRangeProducts += product.price_is_range ? 1 : 0;
  accumulator.brands.add(product.brand_slug);
}

function validIsoTimestamp(value) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function validateCatalogSummary(summary) {
  if (!summary || summary.version !== 1
    || !validIsoTimestamp(summary.generatedAt)
    || !Number.isInteger(summary.productCount) || summary.productCount < 1 || summary.productCount > MAX_PRODUCTS
    || !Number.isInteger(summary.imageCount) || summary.imageCount < 0 || summary.imageCount > summary.productCount
    || summary.uniqueHandleCount !== summary.productCount
    || !Number.isInteger(summary.shardCount) || summary.shardCount < 1 || summary.shardCount > MAX_SHARDS
    || !Array.isArray(summary.shardProductCounts) || summary.shardProductCounts.length !== summary.shardCount
    || summary.shardProductCounts.some(count => !Number.isInteger(count) || count < 1 || count > 50_000)
    || summary.shardProductCounts.reduce((total, count) => total + count, 0) !== summary.productCount
    || summary.source !== 'https://www.tegiwa.com/sitemap.xml') {
    throw new Error('The Tegiwa catalog summary is invalid or unsupported.');
  }
}

function validateStockIndex(stockIndex) {
  if (!stockIndex || stockIndex.version !== 2 || stockIndex.priceBasis !== 'gbp_ex_uk_vat'
    || !Number.isInteger(stockIndex.productCount) || stockIndex.productCount < 1
    || !Number.isInteger(stockIndex.skuProductCount) || stockIndex.skuProductCount < 0
    || !Number.isInteger(stockIndex.availableProductCount) || stockIndex.availableProductCount < 0
    || !Array.isArray(stockIndex.leadTimes) || stockIndex.leadTimes[0] !== ''
    || !stockIndex.products || typeof stockIndex.products !== 'object' || Array.isArray(stockIndex.products)) {
    throw new Error('The Tegiwa stock index is invalid or is not the GBP UK-VAT-excluded snapshot.');
  }
  checkedAtIsoDate(stockIndex.checkedAt);
}

function validateSearchSummary(searchSummary, catalogSummary, stockBuffer) {
  if (!searchSummary || searchSummary.version !== 2
    || searchSummary.generatedAt !== catalogSummary.generatedAt
    || searchSummary.productCount !== catalogSummary.productCount
    || searchSummary.skuIndexedProductCount < 0
    || searchSummary.metadataRecordBytes !== SEARCH_METADATA_RECORD_BYTES
    || searchSummary.skuMappingSha256 !== tegiwaSkuMappingFingerprint(stockBuffer)
    || !searchSummary.files || typeof searchSummary.files !== 'object') {
    throw new Error('The Tegiwa search summary is stale or incompatible with the catalog and stock artifacts.');
  }
}

export function preflightTegiwaSource(repoDirectory) {
  const dataDirectory = path.join(repoDirectory, 'api', 'data');
  const catalogDirectory = path.join(dataDirectory, 'tegiwa-catalog-pages');
  const catalogSummaryBuffer = readFile(path.join(dataDirectory, 'tegiwa-catalog-summary.json'));
  const stockBuffer = readFile(path.join(dataDirectory, 'tegiwa-stock-index.json'));
  const searchSummaryBuffer = readFile(path.join(dataDirectory, 'tegiwa-search-summary.json'));
  const catalogSummary = parseJson(catalogSummaryBuffer, 'Tegiwa catalog summary');
  const stockIndex = parseJson(stockBuffer, 'Tegiwa stock index');
  const searchSummary = parseJson(searchSummaryBuffer, 'Tegiwa search summary');
  validateCatalogSummary(catalogSummary);
  validateStockIndex(stockIndex);
  validateSearchSummary(searchSummary, catalogSummary, stockBuffer);

  let stockPricedProducts = 0;
  let stockAvailableProducts = 0;
  let stockSkuProducts = 0;
  for (const [key, record] of Object.entries(stockIndex.products)) {
    if (!/^[A-Za-z0-9_-]{16}$/.test(key)) throw new Error('The Tegiwa stock index contains an invalid product key.');
    const decoded = decodeStockRecord(record, stockIndex);
    stockPricedProducts += decoded.priceMinor === null ? 0 : 1;
    stockAvailableProducts += ['in_stock', 'supplier_stock'].includes(decoded.availabilityCode) ? 1 : 0;
    stockSkuProducts += decoded.skuState === 1 ? 1 : 0;
  }
  if (stockPricedProducts !== stockIndex.productCount
    || stockAvailableProducts !== stockIndex.availableProductCount
    || stockSkuProducts !== stockIndex.skuProductCount) {
    throw new Error('The Tegiwa stock-index totals do not match its product rows.');
  }

  const sourceHash = createHash('sha256');
  sourceHash.update(`projx-neon-tegiwa-import-v${IMPORT_FORMAT_VERSION}`).update('\0');
  for (const [label, buffer] of [
    ['catalog-summary', catalogSummaryBuffer],
    ['stock-index', stockBuffer],
    ['search-summary', searchSummaryBuffer]
  ]) sourceHash.update(label).update('\0').update(buffer).update('\0');

  let metadataBuffer;
  const foundSearchFiles = new Set();
  for (const descriptor of Object.values(searchSummary.files)) {
    const name = String(descriptor?.name || '');
    if (!REQUIRED_SEARCH_FILES.has(name) || foundSearchFiles.has(name)) throw new Error('The Tegiwa search summary contains an unexpected or duplicate file.');
    foundSearchFiles.add(name);
    const buffer = readFile(path.join(dataDirectory, name));
    if (buffer.length !== descriptor.bytes || sha256Buffer(buffer) !== descriptor.sha256) {
      throw new Error(`The Tegiwa search artifact ${name} does not match its checksum.`);
    }
    sourceHash.update(name).update('\0').update(buffer).update('\0');
    if (name === 'tegiwa-search-metadata.bin') metadataBuffer = buffer;
  }
  if (foundSearchFiles.size !== REQUIRED_SEARCH_FILES.size
    || [...REQUIRED_SEARCH_FILES].some(name => !foundSearchFiles.has(name))) {
    throw new Error('The Tegiwa search artifact set is incomplete.');
  }
  if (!metadataBuffer || metadataBuffer.length !== catalogSummary.productCount * SEARCH_METADATA_RECORD_BYTES) {
    throw new Error('The Tegiwa search metadata length does not match the catalog count.');
  }

  const rankSeen = new Uint8Array(catalogSummary.productCount);
  const handles = new Set();
  const shardHashes = [];
  const prefixStates = [];
  const accumulator = {
    products: 0,
    images: 0,
    skuIdentifiers: 0,
    skuIndexedProducts: 0,
    pricedOffers: 0,
    availableOffers: 0,
    productsWithStock: 0,
    productsWithoutStock: 0,
    priceRangeProducts: 0,
    brands: new Set()
  };
  prefixStates.push(snapshotAccumulator(accumulator));
  const stockCheckedAt = checkedAtIsoDate(stockIndex.checkedAt);
  let documentId = 0;

  for (let shardIndex = 0; shardIndex < catalogSummary.shardCount; shardIndex += 1) {
    const filename = `${String(shardIndex).padStart(3, '0')}.json`;
    const shardBuffer = readFile(path.join(catalogDirectory, filename));
    shardHashes.push(sha256Buffer(shardBuffer));
    sourceHash.update(filename).update('\0').update(shardBuffer).update('\0');
    const records = parseJson(shardBuffer, `Tegiwa catalog shard ${filename}`);
    if (!Array.isArray(records) || records.length !== catalogSummary.shardProductCounts[shardIndex]) {
      throw new Error(`Tegiwa catalog shard ${filename} does not match its summary count.`);
    }

    for (const record of records) {
      const rank = metadataBuffer.readUInt32LE(documentId * SEARCH_METADATA_RECORD_BYTES);
      if (rank >= catalogSummary.productCount || rankSeen[rank]) throw new Error('The Tegiwa search metadata contains duplicate or invalid browse ranks.');
      rankSeen[rank] = 1;
      const expectedStockBytes = stockKeyBytesForTitle(record?.[1]);
      const storedStockBytes = metadataBuffer.subarray(
        documentId * SEARCH_METADATA_RECORD_BYTES + 4,
        documentId * SEARCH_METADATA_RECORD_BYTES + SEARCH_METADATA_RECORD_BYTES
      );
      if (!expectedStockBytes.equals(storedStockBytes)) throw new Error('The Tegiwa search metadata stock join is stale.');

      const product = normalizeCatalogProduct({
        record,
        stockIndex,
        browseRank: rank,
        catalogGeneratedAt: catalogSummary.generatedAt,
        stockCheckedAt
      });
      if (handles.has(product.source_handle)) throw new Error(`Duplicate Tegiwa handle: ${product.source_handle}`);
      handles.add(product.source_handle);
      accumulateProduct(accumulator, product);
      documentId += 1;
    }
    prefixStates.push(snapshotAccumulator(accumulator));
  }

  if (documentId !== catalogSummary.productCount || handles.size !== catalogSummary.uniqueHandleCount) {
    throw new Error('The Tegiwa catalog changed during source validation.');
  }
  if (accumulator.images !== catalogSummary.imageCount) throw new Error('The Tegiwa catalog image count does not match its summary.');
  if (accumulator.skuIndexedProducts !== searchSummary.skuIndexedProductCount) {
    throw new Error('The Tegiwa searchable SKU coverage is inconsistent with the public stock index.');
  }
  if (rankSeen.some(value => value !== 1)) throw new Error('The Tegiwa search metadata browse ranks are incomplete.');

  const expected = expectedCountsFromAccumulator(accumulator);
  const fingerprint = sourceHash.digest('hex');
  const loadShard = shardIndex => {
    if (!Number.isInteger(shardIndex) || shardIndex < 0 || shardIndex >= catalogSummary.shardCount) throw new Error('Invalid Tegiwa shard index.');
    const filename = `${String(shardIndex).padStart(3, '0')}.json`;
    const shardBuffer = readFile(path.join(catalogDirectory, filename));
    assertBufferSha256(shardBuffer, shardHashes[shardIndex], `Tegiwa catalog shard ${filename}`);
    const records = parseJson(shardBuffer, `Tegiwa catalog shard ${filename}`);
    if (!Array.isArray(records) || records.length !== catalogSummary.shardProductCounts[shardIndex]) {
      throw new Error(`Tegiwa catalog shard ${filename} changed after preflight.`);
    }
    const documentOffset = catalogSummary.shardProductCounts
      .slice(0, shardIndex)
      .reduce((total, count) => total + count, 0);
    return records.map((record, index) => normalizeCatalogProduct({
      record,
      stockIndex,
      browseRank: metadataBuffer.readUInt32LE((documentOffset + index) * SEARCH_METADATA_RECORD_BYTES),
      catalogGeneratedAt: catalogSummary.generatedAt,
      stockCheckedAt
    }));
  };
  const expectedAt = (shardIndex, offset) => {
    if (!Number.isInteger(shardIndex) || shardIndex < 0 || shardIndex > catalogSummary.shardCount) {
      throw new Error('Invalid checkpoint shard for expected-count calculation.');
    }
    if (!Number.isInteger(offset) || offset < 0
      || (shardIndex === catalogSummary.shardCount ? offset !== 0 : offset > catalogSummary.shardProductCounts[shardIndex])) {
      throw new Error('Invalid checkpoint offset for expected-count calculation.');
    }
    const partial = accumulatorFromSnapshot(prefixStates[shardIndex]);
    if (offset) {
      const products = loadShard(shardIndex);
      for (let index = 0; index < offset; index += 1) accumulateProduct(partial, products[index]);
    }
    return expectedCountsFromAccumulator(partial);
  };

  return Object.freeze({
    fingerprint,
    importFormatVersion: IMPORT_FORMAT_VERSION,
    catalogSummary,
    stockSummary: {
      checkedAt: stockIndex.checkedAt,
      productCount: stockIndex.productCount,
      skuProductCount: stockIndex.skuProductCount,
      availableProductCount: stockIndex.availableProductCount,
      priceBasis: stockIndex.priceBasis
    },
    searchSummary: {
      productCount: searchSummary.productCount,
      skuIndexedProductCount: searchSummary.skuIndexedProductCount,
      generatedAt: searchSummary.generatedAt
    },
    expected,
    audit: {
      productsWithStock: accumulator.productsWithStock,
      productsWithoutStock: accumulator.productsWithoutStock,
      priceRangeProducts: accumulator.priceRangeProducts,
      skuIndexedProducts: accumulator.skuIndexedProducts,
      supplierAvailableCount: stockIndex.availableProductCount,
      joinedAvailableCount: accumulator.availableOffers,
      mpnIdentifiers: 0,
      brandSource: 'title_prefix_heuristic',
      vehicleFitmentSource: 'title_text_possible_only'
    },
    loadShard,
    expectedAt
  });
}
