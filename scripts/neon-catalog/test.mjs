import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { BATCH_SQL, parseArguments, PUBLISH_LOCK_SQL, PUBLISH_SQL } from './import-tegiwa.mjs';
import {
  chunkByJsonBytes,
  decodeStockRecord,
  deterministicImportUuid,
  inferBrand,
  normalizeCatalogProduct,
  normalizeIdentifier,
  normalizeSearchText,
  publicationCandidateAllowed,
  resumeRequiresFullReplay,
  stockKeyForTitle,
  validateImportCounts
} from './lib.mjs';
import { createNeonHttpClient, neonSqlEndpoint } from './neon-http.mjs';
import { assertBufferSha256, sha256Buffer } from './source.mjs';

test('normalization preserves source GBP pence and never reapplies VAT', () => {
  const stockIndex = {
    leadTimes: ['', '2-3 working days'],
    products: {}
  };
  const title = 'Powerflex  Front Arm Bush  BMW';
  const key = stockKeyForTitle(title);
  stockIndex.products[key] = [11_250, 13_500, 2, 1, [' PFF5-401 ', 'pff5-401', 'PFF5-402'], 1];
  const product = normalizeCatalogProduct({
    record: ['powerflex-front-arm-bush-bmw', title, 'https://cdn.shopify.com/files/example.webp?v=1'],
    stockIndex,
    browseRank: 12,
    catalogGeneratedAt: '2026-08-03T19:50:52.100Z',
    stockCheckedAt: '2026-08-03T00:00:00.000Z'
  });
  assert.equal(product.currency, 'GBP');
  assert.equal(product.price_minor, 11_250);
  assert.equal(product.maximum_price_minor, 13_500);
  assert.equal(product.availability_code, 'supplier_stock');
  assert.equal(product.lead_time, '2-3 working days');
  assert.deepEqual(product.skus, ['PFF5-401', 'PFF5-402']);
  assert.equal(product.brand_name, 'Powerflex');
  assert.equal(product.price_is_range, true);
  assert.equal(product.vehicle_text, product.search_text);
  assert.ok(product.search_text.includes('pff5 401'));
});

test('missing stock creates a GBP request-price offer without invented SKU or MPN', () => {
  const product = normalizeCatalogProduct({
    record: ['example-part', 'Example Part', ''],
    stockIndex: { leadTimes: [''], products: {} },
    browseRank: 0,
    catalogGeneratedAt: '2026-08-03T19:50:52.100Z',
    stockCheckedAt: '2026-08-03T00:00:00.000Z'
  });
  assert.equal(product.price_minor, null);
  assert.equal(product.availability_code, 'unknown');
  assert.deepEqual(product.skus, []);
  assert.deepEqual(product.mpns, []);
  assert.equal(product.has_stock_record, false);
});

test('stock row validation rejects reversed prices and invalid lead indexes', () => {
  assert.throws(() => decodeStockRecord([200, 100, 1, 0, [], 0], { leadTimes: [''] }), /invalid GBP price range/);
  assert.throws(() => decodeStockRecord([100, 100, 1, 4, [], 0], { leadTimes: [''] }), /lead-time index/);
});

test('search, identifier and brand normalization are deterministic', () => {
  assert.equal(normalizeSearchText('H&R  TÜV--Spring'), 'h r tuv spring');
  assert.equal(normalizeIdentifier('  SKU  123  '), 'sku 123');
  assert.deepEqual(inferBrand('BC Racing BR Series Coilovers'), { slug: 'bc-racing', name: 'BC Racing' });
  assert.deepEqual(inferBrand('Exedy Hyper Clutch'), { slug: 'exedy', name: 'Exedy' });
  const expectedKey = createHash('sha256').update('example title').digest('base64url').slice(0, 16);
  assert.equal(stockKeyForTitle(' Example   Title '), expectedKey);
});

test('deterministic import UUID is stable and RFC-shaped', () => {
  const fingerprint = 'a'.repeat(64);
  const first = deterministicImportUuid(fingerprint);
  const second = deterministicImportUuid(fingerprint);
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.throws(() => deterministicImportUuid('not-a-hash'), /canonical SHA-256/);
});

test('batching respects both row and serialized-byte limits without loss', () => {
  const records = Array.from({ length: 9 }, (_, index) => ({ id: index, value: 'x'.repeat(500 + index) }));
  const chunks = chunkByJsonBytes(records, { maxRows: 3, maxBytes: 1_100 });
  assert.ok(chunks.every(chunk => chunk.length <= 3));
  assert.deepEqual(chunks.flat(), records);
  assert.throws(() => chunkByJsonBytes([{ value: 'x'.repeat(2_000) }], { maxRows: 1, maxBytes: 1_024 }), /exceeds/);
});

test('staged count validation fails closed on any missing related row', () => {
  const expected = {
    products: 10,
    variants: 10,
    offers: 10,
    images: 8,
    searchRows: 10,
    skuIdentifiers: 15,
    mpnIdentifiers: 0,
    pricedOffers: 9,
    availableOffers: 4,
    distinctBrands: 3
  };
  assert.equal(validateImportCounts(expected, { ...expected }), true);
  assert.throws(() => validateImportCounts(expected, { ...expected, searchRows: 9 }), /searchRows: expected 10, found 9/);
  assert.throws(() => validateImportCounts(expected, { ...expected, products: 'NaN' }), /products: invalid database value/);
  assert.equal(resumeRequiresFullReplay(expected, expected), false);
  assert.equal(resumeRequiresFullReplay(expected, { ...expected, images: 7 }), true);
  assert.equal(resumeRequiresFullReplay(expected, { ...expected, skuIdentifiers: 14 }), true);
});

test('publication ordering rejects stale candidates and permits strictly fresher snapshots', () => {
  const base = {
    candidateImportId: 'candidate',
    candidateStartedAt: '2026-08-05T10:00:00.000Z',
    currentImportId: 'current',
    currentStartedAt: '2026-08-05T09:00:00.000Z',
    baseCurrentImportId: 'current'
  };
  assert.equal(publicationCandidateAllowed({
    ...base,
    candidateGeneratedAt: '2026-08-03T00:00:00.000Z',
    currentGeneratedAt: '2026-08-04T00:00:00.000Z'
  }), false);
  assert.equal(publicationCandidateAllowed({
    ...base,
    baseCurrentImportId: 'different-current',
    candidateGeneratedAt: '2026-08-05T00:00:00.000Z',
    currentGeneratedAt: '2026-08-04T00:00:00.000Z'
  }), true);
  assert.equal(publicationCandidateAllowed({
    ...base,
    candidateGeneratedAt: '2026-08-04T00:00:00.000Z',
    currentGeneratedAt: '2026-08-04T00:00:00.000Z'
  }), true);
  assert.equal(publicationCandidateAllowed({
    ...base,
    candidateImportId: 'current',
    candidateGeneratedAt: '2026-01-01T00:00:00.000Z',
    currentGeneratedAt: '2026-08-04T00:00:00.000Z'
  }), true);
});

test('publish SQL holds a supplier advisory lock and applies CAS plus freshness guards', () => {
  assert.match(PUBLISH_LOCK_SQL, /pg_advisory_xact_lock/);
  assert.match(PUBLISH_SQL, /pg_advisory_xact_lock/);
  assert.match(PUBLISH_SQL, /state\.current_import_id IS NOT DISTINCT FROM \$5::uuid/);
  assert.match(PUBLISH_SQL, /ci\.catalog_generated_at > current\.catalog_generated_at/);
  assert.match(PUBLISH_SQL, /ci\.started_at > current\.started_at/);
});

test('brand staging never overwrites a globally shared brand name', () => {
  assert.match(BATCH_SQL, /ON CONFLICT \(slug\) DO UPDATE SET name = brands\.name/);
  assert.doesNotMatch(BATCH_SQL, /name = EXCLUDED\.name/);
  assert.match(BATCH_SQL, /brand_resolve AS/);
});

test('validated shard hashes reject same-count byte changes before import', () => {
  const original = Buffer.from('[["one","Product One",""]]');
  const changed = Buffer.from('[["two","Product Two",""]]');
  const fingerprint = sha256Buffer(original);
  assert.equal(assertBufferSha256(original, fingerprint, 'fixture shard'), true);
  assert.throws(() => assertBufferSha256(changed, fingerprint, 'fixture shard'), /changed after validation/);
});

test('CLI supports help and dry-run without accepting unsafe unknown options', () => {
  assert.deepEqual(parseArguments(['--dry-run', '--batch-size', '100', '--max-batch-bytes=500000']), {
    dryRun: true,
    help: false,
    batchSize: 100,
    maxBatchBytes: 500_000
  });
  assert.equal(parseArguments(['--help']).help, true);
  assert.throws(() => parseArguments(['--database-url', 'secret']), /Unknown option/);
});

test('dependency-free Neon client targets the official HTTPS SQL endpoint and parses rows', async () => {
  const databaseUrl = 'postgresql://user:password@ep-example-123.eu-central-1.aws.neon.tech/neondb?sslmode=require';
  assert.equal(neonSqlEndpoint(databaseUrl), 'https://api.eu-central-1.aws.neon.tech/sql');
  let request;
  const client = createNeonHttpClient({
    databaseUrl,
    maximumAttempts: 1,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({
          fields: [{ name: 'value', dataTypeID: 23 }],
          rows: [['42']],
          rowCount: 1,
          command: 'SELECT'
        })
      };
    }
  });
  const result = await client.query('SELECT $1::int AS value', [42]);
  assert.deepEqual(result.rows, [{ value: '42' }]);
  assert.equal(request.url, 'https://api.eu-central-1.aws.neon.tech/sql');
  assert.equal(request.options.headers['Neon-Connection-String'], databaseUrl);
  assert.equal(JSON.parse(request.options.body).params[0], 42);
});

test('Neon batch publication can lock in one statement and read fresh state in the next', async () => {
  const databaseUrl = 'postgresql://user:password@ep-example-123.eu-central-1.aws.neon.tech/neondb';
  let request;
  const client = createNeonHttpClient({
    databaseUrl,
    maximumAttempts: 1,
    fetchImpl: async (url, options) => {
      request = { url, options };
      const result = {
        fields: [{ name: 'ok', dataTypeID: 16 }],
        rows: [['t']],
        rowCount: 1,
        command: 'SELECT'
      };
      return { ok: true, json: async () => ({ results: [result, result] }) };
    }
  });
  const results = await client.transaction([
    { query: 'SELECT pg_advisory_xact_lock($1)', params: [1] },
    { query: 'SELECT true AS ok', params: [] }
  ], { isolationLevel: 'ReadCommitted' });
  assert.equal(results.length, 2);
  assert.equal(request.options.headers['Neon-Batch-Isolation-Level'], 'ReadCommitted');
  assert.equal(JSON.parse(request.options.body).queries.length, 2);
});
