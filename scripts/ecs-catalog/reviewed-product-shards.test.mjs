import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildReviewedProductShardRelease,
  writeReviewedProductShardRelease
} from './build-reviewed-product-shards.mjs';
import {
  createReviewedShardCatalogueProvider,
  signReviewedShardManifest
} from '../../server/ecs-reviewed-shard-catalog.js';
import {
  publishReviewedProductShards,
  ReviewedShardPublisherError
} from './publish-reviewed-product-shards.mjs';

const NOW = Date.parse('2026-08-09T16:00:00.000Z');
const LEGACY_TOKEN = 'test_blob_token_1234567890';
const OIDC_TOKEN = 'test_oidc_token_1234567890';
const STORE_ID = 'store_testblob1234567890';
const MANIFEST_SECRET = 'reviewed-shard-test-secret-'.repeat(2);

function audit({ complete = false } = {}) {
  const sectionKeys = ['braking', 'engine', 'exterior', 'interior', 'performance', 'suspension', 'steering'];
  const includedSections = complete ? sectionKeys : ['braking'];
  const sections = Object.fromEntries(sectionKeys.map(key => [key, {
    complete: includedSections.includes(key),
    capturedPages: includedSections.includes(key) ? 1 : 0,
    expectedPages: includedSections.includes(key) ? 1 : 0,
    capturedPlacements: includedSections.includes(key) ? 300 : 0,
    expectedPlacements: includedSections.includes(key) ? 300 : 0
  }]));
  return {
    generatedAt: '2026-08-09T15:00:00.000Z',
    quarantinedIdentityCount: 0,
    sections: Object.fromEntries(sectionKeys.map(key => [key, {
      productCount: includedSections.includes(key) ? 300 : 0
    }])),
    captureProgress: { complete, includedSections, sections }
  };
}

function product(index) {
  const digits = String(100_000 + index);
  return {
    publicKey: `ecs-es-${digits}`,
    slug: `es-${digits}`,
    title: `BMW M3 Brake Product ${String(index).padStart(4, '0')}`,
    titleAr: null,
    brand: index % 2 ? 'ATE' : 'ECS Tuning',
    brandSlug: index % 2 ? 'ate' : 'ecs-tuning',
    category: 'Braking Parts', categorySlug: 'bmw-m3-braking',
    subcategory: 'BMW M3 Brake Pads', subcategorySlug: 'bmw-m3-braking-brake-pads',
    ecsPartNumber: `ES#${digits}`, sku: `ES#${digits}`, mpn: `MPN-${digits}`,
    description: `Verified brake component ${index}`,
    priceAmount: 10 + index, priceCurrency: 'USD', priceVerifiedAt: '2026-08-09',
    quoteOnly: false, checkedAt: '2026-08-09', staleAfterDays: 7,
    stockPolicy: 'manual-confirm', availabilityCode: 'check_availability',
    fitmentConfidence: 'possible',
    fitments: [{ make: 'BMW', model: 'M3', models: ['M3'], chassis: [], engines: [], confidence: 'possible' }],
    filters: {
      categories: ['bmw-m3', 'bmw-m3-braking'],
      subcategories: ['bmw-m3-braking-brake-pads']
    },
    selectionSources: [{ section: 'Braking', category: 'BMW M3 Brake Pads' }],
    relatedProductSlugs: []
  };
}

function request(overrides = {}) {
  return {
    mode: 'browse', query: null, sort: 'name_asc', availability: 'all', pricing: 'all',
    match: 'any', supplier: 'ecs', brand: null, partType: null, currency: 'USD',
    fitment: 'all', year: null, make: null, model: null, generation: null, engine: null,
    structuredVehicle: false, page: 1, offset: 0, positionSource: 'page', ...overrides
  };
}

async function fixture({ complete = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'projx-reviewed-shards-'));
  const products = Array.from({ length: 300 }, (_, index) => product(index + 1));
  const release = buildReviewedProductShardRelease(products, audit({ complete }), { shardSize: 128 });
  await writeReviewedProductShardRelease(root, release);
  return { root, products, release };
}

function memoryBlobSdk() {
  const objects = new Map();
  const putCalls = [];
  const getCalls = [];
  const url = pathname => `https://reviewed-test.public.blob.vercel-storage.com/${pathname}`;
  return {
    putCalls,
    getCalls,
    async put(pathname, body, options) {
      const buffer = Buffer.from(body);
      putCalls.push({ pathname, options });
      objects.set(pathname, { buffer, contentType: options.contentType });
      return { url: url(pathname) };
    },
    async get(pathname, options) {
      getCalls.push({ pathname, options });
      const object = objects.get(pathname);
      if (!object) return null;
      return {
        statusCode: 200,
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue(object.buffer);
            controller.close();
          }
        }),
        blob: {
          url: url(pathname), pathname, size: object.buffer.length,
          contentType: object.contentType, etag: `etag-${object.buffer.length}`
        }
      };
    }
  };
}

test('build is deterministic, bounded and records verified progress explicitly', () => {
  const products = Array.from({ length: 300 }, (_, index) => product(index + 1));
  const first = buildReviewedProductShardRelease(products, audit(), { shardSize: 128 });
  const second = buildReviewedProductShardRelease([...products].reverse(), audit(), { shardSize: 128 });
  assert.equal(first.manifest.releaseId, second.manifest.releaseId);
  assert.equal(first.manifest.contentSetSha256, second.manifest.contentSetSha256);
  assert.deepEqual(first.shards.map(item => item.sha256), second.shards.map(item => item.sha256));
  assert.equal(first.manifest.complete, false);
  assert.equal(first.manifest.publicationMode, 'verified-progress');
  assert.deepEqual(first.manifest.includedSections, ['braking']);
  assert.equal(first.manifest.counts.productCount, 300);
  assert.equal(first.manifest.counts.shardCount, 3);
  assert.ok(first.shards.every(item => item.productCount <= 128));
});

test('a normal page reads its routing index and only the requested product shard', async (t) => {
  const current = await fixture();
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const reads = [];
  const provider = createReviewedShardCatalogueProvider({
    localManifestPath: path.join(current.root, 'manifest.json'),
    now: () => NOW,
    readFileImpl: async filename => {
      reads.push(path.basename(filename));
      return readFile(filename);
    }
  });
  const prepared = await provider.prepareProducts({ request: request(), baseProducts: [], nowValue: NOW });
  assert.equal(prepared.products.length, 300);
  assert.equal(prepared.loadedShardCount, 1);
  assert.deepEqual(reads.filter(name => name.startsWith('shard-')), ['shard-00001.json']);
  assert.equal(prepared.products.filter(item => !item.shardedRoute).length, 100);
  assert.equal(prepared.status.publishedProductCount, 300);
  assert.equal(prepared.status.shardRelease.complete, false);
});

test('an exact identifier search hydrates only the shard containing that result', async (t) => {
  const current = await fixture();
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const provider = createReviewedShardCatalogueProvider({
    localManifestPath: path.join(current.root, 'manifest.json'), now: () => NOW
  });
  const prepared = await provider.prepareProducts({
    request: request({ mode: 'search', query: 'ES#100299', sort: 'relevance' }),
    baseProducts: [], nowValue: NOW
  });
  assert.equal(prepared.loadedShardCount, 1);
  assert.equal(provider.diagnostics().shardReadCount, 1);
  assert.equal(prepared.products.find(item => item.publicKey === 'ecs-es-100299')?.shardedRoute, undefined);
});

test('checksum corruption and unapproved incomplete publication fail closed', async (t) => {
  const current = await fixture();
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const firstShard = path.join(current.root, 'shard-00001.json');
  await writeFile(firstShard, '{}\n');
  const corrupt = createReviewedShardCatalogueProvider({
    localManifestPath: path.join(current.root, 'manifest.json'), now: () => NOW
  });
  await assert.rejects(
    () => corrupt.prepareProducts({ request: request(), baseProducts: [], nowValue: NOW }),
    error => error?.code === 'reviewed_shard_checksum_mismatch'
  );
  const strict = createReviewedShardCatalogueProvider({
    localManifestPath: path.join(current.root, 'manifest.json'), now: () => NOW,
    allowIncompleteLocal: false
  });
  await assert.rejects(
    () => strict.getStatus([]),
    error => error?.code === 'incomplete_reviewed_shard_release'
  );
});

test('unreconciled sections and products outside included sections are rejected', () => {
  const badAudit = audit();
  badAudit.captureProgress.sections.braking.complete = false;
  assert.throws(
    () => buildReviewedProductShardRelease([product(1)], badAudit),
    error => error?.code === 'unverified_section'
  );
  const wrongScope = product(2);
  wrongScope.selectionSources = [{ section: 'Engine', category: 'BMW M3 Cooling' }];
  assert.throws(
    () => buildReviewedProductShardRelease([wrongScope], audit()),
    error => error?.code === 'unverified_product_scope'
  );
});

test('a signed complete Blob release is accepted while a modified signature fails closed', async () => {
  const secret = MANIFEST_SECRET;
  const products = Array.from({ length: 300 }, (_, index) => product(index + 1));
  const release = buildReviewedProductShardRelease(products, audit({ complete: true }), { shardSize: 128 });
  const host = 'reviewed-test.public.blob.vercel-storage.com';
  const prefix = `https://${host}/projx-racing/ecs-reviewed/releases/${release.manifest.releaseId}/`;
  const remoteManifest = {
    ...release.manifest,
    index: { url: `${prefix}index.json`, bytes: release.manifest.index.bytes, sha256: release.manifest.index.sha256 },
    shards: release.manifest.shards.map(descriptor => ({
      sequence: descriptor.sequence,
      url: `${prefix}${descriptor.file}`,
      productCount: descriptor.productCount,
      bytes: descriptor.bytes,
      sha256: descriptor.sha256,
      firstKey: descriptor.firstKey,
      lastKey: descriptor.lastKey
    })),
    publishedAt: '2026-08-09T15:30:00.000Z',
    expiresAt: '2026-08-16T15:30:00.000Z'
  };
  remoteManifest.signature = signReviewedShardManifest(remoteManifest, secret);
  const currentUrl = `https://${host}/projx-racing/ecs-reviewed/preview/current.json`;
  const documents = new Map([
    [currentUrl, Buffer.from(`${JSON.stringify(remoteManifest)}\n`)],
    [remoteManifest.index.url, release.indexBuffer],
    ...release.shards.map((shard, index) => [remoteManifest.shards[index].url, shard.buffer])
  ]);
  const calls = [];
  const fetchImpl = async url => {
    calls.push(String(url));
    const body = documents.get(String(url));
    return body
      ? new Response(body, { status: 200, headers: { 'content-type': 'application/json', 'content-length': String(body.length) } })
      : new Response('missing', { status: 404, headers: { 'content-type': 'text/plain' } });
  };
  const provider = createReviewedShardCatalogueProvider({
    currentUrl, manifestSecret: secret, fetchImpl, now: () => NOW
  });
  const prepared = await provider.prepareProducts({ request: request(), baseProducts: [], nowValue: NOW });
  assert.equal(prepared.status.shardRelease.source, 'signed-vercel-blob');
  assert.equal(prepared.status.shardRelease.complete, true);
  assert.equal(calls.filter(url => url.includes('shard-')).length, 1);

  const modified = { ...remoteManifest, counts: { ...remoteManifest.counts, productCount: 299 } };
  const invalid = createReviewedShardCatalogueProvider({
    currentUrl, manifestSecret: secret,
    fetchImpl: async () => new Response(JSON.stringify(modified), {
      status: 200, headers: { 'content-type': 'application/json' }
    }),
    now: () => NOW
  });
  await assert.rejects(() => invalid.getStatus([]), error => error?.code === 'invalid_reviewed_shard_manifest');
});

test('reviewed shard publishing prefers OIDC and omits the legacy token option', async (t) => {
  const current = await fixture({ complete: true });
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const sdk = memoryBlobSdk();
  const result = await publishReviewedProductShards({
    directory: current.root,
    dryRun: false,
    previewConfirmed: true,
    token: LEGACY_TOKEN,
    oidcToken: OIDC_TOKEN,
    storeId: STORE_ID,
    manifestSecret: MANIFEST_SECRET,
    blobSdk: sdk,
    now: NOW
  });
  assert.equal(result.status, 'published');
  assert.ok(sdk.putCalls.length > 0);
  assert.ok(sdk.getCalls.length > 0);
  for (const { options } of [...sdk.putCalls, ...sdk.getCalls]) {
    assert.equal(options.oidcToken, OIDC_TOKEN);
    assert.equal(options.storeId, STORE_ID);
    assert.equal(Object.hasOwn(options, 'token'), false);
  }
});

test('reviewed shard publishing rejects either incomplete OIDC combination before remote access', async (t) => {
  const current = await fixture({ complete: true });
  t.after(() => rm(current.root, { recursive: true, force: true }));
  for (const credentials of [
    { oidcToken: OIDC_TOKEN, storeId: '' },
    { oidcToken: '', storeId: STORE_ID }
  ]) {
    const sdk = memoryBlobSdk();
    await assert.rejects(
      publishReviewedProductShards({
        directory: current.root,
        dryRun: false,
        previewConfirmed: true,
        token: LEGACY_TOKEN,
        ...credentials,
        manifestSecret: MANIFEST_SECRET,
        blobSdk: sdk,
        now: NOW
      }),
      error => error instanceof ReviewedShardPublisherError && error.code === 'blob_oidc_incomplete'
    );
    assert.equal(sdk.putCalls.length, 0);
    assert.equal(sdk.getCalls.length, 0);
  }
});
