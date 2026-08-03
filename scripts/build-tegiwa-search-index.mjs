import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDirectory = path.join(repo, 'api', 'data');
const catalogDirectory = path.join(dataDirectory, 'tegiwa-catalog-pages');
const catalogSummaryPath = path.join(dataDirectory, 'tegiwa-catalog-summary.json');
const outputFiles = Object.freeze({
  summary: path.join(dataDirectory, 'tegiwa-search-summary.json'),
  terms: path.join(dataDirectory, 'tegiwa-search-terms.json'),
  termPostings: path.join(dataDirectory, 'tegiwa-search-term-postings.bin'),
  pairs: path.join(dataDirectory, 'tegiwa-search-pairs.bin'),
  pairPostings: path.join(dataDirectory, 'tegiwa-search-pair-postings.bin'),
  metadata: path.join(dataDirectory, 'tegiwa-search-metadata.bin')
});

const maximumProducts = 10_000_000;
const maximumShards = 512;
const metadataRecordBytes = 16;
const pairRecordBytes = 16;
const stockKeyBytes = 12;

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

function stockKeyBytesForTitle(title) {
  const normalized = String(title || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-US');
  return createHash('sha256').update(normalized, 'utf8').digest().subarray(0, stockKeyBytes);
}

function fnv1a64(value) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of Buffer.from(value, 'utf8')) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash;
}

function validHandle(value) {
  return typeof value === 'string'
    && value.length <= 255
    && /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(value);
}

function readCatalog() {
  const summary = JSON.parse(fs.readFileSync(catalogSummaryPath, 'utf8'));
  if (!summary || summary.version !== 1 || !Number.isInteger(summary.productCount)
    || summary.productCount < 1 || summary.productCount > maximumProducts
    || !Number.isInteger(summary.shardCount) || summary.shardCount < 1 || summary.shardCount > maximumShards
    || !Array.isArray(summary.shardProductCounts) || summary.shardProductCounts.length !== summary.shardCount
    || summary.shardProductCounts.reduce((total, count) => total + count, 0) !== summary.productCount) {
    throw new Error('The Tegiwa catalog summary is invalid.');
  }

  const products = [];
  for (let shardIndex = 0; shardIndex < summary.shardCount; shardIndex += 1) {
    const filename = `${String(shardIndex).padStart(3, '0')}.json`;
    const records = JSON.parse(fs.readFileSync(path.join(catalogDirectory, filename), 'utf8'));
    if (!Array.isArray(records) || records.length !== summary.shardProductCounts[shardIndex]) {
      throw new Error(`Catalog shard ${filename} does not match its summary count.`);
    }
    for (const record of records) {
      if (!Array.isArray(record) || record.length !== 3 || !validHandle(record[0])
        || typeof record[1] !== 'string' || !record[1].trim()) {
        throw new Error(`Catalog shard ${filename} contains an invalid public product record.`);
      }
      products.push({ handle: record[0], title: record[1] });
    }
  }
  if (products.length !== summary.productCount) throw new Error('The catalog product count changed during search-index generation.');
  return { summary, products };
}

function addPosting(map, key, documentId) {
  const existing = map.get(key);
  if (existing) existing.push(documentId);
  else map.set(key, [documentId]);
}

function buildIndexes(products) {
  const terms = new Map();
  const pairs = new Map();
  const pairHashOwners = new Map();
  const names = [];
  const metadata = Buffer.alloc(products.length * metadataRecordBytes);

  for (let documentId = 0; documentId < products.length; documentId += 1) {
    const product = products[documentId];
    const titleTokens = searchTokens(product.title);
    const combinedTokens = searchTokens(`${product.title} ${product.handle.replace(/[-_]+/g, ' ')}`);
    for (const token of new Set(combinedTokens)) addPosting(terms, token, documentId);

    const seenPairs = new Set();
    for (let index = 0; index + 1 < titleTokens.length; index += 1) {
      const phrase = `${titleTokens[index]}\u0001${titleTokens[index + 1]}`;
      if (seenPairs.has(phrase)) continue;
      seenPairs.add(phrase);
      const hash = fnv1a64(phrase);
      const owner = pairHashOwners.get(hash);
      if (owner && owner !== phrase) throw new Error(`Phrase-hash collision between "${owner}" and "${phrase}".`);
      pairHashOwners.set(hash, phrase);
      addPosting(pairs, hash, documentId);
    }

    names.push({ documentId, key: `${normalizeSearchText(product.title)}\u0000${product.handle}` });
    metadata.set(stockKeyBytesForTitle(product.title), documentId * metadataRecordBytes + 4);
  }

  names.sort((left, right) => left.key < right.key ? -1 : (left.key > right.key ? 1 : left.documentId - right.documentId));
  names.forEach((entry, nameRank) => metadata.writeUInt32LE(nameRank, entry.documentId * metadataRecordBytes));
  return { terms, pairs, metadata };
}

function postingsBuffer(entries) {
  const postingCount = entries.reduce((total, [, documentIds]) => total + documentIds.length, 0);
  const buffer = Buffer.alloc(postingCount * 4);
  let postingOffset = 0;
  for (const [, documentIds] of entries) {
    for (const documentId of documentIds) {
      buffer.writeUInt32LE(documentId, postingOffset * 4);
      postingOffset += 1;
    }
  }
  return { buffer, postingCount };
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

const { summary: catalogSummary, products } = readCatalog();
const { terms, pairs, metadata } = buildIndexes(products);
const termEntries = [...terms.entries()].sort(([left], [right]) => left < right ? -1 : (left > right ? 1 : 0));
const pairEntries = [...pairs.entries()].sort(([left], [right]) => left < right ? -1 : (left > right ? 1 : 0));

const { buffer: termPostings, postingCount: termPostingCount } = postingsBuffer(termEntries);
const termDictionary = [];
let termOffset = 0;
for (const [term, documentIds] of termEntries) {
  termDictionary.push([term, termOffset, documentIds.length]);
  termOffset += documentIds.length;
}
const termDictionaryBuffer = Buffer.from(`${JSON.stringify({ version: 1, terms: termDictionary })}\n`, 'utf8');

const { buffer: pairPostings, postingCount: pairPostingCount } = postingsBuffer(pairEntries);
const pairDictionary = Buffer.alloc(pairEntries.length * pairRecordBytes);
let pairOffset = 0;
pairEntries.forEach(([hash, documentIds], index) => {
  const offset = index * pairRecordBytes;
  pairDictionary.writeBigUInt64LE(hash, offset);
  pairDictionary.writeUInt32LE(pairOffset, offset + 8);
  pairDictionary.writeUInt32LE(documentIds.length, offset + 12);
  pairOffset += documentIds.length;
});

const generatedAt = catalogSummary.generatedAt;
if (!generatedAt || Number.isNaN(Date.parse(generatedAt))) throw new Error('The catalog summary does not contain a valid generation timestamp.');
const searchSummary = {
  version: 1,
  generatedAt,
  productCount: products.length,
  pageSize: 100,
  termCount: termEntries.length,
  termPostingCount,
  pairCount: pairEntries.length,
  pairPostingCount,
  metadataRecordBytes,
  pairRecordBytes,
  files: {
    terms: { name: path.basename(outputFiles.terms), bytes: termDictionaryBuffer.length, sha256: sha256(termDictionaryBuffer) },
    termPostings: { name: path.basename(outputFiles.termPostings), bytes: termPostings.length, sha256: sha256(termPostings) },
    pairs: { name: path.basename(outputFiles.pairs), bytes: pairDictionary.length, sha256: sha256(pairDictionary) },
    pairPostings: { name: path.basename(outputFiles.pairPostings), bytes: pairPostings.length, sha256: sha256(pairPostings) },
    metadata: { name: path.basename(outputFiles.metadata), bytes: metadata.length, sha256: sha256(metadata) }
  }
};
const summaryBuffer = Buffer.from(`${JSON.stringify(searchSummary)}\n`, 'utf8');

for (const [filename, buffer] of [
  [outputFiles.terms, termDictionaryBuffer],
  [outputFiles.termPostings, termPostings],
  [outputFiles.pairs, pairDictionary],
  [outputFiles.pairPostings, pairPostings],
  [outputFiles.metadata, metadata],
  [outputFiles.summary, summaryBuffer]
]) fs.writeFileSync(filename, buffer);

console.log(`Generated local Tegiwa search index for ${products.length.toLocaleString('en-US')} products.`);
console.log(`Terms: ${termEntries.length.toLocaleString('en-US')} unique / ${termPostingCount.toLocaleString('en-US')} postings.`);
console.log(`Phrases: ${pairEntries.length.toLocaleString('en-US')} unique adjacent pairs / ${pairPostingCount.toLocaleString('en-US')} postings.`);
console.log(`Index bytes: ${(termDictionaryBuffer.length + termPostings.length + pairDictionary.length + pairPostings.length + metadata.length + summaryBuffer.length).toLocaleString('en-US')}.`);
