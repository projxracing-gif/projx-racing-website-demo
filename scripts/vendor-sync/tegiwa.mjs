#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { runTegiwaSync, VendorSyncError } from './lib.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaultWorkspace = process.platform === 'win32'
  ? 'D:\\Projx-Racing-Website-Data\\vendor-feeds\\tegiwa'
  : '';
const defaultPrivateArchive = process.platform === 'win32'
  ? 'D:\\Projx-Racing-Website-Data\\secure-private\\tegiwa\\source-archives'
  : '';

function usage() {
  return `
Usage:
  node scripts/vendor-sync/tegiwa.mjs --stock-csv <private.csv> --checked-at <YYYY-MM-DD> [options]
  node scripts/vendor-sync/tegiwa.mjs --prepared-index <public-index.json> [options]
  node scripts/vendor-sync/tegiwa.mjs --download [--checked-at <YYYY-MM-DD>] [options]

Options:
  --download                Fetch the approved fixed HTTPS Tegiwa stockfeed; redirects are blocked
  --workspace <directory>   Local vendor workspace (Windows default: ${defaultWorkspace || 'required'})
  --private-archive <dir>   Private raw-download archive (Windows default configured; required elsewhere)
  --baseline <index.json>   Initial previous-good public index when current.json does not exist
  --thresholds <file.json>  Optional safety-threshold overrides; unknown/out-of-range values fail
  --allow-initial           Permit first promotion without a baseline (not recommended)
  --dry-run                 Stage, build and validate without creating a release or changing current.json
  --help                    Show this help

Only the explicit --download mode performs a network request, and only to:
  https://scripts.tegiwa.de/dealer-stock/
No mode publishes, deploys, schedules a task or contacts a cloud service.
`;
}

function parseArgs(argv) {
  const values = Object.create(null);
  const flags = new Set(['download', 'dry-run', 'allow-initial', 'help']);
  const valued = new Set([
    'workspace', 'private-archive', 'stock-csv', 'prepared-index', 'checked-at', 'baseline', 'thresholds'
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) throw new VendorSyncError('invalid_arguments', `Unexpected argument: ${argument}`);
    const key = argument.slice(2);
    if (Object.hasOwn(values, key)) throw new VendorSyncError('invalid_arguments', `Duplicate option: ${argument}`);
    if (flags.has(key)) values[key] = true;
    else if (valued.has(key)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new VendorSyncError('invalid_arguments', `Missing value for ${argument}`);
      values[key] = value;
      index += 1;
    } else {
      throw new VendorSyncError('invalid_arguments', `Unsupported option: ${argument}`);
    }
  }
  return values;
}

async function loadThresholds(filePath) {
  if (!filePath) return {};
  const absolute = path.resolve(filePath);
  const metadata = await import('node:fs/promises').then(module => module.lstat(absolute));
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 2 || metadata.size > 64 * 1024) {
    throw new VendorSyncError('invalid_thresholds', 'The threshold file is missing or outside its safe size limit.');
  }
  try {
    return JSON.parse((await readFile(absolute, 'utf8')).replace(/^\uFEFF/, ''));
  } catch {
    throw new VendorSyncError('invalid_thresholds', 'The threshold file is not valid JSON.');
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  const hasCsv = Boolean(options['stock-csv']);
  const hasIndex = Boolean(options['prepared-index']);
  const hasDownload = Boolean(options.download);
  if ([hasCsv, hasIndex, hasDownload].filter(Boolean).length !== 1) {
    throw new VendorSyncError('invalid_arguments', `Choose exactly one input mode.\n${usage()}`);
  }
  if (hasCsv && !options['checked-at']) throw new VendorSyncError('invalid_arguments', '--checked-at is required with --stock-csv.');
  if (options['private-archive'] && !hasDownload) {
    throw new VendorSyncError('invalid_arguments', '--private-archive can be used only with --download.');
  }
  const workspace = options.workspace || defaultWorkspace;
  if (!workspace) throw new VendorSyncError('invalid_arguments', '--workspace is required on this operating system.');
  const privateArchivePath = hasDownload ? (options['private-archive'] || defaultPrivateArchive) : null;
  if (hasDownload && !privateArchivePath) {
    throw new VendorSyncError('invalid_arguments', '--private-archive is required with --download on this operating system.');
  }
  const result = await runTegiwaSync({
    workspace,
    repoRoot,
    inputPath: hasCsv ? options['stock-csv'] : (hasIndex ? options['prepared-index'] : null),
    inputKind: hasCsv ? 'stock-csv' : (hasIndex ? 'public-index' : 'approved-download'),
    privateArchivePath,
    checkedAt: options['checked-at'] || null,
    baselinePath: options.baseline || null,
    thresholdOverrides: await loadThresholds(options.thresholds),
    dryRun: Boolean(options['dry-run']),
    allowInitial: Boolean(options['allow-initial'])
  });
  process.stdout.write(`${JSON.stringify({
    status: result.noChange ? 'no_change' : (result.dryRun ? 'dry_run_passed' : 'promoted'),
    vendor: 'tegiwa',
    releaseId: result.releaseId,
    previousReleaseId: result.previousReleaseId,
    checkedAt: result.summary.checkedAt,
    productCount: result.summary.productCount,
    skuProductCount: result.summary.skuProductCount,
    availableProductCount: result.summary.availableProductCount
  }, null, 2)}\n`);
}

main().catch(error => {
  const safe = error instanceof VendorSyncError
    ? { code: error.code, message: error.message }
    : { code: 'unexpected_failure', message: 'The local Tegiwa sync stopped unexpectedly.' };
  process.stderr.write(`Vendor sync stopped [${safe.code}]: ${safe.message}\n`);
  process.exitCode = 1;
});
