import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdir, mkdtemp, readFile, readdir, rm, writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  BMW_M3_ROOT_URL,
  buildBmwM3ReconciliationReport,
  captureEcsBmwM3Section,
  createCodexTabEcsCaptureAdapter,
  discoverBmwM3ChildCategories,
  discoverBmwM3SectionLink,
  normalizeBmwM3Section,
  validateBmwM3PageCheckpoint,
  writeEcsCaptureJsonCreateOnly,
} from './capture-bmw-m3-section.mjs';

const SECTION_URL = 'https://www.ecstuning.com/BMW-M3/Engine/';
const PERFORMANCE_URL = 'https://www.ecstuning.com/BMW-M3/Engine/Performance/';
const PERFORMANCE_PAGE_2 = 'https://www.ecstuning.com/BMW-M3/Engine/Performance/2';
const TOOLS_URL = 'https://www.ecstuning.com/BMW-M3/Engine/Tools/';
const observedAt = new Date(Date.now() - 60_000).toISOString();

function visibleLink(href, text, extra = {}) {
  return { href, text, visible: true, ...extra };
}

function listingRecord(id) {
  return {
    availabilityText: 'In Stock',
    brand: 'Fixture Brand',
    description: `Fixture description ${id}`,
    ecsPartNumber: String(4_800_000 + id),
    imageAlt: `Fixture product ${id}`,
    imageFallbackUrl: `https://assets.ecstuning.com/product_library/${id}_x300.jpg`,
    imageUrl: `https://assets.ecstuning.com/product_library/${id}_x300.webp`,
    manufacturerPartNumber: `MPN-${id}`,
    priceBlockText: `$${id}.00 USD`,
    priceText: `$${id}.00 USD`,
    productUrl: `https://www.ecstuning.com/b-fixture-parts/product-${id}/mpn-${id}/`,
    shippingText: 'Shipping calculated at checkout',
    title: `Fixture product ${id}`,
  };
}

function fixturePages() {
  return new Map([
    [BMW_M3_ROOT_URL, {
      title: 'BMW M3 Parts',
      links: [
        visibleLink(SECTION_URL, 'Engine', { dataCount: '18' }),
        visibleLink('https://www.ecstuning.com/BMW-M3/Braking/', 'Braking', { dataCount: '5' }),
      ],
      records: [],
    }],
    [SECTION_URL, {
      title: 'BMW M3 Engine Parts',
      links: [
        visibleLink(PERFORMANCE_URL, 'Performance Engine Parts', { dataCount: '17' }),
        visibleLink(TOOLS_URL, 'Engine Tools', { countText: '1 product' }),
      ],
      records: [],
    }],
    [PERFORMANCE_URL, {
      title: 'BMW M3 Performance Engine Parts',
      links: [
        visibleLink(SECTION_URL, 'Engine'),
        visibleLink(PERFORMANCE_PAGE_2, '2'),
      ],
      records: Array.from({ length: 16 }, (_, index) => listingRecord(index + 1)),
    }],
    [PERFORMANCE_PAGE_2, {
      title: 'BMW M3 Performance Engine Parts - Page 2',
      links: [visibleLink(SECTION_URL, 'Engine')],
      records: [listingRecord(17)],
    }],
    [TOOLS_URL, {
      title: 'BMW M3 Engine Tools',
      links: [visibleLink(SECTION_URL, 'Engine')],
      records: [listingRecord(18)],
    }],
  ]);
}

class FixtureBrowser {
  constructor(startUrl = BMW_M3_ROOT_URL) {
    this.currentUrl = startUrl;
    this.pages = fixturePages();
    this.extractions = 0;
    this.gotoCalls = [];
    this.reloadCalls = [];
    this.renderedCountChecks = 0;
  }

  page() {
    const page = this.pages.get(this.currentUrl);
    if (!page) throw new Error(`Missing fixture page ${this.currentUrl}`);
    return page;
  }

  async getCurrentUrl() {
    return this.currentUrl;
  }

  async getPageState() {
    return { title: this.page().title, url: this.currentUrl, bodyText: this.page().title };
  }

  async getVisibleLinks() {
    return this.page().links;
  }

  async clickVisibleHref(href) {
    assert.ok(this.page().links.some((link) => link.visible && link.href === href), `link ${href} is visible`);
    this.currentUrl = href;
  }

  async gotoCheckpointUrl(href, categoryUrl) {
    assert.ok(this.pages.has(href), `checkpoint page ${href} exists`);
    assert.ok(href === categoryUrl || href.startsWith(categoryUrl), 'checkpoint stays in its category');
    this.gotoCalls.push({ href, categoryUrl });
    this.currentUrl = href;
  }

  async reloadCurrentPage() {
    this.reloadCalls.push(this.currentUrl);
  }

  async getRenderedListingCount() {
    this.renderedCountChecks += 1;
    return this.page().records.length;
  }

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

function createDomFallbackTab(visibleDom) {
  const state = {
    currentUrl: PERFORMANCE_URL,
    domClicks: [],
    locatorClicks: 0,
    linkReads: 0,
    visibleDomReads: 0,
  };
  const links = [{
    ariaLabel: '', contextText: 'Page 2', countText: '', dataCount: '',
    href: PERFORMANCE_PAGE_2, rawHref: '2', rel: '', text: '2', visible: true,
  }];
  const tab = {
    async url() { return state.currentUrl; },
    async title() { return 'BMW M3 Performance Engine Parts'; },
    async goto(url) { state.currentUrl = url; },
    dom_cua: {
      async get_visible_dom() {
        state.visibleDomReads += 1;
        return visibleDom;
      },
      async click(options) {
        state.domClicks.push(options);
        state.currentUrl = PERFORMANCE_PAGE_2;
      },
    },
    playwright: {
      async evaluate(pageFunction) {
        const source = String(pageFunction);
        if (source.includes('window.scrollTo')) return true;
        if (source.includes("querySelectorAll('a[href]')")) {
          state.linkReads += 1;
          return links;
        }
        return 'BMW M3 Performance Engine Parts';
      },
      locator() {
        const candidate = {
          async isVisible() { return true; },
          async waitFor() {},
          async click() {
            state.locatorClicks += 1;
            throw new Error('Input.dispatchMouseEvent timed out');
          },
        };
        return {
          async count() { return 1; },
          last() { return candidate; },
        };
      },
      async expectNavigation(action) { await action(); },
      async waitForTimeout() {},
    },
  };
  return { state, tab };
}

test('accepts only the seven explicit BMW M3 sections', () => {
  assert.equal(normalizeBmwM3Section('engine'), 'Engine');
  assert.equal(normalizeBmwM3Section(' Steering '), 'Steering');
  assert.throws(() => normalizeBmwM3Section('Drivetrain'), /Unsupported BMW M3 section/);
});

test('discovers section and child routes only from supplied visible links and requires counts', () => {
  const section = discoverBmwM3SectionLink([
    visibleLink('https://www.ecstuning.com/BMW-M3/Engine/', 'Engine (8,006)'),
    { href: 'https://www.ecstuning.com/BMW-M3/Exterior/', text: 'Exterior', visible: false },
  ], 'Engine');
  assert.equal(section.href, SECTION_URL);
  assert.equal(section.count, 8006);

  const categories = discoverBmwM3ChildCategories([
    visibleLink(PERFORMANCE_URL, 'Performance Engine Parts', { dataCount: '7,999' }),
    visibleLink(TOOLS_URL, 'Engine Tools (7)'),
    visibleLink(`${PERFORMANCE_URL}2`, '2'),
    visibleLink('https://www.ecstuning.com/b-fixture-parts/item/item/', 'A product'),
  ], section);
  assert.deepEqual(categories.map(({ name, count, href }) => ({ name, count, href })), [
    { name: 'Performance Engine Parts', count: 7999, href: PERFORMANCE_URL },
    { name: 'Engine Tools', count: 7, href: TOOLS_URL },
  ]);

  assert.throws(() => discoverBmwM3ChildCategories([
    visibleLink(PERFORMANCE_URL, 'Performance Engine Parts'),
  ], section), /counts are missing/);
});

test('captures in bounded chunks, accepts the exact next open page and emits exact reconciliation artifacts', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'projx-ecs-m3-capture-'));
  const firstBrowser = new FixtureBrowser();
  const first = await captureEcsBmwM3Section(firstBrowser, {
    section: 'Engine',
    outputDir,
    navigationDelayMs: 0,
    pageBudget: 1,
    now: () => new Date(observedAt),
  });
  assert.equal(first.complete, false);
  assert.equal(first.budgetExhausted, true);
  assert.equal(first.capturedPagesThisRun, 1);
  assert.equal(firstBrowser.extractions, 1);

  const wrongOpenPage = new FixtureBrowser(TOOLS_URL);
  await assert.rejects(captureEcsBmwM3Section(wrongOpenPage, {
    section: 'Engine',
    outputDir,
    navigationDelayMs: 0,
    now: () => new Date(observedAt),
  }), /neither the highest checkpoint nor its exact next uncaptured page/);

  const resumedBrowser = new FixtureBrowser(PERFORMANCE_PAGE_2);
  const result = await captureEcsBmwM3Section(resumedBrowser, {
    section: 'Engine',
    outputDir,
    navigationDelayMs: 0,
    now: () => new Date(observedAt),
  });
  assert.equal(result.complete, true);
  assert.equal(result.budgetExhausted, false);
  assert.equal(result.capturedPagesThisRun, 2);
  assert.equal(result.capturedPlacements, 18);
  assert.equal(result.uniqueEcsProducts, 18);
  assert.deepEqual(resumedBrowser.gotoCalls, [], 'the already-open exact next page is captured directly');

  const report = JSON.parse(await readFile(
    path.join(outputDir, 'bmw-m3-engine-reconciliation-report.json'),
    'utf8',
  ));
  assert.equal(report.completeness.complete, true);
  assert.equal(report.completeness.exactCategories, 2);
  assert.equal(report.scope.capturedPages, 3);
  assert.equal(report.scope.expectedPages, 3);
  assert.deepEqual(report.consistency.identityConflicts, []);
  assert.deepEqual(report.completeness.duplicatePlacements, []);
  assert.equal(report.safeguards.guessedCategoryRoutes, false);
  assert.equal(report.safeguards.challengeBypassUsed, false);
  assert.equal(report.safeguards.nextUncheckpointPageValidated, true);
  assert.equal(report.scope.terminalProofs, 2);

  const performanceProof = JSON.parse(await readFile(path.join(
    outputDir,
    'terminal-proofs',
    'engine-performance-engine-parts-terminal.json',
  ), 'utf8'));
  const toolsProof = JSON.parse(await readFile(path.join(
    outputDir,
    'terminal-proofs',
    'engine-engine-tools-terminal.json',
  ), 'utf8'));
  assert.equal(performanceProof.terminalPage, 2);
  assert.equal(performanceProof.expectedRenderedCount, 1);
  assert.equal(performanceProof.nextPageAbsent, true);
  assert.equal(toolsProof.terminalPage, 1);
  assert.equal(toolsProof.expectedRenderedCount, 1);
  assert.equal(toolsProof.nextPageAbsent, true);

  const completedBrowser = new FixtureBrowser(SECTION_URL);
  const completed = await captureEcsBmwM3Section(completedBrowser, {
    section: 'Engine',
    outputDir,
    navigationDelayMs: 0,
    now: () => new Date(observedAt),
  });
  assert.equal(completed.complete, true);
  assert.equal(completed.capturedPagesThisRun, 0);
  assert.equal(completedBrowser.extractions, 0);
});

test('resumes from an exact highest checkpoint through its visible next-page link', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'projx-ecs-m3-checkpoint-resume-'));
  const firstBrowser = new FixtureBrowser();
  await captureEcsBmwM3Section(firstBrowser, {
    section: 'Engine',
    outputDir,
    navigationDelayMs: 0,
    pageBudget: 1,
    now: () => new Date(observedAt),
  });

  const resumedBrowser = new FixtureBrowser(PERFORMANCE_URL);
  const result = await captureEcsBmwM3Section(resumedBrowser, {
    section: 'Engine',
    outputDir,
    navigationDelayMs: 0,
    now: () => new Date(observedAt),
  });
  assert.equal(result.complete, true);
  assert.equal(result.capturedPagesThisRun, 2);
  assert.deepEqual(resumedBrowser.gotoCalls, [], 'the exact open checkpoint is not reopened');
});

test('captures page 1 directly when the tab is on the exact next stored child category', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'projx-ecs-m3-next-category-'));
  const firstBrowser = new FixtureBrowser();
  const first = await captureEcsBmwM3Section(firstBrowser, {
    section: 'Engine',
    outputDir,
    navigationDelayMs: 0,
    pageBudget: 2,
    now: () => new Date(observedAt),
  });
  assert.equal(first.complete, false);
  assert.equal(first.capturedPagesThisRun, 2);
  assert.equal(firstBrowser.currentUrl, PERFORMANCE_PAGE_2);

  const nextCategoryBrowser = new FixtureBrowser(TOOLS_URL);
  const result = await captureEcsBmwM3Section(nextCategoryBrowser, {
    section: 'Engine',
    outputDir,
    navigationDelayMs: 0,
    now: () => new Date(observedAt),
  });
  assert.equal(result.complete, true);
  assert.equal(result.capturedPagesThisRun, 1);
  assert.equal(nextCategoryBrowser.extractions, 1);
  assert.deepEqual(nextCategoryBrowser.gotoCalls, [], 'the exact next category page is captured directly');
});

test('optionally reloads and revalidates the exact checkpoint before reading pagination', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'projx-ecs-m3-reload-pagination-'));
  const browser = new FixtureBrowser();
  const result = await captureEcsBmwM3Section(browser, {
    section: 'Engine',
    outputDir,
    navigationDelayMs: 0,
    paginationSettleDelayMs: 0,
    reloadBeforePagination: true,
    reloadSettleDelayMs: 0,
    now: () => new Date(observedAt),
  });
  assert.equal(result.complete, true);
  assert.deepEqual(browser.reloadCalls, [PERFORMANCE_URL]);
  assert.equal(browser.renderedCountChecks, 3,
    'one reload check plus two terminal-page rendered-count proofs are required');
});

test('reload recovery stops before pagination when the checkpoint card count changes', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'projx-ecs-m3-reload-mismatch-'));
  const browser = new FixtureBrowser();
  browser.getRenderedListingCount = async () => {
    browser.renderedCountChecks += 1;
    return 15;
  };
  await assert.rejects(captureEcsBmwM3Section(browser, {
    section: 'Engine',
    outputDir,
    navigationDelayMs: 0,
    paginationSettleDelayMs: 0,
    reloadBeforePagination: true,
    reloadSettleDelayMs: 0,
    now: () => new Date(observedAt),
  }), /reload expected 16 rendered product cards but observed 15/);
  assert.deepEqual(browser.reloadCalls, [PERFORMANCE_URL]);
  assert.equal(browser.renderedCountChecks, 3);
  assert.equal(browser.currentUrl, PERFORMANCE_URL, 'no paginator was clicked after failed validation');
});

test('fails closed when a visible higher page disproves an underreported category count', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'projx-ecs-m3-undercount-'));
  const browser = new FixtureBrowser();
  browser.pages.get(SECTION_URL).links = [
    visibleLink(PERFORMANCE_URL, 'Performance Engine Parts', { dataCount: '16' }),
    visibleLink(TOOLS_URL, 'Engine Tools', { countText: '1 product' }),
  ];

  await assert.rejects(captureEcsBmwM3Section(browser, {
    section: 'Engine',
    outputDir,
    navigationDelayMs: 0,
    now: () => new Date(observedAt),
  }), /visible next or higher pagination link/);

  const report = JSON.parse(await readFile(
    path.join(outputDir, 'bmw-m3-engine-reconciliation-report.json'),
    'utf8',
  ));
  assert.equal(report.completeness.complete, false);
  assert.equal(report.safeguards.nextUncheckpointPageValidated, false);
  assert.equal(report.scope.terminalProofs, 0);
});

test('requires terminal proof even for a supplier category that reports zero products', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'projx-ecs-m3-zero-'));
  const browser = new FixtureBrowser();
  browser.pages.get(SECTION_URL).links = [
    visibleLink(TOOLS_URL, 'Engine Tools', { dataCount: '0' }),
  ];
  browser.pages.get(TOOLS_URL).records = [];

  const result = await captureEcsBmwM3Section(browser, {
    section: 'Engine',
    outputDir,
    navigationDelayMs: 0,
    pageBudget: 0,
    now: () => new Date(observedAt),
  });
  assert.equal(result.complete, true);
  assert.equal(result.capturedPagesThisRun, 0);
  assert.equal(result.terminalProofsThisRun, 1);

  const proof = JSON.parse(await readFile(path.join(
    outputDir,
    'terminal-proofs',
    'engine-engine-tools-terminal.json',
  ), 'utf8'));
  assert.equal(proof.expectedPages, 0);
  assert.equal(proof.terminalPage, 1);
  assert.equal(proof.expectedRenderedCount, 0);
  assert.equal(proof.renderedCount, 0);
  assert.equal(proof.nextPageAbsent, true);

  await rm(path.join(outputDir, 'terminal-proofs'), { recursive: true });
  await mkdir(path.join(outputDir, 'terminal-proofs'), { recursive: true });
  const resumed = await captureEcsBmwM3Section(browser, {
    section: 'Engine',
    outputDir,
    navigationDelayMs: 0,
    pageBudget: 0,
    terminalProofBudget: 1,
    now: () => new Date(observedAt),
  });
  assert.equal(resumed.complete, true,
    'a proof-only resume accepts the same open zero-count category route');
});

test('rejects a zero-count category when its route renders a product card', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'projx-ecs-m3-false-zero-'));
  const browser = new FixtureBrowser();
  browser.pages.get(SECTION_URL).links = [
    visibleLink(TOOLS_URL, 'Engine Tools', { dataCount: '0' }),
  ];

  await assert.rejects(captureEcsBmwM3Section(browser, {
    section: 'Engine',
    outputDir,
    navigationDelayMs: 0,
    pageBudget: 0,
    now: () => new Date(observedAt),
  }), /expected 0 rendered product cards but observed 1/);
});

test('create-only JSON writes never replace an existing target and have one race winner', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'projx-ecs-create-only-'));
  const existing = path.join(outputDir, 'existing.json');
  await writeFile(existing, '{"owner":"original"}\n', 'utf8');
  await assert.rejects(
    writeEcsCaptureJsonCreateOnly(existing, { owner: 'replacement' }),
    /already exists and was not overwritten/,
  );
  assert.equal(await readFile(existing, 'utf8'), '{"owner":"original"}\n');

  const raced = path.join(outputDir, 'raced.json');
  const outcomes = await Promise.allSettled([
    writeEcsCaptureJsonCreateOnly(raced, { writer: 'left' }),
    writeEcsCaptureJsonCreateOnly(raced, { writer: 'right' }),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === 'rejected').length, 1);
  assert.match(outcomes.find((outcome) => outcome.status === 'rejected').reason.message,
    /already exists and was not overwritten/);
  assert.ok(['left', 'right'].includes(JSON.parse(await readFile(raced, 'utf8')).writer));
  assert.deepEqual((await readdir(outputDir)).filter((name) => name.endsWith('.tmp')), []);
});

test('adds missing terminal proofs in bounded resumes without rewriting root or page checkpoints', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'projx-ecs-m3-proof-resume-'));
  await captureEcsBmwM3Section(new FixtureBrowser(), {
    section: 'Engine', outputDir, navigationDelayMs: 0, now: () => new Date(observedAt),
  });
  const rootPath = path.join(outputDir, 'section-root.json');
  const pagePath = path.join(outputDir, 'raw-pages', 'engine-performance-engine-parts-p1.json');
  const originalRoot = await readFile(rootPath, 'utf8');
  const originalPage = await readFile(pagePath, 'utf8');
  await rm(path.join(outputDir, 'terminal-proofs'), { recursive: true });
  await mkdir(path.join(outputDir, 'terminal-proofs'), { recursive: true });

  const proofResumeBrowser = new FixtureBrowser(SECTION_URL);
  const firstResume = await captureEcsBmwM3Section(proofResumeBrowser, {
    section: 'Engine',
    outputDir,
    navigationDelayMs: 0,
    pageBudget: 0,
    terminalProofBudget: 1,
    now: () => new Date(observedAt),
  });
  assert.equal(firstResume.complete, false);
  assert.equal(firstResume.budgetExhausted, true);
  assert.equal(firstResume.capturedPagesThisRun, 0);
  assert.equal(firstResume.terminalProofsThisRun, 1);
  assert.equal(proofResumeBrowser.currentUrl, PERFORMANCE_PAGE_2,
    'the bounded proof batch remains on the earlier category terminal page');

  const secondResume = await captureEcsBmwM3Section(proofResumeBrowser, {
    section: 'Engine',
    outputDir,
    navigationDelayMs: 0,
    pageBudget: 0,
    terminalProofBudget: 1,
    now: () => new Date(observedAt),
  });
  assert.equal(secondResume.complete, true);
  assert.equal(secondResume.terminalProofsThisRun, 1);
  assert.equal(await readFile(rootPath, 'utf8'), originalRoot);
  assert.equal(await readFile(pagePath, 'utf8'), originalPage);
});

test('rejects an unsafe category key in a stored root before resolving checkpoint paths', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'projx-ecs-m3-unsafe-key-'));
  await captureEcsBmwM3Section(new FixtureBrowser(), {
    section: 'Engine',
    outputDir,
    navigationDelayMs: 0,
    pageBudget: 0,
    terminalProofBudget: 0,
    now: () => new Date(observedAt),
  });
  const rootPath = path.join(outputDir, 'section-root.json');
  const root = JSON.parse(await readFile(rootPath, 'utf8'));
  root.categories[0].key = 'safe/../../../../../../tracked';
  await writeFile(rootPath, `${JSON.stringify(root, null, 2)}\n`, 'utf8');

  await assert.rejects(captureEcsBmwM3Section(new FixtureBrowser(PERFORMANCE_URL), {
    section: 'Engine',
    outputDir,
    navigationDelayMs: 0,
    pageBudget: 0,
    terminalProofBudget: 0,
    now: () => new Date(observedAt),
  }), /child-category manifest is invalid/);
});

test('reconciliation refuses a truthy but unvalidated terminal-proof object', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'projx-ecs-m3-forged-proof-'));
  await captureEcsBmwM3Section(new FixtureBrowser(), {
    section: 'Engine', outputDir, navigationDelayMs: 0, now: () => new Date(observedAt),
  });
  const rootSnapshot = JSON.parse(await readFile(path.join(outputDir, 'section-root.json'), 'utf8'));
  const pages = await Promise.all((await readdir(path.join(outputDir, 'raw-pages')))
    .filter((name) => name.endsWith('.json'))
    .map(async (name) => JSON.parse(await readFile(path.join(outputDir, 'raw-pages', name), 'utf8'))));
  const forgedProofs = new Map(rootSnapshot.categories.map((category) => [category.key, {}]));

  assert.throws(() => buildBmwM3ReconciliationReport({
    captureStartedAt: rootSnapshot.discoveredAt,
    categories: rootSnapshot.categories,
    generatedAt: observedAt,
    pages,
    rootSnapshot,
    section: 'Engine',
    sectionKey: 'engine',
    terminalProofs: forgedProofs,
  }), /terminal-pagination proof is invalid/);
});

test('requires rendered-card counting for terminal proof on every browser adapter', async () => {
  const browser = new FixtureBrowser();
  browser.getRenderedListingCount = undefined;
  await assert.rejects(captureEcsBmwM3Section(browser, {
    section: 'Engine',
    outputDir: await mkdtemp(path.join(os.tmpdir(), 'projx-ecs-m3-adapter-')),
    navigationDelayMs: 0,
    now: () => new Date(observedAt),
  }), /Browser adapter is missing: getRenderedListingCount/);
});

test('rejects navigation away from the terminal page during proof observation', async () => {
  const browser = new FixtureBrowser();
  browser.pages.get(SECTION_URL).links = [
    visibleLink(TOOLS_URL, 'Engine Tools', { dataCount: '1' }),
  ];
  browser.getRenderedListingCount = async () => {
    const count = browser.page().records.length;
    browser.currentUrl = SECTION_URL;
    return count;
  };

  await assert.rejects(captureEcsBmwM3Section(browser, {
    section: 'Engine',
    outputDir: await mkdtemp(path.join(os.tmpdir(), 'projx-ecs-m3-proof-navigation-')),
    navigationDelayMs: 0,
    now: () => new Date(observedAt),
  }), /changed URL during terminal-pagination proof/);
});

test('settles a freshly captured terminal page before checking for late pagination', async () => {
  const browser = new FixtureBrowser();
  browser.pages.get(SECTION_URL).links = [
    visibleLink(TOOLS_URL, 'Engine Tools', { dataCount: '1' }),
  ];
  let terminalSettled = false;
  browser.wait = async (milliseconds) => {
    if (browser.currentUrl === TOOLS_URL && milliseconds === 25) terminalSettled = true;
  };
  browser.getVisibleLinks = async () => {
    const links = browser.page().links;
    return terminalSettled && browser.currentUrl === TOOLS_URL
      ? [...links, visibleLink(`${TOOLS_URL}2`, '2')]
      : links;
  };

  await assert.rejects(captureEcsBmwM3Section(browser, {
    section: 'Engine',
    outputDir: await mkdtemp(path.join(os.tmpdir(), 'projx-ecs-m3-late-pagination-')),
    navigationDelayMs: 0,
    paginationSettleDelayMs: 25,
    now: () => new Date(observedAt),
  }), /visible next or higher pagination link/);
  assert.equal(terminalSettled, true);
});

test('terminal-proof budget does not prevent capture of remaining immutable pages', async () => {
  const result = await captureEcsBmwM3Section(new FixtureBrowser(), {
    section: 'Engine',
    outputDir: await mkdtemp(path.join(os.tmpdir(), 'projx-ecs-m3-proof-budget-')),
    navigationDelayMs: 0,
    terminalProofBudget: 0,
    now: () => new Date(observedAt),
  });
  assert.equal(result.complete, false);
  assert.equal(result.budgetExhausted, true);
  assert.equal(result.capturedPagesThisRun, 3);
  assert.equal(result.capturedPlacements, 18);
  assert.equal(result.terminalProofsThisRun, 0);
  assert.equal(result.terminalProofs, 0);
});

test('rejects a page checkpoint with an incomplete required listing record', () => {
  const category = {
    key: 'engine-tools',
    name: 'Engine Tools',
    href: TOOLS_URL,
    count: 1,
  };
  const record = listingRecord(18);
  const pageRecord = {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    accessClass: 'public-retail',
    kind: 'bmw-m3-section-listing-page',
    vehicle: 'BMW M3',
    section: 'Engine',
    categoryKey: category.key,
    category: category.name,
    categoryUrl: category.href,
    page: 1,
    sourceUrl: category.href,
    basePosition: 1,
    expected: 1,
    observedAt,
    records: [{
      ...record,
      category: category.name,
      categoryKey: category.key,
      manufacturerPartNumber: '',
      observedAt,
      relevancePosition: 1,
      section: 'Engine',
      sourceUrl: category.href,
      vehicle: 'BMW M3',
    }],
  };
  assert.throws(
    () => validateBmwM3PageCheckpoint(pageRecord, category, { section: 'Engine', page: 1 }),
    /missing manufacturerPartNumber/,
  );
});

test('accepts valid ECS brand namespaces that do not end in parts', () => {
  const category = {
    key: 'performance-engine-parts',
    name: 'Performance Engine Parts',
    href: PERFORMANCE_URL,
    count: 1,
  };
  const pageRecord = {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    accessClass: 'public-retail',
    kind: 'bmw-m3-section-listing-page',
    vehicle: 'BMW M3',
    section: 'Engine',
    categoryKey: category.key,
    category: category.name,
    categoryUrl: category.href,
    page: 1,
    sourceUrl: category.href,
    basePosition: 1,
    expected: 1,
    observedAt,
    records: [{
      ...listingRecord(19),
      category: category.name,
      categoryKey: category.key,
      observedAt,
      productUrl: 'https://www.ecstuning.com/b-ati-performance-products/vac-harmonic-damper-crank-pulley/vac-hpcd-s55~vac/',
      relevancePosition: 1,
      section: 'Engine',
      sourceUrl: category.href,
      vehicle: 'BMW M3',
    }],
  };
  assert.doesNotThrow(
    () => validateBmwM3PageCheckpoint(pageRecord, category, { section: 'Engine', page: 1 }),
  );
});

test('stops immediately on an interactive challenge without clicking or extracting', async () => {
  const browser = new FixtureBrowser();
  browser.getPageState = async () => ({
    title: 'Just a moment...',
    url: BMW_M3_ROOT_URL,
    bodyText: 'Performing security verification',
  });
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'projx-ecs-m3-challenge-'));
  await assert.rejects(
    captureEcsBmwM3Section(browser, {
      section: 'Engine', outputDir, navigationDelayMs: 0, now: () => new Date(observedAt),
    }),
    /access challenge/,
  );
  assert.equal(browser.extractions, 0);
});

test('Codex tab adapter clicks the exact observed visible locator with an extended action deadline', async () => {
  let clicked = false;
  const evaluateOptions = [];
  let selector = '';
  let evaluateCalls = 0;
  let clickOptions = null;
  let navigationOptions = null;
  let scrollCalls = 0;
  let gotoUrl = null;
  let reloads = 0;
  let waitOptions = null;
  const viewportWaits = [];
  const links = [{
    ariaLabel: '',
    contextText: 'Performance Engine Parts 17',
    countText: '17',
    dataCount: '17',
    href: PERFORMANCE_URL,
    rawHref: 'Performance/',
    rel: '',
    text: 'Performance Engine Parts',
    visible: true,
  }];
  const tab = {
    async url() { return SECTION_URL; },
    async title() { return 'BMW M3 Engine Parts'; },
    async goto(url) { gotoUrl = url; },
    async reload() { reloads += 1; },
    playwright: {
      async evaluate(pageFunction, argument, options) {
        evaluateCalls += 1;
        evaluateOptions.push(options);
        const source = String(pageFunction);
        if (source.includes('window.scrollTo')) {
          scrollCalls += 1;
          assert.doesNotMatch(source, /\.click\s*\(/, 'viewport alignment must not synthesize a click');
          return true;
        }
        if (source.includes("querySelectorAll('a[href]')")) return links;
        if (source.includes("querySelectorAll('.product-listing.productListBox').length")) return 16;
        if (source.includes('.product-listing.productListBox')) return [];
        return 'BMW M3 Engine Parts';
      },
      locator(value) {
        selector = value;
        const candidate = {
          async isVisible() { return true; },
          async waitFor(options) { waitOptions = options; },
          async click(options) { clickOptions = options; clicked = true; },
        };
        return {
          async count() { return 1; },
          last() { return candidate; },
        };
      },
      async expectNavigation(action, options) { navigationOptions = options; await action(); },
      async waitForTimeout(milliseconds) { viewportWaits.push(milliseconds); },
    },
  };
  const adapter = createCodexTabEcsCaptureAdapter(tab);
  await adapter.getVisibleLinks();
  await adapter.reloadCurrentPage();
  assert.equal(await adapter.getRenderedListingCount(), 16);
  await adapter.clickVisibleHref(PERFORMANCE_URL);
  await adapter.getListingRecords({
    basePosition: 1,
    categoryKey: 'performance-engine-parts',
    categoryName: 'Performance Engine Parts',
    observedAt,
    section: 'Engine',
    vehicle: 'BMW M3',
  });
  await adapter.gotoCheckpointUrl(PERFORMANCE_PAGE_2, PERFORMANCE_URL);
  await assert.rejects(adapter.gotoCheckpointUrl(TOOLS_URL, PERFORMANCE_URL), /cross-category/);
  assert.equal(selector, 'a[href="Performance/"]');
  assert.equal(clicked, true);
  assert.deepEqual(waitOptions, { state: 'visible', timeoutMs: 10_000 });
  assert.deepEqual(clickOptions, { force: true, timeoutMs: 15_000 });
  assert.deepEqual(navigationOptions, { waitUntil: 'domcontentloaded', timeoutMs: 30_000 });
  assert.equal(scrollCalls, 1);
  assert.deepEqual(viewportWaits, [400]);
  assert.equal(gotoUrl, PERFORMANCE_PAGE_2);
  assert.equal(reloads, 1);
  assert.equal(evaluateCalls, 5, 'evaluations cover links, card count, challenge inspection, scroll alignment and records');
  assert.ok(evaluateOptions.every((options) => options?.timeoutMs === 15_000));
});

test('Codex tab adapter re-reads the visible href and retries one failed locator click', async () => {
  let clickAttempts = 0;
  let linkReads = 0;
  let scrollCalls = 0;
  const retryWaits = [];
  const links = [{
    ariaLabel: '', contextText: 'Page 2', countText: '', dataCount: '',
    href: PERFORMANCE_PAGE_2, rawHref: '2', rel: '', text: '2', visible: true,
  }];
  const tab = {
    async url() { return PERFORMANCE_URL; },
    async title() { return 'BMW M3 Performance Engine Parts'; },
    async goto() {},
    playwright: {
      async evaluate(pageFunction) {
        const source = String(pageFunction);
        if (source.includes('window.scrollTo')) {
          scrollCalls += 1;
          return true;
        }
        if (source.includes("querySelectorAll('a[href]')")) {
          linkReads += 1;
          return links;
        }
        return 'BMW M3 Performance Engine Parts';
      },
      locator() {
        const candidate = {
          async isVisible() { return true; },
          async waitFor() {},
          async click() {
            clickAttempts += 1;
            if (clickAttempts === 1) throw new Error('Input.dispatchMouseEvent timed out');
          },
        };
        return {
          async count() { return 1; },
          last() { return candidate; },
        };
      },
      async expectNavigation(action) { await action(); },
      async waitForTimeout(milliseconds) { retryWaits.push(milliseconds); },
    },
  };
  const adapter = createCodexTabEcsCaptureAdapter(tab);
  await adapter.getVisibleLinks();
  await adapter.clickVisibleHref(PERFORMANCE_PAGE_2);
  assert.equal(clickAttempts, 2);
  assert.equal(linkReads, 2, 'the failed click triggers one fresh visible-link read');
  assert.equal(scrollCalls, 2);
  assert.deepEqual(retryWaits, [400, 2_500, 400]);
});

test('Codex tab adapter falls back to the one exact visible DOM anchor after locator retries', async () => {
  const { state, tab } = createDomFallbackTab(
    '<nav><a node_id="22" href="2.*">not exact</a><a title="Page 2" href="2" node_id="23">2</a></nav>',
  );
  const adapter = createCodexTabEcsCaptureAdapter(tab, {
    clickRetryDelayMs: 0,
    viewportSettleMs: 0,
  });
  await adapter.getVisibleLinks();
  await adapter.clickVisibleHref(PERFORMANCE_PAGE_2);
  assert.equal(state.locatorClicks, 3);
  assert.equal(state.linkReads, 3, 'each retry retains a fresh exact-href observation');
  assert.equal(state.visibleDomReads, 1);
  assert.deepEqual(state.domClicks, [{ node_id: '23' }]);
  assert.equal(state.currentUrl, PERFORMANCE_PAGE_2);
});

test('Codex tab adapter refuses an ambiguous visible DOM href fallback', async () => {
  const { state, tab } = createDomFallbackTab(
    '<nav><a node_id="23" href="2">2</a><a node_id="24" href="2">2</a></nav>',
  );
  const adapter = createCodexTabEcsCaptureAdapter(tab, {
    clickRetryDelayMs: 0,
    viewportSettleMs: 0,
  });
  await adapter.getVisibleLinks();
  await assert.rejects(
    adapter.clickVisibleHref(PERFORMANCE_PAGE_2),
    /requires exactly one visible anchor matching the observed raw href; found 2/,
  );
  assert.equal(state.locatorClicks, 3);
  assert.equal(state.visibleDomReads, 1);
  assert.deepEqual(state.domClicks, []);
});

test('Codex tab adapter reports when DOM fallback capability is unavailable', async () => {
  const { state, tab } = createDomFallbackTab('');
  delete tab.dom_cua;
  const adapter = createCodexTabEcsCaptureAdapter(tab, {
    clickRetryDelayMs: 0,
    viewportSettleMs: 0,
  });
  await adapter.getVisibleLinks();
  await assert.rejects(
    adapter.clickVisibleHref(PERFORMANCE_PAGE_2),
    /DOM CUA visible-link fallback is unavailable after locator retries/,
  );
  assert.equal(state.locatorClicks, 3);
});
