import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  __test,
  BmwM3MediaPublishError,
  publishBmwM3Media,
  publicBlobUrl,
} from './publish-bmw-m3-media.mjs';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const TOKEN = 'test_blob_token_1234567890';
const OIDC_TOKEN = 'test_oidc_token_1234567890';
const STORE_ID = 'store_testblob1234567890';
const GENERATED_AT = '2026-08-09T12:00:00.000Z';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function webp(width = 100, height = 200) {
  const image = Buffer.alloc(40);
  image.write('RIFF', 0, 'ascii');
  image.writeUInt32LE(32, 4);
  image.write('WEBP', 8, 'ascii');
  image.write('VP8X', 12, 'ascii');
  image.writeUInt32LE(10, 16);
  image.writeUIntLE(width - 1, 24, 3);
  image.writeUIntLE(height - 1, 27, 3);
  return image;
}

async function fixture(context, overrides = {}) {
  const nonce = randomUUID();
  const mediaDir = path.join(REPO, 'assets', 'products', 'ecs', `.publisher-test-${nonce}`);
  const privateDir = path.join(REPO, 'private-imports', `.publisher-test-${nonce}`);
  await Promise.all([
    mkdir(mediaDir, { recursive: true }),
    mkdir(privateDir, { recursive: true }),
  ]);
  context.after(async () => {
    await Promise.all([
      rm(mediaDir, { recursive: true, force: true }),
      rm(privateDir, { recursive: true, force: true }),
    ]);
  });
  const bytes = overrides.bytes || webp();
  const digest = sha256(bytes);
  const localFilename = path.join(mediaDir, `${digest.slice(0, 24)}.webp`);
  await writeFile(localFilename, bytes);
  const indexPath = path.join(privateDir, 'media-index.json');
  const outputPath = path.join(privateDir, 'published-media-index.json');
  await writeFile(indexPath, `${JSON.stringify({
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    generatedAt: Object.hasOwn(overrides, 'generatedAt') ? overrides.generatedAt : GENERATED_AT,
    images: overrides.images ?? [{
      sourceUrl: 'https://assets.ecstuning.com/product_library/123_x300.webp',
      localPath: path.relative(REPO, localFilename).replaceAll('\\', '/'),
      width: 100,
      height: 200,
      contentType: 'image/webp',
      sha256: digest,
    }],
  }, null, 2)}\n`, 'utf8');
  return { bytes, digest, indexPath, outputPath };
}

function memorySdk({ metadata = {}, uploadError = null } = {}) {
  const objects = new Map();
  const putCalls = [];
  const getCalls = [];
  const url = (pathname) => `https://projx-test.public.blob.vercel-storage.com/${pathname}`;
  return {
    putCalls,
    getCalls,
    async put(pathname, bytes, options) {
      putCalls.push({ pathname, bytes: Buffer.from(bytes), options });
      if (uploadError) throw uploadError;
      objects.set(pathname, {
        bytes: Buffer.from(bytes),
        contentType: options.contentType,
      });
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
            controller.enqueue(object.bytes);
            controller.close();
          },
        }),
        blob: {
          url: url(pathname),
          pathname: metadata.pathname ?? pathname,
          size: metadata.size ?? object.bytes.length,
          contentType: metadata.contentType ?? object.contentType,
        },
      };
    },
  };
}

test('validates a local index without retaining the full catalogue bytes', async (context) => {
  const item = await fixture(context);
  const local = await __test.loadVerifiedIndex(item.indexPath);
  assert.equal(local.totalBytes, item.bytes.length);
  assert.equal(local.files.size, 1);
  const [file] = local.files.values();
  assert.equal(file.byteLength, item.bytes.length);
  assert.equal(file.bytes, undefined);
  assert.match(file.filename, /\.webp$/);
});

test('bounds parallel uploads and waits for in-flight work to settle', async () => {
  let active = 0;
  let maximum = 0;
  const completed = [];
  await __test.publishFiles([1, 2, 3, 4, 5, 6], 3, async (value) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    completed.push(value);
    active -= 1;
  });
  assert.equal(maximum, 3);
  assert.deepEqual(completed.sort((left, right) => left - right), [1, 2, 3, 4, 5, 6]);
  assert.throws(
    () => __test.uploadConcurrency(9),
    (error) => error instanceof BmwM3MediaPublishError && error.code === 'invalid_concurrency',
  );
});

test('publishes immutable verified media and writes a separate public index', async (context) => {
  const item = await fixture(context);
  const sdk = memorySdk();
  const result = await publishBmwM3Media({
    indexPath: item.indexPath,
    outputPath: item.outputPath,
    dryRun: false,
    previewConfirmed: true,
    token: TOKEN,
    oidcToken: '',
    storeId: '',
    blobSdk: sdk,
    now: Date.parse('2026-08-09T13:00:00.000Z'),
  });
  assert.equal(result.status, 'published');
  assert.equal(sdk.putCalls.length, 1);
  assert.equal(sdk.putCalls[0].options.allowOverwrite, false);
  assert.equal(sdk.putCalls[0].options.token, TOKEN);
  assert.equal(sdk.putCalls[0].options.maximumSizeInBytes, 25_000_000);
  const output = JSON.parse(await readFile(item.outputPath, 'utf8'));
  assert.equal(output.images.length, 1);
  assert.equal(output.images[0].sha256, item.digest);
  assert.equal(output.images[0].localPath, undefined);
  assert.ok(publicBlobUrl(output.images[0].publicUrl, sdk.putCalls[0].pathname));
});

test('prefers complete OIDC credentials and never passes a legacy token option', async (context) => {
  const item = await fixture(context);
  const sdk = memorySdk();
  const result = await publishBmwM3Media({
    indexPath: item.indexPath,
    outputPath: item.outputPath,
    dryRun: false,
    previewConfirmed: true,
    token: TOKEN,
    oidcToken: OIDC_TOKEN,
    storeId: STORE_ID,
    blobSdk: sdk,
    now: Date.parse('2026-08-09T13:00:00.000Z'),
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

test('fails closed when only one OIDC environment value is configured', async (context) => {
  const item = await fixture(context);
  for (const credentials of [
    { oidcToken: OIDC_TOKEN, storeId: '' },
    { oidcToken: '', storeId: STORE_ID },
  ]) {
    const sdk = memorySdk();
    await assert.rejects(
      publishBmwM3Media({
        indexPath: item.indexPath,
        outputPath: item.outputPath,
        dryRun: false,
        previewConfirmed: true,
        token: TOKEN,
        ...credentials,
        blobSdk: sdk,
        now: Date.parse('2026-08-09T13:00:00.000Z'),
      }),
      (error) => error instanceof BmwM3MediaPublishError && error.code === 'blob_oidc_incomplete',
    );
    assert.equal(sdk.putCalls.length, 0);
    assert.equal(sdk.getCalls.length, 0);
  }
});

test('rejects an invalid clock before any remote write', async (context) => {
  const item = await fixture(context);
  const sdk = memorySdk();
  await assert.rejects(
    publishBmwM3Media({
      indexPath: item.indexPath,
      outputPath: item.outputPath,
      dryRun: false,
      previewConfirmed: true,
      token: TOKEN,
      oidcToken: '',
      storeId: '',
      blobSdk: sdk,
      now: Symbol('invalid'),
    }),
    (error) => error instanceof BmwM3MediaPublishError && error.code === 'invalid_clock',
  );
  assert.equal(sdk.putCalls.length, 0);
});

test('will not overwrite the resumable local media index', async (context) => {
  const item = await fixture(context);
  await assert.rejects(
    publishBmwM3Media({
      indexPath: item.indexPath,
      outputPath: item.indexPath,
      dryRun: false,
      previewConfirmed: true,
      token: TOKEN,
      oidcToken: '',
      storeId: '',
      blobSdk: memorySdk(),
    }),
    (error) => error instanceof BmwM3MediaPublishError && error.code === 'invalid_output_path',
  );
});

test('requires a timestamped non-empty capture index', async (context) => {
  const invalidTimestamp = await fixture(context, { generatedAt: null });
  await assert.rejects(
    publishBmwM3Media({ indexPath: invalidTimestamp.indexPath }),
    (error) => error instanceof BmwM3MediaPublishError && error.code === 'invalid_index',
  );

  const empty = await fixture(context, { images: [] });
  await assert.rejects(
    publishBmwM3Media({ indexPath: empty.indexPath }),
    (error) => error instanceof BmwM3MediaPublishError && error.code === 'invalid_index',
  );
});

test('rejects conflicting remote Blob metadata after upload', async (context) => {
  const item = await fixture(context);
  await assert.rejects(
    publishBmwM3Media({
      indexPath: item.indexPath,
      outputPath: item.outputPath,
      dryRun: false,
      previewConfirmed: true,
      token: TOKEN,
      oidcToken: '',
      storeId: '',
      blobSdk: memorySdk({ metadata: { contentType: 'application/octet-stream' } }),
      now: Date.parse('2026-08-09T13:00:00.000Z'),
    }),
    (error) => error instanceof BmwM3MediaPublishError && error.code === 'remote_verify_failed',
  );
});

test('does not expose a supplier SDK failure message', async (context) => {
  const item = await fixture(context);
  await assert.rejects(
    publishBmwM3Media({
      indexPath: item.indexPath,
      outputPath: item.outputPath,
      dryRun: false,
      previewConfirmed: true,
      token: TOKEN,
      oidcToken: '',
      storeId: '',
      blobSdk: memorySdk({ uploadError: new Error(`request failed for ${TOKEN}`) }),
      now: Date.parse('2026-08-09T13:00:00.000Z'),
    }),
    (error) => error instanceof BmwM3MediaPublishError
      && error.code === 'blob_upload_failed' && !error.message.includes(TOKEN),
  );
});

test('public Blob URL validation binds the exact immutable pathname', () => {
  const pathname = 'projx-racing/ecs-media/bmw-m3/abc.webp';
  assert.equal(
    publicBlobUrl(`https://store.public.blob.vercel-storage.com/${pathname}`, pathname),
    `https://store.public.blob.vercel-storage.com/${pathname}`,
  );
  assert.equal(publicBlobUrl(`https://example.com/${pathname}`, pathname), null);
  assert.equal(publicBlobUrl(`https://store.public.blob.vercel-storage.com/${pathname}?x=1`, pathname), null);
  assert.equal(publicBlobUrl('https://store.public.blob.vercel-storage.com/other.webp', pathname), null);
});
