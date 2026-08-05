import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { tegiwaSkuMappingFingerprint } from '../../server/tegiwa-sku-mapping.js';
import {
  loadLocalTegiwaPublication,
  publishTegiwaToVercelBlob,
  TEGIWA_BLOB_CURRENT_PATH,
  TEGIWA_BLOB_RELEASE_PREFIX
} from './publish-vercel-blob.mjs';
import {
  signTegiwaPublicManifest,
  verifyTegiwaPublicManifestSignature
} from '../../server/tegiwa-public-manifest.js';

const NOW = Date.parse('2026-08-05T09:30:00.000Z');
const RELEASE_ID = '20260805T090000000Z-abcdef12';
const SECRET = 's'.repeat(64);
const TOKEN = 'vercel_blob_rw_test_token_1234567890';
const HOST = 'unit-test.public.blob.vercel-storage.com';

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function indexFixture() {
  return {
    version: 2,
    priceBasis: 'gbp_ex_uk_vat',
    checkedAt: '2026-08-05',
    productCount: 1,
    skuProductCount: 1,
    availableProductCount: 1,
    leadTimes: [''],
    products: { aaaaaaaaaaaaaaaa: [1000, 1000, 1, 0, ['SKU-1'], 1] }
  };
}

async function makeWorkspace({
  sourceKind = 'approved-download',
  privateArchiveVerified = true,
  fingerprint = null,
  corruptArtifact = false,
  previousApproved = false
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'projx-blob-publisher-'));
  const workspace = path.join(root, 'vendor');
  const index = indexFixture();
  const artifact = Buffer.from(JSON.stringify(index));
  const artifactSha256 = digest(artifact);
  const counts = {
    checkedAt: index.checkedAt,
    productCount: 1,
    totalKeyCount: 1,
    skuProductCount: 1,
    availableProductCount: 1
  };
  async function release(releaseId, kind, verified, createdAt = '2026-08-05T09:00:00.000Z') {
    const directory = path.join(workspace, 'releases', releaseId);
    await mkdir(directory, { recursive: true });
    const manifest = {
      version: 1,
      vendor: 'tegiwa',
      releaseId,
      createdAt,
      checkedAt: index.checkedAt,
      source: {
        kind,
        bytes: 987654,
        sha256: 'f'.repeat(64),
        privateArchiveVerified: verified,
        supplier_private_secret_marker: 'NEVER_UPLOAD_THIS'
      },
      artifact: { name: 'tegiwa-stock-index.json', bytes: artifact.length, sha256: artifactSha256 },
      counts,
      baseline: { private: true },
      gates: { private: true }
    };
    const manifestBuffer = Buffer.from(JSON.stringify(manifest));
    await writeFile(path.join(directory, 'manifest.json'), manifestBuffer);
    await writeFile(path.join(directory, 'tegiwa-stock-index.json'), artifact);
    return { releaseId, manifestBuffer, artifact };
  }

  const current = await release(RELEASE_ID, sourceKind, privateArchiveVerified);
  let previous = null;
  if (previousApproved) {
    previous = await release(
      '20260805T083000000Z-fedcba98', 'approved-download', true, '2026-08-05T08:30:00.000Z'
    );
  }
  const pointer = {
    version: 1,
    vendor: 'tegiwa',
    releaseId: current.releaseId,
    previousReleaseId: previous?.releaseId || null,
    previousManifestSha256: previous ? digest(previous.manifestBuffer) : null,
    previousIndexSha256: previous ? artifactSha256 : null,
    manifestSha256: digest(current.manifestBuffer),
    indexSha256: artifactSha256,
    promotedAt: '2026-08-05T09:01:00.000Z'
  };
  await writeFile(path.join(workspace, 'current.json'), JSON.stringify(pointer));
  if (corruptArtifact) {
    await writeFile(path.join(workspace, 'releases', RELEASE_ID, 'tegiwa-stock-index.json'), '{}');
  }
  const searchSummaryPath = path.join(root, 'tegiwa-search-summary.json');
  await writeFile(searchSummaryPath, JSON.stringify({
    version: 2,
    skuMappingSha256: fingerprint || tegiwaSkuMappingFingerprint(index)
  }));
  return { root, workspace, searchSummaryPath, artifact, artifactSha256 };
}

function streamJson(value) {
  return new Response(JSON.stringify(value)).body;
}

function remoteManifest({ artifactSha256 = '1'.repeat(64), retrievedAt = '2026-08-05T08:00:00.000Z' } = {}) {
  const unsigned = {
    version: 2,
    vendor: 'Tegiwa',
    releaseId: '20260805T080000000Z-12345678',
    retrievedAt,
    publishedAt: '2026-08-05T08:05:00.000Z',
    expiresAt: '2026-08-05T10:00:00.000Z',
    counts: { productCount: 1, skuProductCount: 1, availableProductCount: 1 },
    artifact: {
      url: `https://${HOST}/${TEGIWA_BLOB_RELEASE_PREFIX}previous.json`,
      bytes: 100,
      sha256: artifactSha256
    }
  };
  return { ...unsigned, signature: signTegiwaPublicManifest(unsigned, SECRET) };
}

function sdkMock({ current = null, putCurrentError = null, listed = [] } = {}) {
  const calls = [];
  return {
    calls,
    async get(pathname) {
      calls.push(['get', pathname]);
      if (!current) return null;
      const body = Buffer.from(JSON.stringify(current));
      return {
        statusCode: 200,
        stream: streamJson(current),
        blob: {
          pathname: TEGIWA_BLOB_CURRENT_PATH,
          url: `https://${HOST}/${TEGIWA_BLOB_CURRENT_PATH}`,
          etag: 'current-etag',
          size: body.length,
          contentType: 'application/json'
        }
      };
    },
    async put(pathname, body, options) {
      calls.push(['put', pathname, body, options]);
      if (pathname === TEGIWA_BLOB_CURRENT_PATH) {
        if (putCurrentError) throw putCurrentError;
        return {
          pathname,
          url: `https://${HOST}/${pathname}`,
          etag: 'new-current-etag'
        };
      }
      const uploadedPath = pathname.replace(/\.json$/, '-random.json');
      return {
        pathname: uploadedPath,
        url: `https://${HOST}/${uploadedPath}`,
        etag: 'artifact-etag'
      };
    },
    async list(options) {
      calls.push(['list', options]);
      return { blobs: listed, hasMore: false };
    },
    async del(url, options) {
      calls.push(['del', url, options]);
    }
  };
}

async function rejectsCode(action, code) {
  await assert.rejects(action, error => error?.code === code);
}

test('dry run validates locally without credentials or Blob SDK activity', async () => {
  const fixture = await makeWorkspace();
  const sdk = new Proxy({}, { get() { throw new Error('network touched'); } });
  const result = await publishTegiwaToVercelBlob({
    workspace: fixture.workspace,
    searchSummaryPath: fixture.searchSummaryPath,
    dryRun: true,
    token: '',
    manifestSecret: '',
    blobSdk: sdk,
    now: NOW
  });
  assert.equal(result.status, 'dry_run_passed');
  assert.equal(result.artifactSha256, fixture.artifactSha256);
});

test('checksum corruption and SKU fingerprint drift fail closed', async () => {
  const corrupt = await makeWorkspace({ corruptArtifact: true });
  await rejectsCode(() => publishTegiwaToVercelBlob({
    workspace: corrupt.workspace, searchSummaryPath: corrupt.searchSummaryPath, dryRun: true, now: NOW
  }), 'corrupt_local_release');

  const drift = await makeWorkspace({ fingerprint: '0'.repeat(64) });
  await rejectsCode(() => publishTegiwaToVercelBlob({
    workspace: drift.workspace, searchSummaryPath: drift.searchSummaryPath, dryRun: true, now: NOW
  }), 'stale_search_sku_index');
});

test('real publication requires both server-only credentials before SDK use', async () => {
  const fixture = await makeWorkspace();
  let touched = false;
  const sdk = new Proxy({}, { get() { touched = true; return undefined; } });
  await rejectsCode(() => publishTegiwaToVercelBlob({
    workspace: fixture.workspace, searchSummaryPath: fixture.searchSummaryPath,
    token: '', manifestSecret: SECRET, blobSdk: sdk, now: NOW
  }), 'blob_token_required');
  await rejectsCode(() => publishTegiwaToVercelBlob({
    workspace: fixture.workspace, searchSummaryPath: fixture.searchSummaryPath,
    token: TOKEN, manifestSecret: '', blobSdk: sdk, now: NOW
  }), 'manifest_secret_required');
  assert.equal(touched, false);
});

test('publishes immutable artifact then an exact minimal signed current manifest', async () => {
  const fixture = await makeWorkspace();
  const sdk = sdkMock();
  const result = await publishTegiwaToVercelBlob({
    workspace: fixture.workspace, searchSummaryPath: fixture.searchSummaryPath,
    token: TOKEN, manifestSecret: SECRET, blobSdk: sdk, now: NOW
  });
  assert.equal(result.status, 'published');
  const puts = sdk.calls.filter(call => call[0] === 'put');
  assert.equal(puts.length, 2);
  assert.ok(puts[0][1].startsWith(TEGIWA_BLOB_RELEASE_PREFIX));
  assert.deepEqual(Buffer.from(puts[0][2]), fixture.artifact);
  assert.equal(puts[0][3].allowOverwrite, false);
  assert.equal(puts[0][3].addRandomSuffix, true);
  assert.equal(puts[1][1], TEGIWA_BLOB_CURRENT_PATH);
  assert.equal(puts[1][3].allowOverwrite, false);
  assert.equal(Object.hasOwn(puts[1][3], 'ifMatch'), false);
  const manifestText = puts[1][2];
  const manifest = JSON.parse(manifestText);
  assert.deepEqual(Object.keys(manifest), [
    'version', 'vendor', 'releaseId', 'retrievedAt', 'publishedAt', 'expiresAt',
    'counts', 'artifact', 'signature'
  ]);
  assert.deepEqual(Object.keys(manifest.counts), [
    'productCount', 'skuProductCount', 'availableProductCount'
  ]);
  assert.deepEqual(Object.keys(manifest.artifact), ['url', 'bytes', 'sha256']);
  assert.equal(verifyTegiwaPublicManifestSignature(manifest, SECRET), true);
  for (const forbidden of ['NEVER_UPLOAD_THIS', 'source', 'baseline', 'gates', 'privateArchive']) {
    assert.equal(manifestText.includes(forbidden), false);
  }
  assert.ok(sdk.calls.findIndex(call => call[0] === 'list') > sdk.calls.findIndex(
    call => call[0] === 'put' && call[1] === TEGIWA_BLOB_CURRENT_PATH
  ));
});

test('uses ETag CAS, keeps current and previous artifacts, and cleans only older blobs', async () => {
  const fixture = await makeWorkspace();
  const current = remoteManifest();
  const olderUrl = `https://${HOST}/${TEGIWA_BLOB_RELEASE_PREFIX}older.json`;
  const sdk = sdkMock({
    current,
    listed: [
      { pathname: `${TEGIWA_BLOB_RELEASE_PREFIX}previous.json`, url: current.artifact.url, uploadedAt: '2026-08-05T08:00:00.000Z', etag: 'previous-etag' },
      { pathname: `${TEGIWA_BLOB_RELEASE_PREFIX}older.json`, url: olderUrl, uploadedAt: '2026-08-04T08:00:00.000Z', etag: 'older-etag' }
    ]
  });
  await publishTegiwaToVercelBlob({
    workspace: fixture.workspace, searchSummaryPath: fixture.searchSummaryPath,
    token: TOKEN, manifestSecret: SECRET, blobSdk: sdk, now: NOW
  });
  const currentPut = sdk.calls.find(call => call[0] === 'put' && call[1] === TEGIWA_BLOB_CURRENT_PATH);
  assert.equal(currentPut[3].allowOverwrite, true);
  assert.equal(currentPut[3].ifMatch, 'current-etag');
  const deletes = sdk.calls.filter(call => call[0] === 'del');
  assert.deepEqual(deletes, [['del', olderUrl, { token: TOKEN, ifMatch: 'older-etag' }]]);
});

test('no-change skips writes, list and cleanup', async () => {
  const fixture = await makeWorkspace();
  const sdk = sdkMock({ current: remoteManifest({ artifactSha256: fixture.artifactSha256 }) });
  const result = await publishTegiwaToVercelBlob({
    workspace: fixture.workspace, searchSummaryPath: fixture.searchSummaryPath,
    token: TOKEN, manifestSecret: SECRET, blobSdk: sdk, now: NOW
  });
  assert.equal(result.status, 'no_change');
  assert.deepEqual(sdk.calls.map(call => call[0]), ['get']);
});

test('concurrent current-manifest replacement fails closed without cleanup', async () => {
  const fixture = await makeWorkspace();
  const conflict = Object.assign(new Error('conflict'), { statusCode: 412 });
  const sdk = sdkMock({ current: remoteManifest(), putCurrentError: conflict });
  await rejectsCode(() => publishTegiwaToVercelBlob({
    workspace: fixture.workspace, searchSummaryPath: fixture.searchSummaryPath,
    token: TOKEN, manifestSecret: SECRET, blobSdk: sdk, now: NOW
  }), 'publish_conflict');
  assert.equal(sdk.calls.some(call => call[0] === 'list' || call[0] === 'del'), false);
});

test('public-index provenance is accepted only through a checksum-identical approved prior release', async () => {
  const untrusted = await makeWorkspace({ sourceKind: 'public-index', privateArchiveVerified: false });
  await rejectsCode(() => loadLocalTegiwaPublication({
    workspace: untrusted.workspace, searchSummaryPath: untrusted.searchSummaryPath, now: NOW
  }), 'untrusted_source_provenance');

  const inherited = await makeWorkspace({
    sourceKind: 'public-index', privateArchiveVerified: false, previousApproved: true
  });
  const publication = await loadLocalTegiwaPublication({
    workspace: inherited.workspace, searchSummaryPath: inherited.searchSummaryPath, now: NOW
  });
  assert.equal(publication.retrievedAt, '2026-08-05T08:30:00.000Z');
});
