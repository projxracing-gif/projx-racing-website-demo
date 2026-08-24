import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildReviewedProductShardRelease,
  readReviewedProductShardRelease,
  writeReviewedProductShardRelease,
} from './build-reviewed-product-shards.mjs';
import {
  F8xOverlayMediaRecoveryQueueError,
  __test,
  buildF8xOverlayMediaRecoveryQueue,
  verifyF8xOverlayMediaRecoveryFiles,
  writeF8xOverlayMediaRecoveryQueueCreateOnly,
} from './build-f8x-overlay-media-recovery-queue.mjs';
import { F8X_FINAL_PROFILES, F8X_FINAL_SECTIONS } from './finalize-f8x-release-audit.mjs';

const GENERATED_AT = '2026-08-20T15:00:00.000Z';
const PROFILE_KEYS = Object.keys(F8X_FINAL_PROFILES);
const SECTION_KEYS = Object.keys(F8X_FINAL_SECTIONS);
const PROJECTED_QUARANTINE = ['3183567'];

function baseReleaseBinding() {
  return {
    releaseId: '20260809T185719876Z-974a9b9a8fabb2f2',
    generatedAt: '2026-08-09T18:57:19.876Z',
    productCount: 10_267,
    routeCount: 10_267,
    shardCount: 81,
    quarantinedIdentityCount: PROJECTED_QUARANTINE.length,
    productsSha256: '1'.repeat(64),
    artifactSetSha256: '2'.repeat(64),
    datasetSha256: '974a9b9a8fabb2f2'.padEnd(64, '3'),
    contentSetSha256: '4'.repeat(64),
    manifestFileSha256: '5'.repeat(64),
    manifestCanonicalSha256: '6'.repeat(64),
    productIdentitySetSha256: '7'.repeat(64),
  };
}

function publishedBaseRelease(binding) {
  return {
    releaseId: binding.releaseId,
    manifestSha256: binding.manifestFileSha256,
    contentSetSha256: binding.contentSetSha256,
    artifactSetSha256: binding.artifactSetSha256,
    productCount: binding.productCount,
    routeCount: binding.routeCount,
    shardCount: binding.shardCount,
    quarantinedIdentityCount: binding.quarantinedIdentityCount,
    productsSha256: binding.productsSha256,
  };
}

function product(identity, {
  media = 'missing',
  profiles = PROFILE_KEYS,
  sections = SECTION_KEYS,
  brandSupplied = true,
  detailedDescriptionAvailable = true,
} = {}) {
  const profileValues = profiles.map(key => F8X_FINAL_PROFILES[key]);
  const observations = profiles.flatMap(profileKey => sections.map((sectionKey, index) => {
    const profile = F8X_FINAL_PROFILES[profileKey];
    const section = F8X_FINAL_SECTIONS[sectionKey];
    return {
      vehicleKey: profileKey,
      vehicle: profile.vehicle,
      section: section.label,
      category: `${section.label} Test Components`,
      categoryKey: `${sectionKey}-test-components`,
      sourceUrl: `${profile.rootUrl}${section.path}/Test_Components/`,
      relevancePosition: index + 1,
      observedAt: GENERATED_AT,
    };
  }));
  const image = `https://assets.ecstuning.com/product_library/${identity}_x300.webp`;
  return {
    catalogType: 'product',
    provider: 'ECS Tuning',
    providerSlug: 'ecs',
    dataOrigin: 'authorized-public-ecs-f8x-vehicle-category-review',
    publicKey: `ecs-es-${identity}`,
    slug: `es-${identity}`,
    title: `F8X media fixture ES#${identity}`,
    titleAr: null,
    brand: brandSupplied ? 'Test Brand' : 'Unbranded',
    brandSlug: brandSupplied ? 'test-brand' : 'unbranded',
    brandSupplied,
    category: 'BMW F8X Parts',
    categorySlug: 'bmw-f8x',
    subcategory: 'F8X Test Components',
    subcategorySlug: 'bmw-f8x-test-components',
    section: F8X_FINAL_SECTIONS[sections[0]].label,
    ecsPartNumber: `ES#${identity}`,
    sku: `ES#${identity}`,
    mpn: `F8X-MEDIA-${identity}`,
    identifiers: {
      ecs: `ES#${identity}`,
      sku: `ES#${identity}`,
      mpn: `F8X-MEDIA-${identity}`,
    },
    originalUrl: `https://www.ecstuning.com/b-test-brand-parts/f8x-media-${identity}/f8x-${identity}/`,
    description: detailedDescriptionAvailable ? `Supplier detail for ES#${identity}.` : 'Supplier description unavailable.',
    detailedDescriptionAvailable,
    imageStatus: media === 'verified' ? 'supplier-media-verified' : 'supplier-media-unavailable',
    imageSourceUrl: media === 'verified' ? image : null,
    images: media === 'verified' ? [{
      src: image,
      sourceUrl: image,
      alt: `ES#${identity}`,
      altAr: `ES#${identity}`,
    }] : [],
    priceAmount: 100,
    priceCurrency: 'USD',
    priceVerifiedAt: '2026-08-20',
    checkedAt: '2026-08-20',
    stockObservedAt: '2026-08-20',
    staleAfterDays: 7,
    stockPolicy: 'manual-confirm',
    availabilityCode: 'check_availability',
    fitmentStatus: 'supplier-vehicle-category-confirm',
    fitmentConfidence: 'possible',
    fitments: profileValues.map(profile => ({
      make: 'BMW',
      model: profile.model,
      models: [profile.model],
      trim: null,
      generation: profile.chassis,
      chassis: [profile.chassis],
      yearFrom: null,
      yearTo: null,
      engines: ['S55'],
      drivetrains: [],
      options: [],
      confidence: 'possible',
      evidence: 'ecs-exact-f8x-vehicle-category',
    })),
    filters: {
      supplier: ['ecs'],
      makes: ['BMW'],
      categories: ['bmw-f8x', ...profiles, ...sections.map(key => `bmw-f8x-${key}`)],
      subcategories: sections.map(key => `bmw-f8x-${key}-${key}-test-components`),
      models: [...new Set(profileValues.map(profile => profile.model))],
      chassis: profileValues.map(profile => profile.chassis),
      years: [],
      engines: ['S55'],
      drivetrains: [],
      availability: ['confirmation-required'],
      fitment: ['possible'],
    },
    options: [],
    variants: [],
    selectionSources: observations,
    relatedProductSlugs: [],
  };
}

function sectionCounts(products) {
  return Object.fromEntries(SECTION_KEYS.map(key => [key, products.filter(item => (
    item.selectionSources.some(source => source.section === F8X_FINAL_SECTIONS[key].label)
  )).length]));
}

function auditParts(products) {
  const binding = baseReleaseBinding();
  const baseRelease = publishedBaseRelease(binding);
  const inputChecksums = {
    aggregateModule: { bytes: 1234, sha256: '8'.repeat(64) },
    currentReviewedShardRelease: { ...binding, fileCount: 83 },
  };
  const inputSetSha256 = __test.dataSha256(inputChecksums);
  const counts = sectionCounts(products);
  const captureSections = Object.fromEntries(SECTION_KEYS.map(key => [key, {
    complete: true,
    included: true,
    capturedPages: 3,
    expectedPages: 3,
    capturedPlacements: counts[key],
    expectedPlacements: counts[key],
    productCount: counts[key],
    vehicleScopeCount: 3,
  }]));
  const sections = Object.fromEntries(SECTION_KEYS.map(key => [key, {
    label: F8X_FINAL_SECTIONS[key].label,
    productCount: counts[key],
    f8xOverlayProductCount: counts[key],
    vehicleScopeCount: 3,
  }]));
  const finalAudit = {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    kind: 'ecs-f8x-aggregate-import-audit',
    generatedAt: GENERATED_AT,
    productCount: products.length,
    quarantinedIdentityCount: PROJECTED_QUARANTINE.length,
    projectedQuarantinedEcsIdentities: [...PROJECTED_QUARANTINE],
    sections,
    publicationPlan: {
      mode: 'separate-f8x-overlay',
      overlayProductCount: products.length,
      baseRelease,
      priorQuarantine: {
        identityCount: PROJECTED_QUARANTINE.length,
        identitiesSha256: __test.dataSha256(PROJECTED_QUARANTINE),
      },
      incomingQuarantine: { identityCount: 0, identitiesSha256: __test.dataSha256([]) },
      projectedQuarantine: {
        identityCount: PROJECTED_QUARANTINE.length,
        identitiesSha256: __test.dataSha256(PROJECTED_QUARANTINE),
      },
      staticPlusBasePlusOverlayProductCount: 12_056,
    },
    publicationMergeAudit: {
      publishedOverlayProductCount: products.length,
      projectedQuarantinedIdentityCount: PROJECTED_QUARANTINE.length,
    },
    captureProgress: {
      stage: 'complete',
      complete: true,
      importPolicy: 'all-21-f8x-scopes-reconciled',
      requestedSectionCount: 7,
      includedSectionCount: 7,
      includedSections: [...SECTION_KEYS],
      excludedSections: [],
      sections: captureSections,
    },
    finalReleaseAudit: {
      schemaVersion: 1,
      kind: 'ecs-f8x-final-release-audit-verification',
      verifiedAtSourceTimestamp: GENERATED_AT,
      currentReviewedShardRelease: { ...binding },
      inputSetSha256,
      inputChecksums,
    },
  };
  const manifestContract = {
    overlayScope: {
      kind: 'bmw-f8x',
      profiles: [...PROFILE_KEYS],
      chassis: PROFILE_KEYS.map(key => F8X_FINAL_PROFILES[key].chassis),
      sections: [...SECTION_KEYS],
      complete: true,
    },
    baseRelease,
    finalAudit: {
      kind: finalAudit.finalReleaseAudit.kind,
      inputSetSha256,
      aggregateModuleSha256: inputChecksums.aggregateModule.sha256,
    },
    projectedQuarantine: {
      identities: [...PROJECTED_QUARANTINE],
      identityCount: PROJECTED_QUARANTINE.length,
      identitiesSha256: __test.dataSha256(PROJECTED_QUARANTINE),
    },
  };
  return { finalAudit, manifestContract };
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'projx-f8x-media-readiness-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const products = [
    product('900003', {
      media: 'missing', brandSupplied: false, detailedDescriptionAvailable: false,
    }),
    product('900001', { media: 'verified' }),
    product('900002', {
      media: 'missing', profiles: ['f82-m4'], sections: ['engine'],
    }),
  ];
  const { finalAudit, manifestContract } = auditParts(products);
  const release = buildReviewedProductShardRelease(products, finalAudit, {
    shardSize: 32,
    f8xOverlayContract: manifestContract,
  });
  const overlayReleaseDirectory = path.join(root, 'overlay-release');
  await writeReviewedProductShardRelease(overlayReleaseDirectory, release, {
    privateCandidate: true,
  });
  const finalAuditPath = path.join(root, 'f8x-final-release-audit.json');
  await writeFile(finalAuditPath, `${JSON.stringify(finalAudit, null, 2)}\n`);
  return {
    root, products, release, finalAudit, finalAuditPath, overlayReleaseDirectory,
  };
}

test('builds a deterministic distinct queue bound to the overlay release and exact final audit', async (t) => {
  const current = await fixture(t);
  const verified = await verifyF8xOverlayMediaRecoveryFiles({
    overlayReleaseDirectory: current.overlayReleaseDirectory,
    finalAuditPath: current.finalAuditPath,
    workDirectory: current.root,
  });
  assert.equal(verified.queue.kind, 'ecs-f8x-overlay-supplier-media-recovery-queue');
  assert.equal(verified.queue.sourceOverlayRelease.releaseId, current.release.manifest.releaseId);
  assert.equal(verified.queue.sourceOverlayRelease.productCount, 3);
  assert.equal(verified.queue.baseRelease.releaseId, current.release.manifest.baseRelease.releaseId);
  assert.equal(verified.queue.finalAudit.inputSetSha256,
    current.finalAudit.finalReleaseAudit.inputSetSha256);
  assert.equal(verified.queue.finalAudit.fileSha256, verified.inputChecksums.finalAudit.sha256);
  assert.equal(verified.queue.projectedQuarantine.identityCount, 1);
  assert.deepEqual(verified.queue.counts, {
    overlayProductCount: 3,
    recoveryCandidateCount: 2,
    verifiedSupplierMediaProductCount: 1,
    missingDescriptionCount: 1,
    missingBrandCount: 1,
    candidateScopeCount: 21,
    byVehicle: { 'f80-m3': 1, 'f82-m4': 2, 'f83-m4': 1 },
    bySection: {
      braking: 1, engine: 2, exterior: 1, interior: 1,
      performance: 1, steering: 1, suspension: 1,
    },
    byCategory: {
      'Braking Test Components': 1,
      'Engine Test Components': 2,
      'Exterior Test Components': 1,
      'Interior Test Components': 1,
      'Performance Test Components': 1,
      'Steering Test Components': 1,
      'Suspension Test Components': 1,
    },
  });
  assert.deepEqual(verified.queue.items.map(item => item.ecsPartNumber), ['ES#900002', 'ES#900003']);
  assert.equal(verified.queue.items[1].scopeObservations.length, 21);
  assert.deepEqual(verified.queue.items[1].profiles, PROFILE_KEYS);
  assert.deepEqual(verified.queue.items[1].sections, SECTION_KEYS);
  assert.match(verified.inputSetSha256, /^[a-f0-9]{64}$/);
  assert.match(verified.queueSha256, /^[a-f0-9]{64}$/);

  const loadedRelease = await readReviewedProductShardRelease(current.overlayReleaseDirectory);
  const reversed = buildF8xOverlayMediaRecoveryQueue({
    release: { ...loadedRelease, products: [...loadedRelease.products].reverse() },
    finalAudit: current.finalAudit,
    finalAuditSnapshot: {
      bytes: verified.inputChecksums.finalAudit.bytes,
      sha256: verified.inputChecksums.finalAudit.sha256,
    },
    inputSetSha256: verified.inputSetSha256,
  });
  assert.deepEqual(reversed, verified.queue);
});

test('supports checksum-pinned two-pass creation and refuses overwrite or drift', async (t) => {
  const current = await fixture(t);
  const verified = await verifyF8xOverlayMediaRecoveryFiles({
    overlayReleaseDirectory: current.overlayReleaseDirectory,
    finalAuditPath: current.finalAuditPath,
    workDirectory: current.root,
  });
  const pinned = await verifyF8xOverlayMediaRecoveryFiles({
    overlayReleaseDirectory: current.overlayReleaseDirectory,
    finalAuditPath: current.finalAuditPath,
    workDirectory: current.root,
    expectedInputSetSha256: verified.inputSetSha256,
  });
  const output = path.join(current.root, 'f8x-overlay-media-recovery-queue.json');
  const written = await writeF8xOverlayMediaRecoveryQueueCreateOnly(output, pinned.queue, pinned.roots);
  assert.equal(written.sha256, verified.queueSha256);
  assert.equal(JSON.parse(await readFile(output, 'utf8')).verification.inputSetSha256,
    verified.inputSetSha256);
  assert.equal(await readFile(`${output}.sha256`, 'utf8'),
    `${written.sha256}  ${path.basename(output)}\n`);
  await assert.rejects(
    writeF8xOverlayMediaRecoveryQueueCreateOnly(output, pinned.queue, pinned.roots),
    error => error instanceof F8xOverlayMediaRecoveryQueueError && error.code === 'output_exists',
  );
  await assert.rejects(
    writeF8xOverlayMediaRecoveryQueueCreateOnly(
      path.join(path.dirname(current.root), 'escaped-f8x-media-queue.json'),
      pinned.queue,
      pinned.roots,
    ),
    error => error instanceof F8xOverlayMediaRecoveryQueueError
      && error.code === 'invalid_output_path',
  );
  await assert.rejects(
    verifyF8xOverlayMediaRecoveryFiles({
      overlayReleaseDirectory: current.overlayReleaseDirectory,
      finalAuditPath: current.finalAuditPath,
      workDirectory: current.root,
      expectedInputSetSha256: 'f'.repeat(64),
    }),
    error => error instanceof F8xOverlayMediaRecoveryQueueError && error.code === 'checksum_drift',
  );
});

test('fails closed on final-audit, F8X scope and supplier-media conflicts', async (t) => {
  const current = await fixture(t);
  const verified = await verifyF8xOverlayMediaRecoveryFiles({
    overlayReleaseDirectory: current.overlayReleaseDirectory,
    finalAuditPath: current.finalAuditPath,
    workDirectory: current.root,
  });
  const release = await readReviewedProductShardRelease(current.overlayReleaseDirectory);
  const finalAuditSnapshot = {
    bytes: verified.inputChecksums.finalAudit.bytes,
    sha256: verified.inputChecksums.finalAudit.sha256,
  };
  const invoke = (audit, products = release.products) => buildF8xOverlayMediaRecoveryQueue({
    release: { ...release, products },
    finalAudit: audit,
    finalAuditSnapshot,
    inputSetSha256: verified.inputSetSha256,
  });

  const staleAudit = structuredClone(current.finalAudit);
  staleAudit.publicationPlan.overlayProductCount += 1;
  assert.throws(
    () => invoke(staleAudit),
    error => error instanceof F8xOverlayMediaRecoveryQueueError && error.code === 'final_audit_mismatch',
  );

  const badScope = structuredClone(release.products);
  delete badScope.find(item => item.ecsPartNumber === 'ES#900002').selectionSources[0].categoryKey;
  assert.throws(
    () => invoke(current.finalAudit, badScope),
    error => error instanceof F8xOverlayMediaRecoveryQueueError && error.code === 'invalid_f8x_scope',
  );

  const badMedia = structuredClone(release.products);
  const missing = badMedia.find(item => item.ecsPartNumber === 'ES#900003');
  missing.images = [{ src: 'https://example.com/not-ecs.jpg' }];
  assert.throws(
    () => invoke(current.finalAudit, badMedia),
    error => error instanceof F8xOverlayMediaRecoveryQueueError && error.code === 'invalid_media_state',
  );

  assert.throws(
    () => buildF8xOverlayMediaRecoveryQueue({
      release: {
        ...release,
        manifest: { ...release.manifest, kind: 'ecs-reviewed-product-shard-manifest' },
      },
      finalAudit: current.finalAudit,
      finalAuditSnapshot,
      inputSetSha256: verified.inputSetSha256,
    }),
    error => error instanceof F8xOverlayMediaRecoveryQueueError && error.code === 'invalid_input',
  );
});

test('CLI verify-only writes nothing and reports the exact candidate checksum', async (t) => {
  const current = await fixture(t);
  const script = path.resolve('scripts/ecs-catalog/build-f8x-overlay-media-recovery-queue.mjs');
  const result = spawnSync(process.execPath, [
    script,
    '--verify-only',
    '--work-dir', current.root,
    '--overlay-release', current.overlayReleaseDirectory,
    '--final-audit', current.finalAuditPath,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, 'verified-no-write');
  assert.equal(output.counts.recoveryCandidateCount, 2);
  assert.match(output.inputSetSha256, /^[a-f0-9]{64}$/);
  assert.match(output.queueSha256, /^[a-f0-9]{64}$/);
  await assert.rejects(readFile(path.join(current.root, 'media-recovery-queue.json')));
});
