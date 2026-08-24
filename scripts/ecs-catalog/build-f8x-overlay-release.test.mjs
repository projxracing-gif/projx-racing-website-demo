import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BlobPreconditionFailedError } from '@vercel/blob';
import {
  F8X_OVERLAY_INDEX_KIND,
  F8X_OVERLAY_MANIFEST_KIND,
  F8X_OVERLAY_SHARD_KIND,
  buildReviewedProductShardRelease,
  mergeReviewedShardOverlay,
  readReviewedProductShardRelease,
  validateF8xOverlayBuildBinding,
  validateF8xOverlayModuleSnapshot,
  writeReviewedProductShardRelease,
} from './build-reviewed-product-shards.mjs';
import { renderF8xAggregateModule } from './prepare-f8x-aggregate.mjs';
import {
  buildF8xObservationEvidenceBinding,
  snapshotTrustedCurrentReviewedGraph,
} from './finalize-f8x-release-audit.mjs';
import { REVIEWED_ECS_PRODUCTS } from '../../server/ecs-reviewed-catalog.js';
import {
  createReviewedShardCatalogueProvider,
  verifyReviewedShardManifestSignature,
} from '../../server/ecs-reviewed-shard-catalog.js';
import {
  ECS_REVIEWED_CURRENT_PATH,
  ECS_REVIEWED_F8X_OVERLAY_CURRENT_PATH,
  ECS_REVIEWED_F8X_OVERLAY_RELEASE_PREFIX,
  ECS_REVIEWED_RELEASE_PREFIX,
  publishReviewedProductShards,
} from './publish-reviewed-product-shards.mjs';

const SECTION_KEYS = Object.freeze([
  'braking', 'engine', 'exterior', 'interior', 'performance', 'suspension', 'steering'
]);
const SECTION_LABELS = Object.freeze({
  braking: 'Braking', engine: 'Engine', exterior: 'Exterior', interior: 'Interior',
  performance: 'Performance', suspension: 'Suspension', steering: 'Steering',
});
const PROJECTED_QUARANTINE = Object.freeze(['4017812', '4630189', '4715378']);
const GENERATED_AT = '2026-08-20T10:00:00.000Z';
const PUBLISH_NOW = Date.parse('2026-08-20T12:00:00.000Z');
const BLOB_AUTH_FIXTURE = 'test_f8x_blob_token_1234567890';
const BASE_SIGNING_FIXTURE = 'base-reviewed-shard-secret-'.repeat(2);
const OVERLAY_SIGNING_FIXTURE = 'f8x-overlay-manifest-secret-'.repeat(2);
const CURRENT_REVIEWED_MODULE_GRAPH = await snapshotTrustedCurrentReviewedGraph();

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter(key => value[key] !== undefined)
      .map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function dataSha256(value) {
  return sha256(Buffer.from(stableJson(value), 'utf8'));
}

function memoryBlobSdk({ conditionalConflictPath = null } = {}) {
  const host = 'f8x-publisher-test.public.blob.vercel-storage.com';
  const objects = new Map();
  const putCalls = [];
  const getCalls = [];
  const headCalls = [];
  const publicUrl = pathname => `https://${host}/${pathname}`;
  const objectFor = (buffer, contentType = 'application/json') => ({
    buffer: Buffer.from(buffer),
    contentType,
    etag: `etag-${sha256(buffer).slice(0, 24)}`,
  });
  const responseFor = (pathname, object) => ({
    statusCode: 200,
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue(object.buffer);
        controller.close();
      },
    }),
    blob: {
      url: publicUrl(pathname),
      pathname,
      size: object.buffer.length,
      contentType: object.contentType,
      etag: object.etag,
    },
  });
  return {
    objects,
    putCalls,
    getCalls,
    headCalls,
    publicUrl,
    seed(pathname, buffer, contentType = 'application/json') {
      objects.set(pathname, objectFor(buffer, contentType));
    },
    async put(pathname, body, options) {
      const buffer = Buffer.from(body);
      putCalls.push({ pathname, buffer, options });
      const existing = objects.get(pathname);
      if (conditionalConflictPath === pathname && options.ifMatch) {
        throw new BlobPreconditionFailedError();
      }
      if (existing && !options.allowOverwrite) {
        const error = new Error('simulated immutable object collision');
        error.name = 'BlobAlreadyExistsError';
        throw error;
      }
      if (options.ifMatch && existing?.etag !== options.ifMatch) {
        throw new BlobPreconditionFailedError();
      }
      objects.set(pathname, objectFor(buffer, options.contentType));
      return { url: publicUrl(pathname) };
    },
    async get(pathname, options) {
      getCalls.push({ pathname, options });
      const object = objects.get(pathname);
      return object ? responseFor(pathname, object) : null;
    },
    async head(pathname, options) {
      headCalls.push({ pathname, options });
      const object = objects.get(pathname);
      if (!object) throw new Error('Vercel Blob: The requested blob does not exist');
      return {
        url: publicUrl(pathname), pathname, size: object.buffer.length,
        contentType: object.contentType, etag: object.etag,
      };
    },
    async fetchImpl(value) {
      const url = new URL(String(value));
      if (url.hostname !== host) return new Response('missing', { status: 404 });
      const pathname = url.pathname.replace(/^\//, '');
      const object = objects.get(pathname);
      return object
        ? new Response(object.buffer, {
          status: 200,
          headers: {
            'content-type': object.contentType,
            'content-length': String(object.buffer.length),
          },
        })
        : new Response('missing', { status: 404 });
    },
  };
}

function rebindFinalAuditInputSet(audit) {
  audit.finalReleaseAudit.inputSetSha256 = dataSha256(audit.finalReleaseAudit.inputChecksums);
  return audit;
}

function genericAudit() {
  const includedSections = ['braking'];
  return {
    generatedAt: '2026-08-19T10:00:00.000Z',
    quarantinedIdentityCount: 0,
    sections: Object.fromEntries(SECTION_KEYS.map(key => [key, {
      productCount: key === 'braking' ? 1 : 0,
    }])),
    captureProgress: {
      complete: false,
      includedSections,
      sections: Object.fromEntries(SECTION_KEYS.map(key => [key, {
        complete: key === 'braking',
        capturedPages: key === 'braking' ? 1 : 0,
        expectedPages: key === 'braking' ? 1 : 0,
        capturedPlacements: key === 'braking' ? 1 : 0,
        expectedPlacements: key === 'braking' ? 1 : 0,
      }])),
    },
  };
}

function genericProduct(identity = '800001') {
  return {
    publicKey: `ecs-es-${identity}`,
    slug: `es-${identity}`,
    title: `Existing reviewed product ES#${identity}`,
    titleAr: null,
    brand: 'ECS Tuning',
    brandSlug: 'ecs-tuning',
    category: 'Braking Parts',
    categorySlug: 'bmw-m3-braking',
    subcategory: 'Brake Components',
    subcategorySlug: 'bmw-m3-braking-brake-components',
    ecsPartNumber: `ES#${identity}`,
    sku: `ES#${identity}`,
    mpn: `MPN-${identity}`,
    description: 'Existing reviewed product.',
    priceAmount: 50,
    priceCurrency: 'USD',
    priceVerifiedAt: '2026-08-19',
    quoteOnly: false,
    checkedAt: '2026-08-19',
    staleAfterDays: 7,
    stockPolicy: 'manual-confirm',
    availabilityCode: 'check_availability',
    fitmentConfidence: 'possible',
    fitments: [{
      make: 'BMW', model: 'M3', models: ['M3'], generation: null,
      chassis: [], engines: [], confidence: 'possible',
    }],
    filters: { categories: ['bmw-m3', 'bmw-m3-braking'], subcategories: [] },
    selectionSources: [{ section: 'Braking', category: 'Brake Components' }],
    relatedProductSlugs: [],
  };
}

function f8xProduct(identity = '900001') {
  const profiles = [
    { key: 'f80-m3', vehicle: 'BMW F80 M3 S55 3.0L', model: 'M3', chassis: 'F80', root: 'BMW-F80-M3-S55_3.0L' },
    { key: 'f82-m4', vehicle: 'BMW F82 M4 S55 3.0L', model: 'M4', chassis: 'F82', root: 'BMW-F82-M4-S55_3.0L' },
    { key: 'f83-m4', vehicle: 'BMW F83 M4 S55 3.0L', model: 'M4', chassis: 'F83', root: 'BMW-F83-M4-S55_3.0L' },
  ];
  return {
    catalogType: 'product',
    provider: 'ECS Tuning',
    providerSlug: 'ecs',
    dataOrigin: 'authorized-public-ecs-f8x-vehicle-category-review',
    publicKey: `ecs-es-${identity}`,
    slug: `es-${identity}`,
    title: `F8X reviewed product ES#${identity}`,
    titleAr: null,
    brand: 'ECS Tuning',
    brandSlug: 'ecs-tuning',
    category: 'BMW F8X Parts',
    categorySlug: 'bmw-f8x',
    subcategory: 'F8X Components',
    subcategorySlug: 'bmw-f8x-components',
    ecsPartNumber: `ES#${identity}`,
    sku: `ES#${identity}`,
    mpn: `F8X-${identity}`,
    identifiers: { ecs: `ES#${identity}`, sku: `ES#${identity}`, mpn: `F8X-${identity}` },
    originalUrl: `https://www.ecstuning.com/b-ecs-tuning-parts/f8x-product-${identity}/f8x-${identity}/`,
    description: 'Supplier vehicle-category evidence; fitment confirmation is required.',
    priceAmount: 100,
    priceCurrency: 'USD',
    priceStartingAt: false,
    priceConflict: false,
    priceVerifiedAt: '2026-08-20',
    quoteOnly: false,
    checkedAt: '2026-08-20',
    stockObservedAt: '2026-08-20',
    staleAfterDays: 7,
    stockPolicy: 'manual-confirm',
    availabilityCode: 'check_availability',
    fitmentStatus: 'supplier-vehicle-category-confirm',
    fitmentConfidence: 'possible',
    fitments: profiles.map(profile => ({
      make: 'BMW', model: profile.model, models: [profile.model], generation: profile.chassis,
      chassis: [profile.chassis], yearFrom: null, yearTo: null, engines: ['S55'],
      trim: null, drivetrains: [], confidence: 'possible', evidence: 'ecs-exact-f8x-vehicle-category',
    })),
    filters: {
      categories: [
        'bmw-f8x', ...profiles.map(profile => profile.key),
        ...SECTION_KEYS.map(key => `bmw-f8x-${key}`),
      ],
      subcategories: SECTION_KEYS.map(key => `bmw-f8x-${key}-components`),
      supplier: ['ecs'],
      makes: ['BMW'],
      models: ['M3', 'M4'],
      chassis: ['F80', 'F82', 'F83'],
      years: [],
      engines: ['S55'],
      drivetrains: [],
      availability: ['confirmation-required'],
      fitment: ['possible'],
    },
    options: [],
    variants: [],
    selectionSources: profiles.flatMap(profile => SECTION_KEYS.map(section => ({
      vehicleKey: profile.key,
      vehicle: profile.vehicle,
      section: SECTION_LABELS[section],
      category: 'Components',
      categoryKey: `${section}-components`,
      sourceUrl: `https://www.ecstuning.com/${profile.root}/${SECTION_LABELS[section]}/Components/`,
      relevancePosition: 1,
      observedAt: GENERATED_AT,
    }))),
    relatedProductSlugs: [],
  };
}

async function baseReleaseFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'projx-f8x-base-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const audit = genericAudit();
  audit.quarantinedIdentityCount = PROJECTED_QUARANTINE.length;
  const release = buildReviewedProductShardRelease([genericProduct()], audit, { shardSize: 32 });
  await writeReviewedProductShardRelease(root, release);
  return readReviewedProductShardRelease(root);
}

function finalAuditFixture(currentRelease, aggregateProducts, aggregateQuarantine, moduleBuffer, {
  priorQuarantine = [],
  projectedQuarantine = [...new Set([...priorQuarantine, ...aggregateQuarantine])].sort(),
} = {}) {
  const baseRelease = {
    releaseId: currentRelease.releaseBinding.releaseId,
    manifestSha256: currentRelease.releaseBinding.manifestFileSha256,
    contentSetSha256: currentRelease.releaseBinding.contentSetSha256,
    artifactSetSha256: currentRelease.releaseBinding.artifactSetSha256,
    productCount: currentRelease.releaseBinding.productCount,
    routeCount: currentRelease.releaseBinding.routeCount,
    shardCount: currentRelease.releaseBinding.shardCount,
    quarantinedIdentityCount: currentRelease.releaseBinding.quarantinedIdentityCount,
    productsSha256: currentRelease.releaseBinding.productsSha256,
  };
  const inputChecksums = {
    aggregateModule: { bytes: moduleBuffer.length, sha256: sha256(moduleBuffer) },
    aggregateProducts: { count: aggregateProducts.length, sha256: dataSha256(aggregateProducts) },
    aggregateQuarantine: { count: aggregateQuarantine.length, sha256: dataSha256(aggregateQuarantine) },
    currentReviewedModuleGraph: {
      fileCount: CURRENT_REVIEWED_MODULE_GRAPH.fileCount,
      sha256: CURRENT_REVIEWED_MODULE_GRAPH.sha256,
    },
    currentReviewedProducts: {
      count: REVIEWED_ECS_PRODUCTS.length,
      sha256: dataSha256(REVIEWED_ECS_PRODUCTS),
    },
    currentReviewedShardRelease: {
      ...currentRelease.releaseBinding,
      fileCount: currentRelease.artifactSnapshots.length,
    },
  };
  const inputSetSha256 = dataSha256(inputChecksums);
  const sectionProgress = Object.fromEntries(SECTION_KEYS.map(key => [key, {
    label: SECTION_LABELS[key], complete: true, included: true,
    capturedPages: 3, expectedPages: 3, capturedPlacements: 3, expectedPlacements: 3,
    productCount: aggregateProducts.length, vehicleScopeCount: 3,
  }]));
  const projected = new Set(projectedQuarantine);
  const currentRuntime = mergeReviewedShardOverlay(REVIEWED_ECS_PRODUCTS, currentRelease.products);
  const removedCurrent = currentRuntime
    .map(item => item.ecsPartNumber.replace(/^ES#/, ''))
    .filter(identity => projected.has(identity)).sort();
  const survivingStatic = REVIEWED_ECS_PRODUCTS.filter(item => (
    !projected.has(item.ecsPartNumber.replace(/^ES#/, ''))
  ));
  const survivingBase = currentRelease.products.filter(item => (
    !projected.has(item.ecsPartNumber.replace(/^ES#/, ''))
  ));
  const projectedRuntime = mergeReviewedShardOverlay(
    mergeReviewedShardOverlay(survivingStatic, survivingBase),
    aggregateProducts,
  );
  const currentIdentities = new Set(currentRuntime.map(item => item.ecsPartNumber.replace(/^ES#/, '')));
  const overlap = aggregateProducts.filter(item => currentIdentities.has(
    item.ecsPartNumber.replace(/^ES#/, '')
  )).length;
  const totalPublished = projectedRuntime.length;
  const observationEvidence = buildF8xObservationEvidenceBinding(aggregateProducts, []);
  return {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    kind: 'ecs-f8x-aggregate-import-audit',
    generatedAt: GENERATED_AT,
    sourceKind: 'ecs-f8x-21-scope-reconciled-capture-set',
    quarantine: [],
    placementIdentityEvidence: observationEvidence.capturePlacementIdentityEvidence,
    observationEvidence,
    productCount: aggregateProducts.length,
    quarantinedIdentityCount: projectedQuarantine.length,
    projectedQuarantinedEcsIdentities: [...projectedQuarantine],
    priorReviewedQuarantine: {
      sourceReleaseId: currentRelease.releaseBinding.releaseId,
      identityCount: priorQuarantine.length,
      identitySetSha256: dataSha256(priorQuarantine),
      sourceAggregateModuleSha256: 'a'.repeat(64),
    },
    sections: Object.fromEntries(SECTION_KEYS.map(key => [key, {
      label: SECTION_LABELS[key], productCount: aggregateProducts.length,
      f8xOverlayProductCount: aggregateProducts.length, vehicleScopeCount: 3,
    }])),
    publicationPlan: {
      mode: 'separate-f8x-overlay',
      overlayProductCount: aggregateProducts.length,
      baseRelease,
      priorQuarantine: {
        identityCount: priorQuarantine.length,
        identitiesSha256: dataSha256(priorQuarantine),
      },
      incomingQuarantine: {
        identityCount: aggregateQuarantine.length,
        identitiesSha256: dataSha256([...aggregateQuarantine].sort()),
      },
      projectedQuarantine: {
        identityCount: projectedQuarantine.length,
        identitiesSha256: dataSha256(projectedQuarantine),
      },
      staticPlusBasePlusOverlayProductCount: totalPublished,
    },
    publicationMergeAudit: {
      staticReviewedProductCount: REVIEWED_ECS_PRODUCTS.length,
      currentReviewedShardProductCount: currentRelease.products.length,
      currentRuntimeReviewedProductCount: currentRuntime.length,
      generatedProductCount: aggregateProducts.length,
      publishedOverlayProductCount: aggregateProducts.length,
      overlapWithCurrentRuntimeReviewedEcsCount: overlap,
      newUniqueProductCount: projectedRuntime.length - (currentRuntime.length - removedCurrent.length),
      currentRuntimeQuarantineOverlapCount: removedCurrent.length,
      currentReviewedRemovedByProjectedQuarantineCount: removedCurrent.length,
      currentReviewedRemovedByProjectedQuarantine: {
        identityCount: removedCurrent.length,
        identitiesSha256: dataSha256(removedCurrent),
      },
      unintendedCurrentReviewedRemovalCount: 0,
      projectedPublishedReviewedEcsCount: totalPublished,
      priorQuarantinedIdentityCount: priorQuarantine.length,
      incomingF8xQuarantinedIdentityCount: aggregateQuarantine.length,
      projectedQuarantinedIdentityCount: projectedQuarantine.length,
    },
    captureProgress: {
      stage: 'complete', complete: true, importPolicy: 'all-21-f8x-scopes-reconciled',
      requestedSectionCount: 7, includedSectionCount: 7,
      includedSections: [...SECTION_KEYS], excludedSections: [], sections: sectionProgress,
    },
    finalReleaseAudit: {
      schemaVersion: 1,
      kind: 'ecs-f8x-final-release-audit-verification',
      verifiedAtSourceTimestamp: GENERATED_AT,
      currentReviewedShardRelease: { ...currentRelease.releaseBinding },
      inputSetSha256,
      inputChecksums,
    },
  };
}

async function overlayContext(t) {
  const currentRelease = await baseReleaseFixture(t);
  const products = [f8xProduct()];
  const quarantine = [];
  const moduleBuffer = Buffer.from(renderF8xAggregateModule({
    products,
    quarantinedEcsIdentities: quarantine,
  }), 'utf8');
  const audit = finalAuditFixture(currentRelease, products, quarantine, moduleBuffer, {
    priorQuarantine: [...PROJECTED_QUARANTINE],
  });
  const projected = new Set(PROJECTED_QUARANTINE);
  const runtimeUnionProducts = mergeReviewedShardOverlay(
    mergeReviewedShardOverlay(
      REVIEWED_ECS_PRODUCTS.filter(item => !projected.has(item.ecsPartNumber.replace(/^ES#/, ''))),
      currentRelease.products.filter(item => !projected.has(item.ecsPartNumber.replace(/^ES#/, ''))),
    ),
    products,
  );
  const binding = validateF8xOverlayBuildBinding({
    audit,
    overlayModuleBuffer: moduleBuffer,
    aggregateProducts: products,
    aggregateQuarantine: quarantine,
    overlayProducts: products,
    currentRelease,
    currentReviewedModuleGraph: {
      fileCount: CURRENT_REVIEWED_MODULE_GRAPH.fileCount,
      sha256: CURRENT_REVIEWED_MODULE_GRAPH.sha256,
    },
    runtimeUnionProducts,
  });
  const release = buildReviewedProductShardRelease(products, audit, {
    shardSize: 32,
    f8xOverlayContract: binding.manifestContract,
  });
  return { currentRelease, products, quarantine, moduleBuffer, audit, binding, release };
}

async function overlayCandidateFixture(t) {
  const context = await overlayContext(t);
  const parent = await mkdtemp(path.join(os.tmpdir(), 'projx-f8x-overlay-output-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const output = path.join(parent, 'candidate');
  await writeReviewedProductShardRelease(output, context.release, {
    forbiddenDirectories: [context.currentRelease.root],
    privateCandidate: true,
  });
  return { ...context, output };
}

test('builds a distinct overlay-only release bound to the exact base, final audit and projected quarantine', async (t) => {
  const context = await overlayCandidateFixture(t);
  assert.equal(context.release.manifest.kind, F8X_OVERLAY_MANIFEST_KIND);
  assert.equal(context.release.indexDocument.kind, F8X_OVERLAY_INDEX_KIND);
  assert.ok(context.release.shards.every(shard => (
    JSON.parse(shard.buffer).kind === F8X_OVERLAY_SHARD_KIND
  )));
  assert.equal(context.release.manifest.counts.productCount, context.products.length);
  assert.equal(context.release.manifest.baseRelease.releaseId, context.currentRelease.manifest.releaseId);
  assert.deepEqual(context.release.manifest.projectedQuarantine.identities, PROJECTED_QUARANTINE);
  assert.equal(context.release.manifest.projectedQuarantine.identitiesSha256, dataSha256(PROJECTED_QUARANTINE));
  assert.equal(context.currentRelease.manifest.counts.productCount, 1);

  const reread = await readReviewedProductShardRelease(context.output);
  assert.equal(reread.manifest.kind, F8X_OVERLAY_MANIFEST_KIND);
  assert.deepEqual(reread.products.map(item => item.publicKey), context.products.map(item => item.publicKey));
  const dryRun = await publishReviewedProductShards({ directory: context.output, dryRun: true });
  assert.equal(dryRun.status, 'dry_run_passed');
  assert.equal(dryRun.kind, F8X_OVERLAY_MANIFEST_KIND);
  assert.equal(dryRun.baseReleaseId, context.currentRelease.manifest.releaseId);
});

test('publishes a signed F8X overlay only through its separate Blob prefix and pointer', async (t) => {
  const context = await overlayCandidateFixture(t);
  const sdk = memoryBlobSdk();
  const result = await publishReviewedProductShards({
    directory: context.output,
    dryRun: false,
    previewConfirmed: true,
    token: BLOB_AUTH_FIXTURE,
    manifestSecret: BASE_SIGNING_FIXTURE,
    overlayManifestSecret: OVERLAY_SIGNING_FIXTURE,
    blobSdk: sdk,
    now: PUBLISH_NOW,
  });

  assert.equal(result.status, 'published');
  assert.equal(result.kind, F8X_OVERLAY_MANIFEST_KIND);
  assert.equal(result.currentUrl, sdk.publicUrl(ECS_REVIEWED_F8X_OVERLAY_CURRENT_PATH));
  assert.equal(
    verifyReviewedShardManifestSignature(result.currentManifest, OVERLAY_SIGNING_FIXTURE),
    true,
  );
  assert.equal(
    verifyReviewedShardManifestSignature(result.currentManifest, BASE_SIGNING_FIXTURE),
    false,
  );

  const artifactWrites = sdk.putCalls.filter(call => (
    call.pathname !== ECS_REVIEWED_F8X_OVERLAY_CURRENT_PATH
  ));
  assert.ok(artifactWrites.length > 0);
  assert.ok(artifactWrites.every(call => (
    call.pathname.startsWith(
      `${ECS_REVIEWED_F8X_OVERLAY_RELEASE_PREFIX}${context.release.manifest.releaseId}/`,
    )
  )));
  assert.equal(
    sdk.putCalls.filter(call => call.pathname === ECS_REVIEWED_F8X_OVERLAY_CURRENT_PATH).length,
    1,
  );
  const allRemotePaths = [
    ...sdk.putCalls.map(call => call.pathname),
    ...sdk.getCalls.map(call => call.pathname),
  ];
  assert.equal(allRemotePaths.includes(ECS_REVIEWED_CURRENT_PATH), false);
  assert.equal(allRemotePaths.some(value => value.startsWith(ECS_REVIEWED_RELEASE_PREFIX)), false);

  const provider = createReviewedShardCatalogueProvider({
    localManifestPath: path.join(context.currentRelease.root, 'manifest.json'),
    f8xOverlay: {
      currentUrl: result.currentUrl,
      manifestSecret: OVERLAY_SIGNING_FIXTURE,
    },
    fetchImpl: sdk.fetchImpl,
    now: () => PUBLISH_NOW,
  });
  const status = await provider.getStatus(REVIEWED_ECS_PRODUCTS);
  assert.equal(status.f8xOverlayRelease.releaseId, context.release.manifest.releaseId);
  assert.equal(status.f8xOverlayRelease.source, 'signed-vercel-blob');
  assert.equal(status.f8xOverlayRelease.baseReleaseId, context.currentRelease.manifest.releaseId);
});

test('requires the overlay-specific signing secret before any Blob access', async (t) => {
  const context = await overlayCandidateFixture(t);
  for (const overlayManifestSecret of ['', 'too-short']) {
    const sdk = memoryBlobSdk();
    await assert.rejects(
      publishReviewedProductShards({
        directory: context.output,
        dryRun: false,
        previewConfirmed: true,
        token: BLOB_AUTH_FIXTURE,
        manifestSecret: BASE_SIGNING_FIXTURE,
        overlayManifestSecret,
        blobSdk: sdk,
        now: PUBLISH_NOW,
      }),
      error => error?.code === 'f8x_overlay_manifest_secret_required',
    );
    assert.equal(sdk.putCalls.length, 0);
    assert.equal(sdk.getCalls.length, 0);
  }
});

test('rejects an F8X overlay pointer CAS conflict without accessing the base pointer', async (t) => {
  const context = await overlayCandidateFixture(t);
  const sdk = memoryBlobSdk({
    conditionalConflictPath: ECS_REVIEWED_F8X_OVERLAY_CURRENT_PATH,
  });
  sdk.seed(
    ECS_REVIEWED_F8X_OVERLAY_CURRENT_PATH,
    Buffer.from('{"kind":"stale-overlay-pointer"}\n', 'utf8'),
  );

  await assert.rejects(
    publishReviewedProductShards({
      directory: context.output,
      dryRun: false,
      previewConfirmed: true,
      token: BLOB_AUTH_FIXTURE,
      overlayManifestSecret: OVERLAY_SIGNING_FIXTURE,
      blobSdk: sdk,
      now: PUBLISH_NOW,
    }),
    error => error?.code === 'publish_conflict',
  );

  const pointerWrite = sdk.putCalls.find(call => (
    call.pathname === ECS_REVIEWED_F8X_OVERLAY_CURRENT_PATH
  ));
  assert.ok(pointerWrite);
  assert.equal(pointerWrite.options.allowOverwrite, true);
  assert.match(pointerWrite.options.ifMatch, /^etag-/);
  const allRemotePaths = [
    ...sdk.putCalls.map(call => call.pathname),
    ...sdk.getCalls.map(call => call.pathname),
  ];
  assert.equal(allRemotePaths.includes(ECS_REVIEWED_CURRENT_PATH), false);
  assert.equal(allRemotePaths.some(value => value.startsWith(ECS_REVIEWED_RELEASE_PREFIX)), false);
});

test('accepts the finalizer contract where three quarantined products are removed only from static runtime data', async (t) => {
  const context = await overlayContext(t);
  assert.equal(context.audit.publicationMergeAudit.currentRuntimeQuarantineOverlapCount, 3);
  assert.deepEqual(
    REVIEWED_ECS_PRODUCTS
      .map(item => item.ecsPartNumber.replace(/^ES#/, ''))
      .filter(identity => PROJECTED_QUARANTINE.includes(identity)).sort(),
    PROJECTED_QUARANTINE,
  );
  assert.equal(context.currentRelease.products.some(item => PROJECTED_QUARANTINE.includes(
    item.ecsPartNumber.replace(/^ES#/, '')
  )), false);
  assert.equal(
    context.binding.runtimeUnionProductCount,
    context.audit.publicationPlan.staticPlusBasePlusOverlayProductCount,
  );
});

test('binds the real 10,267-product base and exact static runtime quarantine projection', async () => {
  const currentRelease = await readReviewedProductShardRelease(path.resolve('api/data/ecs-bmw-m3-reviewed'));
  assert.equal(currentRelease.products.length, 10_267);
  assert.equal(currentRelease.manifest.counts.quarantinedIdentityCount, 21);
  const report = JSON.parse(await readFile(path.resolve('docs/ecs-bmw-m3-aggregate-catalogue-report.json')));
  const priorQuarantine = report.quarantine
    .map(item => item.ecsPartNumber.replace(/^ES#/, '')).sort();
  assert.equal(priorQuarantine.length, 21);
  const products = [f8xProduct('999999001')];
  const moduleBuffer = Buffer.from(renderF8xAggregateModule({
    products,
    quarantinedEcsIdentities: [],
  }), 'utf8');
  const audit = finalAuditFixture(currentRelease, products, [], moduleBuffer, { priorQuarantine });
  const projectedSet = new Set(priorQuarantine);
  const currentRuntime = mergeReviewedShardOverlay(REVIEWED_ECS_PRODUCTS, currentRelease.products);
  const removed = currentRuntime.map(item => item.ecsPartNumber.replace(/^ES#/, ''))
    .filter(identity => projectedSet.has(identity)).sort();
  assert.deepEqual(removed, PROJECTED_QUARANTINE);
  const runtimeUnionProducts = mergeReviewedShardOverlay(
    mergeReviewedShardOverlay(
      REVIEWED_ECS_PRODUCTS.filter(item => !projectedSet.has(item.ecsPartNumber.replace(/^ES#/, ''))),
      currentRelease.products.filter(item => !projectedSet.has(item.ecsPartNumber.replace(/^ES#/, ''))),
    ),
    products,
  );
  const binding = validateF8xOverlayBuildBinding({
    audit,
    overlayModuleBuffer: moduleBuffer,
    aggregateProducts: products,
    aggregateQuarantine: [],
    overlayProducts: products,
    currentRelease,
    currentReviewedModuleGraph: {
      fileCount: CURRENT_REVIEWED_MODULE_GRAPH.fileCount,
      sha256: CURRENT_REVIEWED_MODULE_GRAPH.sha256,
    },
    runtimeUnionProducts,
  });
  assert.equal(binding.runtimeUnionProductCount, audit.publicationPlan.staticPlusBasePlusOverlayProductCount);
  assert.equal(audit.publicationMergeAudit.currentRuntimeQuarantineOverlapCount, 3);
  assert.equal(
    audit.publicationMergeAudit.currentReviewedRemovedByProjectedQuarantine.identitiesSha256,
    dataSha256(PROJECTED_QUARANTINE),
  );
  const release = buildReviewedProductShardRelease(products, audit, {
    shardSize: 32,
    f8xOverlayContract: binding.manifestContract,
  });
  assert.equal(release.manifest.counts.productCount, 1);
  assert.equal(release.manifest.baseRelease.productCount, 10_267);
  assert.deepEqual(release.manifest.projectedQuarantine.identities, priorQuarantine);
});

test('rejects changed module bytes before a non-canonical module can be parsed or executed', async (t) => {
  const context = await overlayContext(t);
  const root = await mkdtemp(path.join(os.tmpdir(), 'projx-f8x-overlay-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const marker = path.join(root, 'executed.txt');
  const modulePath = path.join(root, 'changed-overlay.mjs');
  const auditPath = path.join(root, 'audit.json');
  const output = path.join(root, 'candidate');
  const appended = `\nawait import('node:fs/promises').then(module => module.writeFile(${JSON.stringify(marker)}, 'executed'));\n`;
  await writeFile(modulePath, Buffer.concat([context.moduleBuffer, Buffer.from(appended)]));
  await writeFile(auditPath, `${JSON.stringify(context.audit)}\n`);
  assert.throws(
    () => validateF8xOverlayModuleSnapshot(context.audit, Buffer.concat([
      context.moduleBuffer, Buffer.from(appended),
    ])),
    error => error?.code === 'f8x_overlay_checksum_mismatch',
  );
  const result = spawnSync(process.execPath, [
    path.resolve('scripts/ecs-catalog/build-reviewed-product-shards.mjs'),
    '--input-dir', context.currentRelease.root,
    '--overlay-module', modulePath,
    '--audit', auditPath,
    '--output-dir', output,
  ], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /f8x_overlay_checksum_mismatch/);
  await assert.rejects(access(marker));
  await assert.rejects(access(output));
});

test('never executes the generic input-module path when the audit is F8X-only', async (t) => {
  const context = await overlayContext(t);
  const root = await mkdtemp(path.join(os.tmpdir(), 'projx-f8x-generic-bypass-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const marker = path.join(root, 'executed.txt');
  const modulePath = path.join(root, 'generic-executable.mjs');
  const auditPath = path.join(root, 'audit.json');
  const output = path.join(root, 'candidate');
  await writeFile(
    modulePath,
    `await import('node:fs/promises').then(module => module.writeFile(${JSON.stringify(marker)}, 'executed'));\nexport const BMW_M3_AGGREGATE_PRODUCTS = [];\n`,
  );
  await writeFile(auditPath, `${JSON.stringify(context.audit)}\n`);
  const result = spawnSync(process.execPath, [
    path.resolve('scripts/ecs-catalog/build-reviewed-product-shards.mjs'),
    '--input-module', modulePath,
    '--audit', auditPath,
    '--output-dir', output,
  ], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /f8x_overlay_mode_required/);
  await assert.rejects(access(marker));
  await assert.rejects(access(output));
});

test('rejects stale base, section, product and quarantine bindings', async (t) => {
  const context = await overlayContext(t);
  const invoke = audit => validateF8xOverlayBuildBinding({
    audit,
    overlayModuleBuffer: context.moduleBuffer,
    aggregateProducts: context.products,
    aggregateQuarantine: context.quarantine,
    overlayProducts: context.products,
    currentRelease: context.currentRelease,
    currentReviewedModuleGraph: {
      fileCount: CURRENT_REVIEWED_MODULE_GRAPH.fileCount,
      sha256: CURRENT_REVIEWED_MODULE_GRAPH.sha256,
    },
    runtimeUnionProducts: context.binding.runtimeUnionProductCount
      ? mergeReviewedShardOverlay(
        mergeReviewedShardOverlay(
          REVIEWED_ECS_PRODUCTS.filter(item => !PROJECTED_QUARANTINE.includes(
            item.ecsPartNumber.replace(/^ES#/, '')
          )),
          context.currentRelease.products,
        ),
        context.products,
      )
      : [],
  });
  const staleBase = structuredClone(context.audit);
  staleBase.publicationPlan.baseRelease.productsSha256 = 'f'.repeat(64);
  assert.throws(() => invoke(staleBase), error => error?.code === 'f8x_publication_plan_mismatch');

  const staleSection = structuredClone(context.audit);
  staleSection.sections.braking.productCount = 0;
  assert.throws(() => invoke(staleSection), error => error?.code === 'f8x_audit_count_mismatch');

  const staleProduct = structuredClone(context.audit);
  staleProduct.publicationPlan.overlayProductCount = 2;
  assert.throws(() => invoke(staleProduct), error => error?.code === 'f8x_publication_plan_mismatch');

  const staleQuarantine = structuredClone(context.audit);
  staleQuarantine.projectedQuarantinedEcsIdentities = ['4017812'];
  assert.throws(() => invoke(staleQuarantine), error => error?.code === 'f8x_quarantine_binding_mismatch');

  assert.throws(
    () => validateF8xOverlayBuildBinding({
      audit: context.audit,
      overlayModuleBuffer: context.moduleBuffer,
      aggregateProducts: context.products,
      aggregateQuarantine: context.quarantine,
      overlayProducts: context.products,
      currentRelease: context.currentRelease,
      currentReviewedModuleGraph: {
        fileCount: CURRENT_REVIEWED_MODULE_GRAPH.fileCount,
        sha256: 'f'.repeat(64),
      },
      runtimeUnionProducts: mergeReviewedShardOverlay(
        mergeReviewedShardOverlay(
          REVIEWED_ECS_PRODUCTS.filter(item => !PROJECTED_QUARANTINE.includes(
            item.ecsPartNumber.replace(/^ES#/, '')
          )),
          context.currentRelease.products,
        ),
        context.products,
      ),
    }),
    error => error?.code === 'f8x_static_graph_mismatch',
  );

  const staleEvidence = structuredClone(context.audit);
  staleEvidence.observationEvidence.placementsSha256 = 'f'.repeat(64);
  assert.throws(
    () => invoke(staleEvidence),
    error => error?.code === 'f8x_observation_binding_mismatch',
  );

  const forgedProducts = structuredClone(context.products);
  forgedProducts[0].selectionSources[0].category = 'Forged Components';
  const forgedBuffer = Buffer.from(renderF8xAggregateModule({
    products: forgedProducts,
    quarantinedEcsIdentities: context.quarantine,
  }), 'utf8');
  const forgedAudit = structuredClone(context.audit);
  forgedAudit.finalReleaseAudit.inputChecksums.aggregateModule = {
    bytes: forgedBuffer.length,
    sha256: sha256(forgedBuffer),
  };
  forgedAudit.finalReleaseAudit.inputChecksums.aggregateProducts = {
    count: forgedProducts.length,
    sha256: dataSha256(forgedProducts),
  };
  rebindFinalAuditInputSet(forgedAudit);
  assert.throws(
    () => validateF8xOverlayBuildBinding({
      audit: forgedAudit,
      overlayModuleBuffer: forgedBuffer,
      aggregateProducts: forgedProducts,
      aggregateQuarantine: context.quarantine,
      overlayProducts: forgedProducts,
      currentRelease: context.currentRelease,
      currentReviewedModuleGraph: {
        fileCount: CURRENT_REVIEWED_MODULE_GRAPH.fileCount,
        sha256: CURRENT_REVIEWED_MODULE_GRAPH.sha256,
      },
      runtimeUnionProducts: mergeReviewedShardOverlay(
        mergeReviewedShardOverlay(
          REVIEWED_ECS_PRODUCTS.filter(item => !PROJECTED_QUARANTINE.includes(
            item.ecsPartNumber.replace(/^ES#/, '')
          )),
          context.currentRelease.products,
        ),
        forgedProducts,
      ),
    }),
    error => error?.code === 'f8x_observation_binding_mismatch',
  );

  const invalidOverlayProducts = structuredClone(context.products);
  invalidOverlayProducts[0].stockPolicy = 'live';
  assert.throws(
    () => buildReviewedProductShardRelease(invalidOverlayProducts, context.audit, {
      shardSize: 32,
      f8xOverlayContract: context.binding.manifestContract,
    }),
    error => error?.code === 'invalid_f8x_overlay_product',
  );
});

test('output is no-replace, rejects base overlap and remains one coherent release under a writer race', async (t) => {
  const context = await overlayContext(t);
  const parent = await mkdtemp(path.join(os.tmpdir(), 'projx-f8x-overlay-race-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  await assert.rejects(
    writeReviewedProductShardRelease(context.currentRelease.root, context.release, {
      forbiddenDirectories: [context.currentRelease.root], privateCandidate: true,
    }),
    error => error?.code === 'output_input_overlap',
  );

  const output = path.join(parent, 'candidate');
  const results = await Promise.allSettled([
    writeReviewedProductShardRelease(output, context.release, { privateCandidate: true }),
    writeReviewedProductShardRelease(output, context.release, { privateCandidate: true }),
  ]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.filter(item => item.status === 'rejected').length, 1);
  const reread = await readReviewedProductShardRelease(output);
  assert.equal(reread.manifest.releaseId, context.release.manifest.releaseId);
  const manifestBefore = await readFile(path.join(output, 'manifest.json'));
  await assert.rejects(
    writeReviewedProductShardRelease(output, context.release, { privateCandidate: true }),
    error => error?.code === 'output_exists',
  );
  assert.deepEqual(await readFile(path.join(output, 'manifest.json')), manifestBefore);
});

test('rejects nonempty, public repository and linked candidate outputs without changing them', async (t) => {
  const context = await overlayContext(t);
  const parent = await mkdtemp(path.join(os.tmpdir(), 'projx-f8x-overlay-paths-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const nonempty = path.join(parent, 'nonempty');
  await mkdir(nonempty);
  const sentinel = path.join(nonempty, 'sentinel.txt');
  await writeFile(sentinel, 'preserve');
  await assert.rejects(
    writeReviewedProductShardRelease(nonempty, context.release, { privateCandidate: true }),
    error => error?.code === 'output_exists',
  );
  assert.equal(await readFile(sentinel, 'utf8'), 'preserve');

  await assert.rejects(
    writeReviewedProductShardRelease(path.resolve('docs', 'unsafe-f8x-overlay-output'), context.release, {
      privateCandidate: true,
    }),
    error => error?.code === 'public_output_path',
  );

  const target = path.join(parent, 'junction-target');
  const linked = path.join(parent, 'junction-output');
  await mkdir(target);
  try {
    await symlink(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
      t.diagnostic(`linked-output regression skipped: ${error.code}`);
      return;
    }
    throw error;
  }
  await assert.rejects(
    writeReviewedProductShardRelease(linked, context.release, { privateCandidate: true }),
    error => error?.code === 'linked_output_path',
  );
});

test('strict reread rejects a changed index instead of trusting manifest counts', async (t) => {
  const context = await overlayContext(t);
  const parent = await mkdtemp(path.join(os.tmpdir(), 'projx-f8x-overlay-corrupt-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const output = path.join(parent, 'candidate');
  await writeReviewedProductShardRelease(output, context.release, { privateCandidate: true });
  await writeFile(path.join(output, 'index.json'), '{}\n');
  await assert.rejects(
    readReviewedProductShardRelease(output),
    error => error?.code === 'input_checksum_mismatch',
  );
});
