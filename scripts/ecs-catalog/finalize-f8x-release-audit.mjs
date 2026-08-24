import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, lstat, open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepareF8xAggregateBundles } from './prepare-f8x-aggregate.mjs';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const PRIVATE_IMPORTS = path.join(REPO, 'private-imports');
const TRUSTED_CURRENT_REVIEWED_MODULE = path.join(REPO, 'server', 'ecs-reviewed-catalog.js');
const TRUSTED_NODE_IMPORTS = Object.freeze({
  [path.join(REPO, 'server', 'ecs-confirmation-cart-index.js')]: Object.freeze(new Set(['node:fs', 'node:url'])),
  [path.join(REPO, 'server', 'ecs-confirmation-cart-sellability.js')]: Object.freeze(new Set(['node:crypto'])),
});
const SHA256 = /^[a-f0-9]{64}$/;
const ECS_IDENTITY = /^(?:ES\s*#?\s*)?(\d{3,12})$/i;
const RELEASE_ID = /^\d{8}T\d{9}Z-[a-f0-9]{16}$/;
const SHARD_FILE = /^shard-\d{5}\.json$/;
const PAGE_SIZE = 16;
const PLACEMENT_IDENTITY_TUPLE_CONTRACT = '[vehicle,section,categoryKey,page,position,ecsPartNumber]';
const MODULE_HEADER = '// Generated offline from exactly 21 complete, reconciled ECS F80/F82/F83 vehicle-section captures.\n';
const PRIOR_MODULE_HEADER = '// Generated offline from a validated, dated ECS BMW M3 model-level category capture.\n';
const PRIOR_QUARANTINE_EXPORT = 'BMW_M3_AGGREGATE_QUARANTINED_ECS_IDENTITIES';
const PRIOR_PRODUCTS_EXPORT = 'BMW_M3_AGGREGATE_PRODUCTS';
const PRIOR_QUARANTINE_KIND = 'ecs-reviewed-prior-quarantine';
const VERIFIED_CAPTURE_BUNDLE_BINDINGS = new WeakSet();
const MODULE_EXPORT_CONTRACTS = Object.freeze([
  Object.freeze({ quarantine: 'BMW_F8X_AGGREGATE_QUARANTINED_ECS_IDENTITIES', products: 'BMW_F8X_AGGREGATE_PRODUCTS' }),
  Object.freeze({ quarantine: 'F8X_AGGREGATE_QUARANTINED_ECS_IDENTITIES', products: 'F8X_AGGREGATE_PRODUCTS' }),
]);

export const F8X_FINAL_SECTIONS = Object.freeze({
  braking: Object.freeze({ label: 'Braking', path: 'Braking' }),
  engine: Object.freeze({ label: 'Engine', path: 'Engine' }),
  exterior: Object.freeze({ label: 'Exterior', path: 'Exterior' }),
  interior: Object.freeze({ label: 'Interior', path: 'Interior' }),
  performance: Object.freeze({ label: 'Performance', path: 'Performance' }),
  suspension: Object.freeze({ label: 'Suspension', path: 'Suspension' }),
  steering: Object.freeze({ label: 'Steering', path: 'Steering' }),
});
export const F8X_FINAL_PROFILES = Object.freeze({
  'f80-m3': Object.freeze({
    artifactPrefix: 'bmw-f80-m3', vehicle: 'BMW F80 M3 S55 3.0L',
    rootUrl: 'https://www.ecstuning.com/BMW-F80-M3-S55_3.0L/', model: 'M3', chassis: 'F80',
  }),
  'f82-m4': Object.freeze({
    artifactPrefix: 'bmw-f82-m4', vehicle: 'BMW F82 M4 S55 3.0L',
    rootUrl: 'https://www.ecstuning.com/BMW-F82-M4-S55_3.0L/', model: 'M4', chassis: 'F82',
  }),
  'f83-m4': Object.freeze({
    artifactPrefix: 'bmw-f83-m4', vehicle: 'BMW F83 M4 S55 3.0L',
    rootUrl: 'https://www.ecstuning.com/BMW-F83-M4-S55_3.0L/', model: 'M4', chassis: 'F83',
  }),
});
const PROFILE_KEYS = Object.freeze(Object.keys(F8X_FINAL_PROFILES));
const SECTION_KEYS = Object.freeze(Object.keys(F8X_FINAL_SECTIONS));
const NORMALIZER_SECTION_KEYS = Object.freeze([
  'braking', 'engine', 'exterior', 'interior', 'suspension', 'steering', 'performance',
]);
const EXPECTED_SCOPE_KEYS = Object.freeze(PROFILE_KEYS.flatMap(profileKey => (
  NORMALIZER_SECTION_KEYS.map(sectionKey => `${profileKey}|${sectionKey}`)
)));

export class F8xFinalReleaseAuditError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'F8xFinalReleaseAuditError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new F8xFinalReleaseAuditError(code, message);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function safeInteger(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function exactTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? value : null;
}

function stableJson(value) {
  const seen = new Set();
  function normalize(item) {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) fail('invalid_input_data', 'Release inputs may not contain non-finite numbers.');
      return item;
    }
    if (Array.isArray(item)) return item.map(entry => normalize(entry === undefined ? null : entry));
    if (plainObject(item)) {
      if (seen.has(item)) fail('invalid_input_data', 'Release inputs may not contain circular values.');
      seen.add(item);
      const result = {};
      for (const key of Object.keys(item).sort()) {
        const entry = item[key];
        if (entry !== undefined && typeof entry !== 'function' && typeof entry !== 'symbol') result[key] = normalize(entry);
      }
      seen.delete(item);
      return result;
    }
    fail('invalid_input_data', 'Release inputs must contain JSON-compatible values only.');
  }
  return JSON.stringify(normalize(value));
}

function dataSha256(value) {
  return sha256(Buffer.from(stableJson(value), 'utf8'));
}

function exactKeys(value, expected) {
  if (!plainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function balancedJsonArray(source, offset, label) {
  if (source[offset] !== '[') fail('invalid_aggregate_module_format', `${label} must be an inline JSON array.`);
  let depth = 0;
  let string = false;
  let escaped = false;
  for (let index = offset; index < source.length; index += 1) {
    const character = source[index];
    if (string) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') string = false;
      continue;
    }
    if (character === '"') string = true;
    else if (character === '[') depth += 1;
    else if (character === ']') {
      depth -= 1;
      if (depth === 0) {
        try {
          const value = JSON.parse(source.slice(offset, index + 1));
          if (!Array.isArray(value)) throw new Error();
          return { value, cursor: index + 1 };
        } catch {
          fail('invalid_aggregate_module_format', `${label} is not valid JSON.`);
        }
      }
    }
  }
  fail('invalid_aggregate_module_format', `${label} is unterminated.`);
}

function renderAggregateModule(products, quarantine, contract) {
  return MODULE_HEADER
    + `export const ${contract.quarantine} = Object.freeze(${JSON.stringify(quarantine, null, 2)});\n`
    + `export const ${contract.products} = Object.freeze(${JSON.stringify(products, null, 2)});\n`;
}

export function parseExactF8xAggregateModule(source) {
  if (typeof source !== 'string' || !source.startsWith(MODULE_HEADER)) {
    fail('invalid_aggregate_module_format', 'The F8X aggregate module header is invalid.');
  }
  for (const contract of MODULE_EXPORT_CONTRACTS) {
    const quarantinePrefix = `export const ${contract.quarantine} = Object.freeze(`;
    const productsPrefix = `export const ${contract.products} = Object.freeze(`;
    let cursor = MODULE_HEADER.length;
    if (!source.startsWith(quarantinePrefix, cursor)) continue;
    cursor += quarantinePrefix.length;
    const quarantine = balancedJsonArray(source, cursor, 'The F8X quarantine export');
    cursor = quarantine.cursor;
    if (!source.startsWith(');\n', cursor)) continue;
    cursor += 3;
    if (!source.startsWith(productsPrefix, cursor)) continue;
    cursor += productsPrefix.length;
    const products = balancedJsonArray(source, cursor, 'The F8X product export');
    cursor = products.cursor;
    if (!source.startsWith(');\n', cursor) || cursor + 3 !== source.length) continue;
    if (source !== renderAggregateModule(products.value, quarantine.value, contract)) continue;
    return { products: products.value, quarantine: quarantine.value, contract };
  }
  fail('invalid_aggregate_module_format', 'The F8X aggregate exports are missing, mixed, executable or non-canonical.');
}

function renderPriorReviewedAggregateModule(products, quarantine) {
  return PRIOR_MODULE_HEADER
    + `export const ${PRIOR_QUARANTINE_EXPORT} = Object.freeze(${JSON.stringify(quarantine, null, 2)});\n`
    + `export const ${PRIOR_PRODUCTS_EXPORT} = Object.freeze(${JSON.stringify(products, null, 2)});\n`;
}

export function parseExactPriorReviewedAggregateModule(source) {
  if (typeof source !== 'string' || !source.startsWith(PRIOR_MODULE_HEADER)) {
    fail('invalid_prior_aggregate_module_format', 'The prior reviewed aggregate module header is invalid.');
  }
  const quarantinePrefix = `export const ${PRIOR_QUARANTINE_EXPORT} = Object.freeze(`;
  const productsPrefix = `export const ${PRIOR_PRODUCTS_EXPORT} = Object.freeze(`;
  let cursor = PRIOR_MODULE_HEADER.length;
  if (!source.startsWith(quarantinePrefix, cursor)) {
    fail('invalid_prior_aggregate_module_format', 'The prior reviewed quarantine export is missing.');
  }
  cursor += quarantinePrefix.length;
  const quarantine = balancedJsonArray(source, cursor, 'The prior reviewed quarantine export');
  cursor = quarantine.cursor;
  if (!source.startsWith(');\n', cursor)) {
    fail('invalid_prior_aggregate_module_format', 'The prior reviewed quarantine export is non-canonical.');
  }
  cursor += 3;
  if (!source.startsWith(productsPrefix, cursor)) {
    fail('invalid_prior_aggregate_module_format', 'The prior reviewed product export is missing.');
  }
  cursor += productsPrefix.length;
  const products = balancedJsonArray(source, cursor, 'The prior reviewed product export');
  cursor = products.cursor;
  if (!source.startsWith(');\n', cursor) || cursor + 3 !== source.length
    || source !== renderPriorReviewedAggregateModule(products.value, quarantine.value)) {
    fail('invalid_prior_aggregate_module_format', 'The prior reviewed aggregate module has executable or non-canonical content.');
  }
  return { products: products.value, quarantine: quarantine.value };
}

function ecsIdentity(product) {
  for (const value of [product?.ecsPartNumber, product?.identifiers?.ecs, product?.sku]) {
    const match = String(value ?? '').trim().match(ECS_IDENTITY);
    if (match) return match[1];
  }
  return String(product?.publicKey ?? '').trim().match(/^ecs-es-(\d{3,12})$/i)?.[1] || null;
}

function uniqueProducts(products, label, { canonicalHandles = false } = {}) {
  if (!Array.isArray(products)) fail('invalid_product_input', `${label} must be an array.`);
  const identities = new Set();
  const handles = new Set();
  for (const [index, product] of products.entries()) {
    const identity = plainObject(product) ? ecsIdentity(product) : null;
    if (!identity) fail('invalid_product_identity', `${label} product ${index + 1} has no canonical ECS identity.`);
    if (identities.has(identity)) fail('duplicate_product_identity', `${label} repeats ES#${identity}.`);
    identities.add(identity);
    if (canonicalHandles) {
      const identityFields = [product.ecsPartNumber, product.identifiers?.ecs, product.sku]
        .filter(value => value !== null && value !== undefined && String(value).trim() !== '');
      if (!identityFields.length || identityFields.some(value => String(value).trim().match(ECS_IDENTITY)?.[1] !== identity)) {
        fail('invalid_product_identity', `${label} ES#${identity} has inconsistent ECS identity fields.`);
      }
      if (product.publicKey !== `ecs-es-${identity}` || product.slug !== `es-${identity}`) {
        fail('invalid_product_handle', `${label} ES#${identity} has a non-canonical public handle.`);
      }
      for (const handle of [product.publicKey, product.slug]) {
        if (handles.has(handle)) fail('duplicate_product_handle', `${label} repeats public handle ${handle}.`);
        handles.add(handle);
      }
    }
  }
  return identities;
}

function scopeFromReport(report) {
  for (const [profileKey, profile] of Object.entries(F8X_FINAL_PROFILES)) {
    for (const [sectionKey] of Object.entries(F8X_FINAL_SECTIONS)) {
      if (report?.kind === `${profile.artifactPrefix}-${sectionKey}-reconciliation-report`) {
        return { profileKey, profile, sectionKey, section: F8X_FINAL_SECTIONS[sectionKey] };
      }
    }
  }
  return null;
}

function canonicalUrl(value, {
  allowBareFragment = false,
  trailingSlash = true,
} = {}) {
  try {
    const source = String(value ?? '');
    const url = new URL(source);
    const fragmentIndex = source.indexOf('#');
    const bareFragment = fragmentIndex === source.length - 1;
    if (url.protocol !== 'https:' || url.hostname !== 'www.ecstuning.com' || url.username
      || url.password || url.port || source.includes('?') || url.search || url.hash
      || (fragmentIndex !== -1 && !(allowBareFragment && bareFragment))) return null;
    if (trailingSlash) url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
    return url.toString();
  } catch {
    return null;
  }
}

function canonicalPaginationUrl(value, { allowBareFragment = false } = {}) {
  return canonicalUrl(value, { allowBareFragment, trailingSlash: false });
}

function categoryPageNumber(sourceUrl, candidateUrl) {
  const source = canonicalUrl(sourceUrl);
  const candidate = canonicalPaginationUrl(candidateUrl);
  if (!source || !candidate) return null;
  if (candidate === source) return 1;
  const sourceValue = new URL(source);
  const candidateValue = new URL(candidate);
  if (sourceValue.origin !== candidateValue.origin
    || !candidateValue.pathname.startsWith(sourceValue.pathname)) return null;
  const relative = candidateValue.pathname.slice(sourceValue.pathname.length)
    .split('/').filter(Boolean);
  return relative.length === 1 && /^\d+$/.test(relative[0]) ? Number(relative[0]) : null;
}

function validateTerminalProof(proof, {
  captureStartedAt,
  categoryName,
  expectedCounts,
  expectedUrls,
  generatedAt,
  pages,
  profile,
  sourceUrl,
}) {
  const terminalPage = Math.max(1, pages);
  const terminalUrl = canonicalPaginationUrl(proof?.terminalUrl);
  const expectedTerminalUrl = canonicalPaginationUrl(pages ? expectedUrls.at(-1) : sourceUrl);
  const expectedRenderedCount = pages ? expectedCounts.at(-1) : 0;
  const observedLinks = proof?.observedPaginationLinks;
  const observedAt = exactTimestamp(proof?.observedAt);
  if (!exactKeys(proof, [
    'kind', 'observedAt', 'terminalPage', 'terminalUrl', 'expectedRenderedCount',
    'renderedCount', 'observedVisibleLinkCount', 'observedPaginationLinks',
    'nextPageAbsent', 'validated',
  ]) || proof.kind !== `${profile.artifactPrefix}-section-terminal-pagination-proof`
    || !observedAt || observedAt < captureStartedAt || observedAt > generatedAt
    || proof.terminalPage !== terminalPage || !terminalUrl || proof.terminalUrl !== terminalUrl
    || terminalUrl !== expectedTerminalUrl
    || categoryPageNumber(sourceUrl, terminalUrl) !== terminalPage
    || proof.expectedRenderedCount !== expectedRenderedCount
    || proof.renderedCount !== expectedRenderedCount
    || !safeInteger(proof.observedVisibleLinkCount)
    || !Array.isArray(observedLinks) || proof.observedVisibleLinkCount < observedLinks.length
    || proof.nextPageAbsent !== true || proof.validated !== true) {
    fail('invalid_f8x_terminal_proof', `${categoryName} lacks exact terminal-pagination evidence.`);
  }
  for (const link of observedLinks) {
    const rawHref = String(link?.href ?? '');
    const href = canonicalPaginationUrl(rawHref, { allowBareFragment: true });
    const bareSelfAnchor = rawHref.endsWith('#');
    const comparisonHref = bareSelfAnchor ? rawHref.slice(0, -1) : href;
    const rel = String(link?.rel ?? '').trim().toLocaleLowerCase('en-US');
    const page = comparisonHref ? categoryPageNumber(sourceUrl, comparisonHref) : null;
    const expectedPageUrl = safeInteger(page, 1, terminalPage)
      ? (page === 1 ? sourceUrl : expectedUrls[page - 1]) : null;
    if (!exactKeys(link, ['href', 'page', 'rel']) || !href || link.href !== href
      || link.rel !== rel || link.page !== page || comparisonHref !== expectedPageUrl
      || (bareSelfAnchor && (comparisonHref !== expectedTerminalUrl || page !== terminalPage))
      || !safeInteger(page, 1, terminalPage)
      || rel.split(/\s+/).filter(Boolean).includes('next')) {
      fail('invalid_f8x_terminal_proof', `${categoryName} terminal-pagination evidence is forged or exposes a next page.`);
    }
  }
}

function validateCategory(category, sectionUrl, label, profile, report) {
  const count = Number(category?.count);
  const pages = Math.ceil(count / PAGE_SIZE);
  const sourceUrl = canonicalUrl(category?.sourceUrl);
  const expectedCounts = Array.from({ length: pages }, (_, index) => Math.min(PAGE_SIZE, count - (index * PAGE_SIZE)));
  const expectedUrls = Array.from({ length: pages }, (_, index) => (
    index === 0 ? sourceUrl : `${sourceUrl}${index + 1}`
  ));
  if (typeof category?.key !== 'string' || !category.key.trim() || category.key !== category.key.trim()
    || category.key.includes('|') || !String(category?.name || '').trim()
    || !sourceUrl || !sourceUrl.startsWith(sectionUrl) || !safeInteger(count)
    || category.expectedPages !== pages || category.pages !== pages
    || stableJson(category.pageCounts) !== stableJson(expectedCounts)
    || stableJson(category.pageUrls) !== stableJson(expectedUrls)
    || category.positionsContiguous !== true || category.observedCount !== count || category.exact !== true) {
    fail('unreconciled_f8x_category', `${label} contains an incomplete category reconciliation.`);
  }
  validateTerminalProof(category.terminalProof, {
    captureStartedAt: report.captureStartedAt,
    categoryName: `${label} / ${category.name}`,
    expectedCounts,
    expectedUrls,
    generatedAt: report.generatedAt,
    pages,
    profile,
    sourceUrl,
  });
  return {
    key: String(category.key).trim(),
    name: category.name,
    sourceUrl,
    count,
    pages,
    pageUrls: expectedUrls,
  };
}

export function validateF8xReconciliationReport(report) {
  const scope = scopeFromReport(report);
  if (!scope) fail('invalid_f8x_reconciliation_report', 'An F8X reconciliation report has an unexpected scope.');
  const { profileKey, profile, sectionKey, section } = scope;
  const sectionUrl = `${profile.rootUrl}${section.path}/`;
  if (report.schemaVersion !== 1 || report.supplier !== 'ECS Tuning'
    || report.accessClass !== 'public-retail' || !exactTimestamp(report.captureStartedAt)
    || !exactTimestamp(report.generatedAt) || report.captureStartedAt > report.generatedAt
    || report.source?.rootUrl !== profile.rootUrl || report.source?.sectionUrl !== sectionUrl
    || !exactKeys(report.scope, [
      'vehicle', 'section', 'categories', 'expectedPages', 'capturedPages',
      'expectedPlacements', 'capturedPlacements', 'terminalProofs', 'uniqueEcsProducts',
      'crossCategoryRepeatPlacements',
    ]) || report.scope.vehicle !== profile.vehicle || report.scope.section !== section.label
    || report.completeness?.complete !== true || report.completeness?.status !== 'reconciled'
    || !Array.isArray(report.completeness.categoryAudit) || !report.completeness.categoryAudit.length
    || !plainObject(report.completeness.requiredMissing)
    || Object.values(report.completeness.requiredMissing).some(value => value !== 0)
    || !Array.isArray(report.completeness.duplicatePlacements)
    || report.completeness.duplicatePlacements.length
    || !Array.isArray(report.consistency?.identityConflicts) || report.consistency.identityConflicts.length
    || !exactKeys(report.safeguards, [
      'publicRetailOnly', 'challengeBypassUsed', 'guessedCategoryRoutes',
      'guessedPaginationRoutes', 'checkpointResumeUrlsValidated',
      'nextUncheckpointPageValidated', 'liveStockClaim',
    ])
    || report.safeguards?.publicRetailOnly !== true || report.safeguards?.challengeBypassUsed !== false
    || report.safeguards?.guessedCategoryRoutes !== false || report.safeguards?.guessedPaginationRoutes !== false
    || report.safeguards?.checkpointResumeUrlsValidated !== true
    || report.safeguards?.nextUncheckpointPageValidated !== true
    || report.safeguards?.liveStockClaim !== false) {
    fail('invalid_f8x_reconciliation_report', `${profile.vehicle} ${section.label} is incomplete or unsafe.`);
  }
  const categories = report.completeness.categoryAudit.map(category => (
    validateCategory(category, sectionUrl, `${profile.vehicle} ${section.label}`, profile, report)
  ));
  const categoryNames = categories.map(category => category.name);
  const categoryKeys = categories.map(category => category.key);
  const pageUrls = categories.flatMap(category => category.pageUrls);
  const capturedPages = categories.reduce((total, category) => total + category.pages, 0);
  const capturedPlacements = categories.reduce((total, category) => total + category.count, 0);
  if (new Set(categoryNames).size !== categoryNames.length
    || new Set(categoryKeys).size !== categoryKeys.length || new Set(pageUrls).size !== pageUrls.length
    || report.completeness.exactCategories !== categories.length
    || report.scope.categories !== categories.length
    || report.scope.expectedPages !== capturedPages || report.scope.capturedPages !== capturedPages
    || report.scope.expectedPlacements !== capturedPlacements
    || report.scope.capturedPlacements !== capturedPlacements
    || report.scope.terminalProofs !== categories.length
    || !safeInteger(report.scope.uniqueEcsProducts, 1)
    || report.scope.uniqueEcsProducts > capturedPlacements
    || report.scope.crossCategoryRepeatPlacements !== capturedPlacements - report.scope.uniqueEcsProducts) {
    fail('f8x_reconciliation_count_mismatch', `${profile.vehicle} ${section.label} counts do not reconcile.`);
  }
  return {
    scopeKey: `${profileKey}|${sectionKey}`, profileKey, sectionKey,
    vehicle: profile.vehicle, section: section.label,
    captureStartedAt: report.captureStartedAt, generatedAt: report.generatedAt,
    categoryCount: categories.length, categories: categoryNames.sort(),
    categoriesByKey: new Map(categories.map(category => [category.key, category])),
    capturedPages, capturedPlacements, uniqueEcsProducts: report.scope.uniqueEcsProducts,
  };
}

function sectionKeyFromLabel(value) {
  return SECTION_KEYS.find(key => F8X_FINAL_SECTIONS[key].label === value) || null;
}

function placementKey(profileKey, sectionKey, categoryKey, position) {
  return `${profileKey}|${sectionKey}|${categoryKey}|${position}`;
}

function sourceObservationTuple(value) {
  return stableJson([
    value?.vehicleKey, value?.vehicle, value?.section, value?.category,
    value?.categoryKey, value?.sourceUrl, value?.observedAt,
  ]);
}

function exactTupleMultiset(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right, 'en'));
}

function validateStructuredF8xProduct(product, summaries) {
  const sources = Array.isArray(product.selectionSources) ? product.selectionSources : [];
  const sourceScopes = new Set();
  for (const source of sources) {
    const profile = F8X_FINAL_PROFILES[source?.vehicleKey];
    const sectionKey = sectionKeyFromLabel(source?.section);
    const summary = summaries.get(`${source?.vehicleKey}|${sectionKey}`);
    const category = summary?.categoriesByKey.get(source?.categoryKey);
    const position = source?.relevancePosition;
    const observedAt = exactTimestamp(source?.observedAt);
    const expectedPage = Number.isSafeInteger(position) ? Math.ceil(position / PAGE_SIZE) : null;
    if (!exactKeys(source, [
      'vehicleKey', 'vehicle', 'section', 'category', 'categoryKey',
      'sourceUrl', 'relevancePosition', 'observedAt',
    ]) || !profile || source.vehicle !== profile.vehicle || !sectionKey || !summary || !category
      || source.category !== category.name || source.categoryKey !== category.key
      || !safeInteger(position, 1, category.count) || !observedAt
      || observedAt < summary.captureStartedAt || observedAt > summary.generatedAt
      || source.sourceUrl !== category.pageUrls[expectedPage - 1]) {
      fail('invalid_f8x_product_scope', `ES#${ecsIdentity(product)} has invalid 3×7 selection evidence.`);
    }
    sourceScopes.add(`${source.vehicleKey}|${sectionKey}`);
  }
  if (!sourceScopes.size) fail('invalid_f8x_product_scope', `ES#${ecsIdentity(product)} has no F8X selection evidence.`);
  const selectionTuples = exactTupleMultiset(sources.map(sourceObservationTuple));
  for (const [label, values] of [
    ['category memberships', product.categoryMemberships],
    ['source observations', product.sourceObservations],
  ]) {
    if (!Array.isArray(values) || stableJson(exactTupleMultiset(values.map(sourceObservationTuple)))
      !== stableJson(selectionTuples)) {
      fail('invalid_f8x_product_scope', `ES#${ecsIdentity(product)} ${label} do not exactly mirror selection evidence.`);
    }
  }
  const fitmentScopes = new Set();
  for (const fitment of Array.isArray(product.fitments) ? product.fitments : []) {
    const profileKey = PROFILE_KEYS.find(key => {
      const profile = F8X_FINAL_PROFILES[key];
      return fitment?.make === 'BMW' && fitment?.model === profile.model
        && fitment?.generation === profile.chassis
        && Array.isArray(fitment.models) && fitment.models.length === 1 && fitment.models[0] === profile.model
        && Array.isArray(fitment.chassis) && fitment.chassis.length === 1
        && fitment.chassis[0] === profile.chassis
        && Array.isArray(fitment.engines) && fitment.engines.length === 1 && fitment.engines[0] === 'S55'
        && fitment.yearFrom === null && fitment.yearTo === null
        && Array.isArray(fitment.drivetrains) && fitment.drivetrains.length === 0
        && fitment.confidence === 'possible';
    });
    if (!profileKey) fail('invalid_f8x_fitment', `ES#${ecsIdentity(product)} has non-canonical F8X fitment evidence.`);
    if (fitmentScopes.has(profileKey)) fail('invalid_f8x_fitment', `ES#${ecsIdentity(product)} repeats ${profileKey} fitment evidence.`);
    fitmentScopes.add(profileKey);
  }
  const sourceProfiles = new Set([...sourceScopes].map(value => value.split('|')[0]));
  const sourceSections = new Set([...sourceScopes].map(value => value.split('|')[1]));
  const categoryFilters = product.filters?.categories;
  const expectedCategoryFilters = [
    'bmw-f8x',
    ...sourceProfiles,
    ...[...sourceSections].map(sectionKey => `bmw-f8x-${sectionKey}`),
  ].sort();
  if (!Array.isArray(categoryFilters)
    || categoryFilters.some(value => typeof value !== 'string' || !value)
    || new Set(categoryFilters).size !== categoryFilters.length
    || stableJson([...categoryFilters].sort()) !== stableJson(expectedCategoryFilters)) {
    fail(
      'invalid_f8x_filters',
      `ES#${ecsIdentity(product)} must use the canonical bmw-f8x root and exact bmw-f8x-{section} filters.`,
    );
  }
  if (!fitmentScopes.size || stableJson([...fitmentScopes].sort()) !== stableJson([...sourceProfiles].sort())) {
    fail('invalid_f8x_fitment', `ES#${ecsIdentity(product)} fitments do not match its vehicle-scope evidence.`);
  }
  const expectedChassis = [...sourceProfiles].map(key => F8X_FINAL_PROFILES[key].chassis).sort();
  const expectedModels = [...new Set([...sourceProfiles].map(key => F8X_FINAL_PROFILES[key].model))].sort();
  if (stableJson([...(product.filters?.chassis || [])].sort()) !== stableJson(expectedChassis)
    || stableJson([...(product.filters?.models || [])].sort()) !== stableJson(expectedModels)
    || stableJson(product.filters?.engines) !== stableJson(['S55'])) {
    fail('invalid_f8x_fitment', `ES#${ecsIdentity(product)} filters do not match its structured F8X fitments.`);
  }
}

function collectedF8xObservationEntries(products, quarantine) {
  const entries = new Map();
  const add = (key, identity, status, evidence) => {
    if (!EXPECTED_SCOPE_KEYS.includes(key.split('|').slice(0, 2).join('|'))
      || !/^\d{3,12}$/.test(identity || '') || !['retained', 'quarantined'].includes(status)
      || !plainObject(evidence) || entries.has(key)) {
      fail('invalid_f8x_observation_evidence', `Duplicate or invalid F8X placement evidence: ${key}.`);
    }
    entries.set(key, { identity, status, ...evidence });
  };
  for (const product of products) {
    const identity = ecsIdentity(product);
    for (const source of Array.isArray(product?.selectionSources) ? product.selectionSources : []) {
      const sectionKey = sectionKeyFromLabel(source?.section);
      const position = source?.relevancePosition;
      const categoryKey = source?.categoryKey;
      if (!F8X_FINAL_PROFILES[source?.vehicleKey] || !sectionKey
        || typeof categoryKey !== 'string' || !categoryKey || !safeInteger(position, 1)) {
        fail('invalid_f8x_observation_evidence', `ES#${identity} has an invalid retained placement binding.`);
      }
      add(
        placementKey(source.vehicleKey, sectionKey, categoryKey, position),
        identity,
        'retained',
        {
          vehicleKey: source.vehicleKey,
          vehicle: source.vehicle,
          section: source.section,
          category: source.category,
          categoryKey,
          sourceUrl: source.sourceUrl,
          relevancePosition: position,
          observedAt: source.observedAt,
        },
      );
    }
  }
  for (const item of Array.isArray(quarantine) ? quarantine : []) {
    const identity = String(item?.ecsPartNumber ?? '').trim().match(ECS_IDENTITY)?.[1];
    if (!identity || !Array.isArray(item?.observations) || !item.observations.length) {
      fail('invalid_f8x_observation_evidence', 'A quarantined identity lacks exact placement evidence.');
    }
    for (const key of item.observations) {
      if (typeof key !== 'string' || key.split('|').length !== 4) {
        fail('invalid_f8x_observation_evidence', `ES#${identity} has a malformed quarantine placement.`);
      }
      const [profileKey, sectionKey, categoryKey, positionText] = key.split('|');
      const position = Number(positionText);
      if (!F8X_FINAL_PROFILES[profileKey] || !F8X_FINAL_SECTIONS[sectionKey]
        || !categoryKey || !/^\d+$/.test(positionText) || !safeInteger(position, 1)
        || key !== placementKey(profileKey, sectionKey, categoryKey, position)) {
        fail('invalid_f8x_observation_evidence', `ES#${identity} has a non-canonical quarantine placement.`);
      }
      add(key, identity, 'quarantined', {
        reasons: item.reasons,
        manufacturerPartNumbers: item.manufacturerPartNumbers,
        productUrls: item.productUrls,
        vehicles: item.vehicles,
        sections: item.sections,
        categories: item.categories,
      });
    }
  }
  return entries;
}

function observationEvidenceFromEntries(entries) {
  const ordered = [...entries.entries()].sort(([leftKey, left], [rightKey, right]) => {
    const leftParts = leftKey.split('|');
    const rightParts = rightKey.split('|');
    const leftScope = `${leftParts[0]}|${leftParts[1]}`;
    const rightScope = `${rightParts[0]}|${rightParts[1]}`;
    return EXPECTED_SCOPE_KEYS.indexOf(leftScope) - EXPECTED_SCOPE_KEYS.indexOf(rightScope)
      || leftParts[2].localeCompare(rightParts[2], 'en')
      || Number(leftParts[3]) - Number(rightParts[3])
      || left.identity.localeCompare(right.identity, 'en', { numeric: true });
  });
  const scopes = Object.fromEntries(EXPECTED_SCOPE_KEYS.map(scopeKey => {
    const scopeEntries = ordered.filter(([key]) => key.startsWith(`${scopeKey}|`));
    const retainedObservationCount = scopeEntries.filter(([, value]) => value.status === 'retained').length;
    return [scopeKey, {
      observationCount: scopeEntries.length,
      retainedObservationCount,
      quarantinedObservationCount: scopeEntries.length - retainedObservationCount,
      placementsSha256: dataSha256(scopeEntries),
    }];
  }));
  const retainedObservationCount = ordered.filter(([, value]) => value.status === 'retained').length;
  const placementIdentityScopes = Object.fromEntries(EXPECTED_SCOPE_KEYS.map(scopeKey => {
    const tuples = ordered.filter(([key]) => key.startsWith(`${scopeKey}|`)).map(([key, value]) => {
      const [profileKey, sectionKey, categoryKey, positionText] = key.split('|');
      const position = Number(positionText);
      return [
        F8X_FINAL_PROFILES[profileKey].vehicle,
        F8X_FINAL_SECTIONS[sectionKey].label,
        categoryKey,
        Math.ceil(position / PAGE_SIZE),
        position,
        `ES#${value.identity}`,
      ];
    });
    return [scopeKey, {
      observationCount: tuples.length,
      placementsSha256: dataSha256(tuples),
    }];
  }));
  const placementIdentityTuples = ordered.map(([key, value]) => {
    const [profileKey, sectionKey, categoryKey, positionText] = key.split('|');
    const position = Number(positionText);
    return [
      F8X_FINAL_PROFILES[profileKey].vehicle,
      F8X_FINAL_SECTIONS[sectionKey].label,
      categoryKey,
      Math.ceil(position / PAGE_SIZE),
      position,
      `ES#${value.identity}`,
    ];
  });
  return Object.freeze({
    schemaVersion: 1,
    kind: 'ecs-f8x-21-scope-observation-binding',
    scopeCount: EXPECTED_SCOPE_KEYS.length,
    observationCount: ordered.length,
    retainedObservationCount,
    quarantinedObservationCount: ordered.length - retainedObservationCount,
    placementsSha256: dataSha256(ordered),
    scopes,
    capturePlacementIdentityEvidence: {
      schemaVersion: 1,
      kind: 'ecs-f8x-capture-placement-identity-binding',
      tupleContract: PLACEMENT_IDENTITY_TUPLE_CONTRACT,
      scopeCount: EXPECTED_SCOPE_KEYS.length,
      observationCount: placementIdentityTuples.length,
      placementsSha256: dataSha256(placementIdentityTuples),
      scopes: placementIdentityScopes,
    },
  });
}

export function buildF8xObservationEvidenceBinding(products, quarantine) {
  if (!Array.isArray(products) || !Array.isArray(quarantine)) {
    fail('invalid_f8x_observation_evidence', 'F8X observation evidence requires products and quarantine arrays.');
  }
  return observationEvidenceFromEntries(collectedF8xObservationEntries(products, quarantine));
}

export function verifyF8xCaptureBundleBinding({
  captureBundles,
  importerAudit,
  aggregateProducts,
  aggregateQuarantinedEcsIdentities,
  nowMs = Date.now(),
}) {
  if (!Array.isArray(captureBundles) || captureBundles.length !== EXPECTED_SCOPE_KEYS.length
    || !Array.isArray(aggregateProducts) || !Array.isArray(aggregateQuarantinedEcsIdentities)) {
    fail('invalid_f8x_capture_bundle', 'Exactly 21 capture bundles and both aggregate arrays are required.');
  }
  let reconstructed;
  try {
    reconstructed = prepareF8xAggregateBundles(captureBundles, { nowMs });
  } catch (error) {
    fail(
      'invalid_f8x_capture_bundle',
      `The exact 21 records/manifest/report bundles do not normalize: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (stableJson(reconstructed.audit) !== stableJson(importerAudit)
    || stableJson(reconstructed.products) !== stableJson(aggregateProducts)
    || stableJson(reconstructed.quarantinedEcsIdentities)
      !== stableJson(aggregateQuarantinedEcsIdentities)) {
    fail(
      'f8x_capture_identity_mismatch',
      'The canonical aggregate module or importer audit differs from the exact 21 capture bundles.',
    );
  }
  const binding = Object.freeze({
    kind: 'ecs-f8x-verified-capture-bundle-binding',
    importerAuditSha256: dataSha256(importerAudit),
    aggregateProductsSha256: dataSha256(aggregateProducts),
    aggregateQuarantineSha256: dataSha256(aggregateQuarantinedEcsIdentities),
    placementIdentitySha256: reconstructed.audit.placementIdentityEvidence.placementsSha256,
  });
  VERIFIED_CAPTURE_BUNDLE_BINDINGS.add(binding);
  return binding;
}

function quarantineIdentities(values, label) {
  if (!Array.isArray(values)) fail('invalid_f8x_quarantine', `${label} must be an array.`);
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const candidate = typeof value === 'string' ? value : value?.ecsPartNumber;
    const identity = String(candidate ?? '').trim().match(ECS_IDENTITY)?.[1];
    if (!identity || seen.has(identity)) fail('invalid_f8x_quarantine', `${label} contains an invalid or duplicate ECS identity.`);
    seen.add(identity);
    result.push(identity);
  }
  return result;
}

function productIdentitySetSha256(products, label) {
  return dataSha256([...uniqueProducts(products, label)].sort());
}

function canonicalProductSet(products, label, { canonicalHandles = false } = {}) {
  uniqueProducts(products, label, { canonicalHandles });
  return products.map(product => [ecsIdentity(product), product])
    .sort(([left], [right]) => left.localeCompare(right, 'en', { numeric: true }));
}

function canonicalProductSetSha256(products, label, options = {}) {
  return dataSha256(canonicalProductSet(products, label, options));
}

function exactDigitIdentityArray(values, label) {
  if (!Array.isArray(values)) fail('invalid_prior_quarantine', `${label} must be an array.`);
  const identities = [];
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== 'string' || !/^\d{3,12}$/.test(value) || seen.has(value)) {
      fail('invalid_prior_quarantine', `${label} must contain unique canonical digit-only ECS identities.`);
    }
    seen.add(value);
    identities.push(value);
  }
  const sorted = [...identities].sort();
  if (stableJson(identities) !== stableJson(sorted)) {
    fail('invalid_prior_quarantine', `${label} must be sorted canonically.`);
  }
  return identities;
}

function validateCurrentReleaseBinding(binding, currentReviewedShardProducts) {
  if (!exactKeys(binding, [
    'releaseId', 'generatedAt', 'productCount', 'routeCount', 'shardCount',
    'quarantinedIdentityCount', 'productsSha256', 'artifactSetSha256',
    'datasetSha256', 'contentSetSha256', 'manifestFileSha256',
    'manifestCanonicalSha256', 'productIdentitySetSha256',
  ]) || !RELEASE_ID.test(binding.releaseId || '') || !exactTimestamp(binding.generatedAt)
    || binding.productCount !== currentReviewedShardProducts.length
    || binding.routeCount !== binding.productCount || !safeInteger(binding.shardCount)
    || !safeInteger(binding.quarantinedIdentityCount)
    || binding.productsSha256 !== dataSha256(currentReviewedShardProducts)
    || !SHA256.test(binding.artifactSetSha256 || '')
    || !SHA256.test(binding.datasetSha256 || '')
    || !binding.releaseId.endsWith(`-${binding.datasetSha256.slice(0, 16)}`)
    || !SHA256.test(binding.contentSetSha256 || '')
    || !SHA256.test(binding.manifestFileSha256 || '')
    || !SHA256.test(binding.manifestCanonicalSha256 || '')
    || binding.productIdentitySetSha256 !== productIdentitySetSha256(
      currentReviewedShardProducts,
      'The current reviewed shard release binding',
    )) {
    fail('invalid_current_release_binding', 'The current reviewed shard release binding is incomplete or stale.');
  }
  return binding;
}

export function validatePriorReviewedQuarantineArtifact(
  artifact,
  currentReviewedShardRelease,
  currentReviewedShardProducts,
  priorAggregateEvidence,
) {
  const binding = validateCurrentReleaseBinding(
    currentReviewedShardRelease,
    currentReviewedShardProducts,
  );
  if (!exactKeys(artifact, [
    'schemaVersion', 'supplier', 'kind', 'verifiedAtSourceTimestamp', 'sourceRelease',
    'sourceAggregate', 'quarantinedIdentityCount', 'quarantinedEcsIdentities',
  ]) || artifact.schemaVersion !== 1 || artifact.supplier !== 'ECS Tuning'
    || artifact.kind !== PRIOR_QUARANTINE_KIND
    || artifact.verifiedAtSourceTimestamp !== binding.generatedAt
    || !plainObject(artifact.sourceRelease)
    || stableJson(artifact.sourceRelease) !== stableJson(binding)
    || !exactKeys(artifact.sourceAggregate, [
      'moduleBytes', 'moduleSha256', 'productCount', 'productsSha256',
      'productIdentitySetSha256', 'quarantinedIdentityCount', 'quarantinedIdentitiesSha256',
    ])) {
    fail('invalid_prior_quarantine', 'The prior reviewed quarantine artifact is incomplete or bound to another release.');
  }
  if (!plainObject(priorAggregateEvidence)) {
    fail('invalid_prior_quarantine', 'The canonical prior aggregate module must be reopened with the quarantine artifact.');
  }
  const expected = buildPriorReviewedQuarantineArtifact({
    priorAggregateProducts: priorAggregateEvidence.products,
    priorAggregateQuarantinedEcsIdentities: priorAggregateEvidence.quarantine,
    priorAggregateModuleBytes: priorAggregateEvidence.moduleBytes,
    priorAggregateModuleSha256: priorAggregateEvidence.moduleSha256,
    currentReviewedShardRelease: binding,
    currentReviewedShardProducts,
  });
  if (stableJson(artifact) !== stableJson(expected)) {
    fail(
      'invalid_prior_quarantine',
      'The prior reviewed quarantine artifact differs from its exact canonical source module or bound release.',
    );
  }
  return expected.quarantinedEcsIdentities;
}

function validateAggregateAudit(audit, products, moduleQuarantine, summaries) {
  const expectedAuditKeys = [
    'schemaVersion', 'supplier', 'kind', 'generatedAt', 'sourceKind', 'expectedCaptureCount',
    'inputCaptureCount', 'completeCaptureCount', 'rawObservationCount', 'uniqueObservedEcsIdentityCount',
    'duplicateObservationCount', 'productCount', 'quarantinedIdentityCount', 'quarantinedObservationCount',
    'publicUsdPriceProductCount', 'requestPriceProductCount', 'startingPriceProductCount',
    'zeroPriceRequestProductCount', 'possibleFitmentProductCount', 'exactFitmentProductCount',
    'placementIdentityEvidence', 'captures', 'quarantine',
  ];
  if (!exactKeys(audit, expectedAuditKeys) || audit.schemaVersion !== 1 || audit.supplier !== 'ECS Tuning'
    || audit.kind !== 'ecs-f8x-aggregate-import-audit'
    || audit.sourceKind !== 'ecs-f8x-21-scope-reconciled-capture-set'
    || !exactTimestamp(audit.generatedAt) || audit.expectedCaptureCount !== 21
    || audit.inputCaptureCount !== 21 || audit.completeCaptureCount !== 21
    || !Array.isArray(audit.captures) || audit.captures.length !== 21
    || !Array.isArray(audit.quarantine)) {
    fail('invalid_f8x_importer_audit', 'The F8X importer audit is not the exact 21-scope normalizer output.');
  }
  const productIdentities = uniqueProducts(products, 'The F8X aggregate module', { canonicalHandles: true });
  products.forEach(product => validateStructuredF8xProduct(product, summaries));
  const auditQuarantine = quarantineIdentities(audit.quarantine, 'The F8X importer quarantine');
  if (stableJson([...auditQuarantine].sort()) !== stableJson([...moduleQuarantine].sort())
    || auditQuarantine.some(identity => productIdentities.has(identity))) {
    fail('f8x_quarantine_mismatch', 'The F8X module and importer quarantine sets differ or overlap products.');
  }
  const reportGeneratedAt = [...summaries.values()].map(summary => summary.generatedAt).sort().at(-1);
  if (audit.generatedAt !== reportGeneratedAt) fail('stale_f8x_importer_audit', 'The F8X importer audit is older than its reports.');

  const expectedPlacements = new Map();
  for (const summary of summaries.values()) {
    for (const category of summary.categoriesByKey.values()) {
      for (let position = 1; position <= category.count; position += 1) {
        const key = placementKey(summary.profileKey, summary.sectionKey, category.key, position);
        expectedPlacements.set(key, { summary, category, position });
      }
    }
  }
  const observedPlacements = collectedF8xObservationEntries(products, audit.quarantine);
  for (const [key, value] of observedPlacements) {
    if (!expectedPlacements.has(key)) {
      fail('invalid_f8x_observation_evidence', `ES#${value.identity} references placement outside the exact 3×7 reports: ${key}.`);
    }
  }
  const missingPlacements = [...expectedPlacements.keys()].filter(key => !observedPlacements.has(key));
  if (missingPlacements.length || observedPlacements.size !== expectedPlacements.size) {
    fail(
      'invalid_f8x_observation_evidence',
      `F8X product/quarantine evidence does not cover ${missingPlacements.length} exact captured placement(s).`,
    );
  }
  const sortedUniqueStrings = (values, label) => {
    if (!Array.isArray(values) || !values.length
      || values.some(value => typeof value !== 'string' || !value)
      || new Set(values).size !== values.length
      || stableJson(values) !== stableJson([...values].sort())) {
      fail('invalid_f8x_observation_evidence', `${label} must be a nonempty canonical string set.`);
    }
    return values;
  };
  for (const item of audit.quarantine) {
    const identityValue = String(item?.ecsPartNumber ?? '').trim().match(ECS_IDENTITY)?.[1];
    if (!exactKeys(item, [
      'ecsPartNumber', 'reasons', 'manufacturerPartNumbers', 'productUrls',
      'observations', 'vehicles', 'sections', 'categories',
    ]) || !identityValue) {
      fail('invalid_f8x_observation_evidence', 'A quarantine record has non-canonical evidence fields.');
    }
    sortedUniqueStrings(item.reasons, `ES#${identityValue} quarantine reasons`);
    sortedUniqueStrings(item.manufacturerPartNumbers, `ES#${identityValue} manufacturer part numbers`);
    sortedUniqueStrings(item.productUrls, `ES#${identityValue} product URLs`);
    if (!Array.isArray(item.observations) || !item.observations.length
      || new Set(item.observations).size !== item.observations.length) {
      fail('invalid_f8x_observation_evidence', `ES#${identityValue} quarantine observations are invalid.`);
    }
    const placementEvidence = item.observations.map(key => expectedPlacements.get(key));
    if (placementEvidence.some(value => !value)) {
      fail('invalid_f8x_observation_evidence', `ES#${identityValue} quarantine escapes the exact capture matrix.`);
    }
    const expectedVehicles = [...new Set(placementEvidence.map(value => value.summary.vehicle))].sort();
    const expectedSections = [...new Set(placementEvidence.map(value => value.summary.section))].sort();
    const expectedCategories = [...new Set(placementEvidence.map(value => value.category.name))].sort();
    if (stableJson(item.vehicles) !== stableJson(expectedVehicles)
      || stableJson(item.sections) !== stableJson(expectedSections)
      || stableJson(item.categories) !== stableJson(expectedCategories)) {
      fail('invalid_f8x_observation_evidence', `ES#${identityValue} quarantine scope labels are stale.`);
    }
  }
  const observationEvidence = observationEvidenceFromEntries(observedPlacements);
  if (stableJson(audit.placementIdentityEvidence)
    !== stableJson(observationEvidence.capturePlacementIdentityEvidence)) {
    fail(
      'f8x_capture_identity_mismatch',
      'The importer placement-to-ES digest differs from the exact module and quarantine observations.',
    );
  }

  const productsByScope = new Map(EXPECTED_SCOPE_KEYS.map(key => [key, 0]));
  for (const product of products) {
    const scopes = new Set(product.selectionSources.map(source => {
      const sectionKey = SECTION_KEYS.find(key => F8X_FINAL_SECTIONS[key].label === source.section);
      return `${source.vehicleKey}|${sectionKey}`;
    }));
    for (const key of scopes) productsByScope.set(key, productsByScope.get(key) + 1);
  }
  const seenCaptures = new Set();
  let observations = 0;
  audit.captures.forEach((capture, index) => {
    const expectedKey = EXPECTED_SCOPE_KEYS[index];
    const summary = summaries.get(expectedKey);
    if (!summary || !exactKeys(capture, [
      'vehicleKey', 'vehicle', 'rootUrl', 'sectionKey', 'section', 'captureKind', 'generatedAt',
      'categoryCount', 'observationCount', 'placementIdentityCount', 'placementIdentitySha256',
      'productCount', 'complete', 'reconciled',
    ])) fail('invalid_f8x_capture_audit', `F8X capture audit ${index + 1} is invalid.`);
    const profile = F8X_FINAL_PROFILES[summary.profileKey];
    const placementEvidence = observationEvidence.capturePlacementIdentityEvidence.scopes[expectedKey];
    if (`${capture.vehicleKey}|${capture.sectionKey}` !== expectedKey || seenCaptures.has(expectedKey)
      || capture.vehicle !== summary.vehicle || capture.rootUrl !== profile.rootUrl
      || capture.section !== summary.section
      || capture.captureKind !== `${profile.artifactPrefix}-${summary.sectionKey}-listing-capture`
      || capture.generatedAt !== summary.generatedAt || capture.categoryCount !== summary.categoryCount
      || capture.observationCount !== summary.capturedPlacements
      || capture.placementIdentityCount !== placementEvidence.observationCount
      || capture.placementIdentitySha256 !== placementEvidence.placementsSha256
      || capture.productCount !== productsByScope.get(expectedKey)
      || capture.complete !== true || capture.reconciled !== true) {
      fail('invalid_f8x_capture_audit', `${summary.vehicle} ${summary.section} audit evidence is stale.`);
    }
    seenCaptures.add(expectedKey);
    observations += capture.observationCount;
  });
  const quarantinedObservations = audit.quarantine.reduce((total, item) => (
    total + (Array.isArray(item?.observations) ? item.observations.length : Number.NaN)
  ), 0);
  const metrics = {
    rawObservationCount: observations,
    uniqueObservedEcsIdentityCount: products.length + moduleQuarantine.length,
    duplicateObservationCount: observations - products.length - moduleQuarantine.length,
    productCount: products.length,
    quarantinedIdentityCount: moduleQuarantine.length,
    quarantinedObservationCount: quarantinedObservations,
    publicUsdPriceProductCount: products.filter(product => product.priceAmount !== null).length,
    requestPriceProductCount: products.filter(product => product.priceAmount === null).length,
    startingPriceProductCount: products.filter(product => product.priceStartingAt).length,
    zeroPriceRequestProductCount: products.filter(product => product.priceAmount === null
      && product.sourceObservations?.some(observation => observation.publicUsdPrice === 0)).length,
    possibleFitmentProductCount: products.filter(product => product.fitmentConfidence === 'possible').length,
    exactFitmentProductCount: products.filter(product => product.fitments?.some(fitment => fitment.confidence === 'exact')).length,
  };
  for (const [field, expected] of Object.entries(metrics)) {
    if (!Number.isFinite(expected) || audit[field] !== expected) {
      fail('stale_f8x_aggregate_counts', `The F8X importer ${field} count is stale.`);
    }
  }
  if (observationEvidence.observationCount !== observations
    || observationEvidence.retainedObservationCount + observationEvidence.quarantinedObservationCount !== observations
    || observationEvidence.quarantinedObservationCount !== quarantinedObservations) {
    fail('invalid_f8x_observation_evidence', 'The exact placement binding does not reconcile with importer totals.');
  }
  return { productIdentities, observationEvidence };
}

export function finalizeF8xReleaseAudit({
  importerAudit,
  reconciliationReports,
  aggregateProducts,
  aggregateQuarantinedEcsIdentities,
  captureBundleBinding,
  currentReviewedProducts,
  currentReviewedShardProducts,
  currentReviewedShardRelease,
  priorReviewedQuarantineArtifact,
  priorAggregateProducts,
  priorAggregateQuarantinedEcsIdentities,
  priorAggregateModuleBytes,
  priorAggregateModuleSha256,
  mergeReviewedProducts,
  inputChecksums = null,
  inputSetSha256 = null,
}) {
  if (!Array.isArray(reconciliationReports) || reconciliationReports.length !== 21) {
    fail('f8x_reconciliation_report_count', 'Exactly 21 F8X reconciliation reports are required.');
  }
  const summaries = new Map();
  for (const report of reconciliationReports) {
    const summary = validateF8xReconciliationReport(report);
    if (summaries.has(summary.scopeKey)) fail('duplicate_f8x_reconciliation_scope', `Duplicate F8X scope ${summary.scopeKey}.`);
    summaries.set(summary.scopeKey, summary);
  }
  const missing = EXPECTED_SCOPE_KEYS.filter(key => !summaries.has(key));
  if (missing.length) fail('missing_f8x_reconciliation_scope', `Missing F8X scopes: ${missing.join(', ')}.`);
  const moduleQuarantine = quarantineIdentities(
    aggregateQuarantinedEcsIdentities,
    'The F8X aggregate module quarantine',
  );
  const aggregateValidation = validateAggregateAudit(
    importerAudit, aggregateProducts, moduleQuarantine, summaries,
  );
  if (!plainObject(captureBundleBinding) || !VERIFIED_CAPTURE_BUNDLE_BINDINGS.has(captureBundleBinding)
    || captureBundleBinding.importerAuditSha256 !== dataSha256(importerAudit)
    || captureBundleBinding.aggregateProductsSha256 !== dataSha256(aggregateProducts)
    || captureBundleBinding.aggregateQuarantineSha256
      !== dataSha256(aggregateQuarantinedEcsIdentities)
    || captureBundleBinding.placementIdentitySha256
      !== importerAudit.placementIdentityEvidence.placementsSha256) {
    fail(
      'f8x_capture_identity_mismatch',
      'Finalization requires the verified exact 21 records/manifest/report capture binding.',
    );
  }
  uniqueProducts(currentReviewedProducts, 'The static reviewed ECS catalogue');
  uniqueProducts(currentReviewedShardProducts, 'The current reviewed shard release', {
    canonicalHandles: true,
  });
  const priorQuarantine = validatePriorReviewedQuarantineArtifact(
    priorReviewedQuarantineArtifact,
    currentReviewedShardRelease,
    currentReviewedShardProducts,
    {
      products: priorAggregateProducts,
      quarantine: priorAggregateQuarantinedEcsIdentities,
      moduleBytes: priorAggregateModuleBytes,
      moduleSha256: priorAggregateModuleSha256,
    },
  );
  if (typeof mergeReviewedProducts !== 'function') {
    fail('missing_runtime_merge_function', 'The exact reviewed runtime merge function is required.');
  }
  const projectedQuarantine = [...new Set([...priorQuarantine, ...moduleQuarantine])].sort();
  const projectedQuarantineSet = new Set(projectedQuarantine);
  const publishableAggregateProducts = aggregateProducts.filter(product => (
    !projectedQuarantineSet.has(ecsIdentity(product))
  ));
  const publishableAggregateIdentities = uniqueProducts(
    publishableAggregateProducts,
    'The post-quarantine F8X overlay',
  );
  const survivingStaticProducts = currentReviewedProducts.filter(product => (
    !projectedQuarantineSet.has(ecsIdentity(product))
  ));
  const survivingCurrentShardProducts = currentReviewedShardProducts.filter(product => (
    !projectedQuarantineSet.has(ecsIdentity(product))
  ));
  let candidateShardProducts;
  let currentRuntimeProducts;
  let projectedRuntimeProducts;
  try {
    currentRuntimeProducts = mergeReviewedProducts(currentReviewedProducts, currentReviewedShardProducts);
    candidateShardProducts = mergeReviewedProducts(
      survivingCurrentShardProducts,
      publishableAggregateProducts,
    );
    projectedRuntimeProducts = mergeReviewedProducts(survivingStaticProducts, candidateShardProducts);
  } catch (error) {
    fail(
      'candidate_merge_conflict',
      `The F8X candidate conflicts with the actual static-plus-shard runtime union: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const currentShardHandles = new Map(survivingCurrentShardProducts.map(product => (
    [ecsIdentity(product), [product.publicKey, product.slug]]
  )));
  const candidateShardByIdentity = new Map(candidateShardProducts.map(product => [ecsIdentity(product), product]));
  for (const [identity, handles] of currentShardHandles) {
    const product = candidateShardByIdentity.get(identity);
    if (!product || product.publicKey !== handles[0] || product.slug !== handles[1]) {
      fail('candidate_merge_conflict', `The F8X candidate changes the stable shard handle for ES#${identity}.`);
    }
  }
  const currentRuntimeIdentities = uniqueProducts(
    currentRuntimeProducts,
    'The actual current static-plus-shard runtime union',
  );
  const projected = uniqueProducts(
    projectedRuntimeProducts,
    'The actual projected static-plus-shard runtime union',
  );
  const quarantineSurvivors = projectedQuarantine.filter(identity => projected.has(identity));
  if (quarantineSurvivors.length) {
    fail(
      'projected_quarantine_survivor',
      `The candidate runtime projection retains ${quarantineSurvivors.length} quarantined product(s).`,
    );
  }
  const currentRemovedByProjectedQuarantine = [...currentRuntimeIdentities]
    .filter(identity => projectedQuarantineSet.has(identity)).sort();
  const unintendedRemovals = [...currentRuntimeIdentities].filter(identity => (
    !projected.has(identity) && !projectedQuarantineSet.has(identity)
  ));
  if (unintendedRemovals.length) {
    fail('unintended_current_reviewed_removal', `The F8X union would remove ${unintendedRemovals.length} current product(s).`);
  }
  const overlap = [...publishableAggregateIdentities]
    .filter(identity => currentRuntimeIdentities.has(identity)).length;
  const sectionProgress = Object.fromEntries(SECTION_KEYS.map(sectionKey => {
    const scopes = PROFILE_KEYS.map(profileKey => summaries.get(`${profileKey}|${sectionKey}`));
    const productCount = publishableAggregateProducts.filter(product => product.selectionSources.some(source => (
      source.section === F8X_FINAL_SECTIONS[sectionKey].label
    ))).length;
    return [sectionKey, {
      label: F8X_FINAL_SECTIONS[sectionKey].label,
      complete: true,
      included: true,
      capturedPages: scopes.reduce((total, scope) => total + scope.capturedPages, 0),
      expectedPages: scopes.reduce((total, scope) => total + scope.capturedPages, 0),
      capturedPlacements: scopes.reduce((total, scope) => total + scope.capturedPlacements, 0),
      expectedPlacements: scopes.reduce((total, scope) => total + scope.capturedPlacements, 0),
      productCount,
      vehicleScopeCount: 3,
    }];
  }));
  return {
    ...importerAudit,
    observationEvidence: aggregateValidation.observationEvidence,
    quarantinedIdentityCount: projectedQuarantine.length,
    projectedQuarantinedEcsIdentities: projectedQuarantine,
    priorReviewedQuarantine: {
      sourceReleaseId: currentReviewedShardRelease.releaseId,
      identityCount: priorQuarantine.length,
      identitySetSha256: dataSha256(priorQuarantine),
      sourceAggregateModuleSha256: priorReviewedQuarantineArtifact.sourceAggregate.moduleSha256,
    },
    sections: Object.fromEntries(SECTION_KEYS.map(sectionKey => [sectionKey, {
      label: sectionProgress[sectionKey].label,
      productCount: sectionProgress[sectionKey].productCount,
      f8xOverlayProductCount: sectionProgress[sectionKey].productCount,
      vehicleScopeCount: 3,
    }])),
    publicationPlan: {
      mode: 'separate-f8x-overlay',
      overlayProductCount: publishableAggregateProducts.length,
      baseRelease: {
        releaseId: currentReviewedShardRelease.releaseId,
        manifestSha256: currentReviewedShardRelease.manifestFileSha256,
        contentSetSha256: currentReviewedShardRelease.contentSetSha256,
        artifactSetSha256: currentReviewedShardRelease.artifactSetSha256,
        productCount: currentReviewedShardRelease.productCount,
        routeCount: currentReviewedShardRelease.routeCount,
        shardCount: currentReviewedShardRelease.shardCount,
        quarantinedIdentityCount: currentReviewedShardRelease.quarantinedIdentityCount,
        productsSha256: currentReviewedShardRelease.productsSha256,
      },
      priorQuarantine: {
        identityCount: priorQuarantine.length,
        identitiesSha256: dataSha256(priorQuarantine),
      },
      incomingQuarantine: {
        identityCount: moduleQuarantine.length,
        identitiesSha256: dataSha256([...moduleQuarantine].sort()),
      },
      projectedQuarantine: {
        identityCount: projectedQuarantine.length,
        identitiesSha256: dataSha256(projectedQuarantine),
      },
      staticPlusBasePlusOverlayProductCount: projected.size,
    },
    publicationMergeAudit: {
      staticReviewedProductCount: currentReviewedProducts.length,
      currentReviewedShardProductCount: currentReviewedShardProducts.length,
      currentRuntimeReviewedProductCount: currentRuntimeIdentities.size,
      generatedProductCount: aggregateProducts.length,
      publishedOverlayProductCount: publishableAggregateProducts.length,
      overlapWithCurrentRuntimeReviewedEcsCount: overlap,
      newUniqueProductCount: projected.size
        - (currentRuntimeIdentities.size - currentRemovedByProjectedQuarantine.length),
      currentRuntimeQuarantineOverlapCount: currentRemovedByProjectedQuarantine.length,
      currentReviewedRemovedByProjectedQuarantineCount: currentRemovedByProjectedQuarantine.length,
      currentReviewedRemovedByProjectedQuarantine: {
        identityCount: currentRemovedByProjectedQuarantine.length,
        identitiesSha256: dataSha256(currentRemovedByProjectedQuarantine),
      },
      unintendedCurrentReviewedRemovalCount: 0,
      projectedPublishedReviewedEcsCount: projected.size,
      priorQuarantinedIdentityCount: priorQuarantine.length,
      incomingF8xQuarantinedIdentityCount: moduleQuarantine.length,
      projectedQuarantinedIdentityCount: projectedQuarantine.length,
    },
    captureProgress: {
      stage: 'complete', complete: true, importPolicy: 'all-21-f8x-scopes-reconciled',
      requestedSectionCount: 7, includedSectionCount: 7,
      includedSections: [...SECTION_KEYS], excludedSections: [], sections: sectionProgress,
    },
    finalReleaseAudit: {
      schemaVersion: 1,
      kind: 'ecs-f8x-final-release-audit-verification',
      verifiedAtSourceTimestamp: importerAudit.generatedAt,
      currentReviewedShardRelease: { ...currentReviewedShardRelease },
      ...(inputSetSha256 ? { inputSetSha256 } : {}),
      ...(inputChecksums ? { inputChecksums } : {}),
    },
  };
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function comparablePath(value) {
  const resolved = path.resolve(value);
  return path.sep === '\\' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

function samePath(left, right) {
  return comparablePath(left) === comparablePath(right);
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function canonicalDirectoryIdentity(filename, code) {
  const requested = path.resolve(filename);
  try {
    const entry = await lstat(requested);
    const resolved = await realpath(requested);
    const details = await stat(resolved);
    if (!entry.isDirectory() || entry.isSymbolicLink() || !samePath(resolved, requested)
      || !details.isDirectory()) throw new Error();
    return Object.freeze({ path: resolved, dev: details.dev, ino: details.ino });
  } catch {
    fail(code, `Required directory is missing, linked or invalid: ${filename}`);
  }
}

async function assertDirectoryIdentity(expected, code) {
  const actual = await canonicalDirectoryIdentity(expected.path, code);
  if (!sameFileIdentity(actual, expected)) {
    fail(code, `Directory identity changed during verification: ${expected.path}`);
  }
}

async function existingDirectory(filename, code) {
  return (await canonicalDirectoryIdentity(filename, code)).path;
}

async function allowedRoots(workDirectory = null) {
  const repo = await existingDirectory(REPO, 'invalid_repository_root');
  const inputRoots = [repo];
  const outputRoots = [];
  let privateImports = null;
  let work = null;
  if (workDirectory) {
    if (!path.isAbsolute(workDirectory)) fail('invalid_work_directory', 'The work directory must be absolute.');
    work = await existingDirectory(workDirectory, 'invalid_work_directory');
    if (inside(repo, work) || path.parse(work).root === work) {
      fail('invalid_work_directory', 'The work directory must be a non-root directory outside the repository.');
    }
    inputRoots.push(work);
    outputRoots.push(work);
  } else {
    privateImports = await existingDirectory(PRIVATE_IMPORTS, 'invalid_private_import_root');
    outputRoots.push(privateImports);
  }
  return { repo, privateImports, work, inputRoots, outputRoots };
}

function rootFor(target, roots) {
  return roots.find(root => inside(root, target)) || null;
}

async function confinedInput(filename, roots) {
  const requested = path.resolve(filename);
  try {
    const entry = await lstat(requested);
    const resolved = await realpath(requested);
    if (!entry.isFile() || entry.isSymbolicLink() || !samePath(resolved, requested)
      || !(await stat(resolved)).isFile() || !rootFor(resolved, roots.inputRoots)) throw new Error();
    return resolved;
  } catch {
    fail('invalid_input_path', `Input file is missing, linked, invalid or outside the allowed roots: ${filename}`);
  }
}

async function fileSnapshot(filename, roots) {
  const requested = path.resolve(filename);
  const resolved = await confinedInput(filename, roots);
  let handle;
  try {
    handle = await open(resolved, 'r');
    const before = await handle.stat();
    if (!before.isFile()) throw new Error();
    const buffer = Buffer.from(await handle.readFile());
    const after = await handle.stat();
    const postResolved = await realpath(requested);
    const postEntry = await lstat(requested);
    const post = await stat(postResolved);
    if (!postEntry.isFile() || postEntry.isSymbolicLink() || !samePath(postResolved, resolved)
      || !sameFileIdentity(before, after) || !sameFileIdentity(before, post)
      || before.size !== after.size || after.size !== buffer.length
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error();
    return {
      requested, path: resolved, bytes: buffer.length, sha256: sha256(buffer), buffer,
      dev: before.dev, ino: before.ino,
    };
  } catch (error) {
    if (error instanceof F8xFinalReleaseAuditError) throw error;
    fail('checksum_drift', `Input changed while its bytes were being opened: ${filename}`);
  } finally {
    await handle?.close();
  }
}

function parseJsonSnapshot(snapshot, label) {
  try {
    const value = JSON.parse(snapshot.buffer.toString('utf8'));
    if (!plainObject(value)) throw new Error();
    return value;
  } catch {
    fail('invalid_json_input', `${label} is not a JSON object.`);
  }
}

function sourceLabel(filename, roots) {
  if (inside(roots.repo, filename)) return `repo:${path.relative(roots.repo, filename).replaceAll('\\', '/')}`;
  if (roots.work && inside(roots.work, filename)) return `work:${path.relative(roots.work, filename).replaceAll('\\', '/')}`;
  fail('input_path_escape', 'An input escapes the repository/designated work directory.');
}

function exactF8xCaptureBundlePaths(reportPath) {
  const resolvedReport = path.resolve(reportPath);
  const basename = path.basename(resolvedReport);
  if (!/^bmw-f(?:80-m3|82-m4|83-m4)-(?:braking|engine|exterior|interior|suspension|steering|performance)-reconciliation-report\.json$/.test(basename)) {
    fail(
      'invalid_f8x_capture_bundle_path',
      `F8X reconciliation report has no exact records/manifest sibling contract: ${basename}`,
    );
  }
  const stem = basename.slice(0, -'-reconciliation-report.json'.length);
  const directory = path.dirname(resolvedReport);
  return Object.freeze({
    records: path.join(directory, `${stem}-records.json`),
    manifest: path.join(directory, `${stem}-manifest.json`),
    report: resolvedReport,
  });
}

function reviewedDatasetSha256(manifest, products) {
  const value = {
    generatedAt: manifest.generatedAt,
    complete: manifest.complete,
    sections: manifest.sections,
    keys: products.map(product => [
      product.publicKey,
      sha256(Buffer.from(`${JSON.stringify(product)}\n`, 'utf8')),
    ]),
  };
  return sha256(Buffer.from(`${JSON.stringify(value)}\n`, 'utf8'));
}

async function shardReleaseSnapshot(directory, roots) {
  const directoryIdentity = await canonicalDirectoryIdentity(
    path.resolve(directory),
    'invalid_current_reviewed_shard_release',
  );
  const root = directoryIdentity.path;
  if (!rootFor(root, roots.inputRoots)) fail('input_path_escape', 'The current shard release escapes the allowed roots.');
  async function artifact(name) {
    await assertDirectoryIdentity(directoryIdentity, 'current_reviewed_shard_checksum_mismatch');
    const snapshot = await fileSnapshot(path.join(root, name), roots);
    if (!inside(root, snapshot.path)) fail('input_path_escape', `Shard artifact ${name} escapes its release directory.`);
    await assertDirectoryIdentity(directoryIdentity, 'current_reviewed_shard_checksum_mismatch');
    return snapshot;
  }
  const manifestSnapshot = await artifact('manifest.json');
  const manifest = parseJsonSnapshot(manifestSnapshot, 'The current shard manifest');
  if (manifest.schemaVersion !== 1 || manifest.supplier !== 'ECS Tuning'
    || manifest.kind !== 'ecs-reviewed-product-shard-manifest' || !RELEASE_ID.test(manifest.releaseId || '')
    || !safeInteger(manifest.counts?.productCount, 1, 50_000)
    || manifest.counts?.routeCount !== manifest.counts.productCount
    || !safeInteger(manifest.counts?.shardCount, 1, 1_000)
    || !Array.isArray(manifest.shards) || manifest.shards.length !== manifest.counts.shardCount
    || manifest.index?.file !== 'index.json' || !safeInteger(manifest.index?.bytes, 1, 64 * 1024 * 1024)
    || !SHA256.test(manifest.index?.sha256 || '')) {
    fail('invalid_current_reviewed_shard_release', 'The current reviewed shard manifest is invalid.');
  }
  const indexSnapshot = await artifact('index.json');
  if (indexSnapshot.bytes !== manifest.index.bytes || indexSnapshot.sha256 !== manifest.index.sha256) {
    fail('current_reviewed_shard_checksum_mismatch', 'The current reviewed routing index checksum differs.');
  }
  const index = parseJsonSnapshot(indexSnapshot, 'The current reviewed routing index');
  if (index.schemaVersion !== 1 || index.kind !== 'ecs-reviewed-product-routing-index'
    || index.supplier !== 'ECS Tuning' || index.releaseId !== manifest.releaseId
    || index.routeCount !== manifest.counts.routeCount || !Array.isArray(index.routes)
    || index.routes.length !== index.routeCount) {
    fail('invalid_current_reviewed_shard_release', 'The current reviewed routing index is invalid.');
  }
  const products = [];
  const positions = new Map();
  const shardSnapshots = [];
  const filenames = new Set();
  let count = 0;
  for (const [indexValue, descriptor] of manifest.shards.entries()) {
    if (descriptor?.sequence !== indexValue + 1 || !SHARD_FILE.test(descriptor?.file || '')
      || filenames.has(descriptor.file) || !safeInteger(descriptor.productCount, 1, 250)
      || !safeInteger(descriptor.bytes, 1, 4 * 1024 * 1024) || !SHA256.test(descriptor.sha256 || '')) {
      fail('invalid_current_reviewed_shard_release', `Current reviewed shard descriptor ${indexValue + 1} is invalid.`);
    }
    filenames.add(descriptor.file);
    const snapshot = await artifact(descriptor.file);
    if (snapshot.bytes !== descriptor.bytes || snapshot.sha256 !== descriptor.sha256) {
      fail('current_reviewed_shard_checksum_mismatch', `${descriptor.file} failed checksum validation.`);
    }
    const document = parseJsonSnapshot(snapshot, descriptor.file);
    if (document.schemaVersion !== 1 || document.supplier !== 'ECS Tuning'
      || document.kind !== 'ecs-reviewed-product-shard' || document.releaseId !== manifest.releaseId
      || document.sequence !== descriptor.sequence || document.productCount !== descriptor.productCount
      || !Array.isArray(document.products) || document.products.length !== descriptor.productCount
      || document.products[0]?.publicKey !== descriptor.firstKey
      || document.products.at(-1)?.publicKey !== descriptor.lastKey) {
      fail('invalid_current_reviewed_shard_release', `${descriptor.file} is invalid.`);
    }
    document.products.forEach((product, productIndex) => {
      products.push(product);
      positions.set(`${descriptor.sequence}:${productIndex}`, product);
    });
    shardSnapshots.push(snapshot);
    count += descriptor.productCount;
  }
  if (count !== manifest.counts.productCount) fail('invalid_current_reviewed_shard_release', 'Current shard counts do not reconcile.');
  uniqueProducts(products, 'The current reviewed shard release', { canonicalHandles: true });
  const routeKeys = new Set();
  for (const route of index.routes) {
    const position = `${route?.shardSequence}:${route?.shardProductIndex}`;
    const product = positions.get(position);
    if (route?.shardedRoute !== true || routeKeys.has(route.publicKey)
      || product?.publicKey !== route.publicKey || product?.slug !== route.slug) {
      fail('invalid_current_reviewed_shard_release', 'A current reviewed route does not match its shard product.');
    }
    routeKeys.add(route.publicKey);
  }
  const contentSet = sha256(Buffer.from([
    `index.json\0${manifest.index.bytes}\0${manifest.index.sha256}`,
    ...manifest.shards.map(descriptor => `${descriptor.file}\0${descriptor.bytes}\0${descriptor.sha256}`),
  ].join('\n'), 'utf8'));
  if (manifest.contentSetSha256 !== contentSet) {
    fail('current_reviewed_shard_checksum_mismatch', 'The current reviewed shard artifact-set checksum differs.');
  }
  const datasetSha256 = reviewedDatasetSha256(manifest, products);
  if (!exactTimestamp(manifest.generatedAt)
    || !safeInteger(manifest.counts?.quarantinedIdentityCount)
    || !manifest.releaseId.endsWith(`-${datasetSha256.slice(0, 16)}`)) {
    fail('invalid_current_reviewed_shard_release', 'The current reviewed shard dataset binding is invalid.');
  }
  const snapshots = [manifestSnapshot, indexSnapshot, ...shardSnapshots];
  const descriptors = [
    { file: 'manifest.json', snapshot: manifestSnapshot },
    { file: 'index.json', snapshot: indexSnapshot },
    ...manifest.shards.map((descriptor, indexValue) => ({
      file: descriptor.file,
      snapshot: shardSnapshots[indexValue],
    })),
  ].map(({ file, snapshot }) => ({
    file, bytes: snapshot.bytes, sha256: snapshot.sha256,
  })).sort((left, right) => left.file.localeCompare(right.file, 'en'));
  const artifactSetSha256 = dataSha256(descriptors);
  const releaseBinding = {
    releaseId: manifest.releaseId,
    generatedAt: manifest.generatedAt,
    productCount: products.length,
    routeCount: manifest.counts.routeCount,
    shardCount: manifest.counts.shardCount,
    quarantinedIdentityCount: manifest.counts.quarantinedIdentityCount,
    productsSha256: dataSha256(products),
    artifactSetSha256,
    datasetSha256,
    contentSetSha256: manifest.contentSetSha256,
    manifestFileSha256: manifestSnapshot.sha256,
    manifestCanonicalSha256: dataSha256(manifest),
    productIdentitySetSha256: productIdentitySetSha256(
      products,
      'The current reviewed shard release binding',
    ),
  };
  await assertDirectoryIdentity(directoryIdentity, 'current_reviewed_shard_checksum_mismatch');
  return {
    manifest, manifestSnapshot, products, snapshots, descriptors,
    releaseBinding, sha256: artifactSetSha256,
  };
}

export function buildPriorReviewedQuarantineArtifact({
  priorAggregateProducts,
  priorAggregateQuarantinedEcsIdentities,
  priorAggregateModuleBytes,
  priorAggregateModuleSha256,
  currentReviewedShardRelease,
  currentReviewedShardProducts,
}) {
  const binding = validateCurrentReleaseBinding(
    currentReviewedShardRelease,
    currentReviewedShardProducts,
  );
  if (!safeInteger(priorAggregateModuleBytes, 1, 128 * 1024 * 1024)
    || !SHA256.test(priorAggregateModuleSha256 || '')) {
    fail('invalid_prior_aggregate_module', 'The prior aggregate module checksum evidence is invalid.');
  }
  const aggregateProductsSha256 = canonicalProductSetSha256(
    priorAggregateProducts,
    'The prior reviewed aggregate module',
    { canonicalHandles: true },
  );
  const currentProductsSha256 = canonicalProductSetSha256(
    currentReviewedShardProducts,
    'The current reviewed shard release exact prior-aggregate check',
    { canonicalHandles: true },
  );
  const aggregateIdentitySetSha256 = productIdentitySetSha256(
    priorAggregateProducts,
    'The prior reviewed aggregate module',
  );
  if (priorAggregateProducts.length !== binding.productCount
    || aggregateIdentitySetSha256 !== binding.productIdentitySetSha256
    || aggregateProductsSha256 !== currentProductsSha256) {
    fail(
      'prior_aggregate_release_mismatch',
      'The prior aggregate products do not exactly match the current shard release.',
    );
  }
  const quarantinedEcsIdentities = exactDigitIdentityArray(
    priorAggregateQuarantinedEcsIdentities,
    'The prior reviewed aggregate quarantine',
  );
  const publishedIdentities = uniqueProducts(
    priorAggregateProducts,
    'The prior reviewed aggregate quarantine check',
  );
  if (quarantinedEcsIdentities.length !== binding.quarantinedIdentityCount
    || quarantinedEcsIdentities.some(identity => publishedIdentities.has(identity))) {
    fail(
      'prior_quarantine_count_mismatch',
      'The prior aggregate quarantine does not match the current release count or overlaps its published products.',
    );
  }
  return {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    kind: PRIOR_QUARANTINE_KIND,
    verifiedAtSourceTimestamp: binding.generatedAt,
    sourceRelease: { ...binding },
    sourceAggregate: {
      moduleBytes: priorAggregateModuleBytes,
      moduleSha256: priorAggregateModuleSha256,
      productCount: priorAggregateProducts.length,
      productsSha256: aggregateProductsSha256,
      productIdentitySetSha256: aggregateIdentitySetSha256,
      quarantinedIdentityCount: quarantinedEcsIdentities.length,
      quarantinedIdentitiesSha256: dataSha256(quarantinedEcsIdentities),
    },
    quarantinedIdentityCount: quarantinedEcsIdentities.length,
    quarantinedEcsIdentities,
  };
}

export async function verifyPriorReviewedQuarantineFiles({
  priorAggregateModulePath,
  currentReviewedShardDirectory,
  workDirectory = null,
  expectedInputSetSha256 = null,
}) {
  const roots = await allowedRoots(workDirectory);
  const [moduleSnapshot, shardRelease] = await Promise.all([
    fileSnapshot(priorAggregateModulePath, roots),
    shardReleaseSnapshot(currentReviewedShardDirectory, roots),
  ]);
  if (moduleSnapshot.bytes > 128 * 1024 * 1024) {
    fail('invalid_prior_aggregate_module', 'The prior aggregate module exceeds the 128 MiB verification limit.');
  }
  const parsed = parseExactPriorReviewedAggregateModule(moduleSnapshot.buffer.toString('utf8'));
  const artifact = buildPriorReviewedQuarantineArtifact({
    priorAggregateProducts: parsed.products,
    priorAggregateQuarantinedEcsIdentities: parsed.quarantine,
    priorAggregateModuleBytes: moduleSnapshot.bytes,
    priorAggregateModuleSha256: moduleSnapshot.sha256,
    currentReviewedShardRelease: shardRelease.releaseBinding,
    currentReviewedShardProducts: shardRelease.products,
  });
  const checksums = {
    priorAggregateModule: { bytes: moduleSnapshot.bytes, sha256: moduleSnapshot.sha256 },
    currentReviewedShardRelease: { ...shardRelease.releaseBinding },
  };
  const inputSetSha256 = dataSha256(checksums);
  if (expectedInputSetSha256 !== null
    && (!SHA256.test(expectedInputSetSha256) || expectedInputSetSha256 !== inputSetSha256)) {
    fail('checksum_drift', 'The prior quarantine verified input-set checksum differs from the pinned checksum.');
  }
  await assertSnapshotsUnchanged([moduleSnapshot, ...shardRelease.snapshots]);
  return { artifact, inputSetSha256, checksums, roots };
}

function hasCommentSeparatedModuleSyntax(source) {
  return /\b(?:import|export|from)\s*\/\*/.test(source)
    || /\b(?:import|export|from)\s*\/\//.test(source);
}

function moduleSpecifiers(source) {
  if (hasCommentSeparatedModuleSyntax(source) || /\bimport\s*(?:\/\*[\s\S]*?\*\/\s*)?\(/.test(source)) {
    fail('unsupported_module_dependency', 'Dynamic or comment-separated module syntax is not allowed.');
  }
  const result = new Set();
  const pattern = /\b(?:import|export)\s*(?:[^'";]*?\bfrom\s*)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = pattern.exec(source))) result.add(match[1]);
  return [...result];
}

async function resolveModule(parent, specifier, roots) {
  if (specifier.startsWith('node:')) {
    if (TRUSTED_NODE_IMPORTS[parent]?.has(specifier)) return null;
    fail('unsupported_module_dependency', `Unsupported built-in dependency: ${specifier}`);
  }
  if (!specifier.startsWith('.')) fail('unsupported_module_dependency', `Unsupported external dependency: ${specifier}`);
  const base = path.resolve(path.dirname(parent), specifier);
  for (const candidate of [base, `${base}.js`, `${base}.mjs`, `${base}.json`, path.join(base, 'index.js')]) {
    try {
      const requested = path.resolve(candidate);
      const entry = await lstat(requested);
      const resolved = await realpath(requested);
      if (entry.isFile() && !entry.isSymbolicLink() && samePath(resolved, requested)
        && (await stat(resolved)).isFile()) {
        if (!inside(roots.repo, resolved)) fail('module_path_escape', `Module dependency escapes the repository: ${specifier}`);
        return resolved;
      }
    } catch (error) {
      if (error instanceof F8xFinalReleaseAuditError) throw error;
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
    }
  }
  fail('missing_module_dependency', `Cannot resolve module dependency: ${specifier}`);
}

async function currentReviewedGraph(entryPath, roots) {
  const trusted = await confinedInput(TRUSTED_CURRENT_REVIEWED_MODULE, roots);
  const entry = await confinedInput(entryPath, roots);
  if (entry !== trusted) fail('untrusted_current_reviewed_module', 'The current reviewed module is not the exact trusted server module.');
  const pending = [entry];
  const files = new Map();
  while (pending.length) {
    const filename = pending.pop();
    if (files.has(filename)) continue;
    const snapshot = await fileSnapshot(filename, roots);
    files.set(filename, snapshot);
    for (const specifier of moduleSpecifiers(snapshot.buffer.toString('utf8'))) {
      const dependency = await resolveModule(filename, specifier, roots);
      if (dependency && !files.has(dependency)) pending.push(dependency);
    }
  }
  const descriptors = [...files.values()].map(item => ({
    label: sourceLabel(item.path, roots), bytes: item.bytes, sha256: item.sha256,
  })).sort((left, right) => left.label.localeCompare(right.label, 'en'));
  return { entry, files, descriptors, sha256: dataSha256(descriptors) };
}

async function assertSnapshotsUnchanged(snapshots) {
  for (const snapshot of snapshots) {
    let handle;
    try {
      const requested = snapshot.requested || snapshot.path;
      const entry = await lstat(requested);
      const resolved = await realpath(requested);
      if (!entry.isFile() || entry.isSymbolicLink() || !samePath(resolved, snapshot.path)) throw new Error();
      handle = await open(resolved, 'r');
      const before = await handle.stat();
      const buffer = Buffer.from(await handle.readFile());
      const after = await handle.stat();
      const postResolved = await realpath(requested);
      if (!samePath(postResolved, snapshot.path) || !sameFileIdentity(before, after)
        || (snapshot.dev !== undefined && (snapshot.dev !== before.dev || snapshot.ino !== before.ino))
        || buffer.length !== snapshot.bytes || sha256(buffer) !== snapshot.sha256) throw new Error();
    } catch {
      fail('checksum_drift', `Release input changed during verification: ${snapshot.path}`);
    } finally {
      await handle?.close();
    }
  }
}

export async function snapshotTrustedCurrentReviewedGraph() {
  const repo = await existingDirectory(REPO, 'invalid_repository_root');
  const roots = { repo, inputRoots: [repo] };
  const graph = await currentReviewedGraph(TRUSTED_CURRENT_REVIEWED_MODULE, roots);
  await assertSnapshotsUnchanged([...graph.files.values()]);
  return Object.freeze({
    fileCount: graph.descriptors.length,
    sha256: graph.sha256,
    descriptors: Object.freeze(graph.descriptors.map(item => Object.freeze({ ...item }))),
  });
}

function checksumSummary({
  auditSnapshot,
  captureBundleEntries,
  aggregateSnapshot,
  parsedAggregate,
  graph,
  shardRelease,
  currentProducts,
  priorAggregateSnapshot,
  parsedPriorAggregate,
  priorQuarantineSnapshot,
  priorQuarantineArtifact,
}) {
  return {
    importerAudit: { bytes: auditSnapshot.bytes, sha256: auditSnapshot.sha256 },
    captureBundles: Object.fromEntries(captureBundleEntries.map(entry => [entry.summary.scopeKey, {
      records: { bytes: entry.captureSnapshot.bytes, sha256: entry.captureSnapshot.sha256 },
      manifest: { bytes: entry.manifestSnapshot.bytes, sha256: entry.manifestSnapshot.sha256 },
      reconciliationReport: { bytes: entry.reportSnapshot.bytes, sha256: entry.reportSnapshot.sha256 },
    }])),
    aggregateModule: { bytes: aggregateSnapshot.bytes, sha256: aggregateSnapshot.sha256 },
    aggregateProducts: { count: parsedAggregate.products.length, sha256: dataSha256(parsedAggregate.products) },
    aggregateQuarantine: { count: parsedAggregate.quarantine.length, sha256: dataSha256(parsedAggregate.quarantine) },
    currentReviewedModuleGraph: { fileCount: graph.descriptors.length, sha256: graph.sha256 },
    currentReviewedProducts: { count: currentProducts.length, sha256: dataSha256(currentProducts) },
    currentReviewedShardRelease: {
      ...shardRelease.releaseBinding,
      fileCount: shardRelease.descriptors.length,
      artifactSetSha256: shardRelease.sha256,
    },
    priorAggregateModule: {
      bytes: priorAggregateSnapshot.bytes,
      sha256: priorAggregateSnapshot.sha256,
      productCount: parsedPriorAggregate.products.length,
      productsSha256: canonicalProductSetSha256(
        parsedPriorAggregate.products,
        'The checksum-bound prior aggregate products',
        { canonicalHandles: true },
      ),
      quarantineIdentityCount: parsedPriorAggregate.quarantine.length,
      quarantineIdentitiesSha256: dataSha256(parsedPriorAggregate.quarantine),
    },
    priorReviewedQuarantineArtifact: {
      bytes: priorQuarantineSnapshot.bytes,
      sha256: priorQuarantineSnapshot.sha256,
      canonicalSha256: dataSha256(priorQuarantineArtifact),
      identityCount: priorQuarantineArtifact.quarantinedIdentityCount,
      sourceReleaseId: priorQuarantineArtifact.sourceRelease?.releaseId,
    },
  };
}

export async function verifyF8xReleaseAuditFiles({
  auditPath,
  aggregateModulePath,
  priorAggregateModulePath,
  priorQuarantinePath,
  currentReviewedModulePath,
  currentReviewedShardDirectory,
  reconciliationPaths,
  workDirectory = null,
  expectedInputSetSha256 = null,
}) {
  const roots = await allowedRoots(workDirectory);
  if (!Array.isArray(reconciliationPaths) || reconciliationPaths.length !== 21) {
    fail('f8x_reconciliation_report_count', 'Exactly 21 F8X reconciliation report paths are required.');
  }
  const [
    auditSnapshot,
    aggregateSnapshot,
    priorAggregateSnapshot,
    priorQuarantineSnapshot,
    captureBundleSnapshots,
    graph,
    shardRelease,
  ] = await Promise.all([
    fileSnapshot(auditPath, roots),
    fileSnapshot(aggregateModulePath, roots),
    fileSnapshot(priorAggregateModulePath, roots),
    fileSnapshot(priorQuarantinePath, roots),
    Promise.all(reconciliationPaths.map(async reportPath => {
      const paths = exactF8xCaptureBundlePaths(reportPath);
      const [captureSnapshot, manifestSnapshot, reportSnapshot] = await Promise.all([
        fileSnapshot(paths.records, roots),
        fileSnapshot(paths.manifest, roots),
        fileSnapshot(paths.report, roots),
      ]);
      return { paths, captureSnapshot, manifestSnapshot, reportSnapshot };
    })),
    currentReviewedGraph(currentReviewedModulePath, roots),
    shardReleaseSnapshot(currentReviewedShardDirectory, roots),
  ]);
  const parsedAggregate = parseExactF8xAggregateModule(aggregateSnapshot.buffer.toString('utf8'));
  if (priorAggregateSnapshot.bytes > 128 * 1024 * 1024) {
    fail('invalid_prior_aggregate_module', 'The prior aggregate module exceeds the 128 MiB verification limit.');
  }
  const parsedPriorAggregate = parseExactPriorReviewedAggregateModule(
    priorAggregateSnapshot.buffer.toString('utf8'),
  );
  const priorQuarantineArtifact = parseJsonSnapshot(
    priorQuarantineSnapshot,
    'The prior reviewed quarantine artifact',
  );
  const importerAudit = parseJsonSnapshot(auditSnapshot, 'The F8X importer audit');
  const captureBundleEntries = captureBundleSnapshots.map(entry => {
    const capture = parseJsonSnapshot(entry.captureSnapshot, 'An F8X records capture');
    const manifest = parseJsonSnapshot(entry.manifestSnapshot, 'An F8X capture manifest');
    const report = parseJsonSnapshot(entry.reportSnapshot, 'An F8X reconciliation report');
    const summary = validateF8xReconciliationReport(report);
    const expectedBasename = `${F8X_FINAL_PROFILES[summary.profileKey].artifactPrefix}-${summary.sectionKey}-reconciliation-report.json`;
    if (path.basename(entry.paths.report) !== expectedBasename) {
      fail(
        'invalid_f8x_capture_bundle_path',
        `F8X report content does not match its exact sibling basename: ${entry.paths.report}`,
      );
    }
    return {
      ...entry,
      capture,
      manifest,
      report,
      summary,
    };
  }).sort((left, right) => (
    EXPECTED_SCOPE_KEYS.indexOf(left.summary.scopeKey) - EXPECTED_SCOPE_KEYS.indexOf(right.summary.scopeKey)
  ));
  if (new Set(captureBundleEntries.map(entry => entry.summary.scopeKey)).size !== 21) {
    fail('duplicate_f8x_reconciliation_scope', 'The report files do not cover the exact 3×7 scope matrix.');
  }
  const captureBundles = captureBundleEntries.map(entry => ({
    capture: entry.capture,
    manifest: entry.manifest,
    report: entry.report,
  }));
  const captureBundleBinding = verifyF8xCaptureBundleBinding({
    captureBundles,
    importerAudit,
    aggregateProducts: parsedAggregate.products,
    aggregateQuarantinedEcsIdentities: parsedAggregate.quarantine,
  });
  await assertSnapshotsUnchanged([...graph.files.values()]);
  const currentModule = await import(`${pathToFileURL(graph.entry).href}?f8xFinalAudit=${graph.sha256}`);
  await assertSnapshotsUnchanged([...graph.files.values()]);
  const currentProducts = currentModule.REVIEWED_ECS_PRODUCTS;
  if (!Array.isArray(currentProducts) || typeof currentModule.mergeReviewedEcsProducts !== 'function') {
    fail('missing_module_export', 'The trusted current reviewed module lacks its products or merge function.');
  }
  try {
    const priorQuarantine = validatePriorReviewedQuarantineArtifact(
      priorQuarantineArtifact,
      shardRelease.releaseBinding,
      shardRelease.products,
      {
        products: parsedPriorAggregate.products,
        quarantine: parsedPriorAggregate.quarantine,
        moduleBytes: priorAggregateSnapshot.bytes,
        moduleSha256: priorAggregateSnapshot.sha256,
      },
    );
    const projectedQuarantine = new Set([...priorQuarantine, ...parsedAggregate.quarantine]);
    const survivingShards = shardRelease.products.filter(product => (
      !projectedQuarantine.has(ecsIdentity(product))
    ));
    const survivingOverlay = parsedAggregate.products.filter(product => (
      !projectedQuarantine.has(ecsIdentity(product))
    ));
    const survivingStatic = currentProducts.filter(product => (
      !projectedQuarantine.has(ecsIdentity(product))
    ));
    const currentShardHandles = new Map(survivingShards.map(product => (
      [ecsIdentity(product), [product.publicKey, product.slug]]
    )));
    const candidate = currentModule.mergeReviewedEcsProducts(survivingShards, survivingOverlay);
    const candidateByIdentity = new Map(candidate.map(product => [ecsIdentity(product), product]));
    for (const [identity, handles] of currentShardHandles) {
      const product = candidateByIdentity.get(identity);
      if (!product || product.publicKey !== handles[0] || product.slug !== handles[1]) throw new Error();
    }
    currentModule.mergeReviewedEcsProducts(survivingStatic, candidate);
  } catch {
    fail('candidate_merge_conflict', 'The F8X overlay conflicts with the current reviewed union or changes a stable shard handle.');
  }
  const checksums = checksumSummary({
    auditSnapshot, captureBundleEntries, aggregateSnapshot, parsedAggregate, graph, shardRelease,
    currentProducts, priorAggregateSnapshot, parsedPriorAggregate,
    priorQuarantineSnapshot, priorQuarantineArtifact,
  });
  const inputSetSha256 = dataSha256(checksums);
  if (expectedInputSetSha256 !== null
    && (!SHA256.test(expectedInputSetSha256) || expectedInputSetSha256 !== inputSetSha256)) {
    fail('checksum_drift', 'The F8X verified input-set checksum differs from the pinned checksum.');
  }
  const finalizedAudit = finalizeF8xReleaseAudit({
    importerAudit,
    reconciliationReports: captureBundleEntries.map(entry => entry.report),
    aggregateProducts: parsedAggregate.products,
    aggregateQuarantinedEcsIdentities: parsedAggregate.quarantine,
    captureBundleBinding,
    currentReviewedProducts: currentProducts,
    currentReviewedShardProducts: shardRelease.products,
    currentReviewedShardRelease: shardRelease.releaseBinding,
    priorReviewedQuarantineArtifact: priorQuarantineArtifact,
    priorAggregateProducts: parsedPriorAggregate.products,
    priorAggregateQuarantinedEcsIdentities: parsedPriorAggregate.quarantine,
    priorAggregateModuleBytes: priorAggregateSnapshot.bytes,
    priorAggregateModuleSha256: priorAggregateSnapshot.sha256,
    mergeReviewedProducts: currentModule.mergeReviewedEcsProducts,
    inputChecksums: checksums,
    inputSetSha256,
  });
  await assertSnapshotsUnchanged([
    auditSnapshot, aggregateSnapshot, priorAggregateSnapshot, priorQuarantineSnapshot,
    ...captureBundleSnapshots.flatMap(entry => [
      entry.captureSnapshot, entry.manifestSnapshot, entry.reportSnapshot,
    ]),
    ...graph.files.values(), ...shardRelease.snapshots,
  ]);
  return { finalizedAudit, inputSetSha256, checksums, roots };
}

async function confinedOutput(filename, roots) {
  const resolved = path.resolve(filename);
  const parent = await existingDirectory(path.dirname(resolved), 'invalid_output_parent');
  const parentStat = await stat(parent);
  const parentIdentity = Object.freeze({ path: parent, dev: parentStat.dev, ino: parentStat.ino });
  const allowed = rootFor(parent, roots.outputRoots);
  if (!allowed || !inside(allowed, resolved)) fail('output_path_escape', 'Output must stay in private-imports or the work directory.');
  try {
    await access(resolved);
    fail('output_exists', 'The final F8X release audit already exists.');
  } catch (error) {
    if (error instanceof F8xFinalReleaseAuditError) throw error;
    if (error?.code !== 'ENOENT') fail('invalid_output_path', 'The output path cannot be validated.');
  }
  return { resolved, parentIdentity };
}

async function assertOutputParentIdentity(expected) {
  try {
    const entry = await lstat(expected.path);
    const resolved = await realpath(expected.path);
    const details = await stat(resolved);
    if (!entry.isDirectory() || entry.isSymbolicLink() || !samePath(resolved, expected.path)
      || !sameFileIdentity(details, expected)) throw new Error();
  } catch {
    fail('output_path_escape', 'The output parent changed or became linked during the create-only write.');
  }
}

async function writeJsonCreateOnly(outputPath, value, roots, existsMessage) {
  const { resolved, parentIdentity } = await confinedOutput(outputPath, roots);
  const buffer = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  let handle;
  try {
    await assertOutputParentIdentity(parentIdentity);
    const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL
      | (fsConstants.O_NOFOLLOW || 0);
    handle = await open(resolved, flags, 0o600);
    const opened = await handle.stat();
    await handle.writeFile(buffer);
    await handle.sync();
    const entry = await lstat(resolved);
    const postResolved = await realpath(resolved);
    const current = await stat(postResolved);
    if (!entry.isFile() || entry.isSymbolicLink() || !samePath(postResolved, resolved)
      || !sameFileIdentity(opened, current) || opened.size !== 0 || current.size !== buffer.length) {
      fail('output_path_escape', 'The create-only output changed identity during the write.');
    }
    await assertOutputParentIdentity(parentIdentity);
  } catch (error) {
    if (error instanceof F8xFinalReleaseAuditError) throw error;
    if (error?.code === 'EEXIST') fail('output_exists', existsMessage);
    throw error;
  } finally {
    await handle?.close();
  }
  return { path: resolved, bytes: buffer.length, sha256: sha256(buffer) };
}

export async function writeF8xFinalReleaseAuditCreateOnly(outputPath, finalizedAudit, roots) {
  return writeJsonCreateOnly(
    outputPath,
    finalizedAudit,
    roots,
    'The final F8X release audit already exists.',
  );
}

export async function writePriorReviewedQuarantineCreateOnly(outputPath, artifact, roots) {
  return writeJsonCreateOnly(
    outputPath,
    artifact,
    roots,
    'The prior reviewed quarantine artifact already exists.',
  );
}

function parseArguments(argv) {
  const valued = new Set([
    '--audit', '--aggregate-module', '--prior-aggregate-module',
    '--current-reviewed-module', '--current-reviewed-shards',
    '--prior-quarantine', '--reconciliation', '--work-dir', '--output',
    '--expect-input-set-sha256',
  ]);
  const result = { reconciliationPaths: [], verifyOnly: false };
  const singles = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--verify-only') {
      if (result.verifyOnly) fail('invalid_arguments', 'Duplicate --verify-only.');
      result.verifyOnly = true;
      continue;
    }
    const value = argv[index + 1];
    if (!valued.has(name) || !value || value.startsWith('--')) fail('invalid_arguments', `Unsupported or incomplete option: ${name}`);
    index += 1;
    if (name === '--reconciliation') {
      result.reconciliationPaths.push(value);
      continue;
    }
    if (singles.has(name)) fail('invalid_arguments', `Duplicate option: ${name}`);
    singles.add(name);
    result[{
      '--audit': 'auditPath', '--aggregate-module': 'aggregateModulePath',
      '--prior-aggregate-module': 'priorAggregateModulePath',
      '--prior-quarantine': 'priorQuarantinePath',
      '--current-reviewed-module': 'currentReviewedModulePath',
      '--current-reviewed-shards': 'currentReviewedShardDirectory',
      '--work-dir': 'workDirectory', '--output': 'outputPath',
      '--expect-input-set-sha256': 'expectedInputSetSha256',
    }[name]] = value;
  }
  for (const key of [
    'auditPath', 'aggregateModulePath', 'priorAggregateModulePath', 'priorQuarantinePath',
    'currentReviewedModulePath', 'currentReviewedShardDirectory',
  ]) {
    if (!result[key]) {
      fail(
        'invalid_arguments',
        'Audit, aggregate module, exact prior aggregate, prior quarantine, current module and current shards are required.',
      );
    }
  }
  if (result.reconciliationPaths.length !== 21) fail('invalid_arguments', 'Exactly 21 --reconciliation options are required.');
  if (result.verifyOnly) {
    if (result.outputPath || result.expectedInputSetSha256) fail('invalid_arguments', '--verify-only cannot write or accept a pinned checksum.');
  } else if (!result.outputPath || !SHA256.test(result.expectedInputSetSha256 || '')) {
    fail('invalid_arguments', 'Write mode requires --output and --expect-input-set-sha256.');
  }
  return result;
}

function parsePriorQuarantineArguments(argv) {
  const valued = new Set([
    '--prior-aggregate-module', '--current-reviewed-shards', '--work-dir', '--output',
    '--expect-input-set-sha256',
  ]);
  const result = { verifyOnly: false };
  const singles = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--verify-only') {
      if (result.verifyOnly) fail('invalid_arguments', 'Duplicate --verify-only.');
      result.verifyOnly = true;
      continue;
    }
    const value = argv[index + 1];
    if (!valued.has(name) || !value || value.startsWith('--')) {
      fail('invalid_arguments', `Unsupported or incomplete prior-quarantine option: ${name}`);
    }
    index += 1;
    if (singles.has(name)) fail('invalid_arguments', `Duplicate option: ${name}`);
    singles.add(name);
    result[{
      '--prior-aggregate-module': 'priorAggregateModulePath',
      '--current-reviewed-shards': 'currentReviewedShardDirectory',
      '--work-dir': 'workDirectory',
      '--output': 'outputPath',
      '--expect-input-set-sha256': 'expectedInputSetSha256',
    }[name]] = value;
  }
  if (!result.priorAggregateModulePath || !result.currentReviewedShardDirectory) {
    fail('invalid_arguments', 'Prior-quarantine mode requires its aggregate module and current shards.');
  }
  if (result.verifyOnly) {
    if (result.outputPath || result.expectedInputSetSha256) {
      fail('invalid_arguments', '--verify-only cannot write or accept a pinned checksum.');
    }
  } else if (!result.outputPath || !SHA256.test(result.expectedInputSetSha256 || '')) {
    fail('invalid_arguments', 'Prior-quarantine write mode requires --output and --expect-input-set-sha256.');
  }
  return result;
}

export async function runF8xFinalReleaseAuditCli(argv) {
  if (argv[0] === 'prior-quarantine') {
    const options = parsePriorQuarantineArguments(argv.slice(1));
    const verified = await verifyPriorReviewedQuarantineFiles(options);
    if (options.verifyOnly) {
      return {
        status: 'prior-quarantine-verified-no-write',
        quarantinedIdentityCount: verified.artifact.quarantinedIdentityCount,
        inputSetSha256: verified.inputSetSha256,
      };
    }
    const output = await writePriorReviewedQuarantineCreateOnly(
      options.outputPath,
      verified.artifact,
      verified.roots,
    );
    return {
      status: 'prior-quarantine-created',
      quarantinedIdentityCount: verified.artifact.quarantinedIdentityCount,
      inputSetSha256: verified.inputSetSha256,
      output,
    };
  }
  const options = parseArguments(argv);
  const verified = await verifyF8xReleaseAuditFiles(options);
  if (options.verifyOnly) {
    return {
      status: 'verified-no-write', complete: true,
      productCount: verified.finalizedAudit.productCount, inputSetSha256: verified.inputSetSha256,
    };
  }
  const output = await writeF8xFinalReleaseAuditCreateOnly(options.outputPath, verified.finalizedAudit, verified.roots);
  return {
    status: 'created', complete: true, productCount: verified.finalizedAudit.productCount,
    inputSetSha256: verified.inputSetSha256, output,
  };
}

export const __test = Object.freeze({ moduleSpecifiers });

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runF8xFinalReleaseAuditCli(process.argv.slice(2))
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => {
      console.error(JSON.stringify({
        status: 'failed',
        code: error instanceof F8xFinalReleaseAuditError ? error.code : 'unexpected_error',
        message: error instanceof Error ? error.message : String(error),
      }));
      process.exitCode = 1;
    });
}
