import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
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

export function normalizeBmwM3Section(value) {
  const requested = clean(value).toLocaleLowerCase('en-US');
  const supported = SUPPORTED_BMW_M3_SECTIONS.find(
    (section) => section.toLocaleLowerCase('en-US') === requested,
  );
  if (!supported) {
    throw new Error(
      `Unsupported BMW M3 section ${JSON.stringify(value)}. Choose one of: ${SUPPORTED_BMW_M3_SECTIONS.join(', ')}.`,
    );
  }
  return supported;
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

export function discoverBmwM3SectionLink(visibleLinks, requestedSection) {
  const section = normalizeBmwM3Section(requestedSection);
  const requested = section.toLocaleLowerCase('en-US');
  const candidates = visibleLinks
    .map(normalizedVisibleLink)
    .filter(Boolean)
    .map((link, order) => ({ link, order, segments: rootRelativeSegments(BMW_M3_ROOT_URL, link.href) }))
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
    throw new Error(`No visible existing ECS link for the ${section} section was found on ${BMW_M3_ROOT_URL}.`);
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

export function discoverBmwM3ChildCategories(visibleLinks, sectionLink) {
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
    if (!key || usedKeys.has(key)) throw new Error(`ECS category key collision for ${label}.`);
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

function assertBrowser(browser, { reloadBeforePagination = false } = {}) {
  const required = [
    'clickVisibleHref',
    'getCurrentUrl',
    'getListingRecords',
    'getPageState',
    'getVisibleLinks',
    'gotoCheckpointUrl',
    'wait',
  ];
  if (reloadBeforePagination) required.push('getRenderedListingCount', 'reloadCurrentPage');
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

function validateStoredRootSnapshot(snapshot, section) {
  const sectionKey = slugifyCaptureLabel(section);
  const sectionHref = canonicalEcsUrl(snapshot?.section?.href);
  const sectionSegments = sectionHref ? rootRelativeSegments(BMW_M3_ROOT_URL, sectionHref) : null;
  if (snapshot?.schemaVersion !== 1 || snapshot?.supplier !== 'ECS Tuning'
    || snapshot?.accessClass !== 'public-retail' || snapshot?.kind !== 'bmw-m3-section-root-snapshot'
    || snapshot?.rootUrl !== BMW_M3_ROOT_URL || !exactTimestamp(snapshot?.discoveredAt)
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
    if (!clean(category?.key) || !clean(category?.name)
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
  if (!progress) throw new Error('No validated ECS capture position exists for the currently open page.');
  const lastCheckpoint = progress.completed.at(-1) || lastCompletedProgress?.completed.at(-1) || null;
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
    throw new Error('The open ECS page is not the exact highest contiguous validated checkpoint.');
  }
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

async function writeJson(filename, value, { exclusive = false } = {}) {
  await mkdir(path.dirname(filename), { recursive: true });
  if (!exclusive) {
    await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    return;
  }
  const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  try {
    await rename(temporary, filename);
  } catch (error) {
    if (error?.code === 'EEXIST' || error?.code === 'EPERM') {
      throw new Error(`Checkpoint already exists and was not overwritten: ${filename}.`);
    }
    throw error;
  }
}

function checkpointFilename(outputDir, sectionKey, categoryKey, page) {
  return path.join(outputDir, 'raw-pages', `${sectionKey}-${categoryKey}-p${page}.json`);
}

export function validateBmwM3PageCheckpoint(pageRecord, category, {
  section,
  page,
  pageSize = ECS_LISTING_PAGE_SIZE,
  sourceUrl = null,
} = {}) {
  const expected = Math.min(pageSize, Math.max(0, category.count - ((page - 1) * pageSize)));
  const canonicalSource = canonicalEcsUrl(pageRecord?.sourceUrl);
  if (pageRecord?.schemaVersion !== 1 || pageRecord?.supplier !== 'ECS Tuning'
    || pageRecord?.accessClass !== 'public-retail'
    || pageRecord?.kind !== 'bmw-m3-section-listing-page'
    || pageRecord?.vehicle !== BMW_M3_VEHICLE || pageRecord?.section !== section
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
      || record?.section !== section || record?.vehicle !== BMW_M3_VEHICLE
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

function categorySummaries(categories, pages, pageSize) {
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
    };
  });
}

export function buildBmwM3ReconciliationReport({
  captureStartedAt,
  categories,
  generatedAt,
  pages,
  rootSnapshot,
  section,
  sectionKey,
  pageSize = ECS_LISTING_PAGE_SIZE,
}) {
  const categoryAudit = categorySummaries(categories, pages, pageSize).map((category) => ({
    ...category,
    observedCount: pages
      .filter((page) => page.categoryKey === category.key)
      .reduce((total, page) => total + page.records.length, 0),
    exact: category.pages === category.expectedPages
      && category.pageCounts.reduce((total, count) => total + count, 0) === category.count
      && category.positionsContiguous,
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
  const complete = categoryAudit.every((category) => category.exact)
    && Object.values(requiredMissing).every((count) => count === 0)
    && identityConflicts.length === 0
    && duplicatePlacements.length === 0;
  return {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    accessClass: 'public-retail',
    kind: `bmw-m3-${sectionKey}-reconciliation-report`,
    captureStartedAt,
    generatedAt,
    source: {
      rootUrl: rootSnapshot.rootUrl,
      sectionUrl: rootSnapshot.section.href,
      discoveryRule: 'Sections, categories and forward pagination use visible existing ECS links only. Resume may reopen an exact validated ECS page URL retained in a local raw-page checkpoint, or continue from the exact next uncaptured child/page already open in the persistent tab; no URL is synthesized.',
    },
    scope: {
      vehicle: BMW_M3_VEHICLE,
      section,
      categories: categories.length,
      expectedPages: categoryAudit.reduce((total, category) => total + category.expectedPages, 0),
      capturedPages: pages.length,
      expectedPlacements: categories.reduce((total, category) => total + category.count, 0),
      capturedPlacements: records.length,
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
      nextUncheckpointPageValidated: true,
      liveStockClaim: false,
    },
  };
}

async function writeCurrentArtifacts({
  captureStartedAt,
  categories,
  outputDir,
  pages,
  rootSnapshot,
  section,
  sectionKey,
  generatedAt,
  pageSize,
}) {
  const summaries = categorySummaries(categories, pages, pageSize);
  const records = pages
    .slice()
    .sort((left, right) => categories.findIndex((category) => category.key === left.categoryKey)
      - categories.findIndex((category) => category.key === right.categoryKey) || left.page - right.page)
    .flatMap((page) => page.records);
  const aggregate = {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    accessClass: 'public-retail',
    kind: `bmw-m3-${sectionKey}-listing-capture`,
    captureStartedAt,
    generatedAt,
    vehicle: BMW_M3_VEHICLE,
    section,
    sectionUrl: rootSnapshot.section.href,
    categories: summaries,
    records,
  };
  const report = buildBmwM3ReconciliationReport({
    captureStartedAt,
    categories,
    generatedAt,
    pages,
    rootSnapshot,
    section,
    sectionKey,
    pageSize,
  });
  const manifest = {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    accessClass: 'public-retail',
    kind: `bmw-m3-${sectionKey}-capture-manifest`,
    captureStartedAt,
    generatedAt,
    rootUrl: rootSnapshot.rootUrl,
    section: rootSnapshot.section,
    pageSize,
    categories: Object.fromEntries(summaries.map((category) => [category.key, category])),
    totals: report.scope,
    complete: report.completeness.complete,
  };
  await Promise.all([
    writeJson(path.join(outputDir, `bmw-m3-${sectionKey}-records.json`), aggregate),
    writeJson(path.join(outputDir, `bmw-m3-${sectionKey}-manifest.json`), manifest),
    writeJson(path.join(outputDir, `bmw-m3-${sectionKey}-reconciliation-report.json`), report),
  ]);
  return { aggregate, manifest, report };
}

async function loadPageCheckpoints(outputDir, section, sectionKey, categories, pageSize) {
  const pages = [];
  for (const category of categories) {
    const expectedPages = Math.ceil(category.count / pageSize);
    for (let page = 1; page <= expectedPages; page += 1) {
      const filename = checkpointFilename(outputDir, sectionKey, category.key, page);
      if (!(await fileExists(filename))) continue;
      const pageRecord = JSON.parse(await readFile(filename, 'utf8'));
      pages.push(validateBmwM3PageCheckpoint(pageRecord, category, { section, page, pageSize }));
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
  reloadSettleDelayMs,
  section,
  pageSize,
  attempts = 3,
}) {
  validateBmwM3PageCheckpoint(checkpoint, category, {
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

export async function captureEcsBmwM3Section(browser, {
  section: requestedSection,
  outputDir = null,
  now = () => new Date(),
  pageSize = ECS_LISTING_PAGE_SIZE,
  navigationDelayMs = 1_200,
  paginationSettleDelayMs = navigationDelayMs,
  reloadBeforePagination = false,
  reloadSettleDelayMs = 2_500,
  pageBudget = Number.POSITIVE_INFINITY,
} = {}) {
  assertBrowser(browser);
  const section = normalizeBmwM3Section(requestedSection);
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
  const resolvedOutput = path.resolve(outputDir || path.join('private-imports', 'ecs-bmw-m3-capture', sectionKey));
  await mkdir(path.join(resolvedOutput, 'raw-pages'), { recursive: true });

  const discoveredAt = now().toISOString();
  if (!exactTimestamp(discoveredAt)) throw new Error('Capture clock returned an invalid ISO timestamp.');
  const rootSnapshotPath = path.join(resolvedOutput, 'section-root.json');
  const hasStoredRoot = await fileExists(rootSnapshotPath);
  const storedRoot = hasStoredRoot
    ? validateStoredRootSnapshot(JSON.parse(await readFile(rootSnapshotPath, 'utf8')), section)
    : null;
  const currentUrl = canonicalEcsUrl(await browser.getCurrentUrl());
  let sectionLink;
  let categories;
  let rootSnapshot;
  let captureStartedAt = discoveredAt;
  let startedFromCheckpoint = false;
  if (currentUrl === BMW_M3_ROOT_URL) {
    await waitForExpectedPage(browser, BMW_M3_ROOT_URL);
    const rootLinks = await browser.getVisibleLinks();
    sectionLink = discoverBmwM3SectionLink(rootLinks, section);
    await clickObservedLink(browser, rootLinks, sectionLink.href, navigationDelayMs);
  } else if (currentUrl) {
    const segments = currentUrl ? rootRelativeSegments(BMW_M3_ROOT_URL, currentUrl) : null;
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
        `Open ${BMW_M3_ROOT_URL} or its visible ${section} section link before the first capture. Current page has no matching stored checkpoint manifest: ${currentUrl}.`,
      );
    }
  } else {
    throw new Error('The current ECS page URL is unsafe or unavailable.');
  }

  if (!startedFromCheckpoint) {
    const sectionLinks = await browser.getVisibleLinks();
    categories = discoverBmwM3ChildCategories(sectionLinks, sectionLink);
    rootSnapshot = {
      schemaVersion: 1,
      supplier: 'ECS Tuning',
      accessClass: 'public-retail',
      kind: 'bmw-m3-section-root-snapshot',
      discoveredAt,
      rootUrl: BMW_M3_ROOT_URL,
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

  const pages = await loadPageCheckpoints(resolvedOutput, section, sectionKey, categories, pageSize);
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
    rootSnapshot,
    section,
    sectionKey,
    generatedAt: discoveredAt,
    pageSize,
  });

  let capturedPagesThisRun = 0;
  let budgetExhausted = false;
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
        validateBmwM3PageCheckpoint(existing, category, { section, page, pageSize, sourceUrl });
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
          vehicle: BMW_M3_VEHICLE,
        }, expected);
        const pageRecord = {
          schemaVersion: 1,
          supplier: 'ECS Tuning',
          accessClass: 'public-retail',
          kind: 'bmw-m3-section-listing-page',
          vehicle: BMW_M3_VEHICLE,
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
        validateBmwM3PageCheckpoint(pageRecord, category, { section, page, pageSize, sourceUrl });
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
          rootSnapshot,
          section,
          sectionKey,
          generatedAt: observedAt,
          pageSize,
        });
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

  const generatedAt = now().toISOString();
  const artifacts = await writeCurrentArtifacts({
    captureStartedAt,
    categories,
    outputDir: resolvedOutput,
    pages,
    rootSnapshot,
    section,
    sectionKey,
    generatedAt,
    pageSize,
  });
  if (!artifacts.report.completeness.complete && !budgetExhausted) {
    throw new Error(
      `${section} capture finished navigation but failed reconciliation. Review ${path.join(resolvedOutput, `bmw-m3-${sectionKey}-reconciliation-report.json`)}.`,
    );
  }
  return {
    outputDir: resolvedOutput,
    section,
    sectionUrl: sectionLink.href,
    complete: artifacts.report.completeness.complete,
    budgetExhausted,
    capturedPagesThisRun,
    ...artifacts.report.scope,
    report: path.join(resolvedOutput, `bmw-m3-${sectionKey}-reconciliation-report.json`),
  };
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
