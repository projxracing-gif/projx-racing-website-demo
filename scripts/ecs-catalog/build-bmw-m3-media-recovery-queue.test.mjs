import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildReviewedProductShardRelease,
  writeReviewedProductShardRelease
} from './build-reviewed-product-shards.mjs';
import {
  buildBmwM3MediaRecoveryQueue,
  loadBmwM3ReviewedShardRelease,
  writeBmwM3MediaRecoveryQueue
} from './build-bmw-m3-media-recovery-queue.mjs';

const TEST_SHA256 = 'a'.repeat(64);
const SCRIPT_PATH = fileURLToPath(new URL('./build-bmw-m3-media-recovery-queue.mjs', import.meta.url));

function runCli(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT_PATH, ...args], {
      cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function audit(productCount) {
  const requested = ['braking', 'engine', 'exterior', 'interior', 'performance', 'suspension', 'steering'];
  return {
    generatedAt: '2026-08-09T18:57:19.876Z',
    quarantinedIdentityCount: 0,
    sections: Object.fromEntries(requested.map(section => [section, {
      productCount: section === 'braking' ? productCount : 0
    }])),
    captureProgress: {
      complete: false,
      includedSections: ['braking'],
      sections: Object.fromEntries(requested.map(section => [section, {
        complete: section === 'braking',
        capturedPages: section === 'braking' ? 1 : 0,
        expectedPages: section === 'braking' ? 1 : 0,
        capturedPlacements: section === 'braking' ? productCount : 0,
        expectedPlacements: section === 'braking' ? productCount : 0
      }]))
    }
  };
}

function product(digits, overrides = {}) {
  const verified = overrides.imageStatus === 'supplier-media-verified';
  const imageSourceUrl = verified
    ? `https://assets.ecstuning.com/product_library/${digits}_x300.webp` : null;
  return {
    publicKey: `ecs-es-${digits}`,
    slug: `es-${digits}`,
    title: `BMW M3 Brake Product ${digits}`,
    titleAr: null,
    summary: `Supplier description ${digits}`,
    description: `Supplier description ${digits}`,
    detailedDescriptionAvailable: true,
    brand: 'ATE',
    brandSlug: 'ate',
    brandSupplied: true,
    section: 'Braking',
    category: 'Braking Parts',
    categorySlug: 'bmw-m3-braking',
    subcategory: 'BMW M3 Brake Pads',
    subcategorySlug: 'bmw-m3-braking-brake-pads',
    ecsPartNumber: `ES#${digits}`,
    sku: `ES#${digits}`,
    mpn: `MPN-${digits}`,
    identifiers: { ecs: `ES#${digits}`, sku: `ES#${digits}`, mpn: `MPN-${digits}` },
    originalUrl: `https://www.ecstuning.com/b-ate-parts/brake-product-${digits}/mpn-${digits}/`,
    imageStatus: verified ? 'supplier-media-verified' : 'supplier-media-unavailable',
    imageSourceUrl,
    images: verified ? [{ src: imageSourceUrl, sourceUrl: imageSourceUrl }] : [],
    priceAmount: 100,
    priceCurrency: 'USD',
    priceVerifiedAt: '2026-08-09',
    quoteOnly: false,
    checkedAt: '2026-08-09',
    staleAfterDays: 7,
    stockPolicy: 'manual-confirm',
    availabilityCode: 'check_availability',
    fitmentConfidence: 'possible',
    fitments: [{ make: 'BMW', model: 'M3', models: ['M3'], chassis: [], engines: [], confidence: 'possible' }],
    filters: { categories: ['bmw-m3', 'bmw-m3-braking'], subcategories: ['bmw-m3-braking-brake-pads'] },
    selectionSources: [{ section: 'Braking', category: 'BMW M3 Brake Pads' }],
    relatedProductSlugs: [],
    ...overrides
  };
}

async function fixture(products) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'projx-m3-media-recovery-'));
  const release = buildReviewedProductShardRelease(products, audit(products.length), { shardSize: 32 });
  await writeReviewedProductShardRelease(root, release);
  return { root, release };
}

function sourceProducts(products) {
  return products.map((item, index) => ({
    product: item,
    sourceShard: 'shard-00001.json',
    sourceProductIndex: index,
    sourceKey: `1:${index}`
  }));
}

test('loads a checksum-verified release and builds a deterministic private recovery queue', async (t) => {
  const products = [
    product('100001'),
    product('100002', { imageStatus: 'supplier-media-verified' }),
    product('100003', {
      brand: 'Supplier brand not provided', brandSlug: 'supplier-brand-not-provided',
      brandSupplied: false, detailedDescriptionAvailable: false,
      description: 'Supplier description unavailable; confirm product details before order.'
    })
  ];
  const current = await fixture(products);
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const loaded = await loadBmwM3ReviewedShardRelease(current.root);
  const first = buildBmwM3MediaRecoveryQueue(loaded.products, loaded.manifest, loaded.manifestSha256);
  const second = buildBmwM3MediaRecoveryQueue(
    [...loaded.products].reverse(), loaded.manifest, loaded.manifestSha256
  );
  assert.deepEqual(first, second);
  assert.equal(first.counts.recoveryCandidateCount, 2);
  assert.equal(first.counts.missingDescriptionCount, 1);
  assert.equal(first.counts.missingBrandCount, 1);
  assert.deepEqual(first.counts.bySection, { Braking: 2 });
  assert.equal(first.items[0].ecsPartNumber, 'ES#100001');
  assert.equal(first.items[1].brand, null);
  assert.equal(first.items[1].missingDescription, true);
  assert.match(first.identitySetSha256, /^[a-f0-9]{64}$/);
  assert.match(first.recordsSha256, /^[a-f0-9]{64}$/);

  const output = path.join(current.root, 'private-imports', 'queue.json');
  const written = await writeBmwM3MediaRecoveryQueue(output, first, {
    repositoryRoot: current.root
  });
  const queueBytes = await readFile(output);
  const sidecar = await readFile(`${output}.sha256`, 'utf8');
  assert.equal(queueBytes.length, written.bytes);
  assert.equal(sidecar, `${written.sha256}  queue.json\n`);
});

test('writer rejects tracked and arbitrary output paths before creating a file', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'projx-m3-media-output-scope-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'projx-m3-media-outside-'));
  t.after(() => Promise.all([
    rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })
  ]));
  const queue = { kind: 'test-private-queue', items: [] };
  for (const output of [path.join(root, 'package.json'), path.join(outside, 'queue.json')]) {
    await assert.rejects(
      () => writeBmwM3MediaRecoveryQueue(output, queue, { repositoryRoot: root }),
      error => error?.code === 'unsafe_output_path'
    );
    await assert.rejects(() => readFile(output), error => error?.code === 'ENOENT');
  }
});

test('CLI rejects relative and absolute --output paths outside repository private-imports', async (t) => {
  const current = await fixture([product('150001')]);
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'projx-m3-media-cli-cwd-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'projx-m3-media-cli-outside-'));
  t.after(() => Promise.all([
    rm(current.root, { recursive: true, force: true }),
    rm(cwd, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true })
  ]));
  const outputs = [path.join(cwd, 'package.json'), path.join(outside, 'queue.json')];
  for (const output of outputs) {
    const suppliedOutput = output === outputs[0] ? 'package.json' : output;
    const result = await runCli([
      '--source-dir', current.root, '--output', suppliedOutput
    ], cwd);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^unsafe_output_path:/);
    await assert.rejects(() => readFile(output), error => error?.code === 'ENOENT');
  }
});

test('writer refuses an existing queue or checksum sidecar without changing either', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'projx-m3-media-no-overwrite-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const privateRoot = path.join(root, 'private-imports');
  await mkdir(privateRoot);
  const existingOutput = path.join(privateRoot, 'existing-output.json');
  const existingSidecar = path.join(privateRoot, 'existing-sidecar.json.sha256');
  await writeFile(existingOutput, 'approved queue\n');
  await writeFile(existingSidecar, 'approved checksum\n');
  const queue = { kind: 'test-private-queue', items: [] };
  await assert.rejects(
    () => writeBmwM3MediaRecoveryQueue(existingOutput, queue, { repositoryRoot: root }),
    error => error?.code === 'output_exists'
  );
  await assert.rejects(
    () => writeBmwM3MediaRecoveryQueue(
      path.join(privateRoot, 'existing-sidecar.json'), queue, { repositoryRoot: root }
    ),
    error => error?.code === 'output_exists'
  );
  assert.equal(await readFile(existingOutput, 'utf8'), 'approved queue\n');
  assert.equal(await readFile(existingSidecar, 'utf8'), 'approved checksum\n');
});

test('writer rejects a private parent symlink without writing through it', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'projx-m3-media-link-root-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'projx-m3-media-link-outside-'));
  t.after(() => Promise.all([
    rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })
  ]));
  const privateRoot = path.join(root, 'private-imports');
  await mkdir(privateRoot);
  const link = path.join(privateRoot, 'escape');
  try {
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
      t.skip(`Directory links are unavailable in this environment: ${error.code}`);
      return;
    }
    throw error;
  }
  const escapedOutput = path.join(link, 'queue.json');
  await assert.rejects(
    () => writeBmwM3MediaRecoveryQueue(escapedOutput, { items: [] }, { repositoryRoot: root }),
    error => error?.code === 'unsafe_output_path'
  );
  await assert.rejects(
    () => readFile(path.join(outside, 'queue.json')),
    error => error?.code === 'ENOENT'
  );
});

test('foreign, query-bearing and fragment-bearing product URLs fail closed', async () => {
  const current = await fixture([product('200001')]);
  const manifest = current.release.manifest;
  await rm(current.root, { recursive: true, force: true });
  for (const invalidUrl of [
    'http://www.ecstuning.com/b-ate-parts/item/mpn/',
    'https://example.com/b-ate-parts/item/mpn/',
    'https://www.ecstuning.com:443/b-ate-parts/item/mpn/',
    'https://www.ecstuning.com/b-ate-parts/item/mpn/?tracking=1',
    'https://www.ecstuning.com/b-ate-parts/item/mpn/#media'
  ]) {
    const invalid = product('200001', { originalUrl: invalidUrl });
    assert.throws(
      () => buildBmwM3MediaRecoveryQueue(sourceProducts([invalid]), manifest, TEST_SHA256),
      error => error?.code === 'invalid_product_url'
    );
  }
});

test('duplicate and conflicting ECS identities fail closed', async () => {
  const current = await fixture([product('300001'), product('300002')]);
  const manifest = current.release.manifest;
  await rm(current.root, { recursive: true, force: true });
  assert.throws(
    () => buildBmwM3MediaRecoveryQueue(
      sourceProducts([product('300001'), product('300001')]), manifest, TEST_SHA256
    ),
    error => error?.code === 'duplicate_identity'
  );
  const conflicting = product('300001', { sku: 'ES#300002' });
  assert.throws(
    () => buildBmwM3MediaRecoveryQueue(sourceProducts([conflicting]), {
      ...manifest, counts: { ...manifest.counts, productCount: 1, routeCount: 1 }
    }, TEST_SHA256),
    error => error?.code === 'conflicting_identity'
  );
  const duplicateUrl = product('300002', { originalUrl: product('300001').originalUrl });
  assert.throws(
    () => buildBmwM3MediaRecoveryQueue(
      sourceProducts([product('300001'), duplicateUrl]), manifest, TEST_SHA256
    ),
    error => error?.code === 'conflicting_identity'
  );
});

test('an unavailable-media record carrying an image fails closed', async () => {
  const current = await fixture([product('400001')]);
  const manifest = current.release.manifest;
  await rm(current.root, { recursive: true, force: true });
  const conflict = product('400001', {
    imageSourceUrl: 'https://assets.ecstuning.com/product_library/400001_x300.webp',
    images: [{ src: 'https://assets.ecstuning.com/product_library/400001_x300.webp' }]
  });
  assert.throws(
    () => buildBmwM3MediaRecoveryQueue(sourceProducts([conflict]), manifest, TEST_SHA256),
    error => error?.code === 'invalid_media_state'
  );
});

test('shard checksum drift is rejected before queue creation', async (t) => {
  const products = [product('500001'), product('500002')];
  const current = await fixture(products);
  t.after(() => rm(current.root, { recursive: true, force: true }));
  await writeFile(path.join(current.root, 'shard-00001.json'), '{}\n');
  await assert.rejects(
    () => loadBmwM3ReviewedShardRelease(current.root),
    error => error?.code === 'shard_checksum_mismatch'
  );
});

test('content-set checksum drift is rejected even with a valid manifest sidecar', async (t) => {
  const current = await fixture([product('600001'), product('600002')]);
  t.after(() => rm(current.root, { recursive: true, force: true }));
  const manifestPath = path.join(current.root, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.contentSetSha256 = 'b'.repeat(64);
  const buffer = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeFile(manifestPath, buffer);
  await writeFile(`${manifestPath}.sha256`, `${digest(buffer)}  manifest.json\n`, 'utf8');
  await assert.rejects(
    () => loadBmwM3ReviewedShardRelease(current.root),
    error => error?.code === 'content_set_checksum_mismatch'
  );
});
