import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import {
  createConfiguredReviewedShardCatalogueProvider,
  createReviewedShardCatalogueProvider,
  ECS_REVIEWED_F8X_OVERLAY_CURRENT_URL_ENV,
  ECS_REVIEWED_F8X_OVERLAY_INDEX_KIND,
  ECS_REVIEWED_F8X_OVERLAY_MANIFEST_KIND,
  ECS_REVIEWED_F8X_OVERLAY_MANIFEST_SECRET_ENV,
  ECS_REVIEWED_F8X_OVERLAY_SCOPE,
  ECS_REVIEWED_F8X_OVERLAY_SHARD_KIND,
  signReviewedShardManifest
} from '../../server/ecs-reviewed-shard-catalog.js';
import { REVIEWED_ECS_PRODUCTS } from '../../server/ecs-reviewed-catalog.js';
import { buildReviewedProductShardRelease } from './build-reviewed-product-shards.mjs';
import { bundleF8xOverlayRelease } from './bundle-f8x-overlay-release.mjs';

const NOW = Date.parse('2026-08-20T12:30:00.000Z');
const MANIFEST_SIGNING_FIXTURE = 'f8x-overlay-runtime-test-secret-'.repeat(2);
const SECTIONS = ['braking', 'engine', 'exterior', 'interior', 'performance', 'suspension', 'steering'];
const QUARANTINE = ['4017812', '4630189', '4715378'];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  function normalize(item) {
    if (item === null || typeof item !== 'object') return item;
    if (Array.isArray(item)) return item.map(normalize);
    return Object.fromEntries(Object.keys(item).sort().filter(key => item[key] !== undefined)
      .map(key => [key, normalize(item[key])]));
  }
  return JSON.stringify(normalize(value));
}

function dataSha256(value) {
  return sha256(Buffer.from(stableJson(value), 'utf8'));
}

function jsonBuffer(value, pretty = false) {
  return Buffer.from(`${JSON.stringify(value, null, pretty ? 2 : 0)}\n`, 'utf8');
}

function baseProduct(overrides = {}) {
  return {
    publicKey: 'ecs-es-7000001',
    slug: 'es-7000001',
    title: 'Reviewed base brake product',
    titleAr: null,
    brand: 'ECS Tuning',
    brandSlug: 'ecs-tuning',
    category: 'Braking Parts',
    categorySlug: 'bmw-m3-braking',
    subcategory: 'Brake Pads',
    subcategorySlug: 'bmw-m3-braking-pads',
    ecsPartNumber: 'ES#7000001',
    sku: 'ES#7000001',
    mpn: 'BASE-7000001',
    originalUrl: 'https://www.ecstuning.com/b-base-parts/reviewed-product/es7000001/',
    priceAmount: 100,
    priceCurrency: 'USD',
    priceVerifiedAt: '2026-08-20',
    checkedAt: '2026-08-20',
    staleAfterDays: 7,
    stockPolicy: 'manual-confirm',
    availabilityCode: 'check_availability',
    fitmentConfidence: 'possible',
    fitments: [{
      make: 'BMW', model: 'M3', models: ['M3'], generation: null,
      chassis: [], engines: [], confidence: 'possible'
    }],
    filters: {
      categories: ['bmw-m3', 'bmw-m3-braking'],
      subcategories: ['bmw-m3-braking-pads']
    },
    selectionSources: [{ section: 'Braking', category: 'Brake Pads' }],
    relatedProductSlugs: [],
    ...overrides
  };
}

function baseRoute(product, sequence = 1, shardProductIndex = 0) {
  return {
    ...product,
    shardedRoute: true,
    shardSequence: sequence,
    shardProductIndex,
    searchDocument: `${product.title} ${product.ecsPartNumber}`
  };
}

function f8xProduct(identity = '7000001', overrides = {}) {
  const model = overrides.profile === 'f80-m3' ? 'M3' : 'M4';
  const chassis = overrides.profile === 'f80-m3' ? 'F80'
    : overrides.profile === 'f83-m4' ? 'F83' : 'F82';
  const profile = overrides.profile || 'f82-m4';
  const mpn = identity === '7000001' ? 'BASE-7000001' : `F8X-${identity}`;
  const originalUrl = identity === '7000001'
    ? 'https://www.ecstuning.com/b-base-parts/reviewed-product/es7000001/'
    : `https://www.ecstuning.com/b-f8x-parts/reviewed-product/es${identity}/`;
  const fields = { ...overrides };
  delete fields.profile;
  return {
    publicKey: `ecs-es-${identity}`,
    slug: `es-${identity}`,
    title: `F8X reviewed product ${identity}`,
    titleAr: null,
    brand: 'ECS Tuning',
    brandSlug: 'ecs-tuning',
    category: 'F8X Braking',
    categorySlug: 'bmw-f8x-braking',
    subcategory: 'F8X Brake Pads',
    subcategorySlug: 'bmw-f8x-braking-brake-pads',
    catalogType: 'product',
    provider: 'ECS Tuning',
    providerSlug: 'ecs',
    dataOrigin: 'authorized-public-ecs-f8x-vehicle-category-review',
    ecsPartNumber: `ES#${identity}`,
    sku: `ES#${identity}`,
    mpn,
    identifiers: { ecs: `ES#${identity}`, sku: `ES#${identity}`, mpn },
    originalUrl,
    description: `Full reviewed F8X evidence for ES#${identity}.`,
    priceAmount: 110,
    priceCurrency: 'USD',
    priceVerifiedAt: '2026-08-20',
    checkedAt: '2026-08-20',
    stockObservedAt: '2026-08-20',
    staleAfterDays: 7,
    stockPolicy: 'manual-confirm',
    availabilityCode: 'check_availability',
    fitmentStatus: 'supplier-vehicle-category-confirm',
    fitmentConfidence: 'possible',
    fitments: [{
      make: 'BMW', model, models: [model], generation: chassis,
      chassis: [chassis], yearFrom: null, yearTo: null, trim: null,
      engines: ['S55'], drivetrains: [], options: [], confidence: 'possible',
      evidence: 'ecs-exact-f8x-vehicle-category'
    }],
    filters: {
      categories: ['bmw-f8x', profile, 'bmw-f8x-braking'],
      subcategories: ['bmw-f8x-braking-brake-pads'],
      supplier: ['ecs'], makes: ['BMW'], models: [model], chassis: [chassis],
      years: [], engines: ['S55'], drivetrains: [],
      availability: ['confirmation-required'], fitment: ['possible']
    },
    selectionSources: [{
      vehicleKey: profile, vehicle: `BMW ${chassis} ${model} S55 3.0L`,
      section: 'Braking', category: 'Brake Pads', categoryKey: 'brake-pads',
      sourceUrl: `https://www.ecstuning.com/bmw-${chassis.toLowerCase()}-${model.toLowerCase()}/braking/`,
      relevancePosition: 1, observedAt: '2026-08-20T12:15:00.000Z'
    }],
    options: [],
    variants: [],
    relatedProductSlugs: [],
    ...fields
  };
}

function overlayRoute(product, index) {
  return {
    ...product,
    filters: {
      categories: product.filters.categories,
      subcategories: product.filters.subcategories
    },
    shardedRoute: true,
    shardSequence: 1,
    shardProductIndex: index,
    searchDocument: `${product.title} ${product.ecsPartNumber}`
  };
}

async function writeBaseRelease(root, product = baseProduct()) {
  const releaseId = '20260820T120000000Z-1111111111111111';
  const shardDocument = {
    schemaVersion: 1, supplier: 'ECS Tuning', kind: 'ecs-reviewed-product-shard',
    releaseId, sequence: 1, productCount: 1, products: [product]
  };
  const shardBuffer = jsonBuffer(shardDocument);
  const route = baseRoute(product);
  const index = {
    schemaVersion: 1, supplier: 'ECS Tuning', kind: 'ecs-reviewed-product-routing-index',
    releaseId, routeCount: 1, routes: [route]
  };
  const indexBuffer = jsonBuffer(index);
  const shardDescriptor = {
    sequence: 1, file: 'shard-00001.json', productCount: 1,
    bytes: shardBuffer.length, sha256: sha256(shardBuffer),
    firstKey: product.publicKey, lastKey: product.publicKey
  };
  const sectionState = Object.fromEntries(SECTIONS.map(key => [key, {
    complete: true, included: true, capturedPages: 1, expectedPages: 1,
    capturedPlacements: 1, expectedPlacements: 1, productCount: key === 'braking' ? 1 : 0
  }]));
  const manifest = {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    kind: 'ecs-reviewed-product-shard-manifest',
    releaseId,
    generatedAt: '2026-08-20T12:00:00.000Z',
    publicationMode: 'complete',
    complete: true,
    requestedSections: [...SECTIONS],
    includedSections: [...SECTIONS],
    excludedSections: [],
    sections: sectionState,
    counts: { productCount: 1, routeCount: 1, shardCount: 1, quarantinedIdentityCount: 0 },
    index: { file: 'index.json', bytes: indexBuffer.length, sha256: sha256(indexBuffer) },
    shards: [shardDescriptor],
    contentSetSha256: sha256(Buffer.from([
      `index.json\0${indexBuffer.length}\0${sha256(indexBuffer)}`,
      `shard-00001.json\0${shardBuffer.length}\0${sha256(shardBuffer)}`
    ].join('\n'), 'utf8'))
  };
  const manifestBuffer = jsonBuffer(manifest, true);
  await Promise.all([
    writeFile(path.join(root, 'manifest.json'), manifestBuffer),
    writeFile(path.join(root, 'index.json'), indexBuffer),
    writeFile(path.join(root, 'shard-00001.json'), shardBuffer)
  ]);
  const descriptors = [
    { file: 'manifest.json', bytes: manifestBuffer.length, sha256: sha256(manifestBuffer) },
    { file: 'index.json', bytes: indexBuffer.length, sha256: sha256(indexBuffer) },
    { file: 'shard-00001.json', bytes: shardBuffer.length, sha256: sha256(shardBuffer) }
  ].sort((left, right) => left.file.localeCompare(right.file, 'en'));
  return {
    manifest,
    product,
    indexBuffer,
    shardBuffer,
    binding: {
      releaseId,
      manifestSha256: sha256(manifestBuffer),
      contentSetSha256: manifest.contentSetSha256,
      artifactSetSha256: dataSha256(descriptors),
      productCount: 1,
      routeCount: 1,
      shardCount: 1,
      quarantinedIdentityCount: 0,
      productsSha256: dataSha256([product])
    }
  };
}

async function writeOverlayRelease(root, baseRelease, {
  products = [f8xProduct(), f8xProduct('7000002')],
  manifestTransform = value => value
} = {}) {
  const releaseId = '20260820T121500000Z-2222222222222222';
  const shardDocument = {
    schemaVersion: 1, supplier: 'ECS Tuning', kind: ECS_REVIEWED_F8X_OVERLAY_SHARD_KIND,
    releaseId, sequence: 1, productCount: products.length, products
  };
  const shardBuffer = jsonBuffer(shardDocument);
  const routes = products.map(overlayRoute);
  const index = {
    schemaVersion: 1, supplier: 'ECS Tuning', kind: ECS_REVIEWED_F8X_OVERLAY_INDEX_KIND,
    releaseId, routeCount: routes.length, routes
  };
  const indexBuffer = jsonBuffer(index);
  const shardDescriptor = {
    sequence: 1, file: 'shard-00001.json', productCount: products.length,
    bytes: shardBuffer.length, sha256: sha256(shardBuffer),
    firstKey: products[0].publicKey, lastKey: products.at(-1).publicKey
  };
  const manifest = manifestTransform({
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    kind: ECS_REVIEWED_F8X_OVERLAY_MANIFEST_KIND,
    releaseId,
    generatedAt: '2026-08-20T12:15:00.000Z',
    publicationMode: 'complete',
    complete: true,
    overlayScope: {
      kind: ECS_REVIEWED_F8X_OVERLAY_SCOPE.kind,
      profiles: [...ECS_REVIEWED_F8X_OVERLAY_SCOPE.profiles],
      chassis: [...ECS_REVIEWED_F8X_OVERLAY_SCOPE.chassis],
      sections: [...ECS_REVIEWED_F8X_OVERLAY_SCOPE.sections],
      complete: true
    },
    baseRelease: { ...baseRelease.binding },
    finalAudit: {
      kind: 'ecs-f8x-final-release-audit-verification',
      inputSetSha256: 'a'.repeat(64),
      aggregateModuleSha256: 'b'.repeat(64)
    },
    projectedQuarantine: {
      identities: [...QUARANTINE],
      identityCount: QUARANTINE.length,
      identitiesSha256: dataSha256(QUARANTINE)
    },
    counts: {
      productCount: products.length,
      routeCount: products.length,
      shardCount: 1,
      quarantinedIdentityCount: QUARANTINE.length
    },
    index: { file: 'index.json', bytes: indexBuffer.length, sha256: sha256(indexBuffer) },
    shards: [shardDescriptor],
    contentSetSha256: sha256(Buffer.from([
      `index.json\0${indexBuffer.length}\0${sha256(indexBuffer)}`,
      `shard-00001.json\0${shardBuffer.length}\0${sha256(shardBuffer)}`
    ].join('\n'), 'utf8'))
  });
  const manifestBuffer = jsonBuffer(manifest, true);
  await Promise.all([
    writeFile(path.join(root, 'manifest.json'), manifestBuffer),
    writeFile(path.join(root, 'index.json'), indexBuffer),
    writeFile(path.join(root, 'shard-00001.json'), shardBuffer)
  ]);
  return { manifest, manifestBuffer, indexBuffer, shardBuffer, products };
}

function request(overrides = {}) {
  return {
    mode: 'browse', query: null, sort: 'name_asc', availability: 'all', pricing: 'all',
    match: 'any', supplier: 'ecs', brand: null, partType: null, currency: 'USD',
    fitment: 'all', year: null, make: null, model: null, generation: null, engine: null,
    structuredVehicle: false, page: 1, offset: 0, positionSource: 'page', ...overrides
  };
}

async function fixture(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'projx-f8x-overlay-runtime-'));
  const baseRoot = path.join(root, 'base');
  const overlayRoot = path.join(root, 'overlay');
  await Promise.all([
    mkdir(baseRoot, { recursive: true }), mkdir(overlayRoot, { recursive: true })
  ]);
  const base = await writeBaseRelease(baseRoot, options.baseProduct || baseProduct());
  const overlay = await writeOverlayRelease(overlayRoot, base, options.overlay || {});
  return { root, baseRoot, overlayRoot, base, overlay };
}

function remoteOverlayFixture(current, {
  host = 'f8x-runtime-test.public.blob.vercel-storage.com',
  publishedAt = '2026-08-20T12:20:00.000Z',
  expiresAt = '2026-08-27T12:20:00.000Z'
} = {}) {
  const prefix = `https://${host}/projx-racing/f8x/${current.overlay.manifest.releaseId}/`;
  const manifest = {
    ...current.overlay.manifest,
    index: {
      url: `${prefix}index.json`,
      bytes: current.overlay.manifest.index.bytes,
      sha256: current.overlay.manifest.index.sha256
    },
    shards: current.overlay.manifest.shards.map(descriptor => ({
      sequence: descriptor.sequence,
      url: `${prefix}${descriptor.file}`,
      productCount: descriptor.productCount,
      bytes: descriptor.bytes,
      sha256: descriptor.sha256,
      firstKey: descriptor.firstKey,
      lastKey: descriptor.lastKey
    })),
    publishedAt,
    expiresAt
  };
  manifest.signature = signReviewedShardManifest(manifest, MANIFEST_SIGNING_FIXTURE);
  const currentUrl = `https://${host}/projx-racing/f8x/current.json`;
  const documents = new Map([
    [currentUrl, jsonBuffer(manifest)],
    [manifest.index.url, current.overlay.indexBuffer],
    [manifest.shards[0].url, current.overlay.shardBuffer]
  ]);
  const calls = [];
  const fetchImpl = async url => {
    calls.push(String(url));
    const body = documents.get(String(url));
    return body
      ? new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/json', 'content-length': String(body.length) }
      })
      : new Response('missing', { status: 404, headers: { 'content-type': 'text/plain' } });
  };
  return { manifest, currentUrl, documents, calls, fetchImpl };
}

function remoteBaseFixture(current, {
  host = 'f8x-base-runtime-test.public.blob.vercel-storage.com',
  publishedAt = '2026-08-20T12:20:00.000Z',
  expiresAt = '2026-08-27T12:20:00.000Z'
} = {}) {
  const prefix = `https://${host}/projx-racing/base/${current.base.manifest.releaseId}/`;
  const manifest = {
    ...current.base.manifest,
    index: {
      url: `${prefix}index.json`,
      bytes: current.base.manifest.index.bytes,
      sha256: current.base.manifest.index.sha256
    },
    shards: current.base.manifest.shards.map(descriptor => ({
      sequence: descriptor.sequence,
      url: `${prefix}${descriptor.file}`,
      productCount: descriptor.productCount,
      bytes: descriptor.bytes,
      sha256: descriptor.sha256,
      firstKey: descriptor.firstKey,
      lastKey: descriptor.lastKey
    })),
    publishedAt,
    expiresAt
  };
  manifest.signature = signReviewedShardManifest(manifest, MANIFEST_SIGNING_FIXTURE);
  const currentUrl = `https://${host}/projx-racing/base/current.json`;
  const documents = new Map([
    [currentUrl, jsonBuffer(manifest)],
    [manifest.index.url, current.base.indexBuffer],
    [manifest.shards[0].url, current.base.shardBuffer]
  ]);
  const calls = [];
  const fetchImpl = async url => {
    calls.push(String(url));
    const body = documents.get(String(url));
    return body
      ? new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/json', 'content-length': String(body.length) }
      })
      : new Response('missing', { status: 404, headers: { 'content-type': 'text/plain' } });
  };
  return { manifest, currentUrl, documents, calls, fetchImpl };
}

function completeF8xAudit(products) {
  return {
    kind: 'ecs-f8x-aggregate-import-audit',
    generatedAt: '2026-08-20T12:15:00.000Z',
    quarantinedIdentityCount: QUARANTINE.length,
    sections: Object.fromEntries(SECTIONS.map(section => [section, {
      productCount: products.filter(product => product.selectionSources.some(source => (
        source.section.toLowerCase() === section
      ))).length
    }])),
    captureProgress: {
      complete: true,
      includedSections: [...SECTIONS],
      sections: Object.fromEntries(SECTIONS.map(section => [section, {
        complete: true,
        capturedPages: 3,
        expectedPages: 3,
        capturedPlacements: 10,
        expectedPlacements: 10
      }]))
    }
  };
}

async function writeBuiltRelease(root, release) {
  await Promise.all([
    writeFile(path.join(root, 'manifest.json'), jsonBuffer(release.manifest, true)),
    writeFile(path.join(root, 'index.json'), release.indexBuffer),
    ...release.shards.map(shard => writeFile(path.join(root, shard.file), shard.buffer))
  ]);
}

test('a distinct F8X release merges after static and base, preserving handles and manual confirmation', async (t) => {
  const current = await fixture();
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const staticReviewed = baseProduct({
    publicKey: 'ecs-curated-stable-handle',
    slug: 'curated-stable-handle',
    title: 'Static reviewed brake product'
  });
  const provider = createReviewedShardCatalogueProvider({
    localManifestPath: path.join(current.baseRoot, 'manifest.json'),
    f8xOverlay: { localManifestPath: path.join(current.overlayRoot, 'manifest.json') },
    now: () => NOW
  });
  const prepared = await provider.prepareProducts({
    request: request({ generation: 'F82', engine: 'S55', structuredVehicle: true }),
    baseProducts: [staticReviewed],
    nowValue: NOW
  });
  assert.equal(prepared.products.length, 2);
  const overlap = prepared.products.find(product => product.ecsPartNumber === 'ES#7000001');
  assert.equal(overlap.publicKey, staticReviewed.publicKey);
  assert.equal(overlap.slug, staticReviewed.slug);
  assert.equal(overlap.stockPolicy, 'manual-confirm');
  assert.equal(overlap.availabilityCode, 'check_availability');
  assert.equal(overlap.fitmentConfidence, 'possible');
  assert.ok(overlap.fitments.some(fitment => fitment.chassis?.includes('F82')));
  assert.ok(overlap.fitments.every(fitment => fitment.confidence === 'possible'));
  assert.ok(overlap.filters.categories.includes('bmw-f8x-braking'));
  assert.equal(prepared.status.schemaVersion, 3);
  assert.equal(prepared.status.publishedProductCount, 2);
  assert.equal(prepared.status.quarantinedIdentityCount, QUARANTINE.length);
  assert.equal(prepared.status.f8xOverlayExistingProductCount, 1);
  assert.equal(prepared.status.f8xOverlayNewUniqueProductCount, 1);
  assert.equal(prepared.status.f8xOverlayRelease.baseReleaseId, current.base.manifest.releaseId);
  assert.equal(prepared.loadedShardCount, 1);
  assert.equal(prepared.loadedOverlayShardCount, 1);
});

test('post-merge F8X policy stays fail-closed and cached product snapshots are deeply immutable', async (t) => {
  const current = await fixture();
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const newerStatic = baseProduct({
    publicKey: 'ecs-curated-stable-handle',
    slug: 'curated-stable-handle',
    checkedAt: '2026-08-21',
    stockObservedAt: '2026-08-21',
    stockPolicy: 'verified-stock',
    availabilityCode: 'in_stock',
    purchaseMode: 'buy-now',
    status: 'In Stock',
    statusAr: 'In Stock',
    observedAvailability: 'In Stock',
    observedAvailabilityAr: 'In Stock',
    availabilityNote: 'In Stock and ready to order.',
    stockNote: 'In Stock now.',
    availabilityText: 'In Stock',
    stockStatus: 'in-stock',
    stockQuantity: 12,
    inStock: true,
    fitmentConfidence: 'exact',
    fitmentStatus: 'verified-exact',
    fitments: [
      {
        make: 'BMW', model: 'M4', models: ['M4'], generation: 'F82',
        chassis: ['F82'], yearFrom: 2015, yearTo: 2020, trim: 'Competition',
        engines: ['S55'], drivetrains: ['RWD'], options: ['Competition Package'],
        confidence: 'exact', evidence: 'foreign-exact-fitment-claim',
        note: 'Exact fitment guaranteed.'
      },
      {
        make: 'BMW', model: 'M4', models: ['M4'], generation: 'G82',
        chassis: ['G82'], yearFrom: 2021, yearTo: null, trim: null,
        engines: ['S58'], drivetrains: ['RWD'], options: [],
        confidence: 'possible', evidence: 'trusted-independent-g82-evidence'
      }
    ],
    filters: {
      categories: ['bmw-m3', 'bmw-m3-braking'],
      subcategories: ['bmw-m3-braking-pads'],
      availability: ['in-stock'],
      fitment: ['exact'],
      years: ['2015', '2020'],
      drivetrains: ['RWD']
    },
    sourceObservations: [{
      sourceUrl: 'https://www.ecstuning.com/b-base-parts/reviewed-product/es7000001/',
      observedAt: '2026-08-21T10:00:00.000Z',
      availability: 'In Stock',
      availabilityText: 'In Stock',
      stockStatus: 'in-stock',
      publicUsdPrice: 100
    }]
  });
  const staticProducts = [newerStatic];
  const provider = createReviewedShardCatalogueProvider({
    localManifestPath: path.join(current.baseRoot, 'manifest.json'),
    f8xOverlay: { localManifestPath: path.join(current.overlayRoot, 'manifest.json') },
    now: () => NOW
  });

  const first = await provider.prepareProducts({
    request: request(), baseProducts: staticProducts, nowValue: NOW
  });
  const overlap = first.products.find(product => product.ecsPartNumber === 'ES#7000001');
  assert.equal(overlap.publicKey, newerStatic.publicKey);
  assert.equal(overlap.slug, newerStatic.slug);
  assert.equal(overlap.stockPolicy, 'manual-confirm');
  assert.equal(overlap.availabilityCode, 'check_availability');
  assert.equal(overlap.fitmentConfidence, 'possible');
  assert.equal(overlap.fitmentStatus, 'supplier-vehicle-category-confirm');
  assert.equal(overlap.purchaseMode, 'fitment-confirmation-required');
  assert.equal(overlap.status, 'Supplier status — confirmation required');
  assert.equal(overlap.observedAvailability, null);
  assert.equal(overlap.observedAvailabilityAr, null);
  assert.deepEqual(overlap.filters.availability, ['confirmation-required']);
  assert.deepEqual(overlap.filters.fitment, ['possible']);
  assert.ok(overlap.fitments.every(fitment => fitment.confidence === 'possible'));
  const f82Fitments = overlap.fitments.filter(fitment => fitment.generation === 'F82');
  assert.equal(f82Fitments.length, 1);
  assert.equal(f82Fitments[0].evidence, 'ecs-exact-f8x-vehicle-category');
  assert.equal(f82Fitments[0].yearFrom, null);
  assert.equal(f82Fitments[0].yearTo, null);
  assert.equal(f82Fitments[0].trim, null);
  assert.deepEqual(f82Fitments[0].drivetrains, []);
  assert.deepEqual(f82Fitments[0].options, []);
  const unrelatedG82 = overlap.fitments.find(fitment => fitment.generation === 'G82');
  assert.equal(unrelatedG82.evidence, 'trusted-independent-g82-evidence');
  assert.equal(unrelatedG82.yearFrom, 2021);
  assert.deepEqual(unrelatedG82.drivetrains, ['RWD']);
  assert.equal(Object.hasOwn(overlap, 'availabilityText'), false);
  assert.equal(Object.hasOwn(overlap, 'stockStatus'), false);
  assert.equal(Object.hasOwn(overlap, 'stockQuantity'), false);
  assert.equal(Object.hasOwn(overlap, 'inStock'), false);
  assert.equal(Object.hasOwn(overlap.sourceObservations[0], 'availability'), false);
  assert.equal(Object.hasOwn(overlap.sourceObservations[0], 'availabilityText'), false);
  assert.equal(Object.hasOwn(overlap.sourceObservations[0], 'stockStatus'), false);
  assert.equal(overlap.sourceObservations[0].publicUsdPrice, 100);
  assert.equal(JSON.stringify(overlap).toLowerCase().includes('in stock'), false);
  assert.ok(Object.isFrozen(first.products));
  assert.ok(Object.isFrozen(overlap));
  assert.ok(Object.isFrozen(overlap.fitments));
  assert.ok(Object.isFrozen(overlap.fitments[0]));
  assert.ok(Object.isFrozen(overlap.fitments[0].chassis));
  assert.throws(() => { overlap.publicKey = 'poisoned-handle'; }, TypeError);
  assert.throws(() => { overlap.fitments[0].chassis.push('G82'); }, TypeError);

  const second = await provider.prepareProducts({
    request: request(), baseProducts: staticProducts, nowValue: NOW
  });
  const cachedOverlap = second.products.find(product => product.ecsPartNumber === 'ES#7000001');
  assert.equal(cachedOverlap.publicKey, newerStatic.publicKey);
  assert.deepEqual(cachedOverlap.fitments.flatMap(fitment => fitment.chassis || []).sort(), ['F82', 'G82']);
  assert.equal(newerStatic.publicKey, 'ecs-curated-stable-handle');
  assert.deepEqual(newerStatic.fitments[0].chassis, ['F82']);
});

test('the reviewed shard builder output is accepted and bundles deterministically', async (t) => {
  const current = await fixture();
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const products = [f8xProduct(), f8xProduct('7000002')];
  const contract = {
    overlayScope: {
      kind: ECS_REVIEWED_F8X_OVERLAY_SCOPE.kind,
      profiles: [...ECS_REVIEWED_F8X_OVERLAY_SCOPE.profiles],
      chassis: [...ECS_REVIEWED_F8X_OVERLAY_SCOPE.chassis],
      sections: [...ECS_REVIEWED_F8X_OVERLAY_SCOPE.sections],
      complete: true
    },
    baseRelease: { ...current.base.binding },
    finalAudit: {
      kind: 'ecs-f8x-final-release-audit-verification',
      inputSetSha256: 'a'.repeat(64),
      aggregateModuleSha256: 'b'.repeat(64)
    },
    projectedQuarantine: {
      identities: [...QUARANTINE],
      identityCount: QUARANTINE.length,
      identitiesSha256: dataSha256(QUARANTINE)
    }
  };
  const built = buildReviewedProductShardRelease(
    products,
    completeF8xAudit(products),
    { shardSize: 32, f8xOverlayContract: contract }
  );
  await writeBuiltRelease(current.overlayRoot, built);
  const provider = createReviewedShardCatalogueProvider({
    localManifestPath: path.join(current.baseRoot, 'manifest.json'),
    f8xOverlay: { localManifestPath: path.join(current.overlayRoot, 'manifest.json') },
    now: () => NOW
  });
  const prepared = await provider.prepareProducts({ request: request(), baseProducts: [], nowValue: NOW });
  assert.equal(prepared.products.length, 2);
  assert.equal(prepared.status.f8xOverlayRelease.releaseId, built.manifest.releaseId);
  assert.equal(prepared.status.f8xOverlayExistingProductCount, 1);
  assert.equal(prepared.status.f8xOverlayNewUniqueProductCount, 1);

  const manifestBuffer = jsonBuffer(built.manifest, true);
  await writeFile(
    path.join(current.overlayRoot, 'manifest.json.sha256'),
    `${sha256(manifestBuffer)}  manifest.json\n`
  );
  const firstBundleRoot = path.join(current.root, 'bundle-a');
  const secondBundleRoot = path.join(current.root, 'bundle-b');
  const firstSummary = await bundleF8xOverlayRelease({
    sourceDirectory: current.overlayRoot,
    outputDirectory: firstBundleRoot
  });
  const secondSummary = await bundleF8xOverlayRelease({
    sourceDirectory: current.overlayRoot,
    outputDirectory: secondBundleRoot
  });
  assert.deepEqual(firstSummary, secondSummary);
  assert.equal(firstSummary.productCount, 2);
  assert.equal(firstSummary.shardCount, 1);

  const bundledFiles = (await readdir(firstBundleRoot)).sort();
  assert.deepEqual(bundledFiles, [
    'bundle-summary.json',
    'index.json.gz',
    'manifest.json',
    'shard-00001.json.gz'
  ]);
  for (const filename of bundledFiles) {
    assert.deepEqual(
      await readFile(path.join(firstBundleRoot, filename)),
      await readFile(path.join(secondBundleRoot, filename))
    );
  }
  assert.deepEqual(
    gunzipSync(await readFile(path.join(firstBundleRoot, 'index.json.gz'))),
    built.indexBuffer
  );
  assert.deepEqual(
    gunzipSync(await readFile(path.join(firstBundleRoot, 'shard-00001.json.gz'))),
    built.shards[0].buffer
  );
});

test('base-release, scope and projected-quarantine bindings fail closed', async (t) => {
  const mismatchedBase = await fixture({
    overlay: {
      manifestTransform: manifest => ({
        ...manifest,
        baseRelease: { ...manifest.baseRelease, productsSha256: 'c'.repeat(64) }
      })
    }
  });
  t.after(() => rm(mismatchedBase.root, { recursive: true, force: true }));
  const baseProvider = createReviewedShardCatalogueProvider({
    localManifestPath: path.join(mismatchedBase.baseRoot, 'manifest.json'),
    f8xOverlay: { localManifestPath: path.join(mismatchedBase.overlayRoot, 'manifest.json') },
    now: () => NOW
  });
  await assert.rejects(() => baseProvider.getStatus([]), error => error?.code === 'f8x_overlay_base_release_mismatch');

  const badScope = await fixture({
    overlay: {
      manifestTransform: manifest => ({
        ...manifest,
        overlayScope: { ...manifest.overlayScope, chassis: ['F80', 'F82'] }
      })
    }
  });
  t.after(() => rm(badScope.root, { recursive: true, force: true }));
  const scopeProvider = createReviewedShardCatalogueProvider({
    localManifestPath: path.join(badScope.baseRoot, 'manifest.json'),
    f8xOverlay: { localManifestPath: path.join(badScope.overlayRoot, 'manifest.json') },
    now: () => NOW
  });
  await assert.rejects(() => scopeProvider.getStatus([]), error => error?.code === 'invalid_f8x_overlay_manifest');

  const badQuarantine = await fixture({
    overlay: {
      manifestTransform: manifest => ({
        ...manifest,
        projectedQuarantine: { ...manifest.projectedQuarantine, identitiesSha256: 'd'.repeat(64) }
      })
    }
  });
  t.after(() => rm(badQuarantine.root, { recursive: true, force: true }));
  const quarantineProvider = createReviewedShardCatalogueProvider({
    localManifestPath: path.join(badQuarantine.baseRoot, 'manifest.json'),
    f8xOverlay: { localManifestPath: path.join(badQuarantine.overlayRoot, 'manifest.json') },
    now: () => NOW
  });
  await assert.rejects(() => quarantineProvider.getStatus([]), error => error?.code === 'invalid_f8x_overlay_quarantine');
});

test('MPN, canonical URL and public-handle conflicts fail before the overlay is exposed', async (t) => {
  for (const [name, products] of [
    ['MPN', [f8xProduct('7000001', {
      mpn: 'CONFLICTING-MPN',
      identifiers: { ecs: 'ES#7000001', sku: 'ES#7000001', mpn: 'CONFLICTING-MPN' }
    })]],
    ['URL', [f8xProduct('7000001', {
      originalUrl: 'https://www.ecstuning.com/b-other-parts/conflicting-product/es7000001/'
    })]],
    ['handle', [f8xProduct('7000002', { publicKey: 'ecs-es-7000001', slug: 'es-7000001' })]]
  ]) {
    await t.test(name, async t2 => {
      const current = await fixture({ overlay: { products } });
      t2.after(() => rm(current.root, { recursive: true, force: true }));
      const provider = createReviewedShardCatalogueProvider({
        localManifestPath: path.join(current.baseRoot, 'manifest.json'),
        f8xOverlay: { localManifestPath: path.join(current.overlayRoot, 'manifest.json') },
        now: () => NOW
      });
      await assert.rejects(() => provider.getStatus([]), error => [
        'f8x_overlay_identity_conflict', 'invalid_f8x_overlay_index',
        'invalid_f8x_overlay_shard', 'invalid_f8x_overlay_scope'
      ].includes(error?.code));
    });
  }
});

test('conflicting identifiers and cross-profile or foreign-make evidence fail closed', async (t) => {
  const conflictingIdentifiers = f8xProduct('7000002');
  conflictingIdentifiers.identifiers = {
    ...conflictingIdentifiers.identifiers,
    ecs: 'ES#7999999'
  };
  const crossProfile = f8xProduct('7000002', { profile: 'f80-m3' });
  crossProfile.fitments = [{
    make: 'Audi', model: 'M4', models: ['M4'], generation: 'G82',
    chassis: ['F80'], yearFrom: null, yearTo: null, trim: null,
    engines: ['S55'], drivetrains: [], options: [], confidence: 'possible',
    evidence: 'ecs-exact-f8x-vehicle-category'
  }];
  const foreignMakeFilter = f8xProduct('7000002', { profile: 'f80-m3' });
  foreignMakeFilter.filters = { ...foreignMakeFilter.filters, makes: ['Audi'] };

  for (const [name, product] of [
    ['secondary ECS identifier', conflictingIdentifiers],
    ['cross-profile fitment', crossProfile],
    ['foreign make filter', foreignMakeFilter]
  ]) {
    await t.test(name, async t2 => {
      const current = await fixture({ overlay: { products: [product] } });
      t2.after(() => rm(current.root, { recursive: true, force: true }));
      const provider = createReviewedShardCatalogueProvider({
        localManifestPath: path.join(current.baseRoot, 'manifest.json'),
        f8xOverlay: { localManifestPath: path.join(current.overlayRoot, 'manifest.json') },
        now: () => NOW
      });
      await assert.rejects(
        () => provider.getStatus([]),
        error => error?.code === 'invalid_f8x_overlay_scope'
      );
    });
  }
});

test('projected quarantine removes all three authorized static identities and preserves every other handle', async (t) => {
  const current = await fixture();
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const provider = createReviewedShardCatalogueProvider({
    localManifestPath: path.join(current.baseRoot, 'manifest.json'),
    f8xOverlay: { localManifestPath: path.join(current.overlayRoot, 'manifest.json') },
    now: () => NOW
  });
  const quarantinedStatic = QUARANTINE.map(identity => baseProduct({
    publicKey: `ecs-static-quarantined-${identity}`,
    slug: `static-quarantined-${identity}`,
    title: `Static quarantined ES#${identity}`,
    ecsPartNumber: `ES#${identity}`,
    sku: `ES#${identity}`,
    mpn: `QUARANTINED-${identity}`,
    originalUrl: `https://www.ecstuning.com/b-static/es${identity}/`
  }));
  const survivingStatic = baseProduct({
    publicKey: 'ecs-static-surviving-handle',
    slug: 'static-surviving-handle',
    title: 'Static surviving reviewed product',
    ecsPartNumber: 'ES#7999999',
    sku: 'ES#7999999',
    mpn: 'STATIC-SURVIVOR',
    originalUrl: 'https://www.ecstuning.com/b-static/es7999999/',
    relatedProductSlugs: [
      quarantinedStatic[0].publicKey,
      quarantinedStatic[0].slug,
      `ecs-es-${QUARANTINE[1]}`,
      `es-${QUARANTINE[2]}`,
      'safe-related-handle'
    ]
  });
  const prepared = await provider.prepareProducts({
    request: request(), baseProducts: [...quarantinedStatic, survivingStatic], nowValue: NOW
  });
  assert.equal(prepared.status.preQuarantineUniqueProductCount, 6);
  assert.equal(prepared.status.publishedProductCount, 3);
  assert.equal(prepared.products.some(product => QUARANTINE.includes(
    String(product.ecsPartNumber || '').replace(/\D/g, '')
  )), false);
  const surviving = prepared.products.find(product => product.ecsPartNumber === 'ES#7999999');
  assert.equal(surviving.publicKey, survivingStatic.publicKey);
  assert.equal(surviving.slug, survivingStatic.slug);
  assert.deepEqual(surviving.relatedProductSlugs, ['safe-related-handle']);
  const baseOverlap = prepared.products.find(product => product.ecsPartNumber === 'ES#7000001');
  assert.equal(baseOverlap.publicKey, current.base.product.publicKey);
  assert.equal(baseOverlap.slug, current.base.product.slug);
});

test('projected quarantine checks every populated ECS identity carrier and scrubs its aliases', async (t) => {
  const current = await fixture();
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const contaminatedSku = baseProduct({
    publicKey: 'ecs-secondary-sku-quarantine-handle',
    slug: 'secondary-sku-quarantine-handle',
    title: 'Secondary SKU quarantine carrier',
    ecsPartNumber: 'ES#7999999',
    sku: `ES#${QUARANTINE[0]}`,
    mpn: 'SECONDARY-SKU-QUARANTINE',
    identifiers: {
      ecs: 'ES#7999999', sku: `ES#${QUARANTINE[0]}`, mpn: 'SECONDARY-SKU-QUARANTINE'
    },
    originalUrl: 'https://www.ecstuning.com/b-static/secondary-sku-quarantine/es7999999/'
  });
  const contaminatedIdentifier = baseProduct({
    publicKey: 'ecs-secondary-identifier-quarantine-handle',
    slug: 'secondary-identifier-quarantine-handle',
    title: 'Secondary identifier quarantine carrier',
    ecsPartNumber: 'ES#7999998',
    sku: 'ES#7999998',
    mpn: 'SECONDARY-IDENTIFIER-QUARANTINE',
    identifiers: {
      ecs: `ES#${QUARANTINE[1]}`, sku: 'ES#7999998', mpn: 'SECONDARY-IDENTIFIER-QUARANTINE'
    },
    originalUrl: 'https://www.ecstuning.com/b-static/secondary-identifier-quarantine/es7999998/'
  });
  const safe = baseProduct({
    publicKey: 'ecs-secondary-carrier-safe-handle',
    slug: 'secondary-carrier-safe-handle',
    title: 'Safe secondary-carrier neighbour',
    ecsPartNumber: 'ES#7999997',
    sku: 'ES#7999997',
    mpn: 'SECONDARY-CARRIER-SAFE',
    originalUrl: 'https://www.ecstuning.com/b-static/secondary-carrier-safe/es7999997/',
    relatedProductSlugs: [
      contaminatedSku.publicKey,
      contaminatedSku.slug,
      contaminatedIdentifier.publicKey,
      contaminatedIdentifier.slug,
      'safe-related-handle'
    ]
  });
  const provider = createReviewedShardCatalogueProvider({
    localManifestPath: path.join(current.baseRoot, 'manifest.json'),
    f8xOverlay: { localManifestPath: path.join(current.overlayRoot, 'manifest.json') },
    now: () => NOW
  });
  const prepared = await provider.prepareProducts({
    request: request(),
    baseProducts: [contaminatedSku, contaminatedIdentifier, safe],
    nowValue: NOW
  });

  assert.equal(prepared.products.some(product => [
    contaminatedSku.publicKey,
    contaminatedIdentifier.publicKey
  ].includes(product.publicKey)), false);
  assert.equal(prepared.products.some(product => ['7999999', '7999998'].includes(
    String(product.ecsPartNumber || '').replace(/\D/g, '')
  )), false);
  const surviving = prepared.products.find(product => product.publicKey === safe.publicKey);
  assert.deepEqual(surviving.relatedProductSlugs, ['safe-related-handle']);
});

test('the F8X overlay itself cannot contain a projected-quarantine identity', async (t) => {
  const current = await fixture({
    overlay: { products: [f8xProduct(QUARANTINE[0])] }
  });
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const provider = createReviewedShardCatalogueProvider({
    localManifestPath: path.join(current.baseRoot, 'manifest.json'),
    f8xOverlay: { localManifestPath: path.join(current.overlayRoot, 'manifest.json') },
    now: () => NOW
  });
  await assert.rejects(
    () => provider.getStatus([]),
    error => error?.code === 'f8x_overlay_quarantine_overlap'
  );
});

test('transient base-release, base-binding and overlay-release read failures are retryable', async (t) => {
  for (const [name, failedPath] of [
    ['base release', current => path.join(current.baseRoot, 'manifest.json')],
    ['base binding', current => path.join(current.baseRoot, 'shard-00001.json')],
    ['overlay release', current => path.join(current.overlayRoot, 'manifest.json')]
  ]) {
    await t.test(name, async t2 => {
      const current = await fixture();
      t2.after(() => rm(current.root, { recursive: true, force: true }));
      const target = path.resolve(failedPath(current));
      let targetReads = 0;
      const provider = createReviewedShardCatalogueProvider({
        localManifestPath: path.join(current.baseRoot, 'manifest.json'),
        f8xOverlay: { localManifestPath: path.join(current.overlayRoot, 'manifest.json') },
        readFileImpl: async filename => {
          if (path.resolve(filename) === target) {
            targetReads += 1;
            if (targetReads === 1) throw new Error('transient fixture read failure');
          }
          return readFile(filename);
        },
        now: () => NOW
      });

      await assert.rejects(
        () => provider.getStatus([]),
        error => error?.code === 'reviewed_shard_unavailable'
      );
      const status = await provider.getStatus([]);
      assert.equal(status.schemaVersion, 3);
      assert.equal(status.publishedProductCount, 2);
      assert.equal(targetReads, 2);
    });
  }
});

test('cached signed base and F8X releases are revalidated after manifest expiry', async (t) => {
  await t.test('F8X overlay expiry', async t2 => {
    const current = await fixture();
    t2.after(() => rm(current.root, { recursive: true, force: true }));
    const remote = remoteOverlayFixture(current, {
      expiresAt: '2026-08-20T12:31:00.000Z'
    });
    let clock = NOW;
    const provider = createReviewedShardCatalogueProvider({
      localManifestPath: path.join(current.baseRoot, 'manifest.json'),
      f8xOverlay: {
        currentUrl: remote.currentUrl,
        manifestSecret: MANIFEST_SIGNING_FIXTURE
      },
      fetchImpl: remote.fetchImpl,
      now: () => clock
    });
    const first = await provider.getStatus([]);
    assert.equal(first.schemaVersion, 3);
    clock = Date.parse('2026-08-20T12:32:00.000Z');
    await assert.rejects(
      () => provider.getStatus([]),
      error => error?.code === 'invalid_f8x_overlay_manifest'
    );
    assert.equal(remote.calls.filter(url => url === remote.currentUrl).length, 2);
  });

  await t.test('base release expiry', async t2 => {
    const current = await fixture();
    t2.after(() => rm(current.root, { recursive: true, force: true }));
    const remote = remoteBaseFixture(current, {
      expiresAt: '2026-08-20T12:31:00.000Z'
    });
    let clock = NOW;
    const provider = createReviewedShardCatalogueProvider({
      currentUrl: remote.currentUrl,
      manifestSecret: MANIFEST_SIGNING_FIXTURE,
      f8xOverlay: { localManifestPath: path.join(current.overlayRoot, 'manifest.json') },
      fetchImpl: remote.fetchImpl,
      now: () => clock
    });
    const first = await provider.getStatus([]);
    assert.equal(first.schemaVersion, 3);
    clock = Date.parse('2026-08-20T12:32:00.000Z');
    await assert.rejects(
      () => provider.getStatus([]),
      error => error?.code === 'invalid_reviewed_shard_manifest'
    );
    assert.equal(remote.calls.filter(url => url === remote.currentUrl).length, 2);
  });
});

test('a configured preview provider prefers the complete bundled F8X release over remote settings', async () => {
  let remoteFetchCount = 0;
  const provider = createConfiguredReviewedShardCatalogueProvider({
    env: {
      VERCEL_ENV: 'preview',
      [ECS_REVIEWED_F8X_OVERLAY_CURRENT_URL_ENV]: 'https://expired-f8x.public.blob.vercel-storage.com/current.json',
      [ECS_REVIEWED_F8X_OVERLAY_MANIFEST_SECRET_ENV]: MANIFEST_SIGNING_FIXTURE
    },
    fetchImpl: async () => {
      remoteFetchCount += 1;
      throw new Error('The bundled preview release must not fetch a remote overlay.');
    }
  });

  const status = await provider.getStatus(REVIEWED_ECS_PRODUCTS);
  assert.equal(status.schemaVersion, 3);
  assert.equal(status.f8xOverlayRelease.source, 'bundled-complete-overlay');
  assert.equal(status.f8xOverlayRelease.releaseId, '20260821T094926386Z-4ab768650f081c7c');
  assert.equal(status.f8xOverlayRelease.complete, true);
  assert.equal(status.f8xOverlayRelease.shardCount, 36);
  assert.equal(status.f8xOverlayRelease.routeCount, 4_545);
  assert.equal(status.sourceRecordCounts.f8xOverlay, 4_545);
  assert.equal(provider.diagnostics().overlayShardReadCount, 36);
  assert.equal(provider.diagnostics().overlayRemote, false);
  assert.equal(remoteFetchCount, 0);
});

test('configured providers activate the F8X overlay only for complete environment configuration', async (t) => {
  const current = await fixture();
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const localManifestPath = path.join(current.baseRoot, 'manifest.json');
  const remote = remoteOverlayFixture(current);

  const disabled = createConfiguredReviewedShardCatalogueProvider({
    env: { VERCEL_ENV: 'production' }, localManifestPath, now: () => NOW
  });
  assert.equal(disabled.diagnostics().f8xOverlayConfigured, false);
  assert.equal((await disabled.getStatus([])).schemaVersion, 2);

  assert.throws(
    () => createConfiguredReviewedShardCatalogueProvider({
      env: { [ECS_REVIEWED_F8X_OVERLAY_CURRENT_URL_ENV]: remote.currentUrl },
      localManifestPath,
      now: () => NOW
    }),
    error => error?.code === 'invalid_f8x_overlay_configuration'
  );
  assert.throws(
    () => createConfiguredReviewedShardCatalogueProvider({
      env: { [ECS_REVIEWED_F8X_OVERLAY_MANIFEST_SECRET_ENV]: MANIFEST_SIGNING_FIXTURE },
      localManifestPath,
      now: () => NOW
    }),
    error => error?.code === 'invalid_f8x_overlay_configuration'
  );

  const configured = createConfiguredReviewedShardCatalogueProvider({
    env: {
      [ECS_REVIEWED_F8X_OVERLAY_CURRENT_URL_ENV]: remote.currentUrl,
      [ECS_REVIEWED_F8X_OVERLAY_MANIFEST_SECRET_ENV]: MANIFEST_SIGNING_FIXTURE
    },
    localManifestPath,
    fetchImpl: remote.fetchImpl,
    now: () => NOW
  });
  const configuredStatus = await configured.getStatus([]);
  assert.equal(configured.diagnostics().f8xOverlayConfigured, true);
  assert.equal(configuredStatus.schemaVersion, 3);
  assert.equal(configuredStatus.f8xOverlayRelease.source, 'signed-vercel-blob');
  const publicState = JSON.stringify({
    diagnostics: configured.diagnostics(),
    status: configuredStatus
  });
  assert.equal(publicState.includes(MANIFEST_SIGNING_FIXTURE), false);
  assert.equal(publicState.includes(remote.currentUrl), false);
});

test('a signed remote F8X overlay uses the same exact binding and union checks', async (t) => {
  const current = await fixture();
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const host = 'f8x-runtime-test.public.blob.vercel-storage.com';
  const prefix = `https://${host}/projx-racing/f8x/${current.overlay.manifest.releaseId}/`;
  const remoteManifest = {
    ...current.overlay.manifest,
    index: {
      url: `${prefix}index.json`,
      bytes: current.overlay.manifest.index.bytes,
      sha256: current.overlay.manifest.index.sha256
    },
    shards: current.overlay.manifest.shards.map(descriptor => ({
      sequence: descriptor.sequence,
      url: `${prefix}${descriptor.file}`,
      productCount: descriptor.productCount,
      bytes: descriptor.bytes,
      sha256: descriptor.sha256,
      firstKey: descriptor.firstKey,
      lastKey: descriptor.lastKey
    })),
    publishedAt: '2026-08-20T12:20:00.000Z',
    expiresAt: '2026-08-27T12:20:00.000Z'
  };
  remoteManifest.signature = signReviewedShardManifest(remoteManifest, MANIFEST_SIGNING_FIXTURE);
  const currentUrl = `https://${host}/projx-racing/f8x/current.json`;
  const documents = new Map([
    [currentUrl, jsonBuffer(remoteManifest)],
    [remoteManifest.index.url, current.overlay.indexBuffer],
    [remoteManifest.shards[0].url, current.overlay.shardBuffer]
  ]);
  const provider = createReviewedShardCatalogueProvider({
    localManifestPath: path.join(current.baseRoot, 'manifest.json'),
    f8xOverlay: {
      currentUrl,
      manifestSecret: MANIFEST_SIGNING_FIXTURE
    },
    fetchImpl: async url => {
      const body = documents.get(String(url));
      return body
        ? new Response(body, {
          status: 200,
          headers: { 'content-type': 'application/json', 'content-length': String(body.length) }
        })
        : new Response('missing', { status: 404, headers: { 'content-type': 'text/plain' } });
    },
    now: () => NOW
  });
  const status = await provider.getStatus([]);
  assert.equal(status.f8xOverlayRelease.source, 'signed-vercel-blob');
  assert.equal(status.f8xOverlayRelease.releaseId, current.overlay.manifest.releaseId);
  assert.equal(status.publishedProductCount, 2);
});

test('a signed remote base reconstructs the exact immutable local base binding', async (t) => {
  const current = await fixture();
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const host = 'f8x-base-runtime-test.public.blob.vercel-storage.com';
  const prefix = `https://${host}/projx-racing/base/${current.base.manifest.releaseId}/`;
  const remoteBase = {
    ...current.base.manifest,
    index: {
      url: `${prefix}index.json`,
      bytes: current.base.manifest.index.bytes,
      sha256: current.base.manifest.index.sha256
    },
    shards: current.base.manifest.shards.map(descriptor => ({
      sequence: descriptor.sequence,
      url: `${prefix}${descriptor.file}`,
      productCount: descriptor.productCount,
      bytes: descriptor.bytes,
      sha256: descriptor.sha256,
      firstKey: descriptor.firstKey,
      lastKey: descriptor.lastKey
    })),
    publishedAt: '2026-08-20T12:20:00.000Z',
    expiresAt: '2026-08-27T12:20:00.000Z'
  };
  remoteBase.signature = signReviewedShardManifest(remoteBase, MANIFEST_SIGNING_FIXTURE);
  const currentUrl = `https://${host}/projx-racing/base/current.json`;
  const documents = new Map([
    [currentUrl, jsonBuffer(remoteBase)],
    [remoteBase.index.url, current.base.indexBuffer],
    [remoteBase.shards[0].url, current.base.shardBuffer]
  ]);
  const provider = createReviewedShardCatalogueProvider({
    currentUrl,
    manifestSecret: MANIFEST_SIGNING_FIXTURE,
    f8xOverlay: { localManifestPath: path.join(current.overlayRoot, 'manifest.json') },
    fetchImpl: async url => {
      const body = documents.get(String(url));
      return body
        ? new Response(body, {
          status: 200,
          headers: { 'content-type': 'application/json', 'content-length': String(body.length) }
        })
        : new Response('missing', { status: 404, headers: { 'content-type': 'text/plain' } });
    },
    now: () => NOW
  });
  const status = await provider.getStatus([]);
  assert.equal(status.shardRelease.source, 'signed-vercel-blob');
  assert.equal(status.f8xOverlayRelease.baseReleaseId, current.base.manifest.releaseId);
  assert.equal(status.publishedProductCount, 2);
});

test('the existing provider remains lazy when no F8X overlay is configured', async (t) => {
  const current = await fixture();
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const provider = createReviewedShardCatalogueProvider({
    localManifestPath: path.join(current.baseRoot, 'manifest.json'), now: () => NOW
  });
  const prepared = await provider.prepareProducts({ request: request(), baseProducts: [], nowValue: NOW });
  assert.equal(prepared.products.length, 1);
  assert.equal(prepared.status.schemaVersion, 2);
  assert.equal(provider.diagnostics().f8xOverlayConfigured, false);
  assert.equal(provider.diagnostics().overlayShardReadCount, 0);
});
