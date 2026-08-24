import {
  existsSync, lstatSync, readdirSync, realpathSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SUPPORTED_BMW_M3_SECTIONS,
  captureEcsVehicleSection,
  createCodexTabEcsCaptureAdapter,
  normalizeEcsVehicleSection,
  slugifyCaptureLabel,
} from './capture-bmw-m3-section.mjs';

export const F8X_CAPTURE_ID = 'ecs-f8x-m3-m4-20260820';
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..', '..');

function comparablePath(value) {
  const resolved = path.resolve(value);
  return path.sep === '\\' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

function samePath(left, right) {
  return comparablePath(left) === comparablePath(right);
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertNoExistingLinkSegments(root, target) {
  const relative = path.relative(root, target);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!existsSync(current)) break;
    const status = lstatSync(current);
    if (status.isSymbolicLink() || !samePath(realpathSync(current), current)) {
      throw new Error(`F8X capture path contains a symbolic link or junction: ${current}.`);
    }
  }
}

function assertNoExistingLinkedTree(root) {
  if (!existsSync(root)) return;
  const visit = (current) => {
    const status = lstatSync(current);
    if (status.isSymbolicLink() || !samePath(realpathSync(current), current)
      || (status.isFile() && status.nlink !== 1)) {
      throw new Error(
        `F8X capture tree contains a symbolic link, junction, or hard-linked file: ${current}.`,
      );
    }
    if (status.isDirectory()) {
      for (const entry of readdirSync(current)) visit(path.join(current, entry));
    }
  };
  visit(root);
}

function frozenProfile({ artifactPrefix, rootUrl, vehicle, vehicleKey }) {
  return Object.freeze({
    artifactPrefix,
    defaultOutputDirectory: path.join('private-imports', F8X_CAPTURE_ID, vehicleKey),
    rootSnapshotKind: `${artifactPrefix}-section-root-snapshot`,
    rootUrl,
    sections: SUPPORTED_BMW_M3_SECTIONS,
    vehicle,
    vehicleKey,
  });
}

export const F80_M3_CAPTURE_PROFILE = frozenProfile({
  artifactPrefix: 'bmw-f80-m3',
  rootUrl: 'https://www.ecstuning.com/BMW-F80-M3-S55_3.0L/',
  vehicle: 'BMW F80 M3 S55 3.0L',
  vehicleKey: 'f80-m3',
});

export const F82_M4_CAPTURE_PROFILE = frozenProfile({
  artifactPrefix: 'bmw-f82-m4',
  rootUrl: 'https://www.ecstuning.com/BMW-F82-M4-S55_3.0L/',
  vehicle: 'BMW F82 M4 S55 3.0L',
  vehicleKey: 'f82-m4',
});

export const F83_M4_CAPTURE_PROFILE = frozenProfile({
  artifactPrefix: 'bmw-f83-m4',
  rootUrl: 'https://www.ecstuning.com/BMW-F83-M4-S55_3.0L/',
  vehicle: 'BMW F83 M4 S55 3.0L',
  vehicleKey: 'f83-m4',
});

export const F8X_CAPTURE_PROFILES = Object.freeze({
  'f80-m3': F80_M3_CAPTURE_PROFILE,
  'f82-m4': F82_M4_CAPTURE_PROFILE,
  'f83-m4': F83_M4_CAPTURE_PROFILE,
});

export function getF8xCaptureProfile(vehicleKey) {
  const key = String(vehicleKey ?? '').trim().toLocaleLowerCase('en-US');
  const profile = F8X_CAPTURE_PROFILES[key];
  if (!profile) {
    throw new Error(
      `Unsupported F8X vehicle ${JSON.stringify(vehicleKey)}. Choose one of: ${Object.keys(F8X_CAPTURE_PROFILES).join(', ')}.`,
    );
  }
  return profile;
}

export function resolveF8xCaptureOutput({
  outputDir = null,
  privateRoot = 'private-imports',
  section,
  vehicleKey,
}) {
  const profile = getF8xCaptureProfile(vehicleKey);
  const normalizedSection = normalizeEcsVehicleSection(section, profile);
  const repository = realpathSync(DEFAULT_REPOSITORY_ROOT);
  const canonicalRepositoryPrivateRoot = path.join(repository, 'private-imports');
  const explicitlyExternal = path.isAbsolute(privateRoot);
  const requestedPrivateRoot = path.isAbsolute(privateRoot)
    ? path.resolve(privateRoot) : path.resolve(repository, privateRoot);
  if (!explicitlyExternal && !samePath(requestedPrivateRoot, canonicalRepositoryPrivateRoot)) {
    throw new Error(
      'Relative F8X capture privateRoot must be the canonical repository private-imports directory; use an explicit absolute path for an external work root.',
    );
  }
  if (!existsSync(requestedPrivateRoot)) {
    throw new Error('The F8X capture privateRoot must be an existing directory.');
  }
  const privateRootStatus = lstatSync(requestedPrivateRoot);
  if (privateRootStatus.isSymbolicLink()) {
    throw new Error('The F8X capture privateRoot cannot be a symbolic link or junction.');
  }
  if (!privateRootStatus.isDirectory()) {
    throw new Error('The F8X capture privateRoot must be an existing directory.');
  }
  const resolvedPrivateRoot = realpathSync(requestedPrivateRoot);
  if (!samePath(resolvedPrivateRoot, requestedPrivateRoot)) {
    throw new Error('The F8X capture privateRoot cannot be a symbolic link or junction.');
  }
  if (path.basename(resolvedPrivateRoot).toLocaleLowerCase('en-US') !== 'private-imports') {
    throw new Error('The F8X capture privateRoot must be a directory named private-imports.');
  }
  const repositoryLocal = isWithin(repository, requestedPrivateRoot)
    || isWithin(repository, resolvedPrivateRoot);
  if (repositoryLocal && (!samePath(requestedPrivateRoot, canonicalRepositoryPrivateRoot)
    || !samePath(resolvedPrivateRoot, canonicalRepositoryPrivateRoot))) {
    throw new Error('Repository-local F8X capture output must remain under the canonical private-imports directory.');
  }
  const expectedOutput = path.resolve(
    resolvedPrivateRoot,
    F8X_CAPTURE_ID,
    profile.vehicleKey,
    slugifyCaptureLabel(normalizedSection),
  );
  const resolvedOutput = path.resolve(outputDir || expectedOutput);
  if (!samePath(expectedOutput, resolvedOutput)) {
    throw new Error(
      `F8X capture output must use its exact private vehicle/section directory: ${expectedOutput}.`,
    );
  }
  assertNoExistingLinkSegments(resolvedPrivateRoot, resolvedOutput);
  assertNoExistingLinkedTree(resolvedOutput);
  return resolvedOutput;
}

export async function captureEcsF8xSection(browser, {
  outputDir = null,
  privateRoot = 'private-imports',
  section,
  vehicleKey,
  ...captureOptions
} = {}) {
  const profile = getF8xCaptureProfile(vehicleKey);
  const resolvedOutput = resolveF8xCaptureOutput({
    outputDir,
    privateRoot,
    section,
    vehicleKey,
  });
  return captureEcsVehicleSection(browser, {
    ...captureOptions,
    outputDir: resolvedOutput,
    profile,
    section,
  });
}

export { createCodexTabEcsCaptureAdapter };
