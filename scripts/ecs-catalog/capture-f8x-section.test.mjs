import test from 'node:test';
import assert from 'node:assert/strict';
import {
  link, mkdir, mkdtemp, readFile, rm, symlink, writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  F8X_CAPTURE_ID,
  F8X_CAPTURE_PROFILES,
  captureEcsF8xSection,
  getF8xCaptureProfile,
  resolveF8xCaptureOutput,
} from './capture-f8x-section.mjs';

const observedAt = new Date(Date.now() - 60_000).toISOString();

function visibleLink(href, text, extra = {}) {
  return { href, text, visible: true, ...extra };
}

function listingRecord(id) {
  return {
    availabilityText: 'In Stock',
    brand: 'Fixture Brand',
    description: `Fixture description ${id}`,
    ecsPartNumber: String(5_200_000 + id),
    imageAlt: `Fixture product ${id}`,
    imageFallbackUrl: `https://assets.ecstuning.com/product_library/${id}_x300.jpg`,
    imageUrl: `https://assets.ecstuning.com/product_library/${id}_x300.webp`,
    manufacturerPartNumber: `F8X-${id}`,
    priceBlockText: `$${id}.00 USD`,
    priceText: `$${id}.00 USD`,
    productUrl: `https://www.ecstuning.com/b-fixture-parts/f8x-product-${id}/f8x-${id}/`,
    shippingText: 'Shipping calculated at checkout',
    title: `F8X fixture product ${id}`,
  };
}

function fixturePages(profile) {
  const sectionUrl = `${profile.rootUrl}Engine/`;
  const categoryUrl = `${sectionUrl}Performance/`;
  const page2Url = `${categoryUrl}2`;
  return {
    categoryUrl,
    page2Url,
    pages: new Map([
      [profile.rootUrl, {
        title: `${profile.vehicle} Parts`,
        links: [visibleLink(sectionUrl, 'Engine', { dataCount: '17' })],
        records: [],
      }],
      [sectionUrl, {
        title: `${profile.vehicle} Engine Parts`,
        links: [visibleLink(categoryUrl, 'Performance', { dataCount: '17' })],
        records: [],
      }],
      [categoryUrl, {
        title: `${profile.vehicle} Performance Parts`,
        links: [visibleLink(sectionUrl, 'Engine'), visibleLink(page2Url, '2')],
        records: Array.from({ length: 16 }, (_, index) => listingRecord(index + 1)),
      }],
      [page2Url, {
        title: `${profile.vehicle} Performance Parts - Page 2`,
        links: [visibleLink(sectionUrl, 'Engine')],
        records: [listingRecord(17)],
      }],
    ]),
  };
}

class FixtureBrowser {
  constructor(profile, startUrl = profile.rootUrl) {
    this.profile = profile;
    const fixture = fixturePages(profile);
    this.pages = fixture.pages;
    this.categoryUrl = fixture.categoryUrl;
    this.page2Url = fixture.page2Url;
    this.currentUrl = startUrl;
    this.extractions = 0;
  }

  page() {
    const page = this.pages.get(this.currentUrl);
    if (!page) throw new Error(`Missing fixture page ${this.currentUrl}`);
    return page;
  }

  async getCurrentUrl() { return this.currentUrl; }

  async getPageState() {
    return { title: this.page().title, url: this.currentUrl, bodyText: this.page().title };
  }

  async getVisibleLinks() { return this.page().links; }

  async clickVisibleHref(href) {
    assert.ok(this.page().links.some((link) => link.visible && link.href === href));
    this.currentUrl = href;
  }

  async gotoCheckpointUrl(href, categoryUrl) {
    assert.ok(href === categoryUrl || href.startsWith(categoryUrl));
    this.currentUrl = href;
  }

  async getRenderedListingCount() { return this.page().records.length; }

  async getListingRecords(capture) {
    this.extractions += 1;
    return this.page().records.map((record, index) => ({
      ...record,
      category: capture.categoryName,
      categoryKey: capture.categoryKey,
      observedAt: capture.observedAt,
      relevancePosition: capture.basePosition + index,
      section: capture.section,
      sourceUrl: this.currentUrl,
      vehicle: capture.vehicle,
    }));
  }

  async wait() {}
}

test('freezes the three exact ECS F8X roots, identities and seven-section scope', () => {
  assert.deepEqual(Object.keys(F8X_CAPTURE_PROFILES), ['f80-m3', 'f82-m4', 'f83-m4']);
  assert.deepEqual(
    Object.values(F8X_CAPTURE_PROFILES).map((profile) => ({
      artifactPrefix: profile.artifactPrefix,
      rootUrl: profile.rootUrl,
      vehicle: profile.vehicle,
      vehicleKey: profile.vehicleKey,
    })),
    [
      {
        artifactPrefix: 'bmw-f80-m3',
        rootUrl: 'https://www.ecstuning.com/BMW-F80-M3-S55_3.0L/',
        vehicle: 'BMW F80 M3 S55 3.0L',
        vehicleKey: 'f80-m3',
      },
      {
        artifactPrefix: 'bmw-f82-m4',
        rootUrl: 'https://www.ecstuning.com/BMW-F82-M4-S55_3.0L/',
        vehicle: 'BMW F82 M4 S55 3.0L',
        vehicleKey: 'f82-m4',
      },
      {
        artifactPrefix: 'bmw-f83-m4',
        rootUrl: 'https://www.ecstuning.com/BMW-F83-M4-S55_3.0L/',
        vehicle: 'BMW F83 M4 S55 3.0L',
        vehicleKey: 'f83-m4',
      },
    ],
  );
  for (const profile of Object.values(F8X_CAPTURE_PROFILES)) {
    assert.equal(Object.isFrozen(profile), true);
    assert.deepEqual(profile.sections, [
      'Braking', 'Engine', 'Exterior', 'Interior', 'Performance', 'Suspension', 'Steering',
    ]);
  }
  assert.throws(() => getF8xCaptureProfile('f87-m2'), /Unsupported F8X vehicle/);
});

test('confines F8X evidence to the selected private-imports tree', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'projx-f8x-path-'));
  const privateRoot = path.join(workspace, 'private-imports');
  const wronglyNamedRoot = path.join(workspace, 'captures');
  await mkdir(privateRoot, { recursive: true });
  await mkdir(wronglyNamedRoot, { recursive: true });
  const expected = path.join(privateRoot, F8X_CAPTURE_ID, 'f80-m3', 'engine');
  assert.equal(resolveF8xCaptureOutput({
    privateRoot, section: 'Engine', vehicleKey: 'f80-m3',
  }), expected);
  assert.throws(() => resolveF8xCaptureOutput({
    outputDir: path.join(workspace, 'public-output'),
    privateRoot,
    section: 'Engine',
    vehicleKey: 'f80-m3',
  }), /exact private vehicle\/section directory/);
  assert.throws(() => resolveF8xCaptureOutput({
    privateRoot: wronglyNamedRoot,
    section: 'Engine',
    vehicleKey: 'f80-m3',
  }), /named private-imports/);
});

test('permits only the canonical repository private-imports tree and uses no process global', async () => {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const canonicalPrivate = path.join(repositoryRoot, 'private-imports');
  const assetsPrivate = path.join(repositoryRoot, 'assets', 'private-imports');

  assert.equal(resolveF8xCaptureOutput({
    privateRoot: 'private-imports',
    section: 'Engine',
    vehicleKey: 'f80-m3',
  }), path.join(canonicalPrivate, F8X_CAPTURE_ID, 'f80-m3', 'engine'));
  assert.throws(() => resolveF8xCaptureOutput({
    privateRoot: assetsPrivate,
    section: 'Engine',
    vehicleKey: 'f80-m3',
  }), /existing directory|canonical private-imports directory/);

  const externalWorkspace = await mkdtemp(path.join(os.tmpdir(), 'projx-f8x-relative-escape-'));
  const externalPrivate = path.join(externalWorkspace, 'private-imports');
  await mkdir(externalPrivate, { recursive: true });
  const relativeEscape = path.relative(repositoryRoot, externalPrivate);
  assert.equal(path.isAbsolute(relativeEscape), false);
  assert.throws(() => resolveF8xCaptureOutput({
    privateRoot: relativeEscape,
    section: 'Engine',
    vehicleKey: 'f80-m3',
  }), /Relative F8X capture privateRoot must be the canonical repository private-imports/);

  const source = await readFile(new URL('./capture-f8x-section.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bprocess\s*\./,
    'the browser-side Node REPL path resolver must not require a process global');
  assert.doesNotMatch(source, /\brepositoryRoot\b/,
    'callers must not be able to redefine the canonical repository root');
});

test('rejects external root and descendant Windows junctions', async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'projx-f8x-junction-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const externalTarget = path.join(workspace, 'target');
  const linkedPrivate = path.join(workspace, 'linked', 'private-imports');
  await Promise.all([
    mkdir(externalTarget, { recursive: true }),
    mkdir(path.dirname(linkedPrivate), { recursive: true }),
  ]);
  await symlink(externalTarget, linkedPrivate, 'junction');
  assert.throws(() => resolveF8xCaptureOutput({
    privateRoot: linkedPrivate,
    section: 'Engine',
    vehicleKey: 'f80-m3',
  }), /symbolic link or junction/);

  const realPrivate = path.join(workspace, 'real', 'private-imports');
  const childTarget = path.join(workspace, 'child-target');
  await Promise.all([
    mkdir(realPrivate, { recursive: true }),
    mkdir(childTarget, { recursive: true }),
  ]);
  await symlink(childTarget, path.join(realPrivate, F8X_CAPTURE_ID), 'junction');
  assert.throws(() => resolveF8xCaptureOutput({
    privateRoot: realPrivate,
    section: 'Engine',
    vehicleKey: 'f80-m3',
  }), /contains a symbolic link or junction/);
});

test('rejects linked capture subdirectories and derived artifacts before any write', async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'projx-f8x-linked-tree-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const privateRoot = path.join(workspace, 'private-imports');
  const output = path.join(privateRoot, F8X_CAPTURE_ID, 'f80-m3', 'engine');
  const redirectedDirectory = path.join(workspace, 'redirected-directory');
  await Promise.all([
    mkdir(output, { recursive: true }),
    mkdir(redirectedDirectory, { recursive: true }),
  ]);

  for (const child of ['raw-pages', 'terminal-proofs']) {
    const linkedChild = path.join(output, child);
    await symlink(redirectedDirectory, linkedChild, 'junction');
    assert.throws(() => resolveF8xCaptureOutput({
      privateRoot,
      section: 'Engine',
      vehicleKey: 'f80-m3',
    }), /capture tree contains a symbolic link.*junction/);
    await rm(linkedChild, { recursive: true, force: true });
  }

  const redirectedFile = path.join(workspace, 'redirected-derived.json');
  const linkedDerived = path.join(output, 'bmw-f80-m3-engine-records.json');
  await writeFile(redirectedFile, '{"outside":true}\n', 'utf8');
  await link(redirectedFile, linkedDerived);
  assert.throws(() => resolveF8xCaptureOutput({
    privateRoot,
    section: 'Engine',
    vehicleKey: 'f80-m3',
  }), /capture tree contains a symbolic link.*hard-linked file/);
  assert.equal(await readFile(redirectedFile, 'utf8'), '{"outside":true}\n');
});

test('continues to support an existing explicit external private work root', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'projx-f8x-external-'));
  const externalPrivate = path.join(workspace, 'private-imports');
  await mkdir(externalPrivate, { recursive: true });
  assert.equal(resolveF8xCaptureOutput({
    privateRoot: externalPrivate,
    section: 'Suspension',
    vehicleKey: 'f83-m4',
  }), path.join(externalPrivate, F8X_CAPTURE_ID, 'f83-m4', 'suspension'));
});

test('resumes and reconciles F8X capture with vehicle-specific kinds and filenames', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'projx-f8x-capture-'));
  const privateRoot = path.join(workspace, 'private-imports');
  await mkdir(privateRoot, { recursive: true });
  const profile = getF8xCaptureProfile('f80-m3');
  const firstBrowser = new FixtureBrowser(profile);
  const first = await captureEcsF8xSection(firstBrowser, {
    vehicleKey: 'f80-m3',
    section: 'Engine',
    privateRoot,
    navigationDelayMs: 0,
    pageBudget: 1,
    now: () => new Date(observedAt),
  });
  assert.equal(first.complete, false);
  assert.equal(first.capturedPagesThisRun, 1);

  const resumedBrowser = new FixtureBrowser(profile, firstBrowser.page2Url);
  const result = await captureEcsF8xSection(resumedBrowser, {
    vehicleKey: 'f80-m3',
    section: 'Engine',
    privateRoot,
    navigationDelayMs: 0,
    now: () => new Date(observedAt),
  });
  assert.equal(result.complete, true);
  assert.equal(result.capturedPagesThisRun, 1);
  assert.equal(result.capturedPlacements, 17);
  assert.equal(result.uniqueEcsProducts, 17);
  assert.equal(result.outputDir, path.join(privateRoot, F8X_CAPTURE_ID, 'f80-m3', 'engine'));

  const root = JSON.parse(await readFile(path.join(result.outputDir, 'section-root.json'), 'utf8'));
  const rawPage = JSON.parse(await readFile(
    path.join(result.outputDir, 'raw-pages', 'engine-performance-p1.json'),
    'utf8',
  ));
  const aggregate = JSON.parse(await readFile(
    path.join(result.outputDir, 'bmw-f80-m3-engine-records.json'),
    'utf8',
  ));
  const report = JSON.parse(await readFile(result.report, 'utf8'));
  const terminalProof = JSON.parse(await readFile(path.join(
    result.outputDir,
    'terminal-proofs',
    'engine-performance-terminal.json',
  ), 'utf8'));
  assert.equal(root.kind, 'bmw-f80-m3-section-root-snapshot');
  assert.equal(root.rootUrl, profile.rootUrl);
  assert.equal(root.vehicle, profile.vehicle);
  assert.equal(rawPage.kind, 'bmw-f80-m3-section-listing-page');
  assert.equal(rawPage.vehicle, profile.vehicle);
  assert.equal(aggregate.kind, 'bmw-f80-m3-engine-listing-capture');
  assert.equal(aggregate.vehicle, profile.vehicle);
  assert.equal(report.kind, 'bmw-f80-m3-engine-reconciliation-report');
  assert.equal(report.completeness.complete, true);
  assert.equal(report.safeguards.nextUncheckpointPageValidated, true);
  assert.equal(report.scope.terminalProofs, 1);
  assert.equal(terminalProof.kind, 'bmw-f80-m3-section-terminal-pagination-proof');
  assert.equal(terminalProof.vehicle, profile.vehicle);
});

test('rejects reusing one vehicle output directory for another F8X profile', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'projx-f8x-isolation-'));
  const privateRoot = path.join(workspace, 'private-imports');
  await mkdir(privateRoot, { recursive: true });
  const f80 = getF8xCaptureProfile('f80-m3');
  const f80Browser = new FixtureBrowser(f80);
  const captured = await captureEcsF8xSection(f80Browser, {
    vehicleKey: 'f80-m3', section: 'Engine', privateRoot,
    navigationDelayMs: 0, pageBudget: 0, now: () => new Date(observedAt),
  });
  const f82 = getF8xCaptureProfile('f82-m4');
  await assert.rejects(captureEcsF8xSection(new FixtureBrowser(f82), {
    vehicleKey: 'f82-m4',
    section: 'Engine',
    privateRoot,
    outputDir: captured.outputDir,
    navigationDelayMs: 0,
    pageBudget: 0,
    now: () => new Date(observedAt),
  }), /exact private vehicle\/section directory/);
});

test('rejects F80 evidence manually copied into the exact F82 output directory', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'projx-f8x-copied-profile-'));
  const privateRoot = path.join(workspace, 'private-imports');
  await mkdir(privateRoot, { recursive: true });
  const f80 = getF8xCaptureProfile('f80-m3');
  const f80Capture = await captureEcsF8xSection(new FixtureBrowser(f80), {
    vehicleKey: 'f80-m3',
    section: 'Engine',
    privateRoot,
    navigationDelayMs: 0,
    pageBudget: 0,
    terminalProofBudget: 0,
    now: () => new Date(observedAt),
  });
  const copiedRoot = await readFile(path.join(f80Capture.outputDir, 'section-root.json'), 'utf8');
  const f82Output = resolveF8xCaptureOutput({
    privateRoot,
    section: 'Engine',
    vehicleKey: 'f82-m4',
  });
  await mkdir(f82Output, { recursive: true });
  await writeFile(path.join(f82Output, 'section-root.json'), copiedRoot, 'utf8');

  const f82 = getF8xCaptureProfile('f82-m4');
  await assert.rejects(captureEcsF8xSection(new FixtureBrowser(f82), {
    vehicleKey: 'f82-m4',
    section: 'Engine',
    privateRoot,
    navigationDelayMs: 0,
    pageBudget: 0,
    terminalProofBudget: 0,
    now: () => new Date(observedAt),
  }), /section-root manifest is invalid/);
});
