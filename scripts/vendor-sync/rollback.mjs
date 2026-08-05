#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { rollbackTegiwaRelease, VendorSyncError } from './lib.mjs';

const defaultWorkspace = process.platform === 'win32'
  ? 'D:\\Projx-Racing-Website-Data\\vendor-feeds\\tegiwa'
  : '';

function usage() {
  return `
Usage:
  node scripts/vendor-sync/rollback.mjs --previous [--workspace <directory>] [--dry-run]
  node scripts/vendor-sync/rollback.mjs --release <release-id> [--workspace <directory>] [--dry-run]

The selected retained release is checksum-validated before current.json changes.
This command performs no network request, publication or deployment.
`;
}

function parseArgs(argv) {
  const values = Object.create(null);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '--dry-run' || argument === '--previous') {
      const key = argument.slice(2);
      if (Object.hasOwn(values, key)) throw new VendorSyncError('invalid_arguments', `Duplicate option: ${argument}`);
      values[key] = true;
      continue;
    }
    if (argument === '--workspace' || argument === '--release') {
      const key = argument.slice(2);
      if (Object.hasOwn(values, key)) throw new VendorSyncError('invalid_arguments', `Duplicate option: ${argument}`);
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new VendorSyncError('invalid_arguments', `Missing value for ${argument}`);
      values[key] = value;
      index += 1;
      continue;
    }
    throw new VendorSyncError('invalid_arguments', `Unsupported option: ${argument}`);
  }
  return values;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  if (Boolean(options.previous) === Boolean(options.release)) {
    throw new VendorSyncError('invalid_arguments', `Choose exactly one rollback target.\n${usage()}`);
  }
  const workspace = options.workspace || defaultWorkspace;
  if (!workspace) throw new VendorSyncError('invalid_arguments', '--workspace is required on this operating system.');
  const result = await rollbackTegiwaRelease({
    workspace: path.resolve(workspace),
    releaseId: options.release || null,
    previous: Boolean(options.previous),
    dryRun: Boolean(options['dry-run'])
  });
  process.stdout.write(`${JSON.stringify({
    status: result.dryRun ? 'dry_run_passed' : 'rolled_back',
    vendor: 'tegiwa',
    releaseId: result.releaseId,
    previousReleaseId: result.previousReleaseId
  }, null, 2)}\n`);
}

main().catch(error => {
  const safe = error instanceof VendorSyncError
    ? { code: error.code, message: error.message }
    : { code: 'unexpected_failure', message: 'The local Tegiwa rollback stopped unexpectedly.' };
  process.stderr.write(`Vendor rollback stopped [${safe.code}]: ${safe.message}\n`);
  process.exitCode = 1;
});
