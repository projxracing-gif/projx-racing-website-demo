import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildReviewedProductShardRelease,
  mergeReviewedShardOverlay,
  readReviewedProductsFromShardRelease,
  writeReviewedProductShardRelease
} from './build-reviewed-product-shards.mjs';
import {
  createReviewedShardCatalogueProvider,
  signReviewedShardManifest
} from '../../server/ecs-reviewed-shard-catalog.js';
import {
  ECS_REVIEWED_CURRENT_PATH,
  ECS_REVIEWED_F8X_OVERLAY_CURRENT_PATH,
  ECS_REVIEWED_F8X_OVERLAY_RELEASE_PREFIX,
  ECS_REVIEWED_RELEASE_PREFIX,
  publishReviewedProductShards,
  ReviewedShardPublisherError
} from './publish-reviewed-product-shards.mjs';

const NOW = Date.parse('2026-08-09T16:00:00.000Z');
const LEGACY_AUTH_FIXTURE = 'test_blob_token_1234567890';
const OIDC_AUTH_FIXTURE = 'test_oidc_token_1234567890';
const STORE_ID = 'store_testblob1234567890';
const MANIFEST_SIGNING_FIXTURE = 'reviewed-shard-test-secret-'.repeat(2);

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

async function fixture({ complete = false, products = null } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'projx-reviewed-shards-'));
  const reviewedProducts = products || Array.from({ length: 300 }, (_, index) => product(index + 1));
  const release = buildReviewedProductShardRelease(reviewedProducts, audit({ complete }), { shardSize: 128 });
  await writeReviewedProductShardRelease(root, release);
  return { root, products: reviewedProducts, release };
}

function memoryBlobSdk({
  readMissesAfterPut = 0,
  alreadyExistsRacePath = null,
  alreadyExistsRaceBody = null,
  weakGetEtagPath = null,
  headEtagOverridePath = null,
  staleReadsAfterOverwritePath = null,
  staleReadsAfterOverwriteCount = 0
} = {}) {
  const objects = new Map();
  const remainingReadMisses = new Map();
  const staleReads = new Map();
  const putCalls = [];
  const getCalls = [];
  const headCalls = [];
  let etagSequence = 0;
  const url = pathname => `https://reviewed-test.public.blob.vercel-storage.com/${pathname}`;
  const objectFor = (body, contentType = 'application/json') => ({
    buffer: Buffer.from(body), contentType, etag: `"etag-${++etagSequence}"`
  });
  return {
    putCalls,
    getCalls,
    headCalls,
    seed(pathname, body, contentType = 'application/json') {
      const object = objectFor(body, contentType);
      objects.set(pathname, object);
      return object.etag;
    },
    async put(pathname, body, options) {
      const buffer = Buffer.from(body);
      putCalls.push({ pathname, options });
      const existing = objects.get(pathname);
      if (options.ifMatch && existing?.etag !== options.ifMatch) {
        throw new Error('Vercel Blob: Precondition failed: ETag mismatch.');
      }
      const storedBuffer = pathname === alreadyExistsRacePath && alreadyExistsRaceBody
        ? Buffer.from(alreadyExistsRaceBody)
        : buffer;
      const object = objectFor(storedBuffer, options.contentType);
      objects.set(pathname, object);
      remainingReadMisses.set(pathname, readMissesAfterPut);
      if (existing && pathname === staleReadsAfterOverwritePath && staleReadsAfterOverwriteCount > 0) {
        staleReads.set(pathname, { object: existing, remaining: staleReadsAfterOverwriteCount });
      }
      if (pathname === alreadyExistsRacePath) {
        throw new Error(
          'Vercel Blob: This blob already exists, use allowOverwrite: true to overwrite it.'
        );
      }
      return { url: url(pathname) };
    },
    async get(pathname, options) {
      getCalls.push({ pathname, options });
      const stale = staleReads.get(pathname);
      const object = stale?.remaining > 0 ? stale.object : objects.get(pathname);
      if (stale?.remaining > 0) stale.remaining -= 1;
      if (!object) return null;
      const misses = remainingReadMisses.get(pathname) || 0;
      if (misses > 0) {
        remainingReadMisses.set(pathname, misses - 1);
        return { statusCode: 404 };
      }
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
          contentType: object.contentType,
          etag: pathname === weakGetEtagPath ? `W/${object.etag}` : object.etag
        }
      };
    },
    async head(pathname, options) {
      headCalls.push({ pathname, options });
      const object = objects.get(pathname);
      if (!object) throw new Error('Vercel Blob: The requested blob does not exist');
      return {
        url: url(pathname), pathname, size: object.buffer.length,
        contentType: object.contentType,
        etag: pathname === headEtagOverridePath ? '"different-etag"' : object.etag
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

test('loads a current shard release and merges an overlay by ES number without losing products or handles', async (t) => {
  const current = await fixture();
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const loaded = await readReviewedProductsFromShardRelease(current.root);
  const overlap = {
    ...product(1),
    fitments: [{
      make: 'BMW', model: 'M3', models: ['M3', 'M4'], generation: 'F8X',
      chassis: ['F80', 'F82', 'F83'], engines: ['S55'], confidence: 'exact'
    }],
    filters: {
      categories: ['bmw-m3', 'bmw-m3-braking', 'bmw-f8x-braking'],
      subcategories: ['bmw-m3-braking-brake-pads']
    }
  };
  const added = product(999);
  const merged = mergeReviewedShardOverlay(loaded, [overlap, added]);
  assert.equal(merged.length, loaded.length + 1);
  assert.deepEqual(
    new Set(loaded.map(item => item.ecsPartNumber)),
    new Set(merged.slice(0, loaded.length).map(item => item.ecsPartNumber))
  );
  const retained = merged.find(item => item.ecsPartNumber === overlap.ecsPartNumber);
  assert.equal(retained.publicKey, loaded.find(item => item.ecsPartNumber === overlap.ecsPartNumber).publicKey);
  assert.equal(retained.slug, loaded.find(item => item.ecsPartNumber === overlap.ecsPartNumber).slug);
  assert.ok(retained.fitments.some(fitment => fitment.chassis?.includes('F82')));
  assert.ok(retained.filters.categories.includes('bmw-f8x-braking'));
});

test('runtime overlays preserve a static handle while exposing compact and hydrated F80/F82/F83 fitment', async (t) => {
  const overlay = {
    ...product(1),
    description: 'Full F8X overlay detail from the reviewed shard.',
    specifications: [{ name: 'Overlay evidence', value: 'F80/F82/F83' }],
    fitments: [{
      make: 'BMW', model: 'M3 / M4', models: ['M3', 'M4'], generation: 'F8X',
      chassis: ['F80', 'F82', 'F83'], yearFrom: 2014, yearTo: 2020,
      engines: ['S55'], confidence: 'exact'
    }],
    filters: {
      categories: ['bmw-m3', 'bmw-m3-braking', 'bmw-f8x-braking'],
      subcategories: ['bmw-m3-braking-brake-pads']
    }
  };
  const current = await fixture({ products: [overlay] });
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const base = {
    ...product(1),
    publicKey: 'ecs-curated-f8x-brake',
    slug: 'curated-f8x-brake',
    description: 'Static reviewed description.',
    fitments: [{ make: 'BMW', model: 'M3', models: ['M3'], chassis: [], engines: [], confidence: 'possible' }],
    filters: { categories: ['bmw-m3', 'bmw-m3-braking'], subcategories: [] }
  };
  const provider = createReviewedShardCatalogueProvider({
    localManifestPath: path.join(current.root, 'manifest.json'), now: () => NOW
  });

  const compact = await provider.prepareProducts({
    request: request({
      generation: 'F82', structuredVehicle: true, offset: 100, page: 2, positionSource: 'offset'
    }),
    baseProducts: [base],
    nowValue: NOW
  });
  assert.equal(compact.products.length, 1);
  assert.equal(compact.products[0].publicKey, base.publicKey);
  assert.equal(compact.products[0].slug, base.slug);
  assert.deepEqual(compact.products[0].specifications, []);
  assert.ok(compact.products[0].fitments.some(fitment => fitment.chassis?.includes('F82')));
  assert.ok(compact.products[0].filters.categories.includes('bmw-f8x-braking'));
  assert.equal(compact.loadedShardCount, 0);
  assert.equal(compact.status.sourceRecordCounts.bmwM3ShardedUnique, 0);
  assert.equal(compact.status.sourceRecordCounts.bmwM3ShardedOverlay, 1);
  assert.equal(compact.status.publishedProductCount, 1);

  const hydrated = await provider.prepareProducts({
    request: request({ mode: 'detail', handle: base.slug }),
    baseProducts: [base],
    nowValue: NOW
  });
  assert.equal(hydrated.loadedShardCount, 1);
  assert.equal(hydrated.products.length, 1);
  assert.equal(hydrated.products[0].publicKey, base.publicKey);
  assert.equal(hydrated.products[0].slug, base.slug);
  assert.ok(hydrated.products[0].fitments.some(fitment => (
    ['F80', 'F82', 'F83'].every(chassis => fitment.chassis?.includes(chassis))
  )));
  assert.ok(hydrated.products[0].filters.categories.includes('bmw-f8x-braking'));
  assert.deepEqual(hydrated.products[0].specifications, [{ name: 'Overlay evidence', value: 'F80/F82/F83' }]);
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
  const secret = MANIFEST_SIGNING_FIXTURE;
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
    token: LEGACY_AUTH_FIXTURE,
    oidcToken: OIDC_AUTH_FIXTURE,
    storeId: STORE_ID,
    manifestSecret: MANIFEST_SIGNING_FIXTURE,
    blobSdk: sdk,
    now: NOW
  });
  assert.equal(result.status, 'published');
  assert.ok(sdk.putCalls.length > 0);
  assert.ok(sdk.getCalls.length > 0);
  for (const { options } of [...sdk.putCalls, ...sdk.getCalls, ...sdk.headCalls]) {
    assert.equal(options.oidcToken, OIDC_AUTH_FIXTURE);
    assert.equal(options.storeId, STORE_ID);
    assert.equal(Object.hasOwn(options, 'token'), false);
  }
  assert.equal(
    sdk.putCalls.filter(call => call.pathname === ECS_REVIEWED_CURRENT_PATH).length,
    1,
  );
  assert.ok(sdk.putCalls.filter(call => call.pathname !== ECS_REVIEWED_CURRENT_PATH)
    .every(call => call.pathname.startsWith(ECS_REVIEWED_RELEASE_PREFIX)));
  const remotePaths = [
    ...sdk.putCalls.map(call => call.pathname),
    ...sdk.getCalls.map(call => call.pathname),
  ];
  assert.equal(remotePaths.includes(ECS_REVIEWED_F8X_OVERLAY_CURRENT_PATH), false);
  assert.equal(remotePaths.some(value => (
    value.startsWith(ECS_REVIEWED_F8X_OVERLAY_RELEASE_PREFIX)
  )), false);
});

test('reviewed shard publishing retries transient Blob read-after-write misses with bounded backoff', async (t) => {
  const current = await fixture({ complete: true, products: [product(1)] });
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const sdk = memoryBlobSdk({ readMissesAfterPut: 2 });
  const waits = [];
  const result = await publishReviewedProductShards({
    directory: current.root,
    dryRun: false,
    previewConfirmed: true,
    token: LEGACY_AUTH_FIXTURE,
    manifestSecret: MANIFEST_SIGNING_FIXTURE,
    blobSdk: sdk,
    readBackWait: async delayMs => waits.push(delayMs),
    now: NOW
  });

  assert.equal(result.status, 'published');
  assert.deepEqual(waits, [200, 500, 200, 500, 200, 500]);
  const writtenPaths = sdk.putCalls.map(call => call.pathname);
  assert.equal(writtenPaths.length, 3);
  for (const pathname of writtenPaths) {
    const readCount = sdk.getCalls.filter(call => call.pathname === pathname).length;
    assert.equal(readCount, 4);
  }
  assert.equal(
    sdk.putCalls.filter(call => call.pathname === ECS_REVIEWED_CURRENT_PATH).length,
    1
  );
});

test('reviewed shard publishing exhausts read-back retries before failing without moving current', async (t) => {
  const current = await fixture({ complete: true, products: [product(1)] });
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const sdk = memoryBlobSdk({ readMissesAfterPut: 99 });
  const waits = [];

  await assert.rejects(
    publishReviewedProductShards({
      directory: current.root,
      dryRun: false,
      previewConfirmed: true,
      token: LEGACY_AUTH_FIXTURE,
      manifestSecret: MANIFEST_SIGNING_FIXTURE,
      blobSdk: sdk,
      readBackWait: async delayMs => waits.push(delayMs),
      now: NOW
    }),
    error => error instanceof ReviewedShardPublisherError && error.code === 'remote_verify_failed'
  );

  assert.deepEqual(waits, [200, 500, 1_000, 2_000, 4_000]);
  assert.equal(sdk.putCalls.length, 1);
  assert.equal(sdk.getCalls.length, 7);
  assert.equal(sdk.putCalls.some(call => call.pathname === ECS_REVIEWED_CURRENT_PATH), false);
});

test('reviewed shard publishing reuses an existing immutable object only after exact verification', async (t) => {
  const current = await fixture({ complete: true, products: [product(1)] });
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const sdk = memoryBlobSdk();
  const indexPath = `${ECS_REVIEWED_RELEASE_PREFIX}${current.release.manifest.releaseId}/${current.release.manifest.index.file}`;
  sdk.seed(indexPath, current.release.indexBuffer);

  const result = await publishReviewedProductShards({
    directory: current.root,
    dryRun: false,
    previewConfirmed: true,
    token: LEGACY_AUTH_FIXTURE,
    manifestSecret: MANIFEST_SIGNING_FIXTURE,
    blobSdk: sdk,
    now: NOW
  });

  assert.equal(result.status, 'published');
  assert.equal(sdk.putCalls.some(call => call.pathname === indexPath), false);
  assert.equal(sdk.getCalls.filter(call => call.pathname === indexPath).length, 1);
  assert.equal(
    sdk.putCalls.filter(call => call.pathname === ECS_REVIEWED_CURRENT_PATH).length,
    1
  );
});

test('reviewed shard publishing rejects an existing immutable object with mismatched content', async (t) => {
  const current = await fixture({ complete: true, products: [product(1)] });
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const sdk = memoryBlobSdk();
  const indexPath = `${ECS_REVIEWED_RELEASE_PREFIX}${current.release.manifest.releaseId}/${current.release.manifest.index.file}`;
  sdk.seed(indexPath, Buffer.from('{}\n', 'utf8'));

  await assert.rejects(
    publishReviewedProductShards({
      directory: current.root,
      dryRun: false,
      previewConfirmed: true,
      token: LEGACY_AUTH_FIXTURE,
      manifestSecret: MANIFEST_SIGNING_FIXTURE,
      blobSdk: sdk,
      now: NOW
    }),
    error => error instanceof ReviewedShardPublisherError && error.code === 'remote_verify_failed'
  );

  assert.equal(sdk.putCalls.length, 0);
  assert.equal(sdk.getCalls.filter(call => call.pathname === indexPath).length, 1);
});

test('reviewed shard publishing verifies a generic SDK already-exists race before continuing', async (t) => {
  const current = await fixture({ complete: true, products: [product(1)] });
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const indexPath = `${ECS_REVIEWED_RELEASE_PREFIX}${current.release.manifest.releaseId}/${current.release.manifest.index.file}`;
  const sdk = memoryBlobSdk({ alreadyExistsRacePath: indexPath });

  const result = await publishReviewedProductShards({
    directory: current.root,
    dryRun: false,
    previewConfirmed: true,
    token: LEGACY_AUTH_FIXTURE,
    manifestSecret: MANIFEST_SIGNING_FIXTURE,
    blobSdk: sdk,
    now: NOW
  });

  assert.equal(result.status, 'published');
  assert.equal(sdk.putCalls.filter(call => call.pathname === indexPath).length, 1);
  assert.equal(sdk.getCalls.filter(call => call.pathname === indexPath).length, 2);
  assert.equal(
    sdk.putCalls.filter(call => call.pathname === ECS_REVIEWED_CURRENT_PATH).length,
    1
  );
});

test('reviewed shard publishing rejects a generic already-exists race with mismatched content', async (t) => {
  const current = await fixture({ complete: true, products: [product(1)] });
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const indexPath = `${ECS_REVIEWED_RELEASE_PREFIX}${current.release.manifest.releaseId}/${current.release.manifest.index.file}`;
  const sdk = memoryBlobSdk({
    alreadyExistsRacePath: indexPath,
    alreadyExistsRaceBody: Buffer.from('{}\n', 'utf8')
  });

  await assert.rejects(
    publishReviewedProductShards({
      directory: current.root,
      dryRun: false,
      previewConfirmed: true,
      token: LEGACY_AUTH_FIXTURE,
      manifestSecret: MANIFEST_SIGNING_FIXTURE,
      blobSdk: sdk,
      now: NOW
    }),
    error => error instanceof ReviewedShardPublisherError && error.code === 'remote_verify_failed'
  );

  assert.equal(sdk.putCalls.filter(call => call.pathname === indexPath).length, 1);
  assert.equal(sdk.putCalls.some(call => call.pathname === ECS_REVIEWED_CURRENT_PATH), false);
});

test('reviewed shard pointer CAS compares weak get and strong head ETags then writes with head ETag', async (t) => {
  const current = await fixture({ complete: true, products: [product(1)] });
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const sdk = memoryBlobSdk({ weakGetEtagPath: ECS_REVIEWED_CURRENT_PATH });
  const strongEtag = sdk.seed(
    ECS_REVIEWED_CURRENT_PATH,
    Buffer.from('{"kind":"stale-reviewed-pointer"}\n', 'utf8')
  );

  const result = await publishReviewedProductShards({
    directory: current.root,
    dryRun: false,
    previewConfirmed: true,
    token: LEGACY_AUTH_FIXTURE,
    manifestSecret: MANIFEST_SIGNING_FIXTURE,
    blobSdk: sdk,
    now: NOW
  });

  assert.equal(result.status, 'published');
  const pointerWrite = sdk.putCalls.find(call => call.pathname === ECS_REVIEWED_CURRENT_PATH);
  assert.ok(pointerWrite);
  assert.equal(pointerWrite.options.allowOverwrite, true);
  assert.equal(pointerWrite.options.ifMatch, strongEtag);
  assert.equal(sdk.headCalls.filter(call => call.pathname === ECS_REVIEWED_CURRENT_PATH).length, 1);
});

test('reviewed shard rerun verifies weak and strong pointer ETags before returning no change', async (t) => {
  const current = await fixture({ complete: true, products: [product(1)] });
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const sdk = memoryBlobSdk({ weakGetEtagPath: ECS_REVIEWED_CURRENT_PATH });
  const options = {
    directory: current.root,
    dryRun: false,
    previewConfirmed: true,
    token: LEGACY_AUTH_FIXTURE,
    manifestSecret: MANIFEST_SIGNING_FIXTURE,
    blobSdk: sdk,
    now: NOW
  };

  assert.equal((await publishReviewedProductShards(options)).status, 'published');
  assert.equal((await publishReviewedProductShards(options)).status, 'no_change');
  assert.equal(
    sdk.putCalls.filter(call => call.pathname === ECS_REVIEWED_CURRENT_PATH).length,
    1
  );
  assert.equal(sdk.headCalls.filter(call => call.pathname === ECS_REVIEWED_CURRENT_PATH).length, 1);
});

test('reviewed shard pointer CAS fails before overwrite when get and head ETags identify different versions', async (t) => {
  const current = await fixture({ complete: true, products: [product(1)] });
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const sdk = memoryBlobSdk({
    weakGetEtagPath: ECS_REVIEWED_CURRENT_PATH,
    headEtagOverridePath: ECS_REVIEWED_CURRENT_PATH
  });
  sdk.seed(
    ECS_REVIEWED_CURRENT_PATH,
    Buffer.from('{"kind":"stale-reviewed-pointer"}\n', 'utf8')
  );

  await assert.rejects(
    publishReviewedProductShards({
      directory: current.root,
      dryRun: false,
      previewConfirmed: true,
      token: LEGACY_AUTH_FIXTURE,
      manifestSecret: MANIFEST_SIGNING_FIXTURE,
      blobSdk: sdk,
      now: NOW
    }),
    error => error instanceof ReviewedShardPublisherError && error.code === 'publish_conflict'
  );

  assert.equal(sdk.putCalls.some(call => call.pathname === ECS_REVIEWED_CURRENT_PATH), false);
});

test('reviewed shard pointer read-back retries stale cached content after a guarded overwrite', async (t) => {
  const current = await fixture({ complete: true, products: [product(1)] });
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const sdk = memoryBlobSdk({
    weakGetEtagPath: ECS_REVIEWED_CURRENT_PATH,
    staleReadsAfterOverwritePath: ECS_REVIEWED_CURRENT_PATH,
    staleReadsAfterOverwriteCount: 2
  });
  sdk.seed(
    ECS_REVIEWED_CURRENT_PATH,
    Buffer.from('{"kind":"stale-reviewed-pointer"}\n', 'utf8')
  );
  const waits = [];

  const result = await publishReviewedProductShards({
    directory: current.root,
    dryRun: false,
    previewConfirmed: true,
    token: LEGACY_AUTH_FIXTURE,
    manifestSecret: MANIFEST_SIGNING_FIXTURE,
    blobSdk: sdk,
    readBackWait: async delayMs => waits.push(delayMs),
    now: NOW
  });

  assert.equal(result.status, 'published');
  assert.deepEqual(waits, [200, 500]);
});

test('reviewed shard publishing rejects either incomplete OIDC combination before remote access', async (t) => {
  const current = await fixture({ complete: true });
  t.after(() => rm(current.root, { recursive: true, force: true }));
  for (const credentials of [
    { oidcToken: OIDC_AUTH_FIXTURE, storeId: '' },
    { oidcToken: '', storeId: STORE_ID }
  ]) {
    const sdk = memoryBlobSdk();
    await assert.rejects(
      publishReviewedProductShards({
        directory: current.root,
        dryRun: false,
        previewConfirmed: true,
        token: LEGACY_AUTH_FIXTURE,
        ...credentials,
        manifestSecret: MANIFEST_SIGNING_FIXTURE,
        blobSdk: sdk,
        now: NOW
      }),
      error => error instanceof ReviewedShardPublisherError && error.code === 'blob_oidc_incomplete'
    );
    assert.equal(sdk.putCalls.length, 0);
    assert.equal(sdk.getCalls.length, 0);
  }
});
