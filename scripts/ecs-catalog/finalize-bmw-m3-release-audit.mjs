import { createHash } from 'node:crypto';
import {
  access,
  open,
  readFile,
  realpath,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const PRIVATE_IMPORTS = path.join(REPO, 'private-imports');
const TRUSTED_CURRENT_REVIEWED_MODULE = path.join(REPO, 'server', 'ecs-reviewed-catalog.js');
const SHA256 = /^[a-f0-9]{64}$/;
const ECS_IDENTITY = /^(?:ES\s*#?\s*)?(\d{3,12})$/i;
const CANONICAL_ECS_IDENTITY = /^\d{3,12}$/;
const ECS_LISTING_PAGE_SIZE = 16;
const AGGREGATE_MODULE_HEADER = '// Generated offline from a validated, dated ECS BMW M3 model-level category capture.\n';
const AGGREGATE_QUARANTINE_PREFIX = 'export const BMW_M3_AGGREGATE_QUARANTINED_ECS_IDENTITIES = Object.freeze(';
const AGGREGATE_PRODUCTS_PREFIX = 'export const BMW_M3_AGGREGATE_PRODUCTS = Object.freeze(';
const REQUIRED_LISTING_FIELDS = Object.freeze([
  'availabilityText',
  'ecsPartNumber',
  'manufacturerPartNumber',
  'priceText',
  'productUrl',
  'sourceUrl',
  'title',
]);
export const BMW_M3_FINAL_SECTIONS = Object.freeze({
  braking: Object.freeze({ label: 'Braking', path: 'Braking' }),
  engine: Object.freeze({ label: 'Engine', path: 'Engine' }),
  exterior: Object.freeze({ label: 'Exterior', path: 'Exterior' }),
  interior: Object.freeze({ label: 'Interior', path: 'Interior' }),
  performance: Object.freeze({ label: 'Performance', path: 'Performance' }),
  suspension: Object.freeze({ label: 'Suspension', path: 'Suspension' }),
  steering: Object.freeze({ label: 'Steering', path: 'Steering' }),
});
const SECTION_KEYS = Object.freeze(Object.keys(BMW_M3_FINAL_SECTIONS));

export class FinalReleaseAuditError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FinalReleaseAuditError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new FinalReleaseAuditError(code, message);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function integer(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum;
}

function exactTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  const canonical = new Date(milliseconds).toISOString();
  return canonical === value ? canonical : null;
}

function stableJson(value) {
  const seen = new Set();
  function normalize(item) {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) fail('invalid_input_data', 'Release-audit inputs may not contain non-finite numbers.');
      return item;
    }
    if (Array.isArray(item)) return item.map(entry => normalize(entry === undefined ? null : entry));
    if (plainObject(item)) {
      if (seen.has(item)) fail('invalid_input_data', 'Release-audit inputs may not contain circular objects.');
      seen.add(item);
      const result = {};
      for (const key of Object.keys(item).sort()) {
        const entry = item[key];
        if (entry !== undefined && typeof entry !== 'function' && typeof entry !== 'symbol') {
          result[key] = normalize(entry);
        }
      }
      seen.delete(item);
      return result;
    }
    fail('invalid_input_data', 'Release-audit inputs must contain JSON-compatible values only.');
  }
  return JSON.stringify(normalize(value));
}

function canonicalDataSha256(value) {
  return sha256(Buffer.from(stableJson(value), 'utf8'));
}

function aggregateModuleSource(products, quarantine) {
  return AGGREGATE_MODULE_HEADER
    + `${AGGREGATE_QUARANTINE_PREFIX}${JSON.stringify(quarantine, null, 2)});\n`
    + `${AGGREGATE_PRODUCTS_PREFIX}${JSON.stringify(products, null, 2)});\n`;
}

function balancedJsonArray(source, offset, label) {
  if (source[offset] !== '[') {
    fail('invalid_aggregate_module_format', `${label} must be an inline JSON array.`);
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = offset; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '[') depth += 1;
    else if (character === ']') {
      depth -= 1;
      if (depth === 0) {
        const json = source.slice(offset, index + 1);
        let value;
        try {
          value = JSON.parse(json);
        } catch {
          fail('invalid_aggregate_module_format', `${label} is not valid JSON.`);
        }
        if (!Array.isArray(value)) {
          fail('invalid_aggregate_module_format', `${label} must decode to an array.`);
        }
        return { value, cursor: index + 1 };
      }
      if (depth < 0) break;
    }
  }
  fail('invalid_aggregate_module_format', `${label} has an unterminated JSON array.`);
}

function exactAggregateModule(source) {
  if (typeof source !== 'string' || !source.startsWith(AGGREGATE_MODULE_HEADER)) {
    fail('invalid_aggregate_module_format', 'The aggregate module does not match the deterministic generator header.');
  }
  let cursor = AGGREGATE_MODULE_HEADER.length;
  if (!source.startsWith(AGGREGATE_QUARANTINE_PREFIX, cursor)) {
    fail('invalid_aggregate_module_format', 'The aggregate quarantine export is missing or out of order.');
  }
  cursor += AGGREGATE_QUARANTINE_PREFIX.length;
  const quarantine = balancedJsonArray(source, cursor, 'The aggregate quarantine export');
  cursor = quarantine.cursor;
  if (!source.startsWith(');\n', cursor)) {
    fail('invalid_aggregate_module_format', 'The aggregate quarantine export has executable or non-canonical content.');
  }
  cursor += 3;
  if (!source.startsWith(AGGREGATE_PRODUCTS_PREFIX, cursor)) {
    fail('invalid_aggregate_module_format', 'The aggregate product export is missing or out of order.');
  }
  cursor += AGGREGATE_PRODUCTS_PREFIX.length;
  const products = balancedJsonArray(source, cursor, 'The aggregate product export');
  cursor = products.cursor;
  if (!source.startsWith(');\n', cursor) || cursor + 3 !== source.length) {
    fail('invalid_aggregate_module_format', 'The aggregate module contains executable, trailing, or non-canonical content.');
  }
  if (source !== aggregateModuleSource(products.value, quarantine.value)) {
    fail('invalid_aggregate_module_format', 'The aggregate module is not the canonical deterministic generator output.');
  }
  return { products: products.value, quarantine: quarantine.value };
}

function ecsIdentity(product) {
  const candidates = [product?.ecsPartNumber, product?.identifiers?.ecs, product?.sku];
  for (const candidate of candidates) {
    const match = String(candidate ?? '').trim().match(ECS_IDENTITY);
    if (match) return match[1];
  }
  const publicKey = String(product?.publicKey ?? '').trim().match(/^ecs-es-(\d{3,12})$/i);
  return publicKey?.[1] || null;
}

function ecsIdentityCandidates(product) {
  const values = [product?.ecsPartNumber, product?.identifiers?.ecs, product?.sku]
    .map(value => String(value ?? '').trim())
    .filter(Boolean)
    .map(value => value.match(ECS_IDENTITY)?.[1] || null);
  const publicKey = String(product?.publicKey ?? '').trim();
  if (/^ecs-es-/i.test(publicKey)) values.push(publicKey.match(/^ecs-es-(\d{3,12})$/i)?.[1] || null);
  return values;
}

function quarantineIdentity(value) {
  const candidate = typeof value === 'string' ? value : value?.ecsPartNumber;
  return String(candidate ?? '').trim().match(ECS_IDENTITY)?.[1] || null;
}

function uniqueIdentities(products, label, { requireCanonicalHandles = false } = {}) {
  if (!Array.isArray(products)) fail('invalid_product_input', `${label} must export a product array.`);
  const identities = new Set();
  const publicKeys = new Set();
  const slugs = new Set();
  for (const [index, product] of products.entries()) {
    if (!plainObject(product)) fail('invalid_product_input', `${label} product ${index + 1} is invalid.`);
    const candidates = ecsIdentityCandidates(product);
    const candidateSet = new Set(candidates);
    const identity = ecsIdentity(product);
    if (!identity || candidates.some(value => !value) || candidateSet.size !== 1) {
      fail('invalid_product_identity', `${label} product ${index + 1} does not have one consistent canonical ECS identity.`);
    }
    if (requireCanonicalHandles) {
      const publicKey = String(product.publicKey ?? '');
      const slug = String(product.slug ?? '');
      if (publicKey !== `ecs-es-${identity}` || slug !== `es-${identity}`) {
        fail('invalid_product_handle', `${label} product ES#${identity} does not use its canonical publicKey and slug.`);
      }
      if (publicKeys.has(publicKey) || slugs.has(slug)) {
        fail('duplicate_product_handle', `${label} contains a duplicate publicKey or slug.`);
      }
      publicKeys.add(publicKey);
      slugs.add(slug);
    }
    if (identities.has(identity)) fail('duplicate_product_identity', `${label} contains duplicate ES#${identity}.`);
    identities.add(identity);
  }
  return identities;
}

function exactObjectKeys(value, expected) {
  if (!plainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function canonicalEcsCategoryUrl(value, section) {
  try {
    const url = new URL(String(value ?? '').trim());
    const prefix = `/bmw-m3/${section.path.toLocaleLowerCase('en-US')}/`;
    return url.protocol === 'https:' && url.hostname.toLocaleLowerCase('en-US') === 'www.ecstuning.com'
      && url.pathname.toLocaleLowerCase('en-US').startsWith(prefix)
      && !url.username && !url.password && !url.port && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function canonicalEcsSectionUrl(value, section) {
  try {
    const url = new URL(String(value ?? '').trim());
    return url.protocol === 'https:' && url.hostname.toLocaleLowerCase('en-US') === 'www.ecstuning.com'
      && url.pathname.toLocaleLowerCase('en-US') === `/bmw-m3/${section.path.toLocaleLowerCase('en-US')}/`
      && !url.username && !url.password && !url.port && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function sectionKeyFromReport(report) {
  if (!plainObject(report?.scope)) return null;
  return SECTION_KEYS.find(key => BMW_M3_FINAL_SECTIONS[key].label === report.scope.section) || null;
}

function validateCategoryAudit(category, section, position) {
  if (!plainObject(category) || typeof category.key !== 'string' || !category.key.trim()
    || typeof category.name !== 'string' || !category.name.trim()
    || !canonicalEcsCategoryUrl(category.sourceUrl, section)
    || !integer(category.count) || !integer(category.expectedPages, 1)
    || !integer(category.pages, 1) || category.pages !== category.expectedPages
    || !Array.isArray(category.pageCounts) || category.pageCounts.length !== category.pages
    || !category.pageCounts.every(count => integer(count, 1))
    || category.pageCounts.reduce((total, count) => total + count, 0) !== category.count
    || !Array.isArray(category.pageUrls) || category.pageUrls.length !== category.pages
    || !category.pageUrls.every(url => canonicalEcsCategoryUrl(url, section))
    || category.positionsContiguous !== true || category.observedCount !== category.count
    || category.exact !== true) {
    fail('unreconciled_category', `${section.label} category audit ${position + 1} is not exact and complete.`);
  }
  const expectedPageUrls = Array.from({ length: category.pages }, (_, index) => (
    index === 0 ? category.sourceUrl : `${category.sourceUrl}${index + 1}`
  ));
  const expectedPages = Math.ceil(category.count / ECS_LISTING_PAGE_SIZE);
  const expectedPageCounts = Array.from({ length: expectedPages }, (_, index) => (
    index < expectedPages - 1
      ? ECS_LISTING_PAGE_SIZE
      : category.count - (ECS_LISTING_PAGE_SIZE * (expectedPages - 1))
  ));
  if (category.expectedPages !== expectedPages
    || category.pages !== expectedPages
    || category.pageCounts.length !== expectedPageCounts.length
    || category.pageCounts.some((count, index) => count !== expectedPageCounts[index])
    || new Set(category.pageUrls).size !== category.pageUrls.length
    || category.pageUrls.some((url, index) => url !== expectedPageUrls[index])) {
    fail('unreconciled_category', `${section.label} category audit ${position + 1} has an invalid page shape or duplicate, reordered, or non-canonical pagination.`);
  }
}

export function validateFinalReconciliationReport(report) {
  const key = sectionKeyFromReport(report);
  const section = key ? BMW_M3_FINAL_SECTIONS[key] : null;
  if (!section || report?.schemaVersion !== 1 || report?.supplier !== 'ECS Tuning'
    || report?.accessClass !== 'public-retail'
    || report?.kind !== `bmw-m3-${key}-reconciliation-report`
    || !exactTimestamp(report?.captureStartedAt) || !exactTimestamp(report?.generatedAt)
    || report.captureStartedAt > report.generatedAt || report.scope.vehicle !== 'BMW M3'
    || report?.source?.rootUrl !== 'https://www.ecstuning.com/BMW-M3/'
    || !canonicalEcsSectionUrl(report?.source?.sectionUrl, section)) {
    fail('invalid_reconciliation_report', 'A BMW M3 reconciliation report has an invalid identity or scope.');
  }
  const completeness = report.completeness;
  const categoryAudit = completeness?.categoryAudit;
  if (completeness?.complete !== true || completeness?.status !== 'reconciled'
    || !Array.isArray(categoryAudit) || !categoryAudit.length
    || report.scope.categories !== categoryAudit.length
    || completeness.exactCategories !== categoryAudit.length) {
    fail('incomplete_reconciliation_report', `${section.label} is not fully reconciled.`);
  }
  const categoryKeys = new Set();
  const categoryNames = new Set();
  const sectionPageUrls = new Set();
  categoryAudit.forEach((category, index) => {
    validateCategoryAudit(category, section, index);
    if (categoryKeys.has(category.key) || categoryNames.has(category.name)) {
      fail('duplicate_reconciliation_category', `${section.label} contains a duplicate category audit.`);
    }
    categoryKeys.add(category.key);
    categoryNames.add(category.name);
    for (const pageUrl of category.pageUrls) {
      if (sectionPageUrls.has(pageUrl)) {
        fail('duplicate_reconciliation_page', `${section.label} reuses a captured page URL across categories.`);
      }
      sectionPageUrls.add(pageUrl);
    }
  });
  const expectedPages = categoryAudit.reduce((total, category) => total + category.expectedPages, 0);
  const capturedPages = categoryAudit.reduce((total, category) => total + category.pages, 0);
  const placements = categoryAudit.reduce((total, category) => total + category.count, 0);
  if (!integer(report.scope.expectedPages, 1) || report.scope.expectedPages !== expectedPages
    || report.scope.capturedPages !== capturedPages || capturedPages !== expectedPages
    || !integer(report.scope.expectedPlacements, 1) || report.scope.expectedPlacements !== placements
    || report.scope.capturedPlacements !== placements
    || !integer(report.scope.uniqueEcsProducts, 1)
    || report.scope.uniqueEcsProducts > placements
    || report.scope.crossCategoryRepeatPlacements !== placements - report.scope.uniqueEcsProducts) {
    fail('reconciliation_count_mismatch', `${section.label} page, placement, or identity counts do not reconcile.`);
  }
  if (!exactObjectKeys(completeness.requiredMissing, REQUIRED_LISTING_FIELDS)
    || Object.values(completeness.requiredMissing).some(count => count !== 0)) {
    fail('required_fields_missing', `${section.label} has missing required listing fields.`);
  }
  if (!Array.isArray(completeness.duplicatePlacements) || completeness.duplicatePlacements.length
    || !Array.isArray(report?.consistency?.identityConflicts) || report.consistency.identityConflicts.length) {
    fail('reconciliation_conflict', `${section.label} has duplicate placements or identity conflicts.`);
  }
  const safeguards = report.safeguards;
  if (safeguards?.publicRetailOnly !== true || safeguards?.challengeBypassUsed !== false
    || safeguards?.guessedCategoryRoutes !== false || safeguards?.guessedPaginationRoutes !== false
    || (Object.hasOwn(safeguards, 'checkpointResumeUrlsValidated')
      && safeguards.checkpointResumeUrlsValidated !== true)
    || (Object.hasOwn(safeguards, 'nextUncheckpointPageValidated')
      && safeguards.nextUncheckpointPageValidated !== true)
    || (Object.hasOwn(safeguards, 'liveStockClaim') && safeguards.liveStockClaim !== false)) {
    fail('unsafe_reconciliation_report', `${section.label} does not satisfy the public-retail capture safeguards.`);
  }
  return {
    key,
    label: section.label,
    generatedAt: report.generatedAt,
    capturedPages,
    expectedPages,
    capturedPlacements: placements,
    expectedPlacements: placements,
    uniqueEcsProductsObserved: report.scope.uniqueEcsProducts,
    categories: [...categoryNames].sort((left, right) => left.localeCompare(right, 'en')),
  };
}

function validateImporterAudit(audit, products, quarantinedIdentities) {
  if (!plainObject(audit) || audit.schemaVersion !== 1 || audit.supplier !== 'ECS Tuning'
    || audit.kind !== 'bmw-m3-aggregate-import-audit'
    || audit.sourceKind !== 'bmw-m3-aggregate-listing-capture'
    || !exactTimestamp(audit.generatedAt) || audit.sourceGeneratedAt !== audit.generatedAt
    || Object.hasOwn(audit, 'captureProgress') || Object.hasOwn(audit, 'publicationMergeAudit')) {
    fail('invalid_importer_audit', 'The input must be an unfinalized BMW M3 importer audit.');
  }
  const productIdentities = uniqueIdentities(products, 'BMW M3 aggregate module', {
    requireCanonicalHandles: true,
  });
  if (!Array.isArray(quarantinedIdentities) || !Array.isArray(audit.quarantine)
    || !Array.isArray(audit.invalidRecords)) {
    fail('invalid_importer_audit', 'The importer audit does not contain the required quarantine arrays.');
  }
  if (!exactObjectKeys(audit.sections, SECTION_KEYS)) {
    fail('invalid_audit_sections', 'The importer audit must contain exactly the seven BMW M3 sections.');
  }
  const moduleQuarantine = quarantinedIdentities.map(value => (
    typeof value === 'string' && CANONICAL_ECS_IDENTITY.test(value) ? value : null
  ));
  const auditQuarantine = audit.quarantine.map(quarantineIdentity);
  if (moduleQuarantine.some(value => !value) || auditQuarantine.some(value => !value)
    || new Set(moduleQuarantine).size !== moduleQuarantine.length
    || new Set(auditQuarantine).size !== auditQuarantine.length
    || moduleQuarantine.slice().sort().join(',') !== auditQuarantine.slice().sort().join(',')) {
    fail('quarantine_mismatch', 'The aggregate module and importer audit quarantine identities differ.');
  }
  if (moduleQuarantine.some(identity => productIdentities.has(identity))) {
    fail('product_quarantine_overlap', 'A generated product also appears in the quarantine set.');
  }
  const seenQuarantinedRecordIndexes = new Set();
  const quarantineSectionsByIdentity = new Map();
  const quarantinedRecordCount = audit.quarantine.reduce((total, item, itemIndex) => {
    const sectionKeys = Array.isArray(item?.sections) ? item.sections.map(label => (
      SECTION_KEYS.find(key => BMW_M3_FINAL_SECTIONS[key].label === label) || null
    )) : [];
    if (!Array.isArray(item?.recordIndexes) || !item.recordIndexes.length
      || !item.recordIndexes.every(index => integer(index) && index < audit.rawRecordCount)
      || new Set(item.recordIndexes).size !== item.recordIndexes.length
      || item.recordIndexes.some(index => seenQuarantinedRecordIndexes.has(index))) {
      fail('invalid_quarantine_record', 'A quarantine entry has invalid record indexes.');
    }
    if (!sectionKeys.length || sectionKeys.some(key => !key)
      || new Set(sectionKeys).size !== sectionKeys.length
      || sectionKeys.length > item.recordIndexes.length
      || sectionKeys.some(key => !integer(audit.sections[key]?.observationCount, 1))) {
      fail('invalid_quarantine_section', 'A quarantine entry has missing, unknown, duplicate, or inconsistent section evidence.');
    }
    item.recordIndexes.forEach(index => seenQuarantinedRecordIndexes.add(index));
    quarantineSectionsByIdentity.set(auditQuarantine[itemIndex], new Set(sectionKeys));
    return total + item.recordIndexes.length;
  }, 0);
  if (audit.productCount !== products.length
    || audit.quarantinedIdentityCount !== moduleQuarantine.length
    || audit.quarantinedRecordCount !== quarantinedRecordCount
    || audit.uniqueValidatedEcsIdentityCount !== products.length + moduleQuarantine.length
    || !integer(audit.rawRecordCount, 1) || !integer(audit.validatedRecordCount, 1)
    || audit.invalidRecordCount !== audit.invalidRecords.length || audit.invalidRecordCount !== 0
    || audit.validatedRecordCount + audit.invalidRecordCount !== audit.rawRecordCount
    || audit.duplicateObservationCount !== audit.validatedRecordCount - audit.uniqueValidatedEcsIdentityCount) {
    fail('product_quarantine_count_mismatch', 'Importer product, quarantine, validation, or observation counts do not reconcile.');
  }
  return { productIdentities, moduleQuarantine, quarantineSectionsByIdentity };
}

function actualProductSectionCounts(products, reportSummaries) {
  const counts = Object.fromEntries(SECTION_KEYS.map(key => [key, 0]));
  const identities = Object.fromEntries(SECTION_KEYS.map(key => [key, new Set()]));
  const categorySets = Object.fromEntries(SECTION_KEYS.map(key => [key, new Set(reportSummaries[key].categories)]));
  for (const product of products) {
    if (!Array.isArray(product.selectionSources) || !product.selectionSources.length) {
      fail('missing_product_selection_source', `ES#${ecsIdentity(product)} has no BMW M3 selection source.`);
    }
    const productSections = new Set();
    for (const source of product.selectionSources) {
      const key = SECTION_KEYS.find(candidate => BMW_M3_FINAL_SECTIONS[candidate].label === source?.section);
      if (!key || !categorySets[key].has(source?.category)) {
        fail('product_scope_mismatch', `ES#${ecsIdentity(product)} references an unverified BMW M3 section or category.`);
      }
      productSections.add(key);
    }
    for (const key of productSections) {
      counts[key] += 1;
      identities[key].add(ecsIdentity(product));
    }
  }
  return { counts, identities };
}

export function finalizeBmwM3ReleaseAudit({
  importerAudit,
  reconciliationReports,
  aggregateProducts,
  aggregateQuarantinedEcsIdentities,
  currentReviewedProducts,
  inputChecksums = null,
  inputSetSha256 = null,
}) {
  if (!Array.isArray(reconciliationReports) || reconciliationReports.length !== SECTION_KEYS.length) {
    fail('reconciliation_report_count', 'Exactly seven reconciliation reports are required.');
  }
  const summaries = {};
  for (const report of reconciliationReports) {
    const summary = validateFinalReconciliationReport(report);
    if (summaries[summary.key]) fail('duplicate_reconciliation_section', `Duplicate ${summary.label} reconciliation report.`);
    summaries[summary.key] = summary;
  }
  if (!exactObjectKeys(summaries, SECTION_KEYS)) {
    fail('missing_reconciliation_section', 'All seven BMW M3 reconciliation sections are required.');
  }
  const { productIdentities, moduleQuarantine, quarantineSectionsByIdentity } = validateImporterAudit(
    importerAudit,
    aggregateProducts,
    aggregateQuarantinedEcsIdentities,
  );
  const currentIdentities = uniqueIdentities(currentReviewedProducts, 'Current reviewed ECS input');
  const latestReportTimestamp = SECTION_KEYS.map(key => summaries[key].generatedAt).sort().at(-1);
  if (latestReportTimestamp !== importerAudit.generatedAt) {
    fail('stale_importer_audit', 'The importer audit timestamp does not match the latest reconciliation report.');
  }
  const actualSectionEvidence = actualProductSectionCounts(aggregateProducts, summaries);
  for (const identity of moduleQuarantine) {
    for (const key of quarantineSectionsByIdentity.get(identity)) {
      actualSectionEvidence.identities[key].add(identity);
    }
  }
  let observedRecords = 0;
  for (const key of SECTION_KEYS) {
    const summary = summaries[key];
    const sectionAudit = importerAudit.sections[key];
    observedRecords += summary.capturedPlacements;
    const auditCategories = Array.isArray(sectionAudit?.categories)
      ? [...sectionAudit.categories].sort((left, right) => left.localeCompare(right, 'en')) : null;
    if (sectionAudit?.label !== summary.label
      || sectionAudit?.observationCount !== summary.capturedPlacements
      || sectionAudit?.productCount !== actualSectionEvidence.counts[key]
      || !auditCategories || stableJson(auditCategories) !== stableJson(summary.categories)) {
      fail('stale_section_audit', `${summary.label} importer counts or categories do not match its reconciliation report and products.`);
    }
    if (summary.uniqueEcsProductsObserved !== actualSectionEvidence.identities[key].size) {
      fail('stale_section_identity_count', `${summary.label} unique-product count does not match aggregate and quarantine identity evidence.`);
    }
  }
  if (observedRecords !== importerAudit.rawRecordCount
    || observedRecords !== importerAudit.validatedRecordCount) {
    fail('stale_aggregate_counts', 'Seven-section placement totals do not match the importer record counts.');
  }
  const overlap = [...productIdentities].filter(identity => currentIdentities.has(identity)).length;
  const currentReviewedRemovedByIncomingQuarantineCount = moduleQuarantine
    .filter(identity => currentIdentities.has(identity)).length;
  const publicationMergeAudit = {
    staticReviewedProductCount: currentReviewedProducts.length,
    generatedProductCount: aggregateProducts.length,
    overlapWithPreviouslyReviewedEcsCount: overlap,
    newUniqueProductCount: aggregateProducts.length - overlap,
    currentReviewedRemovedByIncomingQuarantineCount,
    projectedPublishedReviewedEcsCount: currentReviewedProducts.length + aggregateProducts.length
      - overlap - currentReviewedRemovedByIncomingQuarantineCount,
  };
  const sections = Object.fromEntries(SECTION_KEYS.map(key => [key, {
    label: summaries[key].label,
    status: 'reconciled-and-included',
    complete: true,
    capturedPages: summaries[key].capturedPages,
    expectedPages: summaries[key].expectedPages,
    capturedPlacements: summaries[key].capturedPlacements,
    expectedPlacements: summaries[key].expectedPlacements,
    uniqueEcsProductsObserved: summaries[key].uniqueEcsProductsObserved,
    reconciliationGeneratedAt: summaries[key].generatedAt,
    ...(inputChecksums?.reconciliationReports?.[key]?.sha256
      ? { reconciliationSha256: inputChecksums.reconciliationReports[key].sha256 } : {}),
  }]));
  const captureProgress = {
    stage: 'complete',
    complete: true,
    importPolicy: 'all-seven-reconciled-sections',
    requestedSectionCount: SECTION_KEYS.length,
    includedSectionCount: SECTION_KEYS.length,
    includedSections: [...SECTION_KEYS],
    excludedSections: [],
    sections,
  };
  return {
    ...importerAudit,
    publicationMergeAudit,
    captureProgress,
    finalReleaseAudit: {
      schemaVersion: 1,
      kind: 'bmw-m3-final-release-audit-verification',
      verifiedAtSourceTimestamp: importerAudit.generatedAt,
      ...(inputSetSha256 ? { inputSetSha256 } : {}),
      ...(inputChecksums ? { inputChecksums } : {}),
    },
  };
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function existingDirectory(filename, code) {
  let resolved;
  try {
    resolved = await realpath(filename);
    if (!(await stat(resolved)).isDirectory()) throw new Error();
  } catch {
    fail(code, `Required directory is missing or invalid: ${filename}`);
  }
  return resolved;
}

async function allowedRoots(workDirectory = null) {
  const repo = await existingDirectory(REPO, 'invalid_repository_root');
  const privateImports = await existingDirectory(PRIVATE_IMPORTS, 'invalid_private_import_root');
  if (!inside(repo, privateImports)) {
    fail('invalid_private_import_root', 'The repository private-imports directory may not resolve outside the repository.');
  }
  const inputRoots = [repo];
  const outputRoots = [privateImports];
  let work = null;
  if (workDirectory) {
    if (!path.isAbsolute(workDirectory)) fail('invalid_work_directory', 'The designated work directory must be absolute.');
    work = await existingDirectory(workDirectory, 'invalid_work_directory');
    if (inside(repo, work) || path.parse(work).root === work) {
      fail('invalid_work_directory', 'The designated work directory must be a non-root directory outside the repository.');
    }
    inputRoots.push(work);
    outputRoots.push(work);
  }
  return { repo, privateImports, work, inputRoots, outputRoots };
}

function rootFor(target, roots) {
  return roots.find(root => inside(root, target)) || null;
}

async function confinedInput(filename, roots) {
  if (!filename || !path.isAbsolute(path.resolve(filename))) fail('invalid_input_path', 'Input paths must resolve to files.');
  let resolved;
  try {
    resolved = await realpath(path.resolve(filename));
    if (!(await stat(resolved)).isFile()) throw new Error();
  } catch {
    fail('invalid_input_path', `Input file is missing or invalid: ${filename}`);
  }
  if (!rootFor(resolved, roots.inputRoots)) fail('input_path_escape', `Input escapes the repository/designated work directory: ${filename}`);
  return resolved;
}

async function confinedOutput(filename, roots) {
  if (!filename || !path.isAbsolute(path.resolve(filename))) fail('invalid_output_path', 'An output path is required.');
  const resolved = path.resolve(filename);
  const parent = await existingDirectory(path.dirname(resolved), 'invalid_output_parent');
  const allowed = rootFor(parent, roots.outputRoots);
  if (!allowed || !inside(allowed, resolved)) {
    fail('output_path_escape', 'Output must stay inside private-imports or the explicitly designated non-repository work directory.');
  }
  try {
    await access(resolved);
    fail('output_exists', 'The final release audit output already exists; create-only mode will not overwrite it.');
  } catch (error) {
    if (error instanceof FinalReleaseAuditError) throw error;
    if (error?.code !== 'ENOENT') fail('invalid_output_path', 'The output path cannot be validated safely.');
  }
  return resolved;
}

async function fileSnapshot(filename, roots) {
  const resolved = await confinedInput(filename, roots);
  const bytes = await readFile(resolved);
  return { path: resolved, bytes: bytes.length, sha256: sha256(bytes), buffer: bytes };
}

async function aggregateModuleSnapshot(filename, roots) {
  const snapshot = await fileSnapshot(filename, roots);
  if (!/\.(?:m?js)$/i.test(snapshot.path)) {
    fail('invalid_aggregate_module_format', 'The aggregate product input must be a generated JavaScript module.');
  }
  const parsed = exactAggregateModule(snapshot.buffer.toString('utf8'));
  const descriptors = [{
    label: sourceLabel(snapshot.path, roots),
    bytes: snapshot.bytes,
    sha256: snapshot.sha256,
  }];
  return {
    snapshot,
    descriptors,
    sha256: canonicalDataSha256(descriptors),
    products: parsed.products,
    quarantine: parsed.quarantine,
  };
}

function sourceLabel(filename, roots) {
  if (inside(roots.repo, filename)) return `repo:${path.relative(roots.repo, filename).replaceAll('\\', '/')}`;
  if (roots.work && inside(roots.work, filename)) return `work:${path.relative(roots.work, filename).replaceAll('\\', '/')}`;
  fail('module_path_escape', 'A module dependency escapes the repository/designated work directory.');
}

function moduleSpecifiers(source) {
  if (hasCommentSeparatedModuleSyntax(source)) {
    fail('unsupported_module_dependency', 'Comments may not separate import, export, or from tokens in the trusted current-reviewed module graph.');
  }
  if (/\bimport\s*(?:\/\*[\s\S]*?\*\/\s*)?\(/.test(source)) {
    fail('unsupported_module_dependency', 'Dynamic imports are not allowed in the trusted current-reviewed module graph.');
  }
  const specifiers = new Set();
  const patterns = [
    /\b(?:import|export)\s*(?:[^'";]*?\bfrom\s*)?['"]([^'"]+)['"]/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) specifiers.add(match[1]);
  }
  return [...specifiers];
}

function hasCommentSeparatedModuleSyntax(source) {
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === '"' || character === "'" || character === '`') {
      const quote = character;
      index += 1;
      let escaped = false;
      while (index < source.length) {
        const current = source[index];
        index += 1;
        if (escaped) escaped = false;
        else if (current === '\\') escaped = true;
        else if (current === quote) break;
      }
      continue;
    }
    if (character === '/' && source[index + 1] === '/') {
      index = source.indexOf('\n', index + 2);
      if (index === -1) return false;
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      if (end === -1) return false;
      index = end + 2;
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) index += 1;
      const identifier = source.slice(start, index);
      if (identifier === 'import' || identifier === 'export' || identifier === 'from') {
        let cursor = index;
        while (/\s/.test(source[cursor] || '')) cursor += 1;
        if (source[cursor] === '/' && (source[cursor + 1] === '/' || source[cursor + 1] === '*')) {
          return true;
        }
      }
      continue;
    }
    index += 1;
  }
  return false;
}

function trustedModuleSpecifier(specifier) {
  if (specifier.startsWith('node:')) {
    fail('unsupported_module_dependency', `node: dependencies are not allowed in the trusted current-reviewed module graph (${specifier}).`);
  }
  if (!specifier.startsWith('.')) {
    fail('unsupported_module_dependency', `The trusted current-reviewed module graph may use only local repository files (${specifier}).`);
  }
  return specifier;
}

async function resolveModuleSpecifier(parent, specifier, allowedRoot) {
  trustedModuleSpecifier(specifier);
  const base = path.resolve(path.dirname(parent), specifier);
  for (const candidate of [base, `${base}.js`, `${base}.mjs`, `${base}.json`, path.join(base, 'index.js')]) {
    try {
      const resolved = await realpath(candidate);
      if ((await stat(resolved)).isFile()) {
        if (!inside(allowedRoot, resolved)) fail('module_path_escape', `Module dependency escapes the trusted repository root: ${specifier}`);
        return resolved;
      }
    } catch (error) {
      if (error instanceof FinalReleaseAuditError) throw error;
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
    }
  }
  fail('missing_module_dependency', `Local module dependency cannot be resolved: ${specifier}`);
}

async function moduleGraph(entryPath, roots, { trustedEntry = null, allowedRoot = roots.repo } = {}) {
  const entry = await confinedInput(entryPath, roots);
  if (!/\.(?:m?js)$/i.test(entry)) fail('invalid_module_path', 'Product inputs must be JavaScript modules.');
  if (trustedEntry && entry !== trustedEntry) {
    fail('untrusted_current_reviewed_module', 'The current-reviewed module must be the exact trusted repository server module.');
  }
  const pending = [entry];
  const files = new Map();
  while (pending.length) {
    const filename = pending.pop();
    if (files.has(filename)) continue;
    const bytes = await readFile(filename);
    const record = { path: filename, bytes: bytes.length, sha256: sha256(bytes) };
    files.set(filename, record);
    const source = bytes.toString('utf8');
    for (const specifier of moduleSpecifiers(source)) {
      const dependency = await resolveModuleSpecifier(filename, specifier, allowedRoot);
      if (dependency && !files.has(dependency)) pending.push(dependency);
    }
  }
  const descriptors = [...files.values()].map(record => ({
    label: sourceLabel(record.path, roots), bytes: record.bytes, sha256: record.sha256,
  })).sort((left, right) => left.label.localeCompare(right.label, 'en'));
  return {
    entry,
    files,
    descriptors,
    sha256: canonicalDataSha256(descriptors),
  };
}

async function importGraph(graph) {
  const module = await import(`${pathToFileURL(graph.entry).href}?finalReleaseAudit=${graph.sha256}`);
  return module;
}

async function assertSnapshotsUnchanged(snapshots) {
  for (const snapshot of snapshots.values()) {
    let resolved;
    let bytes;
    try {
      resolved = await realpath(snapshot.path);
      bytes = await readFile(resolved);
    } catch {
      fail('checksum_drift', `Release-audit input disappeared during verification: ${snapshot.path}`);
    }
    if (resolved !== snapshot.path || bytes.length !== snapshot.bytes || sha256(bytes) !== snapshot.sha256) {
      fail('checksum_drift', `Release-audit input changed during verification: ${snapshot.path}`);
    }
  }
}

function snapshotMap(...groups) {
  const result = new Map();
  for (const group of groups) {
    for (const snapshot of group) {
      const prior = result.get(snapshot.path);
      if (prior && (prior.bytes !== snapshot.bytes || prior.sha256 !== snapshot.sha256)) {
        fail('checksum_drift', `Conflicting snapshots were read for ${snapshot.path}.`);
      }
      result.set(snapshot.path, snapshot);
    }
  }
  return result;
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

function checksumSummary({ auditSnapshot, reportEntries, aggregateGraph, currentGraph, products, quarantine, currentProducts }) {
  const reports = Object.fromEntries(reportEntries.map(({ key, snapshot }) => [key, {
    bytes: snapshot.bytes,
    sha256: snapshot.sha256,
  }]));
  return {
    importerAudit: { bytes: auditSnapshot.bytes, sha256: auditSnapshot.sha256 },
    reconciliationReports: reports,
    aggregateModuleGraph: {
      fileCount: aggregateGraph.descriptors.length,
      sha256: aggregateGraph.sha256,
    },
    currentReviewedModuleGraph: {
      fileCount: currentGraph.descriptors.length,
      sha256: currentGraph.sha256,
    },
    aggregateProducts: { count: products.length, sha256: canonicalDataSha256(products) },
    aggregateQuarantine: { count: quarantine.length, sha256: canonicalDataSha256(quarantine.map(String).sort()) },
    currentReviewedProducts: { count: currentProducts.length, sha256: canonicalDataSha256(currentProducts) },
  };
}

export async function verifyBmwM3ReleaseAuditFiles({
  auditPath,
  aggregateModulePath,
  currentReviewedModulePath,
  reconciliationPaths,
  workDirectory = null,
  expectedInputSetSha256 = null,
}) {
  const roots = await allowedRoots(workDirectory);
  const auditSnapshot = await fileSnapshot(auditPath, roots);
  if (!Array.isArray(reconciliationPaths) || reconciliationPaths.length !== SECTION_KEYS.length) {
    fail('reconciliation_report_count', 'Exactly seven reconciliation report paths are required.');
  }
  const reportSnapshots = await Promise.all(reconciliationPaths.map(filename => fileSnapshot(filename, roots)));
  const reportEntries = reportSnapshots.map(snapshot => {
    const report = parseJsonSnapshot(snapshot, 'A reconciliation report');
    const summary = validateFinalReconciliationReport(report);
    return { key: summary.key, report, snapshot };
  });
  if (new Set(reportEntries.map(entry => entry.key)).size !== SECTION_KEYS.length) {
    fail('duplicate_reconciliation_section', 'The seven reconciliation files must cover each section exactly once.');
  }
  reportEntries.sort((left, right) => SECTION_KEYS.indexOf(left.key) - SECTION_KEYS.indexOf(right.key));
  const trustedCurrentEntry = await confinedInput(TRUSTED_CURRENT_REVIEWED_MODULE, roots);
  const [aggregateGraph, currentGraph] = await Promise.all([
    aggregateModuleSnapshot(aggregateModulePath, roots),
    moduleGraph(currentReviewedModulePath, roots, {
      trustedEntry: trustedCurrentEntry,
      allowedRoot: roots.repo,
    }),
  ]);
  const currentModule = await importGraph(currentGraph);
  const products = aggregateGraph.products;
  const quarantine = aggregateGraph.quarantine;
  const currentProducts = currentModule.REVIEWED_ECS_PRODUCTS;
  if (!Array.isArray(products) || !Array.isArray(quarantine) || !Array.isArray(currentProducts)) {
    fail('missing_module_export', 'Product modules do not expose the required reviewed ECS arrays.');
  }
  const checksums = checksumSummary({
    auditSnapshot,
    reportEntries,
    aggregateGraph,
    currentGraph,
    products,
    quarantine,
    currentProducts,
  });
  const inputSet = canonicalDataSha256(checksums);
  if (expectedInputSetSha256 !== null
    && (!SHA256.test(expectedInputSetSha256) || expectedInputSetSha256 !== inputSet)) {
    fail('checksum_drift', 'The verified input-set checksum differs from the pinned checksum.');
  }
  const finalizedAudit = finalizeBmwM3ReleaseAudit({
    importerAudit: parseJsonSnapshot(auditSnapshot, 'The importer audit'),
    reconciliationReports: reportEntries.map(entry => entry.report),
    aggregateProducts: products,
    aggregateQuarantinedEcsIdentities: quarantine,
    currentReviewedProducts: currentProducts,
    inputChecksums: checksums,
    inputSetSha256: inputSet,
  });
  const snapshots = snapshotMap(
    [auditSnapshot, ...reportSnapshots, aggregateGraph.snapshot],
    [...currentGraph.files.values()],
  );
  await assertSnapshotsUnchanged(snapshots);
  return { finalizedAudit, inputSetSha256: inputSet, checksums, roots };
}

export async function writeFinalReleaseAuditCreateOnly(outputPath, finalizedAudit, roots) {
  const resolved = await confinedOutput(outputPath, roots);
  const bytes = Buffer.from(`${JSON.stringify(finalizedAudit, null, 2)}\n`, 'utf8');
  let handle;
  try {
    handle = await open(resolved, 'wx', 0o600);
    await handle.writeFile(bytes);
  } catch (error) {
    if (error?.code === 'EEXIST') fail('output_exists', 'The final release audit output already exists; create-only mode will not overwrite it.');
    throw error;
  } finally {
    await handle?.close();
  }
  return { path: resolved, bytes: bytes.length, sha256: sha256(bytes) };
}

function parseArguments(argv) {
  const valued = new Set([
    '--audit', '--aggregate-module', '--current-reviewed-module', '--reconciliation',
    '--output', '--work-dir', '--expect-input-set-sha256',
  ]);
  const result = { reconciliationPaths: [], verifyOnly: false };
  const single = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--verify-only') {
      if (result.verifyOnly) fail('invalid_arguments', 'Duplicate --verify-only option.');
      result.verifyOnly = true;
      continue;
    }
    if (!valued.has(name) || argv[index + 1] === undefined || argv[index + 1].startsWith('--')) {
      fail('invalid_arguments', `Unsupported or incomplete option: ${name}`);
    }
    const value = argv[index + 1];
    index += 1;
    if (name === '--reconciliation') {
      result.reconciliationPaths.push(value);
      continue;
    }
    if (single.has(name)) fail('invalid_arguments', `Duplicate option: ${name}`);
    single.add(name);
    const key = {
      '--audit': 'auditPath',
      '--aggregate-module': 'aggregateModulePath',
      '--current-reviewed-module': 'currentReviewedModulePath',
      '--output': 'outputPath',
      '--work-dir': 'workDirectory',
      '--expect-input-set-sha256': 'expectedInputSetSha256',
    }[name];
    result[key] = value;
  }
  for (const key of ['auditPath', 'aggregateModulePath', 'currentReviewedModulePath']) {
    if (!result[key]) fail('invalid_arguments', 'Audit, aggregate module, and current-reviewed module paths are required.');
  }
  if (result.reconciliationPaths.length !== SECTION_KEYS.length) {
    fail('invalid_arguments', 'Exactly seven --reconciliation options are required.');
  }
  if (result.verifyOnly) {
    if (result.outputPath || result.expectedInputSetSha256) {
      fail('invalid_arguments', '--verify-only does not accept --output or --expect-input-set-sha256.');
    }
  } else if (!result.outputPath || !SHA256.test(result.expectedInputSetSha256 || '')) {
    fail('invalid_arguments', 'Write mode requires --output and a lowercase 64-character --expect-input-set-sha256.');
  }
  return result;
}

export async function runFinalReleaseAuditCli(argv) {
  const options = parseArguments(argv);
  const verified = await verifyBmwM3ReleaseAuditFiles(options);
  if (options.verifyOnly) {
    return {
      status: 'verified-no-write',
      complete: verified.finalizedAudit.captureProgress.complete,
      productCount: verified.finalizedAudit.productCount,
      inputSetSha256: verified.inputSetSha256,
    };
  }
  const output = await writeFinalReleaseAuditCreateOnly(
    options.outputPath,
    verified.finalizedAudit,
    verified.roots,
  );
  return {
    status: 'created',
    complete: true,
    productCount: verified.finalizedAudit.productCount,
    inputSetSha256: verified.inputSetSha256,
    output,
  };
}

export const __test = Object.freeze({
  exactAggregateModule,
  moduleSpecifiers,
  trustedModuleSpecifier,
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runFinalReleaseAuditCli(process.argv.slice(2))
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => {
      console.error(JSON.stringify({
        status: 'failed',
        code: error instanceof FinalReleaseAuditError ? error.code : 'unexpected_error',
        message: error instanceof Error ? error.message : String(error),
      }));
      process.exitCode = 1;
    });
}
