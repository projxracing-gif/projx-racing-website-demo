import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { __test as imageValidation } from './materialize-page-assets.mjs';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const BROWSER_ASSET_ROOT = path.resolve(tmpdir(), 'browser-use', 'assets');
const MEDIA_ROOT = path.join(REPO, 'assets', 'products', 'ecs');
const ECS_LISTING_HOST = 'www.ecstuning.com';
const ECS_IMAGE_HOST = 'assets.ecstuning.com';
const CHALLENGE_TITLE = /^(?:just a moment|attention required|access denied)/i;
const CHALLENGE_TEXT = /(?:verify you are human|performing security verification|cloudflare ray id)/i;
const ALLOWED_TYPES = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});

export const BMW_M3_MEDIA_SECTIONS = Object.freeze([
  'braking',
  'engine',
  'exterior',
  'interior',
  'performance',
  'suspension',
  'steering',
]);

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function exactTimestamp(value) {
  const source = clean(value);
  const milliseconds = Date.parse(source);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === source
    && milliseconds <= Date.now() + (5 * 60 * 1_000) ? source : null;
}

export function canonicalBmwM3ListingUrl(value, expectedSection = null) {
  try {
    const url = new URL(clean(value));
    if (url.protocol !== 'https:' || url.hostname !== ECS_LISTING_HOST || url.username
      || url.password || url.port || url.search || url.hash) return null;
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length < 3 || segments[0].toLocaleLowerCase('en-US') !== 'bmw-m3') return null;
    if (expectedSection && segments[1].toLocaleLowerCase('en-US') !== expectedSection) return null;
    if (segments.some((segment) => segment === '.' || segment === '..')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function canonicalOfficialImageUrl(value) {
  try {
    const url = new URL(clean(value));
    if (url.protocol !== 'https:' || url.hostname !== ECS_IMAGE_HOST || url.username
      || url.password || url.port || url.search || url.hash) return null;
    if (!/\.(?:jpe?g|png|webp)$/i.test(url.pathname)
      || /\/ecs_box_no_image\.(?:jpe?g|png|webp)$/i.test(url.pathname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function pageKey(sourceUrl) {
  return createHash('sha256').update(sourceUrl).digest('hex');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function exists(filename) {
  try {
    return (await stat(filename)).isFile();
  } catch {
    return false;
  }
}

async function writeJsonAtomic(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, filename);
}

function validateCheckpoint(document, expectedSection) {
  const sectionLabel = expectedSection[0].toLocaleUpperCase('en-US') + expectedSection.slice(1);
  const sourceUrl = canonicalBmwM3ListingUrl(document?.sourceUrl, expectedSection);
  const categoryUrl = canonicalBmwM3ListingUrl(document?.categoryUrl, expectedSection);
  const page = Number(document?.page);
  const expected = Number(document?.expected);
  const categoryKey = clean(document?.categoryKey);
  const category = categoryUrl ? new URL(categoryUrl) : null;
  const source = sourceUrl ? new URL(sourceUrl) : null;
  const pageMatchesCategory = Boolean(category && source && (page === 1
    ? sourceUrl === categoryUrl
    : source.pathname === `${category.pathname.replace(/\/+$/, '')}/${page}`));
  if (document?.schemaVersion !== 1 || document?.supplier !== 'ECS Tuning'
    || document?.accessClass !== 'public-retail'
    || document?.kind !== 'bmw-m3-section-listing-page'
    || document?.vehicle !== 'BMW M3' || document?.section !== sectionLabel
    || !sourceUrl || !categoryUrl || !categoryKey || !pageMatchesCategory || !exactTimestamp(document?.observedAt)
    || !Number.isInteger(page) || page < 1 || !Number.isInteger(expected) || expected < 1 || expected > 16
    || !Array.isArray(document?.records) || document.records.length !== expected) {
    throw new Error(`BMW M3 ${sectionLabel} media checkpoint is invalid.`);
  }
  const records = document.records.map((record, index) => {
    const primaryUrl = canonicalOfficialImageUrl(record?.imageUrl);
    const fallbackUrl = canonicalOfficialImageUrl(record?.imageFallbackUrl);
    const ecsDigits = clean(record?.ecsPartNumber).replace(/^ES#/i, '');
    if (record?.section !== sectionLabel || record?.vehicle !== 'BMW M3'
      || clean(record?.categoryKey) !== categoryKey
      || canonicalBmwM3ListingUrl(record?.sourceUrl, expectedSection) !== sourceUrl
      || !/^\d{3,12}$/.test(ecsDigits)) {
      throw new Error(`BMW M3 ${sectionLabel} media record ${index + 1} is invalid.`);
    }
    return { ecsDigits, primaryUrl, fallbackUrl };
  });
  return {
    section: expectedSection,
    categoryKey,
    page,
    expected,
    observedAt: document.observedAt,
    sourceUrl,
    records,
  };
}

export function requestedImages(checkpoint, existingByUrl = new Map()) {
  const requested = [];
  for (const record of checkpoint.records) {
    if (!record.primaryUrl && !record.fallbackUrl) continue;
    const primaryUrl = record.primaryUrl || record.fallbackUrl;
    if (existingByUrl.has(primaryUrl)) continue;
    requested.push({
      ecsDigits: record.ecsDigits,
      primaryUrl,
      fallbackUrl: record.fallbackUrl && record.fallbackUrl !== primaryUrl
        ? record.fallbackUrl : null,
      observedAt: checkpoint.observedAt,
    });
  }
  return requested;
}

export function matchInventoryAssets(requested, inventory) {
  if (!Array.isArray(inventory?.assets)) throw new Error('Browser page-asset inventory is invalid.');
  const inventoryByUrl = new Map();
  for (const asset of inventory.assets) {
    const url = canonicalOfficialImageUrl(asset?.url);
    if (!url || asset?.kind !== 'image' || !clean(asset?.id)) continue;
    if (!inventoryByUrl.has(url)) inventoryByUrl.set(url, asset);
  }
  const selectedById = new Map();
  const aliases = [];
  const missing = [];
  for (const item of requested) {
    const asset = inventoryByUrl.get(item.primaryUrl)
      || (item.fallbackUrl ? inventoryByUrl.get(item.fallbackUrl) : null);
    if (!asset) {
      missing.push({ ecsDigits: item.ecsDigits, sourceUrl: item.primaryUrl });
      continue;
    }
    selectedById.set(asset.id, asset);
    aliases.push({
      assetId: asset.id,
      downloadedFromUrl: canonicalOfficialImageUrl(asset.url),
      sourceUrl: item.primaryUrl,
      observedAt: item.observedAt,
    });
  }
  return { assets: [...selectedById.values()], aliases, missing };
}

async function readPagePlan(captureDir, sections) {
  const pages = [];
  for (const section of sections) {
    const rawDirectory = path.join(captureDir, section, 'raw-pages');
    let filenames;
    try {
      const info = await stat(rawDirectory);
      if (!info.isDirectory()) continue;
      filenames = (await readdir(rawDirectory)).filter((name) => name.endsWith('.json')).sort();
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    for (const filename of filenames) {
      const document = JSON.parse(await readFile(path.join(rawDirectory, filename), 'utf8'));
      pages.push(validateCheckpoint(document, section));
    }
  }
  const unique = new Map();
  for (const page of pages) {
    const prior = unique.get(page.sourceUrl);
    if (prior && JSON.stringify(prior) !== JSON.stringify(page)) {
      throw new Error(`Conflicting BMW M3 media checkpoints for ${page.sourceUrl}.`);
    }
    unique.set(page.sourceUrl, page);
  }
  return [...unique.values()].sort((left, right) => sections.indexOf(left.section) - sections.indexOf(right.section)
    || left.categoryKey.localeCompare(right.categoryKey) || left.page - right.page);
}

async function readExistingIndex(indexPath) {
  if (!(await exists(indexPath))) return { generatedAt: null, images: new Map() };
  const document = JSON.parse(await readFile(indexPath, 'utf8'));
  if (document?.schemaVersion !== 1 || document?.supplier !== 'ECS Tuning'
    || !Array.isArray(document?.images)) throw new Error('Existing BMW M3 media index is invalid.');
  const generatedAt = exactTimestamp(document?.generatedAt);
  if (!generatedAt) throw new Error('Existing BMW M3 media index timestamp is invalid.');
  const result = new Map();
  for (const [position, image] of document.images.entries()) {
    const sourceUrl = canonicalOfficialImageUrl(image?.sourceUrl);
    const localPath = clean(image?.localPath).replaceAll('\\', '/');
    const resolved = path.resolve(REPO, localPath);
    const width = Number(image?.width);
    const height = Number(image?.height);
    const digest = clean(image?.sha256).toLocaleLowerCase('en-US');
    const contentType = clean(image?.contentType).toLocaleLowerCase('en-US');
    if (!sourceUrl || !inside(MEDIA_ROOT, resolved) || !inside(REPO, resolved)
      || !Number.isInteger(width) || width < 1 || width > 8_000
      || !Number.isInteger(height) || height < 1 || height > 8_000
      || !Object.hasOwn(ALLOWED_TYPES, contentType)
      || !/^[a-f0-9]{64}$/.test(digest) || !(await exists(resolved))) {
      throw new Error(`Existing BMW M3 media index entry ${position + 1} is invalid.`);
    }
    const bytes = await readFile(resolved);
    const measured = imageValidation.dimensions(bytes, contentType);
    if (sha256(bytes) !== digest || measured.width !== width || measured.height !== height) {
      throw new Error(`Existing BMW M3 media index entry ${position + 1} failed byte verification.`);
    }
    const prior = result.get(sourceUrl);
    if (prior && (prior.localPath !== localPath || prior.sha256 !== digest)) {
      throw new Error(`Conflicting existing BMW M3 media mapping for ${sourceUrl}.`);
    }
    result.set(sourceUrl, { ...image, sourceUrl, localPath, width, height, sha256: digest });
  }
  return { generatedAt, images: result };
}

async function materializeBundle(bundle, aliases, outputDirectory) {
  if (!Array.isArray(bundle?.assets) || !Array.isArray(bundle?.failures)) {
    throw new Error('Browser page-asset bundle is invalid.');
  }
  const aliasByAssetId = new Map();
  for (const alias of aliases) {
    const values = aliasByAssetId.get(alias.assetId) || [];
    values.push(alias);
    aliasByAssetId.set(alias.assetId, values);
  }
  const mappings = [];
  for (const item of bundle.assets) {
    const itemAliases = aliasByAssetId.get(item?.id) || [];
    if (!itemAliases.length) continue;
    const sourcePath = path.resolve(clean(item?.path));
    const contentType = clean(item?.contentType).toLocaleLowerCase('en-US');
    if (!inside(BROWSER_ASSET_ROOT, sourcePath) || !Object.hasOwn(ALLOWED_TYPES, contentType)
      || !(await exists(sourcePath))) throw new Error(`Bundled ECS media ${item?.id || '(unknown)'} is unsafe.`);
    const bytes = await readFile(sourcePath);
    if (bytes.length < 32 || bytes.length > 25_000_000) {
      throw new Error(`Bundled ECS media ${item.id} has an unsafe size.`);
    }
    const size = imageValidation.dimensions(bytes, contentType);
    const digest = sha256(bytes);
    const destination = path.join(outputDirectory, `${digest.slice(0, 24)}.${ALLOWED_TYPES[contentType]}`);
    try {
      await writeFile(destination, bytes, { flag: 'wx' });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = await readFile(destination);
      if (!existing.equals(bytes)) throw new Error(`BMW M3 media hash-prefix collision at ${destination}.`);
    }
    for (const alias of itemAliases) {
      mappings.push({
        sourceUrl: alias.sourceUrl,
        downloadedFromUrl: alias.downloadedFromUrl,
        localPath: path.relative(REPO, destination).replaceAll('\\', '/'),
        width: size.width,
        height: size.height,
        contentType,
        sha256: digest,
        observedAt: alias.observedAt,
      });
    }
  }
  return mappings;
}

function mergeMappings(existing, additions) {
  for (const mapping of additions) {
    const prior = existing.get(mapping.sourceUrl);
    if (prior && (prior.localPath !== mapping.localPath || prior.sha256 !== mapping.sha256)) {
      throw new Error(`Conflicting BMW M3 browser media for ${mapping.sourceUrl}.`);
    }
    if (!prior) existing.set(mapping.sourceUrl, mapping);
  }
}

async function writeMediaIndex(indexPath, imagesByUrl, generatedAt) {
  const images = [...imagesByUrl.values()].sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl));
  await writeJsonAtomic(indexPath, {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    generatedAt,
    images,
  });
}

function integerOption(value, name, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

export async function captureEcsBmwM3PageAssets(adapter, {
  captureDir,
  outputDir = path.join(REPO, 'assets', 'products', 'ecs', 'bmw-m3'),
  indexPath = path.join(captureDir || '', 'media-index.json'),
  statePath = path.join(captureDir || '', 'media-capture-state.json'),
  sections = BMW_M3_MEDIA_SECTIONS,
  pageBudget = 10,
  navigationDelayMs = 4_000,
  assetSettleDelayMs = 1_500,
} = {}) {
  if (!adapter || !['getCurrentUrl', 'goto', 'getPageState', 'getRenderedListingCount',
    'prepareAssets', 'listAssets', 'bundleAssets', 'wait'].every((name) => typeof adapter[name] === 'function')) {
    throw new Error('A BMW M3 browser page-assets adapter is required.');
  }
  const resolvedCaptureDir = path.resolve(clean(captureDir));
  const resolvedOutput = path.resolve(clean(outputDir));
  const resolvedIndex = path.resolve(clean(indexPath));
  const resolvedState = path.resolve(clean(statePath));
  if (!captureDir || !inside(REPO, resolvedCaptureDir) || !inside(REPO, resolvedOutput)
    || !inside(REPO, resolvedIndex) || !inside(REPO, resolvedState)
    || !inside(MEDIA_ROOT, resolvedOutput)) {
    throw new Error('BMW M3 browser media paths must stay inside the repository and ECS product-media directory.');
  }
  const normalizedSections = [...new Set(sections.map((section) => clean(section).toLocaleLowerCase('en-US')))];
  if (!normalizedSections.length || normalizedSections.some((section) => !BMW_M3_MEDIA_SECTIONS.includes(section))) {
    throw new Error('BMW M3 media sections are invalid.');
  }
  const budget = integerOption(pageBudget, 'pageBudget', 1, 50);
  const navigationDelay = integerOption(navigationDelayMs, 'navigationDelayMs', 0, 60_000);
  const assetDelay = integerOption(assetSettleDelayMs, 'assetSettleDelayMs', 0, 30_000);
  await mkdir(resolvedOutput, { recursive: true });
  const pages = await readPagePlan(resolvedCaptureDir, normalizedSections);
  if (!pages.length) throw new Error('No validated BMW M3 listing checkpoints are available for media capture.');
  const existingIndex = await readExistingIndex(resolvedIndex);
  const imagesByUrl = existingIndex.images;
  const state = await (async () => {
    if (!(await exists(resolvedState))) return { schemaVersion: 1, supplier: 'ECS Tuning', pages: {} };
    const document = JSON.parse(await readFile(resolvedState, 'utf8'));
    if (document?.schemaVersion !== 1 || document?.supplier !== 'ECS Tuning'
      || !document?.pages || typeof document.pages !== 'object' || Array.isArray(document.pages)) {
      throw new Error('Existing BMW M3 browser media state is invalid.');
    }
    return document;
  })();
  let attemptedPages = 0;
  let completedPages = 0;
  let addedMappings = 0;
  const unresolved = [];
  let newestObservation = existingIndex.generatedAt;

  for (const page of pages) {
    const requested = requestedImages(page, imagesByUrl);
    const expectedImageUrls = [...new Set(page.records
      .map((record) => record.primaryUrl || record.fallbackUrl).filter(Boolean))];
    if (!requested.length) {
      state.pages[pageKey(page.sourceUrl)] = {
        sourceUrl: page.sourceUrl,
        section: page.section,
        status: 'complete',
        expectedProducts: page.expected,
        mappedImages: expectedImageUrls.filter((url) => imagesByUrl.has(url)).length,
        missingImages: [],
        updatedAt: new Date().toISOString(),
      };
      continue;
    }
    if (attemptedPages >= budget) break;
    attemptedPages += 1;
    const before = imagesByUrl.size;
    try {
      const current = canonicalBmwM3ListingUrl(await adapter.getCurrentUrl(), page.section);
      if (current !== page.sourceUrl) await adapter.goto(page.sourceUrl);
      if (navigationDelay) await adapter.wait(navigationDelay);
      const pageState = await adapter.getPageState();
      if (CHALLENGE_TITLE.test(clean(pageState?.title)) || CHALLENGE_TEXT.test(clean(pageState?.bodyText))) {
        throw new Error('ECS presented an interactive access challenge. Media capture stopped; no bypass was attempted.');
      }
      if (canonicalBmwM3ListingUrl(pageState?.url, page.section) !== page.sourceUrl) {
        throw new Error(`Browser did not reach the validated checkpoint ${page.sourceUrl}.`);
      }
      const rendered = Number(await adapter.getRenderedListingCount());
      if (rendered !== page.expected) {
        throw new Error(`Rendered ${rendered} of ${page.expected} expected products at ${page.sourceUrl}.`);
      }
      await adapter.prepareAssets();
      if (assetDelay) await adapter.wait(assetDelay);
      const inventory = await adapter.listAssets();
      if (canonicalBmwM3ListingUrl(inventory?.pageUrl, page.section) !== page.sourceUrl) {
        throw new Error(`Browser asset inventory does not belong to ${page.sourceUrl}.`);
      }
      const matched = matchInventoryAssets(requested, inventory);
      if (matched.assets.length) {
        const bundle = await adapter.bundleAssets({
          inventoryId: inventory.id,
          assetIds: matched.assets.map((asset) => asset.id),
        });
        mergeMappings(imagesByUrl, await materializeBundle(bundle, matched.aliases, resolvedOutput));
      }
      const missing = requested.filter((item) => !imagesByUrl.has(item.primaryUrl))
        .map((item) => ({ ecsDigits: item.ecsDigits, sourceUrl: item.primaryUrl }));
      addedMappings += imagesByUrl.size - before;
      newestObservation = [newestObservation, page.observedAt].filter(Boolean).sort().at(-1) || null;
      const status = missing.length ? 'partial' : 'complete';
      if (status === 'complete') completedPages += 1;
      else unresolved.push({ sourceUrl: page.sourceUrl, missing });
      state.pages[pageKey(page.sourceUrl)] = {
        sourceUrl: page.sourceUrl,
        section: page.section,
        status,
        expectedProducts: page.expected,
        mappedImages: expectedImageUrls.filter((url) => imagesByUrl.has(url)).length,
        missingImages: missing,
        updatedAt: new Date().toISOString(),
      };
      await writeMediaIndex(resolvedIndex, imagesByUrl, newestObservation || new Date().toISOString());
      await writeJsonAtomic(resolvedState, state);
    } catch (error) {
      state.pages[pageKey(page.sourceUrl)] = {
        sourceUrl: page.sourceUrl,
        section: page.section,
        status: 'failed',
        expectedProducts: page.expected,
        mappedImages: imagesByUrl.size - before,
        missingImages: requested.map((item) => ({ ecsDigits: item.ecsDigits, sourceUrl: item.primaryUrl })),
        error: clean(error?.message || error),
        updatedAt: new Date().toISOString(),
      };
      await writeJsonAtomic(resolvedState, state);
      throw error;
    }
  }
  await writeMediaIndex(resolvedIndex, imagesByUrl, newestObservation || new Date().toISOString());
  await writeJsonAtomic(resolvedState, state);
  return {
    pagePlanCount: pages.length,
    attemptedPages,
    completedPages,
    addedMappings,
    totalMappings: imagesByUrl.size,
    unresolved,
    indexPath: resolvedIndex,
    statePath: resolvedState,
  };
}

export function createCodexTabPageAssetsAdapter(tab) {
  if (!tab?.playwright || !tab?.capabilities || typeof tab.url !== 'function'
    || typeof tab.title !== 'function' || typeof tab.goto !== 'function') {
    throw new Error('A Codex browser tab with Playwright and page-assets capabilities is required.');
  }
  let capability = null;
  const getCapability = async () => {
    capability ||= await tab.capabilities.get('pageAssets');
    if (!capability || typeof capability.list !== 'function' || typeof capability.bundle !== 'function') {
      throw new Error('The browser page-assets capability is unavailable.');
    }
    return capability;
  };
  return Object.freeze({
    async getCurrentUrl() { return tab.url(); },
    async goto(url) { await tab.goto(url); },
    async wait(milliseconds) { await tab.playwright.waitForTimeout(milliseconds); },
    async getPageState() {
      const [title, url, bodyText] = await Promise.all([
        tab.title(),
        tab.url(),
        tab.playwright.evaluate(
          () => String(document.body?.innerText || '').slice(0, 2_000),
          undefined,
          { timeoutMs: 15_000 },
        ),
      ]);
      return { title, url, bodyText };
    },
    async getRenderedListingCount() {
      return tab.playwright.evaluate(
        () => document.querySelectorAll('.product-listing.productListBox').length,
        undefined,
        { timeoutMs: 15_000 },
      );
    },
    async prepareAssets() {
      for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
        await tab.playwright.evaluate(({ position }) => {
          const maximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
          window.scrollTo(0, Math.round(maximum * position));
        }, { position: fraction }, { timeoutMs: 15_000 });
        await tab.playwright.waitForTimeout(250);
      }
    },
    async listAssets() { return (await getCapability()).list(); },
    async bundleAssets(options) { return (await getCapability()).bundle(options); },
  });
}

export const __test = Object.freeze({
  inside,
  exactTimestamp,
  validateCheckpoint,
  pageKey,
  mergeMappings,
});
