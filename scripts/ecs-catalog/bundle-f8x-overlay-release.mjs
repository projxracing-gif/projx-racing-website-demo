import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import {
  F8X_OVERLAY_MANIFEST_KIND,
  readReviewedProductShardRelease
} from './build-reviewed-product-shards.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');

function argument(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0 || !argv[index + 1] || argv[index + 1].startsWith('--')) {
    throw new Error(`Missing ${name}.`);
  }
  return argv[index + 1];
}

export async function bundleF8xOverlayRelease({ sourceDirectory, outputDirectory } = {}) {
  if (!sourceDirectory || !outputDirectory) throw new Error('Source and output directories are required.');
  const release = await readReviewedProductShardRelease(sourceDirectory);
  if (release.manifest.kind !== F8X_OVERLAY_MANIFEST_KIND || release.manifest.complete !== true) {
    throw new Error('Only a complete reviewed F8X overlay release may be bundled.');
  }

  const outputRoot = path.resolve(outputDirectory);
  await mkdir(outputRoot, { recursive: false });
  const manifestBuffer = await readFile(path.join(release.root, 'manifest.json'));
  await writeFile(path.join(outputRoot, 'manifest.json'), manifestBuffer, { flag: 'wx' });

  const files = [];
  let rawBytes = manifestBuffer.length;
  let bundledBytes = manifestBuffer.length;
  for (const descriptor of [release.manifest.index, ...release.manifest.shards]) {
    const source = await readFile(path.join(release.root, descriptor.file));
    if (source.length !== descriptor.bytes || sha256(source) !== descriptor.sha256) {
      throw new Error(`${descriptor.file} failed its reviewed release binding.`);
    }
    const compressed = gzipSync(source, { level: 9, mtime: 0 });
    if (!gunzipSync(compressed).equals(source)) throw new Error(`${descriptor.file} failed gzip verification.`);
    const outputFile = `${descriptor.file}.gz`;
    await writeFile(path.join(outputRoot, outputFile), compressed, { flag: 'wx' });
    files.push(Object.freeze({
      file: outputFile,
      sourceBytes: source.length,
      sourceSha256: descriptor.sha256,
      bytes: compressed.length,
      sha256: sha256(compressed)
    }));
    rawBytes += source.length;
    bundledBytes += compressed.length;
  }

  const summary = {
    schemaVersion: 1,
    kind: 'ecs-reviewed-f8x-overlay-bundle',
    releaseId: release.manifest.releaseId,
    productCount: release.manifest.counts.productCount,
    shardCount: release.manifest.counts.shardCount,
    manifestSha256: sha256(manifestBuffer),
    rawBytes,
    bundledBytes,
    files
  };
  await writeFile(
    path.join(outputRoot, 'bundle-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    { flag: 'wx' }
  );
  return Object.freeze(summary);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.some(value => value.startsWith('--') && !['--source', '--output'].includes(value))) {
    throw new Error('Usage: bundle-f8x-overlay-release.mjs --source <reviewed-release> --output <empty-directory>.');
  }
  const summary = await bundleF8xOverlayRelease({
    sourceDirectory: argument(argv, '--source'),
    outputDirectory: argument(argv, '--output')
  });
  process.stdout.write(`${JSON.stringify({
    releaseId: summary.releaseId,
    productCount: summary.productCount,
    shardCount: summary.shardCount,
    rawBytes: summary.rawBytes,
    bundledBytes: summary.bundledBytes
  })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
