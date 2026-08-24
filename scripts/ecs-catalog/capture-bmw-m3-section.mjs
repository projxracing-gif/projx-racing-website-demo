import {
  access, link, mkdir, open, readFile, unlink, writeFile,
} from 'node:fs/promises';
import path from 'node:path';

export const BMW_M3_ROOT_URL = 'https://www.ecstuning.com/BMW-M3/';
export const BMW_M3_VEHICLE = 'BMW M3';
export const ECS_LISTING_PAGE_SIZE = 16;
export const SUPPORTED_BMW_M3_SECTIONS = Object.freeze([
  'Braking',
  'Engine',
  'Exterior',
  'Interior',
  'Performance',
  'Suspension',
  'Steering',
]);

export const BMW_M3_CAPTURE_PROFILE = Object.freeze({
  artifactPrefix: 'bmw-m3',
  defaultOutputDirectory: path.join('private-imports', 'ecs-bmw-m3-capture'),
  rootSnapshotKind: 'bmw-m3-section-root-snapshot',
  rootUrl: BMW_M3_ROOT_URL,
  sections: SUPPORTED_BMW_M3_SECTIONS,
  vehicle: BMW_M3_VEHICLE,
  vehicleKey: 'bmw-m3',
});

export const REQUIRED_ECS_LISTING_FIELDS = Object.freeze([
  'availabilityText',
  'ecsPartNumber',
  'manufacturerPartNumber',
  'priceText',
  'productUrl',
  'sourceUrl',
  'title',
]);

const OPTIONAL_ECS_LISTING_FIELDS = Object.freeze([
  'brand',
  'description',
  'imageAlt',
  'imageFallbackUrl',
  'imageUrl',
  'shippingText',
]);

const ECS_HOST = 'www.ecstuning.com';
const PRODUCT_PATH = /^\/b-[^/?#]+\/[^/?#]+\/[^/?#]+\/$/i;
const CHALLENGE_TITLE = /^(?:just a moment|attention required|access denied)/i;
const CHALLENGE_TEXT = /(?:verify you are human|performing security verification|cloudflare ray id)/i;
const MAX_CATEGORY_KEY_LENGTH = 180;

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

function decodeVisibleDomAttribute(value) {
  return String(value ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (match, digits) => {
      const codePoint = Number.parseInt(digits, 16);
      return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint) : match;
    })
    .replace(/&#(\d+);/g, (match, digits) => {
      const codePoint = Number.parseInt(digits, 10);
      return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint) : match;
    })
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function visibleDomExactAnchorTargets(visibleDom, rawHrefs) {
  if (typeof visibleDom !== 'string' || visibleDom.length > 2_000_000
    || !Array.isArray(rawHrefs) || !rawHrefs.length) return [];
  const exactHrefs = new Set(rawHrefs.map((href) => String(href)));
  const targets = [];
  const anchorPattern = /<a(?=\s|>)(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  const attributePattern = /([^\s"'=<>`/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const match of visibleDom.matchAll(anchorPattern)) {
    const attributes = new Map();
    attributePattern.lastIndex = 0;
    for (const attribute of match[0].matchAll(attributePattern)) {
      const name = attribute[1].toLocaleLowerCase('en-US');
      if (attributes.has(name)) continue;
      attributes.set(name, decodeVisibleDomAttribute(attribute[2] ?? attribute[3] ?? attribute[4] ?? ''));
    }
    const href = attributes.get('href');
    const nodeId = attributes.get('node_id');
    if (!exactHrefs.has(href) || !/^[a-z0-9_-]{1,128}$/i.test(nodeId || '')) continue;
    targets.push({ href, nodeId });
  }
  return targets;
}

export function slugifyCaptureLabel(value) {
  return clean(value)
    .toLocaleLowerCase('en-US')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function safeCategoryKey(value) {
  const key = clean(value);
  return key.length > 0 && key.length <= MAX_CATEGORY_KEY_LENGTH
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)
    && slugifyCaptureLabel(key) === key;
}

function containedFilename(directory, filename) {
  const parent = path.resolve(directory);
  const target = path.resolve(parent, filename);
  if (path.dirname(target) !== parent) {
    throw new Error(`Unsafe ECS capture artifact path: ${target}.`);
  }
  return target;
}

export function normalizeEcsVehicleSection(value, profile = BMW_M3_CAPTURE_PROFILE) {
  const requested = clean(value).toLocaleLowerCase('en-US');
  const supported = profile.sections.find(
    (section) => section.toLocaleLowerCase('en-US') === requested,
  );
  if (!supported) {
    throw new Error(
      `Unsupported ${profile.vehicle} section ${JSON.stringify(value)}. Choose one of: ${profile.sections.join(', ')}.`,
    );
  }
  return supported;
}

export function normalizeBmwM3Section(value) {
  return normalizeEcsVehicleSection(value, BMW_M3_CAPTURE_PROFILE);
}

function canonicalEcsUrl(value, { product = false } = {}) {
  try {
    const url = new URL(String(value ?? ''));
    if (url.protocol !== 'https:' || url.hostname !== ECS_HOST || url.username || url.password
      || url.port || url.search || url.hash || (product && !PRODUCT_PATH.test(url.pathname))) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function validatedCaptureProfile(profile) {
  const rootUrl = canonicalEcsUrl(profile?.rootUrl);
  const artifactPrefix = clean(profile?.artifactPrefix);
  const vehicleKey = clean(profile?.vehicleKey);
  const vehicle = clean(profile?.vehicle);
  const rootSnapshotKind = clean(profile?.rootSnapshotKind);
  const sections = Array.isArray(profile?.sections) ? profile.sections.map(clean) : [];
  if (!rootUrl || rootUrl !== profile.rootUrl || !rootUrl.endsWith('/')
    || !vehicle || !artifactPrefix || slugifyCaptureLabel(artifactPrefix) !== artifactPrefix
    || !vehicleKey || slugifyCaptureLabel(vehicleKey) !== vehicleKey
    || rootSnapshotKind !== `${artifactPrefix}-section-root-snapshot`
    || !clean(profile?.defaultOutputDirectory) || path.isAbsolute(profile.defaultOutputDirectory)
    || !sections.length || sections.some((section) => !section)
    || new Set(sections.map((section) => section.toLocaleLowerCase('en-US'))).size !== sections.length) {
    throw new Error('The ECS vehicle capture profile is invalid.');
  }
  return profile;
}

function exactTimestamp(value) {
  const source = clean(value);
  const milliseconds = Date.parse(source);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== source
    || milliseconds > Date.now() + (5 * 60 * 1_000)) return null;
  return source;
}

function ecsDigits(value) {
  const digits = clean(value).replace(/^ES#/i, '');
  return /^\d{3,12}$/.test(digits) ? digits : null;
}

function rootRelativeSegments(rootUrl, candidateUrl) {
  const root = new URL(rootUrl);
  const candidate = new URL(candidateUrl);
  if (!candidate.pathname.startsWith(root.pathname)) return null;
  return candidate.pathname
    .slice(root.pathname.length)
    .split('/')
    .filter(Boolean);
}

function checkpointPageMatchesCategory(categoryUrl, candidateUrl, expectedPage = null) {
  const category = canonicalEcsUrl(categoryUrl);
  const candidate = canonicalEcsUrl(candidateUrl);
  if (!category || !candidate) return false;
  if (candidate === category) return expectedPage === null || expectedPage === 1;
  const segments = rootRelativeSegments(category, candidate);
  if (segments?.length !== 1 || !/^\d+$/.test(segments[0])) return false;
  const page = Number(segments[0]);
  return Number.isSafeInteger(page) && page >= 2 && (expectedPage === null || page === expectedPage);
}

function countFromText(value, { allowTrailing = false } = {}) {
  const source = clean(value);
  if (!source) return null;
  const patterns = [
    /\(([\d,]+)\)\s*$/,
    /\b([\d,]+)\s+(?:products?|items?|parts?)\b/i,
    /(?:products?|items?|parts?)\s*[:(]?\s*([\d,]+)/i,
  ];
  if (allowTrailing) patterns.push(/(?:^|\s)([\d,]+)\s*$/);
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match) continue;
    const count = Number(match[1].replace(/,/g, ''));
    if (Number.isSafeInteger(count) && count >= 0) return count;
  }
  return null;
}

function categoryCount(link) {
  const evidence = [
    ['data-count', link.dataCount, true],
    ['count badge', link.countText, true],
    ['link text', link.text, true],
    ['ARIA label', link.ariaLabel, true],
    ['category context', link.contextText, false],
  ];
  for (const [source, value, allowTrailing] of evidence) {
    const count = countFromText(value, { allowTrailing });
    if (count !== null) return { count, countEvidence: `${source}: ${clean(value)}` };
  }
  return null;
}

function labelWithoutCount(value) {
  return clean(value)
    .replace(/\s*\([\d,]+\)\s*$/, '')
    .replace(/\s+[\d,]+\s+(?:products?|items?|parts?)\s*$/i, '')
    .replace(/\s+(?:products?|items?|parts?)\s*[:(]?\s*[\d,]+\s*$/i, '')
    .replace(/\s+[\d,]+\s*$/, '')
    .trim();
}

function normalizedVisibleLink(link) {
  const href = canonicalEcsUrl(link?.href);
  if (!href || link?.visible === false) return null;
  return {
    href,
    text: clean(link?.text),
    ariaLabel: clean(link?.ariaLabel),
    contextText: clean(link?.contextText),
    countText: clean(link?.countText),
    dataCount: clean(link?.dataCount),
    rel: clean(link?.rel).toLocaleLowerCase('en-US'),
  };
}

export function discoverEcsVehicleSectionLink(
  visibleLinks,
  requestedSection,
  profile = BMW_M3_CAPTURE_PROFILE,
) {
  validatedCaptureProfile(profile);
  const section = normalizeEcsVehicleSection(requestedSection, profile);
  const requested = section.toLocaleLowerCase('en-US');
  const candidates = visibleLinks
    .map(normalizedVisibleLink)
    .filter(Boolean)
    .map((link, order) => ({ link, order, segments: rootRelativeSegments(profile.rootUrl, link.href) }))
    .filter(({ segments }) => segments?.length === 1)
    .map(({ link, order, segments }) => {
      const labels = [labelWithoutCount(link.text), labelWithoutCount(link.ariaLabel)].filter(Boolean);
      const exactText = labels.some((label) => label.toLocaleLowerCase('en-US') === requested);
      const textContains = labels.some((label) => new RegExp(`\\b${requested}\\b`, 'i').test(label));
      const actualPathMatch = decodeURIComponent(segments[0]).toLocaleLowerCase('en-US') === requested;
      return { link, order, exactText, textContains, actualPathMatch };
    })
    .filter((entry) => entry.exactText || entry.textContains || entry.actualPathMatch)
    .sort((left, right) => Number(right.exactText) - Number(left.exactText)
      || Number(right.textContains) - Number(left.textContains)
      || left.order - right.order);
  if (!candidates.length) {
    throw new Error(`No visible existing ECS link for the ${section} section was found on ${profile.rootUrl}.`);
  }
  const selected = candidates[0].link;
  return {
    section,
    key: slugifyCaptureLabel(section),
    href: selected.href,
    label: labelWithoutCount(selected.text || selected.ariaLabel) || section,
    ...(categoryCount(selected) ?? {}),
  };
}

export function discoverBmwM3SectionLink(visibleLinks, requestedSection) {
  return discoverEcsVehicleSectionLink(visibleLinks, requestedSection, BMW_M3_CAPTURE_PROFILE);
}

export function discoverEcsVehicleChildCategories(visibleLinks, sectionLink) {
  const byHref = new Map();
  for (const rawLink of visibleLinks) {
    const link = normalizedVisibleLink(rawLink);
    if (!link) continue;
    const segments = rootRelativeSegments(sectionLink.href, link.href);
    if (segments?.length !== 1 || /^\d+$/.test(segments[0])) continue;
    const label = labelWithoutCount(link.text || link.ariaLabel);
    if (!label) continue;
    const count = categoryCount(link);
    const existing = byHref.get(link.href);
    if (!existing || (!existing.countDetails && count)) {
      byHref.set(link.href, { link, label, countDetails: count });
    }
  }
  if (!byHref.size) {
    throw new Error(`No visible child-category links were found on the ECS ${sectionLink.section} root.`);
  }
  const missingCounts = [...byHref.values()].filter((entry) => !entry.countDetails);
  if (missingCounts.length) {
    throw new Error(
      `ECS child-category counts are missing for: ${missingCounts.map((entry) => entry.label).join(', ')}. Capture stopped rather than guessing.`,
    );
  }
  const usedKeys = new Set();
  return [...byHref.values()].map(({ link, label, countDetails }) => {
    let key = slugifyCaptureLabel(label);
    if (!key || usedKeys.has(key)) key = `${sectionLink.key}-${slugifyCaptureLabel(new URL(link.href).pathname)}`;
    if (!safeCategoryKey(key) || usedKeys.has(key)) {
      throw new Error(`ECS category key collision or unsafe key for ${label}.`);
    }
    usedKeys.add(key);
    return {
      key,
      name: label,
      href: link.href,
      count: countDetails.count,
      countEvidence: countDetails.countEvidence,
    };
  });
}

export function discoverBmwM3ChildCategories(visibleLinks, sectionLink) {
  return discoverEcsVehicleChildCategories(visibleLinks, sectionLink);
}

function assertBrowser(browser, { reloadBeforePagination = false } = {}) {
  const required = [
    'clickVisibleHref',
    'getCurrentUrl',
    'getListingRecords',
    'getPageState',
    'getRenderedListingCount',
    'getVisibleLinks',
    'gotoCheckpointUrl',
    'wait',
  ];
  if (reloadBeforePagination) required.push('reloadCurrentPage');
  const missing = required.filter((method) => typeof browser?.[method] !== 'function');
  if (missing.length) throw new Error(`Browser adapter is missing: ${missing.join(', ')}.`);
}

async function waitForExpectedPage(browser, expectedUrl, timeoutMs = 20_000) {
  const canonicalExpected = canonicalEcsUrl(expectedUrl);
  if (!canonicalExpected) throw new Error(`Unsafe ECS page destination: ${expectedUrl}.`);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await browser.getPageState();
    const current = canonicalEcsUrl(state?.url);
    const title = clean(state?.title);
    const bodyText = clean(state?.bodyText);
    if (CHALLENGE_TITLE.test(title) || CHALLENGE_TEXT.test(bodyText)) {
      throw new Error('ECS presented an interactive access challenge. Capture stopped; no bypass was attempted.');
    }
    if (current === canonicalExpected) return;
    await browser.wait(250);
  }
  throw new Error(`ECS did not reach the observed link destination ${canonicalExpected}.`);
}

async function clickObservedLink(browser, visibleLinks, href, navigationDelayMs = 0) {
  const destination = canonicalEcsUrl(href);
  if (!destination || !visibleLinks.map(normalizedVisibleLink).filter(Boolean)
    .some((link) => link.href === destination)) {
    throw new Error(`Refusing to navigate to an ECS URL that is not currently a visible existing link: ${href}.`);
  }
  await browser.clickVisibleHref(destination);
  await waitForExpectedPage(browser, destination);
  if (navigationDelayMs > 0) await browser.wait(navigationDelayMs);
}

function nextPaginationLink(visibleLinks, categoryHref, nextPage) {
  const candidates = visibleLinks.map(normalizedVisibleLink).filter(Boolean).filter((link) => {
    const segments = rootRelativeSegments(categoryHref, link.href);
    return segments?.length === 1 && /^\d+$/.test(segments[0]);
  });
  const exact = candidates.find((link) => {
    const segments = rootRelativeSegments(categoryHref, link.href);
    return Number(segments[0]) === nextPage && clean(link.text) === String(nextPage);
  }) || candidates.find((link) => Number(rootRelativeSegments(categoryHref, link.href)?.[0]) === nextPage);
  if (exact) return exact;
  const next = visibleLinks.map(normalizedVisibleLink).filter(Boolean).find((link) => {
    const segments = rootRelativeSegments(categoryHref, link.href);
    return segments?.length === 1 && (link.rel === 'next' || /^(?:next|next page|›|»)$/i.test(link.text || link.ariaLabel));
  });
  if (next && Number(rootRelativeSegments(categoryHref, next.href)?.[0]) === nextPage) return next;
  throw new Error(`No visible existing ECS pagination link for page ${nextPage} was found.`);
}

function stableRootSnapshot(snapshot) {
  const section = snapshot.section || {};
  return {
    schemaVersion: snapshot.schemaVersion,
    supplier: snapshot.supplier,
    kind: snapshot.kind,
    rootUrl: snapshot.rootUrl,
    section: {
      section: section.section,
      key: section.key,
      href: section.href,
      label: section.label,
    },
    categories: snapshot.categories.map(({ key, name, href, count }) => ({ key, name, href, count })),
  };
}

function validateStoredRootSnapshot(snapshot, section, profile) {
  const sectionKey = slugifyCaptureLabel(section);
  const sectionHref = canonicalEcsUrl(snapshot?.section?.href);
  const sectionSegments = sectionHref ? rootRelativeSegments(profile.rootUrl, sectionHref) : null;
  if (snapshot?.schemaVersion !== 1 || snapshot?.supplier !== 'ECS Tuning'
    || snapshot?.accessClass !== 'public-retail' || snapshot?.kind !== profile.rootSnapshotKind
    || snapshot?.rootUrl !== profile.rootUrl
    || (snapshot?.vehicle !== profile.vehicle
      && !(profile === BMW_M3_CAPTURE_PROFILE && snapshot?.vehicle === undefined))
    || !exactTimestamp(snapshot?.discoveredAt)
    || snapshot?.section?.section !== section || snapshot?.section?.key !== sectionKey
    || sectionSegments?.length !== 1
    || decodeURIComponent(sectionSegments[0]).toLocaleLowerCase('en-US')
      !== section.toLocaleLowerCase('en-US')
    || !Array.isArray(snapshot?.categories) || snapshot.categories.length === 0) {
    throw new Error(`Stored ECS ${section} section-root manifest is invalid.`);
  }
  const keys = new Set();
  const hrefs = new Set();
  for (const category of snapshot.categories) {
    const href = canonicalEcsUrl(category?.href);
    const segments = href ? rootRelativeSegments(sectionHref, href) : null;
    if (!safeCategoryKey(category?.key) || !clean(category?.name)
      || !Number.isSafeInteger(category?.count) || category.count < 0
      || !clean(category?.countEvidence) || segments?.length !== 1
      || /^\d+$/.test(segments[0]) || keys.has(category.key) || hrefs.has(href)) {
      throw new Error(`Stored ECS ${section} child-category manifest is invalid.`);
    }
    keys.add(category.key);
    hrefs.add(href);
  }
  return snapshot;
}

function findOpenCaptureResume(currentUrl, categories, pages, pageSize) {
  let lastCompletedProgress = null;
  let firstIncomplete = null;
  for (const [categoryIndex, category] of categories.entries()) {
    const expectedPages = Math.ceil(category.count / pageSize);
    const completed = pages
      .filter((item) => item.categoryKey === category.key)
      .sort((left, right) => left.page - right.page);
    if (completed.some((item, index) => item.page !== index + 1) || completed.length > expectedPages) {
      throw new Error(`${category.name} checkpoints are not a valid contiguous prefix.`);
    }
    if (!firstIncomplete && completed.length < expectedPages) {
      firstIncomplete = { category, categoryIndex, completed, expectedPages };
      continue;
    }
    if (firstIncomplete && completed.length) {
      throw new Error('ECS checkpoints continue after the first incomplete category and cannot be resumed safely.');
    }
    if (completed.length) {
      lastCompletedProgress = { category, categoryIndex, completed, expectedPages };
    }
  }
  const current = canonicalEcsUrl(currentUrl);
  if (!current) throw new Error('The open ECS capture page URL is unsafe.');
  const progress = firstIncomplete || lastCompletedProgress;
  const lastCheckpoint = progress?.completed.at(-1) || lastCompletedProgress?.completed.at(-1) || null;
  if (lastCheckpoint && current === canonicalEcsUrl(lastCheckpoint.sourceUrl)
    && checkpointPageMatchesCategory(lastCheckpoint.categoryUrl, current, lastCheckpoint.page)) {
    return {
      mode: 'checkpoint',
      categoryKey: lastCheckpoint.categoryKey,
      categoryIndex: categories.findIndex((category) => category.key === lastCheckpoint.categoryKey),
      page: lastCheckpoint.page,
      sourceUrl: lastCheckpoint.sourceUrl,
    };
  }
  if (!firstIncomplete) {
    for (const [categoryIndex, category] of categories.entries()) {
      const expectedPages = Math.ceil(category.count / pageSize);
      if (expectedPages === 0 && current === canonicalEcsUrl(category.href)) {
        return {
          mode: 'terminal',
          categoryKey: category.key,
          categoryIndex,
          page: 1,
          sourceUrl: category.href,
        };
      }
      const terminalCheckpoint = pages.find((item) => (
        item.categoryKey === category.key && item.page === expectedPages
      ));
      if (terminalCheckpoint
        && current === canonicalEcsUrl(terminalCheckpoint.sourceUrl)
        && checkpointPageMatchesCategory(category.href, current, expectedPages)) {
        return {
          mode: 'terminal',
          categoryKey: category.key,
          categoryIndex,
          page: expectedPages,
          sourceUrl: terminalCheckpoint.sourceUrl,
        };
      }
    }
    throw new Error('The open ECS page is not an exact validated terminal checkpoint.');
  }
  if (!progress) throw new Error('No validated ECS capture position exists for the currently open page.');
  const nextPage = firstIncomplete.completed.length + 1;
  const nextMatches = nextPage === 1
    ? current === canonicalEcsUrl(firstIncomplete.category.href)
    : checkpointPageMatchesCategory(firstIncomplete.category.href, current, nextPage);
  if (!nextMatches) {
    throw new Error('The open ECS page is neither the highest checkpoint nor its exact next uncaptured page.');
  }
  return {
    mode: 'next',
    categoryKey: firstIncomplete.category.key,
    categoryIndex: firstIncomplete.categoryIndex,
    page: nextPage,
    sourceUrl: current,
  };
}

async function fileExists(filename) {
  try {
    await access(filename);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function writeEcsCaptureJsonCreateOnly(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporaryNonce = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const temporary = `${filename}.${temporaryNonce}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx');
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await link(temporary, filename);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(`Checkpoint already exists and was not overwritten: ${filename}.`);
    }
    throw error;
  } finally {
    await handle?.close();
    try {
      await unlink(temporary);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

async function writeJson(filename, value, { exclusive = false } = {}) {
  if (exclusive) {
    await writeEcsCaptureJsonCreateOnly(filename, value);
    return;
  }
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function checkpointFilename(outputDir, sectionKey, categoryKey, page) {
  if (!safeCategoryKey(sectionKey) || !safeCategoryKey(categoryKey)
    || !Number.isSafeInteger(page) || page < 1) {
    throw new Error('Unsafe ECS page-checkpoint identity.');
  }
  return containedFilename(
    path.join(outputDir, 'raw-pages'),
    `${sectionKey}-${categoryKey}-p${page}.json`,
  );
}

export function validateEcsVehiclePageCheckpoint(pageRecord, category, {
  section,
  page,
  pageSize = ECS_LISTING_PAGE_SIZE,
  profile = BMW_M3_CAPTURE_PROFILE,
  sourceUrl = null,
} = {}) {
  validatedCaptureProfile(profile);
  if (!safeCategoryKey(category?.key)) {
    throw new Error(`${section || '<unknown>'} page checkpoint has an unsafe category key.`);
  }
  const expected = Math.min(pageSize, Math.max(0, category.count - ((page - 1) * pageSize)));
  const canonicalSource = canonicalEcsUrl(pageRecord?.sourceUrl);
  if (pageRecord?.schemaVersion !== 1 || pageRecord?.supplier !== 'ECS Tuning'
    || pageRecord?.accessClass !== 'public-retail'
    || pageRecord?.kind !== `${profile.artifactPrefix}-section-listing-page`
    || pageRecord?.vehicle !== profile.vehicle || pageRecord?.section !== section
    || pageRecord?.categoryKey !== category.key || pageRecord?.category !== category.name
    || pageRecord?.categoryUrl !== category.href || pageRecord?.page !== page
    || pageRecord?.basePosition !== ((page - 1) * pageSize) + 1
    || pageRecord?.expected !== expected || !canonicalSource
    || !checkpointPageMatchesCategory(category.href, canonicalSource, page)
    || (sourceUrl && canonicalSource !== canonicalEcsUrl(sourceUrl))
    || !exactTimestamp(pageRecord?.observedAt) || !Array.isArray(pageRecord?.records)
    || pageRecord.records.length !== expected) {
    throw new Error(`${section} / ${category.name} page ${page} checkpoint is incomplete or unreconciled.`);
  }
  const seen = new Set();
  pageRecord.records.forEach((record, index) => {
    const missing = REQUIRED_ECS_LISTING_FIELDS.filter((field) => !clean(record?.[field]));
    const digits = ecsDigits(record?.ecsPartNumber);
    const productUrl = canonicalEcsUrl(record?.productUrl, { product: true });
    const expectedPosition = pageRecord.basePosition + index;
    if (missing.length || !digits || !productUrl || record?.sourceUrl !== canonicalSource
      || record?.category !== category.name || record?.categoryKey !== category.key
      || record?.section !== section || record?.vehicle !== profile.vehicle
      || record?.relevancePosition !== expectedPosition || !exactTimestamp(record?.observedAt)) {
      throw new Error(
        `${section} / ${category.name} page ${page} record ${index + 1} is invalid${missing.length ? `; missing ${missing.join(', ')}` : ''}.`,
      );
    }
    if (seen.has(digits)) {
      throw new Error(`${section} / ${category.name} page ${page} repeats ES#${digits}.`);
    }
    seen.add(digits);
  });
  return pageRecord;
}

export function validateBmwM3PageCheckpoint(pageRecord, category, options = {}) {
  return validateEcsVehiclePageCheckpoint(pageRecord, category, {
    ...options,
    profile: BMW_M3_CAPTURE_PROFILE,
  });
}

function terminalProofFilename(outputDir, sectionKey, categoryKey) {
  if (!safeCategoryKey(sectionKey) || !safeCategoryKey(categoryKey)) {
    throw new Error('Unsafe ECS terminal-proof identity.');
  }
  return containedFilename(
    path.join(outputDir, 'terminal-proofs'),
    `${sectionKey}-${categoryKey}-terminal.json`,
  );
}

function terminalExpectation(category, pageSize) {
  const expectedPages = Math.ceil(category.count / pageSize);
  const terminalPage = Math.max(1, expectedPages);
  const expectedRenderedCount = expectedPages === 0
    ? 0
    : Math.min(pageSize, category.count - ((terminalPage - 1) * pageSize));
  return { expectedPages, terminalPage, expectedRenderedCount };
}

function paginationPage(categoryUrl, candidateUrl) {
  const category = canonicalEcsUrl(categoryUrl);
  const candidate = canonicalEcsUrl(candidateUrl);
  if (!category || !candidate) return null;
  if (candidate === category) return 1;
  const segments = rootRelativeSegments(category, candidate);
  return segments?.length === 1 && /^\d+$/.test(segments[0])
    ? Number(segments[0]) : null;
}

function terminalPaginationObservation(visibleLinks, category, terminalPage) {
  const links = visibleLinks.map(normalizedVisibleLink).filter(Boolean);
  const paginationLinks = links.flatMap((link) => {
    const page = paginationPage(category.href, link.href);
    const relNext = link.rel.split(/\s+/).filter(Boolean).includes('next');
    return page !== null || relNext ? [{ href: link.href, page, rel: link.rel }] : [];
  });
  const blockers = paginationLinks.filter((link) => (
    link.rel.split(/\s+/).filter(Boolean).includes('next')
      || (Number.isSafeInteger(link.page) && link.page > terminalPage)
  ));
  return {
    blockers,
    observedPaginationLinks: paginationLinks,
    observedVisibleLinkCount: links.length,
  };
}

export function validateEcsVehicleTerminalProof(proof, category, {
  pageSize = ECS_LISTING_PAGE_SIZE,
  profile = BMW_M3_CAPTURE_PROFILE,
  section,
} = {}) {
  validatedCaptureProfile(profile);
  if (!safeCategoryKey(category?.key)) {
    throw new Error(`${section || '<unknown>'} terminal proof has an unsafe category key.`);
  }
  const expectation = terminalExpectation(category, pageSize);
  const terminalUrl = canonicalEcsUrl(proof?.terminalUrl);
  const observedLinks = Array.isArray(proof?.observedPaginationLinks)
    ? proof.observedPaginationLinks : null;
  if (proof?.schemaVersion !== 1 || proof?.supplier !== 'ECS Tuning'
    || proof?.accessClass !== 'public-retail'
    || proof?.kind !== `${profile.artifactPrefix}-section-terminal-pagination-proof`
    || proof?.vehicle !== profile.vehicle || proof?.section !== section
    || proof?.categoryKey !== category.key || proof?.category !== category.name
    || proof?.categoryUrl !== category.href || proof?.expectedPages !== expectation.expectedPages
    || proof?.terminalPage !== expectation.terminalPage
    || proof?.expectedRenderedCount !== expectation.expectedRenderedCount
    || proof?.renderedCount !== expectation.expectedRenderedCount
    || !terminalUrl || proof.terminalUrl !== terminalUrl
    || !checkpointPageMatchesCategory(category.href, terminalUrl, expectation.terminalPage)
    || !exactTimestamp(proof?.observedAt) || proof?.nextPageAbsent !== true
    || !Number.isSafeInteger(proof?.observedVisibleLinkCount)
    || proof.observedVisibleLinkCount < 0 || !observedLinks
    || proof.observedVisibleLinkCount < observedLinks.length) {
    throw new Error(`${section} / ${category.name} terminal-pagination proof is invalid.`);
  }
  const normalizedLinks = observedLinks.map((link) => ({
    href: canonicalEcsUrl(link?.href),
    page: link?.page,
    rel: clean(link?.rel).toLocaleLowerCase('en-US'),
  }));
  if (normalizedLinks.some((link, index) => !link.href
    || link.href !== observedLinks[index]?.href
    || paginationPage(category.href, link.href) !== link.page
    || (!Number.isSafeInteger(link.page) && !link.rel.split(/\s+/).includes('next'))
    || link.rel.split(/\s+/).includes('next')
    || (Number.isSafeInteger(link.page) && link.page > expectation.terminalPage))) {
    throw new Error(`${section} / ${category.name} terminal-pagination proof contains a next page.`);
  }
  return proof;
}

async function loadTerminalProofs(outputDir, categories, section, sectionKey, pageSize, profile) {
  const proofs = new Map();
  for (const category of categories) {
    const filename = terminalProofFilename(outputDir, sectionKey, category.key);
    if (!(await fileExists(filename))) continue;
    const proof = JSON.parse(await readFile(filename, 'utf8'));
    proofs.set(category.key, validateEcsVehicleTerminalProof(proof, category, {
      pageSize, profile, section,
    }));
  }
  return proofs;
}

async function observeTerminalProof(browser, category, {
  now,
  pageSize,
  profile,
  section,
} = {}) {
  const expectation = terminalExpectation(category, pageSize);
  const terminalUrl = canonicalEcsUrl(await browser.getCurrentUrl());
  if (!terminalUrl
    || !checkpointPageMatchesCategory(category.href, terminalUrl, expectation.terminalPage)) {
    throw new Error(`${section} / ${category.name} is not open on its exact terminal page.`);
  }
  const assertStillOnTerminalPage = async (state = null) => {
    const stateUrl = state ? canonicalEcsUrl(state.url) : terminalUrl;
    const current = canonicalEcsUrl(await browser.getCurrentUrl());
    if (stateUrl !== terminalUrl || current !== terminalUrl) {
      throw new Error(`${section} / ${category.name} changed URL during terminal-pagination proof.`);
    }
  };
  let renderedCount = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const state = await browser.getPageState();
    await assertStillOnTerminalPage(state);
    if (CHALLENGE_TITLE.test(clean(state?.title)) || CHALLENGE_TEXT.test(clean(state?.bodyText))) {
      throw new Error('ECS presented an interactive access challenge. Capture stopped; no bypass was attempted.');
    }
    renderedCount = await browser.getRenderedListingCount();
    await assertStillOnTerminalPage();
    if (renderedCount === expectation.expectedRenderedCount) break;
    if (attempt < 3) await browser.wait(750 * attempt);
  }
  if (renderedCount !== expectation.expectedRenderedCount) {
    throw new Error(
      `${section} / ${category.name} terminal page expected ${expectation.expectedRenderedCount} rendered product cards but observed ${renderedCount ?? 'an invalid result'}.`,
    );
  }
  const terminalLinks = await browser.getVisibleLinks();
  await assertStillOnTerminalPage();
  const pagination = terminalPaginationObservation(terminalLinks, category, expectation.terminalPage);
  if (pagination.blockers.length) {
    throw new Error(
      `${section} / ${category.name} has a visible next or higher pagination link after its expected terminal page: ${pagination.blockers.map((link) => link.href).join(', ')}.`,
    );
  }
  const observedAt = now().toISOString();
  if (!exactTimestamp(observedAt)) throw new Error('Capture clock returned an invalid ISO timestamp.');
  return {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    accessClass: 'public-retail',
    kind: `${profile.artifactPrefix}-section-terminal-pagination-proof`,
    vehicle: profile.vehicle,
    section,
    categoryKey: category.key,
    category: category.name,
    categoryUrl: category.href,
    expectedPages: expectation.expectedPages,
    terminalPage: expectation.terminalPage,
    terminalUrl,
    expectedRenderedCount: expectation.expectedRenderedCount,
    renderedCount,
    observedAt,
    observedVisibleLinkCount: pagination.observedVisibleLinkCount,
    observedPaginationLinks: pagination.observedPaginationLinks,
    nextPageAbsent: true,
  };
}

function terminalProofSummary(proof, category, { pageSize, profile, section }) {
  if (!proof) return null;
  validateEcsVehicleTerminalProof(proof, category, { pageSize, profile, section });
  return {
    kind: proof.kind,
    observedAt: proof.observedAt,
    terminalPage: proof.terminalPage,
    terminalUrl: proof.terminalUrl,
    expectedRenderedCount: proof.expectedRenderedCount,
    renderedCount: proof.renderedCount,
    observedVisibleLinkCount: proof.observedVisibleLinkCount,
    observedPaginationLinks: proof.observedPaginationLinks,
    nextPageAbsent: proof.nextPageAbsent,
    validated: true,
  };
}

function categorySummaries(categories, pages, pageSize, terminalProofs = new Map(), {
  profile = BMW_M3_CAPTURE_PROFILE,
  section,
} = {}) {
  return categories.map((category) => {
    const categoryPages = pages
      .filter((page) => page.categoryKey === category.key)
      .sort((left, right) => left.page - right.page);
    const records = categoryPages.flatMap((page) => page.records);
    return {
      key: category.key,
      name: category.name,
      sourceUrl: category.href,
      count: category.count,
      countEvidence: category.countEvidence,
      expectedPages: Math.ceil(category.count / pageSize),
      pages: categoryPages.length,
      pageCounts: categoryPages.map((page) => page.records.length),
      pageUrls: categoryPages.map((page) => page.sourceUrl),
      positionsContiguous: records.every((record, index) => record.relevancePosition === index + 1),
      terminalProof: terminalProofSummary(terminalProofs.get(category.key), category, {
        pageSize, profile, section,
      }),
    };
  });
}

export function buildEcsVehicleReconciliationReport({
  captureStartedAt,
  categories,
  generatedAt,
  pages,
  profile = BMW_M3_CAPTURE_PROFILE,
  rootSnapshot,
  section,
  sectionKey,
  terminalProofs = new Map(),
  pageSize = ECS_LISTING_PAGE_SIZE,
}) {
  validatedCaptureProfile(profile);
  const categoryAudit = categorySummaries(categories, pages, pageSize, terminalProofs, {
    profile, section,
  }).map((category) => ({
    ...category,
    observedCount: pages
      .filter((page) => page.categoryKey === category.key)
      .reduce((total, page) => total + page.records.length, 0),
    exact: category.pages === category.expectedPages
      && category.pageCounts.reduce((total, count) => total + count, 0) === category.count
      && category.positionsContiguous && category.terminalProof?.validated === true,
  }));
  const records = pages.flatMap((page) => page.records);
  const byEcs = new Map();
  const placementKeys = new Map();
  const requiredMissing = Object.fromEntries(REQUIRED_ECS_LISTING_FIELDS.map((field) => [field, 0]));
  const optionalMissing = Object.fromEntries(OPTIONAL_ECS_LISTING_FIELDS.map((field) => [field, 0]));
  for (const record of records) {
    for (const field of REQUIRED_ECS_LISTING_FIELDS) {
      if (!clean(record[field])) requiredMissing[field] += 1;
    }
    for (const field of OPTIONAL_ECS_LISTING_FIELDS) {
      if (!clean(record[field])) optionalMissing[field] += 1;
    }
    const digits = ecsDigits(record.ecsPartNumber);
    const group = byEcs.get(digits) || [];
    group.push(record);
    byEcs.set(digits, group);
    const placement = `${record.categoryKey}|${digits}`;
    placementKeys.set(placement, (placementKeys.get(placement) || 0) + 1);
  }
  const identityConflicts = [];
  const observationDifferences = [];
  for (const [digits, group] of byEcs) {
    const mpns = [...new Set(group.map((record) => clean(record.manufacturerPartNumber).toLocaleLowerCase('en-US')))];
    const productUrls = [...new Set(group.map((record) => canonicalEcsUrl(record.productUrl, { product: true })))];
    if (mpns.length > 1 || productUrls.length > 1) {
      identityConflicts.push({ ecsPartNumber: `ES#${digits}`, manufacturerPartNumbers: mpns, productUrls });
    }
    const prices = [...new Set(group.map((record) => clean(record.priceText)))];
    const availability = [...new Set(group.map((record) => clean(record.availabilityText)))];
    if (prices.length > 1 || availability.length > 1) {
      observationDifferences.push({ ecsPartNumber: `ES#${digits}`, prices, availability });
    }
  }
  const duplicatePlacements = [...placementKeys]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }));
  const terminalProofsValidated = categoryAudit.length === categories.length
    && categoryAudit.every((category) => category.terminalProof?.validated === true);
  const complete = terminalProofsValidated && categoryAudit.every((category) => category.exact)
    && Object.values(requiredMissing).every((count) => count === 0)
    && identityConflicts.length === 0
    && duplicatePlacements.length === 0;
  return {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    accessClass: 'public-retail',
    kind: `${profile.artifactPrefix}-${sectionKey}-reconciliation-report`,
    captureStartedAt,
    generatedAt,
    source: {
      rootUrl: rootSnapshot.rootUrl,
      sectionUrl: rootSnapshot.section.href,
      discoveryRule: 'Sections, categories and forward pagination use visible existing ECS links only. Resume may reopen an exact validated ECS page URL retained in a local raw-page checkpoint, or continue from the exact next uncaptured child/page already open in the persistent tab; no URL is synthesized.',
    },
    scope: {
      vehicle: profile.vehicle,
      section,
      categories: categories.length,
      expectedPages: categoryAudit.reduce((total, category) => total + category.expectedPages, 0),
      capturedPages: pages.length,
      expectedPlacements: categories.reduce((total, category) => total + category.count, 0),
      capturedPlacements: records.length,
      terminalProofs: categoryAudit.filter((category) => category.terminalProof?.validated).length,
      uniqueEcsProducts: byEcs.size,
      crossCategoryRepeatPlacements: records.length - byEcs.size,
    },
    completeness: {
      complete,
      status: complete ? 'reconciled' : 'in_progress_or_blocked',
      exactCategories: categoryAudit.filter((category) => category.exact).length,
      categoryAudit,
      requiredMissing,
      optionalMissing,
      duplicatePlacements,
    },
    consistency: { identityConflicts, observationDifferences },
    safeguards: {
      publicRetailOnly: true,
      challengeBypassUsed: false,
      guessedCategoryRoutes: false,
      guessedPaginationRoutes: false,
      checkpointResumeUrlsValidated: true,
      nextUncheckpointPageValidated: terminalProofsValidated,
      liveStockClaim: false,
    },
  };
}

export function buildBmwM3ReconciliationReport(options) {
  return buildEcsVehicleReconciliationReport({
    ...options,
    profile: BMW_M3_CAPTURE_PROFILE,
  });
}

async function writeCurrentArtifacts({
  captureStartedAt,
  categories,
  outputDir,
  pages,
  profile,
  rootSnapshot,
  section,
  sectionKey,
  terminalProofs,
  generatedAt,
  pageSize,
}) {
  const summaries = categorySummaries(categories, pages, pageSize, terminalProofs, {
    profile, section,
  });
  const records = pages
    .slice()
    .sort((left, right) => categories.findIndex((category) => category.key === left.categoryKey)
      - categories.findIndex((category) => category.key === right.categoryKey) || left.page - right.page)
    .flatMap((page) => page.records);
  const aggregate = {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    accessClass: 'public-retail',
    kind: `${profile.artifactPrefix}-${sectionKey}-listing-capture`,
    captureStartedAt,
    generatedAt,
    vehicle: profile.vehicle,
    section,
    sectionUrl: rootSnapshot.section.href,
    categories: summaries,
    terminalProofs: Object.fromEntries(summaries.map((category) => [
      category.key, category.terminalProof,
    ])),
    records,
  };
  const report = buildEcsVehicleReconciliationReport({
    captureStartedAt,
    categories,
    generatedAt,
    pages,
    profile,
    rootSnapshot,
    section,
    sectionKey,
    terminalProofs,
    pageSize,
  });
  const manifest = {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    accessClass: 'public-retail',
    kind: `${profile.artifactPrefix}-${sectionKey}-capture-manifest`,
    captureStartedAt,
    generatedAt,
    rootUrl: rootSnapshot.rootUrl,
    section: rootSnapshot.section,
    pageSize,
    categories: Object.fromEntries(summaries.map((category) => [category.key, category])),
    terminalProofs: Object.fromEntries(summaries.map((category) => [
      category.key, category.terminalProof,
    ])),
    totals: report.scope,
    complete: report.completeness.complete,
  };
  await Promise.all([
    writeJson(path.join(outputDir, `${profile.artifactPrefix}-${sectionKey}-records.json`), aggregate),
    writeJson(path.join(outputDir, `${profile.artifactPrefix}-${sectionKey}-manifest.json`), manifest),
    writeJson(path.join(outputDir, `${profile.artifactPrefix}-${sectionKey}-reconciliation-report.json`), report),
  ]);
  return { aggregate, manifest, report };
}

async function loadPageCheckpoints(outputDir, section, sectionKey, categories, pageSize, profile) {
  const pages = [];
  for (const category of categories) {
    const expectedPages = Math.ceil(category.count / pageSize);
    for (let page = 1; page <= expectedPages; page += 1) {
      const filename = checkpointFilename(outputDir, sectionKey, category.key, page);
      if (!(await fileExists(filename))) continue;
      const pageRecord = JSON.parse(await readFile(filename, 'utf8'));
      pages.push(validateEcsVehiclePageCheckpoint(pageRecord, category, {
        section, page, pageSize, profile,
      }));
    }
  }
  return pages;
}

function findCheckpoint(pages, categoryKey, page) {
  return pages.find((item) => item.categoryKey === categoryKey && item.page === page) ?? null;
}

async function returnToSectionRoot(browser, sectionHref, navigationDelayMs) {
  if (canonicalEcsUrl(await browser.getCurrentUrl()) === sectionHref) return;
  const links = await browser.getVisibleLinks();
  await clickObservedLink(browser, links, sectionHref, navigationDelayMs);
}

async function captureListingRecordsWithRetries(browser, capture, expected, attempts = 3) {
  let lastCount = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const state = await browser.getPageState();
    if (CHALLENGE_TITLE.test(clean(state?.title)) || CHALLENGE_TEXT.test(clean(state?.bodyText))) {
      throw new Error('ECS presented an interactive access challenge. Capture stopped; no bypass was attempted.');
    }
    const records = await browser.getListingRecords(capture);
    lastCount = Array.isArray(records) ? records.length : null;
    if (lastCount === expected) return records;
    if (attempt < attempts) await browser.wait(750 * attempt);
  }
  throw new Error(
    `${capture.section} / ${capture.categoryName}: expected ${expected} rendered product cards but observed ${lastCount ?? 'an invalid result'} after ${attempts} checks.`,
  );
}

async function reloadValidatedPaginationCheckpoint(browser, checkpoint, category, {
  profile,
  reloadSettleDelayMs,
  section,
  pageSize,
  attempts = 3,
}) {
  validateEcsVehiclePageCheckpoint(checkpoint, category, {
    profile,
    section,
    page: checkpoint.page,
    pageSize,
  });
  const expectedUrl = canonicalEcsUrl(checkpoint.sourceUrl);
  const beforeReload = canonicalEcsUrl(await browser.getCurrentUrl());
  if (!expectedUrl || beforeReload !== expectedUrl) {
    throw new Error(
      `${section} / ${category.name} page ${checkpoint.page} cannot be reloaded because the open URL is not its validated checkpoint URL.`,
    );
  }
  await browser.reloadCurrentPage();
  if (reloadSettleDelayMs > 0) await browser.wait(reloadSettleDelayMs);
  await waitForExpectedPage(browser, expectedUrl);
  const afterReload = canonicalEcsUrl(await browser.getCurrentUrl());
  if (afterReload !== beforeReload) {
    throw new Error(
      `${section} / ${category.name} page ${checkpoint.page} changed URL during checkpoint reload.`,
    );
  }

  let renderedCount = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const state = await browser.getPageState();
    const current = canonicalEcsUrl(state?.url);
    if (CHALLENGE_TITLE.test(clean(state?.title)) || CHALLENGE_TEXT.test(clean(state?.bodyText))) {
      throw new Error('ECS presented an interactive access challenge. Capture stopped; no bypass was attempted.');
    }
    if (current !== expectedUrl) {
      throw new Error(
        `${section} / ${category.name} page ${checkpoint.page} changed URL after checkpoint reload.`,
      );
    }
    const observedCount = await browser.getRenderedListingCount();
    renderedCount = Number.isSafeInteger(observedCount) && observedCount >= 0 ? observedCount : null;
    if (renderedCount === checkpoint.records.length) return;
    if (attempt < attempts) await browser.wait(750 * attempt);
  }
  throw new Error(
    `${section} / ${category.name} page ${checkpoint.page} reload expected ${checkpoint.records.length} rendered product cards but observed ${renderedCount ?? 'an invalid result'} after ${attempts} checks.`,
  );
}

export async function captureEcsVehicleSection(browser, {
  profile = BMW_M3_CAPTURE_PROFILE,
  section: requestedSection,
  outputDir = null,
  now = () => new Date(),
  pageSize = ECS_LISTING_PAGE_SIZE,
  navigationDelayMs = 1_200,
  paginationSettleDelayMs = navigationDelayMs,
  reloadBeforePagination = false,
  reloadSettleDelayMs = 2_500,
  pageBudget = Number.POSITIVE_INFINITY,
  terminalProofBudget = Number.POSITIVE_INFINITY,
} = {}) {
  assertBrowser(browser);
  validatedCaptureProfile(profile);
  const section = normalizeEcsVehicleSection(requestedSection, profile);
  const sectionKey = slugifyCaptureLabel(section);
  if (pageSize !== ECS_LISTING_PAGE_SIZE) {
    throw new Error(`ECS listing page size must remain ${ECS_LISTING_PAGE_SIZE} for capture reconciliation.`);
  }
  if (!Number.isFinite(navigationDelayMs) || navigationDelayMs < 0 || navigationDelayMs > 60_000) {
    throw new Error('navigationDelayMs must be between 0 and 60000 milliseconds.');
  }
  if (!Number.isFinite(paginationSettleDelayMs)
    || paginationSettleDelayMs < 0 || paginationSettleDelayMs > 60_000) {
    throw new Error('paginationSettleDelayMs must be between 0 and 60000 milliseconds.');
  }
  if (typeof reloadBeforePagination !== 'boolean') {
    throw new Error('reloadBeforePagination must be a boolean.');
  }
  if (reloadBeforePagination) assertBrowser(browser, { reloadBeforePagination: true });
  if (!Number.isFinite(reloadSettleDelayMs)
    || reloadSettleDelayMs < 0 || reloadSettleDelayMs > 60_000) {
    throw new Error('reloadSettleDelayMs must be between 0 and 60000 milliseconds.');
  }
  if (pageBudget !== Number.POSITIVE_INFINITY
    && (!Number.isSafeInteger(pageBudget) || pageBudget < 0)) {
    throw new Error('pageBudget must be a non-negative integer or Number.POSITIVE_INFINITY.');
  }
  if (terminalProofBudget !== Number.POSITIVE_INFINITY
    && (!Number.isSafeInteger(terminalProofBudget) || terminalProofBudget < 0)) {
    throw new Error('terminalProofBudget must be a non-negative integer or Number.POSITIVE_INFINITY.');
  }
  const resolvedOutput = path.resolve(outputDir || path.join(profile.defaultOutputDirectory, sectionKey));
  await Promise.all([
    mkdir(path.join(resolvedOutput, 'raw-pages'), { recursive: true }),
    mkdir(path.join(resolvedOutput, 'terminal-proofs'), { recursive: true }),
  ]);

  const discoveredAt = now().toISOString();
  if (!exactTimestamp(discoveredAt)) throw new Error('Capture clock returned an invalid ISO timestamp.');
  const rootSnapshotPath = path.join(resolvedOutput, 'section-root.json');
  const hasStoredRoot = await fileExists(rootSnapshotPath);
  const storedRoot = hasStoredRoot
    ? validateStoredRootSnapshot(JSON.parse(await readFile(rootSnapshotPath, 'utf8')), section, profile)
    : null;
  const currentUrl = canonicalEcsUrl(await browser.getCurrentUrl());
  let sectionLink;
  let categories;
  let rootSnapshot;
  let captureStartedAt = discoveredAt;
  let startedFromCheckpoint = false;
  if (currentUrl === profile.rootUrl) {
    await waitForExpectedPage(browser, profile.rootUrl);
    const rootLinks = await browser.getVisibleLinks();
    sectionLink = discoverEcsVehicleSectionLink(rootLinks, section, profile);
    await clickObservedLink(browser, rootLinks, sectionLink.href, navigationDelayMs);
  } else if (currentUrl) {
    const segments = currentUrl ? rootRelativeSegments(profile.rootUrl, currentUrl) : null;
    const currentSection = segments?.length === 1 ? decodeURIComponent(segments[0]) : '';
    if (currentSection.toLocaleLowerCase('en-US') === section.toLocaleLowerCase('en-US')) {
      await waitForExpectedPage(browser, currentUrl);
      sectionLink = { section, key: sectionKey, href: currentUrl, label: section };
    } else if (storedRoot) {
      sectionLink = storedRoot.section;
      categories = storedRoot.categories;
      rootSnapshot = storedRoot;
      captureStartedAt = storedRoot.discoveredAt;
      startedFromCheckpoint = true;
      await waitForExpectedPage(browser, currentUrl);
    } else {
      throw new Error(
        `Open ${profile.rootUrl} or its visible ${section} section link before the first capture. Current page has no matching stored checkpoint manifest: ${currentUrl}.`,
      );
    }
  } else {
    throw new Error('The current ECS page URL is unsafe or unavailable.');
  }

  if (!startedFromCheckpoint) {
    const sectionLinks = await browser.getVisibleLinks();
    categories = discoverEcsVehicleChildCategories(sectionLinks, sectionLink);
    rootSnapshot = {
      schemaVersion: 1,
      supplier: 'ECS Tuning',
      accessClass: 'public-retail',
      kind: profile.rootSnapshotKind,
      discoveredAt,
      rootUrl: profile.rootUrl,
      ...(profile === BMW_M3_CAPTURE_PROFILE ? {} : { vehicle: profile.vehicle }),
      section: sectionLink,
      categories,
    };
    if (storedRoot) {
      if (JSON.stringify(stableRootSnapshot(storedRoot)) !== JSON.stringify(stableRootSnapshot(rootSnapshot))) {
        throw new Error('The visible ECS section/category manifest changed since this capture began. Use a new output directory.');
      }
      captureStartedAt = storedRoot.discoveredAt;
    } else {
      await writeJson(rootSnapshotPath, rootSnapshot, { exclusive: true });
    }
  }
  if (!rootSnapshot || !categories || !sectionLink) {
    throw new Error(`ECS ${section} capture state could not be initialized safely.`);
  }

  const pages = await loadPageCheckpoints(
    resolvedOutput, section, sectionKey, categories, pageSize, profile,
  );
  const terminalProofs = await loadTerminalProofs(
    resolvedOutput, categories, section, sectionKey, pageSize, profile,
  );
  const openCaptureResume = startedFromCheckpoint
    ? findOpenCaptureResume(currentUrl, categories, pages, pageSize)
    : null;
  if (startedFromCheckpoint
    && canonicalEcsUrl(openCaptureResume?.sourceUrl) !== canonicalEcsUrl(currentUrl)) {
    throw new Error('The open ECS continuation page does not match the stored resume evidence.');
  }
  await writeCurrentArtifacts({
    captureStartedAt,
    categories,
    outputDir: resolvedOutput,
    pages,
    profile,
    rootSnapshot,
    section,
    sectionKey,
    terminalProofs,
    generatedAt: discoveredAt,
    pageSize,
  });

  let capturedPagesThisRun = 0;
  let terminalProofsThisRun = 0;
  let budgetExhausted = false;
  const persistOpenTerminalProof = async (category) => {
    if (terminalProofs.has(category.key)) return true;
    if (terminalProofsThisRun >= terminalProofBudget) return false;
    const proof = await observeTerminalProof(browser, category, {
      now, pageSize, profile, section,
    });
    validateEcsVehicleTerminalProof(proof, category, {
      pageSize, profile, section,
    });
    await writeJson(
      terminalProofFilename(resolvedOutput, sectionKey, category.key),
      proof,
      { exclusive: true },
    );
    terminalProofs.set(category.key, proof);
    terminalProofsThisRun += 1;
    await writeCurrentArtifacts({
      captureStartedAt,
      categories,
      outputDir: resolvedOutput,
      pages,
      profile,
      rootSnapshot,
      section,
      sectionKey,
      terminalProofs,
      generatedAt: proof.observedAt,
      pageSize,
    });
    return true;
  };
  captureLoop: for (const category of categories) {
    const expectedPages = Math.ceil(category.count / pageSize);
    if (!expectedPages) continue;
    const completed = pages
      .filter((item) => item.categoryKey === category.key)
      .sort((left, right) => left.page - right.page);
    if (completed.length === expectedPages) continue;
    if (completed.some((item, index) => item.page !== index + 1)) {
      throw new Error(`${section} / ${category.name} checkpoints are not contiguous from page 1.`);
    }
    if (capturedPagesThisRun >= pageBudget) {
      budgetExhausted = true;
      break;
    }
    let firstPage = completed.length + 1;
    const resumeAlreadyOpen = openCaptureResume?.categoryKey === category.key
      && openCaptureResume.page === firstPage
      && canonicalEcsUrl(await browser.getCurrentUrl()) === canonicalEcsUrl(openCaptureResume.sourceUrl);
    if (completed.length) {
      const lastCheckpoint = completed.at(-1);
      const checkpointAlreadyOpen = openCaptureResume?.mode === 'checkpoint'
        && openCaptureResume.categoryKey === category.key
        && openCaptureResume.page === lastCheckpoint.page
        && canonicalEcsUrl(await browser.getCurrentUrl()) === canonicalEcsUrl(lastCheckpoint.sourceUrl);
      if (!resumeAlreadyOpen) {
        if (!checkpointAlreadyOpen) {
          await browser.gotoCheckpointUrl(lastCheckpoint.sourceUrl, category.href);
          await waitForExpectedPage(browser, lastCheckpoint.sourceUrl);
        }
        if (navigationDelayMs > 0) await browser.wait(navigationDelayMs);
        if (reloadBeforePagination) {
          await reloadValidatedPaginationCheckpoint(browser, lastCheckpoint, category, {
            profile,
            reloadSettleDelayMs,
            section,
            pageSize,
          });
        }
        if (paginationSettleDelayMs > 0) await browser.wait(paginationSettleDelayMs);
        const paginationLinks = await browser.getVisibleLinks();
        const next = nextPaginationLink(paginationLinks, category.href, firstPage);
        await clickObservedLink(browser, paginationLinks, next.href, navigationDelayMs);
      } else if (navigationDelayMs > 0) {
        await browser.wait(navigationDelayMs);
      }
    } else if (!resumeAlreadyOpen) {
      await returnToSectionRoot(browser, sectionLink.href, navigationDelayMs);
      const visibleCategoryLinks = await browser.getVisibleLinks();
      await clickObservedLink(browser, visibleCategoryLinks, category.href, navigationDelayMs);
    } else if (navigationDelayMs > 0) {
      await browser.wait(navigationDelayMs);
    }

    for (let page = firstPage; page <= expectedPages; page += 1) {
      const sourceUrl = canonicalEcsUrl(await browser.getCurrentUrl());
      if (!sourceUrl) throw new Error(`${section} / ${category.name} page ${page} has an unsafe source URL.`);
      const existing = findCheckpoint(pages, category.key, page);
      if (existing) {
        validateEcsVehiclePageCheckpoint(existing, category, {
          section, page, pageSize, profile, sourceUrl,
        });
      } else {
        if (capturedPagesThisRun >= pageBudget) {
          budgetExhausted = true;
          break captureLoop;
        }
        const observedAt = now().toISOString();
        if (!exactTimestamp(observedAt)) throw new Error('Capture clock returned an invalid ISO timestamp.');
        const basePosition = ((page - 1) * pageSize) + 1;
        const expected = Math.min(pageSize, Math.max(0, category.count - ((page - 1) * pageSize)));
        const records = await captureListingRecordsWithRetries(browser, {
          basePosition,
          categoryKey: category.key,
          categoryName: category.name,
          observedAt,
          section,
          vehicle: profile.vehicle,
        }, expected);
        const pageRecord = {
          schemaVersion: 1,
          supplier: 'ECS Tuning',
          accessClass: 'public-retail',
          kind: `${profile.artifactPrefix}-section-listing-page`,
          vehicle: profile.vehicle,
          section,
          categoryKey: category.key,
          category: category.name,
          categoryUrl: category.href,
          page,
          sourceUrl,
          basePosition,
          expected,
          observedAt,
          records,
        };
        validateEcsVehiclePageCheckpoint(pageRecord, category, {
          section, page, pageSize, profile, sourceUrl,
        });
        await writeJson(
          checkpointFilename(resolvedOutput, sectionKey, category.key, page),
          pageRecord,
          { exclusive: true },
        );
        pages.push(pageRecord);
        capturedPagesThisRun += 1;
        await writeCurrentArtifacts({
          captureStartedAt,
          categories,
          outputDir: resolvedOutput,
          pages,
          profile,
          rootSnapshot,
          section,
          sectionKey,
          terminalProofs,
          generatedAt: observedAt,
          pageSize,
        });
      }

      if (page === expectedPages && !terminalProofs.has(category.key)) {
        if (terminalProofsThisRun >= terminalProofBudget) {
          budgetExhausted = true;
        } else {
          if (paginationSettleDelayMs > 0) await browser.wait(paginationSettleDelayMs);
          await persistOpenTerminalProof(category);
        }
      }

      if (page < expectedPages) {
        if (capturedPagesThisRun >= pageBudget) {
          budgetExhausted = true;
          break captureLoop;
        }
        if (reloadBeforePagination) {
          const currentCheckpoint = findCheckpoint(pages, category.key, page);
          if (!currentCheckpoint) {
            throw new Error(`${section} / ${category.name} page ${page} has no checkpoint to reload.`);
          }
          await reloadValidatedPaginationCheckpoint(browser, currentCheckpoint, category, {
            profile,
            reloadSettleDelayMs,
            section,
            pageSize,
          });
        }
        if (paginationSettleDelayMs > 0) await browser.wait(paginationSettleDelayMs);
        const paginationLinks = await browser.getVisibleLinks();
        const next = nextPaginationLink(paginationLinks, category.href, page + 1);
        await clickObservedLink(browser, paginationLinks, next.href, navigationDelayMs);
      }
    }
  }

  for (const category of categories) {
    if (terminalProofs.has(category.key)) continue;
    const expectation = terminalExpectation(category, pageSize);
    const categoryPages = pages
      .filter((item) => item.categoryKey === category.key)
      .sort((left, right) => left.page - right.page);
    if (categoryPages.length !== expectation.expectedPages) continue;
    if (terminalProofsThisRun >= terminalProofBudget) {
      budgetExhausted = true;
      break;
    }
    const targetUrl = expectation.expectedPages
      ? categoryPages.at(-1)?.sourceUrl : category.href;
    if (!targetUrl) {
      throw new Error(`${section} / ${category.name} has no exact terminal URL to validate.`);
    }
    if (canonicalEcsUrl(await browser.getCurrentUrl()) !== canonicalEcsUrl(targetUrl)) {
      await browser.gotoCheckpointUrl(targetUrl, category.href);
      await waitForExpectedPage(browser, targetUrl);
      if (navigationDelayMs > 0) await browser.wait(navigationDelayMs);
    } else {
      await waitForExpectedPage(browser, targetUrl);
    }
    if (paginationSettleDelayMs > 0) await browser.wait(paginationSettleDelayMs);
    if (!(await persistOpenTerminalProof(category))) {
      budgetExhausted = true;
      break;
    }
  }

  const generatedAt = now().toISOString();
  const artifacts = await writeCurrentArtifacts({
    captureStartedAt,
    categories,
    outputDir: resolvedOutput,
    pages,
    profile,
    rootSnapshot,
    section,
    sectionKey,
    terminalProofs,
    generatedAt,
    pageSize,
  });
  if (!artifacts.report.completeness.complete && !budgetExhausted) {
    throw new Error(
      `${section} capture finished navigation but failed reconciliation. Review ${path.join(resolvedOutput, `${profile.artifactPrefix}-${sectionKey}-reconciliation-report.json`)}.`,
    );
  }
  return {
    outputDir: resolvedOutput,
    section,
    sectionUrl: sectionLink.href,
    complete: artifacts.report.completeness.complete,
    budgetExhausted,
    capturedPagesThisRun,
    terminalProofsThisRun,
    ...artifacts.report.scope,
    report: path.join(resolvedOutput, `${profile.artifactPrefix}-${sectionKey}-reconciliation-report.json`),
  };
}

export async function captureEcsBmwM3Section(browser, options = {}) {
  return captureEcsVehicleSection(browser, {
    ...options,
    profile: BMW_M3_CAPTURE_PROFILE,
  });
}

export function createCodexTabEcsCaptureAdapter(tab, {
  clickRetryDelayMs = 2_500,
  clickTimeoutMs = 15_000,
  navigationTimeoutMs = 30_000,
  viewportSettleMs = 400,
} = {}) {
  if (!tab?.playwright || typeof tab.url !== 'function' || typeof tab.title !== 'function'
    || typeof tab.goto !== 'function') {
    throw new Error('A Codex browser tab with Playwright helpers is required.');
  }
  if (!Number.isFinite(clickRetryDelayMs) || clickRetryDelayMs < 0 || clickRetryDelayMs > 60_000) {
    throw new Error('clickRetryDelayMs must be between 0 and 60000 milliseconds.');
  }
  if (!Number.isFinite(clickTimeoutMs) || clickTimeoutMs < 3_000 || clickTimeoutMs > 60_000) {
    throw new Error('clickTimeoutMs must be between 3000 and 60000 milliseconds.');
  }
  if (!Number.isFinite(navigationTimeoutMs)
    || navigationTimeoutMs < 3_000 || navigationTimeoutMs > 120_000) {
    throw new Error('navigationTimeoutMs must be between 3000 and 120000 milliseconds.');
  }
  if (!Number.isFinite(viewportSettleMs) || viewportSettleMs < 0 || viewportSettleMs > 5_000) {
    throw new Error('viewportSettleMs must be between 0 and 5000 milliseconds.');
  }
  const observedRawHrefs = new Map();
  const escapeCssAttribute = (value) => String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n\f]/g, ' ');
  const adapter = {
    async getCurrentUrl() {
      return tab.url();
    },
    async gotoCheckpointUrl(destination, categoryUrl) {
      const checkpointUrl = canonicalEcsUrl(destination);
      const category = canonicalEcsUrl(categoryUrl);
      if (!checkpointUrl || !category || !checkpointPageMatchesCategory(category, checkpointUrl)) {
        throw new Error(`Refusing unsafe or cross-category ECS checkpoint resume URL: ${destination}`);
      }
      await tab.goto(checkpointUrl);
    },
    async reloadCurrentPage() {
      if (typeof tab.reload !== 'function') {
        throw new Error('The Codex browser tab does not support checkpoint reload recovery.');
      }
      await tab.reload();
    },
    async getRenderedListingCount() {
      return tab.playwright.evaluate(
        () => document.querySelectorAll('.product-listing.productListBox').length,
        undefined,
        { timeoutMs: 15_000 },
      );
    },
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
    async getVisibleLinks() {
      const links = await tab.playwright.evaluate(() => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const visible = (element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden'
            && Number(style.opacity || 1) !== 0 && rect.width > 0 && rect.height > 0;
        };
        return Array.from(document.querySelectorAll('a[href]')).filter(visible).map((anchor) => {
          const container = anchor.closest('li, article, [class*="category"], [class*="Category"]');
          const countNode = container?.querySelector(
            '[data-count], [data-product-count], [class*="count"], [class*="Count"], [class*="qty"], [class*="Qty"]',
          );
          return {
            ariaLabel: normalize(anchor.getAttribute('aria-label')),
            contextText: normalize(container?.textContent).slice(0, 500),
            countText: normalize(countNode?.textContent),
            dataCount: normalize(
              anchor.dataset.count || anchor.dataset.productCount
              || container?.getAttribute('data-count') || container?.getAttribute('data-product-count'),
            ),
            href: new URL(anchor.getAttribute('href'), location.href).href,
            rawHref: anchor.getAttribute('href'),
            rel: normalize(anchor.getAttribute('rel')),
            text: normalize(anchor.textContent),
            visible: true,
          };
        });
      }, undefined, { timeoutMs: 15_000 });
      observedRawHrefs.clear();
      for (const link of links) {
        const href = canonicalEcsUrl(link?.href);
        const rawHref = clean(link?.rawHref);
        if (!href || !rawHref) continue;
        const values = observedRawHrefs.get(href) || [];
        if (!values.includes(rawHref)) values.push(rawHref);
        observedRawHrefs.set(href, values);
      }
      return links;
    },
    async clickVisibleHref(destination) {
      const canonicalDestination = canonicalEcsUrl(destination);
      if (!canonicalDestination) throw new Error(`Unsafe ECS click destination: ${destination}`);
      let lastError = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const state = await adapter.getPageState();
        if (CHALLENGE_TITLE.test(clean(state?.title)) || CHALLENGE_TEXT.test(clean(state?.bodyText))) {
          throw new Error('ECS presented an interactive access challenge. Capture stopped; no bypass was attempted.');
        }
        if (attempt > 1) await adapter.getVisibleLinks();
        const rawHrefs = observedRawHrefs.get(canonicalDestination);
        if (!rawHrefs?.length) {
          lastError = new Error(`No previously observed visible ECS link can be clicked: ${destination}`);
        } else {
          const selector = rawHrefs
            .map((rawHref) => `a[href="${escapeCssAttribute(rawHref)}"]`)
            .join(', ');
          const candidates = tab.playwright.locator(selector);
          const matchCount = await candidates.count();
          const observedTarget = matchCount ? candidates.last() : null;
          if (!observedTarget || !(await observedTarget.isVisible())) {
            lastError = new Error(`Previously observed ECS link is no longer visible: ${destination}`);
          } else {
            try {
              const aligned = await tab.playwright.evaluate(({ hrefs }) => {
                const rendered = Array.from(document.querySelectorAll('a[href]')).filter((anchor) => {
                  if (!hrefs.includes(anchor.getAttribute('href'))) return false;
                  const style = getComputedStyle(anchor);
                  const rect = anchor.getBoundingClientRect();
                  return style.display !== 'none' && style.visibility !== 'hidden'
                    && Number(style.opacity || 1) !== 0 && rect.width > 0 && rect.height > 0;
                });
                const anchor = rendered.at(-1);
                if (!anchor) return false;
                const rect = anchor.getBoundingClientRect();
                window.scrollTo(0, Math.max(0, window.scrollY + rect.top - (window.innerHeight / 2)));
                return true;
              }, { hrefs: rawHrefs }, { timeoutMs: 15_000 });
              if (!aligned) throw new Error(`Observed ECS link could not be aligned in the viewport: ${destination}`);
              if (viewportSettleMs > 0) await tab.playwright.waitForTimeout(viewportSettleMs);
              const target = tab.playwright.locator(selector).last();
              await target.waitFor({ state: 'visible', timeoutMs: 10_000 });
              await tab.playwright.expectNavigation(
                () => target.click({ force: true, timeoutMs: clickTimeoutMs }),
                { waitUntil: 'domcontentloaded', timeoutMs: navigationTimeoutMs },
              );
              return;
            } catch (error) {
              if (canonicalEcsUrl(await tab.url()) === canonicalDestination) return;
              lastError = error;
            }
          }
        }
        if (attempt < 3) await tab.playwright.waitForTimeout(clickRetryDelayMs * attempt);
      }

      if (typeof tab.dom_cua?.get_visible_dom !== 'function'
        || typeof tab.dom_cua?.click !== 'function') {
        lastError = new Error(
          `DOM CUA visible-link fallback is unavailable after locator retries${lastError ? `: ${clean(lastError.message)}` : ''}`,
        );
      } else {
        try {
          const rawHrefs = observedRawHrefs.get(canonicalDestination) || [];
          const visibleDom = await tab.dom_cua.get_visible_dom();
          const targets = visibleDomExactAnchorTargets(visibleDom, rawHrefs);
          if (targets.length !== 1) {
            throw new Error(
              `DOM CUA fallback requires exactly one visible anchor matching the observed raw href; found ${targets.length}.`,
            );
          }
          await tab.dom_cua.click({ node_id: targets[0].nodeId });
          const verificationAttempts = Math.max(1, Math.ceil(navigationTimeoutMs / 250));
          for (let verificationAttempt = 1;
            verificationAttempt <= verificationAttempts;
            verificationAttempt += 1) {
            const state = await adapter.getPageState();
            if (CHALLENGE_TITLE.test(clean(state?.title))
              || CHALLENGE_TEXT.test(clean(state?.bodyText))) {
              throw new Error('ECS presented an interactive access challenge. Capture stopped; no bypass was attempted.');
            }
            if (canonicalEcsUrl(state?.url) === canonicalDestination) return;
            if (verificationAttempt < verificationAttempts) {
              await tab.playwright.waitForTimeout(250);
            }
          }
          throw new Error(`DOM CUA click did not reach ${canonicalDestination}.`);
        } catch (error) {
          lastError = error;
        }
      }
      throw new Error(
        `Visible ECS link click failed after locator retries and DOM fallback for ${canonicalDestination}: ${clean(lastError?.message) || 'unknown browser error'}`,
      );
    },
    async getListingRecords({
      basePosition, categoryKey, categoryName, observedAt, section, vehicle,
    }) {
      return tab.playwright.evaluate((capture) => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const directDescription = (card) => {
          const node = card.querySelector('.product-desc');
          if (!node) return '';
          return normalize(Array.from(node.childNodes)
            .filter((child) => child.nodeType === Node.TEXT_NODE)
            .map((child) => child.textContent)
            .join(' '));
        };
        const ddAfter = (card, label) => {
          const term = Array.from(card.querySelectorAll('.product-ids dt'))
            .find((node) => normalize(node.textContent) === label);
          return normalize(term?.nextElementSibling?.textContent);
        };
        return Array.from(document.querySelectorAll('.product-listing.productListBox')).map((card, index) => {
          const productLink = card.querySelector('.product-name h4 a');
          const brandLink = card.querySelector('.product-ids a#brandLink, .product-ids dd a[title]');
          const image = card.querySelector('.product-image img.productThumb');
          const webp = card.querySelector('.product-image picture source[type="image/webp"]');
          const price = normalize(card.querySelector('.product-price .price')?.textContent)
            || normalize(card.querySelector('.product-price')?.textContent);
          return {
            availabilityText: normalize(card.querySelector('.stockstatus')?.textContent),
            brand: normalize(brandLink?.getAttribute('title')),
            category: capture.categoryName,
            categoryKey: capture.categoryKey,
            description: directDescription(card),
            ecsPartNumber: normalize(card.querySelector('.product-ids .js-esnum')?.textContent).replace(/^ES#/i, ''),
            imageAlt: normalize(image?.getAttribute('alt')),
            imageFallbackUrl: image?.src || '',
            imageUrl: normalize(webp?.getAttribute('srcset')).split(/\s+/)[0] || '',
            manufacturerPartNumber: ddAfter(card, 'Mfg#:'),
            observedAt: capture.observedAt,
            priceBlockText: normalize(card.querySelector('.product-price')?.textContent),
            priceText: price,
            productUrl: productLink ? new URL(productLink.getAttribute('href'), location.href).href : '',
            relevancePosition: capture.basePosition + index,
            section: capture.section,
            shippingText: normalize(card.querySelector('.shipping-info')?.textContent),
            sourceUrl: location.href,
            title: normalize(productLink?.textContent),
            vehicle: capture.vehicle,
          };
        });
      }, { basePosition, categoryKey, categoryName, observedAt, section, vehicle }, { timeoutMs: 15_000 });
    },
    async wait(milliseconds) {
      await tab.playwright.waitForTimeout(milliseconds);
    },
  };
  return adapter;
}
