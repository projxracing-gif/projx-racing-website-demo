import { createHash } from 'node:crypto';
import { access, open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ECS_HOST = 'www.ecstuning.com';
const ECS_IMAGE_HOST = 'assets.ecstuning.com';
const PRODUCT_PATH = /^\/b-[^/?#]+\/[^/?#]+\/[^/?#]+\/$/i;
const PAGE_SIZE = 16;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1_000;
const PLACEMENT_IDENTITY_TUPLE_CONTRACT = '[vehicle,section,categoryKey,page,position,ecsPartNumber]';
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..', '..');
const REQUIRED_RECORD_FIELDS = Object.freeze([
  'availabilityText',
  'ecsPartNumber',
  'manufacturerPartNumber',
  'priceText',
  'productUrl',
  'sourceUrl',
  'title',
]);

export const F8X_AGGREGATE_SECTIONS = Object.freeze({
  braking: Object.freeze({ label: 'Braking', labelAr: 'الفرامل', path: 'Braking' }),
  engine: Object.freeze({ label: 'Engine', labelAr: 'المحرك', path: 'Engine' }),
  exterior: Object.freeze({ label: 'Exterior', labelAr: 'الهيكل الخارجي', path: 'Exterior' }),
  interior: Object.freeze({ label: 'Interior', labelAr: 'المقصورة الداخلية', path: 'Interior' }),
  suspension: Object.freeze({ label: 'Suspension', labelAr: 'نظام التعليق', path: 'Suspension' }),
  steering: Object.freeze({ label: 'Steering', labelAr: 'نظام التوجيه', path: 'Steering' }),
  performance: Object.freeze({ label: 'Performance', labelAr: 'الأداء', path: 'Performance' }),
});

export const F8X_AGGREGATE_PROFILES = Object.freeze({
  'f80-m3': Object.freeze({
    artifactPrefix: 'bmw-f80-m3',
    vehicleKey: 'f80-m3',
    vehicle: 'BMW F80 M3 S55 3.0L',
    rootUrl: 'https://www.ecstuning.com/BMW-F80-M3-S55_3.0L/',
    model: 'M3',
    generation: 'F80',
    chassis: 'F80',
    engine: 'S55',
  }),
  'f82-m4': Object.freeze({
    artifactPrefix: 'bmw-f82-m4',
    vehicleKey: 'f82-m4',
    vehicle: 'BMW F82 M4 S55 3.0L',
    rootUrl: 'https://www.ecstuning.com/BMW-F82-M4-S55_3.0L/',
    model: 'M4',
    generation: 'F82',
    chassis: 'F82',
    engine: 'S55',
  }),
  'f83-m4': Object.freeze({
    artifactPrefix: 'bmw-f83-m4',
    vehicleKey: 'f83-m4',
    vehicle: 'BMW F83 M4 S55 3.0L',
    rootUrl: 'https://www.ecstuning.com/BMW-F83-M4-S55_3.0L/',
    model: 'M4',
    generation: 'F83',
    chassis: 'F83',
    engine: 'S55',
  }),
});

const PROFILE_ORDER = Object.keys(F8X_AGGREGATE_PROFILES);
const SECTION_ORDER = Object.keys(F8X_AGGREGATE_SECTIONS);

function clean(value, maximum = 5_000) {
  return String(value ?? '').normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function slugify(value) {
  return clean(value, 500).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'uncategorized';
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ''))];
}

function ecsDigits(value) {
  const match = clean(value, 100).match(/^(?:ES\s*#?\s*)?(\d{3,12})$/i);
  return match?.[1] || null;
}

function exactTimestamp(value, nowMs) {
  const source = clean(value, 100);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(source)) return null;
  const parsed = Date.parse(source);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== source
    || parsed > nowMs + FUTURE_TOLERANCE_MS) return null;
  return source;
}

function canonicalEcsUrl(value, {
  allowBareFragment = false,
  host = ECS_HOST,
  product = false,
  trailingSlash = true,
} = {}) {
  try {
    const source = clean(value, 2_000);
    const url = new URL(source);
    const fragmentIndex = source.indexOf('#');
    const bareFragment = fragmentIndex === source.length - 1;
    if (url.protocol !== 'https:' || url.hostname !== host || url.username || url.password
      || url.port || source.includes('?') || url.search || url.hash
      || (fragmentIndex !== -1 && !(allowBareFragment && bareFragment))
      || (product && !PRODUCT_PATH.test(url.pathname))) {
      return null;
    }
    if (trailingSlash) url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
    return url.toString();
  } catch {
    return null;
  }
}

function canonicalEcsPaginationUrl(value, { allowBareFragment = false } = {}) {
  return canonicalEcsUrl(value, { allowBareFragment, trailingSlash: false });
}

function canonicalProductUrl(value) {
  const repaired = clean(value, 2_000)
    .replace(/\u00c2\u00ad/g, '\u00ad')
    .replace(/%C3%82%C2%AD/gi, '%C2%AD');
  return canonicalEcsUrl(repaired, { product: true });
}

function relativeSegments(rootUrl, candidateUrl) {
  const root = new URL(rootUrl);
  const candidate = new URL(candidateUrl);
  if (!candidate.pathname.startsWith(root.pathname)) return null;
  return candidate.pathname.slice(root.pathname.length).split('/').filter(Boolean);
}

function pageMatchesCategory(categoryUrl, candidateUrl, expectedPage) {
  const category = canonicalEcsUrl(categoryUrl);
  const candidate = canonicalEcsPaginationUrl(candidateUrl);
  if (!category || !candidate) return false;
  if (expectedPage === 1) return candidate === category;
  const segments = relativeSegments(category, candidate);
  return segments?.length === 1 && Number(segments[0]) === expectedPage
    && /^\d+$/.test(segments[0]);
}

function normalizedMpn(value) {
  return clean(value, 200).replace(/\u00ad/g, '')
    .toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '');
}

function parseUsdPrice(record) {
  const raw = record?.publicUsdPrice ?? record?.priceAmount ?? record?.priceText ?? null;
  const source = clean(raw, 200);
  const presentations = [source, clean(record?.priceText, 200), clean(record?.priceBlockText, 500)];
  const startingAt = record?.priceStartingAt === true
    || presentations.some((value) => /^(?:starting\s+at|from)\b/i.test(value));
  if (raw === null || raw === undefined || source === '') return { amount: null, startingAt };
  if (presentations.some((value) => (
    /\b(?:GBP|EUR|KWD|AED|SAR|CAD|AUD|NZD|JPY|CNY|RMB|CHF|QAR|BHD|OMR)\b|[£€¥]/i.test(value)
  ))) return { amount: null, startingAt };
  if (typeof raw === 'number') return {
    amount: Number.isFinite(raw) && raw >= 0 ? Math.round(raw * 100) / 100 : null,
    startingAt,
  };
  if (!/(?:\bUSD\b|US\$|\$)/i.test(source)) return { amount: null, startingAt };
  const match = source.replace(/,/g, '').match(
    /^(?:(?:starting\s+at|from)\s+)?(?:(?:USD|US\$)\s*)?(?:\$\s*)?(\d+(?:\.\d{1,2})?)\s*(?:USD)?$/i,
  );
  const amount = match ? Number(match[1]) : Number.NaN;
  return {
    amount: Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : null,
    startingAt,
  };
}

function imageUrls(record) {
  const candidates = [
    ...(Array.isArray(record?.imageUrls) ? record.imageUrls : []),
    ...(Array.isArray(record?.images) ? record.images : []),
    record?.imageUrl,
    record?.imageFallbackUrl,
  ];
  return unique(candidates.map((value) => (typeof value === 'object' ? value?.src : value))
    .map((value) => canonicalEcsUrl(value, { host: ECS_IMAGE_HOST, trailingSlash: false }))
    .filter((value) => value && !/\/ecs_box_no_image\.(?:avif|jpe?g|png|webp)$/i.test(new URL(value).pathname)))
    .sort();
}

function sectionFromKey(sectionKey) {
  return Object.hasOwn(F8X_AGGREGATE_SECTIONS, sectionKey)
    ? F8X_AGGREGATE_SECTIONS[sectionKey] : null;
}

function profileFromKey(profileKey) {
  return Object.hasOwn(F8X_AGGREGATE_PROFILES, profileKey)
    ? F8X_AGGREGATE_PROFILES[profileKey] : null;
}

function scopeKey(profileKey, sectionKey) {
  return `${profileKey}|${sectionKey}`;
}

function expectedScopeKeys() {
  return PROFILE_ORDER.flatMap((profileKey) => SECTION_ORDER
    .map((sectionKey) => scopeKey(profileKey, sectionKey)));
}

function profileIndex(profileKey) {
  return PROFILE_ORDER.indexOf(profileKey);
}

function sectionIndex(sectionKey) {
  return SECTION_ORDER.indexOf(sectionKey);
}

function exactScopeUrl(profile, section) {
  return `${profile.rootUrl}${section.path}/`;
}

function assertZeroObject(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.values(value).some((count) => count !== 0)) throw new Error(message);
}

function validateTerminalProofSummary(summary, {
  categoryName,
  count,
  expectedPageCounts,
  expectedPages,
  pageUrls,
  profile,
  section,
  sourceUrl,
  nowMs,
}) {
  const terminalPage = Math.max(1, expectedPages);
  const terminalUrl = canonicalEcsPaginationUrl(summary?.terminalUrl);
  const expectedTerminalUrl = expectedPages ? pageUrls.at(-1) : sourceUrl;
  const expectedRenderedCount = expectedPages ? expectedPageCounts.at(-1) : 0;
  const observedLinks = Array.isArray(summary?.observedPaginationLinks)
    ? summary.observedPaginationLinks : null;
  const invalidObservedLink = observedLinks?.some((link) => {
    const rawHref = clean(link?.href, 2_000);
    const href = canonicalEcsPaginationUrl(rawHref, { allowBareFragment: true });
    if (!href || href !== rawHref) return true;
    const bareSelfAnchor = rawHref.endsWith('#');
    const comparisonHref = bareSelfAnchor ? rawHref.slice(0, -1) : href;
    const segments = comparisonHref === sourceUrl
      ? [] : relativeSegments(sourceUrl, comparisonHref);
    const derivedPage = comparisonHref === sourceUrl ? 1
      : (segments?.length === 1 && /^\d+$/.test(segments[0]) ? Number(segments[0]) : null);
    const expectedPageUrl = Number.isSafeInteger(derivedPage)
      ? (derivedPage === 1 ? sourceUrl : pageUrls[derivedPage - 1]) : null;
    const rel = clean(link?.rel, 100).toLocaleLowerCase('en-US');
    return link?.page !== derivedPage || comparisonHref !== expectedPageUrl
      || (bareSelfAnchor && (comparisonHref !== expectedTerminalUrl
        || derivedPage !== terminalPage))
      || rel.split(/\s+/).filter(Boolean).includes('next')
      || (Number.isSafeInteger(derivedPage) && derivedPage > terminalPage);
  });
  if (summary?.kind !== `${profile.artifactPrefix}-section-terminal-pagination-proof`
    || !exactTimestamp(summary?.observedAt, nowMs)
    || summary?.terminalPage !== terminalPage || terminalUrl !== expectedTerminalUrl
    || !pageMatchesCategory(sourceUrl, terminalUrl, terminalPage)
    || summary?.expectedRenderedCount !== expectedRenderedCount
    || summary?.renderedCount !== expectedRenderedCount
    || !Number.isSafeInteger(summary?.observedVisibleLinkCount)
    || summary.observedVisibleLinkCount < 0 || !observedLinks
    || summary.observedVisibleLinkCount < observedLinks.length || invalidObservedLink
    || summary?.nextPageAbsent !== true || summary?.validated !== true) {
    throw new Error(
      `${profile.vehicle} ${section.label} category ${categoryName} lacks valid terminal-pagination evidence for ${count} supplier-listed products.`,
    );
  }
  return summary;
}

function validateCategory(
  category,
  document,
  manifestCategory,
  reportCategory,
  pageSize,
  profile,
  section,
  nowMs,
) {
  const sectionUrl = document.sectionUrl;
  const key = clean(category?.key, 300);
  const name = clean(category?.name, 300);
  const sourceUrl = canonicalEcsUrl(category?.sourceUrl);
  const count = Number(category?.count);
  const expectedPages = Math.ceil(count / pageSize);
  const expectedPageCounts = Array.from({ length: expectedPages }, (_, index) => (
    Math.min(pageSize, count - (index * pageSize))
  ));
  const pageUrls = Array.isArray(category?.pageUrls) ? category.pageUrls : null;
  const sectionSegments = sourceUrl ? relativeSegments(sectionUrl, sourceUrl) : null;
  if (!key || slugify(key) !== key || !name || !sourceUrl || sectionSegments?.length !== 1
    || /^\d+$/.test(sectionSegments[0]) || !Number.isSafeInteger(count) || count < 0
    || category?.expectedPages !== expectedPages || category?.pages !== expectedPages
    || !Array.isArray(category?.pageCounts)
    || JSON.stringify(category.pageCounts) !== JSON.stringify(expectedPageCounts)
    || !pageUrls || pageUrls.length !== expectedPages
    || pageUrls.some((url, index) => !pageMatchesCategory(sourceUrl, url, index + 1))
    || category?.positionsContiguous !== true) {
    throw new Error(`${document.vehicle} ${document.section} category ${name || key || '<unknown>'} is incomplete or unreconciled.`);
  }
  validateTerminalProofSummary(category?.terminalProof, {
    categoryName: name,
    count,
    expectedPageCounts,
    expectedPages,
    pageUrls,
    profile,
    section,
    sourceUrl,
    nowMs,
  });
  const comparableKeys = [
    'key', 'name', 'sourceUrl', 'count', 'countEvidence', 'expectedPages', 'pages',
    'pageCounts', 'pageUrls', 'positionsContiguous', 'terminalProof',
  ];
  for (const counterpart of [manifestCategory, reportCategory]) {
    if (!counterpart || comparableKeys.some((field) => (
      JSON.stringify(counterpart[field]) !== JSON.stringify(category[field])
    ))) {
      throw new Error(`${document.vehicle} ${document.section} category ${name} disagrees across capture artifacts.`);
    }
  }
  if (reportCategory.observedCount !== count || reportCategory.exact !== true) {
    throw new Error(`${document.vehicle} ${document.section} category ${name} is not exact in the reconciliation report.`);
  }
  return { key, name, sourceUrl, count, expectedPages, pageUrls };
}

function inferBundleScope(bundle) {
  const kind = clean(bundle?.capture?.kind, 300);
  for (const [profileKey, profile] of Object.entries(F8X_AGGREGATE_PROFILES)) {
    for (const [sectionKey] of Object.entries(F8X_AGGREGATE_SECTIONS)) {
      if (kind === `${profile.artifactPrefix}-${sectionKey}-listing-capture`) {
        return { profileKey, profile, sectionKey, section: sectionFromKey(sectionKey) };
      }
    }
  }
  return null;
}

function normalizeBundle(bundle, bundleIndex, nowMs) {
  const scope = inferBundleScope(bundle);
  if (!scope) throw new Error(`F8X input ${bundleIndex + 1} has an unexpected listing-capture kind.`);
  const {
    profileKey, profile, sectionKey, section,
  } = scope;
  const document = bundle.capture;
  const manifest = bundle.manifest;
  const report = bundle.report;
  const generatedAt = exactTimestamp(document?.generatedAt, nowMs);
  const captureStartedAt = exactTimestamp(document?.captureStartedAt, nowMs);
  const sectionUrl = canonicalEcsUrl(document?.sectionUrl);
  const expectedSectionUrl = exactScopeUrl(profile, section);
  if (document?.schemaVersion !== 1 || document?.supplier !== 'ECS Tuning'
    || document?.accessClass !== 'public-retail' || document?.vehicle !== profile.vehicle
    || document?.section !== section.label || !generatedAt || !captureStartedAt
    || Date.parse(captureStartedAt) > Date.parse(generatedAt)
    || sectionUrl !== expectedSectionUrl || document.sectionUrl !== sectionUrl
    || !Array.isArray(document?.categories) || !Array.isArray(document?.records)
    || !document?.terminalProofs || typeof document.terminalProofs !== 'object'
    || Array.isArray(document.terminalProofs)) {
    throw new Error(`${profile.vehicle} ${section.label} listing capture does not match its exact F8X scope.`);
  }
  const manifestKind = `${profile.artifactPrefix}-${sectionKey}-capture-manifest`;
  const reportKind = `${profile.artifactPrefix}-${sectionKey}-reconciliation-report`;
  if (manifest?.schemaVersion !== 1 || manifest?.supplier !== 'ECS Tuning'
    || manifest?.accessClass !== 'public-retail' || manifest?.kind !== manifestKind
    || manifest?.captureStartedAt !== captureStartedAt || manifest?.generatedAt !== generatedAt
    || manifest?.rootUrl !== profile.rootUrl || manifest?.section?.section !== section.label
    || manifest?.section?.key !== sectionKey || manifest?.section?.href !== sectionUrl
    || manifest?.pageSize !== PAGE_SIZE || manifest?.complete !== true
    || !manifest?.categories || typeof manifest.categories !== 'object'
    || Array.isArray(manifest.categories)
    || !manifest?.terminalProofs || typeof manifest.terminalProofs !== 'object'
    || Array.isArray(manifest.terminalProofs)) {
    throw new Error(`${profile.vehicle} ${section.label} capture manifest is incomplete or outside its exact profile.`);
  }
  if (report?.schemaVersion !== 1 || report?.supplier !== 'ECS Tuning'
    || report?.accessClass !== 'public-retail' || report?.kind !== reportKind
    || report?.captureStartedAt !== captureStartedAt || report?.generatedAt !== generatedAt
    || report?.source?.rootUrl !== profile.rootUrl || report?.source?.sectionUrl !== sectionUrl
    || report?.scope?.vehicle !== profile.vehicle || report?.scope?.section !== section.label
    || report?.completeness?.complete !== true || report?.completeness?.status !== 'reconciled'
    || !Array.isArray(report?.completeness?.categoryAudit)
    || !Array.isArray(report?.completeness?.duplicatePlacements)
    || report.completeness.duplicatePlacements.length !== 0
    || !Array.isArray(report?.consistency?.identityConflicts)
    || report.consistency.identityConflicts.length !== 0
    || report?.safeguards?.publicRetailOnly !== true
    || report?.safeguards?.challengeBypassUsed !== false
    || report?.safeguards?.guessedCategoryRoutes !== false
    || report?.safeguards?.guessedPaginationRoutes !== false
    || report?.safeguards?.checkpointResumeUrlsValidated !== true
    || report?.safeguards?.nextUncheckpointPageValidated !== true
    || report?.safeguards?.liveStockClaim !== false) {
    throw new Error(`${profile.vehicle} ${section.label} reconciliation report is incomplete or outside its exact profile.`);
  }
  assertZeroObject(
    report.completeness.requiredMissing,
    `${profile.vehicle} ${section.label} reconciliation report has missing required fields.`,
  );
  const categoriesByKey = new Map();
  for (const category of document.categories) {
    const key = clean(category?.key, 300);
    if (!key || categoriesByKey.has(key)) {
      throw new Error(`${profile.vehicle} ${section.label} has a duplicate or invalid category key.`);
    }
    const reportCategory = report.completeness.categoryAudit.find((item) => item?.key === key);
    const normalized = validateCategory(
      category, document, manifest.categories[key], reportCategory, PAGE_SIZE,
      profile, section, nowMs,
    );
    categoriesByKey.set(key, normalized);
  }
  const categoryKeys = [...categoriesByKey.keys()];
  if (Object.keys(manifest.categories).sort().join('|') !== [...categoryKeys].sort().join('|')
    || report.completeness.categoryAudit.length !== categoryKeys.length
    || Object.keys(document.terminalProofs).sort().join('|') !== [...categoryKeys].sort().join('|')
    || Object.keys(manifest.terminalProofs).sort().join('|') !== [...categoryKeys].sort().join('|')
    || categoryKeys.some((key) => (
      JSON.stringify(document.terminalProofs[key])
        !== JSON.stringify(document.categories.find((category) => category.key === key)?.terminalProof)
      || JSON.stringify(manifest.terminalProofs[key])
        !== JSON.stringify(manifest.categories[key]?.terminalProof)
    ))) {
    throw new Error(`${profile.vehicle} ${section.label} category sets disagree across capture artifacts.`);
  }
  const expectedPlacements = [...categoriesByKey.values()]
    .reduce((total, category) => total + category.count, 0);
  const expectedPages = [...categoriesByKey.values()]
    .reduce((total, category) => total + category.expectedPages, 0);
  if (document.records.length !== expectedPlacements
    || report.scope.categories !== categoriesByKey.size
    || report.scope.expectedPages !== expectedPages || report.scope.capturedPages !== expectedPages
    || report.scope.expectedPlacements !== expectedPlacements
    || report.scope.capturedPlacements !== expectedPlacements
    || manifest.totals?.categories !== categoriesByKey.size
    || manifest.totals?.expectedPages !== expectedPages
    || manifest.totals?.capturedPages !== expectedPages
    || manifest.totals?.expectedPlacements !== expectedPlacements
    || manifest.totals?.capturedPlacements !== expectedPlacements
    || manifest.totals?.terminalProofs !== categoriesByKey.size
    || report.scope.terminalProofs !== categoriesByKey.size
    || report.completeness.exactCategories !== categoriesByKey.size) {
    throw new Error(`${profile.vehicle} ${section.label} totals do not reconcile exactly.`);
  }
  const placementKeys = new Set();
  const normalizedRecords = document.records.map((record, recordIndex) => {
    const category = categoriesByKey.get(clean(record?.categoryKey, 300));
    const position = Number(record?.relevancePosition);
    const sourceUrl = canonicalEcsPaginationUrl(record?.sourceUrl);
    const productUrl = canonicalProductUrl(record?.productUrl);
    const observedAt = exactTimestamp(record?.observedAt, nowMs);
    const digits = ecsDigits(record?.ecsPartNumber);
    const mpn = clean(record?.manufacturerPartNumber, 200).replace(/\u00ad/g, '');
    const mpnIdentity = normalizedMpn(mpn);
    const missing = REQUIRED_RECORD_FIELDS.filter((field) => !clean(record?.[field]));
    const expectedPage = Number.isSafeInteger(position) && position > 0
      ? Math.ceil(position / PAGE_SIZE) : null;
    const placement = category && digits ? `${category.key}|${digits}` : null;
    if (missing.length || !category || record?.category !== category.name
      || record?.section !== section.label || record?.vehicle !== profile.vehicle
      || !Number.isSafeInteger(position) || position < 1 || position > category.count
      || !sourceUrl || sourceUrl !== record.sourceUrl
      || !pageMatchesCategory(category.sourceUrl, sourceUrl, expectedPage)
      || category.pageUrls[expectedPage - 1] !== sourceUrl
      || !productUrl || !observedAt || !digits || !mpn || !mpnIdentity
      || placementKeys.has(placement)) {
      throw new Error(`${profile.vehicle} ${section.label} record ${recordIndex + 1} is invalid or unreconciled.`);
    }
    placementKeys.add(placement);
    const publicPrice = parseUsdPrice(record);
    const suppliedBrand = clean(record?.brand, 200);
    return {
      identity: digits,
      mpn,
      normalizedMpn: mpnIdentity,
      productUrl,
      title: clean(record.title, 500),
      description: clean(record?.description, 5_000),
      brand: suppliedBrand || 'Supplier brand not provided',
      brandSupplied: Boolean(suppliedBrand),
      priceAmount: publicPrice.amount,
      priceStartingAt: publicPrice.startingAt,
      availability: clean(record.availabilityText, 500),
      imageUrls: imageUrls(record),
      profileKey,
      profile,
      sectionKey,
      section,
      categoryKey: category.key,
      category: category.name,
      sourceUrl,
      observedAt,
      relevancePosition: position,
      observationKey: `${profileKey}|${sectionKey}|${category.key}|${position}`,
    };
  });
  for (const category of categoriesByKey.values()) {
    const positions = normalizedRecords.filter((record) => record.categoryKey === category.key)
      .map((record) => record.relevancePosition).sort((left, right) => left - right);
    if (positions.length !== category.count
      || positions.some((position, index) => position !== index + 1)) {
      throw new Error(`${profile.vehicle} ${section.label} ${category.name} positions are not contiguous.`);
    }
  }
  const uniqueIdentities = new Set(normalizedRecords.map((record) => record.identity)).size;
  if (report.scope.uniqueEcsProducts !== uniqueIdentities
    || report.scope.crossCategoryRepeatPlacements !== normalizedRecords.length - uniqueIdentities
    || manifest.totals?.uniqueEcsProducts !== uniqueIdentities
    || manifest.totals?.crossCategoryRepeatPlacements !== normalizedRecords.length - uniqueIdentities) {
    throw new Error(`${profile.vehicle} ${section.label} identity totals do not reconcile.`);
  }
  return {
    profileKey,
    profile,
    sectionKey,
    section,
    generatedAt,
    captureStartedAt,
    categoryCount: categoriesByKey.size,
    recordCount: normalizedRecords.length,
    records: normalizedRecords,
  };
}

function observationComparator(left, right) {
  return right.observedAt.localeCompare(left.observedAt)
    || profileIndex(left.profileKey) - profileIndex(right.profileKey)
    || sectionIndex(left.sectionKey) - sectionIndex(right.sectionKey)
    || left.categoryKey.localeCompare(right.categoryKey)
    || left.sourceUrl.localeCompare(right.sourceUrl)
    || left.relevancePosition - right.relevancePosition;
}

function sourceComparator(left, right) {
  return profileIndex(left.profileKey) - profileIndex(right.profileKey)
    || sectionIndex(left.sectionKey) - sectionIndex(right.sectionKey)
    || left.categoryKey.localeCompare(right.categoryKey)
    || left.relevancePosition - right.relevancePosition
    || left.observedAt.localeCompare(right.observedAt);
}

function localConflictReasons(records) {
  const reasons = [];
  if (unique(records.map((record) => record.normalizedMpn)).length > 1) {
    reasons.push('conflicting-manufacturer-part-number');
  }
  if (unique(records.map((record) => record.productUrl)).length > 1) {
    reasons.push('conflicting-canonical-product-url');
  }
  const pricesByDay = new Map();
  for (const record of records) {
    if (record.priceAmount === null) continue;
    const day = record.observedAt.slice(0, 10);
    if (!pricesByDay.has(day)) pricesByDay.set(day, new Set());
    pricesByDay.get(day).add(record.priceAmount);
  }
  if ([...pricesByDay.values()].some((prices) => prices.size > 1)) {
    reasons.push('conflicting-same-day-public-price');
  }
  return reasons;
}

function aliasConflictMap(groups) {
  const byMpn = new Map();
  const byUrl = new Map();
  for (const [identity, records] of groups) {
    for (const mpn of unique(records.map((record) => record.normalizedMpn))) {
      if (!byMpn.has(mpn)) byMpn.set(mpn, new Set());
      byMpn.get(mpn).add(identity);
    }
    for (const url of unique(records.map((record) => record.productUrl))) {
      if (!byUrl.has(url)) byUrl.set(url, new Set());
      byUrl.get(url).add(identity);
    }
  }
  const result = new Map([...groups.keys()].map((identity) => [identity, []]));
  for (const identities of byMpn.values()) {
    if (identities.size < 2) continue;
    for (const identity of identities) result.get(identity).push('manufacturer-part-number-shared-by-multiple-ecs-identities');
  }
  for (const identities of byUrl.values()) {
    if (identities.size < 2) continue;
    for (const identity of identities) result.get(identity).push('canonical-product-url-shared-by-multiple-ecs-identities');
  }
  return result;
}

function priceCopy(amount, observedDate, startingAt = false) {
  if (amount === 0) return {
    quoteOnly: true,
    purchaseMode: 'request-price',
    priceAmount: null,
    priceCurrency: 'USD',
    priceStartingAt: false,
    priceConflict: false,
    priceType: 'confirmation-required',
    priceIncludesShipping: false,
    priceVerifiedAt: observedDate,
    priceNote: startingAt
      ? 'The ECS listing showed a $0.00 starting value; it is not treated as a selling price. Select the exact variant and request the current price before order.'
      : 'The ECS listing showed a $0.00 value; it is not treated as a selling price. Request the current price before order.',
    priceNoteAr: startingAt
      ? 'ظهر في إدراج ECS سعر ابتدائي بقيمة 0.00 دولار؛ لا تُعامل هذه القيمة كسعر بيع. يجب اختيار النسخة الدقيقة وطلب السعر الحالي قبل الطلب.'
      : 'ظهر في إدراج ECS سعر بقيمة 0.00 دولار؛ لا تُعامل هذه القيمة كسعر بيع. يرجى طلب السعر الحالي قبل الطلب.',
  };
  if (amount === null) return {
    quoteOnly: true,
    purchaseMode: 'request-price',
    priceAmount: null,
    priceCurrency: 'USD',
    priceStartingAt: false,
    priceConflict: false,
    priceType: 'confirmation-required',
    priceIncludesShipping: false,
    priceVerifiedAt: observedDate,
    priceNote: 'No publishable public ECS USD price was captured; request the current price before order.',
    priceNoteAr: 'لم يُلتقط سعر عام قابل للنشر من ECS بالدولار الأمريكي؛ يرجى طلب السعر الحالي قبل الطلب.',
  };
  if (startingAt) return {
    quoteOnly: true,
    purchaseMode: 'variant-confirmation-required',
    priceAmount: amount,
    priceCurrency: 'USD',
    priceStartingAt: true,
    priceConflict: false,
    priceType: 'supplier-public-retail-starting-at',
    projxSellingPrice: null,
    priceIncludesShipping: false,
    priceVerifiedAt: observedDate,
    priceNote: `ECS public USD starting price observed ${observedDate}; this is not a fixed unit price. The exact variant, final selling price, shipping, customs and Kuwait delivery require confirmation before order.`,
    priceNoteAr: `سعر ابتدائي عام من ECS بالدولار الأمريكي كما ظهر بتاريخ ${observedDate}؛ هذه القيمة ليست سعراً ثابتاً للوحدة. يجب تأكيد النسخة الدقيقة وسعر البيع النهائي والشحن والجمارك والتوصيل في الكويت قبل الطلب.`,
  };
  return {
    quoteOnly: false,
    purchaseMode: 'fitment-confirmation-required',
    priceAmount: amount,
    priceCurrency: 'USD',
    priceStartingAt: false,
    priceConflict: false,
    priceType: 'supplier-public-retail',
    projxSellingPrice: null,
    priceIncludesShipping: false,
    priceVerifiedAt: observedDate,
    priceNote: `ECS public USD retail price observed ${observedDate}; shipping, customs and Kuwait delivery are excluded and the current price must be confirmed before sale.`,
    priceNoteAr: `سعر التجزئة العام من ECS بالدولار الأمريكي كما ظهر بتاريخ ${observedDate}؛ لا يشمل الشحن أو الجمارك أو التوصيل في الكويت ويجب تأكيد السعر الحالي قبل البيع.`,
  };
}

function availabilityCopy(record) {
  return {
    status: 'Supplier status — confirmation required',
    statusAr: 'حالة المورد — يلزم التأكيد',
    checkedAt: record.observedAt.slice(0, 10),
    stockObservedAt: record.observedAt.slice(0, 10),
    staleAfterDays: 7,
    stockPolicy: 'manual-confirm',
    availabilityCode: 'check_availability',
    observedAvailability: record.availability || null,
    observedAvailabilityAr: record.availability
      ? `حالة المورد كما ظهرت باللغة الإنجليزية: ${record.availability}` : null,
    availabilityNote: 'Availability confirmation required. This dated public listing observation is not a live stock promise.',
    availabilityNoteAr: 'يلزم تأكيد التوفر. ملاحظة الإدراج العام المؤرخة لا تمثل وعداً مباشراً بالمخزون.',
  };
}

function fitmentForProfile(profile) {
  return {
    make: 'BMW',
    model: profile.model,
    models: [profile.model],
    trim: null,
    generation: profile.generation,
    chassis: [profile.chassis],
    yearFrom: null,
    yearTo: null,
    engines: [profile.engine],
    drivetrains: [],
    confidence: 'possible',
    evidence: 'ecs-exact-f8x-vehicle-category',
    note: `Listed by ECS under the ${profile.vehicle} vehicle profile. This establishes only possible ${profile.generation}/${profile.engine} category fitment; model year, trim, drivetrain and options remain unverified and must be confirmed before order.`,
    noteAr: `أدرجت ECS القطعة ضمن ملف المركبة ${profile.vehicle}. يثبت ذلك ملاءمة محتملة فقط لفئة ${profile.generation}/${profile.engine}؛ سنة الصنع والفئة ونظام الدفع والخيارات غير مؤكدة ويجب التحقق منها قبل الطلب.`,
  };
}

function f8xSectionSlug(sectionKey) {
  return `bmw-f8x-${sectionKey}`;
}

function f8xDeepCategorySlug(sectionKey, category) {
  return `${f8xSectionSlug(sectionKey)}-${slugify(category)}`;
}

function buildProduct(identity, records) {
  const sorted = [...records].sort(observationComparator);
  const observations = [...records].sort(sourceComparator);
  const current = sorted[0];
  const withPrice = sorted.find((record) => record.priceAmount !== null) || null;
  const selectedPriceDay = withPrice?.observedAt.slice(0, 10) || null;
  const startingAt = Boolean(withPrice && observations.some((record) => (
    record.priceStartingAt && record.priceAmount === withPrice.priceAmount
      && record.observedAt.slice(0, 10) === selectedPriceDay
  )));
  const observedDate = (withPrice || current).observedAt.slice(0, 10);
  const profiles = PROFILE_ORDER.filter((profileKey) => observations
    .some((record) => record.profileKey === profileKey)).map(profileFromKey);
  const models = unique(profiles.map((profile) => profile.model));
  const chassis = unique(profiles.map((profile) => profile.chassis));
  const sections = SECTION_ORDER.filter((sectionKey) => observations
    .some((record) => record.sectionKey === sectionKey));
  const images = unique(observations.flatMap((record) => record.imageUrls)).sort();
  const description = sorted.find((record) => record.description)?.description || '';
  const sectionSlugs = sections.map(f8xSectionSlug);
  const subcategorySlugs = unique(observations.map((record) => (
    f8xDeepCategorySlug(record.sectionKey, record.category)
  )));
  const primaryCategorySlug = f8xDeepCategorySlug(current.sectionKey, current.category);
  const ranks = observations.map((record) => record.relevancePosition).filter(Number.isFinite);
  const fitments = profiles.map(fitmentForProfile);
  return {
    catalogType: 'product',
    provider: 'ECS Tuning',
    providerSlug: 'ecs',
    dataOrigin: 'authorized-public-ecs-f8x-vehicle-category-review',
    dataOrigins: ['authorized-public-ecs-f8x-vehicle-category-review'],
    catalogueStatus: 'reviewed-partial',
    ...priceCopy(withPrice?.priceAmount ?? null, observedDate, startingAt),
    slug: `es-${identity}`,
    publicKey: `ecs-es-${identity}`,
    title: current.title,
    titleAr: current.title,
    summary: description || 'Supplier description unavailable; confirm product details before order.',
    summaryAr: description ? `وصف المورد باللغة الإنجليزية: ${description}`
      : 'وصف المورد غير متوفر؛ يجب تأكيد تفاصيل المنتج قبل الطلب.',
    description: description || 'Supplier description unavailable; confirm product details before order.',
    descriptionAr: description ? `وصف المورد باللغة الإنجليزية: ${description}`
      : 'وصف المورد غير متوفر؛ يجب تأكيد تفاصيل المنتج قبل الطلب.',
    detailedDescriptionAvailable: Boolean(description),
    brand: current.brand,
    brandSlug: slugify(current.brand),
    brandSupplied: current.brandSupplied,
    section: current.section.label,
    sectionAr: current.section.labelAr,
    sectionSlug: f8xSectionSlug(current.sectionKey),
    category: `${current.section.label} Parts`,
    categoryAr: `قطع ${current.section.labelAr} — BMW F8X`,
    categorySlug: f8xSectionSlug(current.sectionKey),
    subcategory: current.category,
    subcategoryAr: current.category,
    subcategorySlug: primaryCategorySlug,
    categoryMemberships: observations.map((record) => ({
      vehicleKey: record.profileKey,
      vehicle: record.profile.vehicle,
      section: record.section.label,
      sectionAr: record.section.labelAr,
      sectionSlug: f8xSectionSlug(record.sectionKey),
      category: record.category,
      categoryKey: record.categoryKey,
      categorySlug: f8xDeepCategorySlug(record.sectionKey, record.category),
      sourceUrl: record.sourceUrl,
      observedAt: record.observedAt,
    })),
    sku: `ES#${identity}`,
    ecsPartNumber: `ES#${identity}`,
    mpn: current.mpn,
    identifiers: { ecs: `ES#${identity}`, sku: `ES#${identity}`, mpn: current.mpn },
    ...availabilityCopy(current),
    originalUrl: current.productUrl,
    imageSourceUrl: images[0] || null,
    imageStatus: images.length ? 'supplier-media-verified' : 'supplier-media-unavailable',
    images: images.map((src) => ({
      src,
      sourceUrl: src,
      alt: `ES#${identity} - ${current.mpn} - ${current.title} - ${current.brand}`,
      altAr: current.title,
    })),
    fitmentStatus: 'supplier-vehicle-category-confirm',
    fitmentConfidence: 'possible',
    fitments,
    filters: {
      supplier: ['ecs'],
      makes: ['BMW'],
      models,
      chassis,
      years: [],
      engines: ['S55'],
      drivetrains: [],
      brands: [slugify(current.brand)],
      categories: unique(['bmw-f8x', ...profiles.map((profile) => profile.vehicleKey), ...sectionSlugs]),
      subcategories: subcategorySlugs,
      availability: ['confirmation-required'],
      fitment: ['possible'],
    },
    specifications: [],
    options: [],
    variants: [],
    selectionEvidence: 'ecs-exact-f8x-vehicle-category-observation',
    ...(ranks.length ? { selectionRank: Math.min(...ranks) } : {}),
    selectionNote: `Listed in exact ECS F8X vehicle profiles and ${sections.map((key) => F8X_AGGREGATE_SECTIONS[key].label).join(', ')} categories. Category presence is possible fitment, not exact variant fitment or a unit-sales ranking.`,
    selectionNoteAr: 'مدرج ضمن ملفات مركبات F8X المحددة وفئات ECS. وجود القطعة في الفئة يدل على ملاءمة محتملة فقط ولا يثبت ملاءمة النسخة الدقيقة ولا يمثل ترتيباً حسب المبيعات.',
    selectionSources: observations.map((record) => ({
      vehicleKey: record.profileKey,
      vehicle: record.profile.vehicle,
      section: record.section.label,
      category: record.category,
      categoryKey: record.categoryKey,
      sourceUrl: record.sourceUrl,
      relevancePosition: record.relevancePosition,
      observedAt: record.observedAt,
    })),
    sourceObservations: observations.map((record) => ({
      vehicleKey: record.profileKey,
      vehicle: record.profile.vehicle,
      section: record.section.label,
      category: record.category,
      categoryKey: record.categoryKey,
      sourceUrl: record.sourceUrl,
      observedAt: record.observedAt,
      availability: record.availability || null,
      publicUsdPrice: record.priceAmount,
      priceStartingAt: record.priceStartingAt,
    })),
    installation: {
      status: 'confirmation-required',
      note: 'Professional fitment review is required before order.',
    },
    shipping: {
      status: 'quote-required',
      origin: 'United States',
      note: 'Shipping to Kuwait, customs and local delivery are confirmed separately before order.',
    },
    seo: {
      pageTitle: `${current.title} | Projx Racing`,
      metaDescription: description || `ECS ES#${identity} for BMW F8X; price, availability and fitment require confirmation.`,
      path: `/parts/es-${identity}/`,
    },
    relatedProductSlugs: [],
  };
}

function placementIdentityTuples(scope) {
  return scope.records.map(record => ([
    scope.profile.vehicle,
    scope.section.label,
    record.categoryKey,
    Math.ceil(record.relevancePosition / PAGE_SIZE),
    record.relevancePosition,
    `ES#${record.identity}`,
  ])).sort((left, right) => (
    left[2].localeCompare(right[2], 'en')
      || left[3] - right[3]
      || left[4] - right[4]
      || left[5].localeCompare(right[5], 'en', { numeric: true })
  ));
}

function placementIdentitySha256(tuples) {
  return createHash('sha256').update(JSON.stringify(tuples), 'utf8').digest('hex');
}

function placementIdentityEvidence(scopes) {
  const scopeEntries = scopes.map(scope => {
    const tuples = placementIdentityTuples(scope);
    return [`${scope.profileKey}|${scope.sectionKey}`, {
      observationCount: tuples.length,
      placementsSha256: placementIdentitySha256(tuples),
    }, tuples];
  });
  const tuples = scopeEntries.flatMap(([, , values]) => values);
  return {
    schemaVersion: 1,
    kind: 'ecs-f8x-capture-placement-identity-binding',
    tupleContract: PLACEMENT_IDENTITY_TUPLE_CONTRACT,
    scopeCount: scopeEntries.length,
    observationCount: tuples.length,
    placementsSha256: placementIdentitySha256(tuples),
    scopes: Object.fromEntries(scopeEntries.map(([key, evidence]) => [key, evidence])),
  };
}

function scopeAudit(scopes, products) {
  return scopes.map((scope) => {
    const placementTuples = placementIdentityTuples(scope);
    return {
    vehicleKey: scope.profileKey,
    vehicle: scope.profile.vehicle,
    rootUrl: scope.profile.rootUrl,
    sectionKey: scope.sectionKey,
    section: scope.section.label,
    captureKind: `${scope.profile.artifactPrefix}-${scope.sectionKey}-listing-capture`,
    generatedAt: scope.generatedAt,
    categoryCount: scope.categoryCount,
    observationCount: scope.recordCount,
    placementIdentityCount: placementTuples.length,
    placementIdentitySha256: placementIdentitySha256(placementTuples),
    productCount: products.filter((product) => product.selectionSources.some((source) => (
      source.vehicleKey === scope.profileKey && source.section === scope.section.label
    ))).length,
    complete: true,
    reconciled: true,
    };
  });
}

export function prepareF8xAggregateBundles(bundles, options = {}) {
  if (!Array.isArray(bundles) || bundles.length !== expectedScopeKeys().length) {
    throw new Error(`F8X aggregate requires exactly ${expectedScopeKeys().length} reconciled capture bundles.`);
  }
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const scopes = bundles.map((bundle, index) => normalizeBundle(bundle, index, nowMs));
  const byScope = new Map();
  for (const scope of scopes) {
    const key = scopeKey(scope.profileKey, scope.sectionKey);
    if (byScope.has(key)) throw new Error(`F8X aggregate repeats scope ${key}.`);
    byScope.set(key, scope);
  }
  const missing = expectedScopeKeys().filter((key) => !byScope.has(key));
  if (missing.length) throw new Error(`F8X aggregate capture set is incomplete; missing: ${missing.join(', ')}.`);
  const orderedScopes = expectedScopeKeys().map((key) => byScope.get(key));
  const records = orderedScopes.flatMap((scope) => scope.records);
  const groups = new Map();
  for (const record of records) {
    if (!groups.has(record.identity)) groups.set(record.identity, []);
    groups.get(record.identity).push(record);
  }
  const aliasConflicts = aliasConflictMap(groups);
  const products = [];
  const quarantine = [];
  const orderedGroups = [...groups.entries()].sort(([left], [right]) => (
    left.localeCompare(right, 'en', { numeric: true })
  ));
  for (const [identity, identityRecords] of orderedGroups) {
    const reasons = unique([
      ...localConflictReasons(identityRecords),
      ...(aliasConflicts.get(identity) || []),
    ]).sort();
    if (reasons.length) {
      quarantine.push({
        ecsPartNumber: `ES#${identity}`,
        reasons,
        manufacturerPartNumbers: unique(identityRecords.map((record) => record.mpn)).sort(),
        productUrls: unique(identityRecords.map((record) => record.productUrl)).sort(),
        observations: identityRecords.slice().sort(sourceComparator)
          .map((record) => record.observationKey),
        vehicles: unique(identityRecords.map((record) => record.profile.vehicle)).sort(),
        sections: unique(identityRecords.map((record) => record.section.label)).sort(),
        categories: unique(identityRecords.map((record) => record.category)).sort(),
      });
    } else {
      products.push(buildProduct(identity, identityRecords));
    }
  }
  const generatedAt = orderedScopes.map((scope) => scope.generatedAt).sort().at(-1);
  const captures = scopeAudit(orderedScopes, products);
  const placementEvidence = placementIdentityEvidence(orderedScopes);
  const audit = {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    kind: 'ecs-f8x-aggregate-import-audit',
    generatedAt,
    sourceKind: 'ecs-f8x-21-scope-reconciled-capture-set',
    expectedCaptureCount: expectedScopeKeys().length,
    inputCaptureCount: bundles.length,
    completeCaptureCount: captures.filter((capture) => capture.complete && capture.reconciled).length,
    rawObservationCount: records.length,
    uniqueObservedEcsIdentityCount: groups.size,
    duplicateObservationCount: records.length - groups.size,
    productCount: products.length,
    quarantinedIdentityCount: quarantine.length,
    quarantinedObservationCount: quarantine.reduce((total, item) => total + item.observations.length, 0),
    publicUsdPriceProductCount: products.filter((product) => product.priceAmount !== null).length,
    requestPriceProductCount: products.filter((product) => product.priceAmount === null).length,
    startingPriceProductCount: products.filter((product) => product.priceStartingAt).length,
    zeroPriceRequestProductCount: products.filter((product) => product.priceAmount === null
      && product.sourceObservations.some((observation) => observation.publicUsdPrice === 0)).length,
    possibleFitmentProductCount: products.filter((product) => product.fitmentConfidence === 'possible').length,
    exactFitmentProductCount: products.filter((product) => product.fitments
      .some((fitment) => fitment.confidence === 'exact')).length,
    placementIdentityEvidence: placementEvidence,
    captures,
    quarantine,
  };
  return {
    products,
    quarantinedEcsIdentities: quarantine.map((item) => item.ecsPartNumber.replace(/^ES#/, '')),
    audit,
  };
}

export function renderF8xAggregateModule(result) {
  const quarantine = JSON.stringify(result.quarantinedEcsIdentities, null, 2);
  const products = JSON.stringify(result.products, null, 2);
  return '// Generated offline from exactly 21 complete, reconciled ECS F80/F82/F83 vehicle-section captures.\n'
    + `export const F8X_AGGREGATE_QUARANTINED_ECS_IDENTITIES = Object.freeze(${quarantine});\n`
    + `export const F8X_AGGREGATE_PRODUCTS = Object.freeze(${products});\n`;
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isSamePath(left, right) {
  return path.relative(left, right) === '' && path.relative(right, left) === '';
}

function outputFilename(value, expectedExtension) {
  const filename = clean(value, 200);
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(filename) || path.extname(filename) !== expectedExtension) {
    throw new Error(`F8X output name must be one safe ${expectedExtension} filename.`);
  }
  return filename;
}

export async function resolveF8xOutputPlan({
  workDir,
  outputName = 'f8x-aggregate-products.mjs',
  reportName = 'f8x-aggregate-audit.json',
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
} = {}) {
  if (!clean(workDir, 2_000)) throw new Error('F8X aggregate requires --work-dir.');
  const repository = await realpath(path.resolve(repositoryRoot));
  const explicitlyExternal = path.isAbsolute(workDir);
  const requestedWork = explicitlyExternal
    ? path.resolve(workDir) : path.resolve(repository, workDir);
  const requestedInsideRepository = isWithin(repository, requestedWork);
  if (!explicitlyExternal && !requestedInsideRepository) {
    throw new Error('External F8X work directories must be explicit absolute existing paths.');
  }
  const work = await realpath(requestedWork);
  if (work === path.parse(work).root) throw new Error('F8X aggregate work directory cannot be a filesystem root.');
  const resolvedInsideRepository = isWithin(repository, work);
  if (requestedInsideRepository || resolvedInsideRepository) {
    const expectedPrivateRoot = path.join(repository, 'private-imports');
    if (!requestedInsideRepository || !resolvedInsideRepository
      || !isWithin(expectedPrivateRoot, requestedWork)) {
      throw new Error('Repository-local F8X output must resolve within canonical private-imports.');
    }
    const privateRoot = await realpath(expectedPrivateRoot);
    if (!isSamePath(privateRoot, expectedPrivateRoot) || !isWithin(privateRoot, work)) {
      throw new Error('Repository-local F8X output must resolve within canonical private-imports.');
    }
  }
  const output = path.join(work, outputFilename(outputName, '.mjs'));
  const report = path.join(work, outputFilename(reportName, '.json'));
  if (output === report) throw new Error('F8X module and audit output paths must differ.');
  return { repositoryRoot: repository, workDir: work, output, report };
}

export async function writeCreateOnly(filename, value) {
  let handle;
  try {
    handle = await open(filename, 'wx');
    await handle.writeFile(value, 'utf8');
    await handle.sync();
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(`Refusing to overwrite existing private F8X output: ${filename}`);
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

function siblingArtifactPath(recordsPath, suffix) {
  const basename = path.basename(recordsPath);
  if (!/^bmw-f(?:80-m3|82-m4|83-m4)-(?:braking|engine|exterior|interior|suspension|steering|performance)-records\.json$/i.test(basename)) {
    throw new Error(`Unexpected F8X records filename: ${basename}`);
  }
  return path.join(path.dirname(recordsPath), basename.replace(/-records\.json$/i, suffix));
}

export async function loadF8xCaptureBundles(inputPaths) {
  if (!Array.isArray(inputPaths) || inputPaths.length !== expectedScopeKeys().length) {
    throw new Error(`Exactly ${expectedScopeKeys().length} --input records files are required.`);
  }
  return Promise.all(inputPaths.map(async (input) => {
    const capturePath = path.resolve(input);
    const manifestPath = siblingArtifactPath(capturePath, '-manifest.json');
    const reportPath = siblingArtifactPath(capturePath, '-reconciliation-report.json');
    const [capture, manifest, report] = await Promise.all([
      readFile(capturePath, 'utf8'),
      readFile(manifestPath, 'utf8'),
      readFile(reportPath, 'utf8'),
    ]);
    return {
      capture: JSON.parse(capture),
      manifest: JSON.parse(manifest),
      report: JSON.parse(report),
    };
  }));
}

function optionValues(name) {
  return process.argv.flatMap((value, index) => (
    value === name ? [process.argv[index + 1]] : []
  )).filter(Boolean);
}

async function main() {
  const inputs = optionValues('--input');
  const [workDir] = optionValues('--work-dir');
  const [outputName = 'f8x-aggregate-products.mjs'] = optionValues('--output-name');
  const [reportName = 'f8x-aggregate-audit.json'] = optionValues('--report-name');
  if (inputs.length !== expectedScopeKeys().length || !workDir) {
    throw new Error('Usage: prepare-f8x-aggregate.mjs --input <records.json> (repeat exactly 21 times) --work-dir <private-imports directory or safe external directory> [--output-name <products.mjs>] [--report-name <audit.json>]');
  }
  const plan = await resolveF8xOutputPlan({ workDir, outputName, reportName });
  await Promise.all([plan.output, plan.report].map(async (filename) => {
    try {
      await access(filename);
      throw new Error(`Refusing to overwrite existing private F8X output: ${filename}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }));
  const bundles = await loadF8xCaptureBundles(inputs);
  const result = prepareF8xAggregateBundles(bundles);
  await writeCreateOnly(plan.output, renderF8xAggregateModule(result));
  await writeCreateOnly(plan.report, `${JSON.stringify(result.audit, null, 2)}\n`);
  console.log(JSON.stringify({
    captures: result.audit.inputCaptureCount,
    observations: result.audit.rawObservationCount,
    products: result.products.length,
    quarantinedIdentities: result.quarantinedEcsIdentities.length,
    output: plan.output,
    report: plan.report,
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
