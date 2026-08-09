import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  __test,
  canonicalBmwM3ListingUrl,
  canonicalOfficialImageUrl,
  captureEcsBmwM3PageAssets,
  matchInventoryAssets,
  requestedImages,
} from './capture-bmw-m3-page-assets.mjs';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

test('allows only exact public BMW M3 listing checkpoints', () => {
  assert.equal(
    canonicalBmwM3ListingUrl('https://www.ecstuning.com/BMW-M3/Braking/Fluid/3', 'braking'),
    'https://www.ecstuning.com/BMW-M3/Braking/Fluid/3',
  );
  assert.equal(canonicalBmwM3ListingUrl('https://www.ecstuning.com/BMW-M3/Engine/', 'braking'), null);
  assert.equal(canonicalBmwM3ListingUrl('https://www.ecstuning.com/BMW-M3/Engine/?page=2', 'engine'), null);
  assert.equal(canonicalBmwM3ListingUrl('https://example.com/BMW-M3/Engine/', 'engine'), null);
});

test('allows official product media but rejects placeholders and foreign URLs', () => {
  assert.equal(
    canonicalOfficialImageUrl('https://assets.ecstuning.com/product_library/25194_x300.webp'),
    'https://assets.ecstuning.com/product_library/25194_x300.webp',
  );
  assert.equal(canonicalOfficialImageUrl('https://assets.ecstuning.com/product_library/ecs_box_no_image.webp'), null);
  assert.equal(canonicalOfficialImageUrl('https://example.com/product.webp'), null);
  assert.equal(canonicalOfficialImageUrl('http://assets.ecstuning.com/product.webp'), null);
});

test('requests primary images and safely aliases an observed fallback', () => {
  const checkpoint = {
    records: [
      {
        ecsDigits: '123456',
        primaryUrl: 'https://assets.ecstuning.com/product_library/123_x300.webp',
        fallbackUrl: 'https://assets.ecstuning.com/product_library/123_x300.jpg',
      },
      { ecsDigits: '654321', primaryUrl: null, fallbackUrl: null },
    ],
  };
  const requested = requestedImages(checkpoint, new Map());
  assert.equal(requested.length, 1);
  const matched = matchInventoryAssets(requested, {
    assets: [{
      id: 'image-1',
      kind: 'image',
      url: 'https://assets.ecstuning.com/product_library/123_x300.jpg',
    }],
  });
  assert.deepEqual(matched.assets.map((asset) => asset.id), ['image-1']);
  assert.deepEqual(matched.aliases, [{
    assetId: 'image-1',
    downloadedFromUrl: 'https://assets.ecstuning.com/product_library/123_x300.jpg',
    sourceUrl: 'https://assets.ecstuning.com/product_library/123_x300.webp',
  }]);
  assert.deepEqual(matched.missing, []);
});

test('validates a durable BMW M3 page checkpoint before media use', () => {
  const checkpoint = __test.validateCheckpoint({
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    accessClass: 'public-retail',
    kind: 'bmw-m3-section-listing-page',
    vehicle: 'BMW M3',
    section: 'Engine',
    categoryKey: 'bmw-m3-intake',
    categoryUrl: 'https://www.ecstuning.com/BMW-M3/Engine/Intake/',
    page: 2,
    sourceUrl: 'https://www.ecstuning.com/BMW-M3/Engine/Intake/2',
    expected: 1,
    observedAt: '2026-08-09T12:00:00.000Z',
    records: [{
      ecsPartNumber: 'ES#123456',
      vehicle: 'BMW M3',
      section: 'Engine',
      imageUrl: 'https://assets.ecstuning.com/product_library/123_x300.webp',
      imageFallbackUrl: 'https://assets.ecstuning.com/product_library/123_x300.jpg',
    }],
  }, 'engine');
  assert.equal(checkpoint.page, 2);
  assert.equal(checkpoint.records[0].ecsDigits, '123456');
});

test('fails closed when a source URL maps to conflicting local bytes', () => {
  const existing = new Map([['https://assets.ecstuning.com/product_library/1.webp', {
    sourceUrl: 'https://assets.ecstuning.com/product_library/1.webp',
    localPath: 'assets/products/ecs/bmw-m3/one.webp',
    sha256: 'a'.repeat(64),
  }]]);
  assert.throws(() => __test.mergeMappings(existing, [{
    sourceUrl: 'https://assets.ecstuning.com/product_library/1.webp',
    localPath: 'assets/products/ecs/bmw-m3/two.webp',
    sha256: 'b'.repeat(64),
  }]), /Conflicting BMW M3 browser media/);
});

test('materializes one exact browser-observed checkpoint and resumes from its index', async (context) => {
  const nonce = randomUUID();
  const captureDir = path.join(REPO, 'private-imports', `.media-test-${nonce}`);
  const outputDir = path.join(REPO, 'assets', 'products', 'ecs', `.media-test-${nonce}`);
  const browserAssetDir = path.join(tmpdir(), 'browser-use', 'assets', `.media-test-${nonce}`);
  context.after(async () => {
    await Promise.all([
      rm(captureDir, { force: true, recursive: true }),
      rm(outputDir, { force: true, recursive: true }),
      rm(browserAssetDir, { force: true, recursive: true }),
    ]);
  });
  await Promise.all([
    mkdir(path.join(captureDir, 'braking', 'raw-pages'), { recursive: true }),
    mkdir(browserAssetDir, { recursive: true }),
  ]);
  const sourceUrl = 'https://www.ecstuning.com/BMW-M3/Braking/Fluid/';
  const imageUrl = 'https://assets.ecstuning.com/product_library/123_x300.webp';
  await writeFile(path.join(captureDir, 'braking', 'raw-pages', 'braking-fluid-p1.json'), `${JSON.stringify({
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    accessClass: 'public-retail',
    kind: 'bmw-m3-section-listing-page',
    vehicle: 'BMW M3',
    section: 'Braking',
    categoryKey: 'bmw-m3-brake-fluid',
    categoryUrl: sourceUrl,
    page: 1,
    sourceUrl,
    expected: 1,
    observedAt: '2026-08-09T12:00:00.000Z',
    records: [{
      ecsPartNumber: 'ES#123456',
      vehicle: 'BMW M3',
      section: 'Braking',
      imageUrl,
      imageFallbackUrl: 'https://assets.ecstuning.com/product_library/123_x300.jpg',
    }],
  }, null, 2)}\n`, 'utf8');
  const image = Buffer.alloc(40);
  image.write('RIFF', 0, 'ascii');
  image.writeUInt32LE(32, 4);
  image.write('WEBP', 8, 'ascii');
  image.write('VP8X', 12, 'ascii');
  image.writeUInt32LE(10, 16);
  image[24] = 99;
  image[27] = 199;
  const bundlePath = path.join(browserAssetDir, 'image.webp');
  await writeFile(bundlePath, image);
  let currentUrl = 'https://www.ecstuning.com/BMW-M3/';
  let bundleCalls = 0;
  const adapter = {
    async getCurrentUrl() { return currentUrl; },
    async goto(url) { currentUrl = url; },
    async wait() {},
    async getPageState() { return { title: 'Brake Fluid', url: currentUrl, bodyText: 'Products' }; },
    async getRenderedListingCount() { return 1; },
    async prepareAssets() {},
    async listAssets() {
      return {
        id: 'inventory-1',
        pageUrl: currentUrl,
        assets: [{ id: 'asset-1', kind: 'image', url: imageUrl }],
      };
    },
    async bundleAssets() {
      bundleCalls += 1;
      return {
        assets: [{ id: 'asset-1', contentType: 'image/webp', path: bundlePath }],
        failures: [],
      };
    },
  };
  const options = {
    captureDir,
    outputDir,
    indexPath: path.join(captureDir, 'media-index.json'),
    statePath: path.join(captureDir, 'media-capture-state.json'),
    sections: ['braking'],
    pageBudget: 1,
    navigationDelayMs: 0,
    assetSettleDelayMs: 0,
  };
  const first = await captureEcsBmwM3PageAssets(adapter, options);
  assert.equal(first.addedMappings, 1);
  assert.equal(first.totalMappings, 1);
  const index = JSON.parse(await readFile(options.indexPath, 'utf8'));
  assert.equal(index.images[0].sourceUrl, imageUrl);
  assert.deepEqual({ width: index.images[0].width, height: index.images[0].height }, { width: 100, height: 200 });
  assert.match(index.images[0].localPath, /^assets\/products\/ecs\/\.media-test-[^/]+\/[a-f0-9]{24}\.webp$/);
  const second = await captureEcsBmwM3PageAssets(adapter, options);
  assert.equal(second.attemptedPages, 0);
  assert.equal(bundleCalls, 1);
});
