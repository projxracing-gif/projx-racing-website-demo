import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildBmwM3MediaRecoveryQueue,
  writeBmwM3MediaRecoveryQueue,
} from './build-bmw-m3-media-recovery-queue.mjs';
import {
  loadBmwM3MediaRecoveryQueue,
  runBmwM3MediaRecoveryBrowser,
} from './run-bmw-m3-media-recovery.mjs';

const FIXED_NOW = () => new Date('2026-08-10T00:00:00.000Z');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sourceProduct(digits, overrides = {}) {
  return {
    publicKey: `ecs-es-${digits}`,
    slug: `es-${digits}`,
    title: `BMW M3 Recovery Product ${digits}`,
    brand: 'ATE',
    brandSupplied: true,
    section: 'Braking',
    subcategory: 'BMW M3 Brake Pads',
    ecsPartNumber: `ES#${digits}`,
    sku: `ES#${digits}`,
    mpn: `MPN-${digits}`,
    identifiers: { ecs: `ES#${digits}`, sku: `ES#${digits}`, mpn: `MPN-${digits}` },
    originalUrl: `https://www.ecstuning.com/b-ate-parts/recovery-product-${digits}/mpn-${digits}/`,
    imageStatus: 'supplier-media-unavailable',
    imageSourceUrl: null,
    images: [],
    detailedDescriptionAvailable: true,
    ...overrides,
  };
}

function queueManifest(productCount) {
  return {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    kind: 'ecs-reviewed-product-shard-manifest',
    releaseId: '20260809T185719876Z-1111111111111111',
    generatedAt: '2026-08-09T18:57:19.876Z',
    contentSetSha256: 'b'.repeat(64),
    includedSections: ['braking'],
    shards: [{}],
    counts: { productCount, routeCount: productCount, shardCount: 1 },
  };
}

async function fixture(t, products) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'projx-m3-detail-recovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sources = products.map((product, index) => ({
    product,
    sourceShard: 'shard-00001.json',
    sourceProductIndex: index,
    sourceKey: `1:${index}`,
  }));
  const queue = buildBmwM3MediaRecoveryQueue(sources, queueManifest(products.length), 'a'.repeat(64));
  const queuePath = path.join(root, 'private-imports', 'queue.json');
  const written = await writeBmwM3MediaRecoveryQueue(queuePath, queue, { repositoryRoot: root });
  const expectations = {
    queueSha256: written.sha256,
    releaseId: queue.sourceRelease.releaseId,
    recoveryCandidateCount: queue.counts.recoveryCandidateCount,
    identitySetSha256: queue.identitySetSha256,
    recordsSha256: queue.recordsSha256,
  };
  return {
    root,
    queue,
    queuePath,
    expectations,
    outputDir: path.join(root, 'private-imports', 'runner'),
  };
}

function pageEvidence(item, overrides = {}) {
  const product = {
    ecsPartNumber: item.ecsPartNumber,
    mpn: item.mpn,
    title: item.title,
    brand: null,
    description: null,
    ...(overrides.product || {}),
  };
  return {
    url: item.productUrl,
    canonicalUrl: item.productUrl,
    documentTitle: item.title,
    challenge: false,
    product,
    media: [],
    ...overrides,
    product,
  };
}

function injectedAdapter(resolveEvidence, initialUrl = 'about:blank') {
  let currentUrl = initialUrl;
  const calls = { goto: [], wait: [], evidence: [] };
  return {
    calls,
    adapter: {
      async getCurrentUrl() { return currentUrl; },
      async goto(url) { calls.goto.push(url); currentUrl = url; },
      async wait(milliseconds) { calls.wait.push(milliseconds); },
      async getProductPageEvidence() {
        calls.evidence.push(currentUrl);
        return resolveEvidence(currentUrl);
      },
    },
  };
}

function runOptions(current, overrides = {}) {
  return {
    queuePath: current.queuePath,
    outputDir: current.outputDir,
    pageBudget: 10,
    navigationDelayMs: 0,
    now: FIXED_NOW,
    repositoryRoot: current.root,
    expectations: current.expectations,
    ...overrides,
  };
}

test('captures exact product media plus requested brand and description into one private checkpoint', async (t) => {
  const current = await fixture(t, [sourceProduct('100001', {
    brand: 'Supplier brand not provided', brandSupplied: false,
    detailedDescriptionAvailable: false,
  })]);
  const item = current.queue.items[0];
  const evidence = pageEvidence(item, {
    product: { brand: 'ATE', description: 'Authoritative product description.' },
    media: [
      {
        url: 'https://assets.ecstuning.com/product_library/100001_x800.webp',
        role: 'primary',
        evidence: 'product-gallery-source',
      },
      {
        url: 'https://assets.ecstuning.com/product_library/100001_x800.jpg',
        role: 'fallback',
        evidence: 'product-gallery-image',
      },
    ],
  });
  const injected = injectedAdapter(() => evidence);
  const result = await runBmwM3MediaRecoveryBrowser(injected.adapter, runOptions(current));
  assert.equal(result.status, 'complete');
  assert.equal(result.counts.completed, 1);
  assert.equal(result.counts.mediaRecovered, 1);
  assert.equal(result.counts.brandsRecovered, 1);
  assert.equal(result.counts.descriptionsRecovered, 1);
  assert.deepEqual(injected.calls.goto, [item.productUrl]);
  const checkpoint = JSON.parse(await readFile(
    path.join(current.outputDir, 'checkpoints', 'es-100001.json'), 'utf8'
  ));
  assert.equal(checkpoint.payload.status, 'media-recovered');
  assert.equal(checkpoint.payload.recovered.brand, 'ATE');
  assert.equal(checkpoint.payload.recovered.description, 'Authoritative product description.');
  assert.equal(checkpoint.payload.media.length, 2);
  assert.equal(JSON.stringify(checkpoint).includes('price'), false);
  assert.equal(JSON.stringify(checkpoint).includes('stock'), false);
  assert.equal(JSON.stringify(checkpoint).includes('fitment'), false);
});

test('records an authoritative no-image result without inventing a media URL', async (t) => {
  const current = await fixture(t, [sourceProduct('100002')]);
  const item = current.queue.items[0];
  const injected = injectedAdapter(() => pageEvidence(item));
  const result = await runBmwM3MediaRecoveryBrowser(injected.adapter, runOptions(current));
  assert.equal(result.status, 'complete');
  assert.equal(result.counts.noSupplierMediaObserved, 1);
  const checkpoint = JSON.parse(await readFile(
    path.join(current.outputDir, 'checkpoints', 'es-100002.json'), 'utf8'
  ));
  assert.deepEqual(checkpoint.payload.media, []);
  assert.equal(checkpoint.payload.status, 'no-supplier-media-observed');
});

test('stops immediately on an interactive challenge and does not visit the next product', async (t) => {
  const current = await fixture(t, [sourceProduct('100003'), sourceProduct('100004')]);
  const first = current.queue.items[0];
  const injected = injectedAdapter(() => pageEvidence(first, {
    documentTitle: 'Just a moment...', challenge: true,
  }));
  const result = await runBmwM3MediaRecoveryBrowser(injected.adapter, runOptions(current));
  assert.equal(result.status, 'challenge-stopped');
  assert.equal(result.stoppedCode, 'interactive_challenge');
  assert.equal(result.counts.completed, 0);
  assert.deepEqual(injected.calls.goto, [first.productUrl]);
  assert.deepEqual(await readdir(path.join(current.outputDir, 'checkpoints')), []);
});

test('identity mismatch is quarantined and fails closed', async (t) => {
  const current = await fixture(t, [sourceProduct('100005')]);
  const item = current.queue.items[0];
  const injected = injectedAdapter(() => pageEvidence(item, {
    product: { ecsPartNumber: 'ES#999999', mpn: item.mpn, title: item.title },
  }));
  await assert.rejects(
    runBmwM3MediaRecoveryBrowser(injected.adapter, runOptions(current)),
    error => error?.code === 'product_identity_conflict'
  );
  assert.deepEqual(await readdir(path.join(current.outputDir, 'quarantine')),
    ['es-100005-product_identity_conflict.json']);
  assert.deepEqual(await readdir(path.join(current.outputDir, 'checkpoints')), []);
});

test('foreign or generic product media is quarantined and never checkpointed', async (t) => {
  for (const [digits, mediaUrl] of [
    ['100006', 'https://example.com/product_library/100006.jpg'],
    ['100007', 'https://assets.ecstuning.com/product_library/ecs_box_no_image.jpg'],
  ]) {
    await t.test(mediaUrl, async (nested) => {
      const current = await fixture(nested, [sourceProduct(digits)]);
      const item = current.queue.items[0];
      const injected = injectedAdapter(() => pageEvidence(item, {
        media: [{ url: mediaUrl, role: 'primary', evidence: 'product-gallery-image' }],
      }));
      await assert.rejects(
        runBmwM3MediaRecoveryBrowser(injected.adapter, runOptions(current)),
        error => error?.code === 'product_media_conflict'
      );
      assert.equal((await readdir(path.join(current.outputDir, 'quarantine'))).length, 1);
      assert.deepEqual(await readdir(path.join(current.outputDir, 'checkpoints')), []);
    });
  }
});

test('a canonical redirect mismatch is quarantined and fails before media acceptance', async (t) => {
  const current = await fixture(t, [sourceProduct('100008')]);
  const item = current.queue.items[0];
  const redirected = 'https://www.ecstuning.com/b-ate-parts/different-product/different-mpn/';
  const injected = injectedAdapter(() => pageEvidence(item, { url: redirected }));
  await assert.rejects(
    runBmwM3MediaRecoveryBrowser(injected.adapter, runOptions(current)),
    error => error?.code === 'canonical_page_conflict'
  );
  assert.deepEqual(await readdir(path.join(current.outputDir, 'quarantine')),
    ['es-100008-canonical_page_conflict.json']);
});

test('bounded reruns resume from verified checkpoints without revisiting completed products', async (t) => {
  const current = await fixture(t, [sourceProduct('100009'), sourceProduct('100010')]);
  const byUrl = new Map(current.queue.items.map(item => [item.productUrl, item]));
  const firstRun = injectedAdapter(url => pageEvidence(byUrl.get(url)));
  const first = await runBmwM3MediaRecoveryBrowser(firstRun.adapter,
    runOptions(current, { pageBudget: 1 }));
  assert.equal(first.status, 'budget-exhausted');
  assert.equal(first.counts.completed, 1);
  const completedUrl = firstRun.calls.goto[0];
  const secondRun = injectedAdapter(url => {
    assert.notEqual(url, completedUrl);
    return pageEvidence(byUrl.get(url));
  });
  const second = await runBmwM3MediaRecoveryBrowser(secondRun.adapter,
    runOptions(current, { pageBudget: 1 }));
  assert.equal(second.status, 'complete');
  assert.equal(second.counts.completed, 2);
  assert.equal(second.counts.resumedAtStart, 1);
  assert.equal(secondRun.calls.goto.length, 1);
});

test('queue checksum drift and duplicate identities fail before adapter navigation', async (t) => {
  await t.test('checksum drift', async (nested) => {
    const current = await fixture(nested, [sourceProduct('100011')]);
    await writeFile(current.queuePath, `${await readFile(current.queuePath, 'utf8')} `, 'utf8');
    const injected = injectedAdapter(() => { throw new Error('must not run'); });
    await assert.rejects(
      runBmwM3MediaRecoveryBrowser(injected.adapter, runOptions(current)),
      error => error?.code === 'queue_checksum_mismatch'
    );
    assert.deepEqual(injected.calls.goto, []);
  });
  await t.test('duplicate identity', async (nested) => {
    const current = await fixture(nested, [sourceProduct('100012')]);
    const duplicate = structuredClone(current.queue);
    duplicate.items.push(structuredClone(duplicate.items[0]));
    duplicate.counts.recoveryCandidateCount = 2;
    duplicate.counts.missingDescriptionCount *= 2;
    duplicate.counts.missingBrandCount *= 2;
    duplicate.counts.bySection.Braking = 2;
    duplicate.counts.byCategory['BMW M3 Brake Pads'] = 2;
    duplicate.recordsSha256 = sha256(Buffer.from(`${JSON.stringify(duplicate.items)}\n`));
    const bytes = Buffer.from(`${JSON.stringify(duplicate, null, 2)}\n`);
    await writeFile(current.queuePath, bytes);
    await writeFile(`${current.queuePath}.sha256`, `${sha256(bytes)}  queue.json\n`, 'utf8');
    const injected = injectedAdapter(() => { throw new Error('must not run'); });
    await assert.rejects(
      loadBmwM3MediaRecoveryQueue(current.queuePath, {
        repositoryRoot: current.root,
        expectations: null,
      }),
      error => error?.code === 'duplicate_queue_identity'
    );
    assert.deepEqual(injected.calls.goto, []);
  });
});

test('output confinement and immutable checkpoint validation prevent unsafe overwrite', async (t) => {
  const current = await fixture(t, [sourceProduct('100013')]);
  const item = current.queue.items[0];
  const injected = injectedAdapter(() => pageEvidence(item));
  const outside = path.join(current.root, 'outside-runner');
  await assert.rejects(
    runBmwM3MediaRecoveryBrowser(injected.adapter, runOptions(current, { outputDir: outside })),
    error => error?.code === 'unsafe_private_path'
  );
  assert.deepEqual(injected.calls.goto, []);
  const checkpoints = path.join(current.outputDir, 'checkpoints');
  await mkdir(checkpoints, { recursive: true });
  const protectedCheckpoint = path.join(checkpoints, 'es-100013.json');
  await writeFile(protectedCheckpoint, 'approved checkpoint must not be replaced\n', 'utf8');
  await assert.rejects(
    runBmwM3MediaRecoveryBrowser(injected.adapter, runOptions(current)),
    error => error?.code === 'invalid_checkpoint'
  );
  assert.equal(await readFile(protectedCheckpoint, 'utf8'), 'approved checkpoint must not be replaced\n');
  assert.deepEqual(injected.calls.goto, []);
});
