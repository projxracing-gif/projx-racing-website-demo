import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  acquireRunLock,
  downloadTegiwaStockfeed,
  evaluateAbnormalChange,
  rollbackTegiwaRelease,
  runTegiwaSync,
  TEGIWA_REQUIRED_HEADERS,
  TEGIWA_STOCKFEED_URL,
  validateTegiwaIndex,
  VendorSyncError
} from './lib.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NOW = Date.parse('2026-08-05T10:30:00.000Z');

function csvFixture({ omitHeader = null } = {}) {
  const headers = TEGIWA_REQUIRED_HEADERS.filter(header => header !== omitHeader);
  return `${headers.join(',')}\r\n${headers.map((header, index) => index === 0 ? 'Example product' : '').join(',')}\r\n`;
}

function responseFixture(bodyText, {
  status = 200,
  url = TEGIWA_STOCKFEED_URL,
  contentType = 'text/csv;charset=UTF-8',
  contentEncoding = null,
  contentLength = Buffer.byteLength(bodyText),
  chunks = 2
} = {}) {
  const buffer = Buffer.from(bodyText);
  const headerValues = new Map([
    ['content-type', contentType],
    ['content-length', String(contentLength)],
    ['content-encoding', contentEncoding]
  ]);
  return {
    status,
    ok: status >= 200 && status < 300,
    url,
    headers: { get: name => headerValues.get(String(name).toLowerCase()) || null },
    body: {
      async *[Symbol.asyncIterator]() {
        const width = Math.max(1, Math.ceil(buffer.length / chunks));
        for (let offset = 0; offset < buffer.length; offset += width) yield buffer.subarray(offset, offset + width);
      }
    }
  };
}

function fixtureIndex({ checkedAt = '2026-08-05', changeFirstPrice = 0, keep = 4 } = {}) {
  const records = [
    ['aaaaaaaaaaaaaaaa', [10_000 + changeFirstPrice, 10_000 + changeFirstPrice, 1, 0, ['PUBLIC-A'], 1]],
    ['bbbbbbbbbbbbbbbb', [20_000, 21_000, 2, 1, ['PUBLIC-B'], 1]],
    ['cccccccccccccccc', [30_000, 30_000, 3, 2, [], 0]],
    ['dddddddddddddddd', [40_000, 40_000, 0, 0, [], 0]]
  ].slice(0, keep);
  const products = Object.fromEntries(records);
  return {
    version: 2,
    priceBasis: 'gbp_ex_uk_vat',
    checkedAt,
    productCount: records.length,
    skuProductCount: records.filter(([, record]) => record[5] === 1).length,
    availableProductCount: records.filter(([, record]) => record[2] === 1 || record[2] === 2).length,
    leadTimes: ['', '2-3 working days', '1 week'],
    products
  };
}

function priceFixture({ count = 30, multiplier = 1, nullPrices = 0, changedCount = count } = {}) {
  const products = {};
  for (let index = 0; index < count; index += 1) {
    const key = String(index).padStart(16, '0');
    const sku = `PUBLIC-PRICE-${index}`;
    if (index < nullPrices) {
      products[key] = [null, null, null, 0, [sku], 1];
    } else {
      const price = Math.round(10_000 * (index < changedCount ? multiplier : 1));
      products[key] = [price, price, 1, 0, [sku], 1];
    }
  }
  return {
    version: 2,
    priceBasis: 'gbp_ex_uk_vat',
    checkedAt: '2026-08-05',
    productCount: count - nullPrices,
    skuProductCount: count,
    availableProductCount: count - nullPrices,
    leadTimes: [''],
    products
  };
}

const abundantDiskSpace = async () => ({ bavail: 1_000_000_000, bsize: 4_096 });

async function writeIndex(directory, name, index) {
  const file = path.join(directory, name);
  await writeFile(file, `${JSON.stringify(index)}\n`, 'utf8');
  return file;
}

test('explicit Tegiwa downloader uses only the approved endpoint and validates the streamed CSV', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'projx-vendor-download-'));
  const destination = path.join(temporary, 'stock.csv');
  const csv = csvFixture();
  let request = null;
  try {
    const result = await downloadTegiwaStockfeed({
      destination,
      maximumBytes: 64 * 1024,
      fetchImpl: async (url, options) => {
        request = { url, options };
        return responseFixture(csv, { chunks: 5 });
      }
    });
    assert.equal(request.url, TEGIWA_STOCKFEED_URL);
    assert.equal(request.options.method, 'GET');
    assert.equal(request.options.redirect, 'manual');
    assert.equal(request.options.headers.accept, 'text/csv');
    assert.equal(request.options.headers['accept-encoding'], 'identity');
    assert.equal(request.options.headers['user-agent'], 'ProjxRacingVendorStockSync/1.0');
    assert.equal(request.options.signal instanceof AbortSignal, true);
    assert.equal(result.bytes, Buffer.byteLength(csv));
    assert.equal(result.sha256, createHash('sha256').update(csv).digest('hex'));
    assert.equal(await readFile(destination, 'utf8'), csv);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('Tegiwa downloader blocks redirects, non-CSV responses, truncation and missing required headers', async () => {
  const cases = [
    {
      code: 'redirect_blocked',
      response: responseFixture(csvFixture(), { url: 'https://example.invalid/dealer-stock/' })
    },
    {
      code: 'redirect_blocked',
      response: responseFixture(csvFixture(), { status: 302 })
    },
    {
      code: 'invalid_feed_content_type',
      response: responseFixture(csvFixture(), { contentType: 'text/html' })
    },
    {
      code: 'invalid_feed_content_encoding',
      response: responseFixture(csvFixture(), { contentEncoding: 'gzip' })
    },
    {
      code: 'invalid_input_size',
      response: responseFixture(csvFixture(), { contentLength: Buffer.byteLength(csvFixture()) + 1 })
    },
    {
      code: 'invalid_feed_headers',
      response: responseFixture(csvFixture({ omitHeader: 'Variant SKU' }))
    }
  ];
  for (const [index, item] of cases.entries()) {
    const temporary = await mkdtemp(path.join(os.tmpdir(), `projx-vendor-download-reject-${index}-`));
    const destination = path.join(temporary, 'stock.csv');
    try {
      await assert.rejects(
        downloadTegiwaStockfeed({
          destination,
          maximumBytes: 64 * 1024,
          fetchImpl: async () => item.response
        }),
        error => error instanceof VendorSyncError && error.code === item.code
      );
      await assert.rejects(readFile(destination), { code: 'ENOENT' });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
});

test('approved-download dry-run is isolated, uses an injected builder and makes no release', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'projx-vendor-download-run-'));
  const workspace = path.join(temporary, 'workspace');
  const privateArchive = path.join(temporary, 'private-archive');
  const csv = csvFixture();
  let fetchCount = 0;
  let builderCount = 0;
  try {
    await mkdir(privateArchive);
    const result = await runTegiwaSync({
      workspace,
      repoRoot,
      inputKind: 'approved-download',
      privateArchivePath: privateArchive,
      dryRun: true,
      allowInitial: true,
      now: NOW,
      fetchImpl: async () => {
        fetchCount += 1;
        return responseFixture(csv);
      },
      buildStockIndex: async ({ inputPath, checkedAt, outputPath }) => {
        builderCount += 1;
        assert.equal(await readFile(inputPath, 'utf8'), csv);
        assert.equal(checkedAt, '2026-08-05');
        await writeFile(outputPath, `${JSON.stringify(fixtureIndex({ checkedAt }))}\n`, 'utf8');
      }
    });
    assert.equal(result.dryRun, true);
    assert.equal(fetchCount, 1);
    assert.equal(builderCount, 1);
    await assert.rejects(readFile(path.join(workspace, 'current.json')), { code: 'ENOENT' });
    await assert.rejects(readdir(path.join(workspace, 'releases')), { code: 'ENOENT' });
    assert.deepEqual(await readdir(privateArchive), []);
    assert.deepEqual(await readdir(path.join(workspace, 'staging')), []);
    const health = await readFile(path.join(workspace, 'health', 'tegiwa-2026-08.jsonl'), 'utf8');
    assert.match(health, /"inputKind":"approved-download"/);
    assert.doesNotMatch(health, /scripts\.tegiwa\.de|Example product|Variant SKU/i);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('approved-download promotion archives and verifies the exact raw CSV before release creation', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'projx-vendor-archive-'));
  const workspace = path.join(temporary, 'workspace');
  const privateArchive = path.join(temporary, 'private-source-archives');
  const csv = csvFixture();
  const sourceSha256 = createHash('sha256').update(csv).digest('hex');
  try {
    await mkdir(privateArchive);
    const result = await runTegiwaSync({
      workspace,
      repoRoot,
      inputKind: 'approved-download',
      privateArchivePath: privateArchive,
      allowInitial: true,
      now: NOW,
      fetchImpl: async () => responseFixture(csv),
      buildStockIndex: async ({ inputPath, checkedAt, outputPath }) => {
        assert.equal(await readFile(inputPath, 'utf8'), csv);
        await writeFile(outputPath, `${JSON.stringify(fixtureIndex({ checkedAt }))}\n`, 'utf8');
      }
    });
    assert.equal(result.dryRun, false);
    const archiveFiles = await readdir(privateArchive);
    assert.deepEqual(archiveFiles, [`tegiwa-stock-20260805T103000000Z-${sourceSha256}.csv`]);
    assert.equal(await readFile(path.join(privateArchive, archiveFiles[0]), 'utf8'), csv);
    const manifest = JSON.parse(await readFile(
      path.join(workspace, 'releases', result.releaseId, 'manifest.json'),
      'utf8'
    ));
    assert.equal(manifest.source.sha256, sourceSha256);
    assert.equal(manifest.source.bytes, Buffer.byteLength(csv));
    assert.equal(manifest.source.privateArchiveVerified, true);
    assert.equal(JSON.stringify(manifest).includes(privateArchive), false);
    const pointerBeforeNoChange = await readFile(path.join(workspace, 'current.json'), 'utf8');
    const noChange = await runTegiwaSync({
      workspace,
      repoRoot,
      inputKind: 'approved-download',
      privateArchivePath: privateArchive,
      now: NOW + 60_000,
      fetchImpl: async () => responseFixture(csv),
      buildStockIndex: async ({ checkedAt, outputPath }) => {
        await writeFile(outputPath, `${JSON.stringify(fixtureIndex({ checkedAt }))}\n`, 'utf8');
      },
      diskSpaceProvider: async () => {
        throw new Error('No-change must short-circuit before disk checks.');
      }
    });
    assert.equal(noChange.noChange, true);
    assert.equal(noChange.releaseId, result.releaseId);
    assert.deepEqual(await readdir(privateArchive), archiveFiles);
    assert.deepEqual(await readdir(path.join(workspace, 'releases')), [result.releaseId]);
    assert.equal(await readFile(path.join(workspace, 'current.json'), 'utf8'), pointerBeforeNoChange);
    const health = await readFile(path.join(workspace, 'health', 'tegiwa-2026-08.jsonl'), 'utf8');
    assert.match(health, /"status":"no_change"/);
    assert.doesNotMatch(health, /private-source-archives|Example product|RRP Inc VAT/i);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('private archival failure blocks release and pointer creation without replacing an immutable archive', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'projx-vendor-archive-block-'));
  const workspace = path.join(temporary, 'workspace');
  const privateArchive = path.join(temporary, 'private-source-archives');
  const csv = csvFixture();
  const sourceSha256 = createHash('sha256').update(csv).digest('hex');
  const archiveName = `tegiwa-stock-20260805T103000000Z-${sourceSha256}.csv`;
  try {
    await mkdir(privateArchive);
    await writeFile(path.join(privateArchive, archiveName), 'immutable-existing-copy\n', 'utf8');
    await assert.rejects(
      runTegiwaSync({
        workspace,
        repoRoot,
        inputKind: 'approved-download',
        privateArchivePath: privateArchive,
        allowInitial: true,
        now: NOW,
        fetchImpl: async () => responseFixture(csv),
        buildStockIndex: async ({ checkedAt, outputPath }) => {
          await writeFile(outputPath, `${JSON.stringify(fixtureIndex({ checkedAt }))}\n`, 'utf8');
        }
      }),
      error => error instanceof VendorSyncError && error.code === 'private_archive_exists'
    );
    assert.equal(await readFile(path.join(privateArchive, archiveName), 'utf8'), 'immutable-existing-copy\n');
    await assert.rejects(readFile(path.join(workspace, 'current.json')), { code: 'ENOENT' });
    await assert.rejects(readdir(path.join(workspace, 'releases')), { code: 'ENOENT' });
    assert.deepEqual(await readdir(path.join(workspace, 'staging')), []);
    const health = await readFile(path.join(workspace, 'health', 'tegiwa-2026-08.jsonl'), 'utf8');
    assert.match(health, /"code":"private_archive_exists"/);
    assert.doesNotMatch(health, /private-source-archives|immutable-existing-copy|Example product/i);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('approved-download mode rejects a missing private archive before any fetch', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'projx-vendor-archive-required-'));
  let fetchCount = 0;
  try {
    await assert.rejects(
      runTegiwaSync({
        workspace: path.join(temporary, 'workspace'),
        repoRoot,
        inputKind: 'approved-download',
        dryRun: true,
        allowInitial: true,
        now: NOW,
        fetchImpl: async () => {
          fetchCount += 1;
          return responseFixture(csvFixture());
        }
      }),
      error => error instanceof VendorSyncError && error.code === 'private_archive_required'
    );
    assert.equal(fetchCount, 0);

    const nestedWorkspace = path.join(temporary, 'nested-workspace');
    const nestedArchive = path.join(nestedWorkspace, 'private-archive');
    await mkdir(nestedArchive, { recursive: true });
    await assert.rejects(
      runTegiwaSync({
        workspace: nestedWorkspace,
        repoRoot,
        inputKind: 'approved-download',
        privateArchivePath: nestedArchive,
        dryRun: true,
        allowInitial: true,
        now: NOW,
        fetchImpl: async () => {
          fetchCount += 1;
          return responseFixture(csvFixture());
        }
      }),
      error => error instanceof VendorSyncError && error.code === 'unsafe_private_archive'
    );
    assert.equal(fetchCount, 0);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('validates compact public Tegiwa records and rejects unexpected/private-shaped fields', () => {
  const candidate = fixtureIndex();
  assert.equal(validateTegiwaIndex(candidate, { now: NOW }).productCount, 4);
  assert.throws(
    () => validateTegiwaIndex({ ...candidate, dealerCost: 1 }, { now: NOW }),
    error => error instanceof VendorSyncError && error.code === 'invalid_stock_index'
  );
  const invalidSku = structuredClone(candidate);
  invalidSku.products.aaaaaaaaaaaaaaaa[4] = ['https://private.example/token'];
  assert.throws(() => validateTegiwaIndex(invalidSku, { now: NOW }), /invalid public SKU list/i);
});

test('abnormal-change gates reject large removals without exposing product data', () => {
  const result = evaluateAbnormalChange(fixtureIndex({ keep: 2 }), fixtureIndex());
  assert.equal(result.passed, false);
  assert.ok(result.failures.some(failure => failure.code === 'product_drop'));
  assert.ok(result.failures.some(failure => failure.code === 'key_removal'));
  assert.equal(Object.hasOwn(result.metrics, 'removedKeyCount'), true);
  assert.equal(JSON.stringify(result).includes('PUBLIC-A'), false);
});

test('price gates block large individual, aggregate quantile and null-price regressions without product disclosure', () => {
  const baseline = priceFixture();

  const individual = priceFixture({ multiplier: 2, changedCount: 1 });
  const individualResult = evaluateAbnormalChange(individual, baseline);
  assert.equal(individualResult.passed, false);
  assert.ok(individualResult.failures.some(failure => failure.code === 'individual_price_change'));

  const bulk = priceFixture({ multiplier: 1.2 });
  const bulkResult = evaluateAbnormalChange(bulk, baseline);
  assert.equal(bulkResult.passed, false);
  assert.ok(bulkResult.failures.some(failure => failure.code === 'median_price_change'));

  const quantile = priceFixture({ multiplier: 2, changedCount: 6 });
  const quantileResult = evaluateAbnormalChange(quantile, baseline, {
    maxIndividualPriceChangeRatio: 10,
    minIndividualPriceChangePence: 1,
    maxMedianPriceChangeRatio: 1,
    maxPriceChangeP90Ratio: 0.5
  });
  assert.equal(quantileResult.passed, false);
  assert.ok(quantileResult.failures.some(failure => failure.code === 'price_change_p90'));

  const nullRegression = priceFixture({ nullPrices: 2, changedCount: 0 });
  const nullResult = evaluateAbnormalChange(nullRegression, baseline);
  assert.equal(nullResult.passed, false);
  assert.ok(nullResult.failures.some(failure => failure.code === 'null_price_regression_ratio'));

  const lowValueBaseline = priceFixture({ count: 1 });
  lowValueBaseline.products['0000000000000000'][0] = 4_000;
  lowValueBaseline.products['0000000000000000'][1] = 4_000;
  const lowValueCollapse = structuredClone(lowValueBaseline);
  lowValueCollapse.products['0000000000000000'][0] = 100;
  lowValueCollapse.products['0000000000000000'][1] = 100;
  const lowValueResult = evaluateAbnormalChange(lowValueCollapse, lowValueBaseline);
  assert.ok(lowValueResult.failures.some(failure => failure.code === 'catastrophic_price_change'));

  const rangeBaseline = priceFixture();
  const rangeReshape = structuredClone(rangeBaseline);
  for (const record of Object.values(rangeBaseline.products)) {
    record[0] = 10_000;
    record[1] = 20_000;
  }
  for (const record of Object.values(rangeReshape.products)) {
    record[0] = 13_000;
    record[1] = 17_000;
  }
  const rangeResult = evaluateAbnormalChange(rangeReshape, rangeBaseline);
  assert.ok(rangeResult.failures.some(failure => failure.code === 'material_price_change_share'));

  const balanced = structuredClone(baseline);
  Object.values(balanced.products).forEach((record, index) => {
    const multiplier = index % 2 === 0 ? 1.2 : 0.8;
    record[0] = Math.round(record[0] * multiplier);
    record[1] = Math.round(record[1] * multiplier);
  });
  const balancedResult = evaluateAbnormalChange(balanced, baseline);
  assert.ok(Math.abs(balancedResult.metrics.medianPriceChangeRatio) < 1e-9);
  assert.ok(balancedResult.failures.some(failure => failure.code === 'material_price_change_share'));

  const serialized = JSON.stringify({
    individualResult, bulkResult, quantileResult, nullResult, lowValueResult, rangeResult, balancedResult
  });
  assert.doesNotMatch(serialized, /PUBLIC-PRICE|10000|20000/);
  assert.match(serialized, /comparablePriceCount|medianPriceChangeRatio|p90AbsolutePriceChangeRatio/);
});

test('disk-space and retention guards fail closed without deleting retained data', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'projx-vendor-capacity-'));
  try {
    const input = await writeIndex(temporary, 'candidate.json', fixtureIndex());
    const lowDiskWorkspace = path.join(temporary, 'low-disk-workspace');
    await assert.rejects(
      runTegiwaSync({
        workspace: lowDiskWorkspace,
        repoRoot,
        inputPath: input,
        inputKind: 'public-index',
        allowInitial: true,
        now: NOW,
        thresholdOverrides: { minFreeDiskBytes: 1_000, diskReserveMultiplier: 1 },
        diskSpaceProvider: async () => ({ bavail: 1, bsize: 1 })
      }),
      error => error instanceof VendorSyncError && error.code === 'disk_space_low'
    );
    await assert.rejects(readFile(path.join(lowDiskWorkspace, 'current.json')), { code: 'ENOENT' });
    await assert.rejects(readdir(path.join(lowDiskWorkspace, 'releases')), { code: 'ENOENT' });

    const retentionWorkspace = path.join(temporary, 'retention-workspace');
    const retainedRelease = path.join(
      retentionWorkspace,
      'releases',
      '20260805T103000000Z-aaaaaaaa'
    );
    await mkdir(retainedRelease, { recursive: true });
    await assert.rejects(
      runTegiwaSync({
        workspace: retentionWorkspace,
        repoRoot,
        inputPath: input,
        inputKind: 'public-index',
        allowInitial: true,
        now: NOW + 1,
        thresholdOverrides: { maxReleaseDirectories: 1 },
        diskSpaceProvider: abundantDiskSpace
      }),
      error => error instanceof VendorSyncError && error.code === 'release_retention_limit'
    );
    assert.deepEqual(await readdir(path.join(retentionWorkspace, 'releases')), ['20260805T103000000Z-aaaaaaaa']);
    await assert.rejects(readFile(path.join(retentionWorkspace, 'current.json')), { code: 'ENOENT' });

    const archiveWorkspace = path.join(temporary, 'archive-retention-workspace');
    const privateArchive = path.join(temporary, 'archive-retention-private');
    const retainedArchiveName = `tegiwa-stock-20260101T000000000Z-${'a'.repeat(64)}.csv`;
    await mkdir(privateArchive);
    await writeFile(path.join(privateArchive, retainedArchiveName), 'retained-private-source\n', 'utf8');
    await assert.rejects(
      runTegiwaSync({
        workspace: archiveWorkspace,
        repoRoot,
        inputKind: 'approved-download',
        privateArchivePath: privateArchive,
        allowInitial: true,
        now: NOW + 2,
        thresholdOverrides: { maxPrivateArchiveFiles: 1 },
        diskSpaceProvider: abundantDiskSpace,
        fetchImpl: async () => responseFixture(csvFixture()),
        buildStockIndex: async ({ checkedAt, outputPath }) => {
          await writeFile(outputPath, `${JSON.stringify(fixtureIndex({ checkedAt }))}\n`, 'utf8');
        }
      }),
      error => error instanceof VendorSyncError && error.code === 'private_archive_retention_limit'
    );
    assert.deepEqual(await readdir(privateArchive), [retainedArchiveName]);
    assert.equal(await readFile(path.join(privateArchive, retainedArchiveName), 'utf8'), 'retained-private-source\n');
    await assert.rejects(readFile(path.join(archiveWorkspace, 'current.json')), { code: 'ENOENT' });
    await assert.rejects(readdir(path.join(archiveWorkspace, 'releases')), { code: 'ENOENT' });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('dry-run, promotion, previous-good retention, rollback and health logs remain local and safe', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'projx-vendor-sync-'));
  const workspace = path.join(temporary, 'workspace');
  try {
    const baseline = fixtureIndex();
    const baselinePath = await writeIndex(temporary, 'baseline.json', baseline);
    const firstInput = await writeIndex(temporary, 'candidate-one.json', fixtureIndex());

    const dryRun = await runTegiwaSync({
      workspace, repoRoot, inputPath: firstInput, inputKind: 'public-index',
      baselinePath, dryRun: true, now: NOW
    });
    assert.equal(dryRun.dryRun, true);
    await assert.rejects(readFile(path.join(workspace, 'current.json')), { code: 'ENOENT' });
    await assert.rejects(readdir(path.join(workspace, 'releases')), { code: 'ENOENT' });
    assert.deepEqual(await readdir(path.join(workspace, 'staging')), []);
    await assert.rejects(readFile(path.join(workspace, '.vendor-sync.lock')), { code: 'ENOENT' });

    const first = await runTegiwaSync({
      workspace, repoRoot, inputPath: firstInput, inputKind: 'public-index',
      baselinePath, now: NOW + 1
    });
    assert.equal(first.dryRun, false);
    const firstPointer = JSON.parse(await readFile(path.join(workspace, 'current.json'), 'utf8'));
    assert.equal(firstPointer.releaseId, first.releaseId);
    assert.equal(firstPointer.previousReleaseId, null);
    const firstReleasePath = path.join(workspace, 'releases', first.releaseId, 'tegiwa-stock-index.json');
    const firstReleaseBefore = await readFile(firstReleasePath);
    const firstHash = createHash('sha256').update(firstReleaseBefore).digest('hex');

    const secondInput = await writeIndex(temporary, 'candidate-two.json', fixtureIndex({ changeFirstPrice: 50 }));
    const second = await runTegiwaSync({
      workspace, repoRoot, inputPath: secondInput, inputKind: 'public-index', now: NOW + 60_000
    });
    const secondPointer = JSON.parse(await readFile(path.join(workspace, 'current.json'), 'utf8'));
    assert.equal(secondPointer.releaseId, second.releaseId);
    assert.equal(secondPointer.previousReleaseId, first.releaseId);
    assert.equal(secondPointer.previousManifestSha256, firstPointer.manifestSha256);
    assert.equal(secondPointer.previousIndexSha256, firstPointer.indexSha256);
    assert.equal((await readdir(path.join(workspace, 'releases'))).length, 2);
    assert.equal(createHash('sha256').update(await readFile(firstReleasePath)).digest('hex'), firstHash);

    const untrustedPointer = { ...secondPointer, previousManifestSha256: '0'.repeat(64) };
    await writeFile(path.join(workspace, 'current.json'), `${JSON.stringify(untrustedPointer, null, 2)}\n`, 'utf8');
    await assert.rejects(
      rollbackTegiwaRelease({ workspace, previous: true, dryRun: true, now: NOW + 90_000 }),
      error => error instanceof VendorSyncError && error.code === 'corrupt_release'
    );
    await writeFile(path.join(workspace, 'current.json'), `${JSON.stringify(secondPointer, null, 2)}\n`, 'utf8');

    const rollbackDryRun = await rollbackTegiwaRelease({ workspace, previous: true, dryRun: true, now: NOW + 120_000 });
    assert.equal(rollbackDryRun.releaseId, first.releaseId);
    assert.equal(JSON.parse(await readFile(path.join(workspace, 'current.json'), 'utf8')).releaseId, second.releaseId);
    const rollback = await rollbackTegiwaRelease({ workspace, previous: true, now: NOW + 180_000 });
    assert.equal(rollback.releaseId, first.releaseId);
    const rolledBackPointer = JSON.parse(await readFile(path.join(workspace, 'current.json'), 'utf8'));
    assert.equal(rolledBackPointer.releaseId, first.releaseId);
    assert.equal(rolledBackPointer.previousReleaseId, second.releaseId);
    assert.equal(rolledBackPointer.previousManifestSha256, secondPointer.manifestSha256);
    assert.equal(rolledBackPointer.previousIndexSha256, secondPointer.indexSha256);
    assert.ok((await readdir(path.join(workspace, 'history'))).length >= 2);

    const healthFiles = await readdir(path.join(workspace, 'health'));
    assert.deepEqual(healthFiles, ['tegiwa-2026-08.jsonl']);
    const health = await readFile(path.join(workspace, 'health', healthFiles[0]), 'utf8');
    for (const line of health.trim().split(/\r?\n/)) assert.doesNotThrow(() => JSON.parse(line));
    assert.doesNotMatch(health, /PUBLIC-[AB]|candidate-one|candidate-two|baseline\.json|private\.example/i);
    assert.deepEqual(await readdir(path.join(workspace, 'staging')), []);
    assert.equal((await readdir(workspace)).some(name => /^\.current\.json\..*\.tmp$/.test(name)), false);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('abnormal candidates cannot replace current.json or create a release', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'projx-vendor-sync-gate-'));
  const workspace = path.join(temporary, 'workspace');
  try {
    const baselinePath = await writeIndex(temporary, 'baseline.json', fixtureIndex());
    const goodPath = await writeIndex(temporary, 'good.json', fixtureIndex());
    const good = await runTegiwaSync({
      workspace, repoRoot, inputPath: goodPath, inputKind: 'public-index', baselinePath, now: NOW
    });
    const pointerBefore = await readFile(path.join(workspace, 'current.json'), 'utf8');
    const releasesBefore = await readdir(path.join(workspace, 'releases'));
    const badPath = await writeIndex(temporary, 'bad.json', fixtureIndex({ keep: 2 }));
    await assert.rejects(
      runTegiwaSync({ workspace, repoRoot, inputPath: badPath, inputKind: 'public-index', now: NOW + 60_000 }),
      error => error instanceof VendorSyncError && error.code === 'abnormal_change_blocked'
    );
    assert.equal(await readFile(path.join(workspace, 'current.json'), 'utf8'), pointerBefore);
    assert.deepEqual(await readdir(path.join(workspace, 'releases')), releasesBefore);
    assert.deepEqual(await readdir(path.join(workspace, 'staging')), []);
    assert.equal(JSON.parse(pointerBefore).releaseId, good.releaseId);

    const privateFieldName = 'supplier_private_secret_marker';
    const privateShapedPath = await writeIndex(temporary, 'private-shaped.json', {
      ...fixtureIndex(),
      [privateFieldName]: 'must-never-reach-health'
    });
    await assert.rejects(
      runTegiwaSync({
        workspace, repoRoot, inputPath: privateShapedPath, inputKind: 'public-index', now: NOW + 120_000
      }),
      error => error instanceof VendorSyncError && error.code === 'invalid_stock_index'
    );
    const health = await readFile(path.join(workspace, 'health', 'tegiwa-2026-08.jsonl'), 'utf8');
    assert.match(health, /"code":"invalid_stock_index"/);
    assert.doesNotMatch(health, /supplier_private_secret_marker|must-never-reach-health|private-shaped/i);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('exclusive run lock blocks overlap and is never broken automatically', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'projx-vendor-sync-lock-'));
  try {
    const release = await acquireRunLock(temporary, { runId: 'test-run', now: NOW });
    await assert.rejects(
      acquireRunLock(temporary, { runId: 'overlap', now: NOW }),
      error => error instanceof VendorSyncError && error.code === 'run_locked'
    );
    assert.equal((await readdir(temporary)).includes('.vendor-sync.lock'), true);
    await release();
    assert.equal((await readdir(temporary)).includes('.vendor-sync.lock'), false);

    await writeFile(path.join(temporary, '.vendor-sync.lock'), '{"stale":true}\n', 'utf8');
    await assert.rejects(
      acquireRunLock(temporary, { runId: 'stale-check', now: NOW }),
      error => error instanceof VendorSyncError && error.code === 'run_locked'
    );
    await unlink(path.join(temporary, '.vendor-sync.lock'));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
