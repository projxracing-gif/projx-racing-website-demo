import { createHash } from 'node:crypto';

export const ECS_CONFIRMATION_CART_SCHEMA_VERSION = 2;
export const ECS_CONFIRMATION_CART_BASE_SCHEMA_VERSION = 1;
export const ECS_CONFIRMATION_CART_EXPECTED_PRODUCT_COUNT = 10_491;
export const ECS_CONFIRMATION_CART_BASE_EXPECTED_PRODUCT_COUNT = 9_790;
export const ECS_CONFIRMATION_CART_BASE_RUNTIME_PRODUCT_COUNT = 12_057;
export const ECS_CONFIRMATION_CART_F8X_EXPECTED_PRODUCT_COUNT = 3_591;
export const ECS_CONFIRMATION_CART_F8X_COVERAGE_COUNT = 4_545;
export const ECS_CONFIRMATION_CART_PROJECTED_QUARANTINE_COUNT = 508;
export const ECS_CONFIRMATION_CART_RUNTIME_PRODUCT_COUNT = 13_028;
export const ECS_CONFIRMATION_CART_STABLE_HANDLE_COUNT = 10;
export const ECS_CONFIRMATION_CART_STATIC_PRODUCT_COUNT = 41;
export const ECS_CONFIRMATION_CART_STABLE_HANDLES_SHA256 = '5a862d9bcd503e71da30af261eaf62655ccfccae8306a5c0c4c6f556aa8cfef7';
export const ECS_CONFIRMATION_CART_STATIC_CATALOGUE_SHA256 = '65d8b3a63458860825f5b9451998c5b09ed950444f8dceb594ab3ca12146d28a';
export const ECS_CONFIRMATION_CART_SOURCE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
export const ECS_CONFIRMATION_CART_REFERENCE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const ECS_CONFIRMATION_CART_MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
export const ECS_CONFIRMATION_CART_BASE_ENTRY_FIELDS = Object.freeze([
  'productId', 'slug', 'sku', 'title', 'imageSrc', 'unitAmountMinor', 'priceObservedAt',
  'availabilityObservedAt', 'expiresAt', 'observedAvailability'
]);
export const ECS_CONFIRMATION_CART_ENTRY_FIELDS = Object.freeze([
  ...ECS_CONFIRMATION_CART_BASE_ENTRY_FIELDS, 'sourceCohort'
]);

const INDEX_KIND = 'ecs-confirmation-cart-sellability-index';
const SOURCE_COMPOSITION = 'validated-base-snapshot-plus-authoritative-f8x-overlay';
const PURCHASE_MODE = 'fitment-confirmation-required';
const CHECKOUT_MODE = 'staging-request-only';
const ECS_SKU = /^ES#\d{3,12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RELATIVE_AVAILABILITY = /^Ships in \d+(?:-\d+)? (?:Business )?[Dd]ays?$/i;
const STOCK_AVAILABILITY = /^In Stock(?: at Vendor)?$/i;
const FUTURE_AVAILABILITY = /^Ships on (.+)$/i;
const ALLOWED_LOCAL_IMAGE = /^assets\/products\/ecs\/[a-z0-9][a-z0-9._/-]*$/i;
const ALLOWED_REMOTE_IMAGE_HOST = /^(?:assets\.ecstuning\.com|[a-z0-9-]+\.public\.blob\.vercel-storage\.com)$/i;
const ECS_PRODUCT_LIBRARY_IMAGE = /^\/product_library\/(\d+)_x(\d+)\.[a-z0-9]+$/i;
const SOURCE_COHORTS = new Set(['base', 'f8x']);
const ALLOWED_EXCLUSION_REASONS = new Set([
  'invalid_input', 'invalid_supplier', 'invalid_identity', 'missing_title', 'unsafe_purchase_policy',
  'unresolved_options', 'invalid_price', 'stale_price', 'stale_availability',
  'unconfirmed_availability', 'unverified_image'
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, expected) {
  if (!plainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function cleanText(value, maximum = 500) {
  const source = typeof value === 'string' ? value.trim() : '';
  return source && source.length <= maximum ? source : null;
}

function canonicalDateValue(value) {
  const source = cleanText(value, 40);
  if (!source) return null;
  const timestamp = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(source)
    ? `${source}T23:59:59.999Z` : source);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function earliestObservationValue(value) {
  const source = cleanText(value, 40);
  if (!source) return null;
  const timestamp = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(source)
    ? `${source}T00:00:00.000Z` : source);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function canonicalTimestamp(value) {
  if (typeof value !== 'string' || !CANONICAL_TIMESTAMP.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value ? timestamp : null;
}

function cappedMaximumAge(product) {
  const configured = Number(product?.staleAfterDays) * 24 * 60 * 60 * 1_000;
  if (!Number.isFinite(configured) || configured <= 0) return ECS_CONFIRMATION_CART_SOURCE_MAX_AGE_MS;
  return Math.min(configured, ECS_CONFIRMATION_CART_SOURCE_MAX_AGE_MS);
}

function freshObservation(value, product, nowValue) {
  const observedAt = canonicalDateValue(value);
  const earliestObservedAt = earliestObservationValue(value);
  if (observedAt === null || earliestObservedAt === null) return null;
  const sourceFreshUntil = observedAt + cappedMaximumAge(product);
  if (earliestObservedAt > nowValue + ECS_CONFIRMATION_CART_MAX_FUTURE_SKEW_MS || nowValue > sourceFreshUntil) return null;
  return { source: String(value), observedAt, expiresAt: observedAt + ECS_CONFIRMATION_CART_REFERENCE_RETENTION_MS };
}

function exactUsdMinorAmount(product) {
  if (product?.priceCurrency !== 'USD') return null;
  const amount = Number(product?.priceAmount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const minor = Math.round(amount * 100);
  return Number.isSafeInteger(minor) && Math.abs(amount * 100 - minor) < 1e-7 ? minor : null;
}

function publicImageSource(value) {
  const source = cleanText(value, 1_000);
  if (!source || source.includes('\\')) return null;
  const local = source.replace(/^\/+/, '');
  if (ALLOWED_LOCAL_IMAGE.test(local)) return `/${local}`;
  try {
    const url = new URL(source);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash
      || !ALLOWED_REMOTE_IMAGE_HOST.test(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function ecsProductLibraryImageIdentity(value) {
  const source = publicImageSource(value);
  if (!source) return null;
  try {
    const url = new URL(source);
    if (url.hostname !== 'assets.ecstuning.com') return null;
    const match = url.pathname.match(ECS_PRODUCT_LIBRARY_IMAGE);
    return match ? `${match[1]}_x${match[2]}` : null;
  } catch {
    return null;
  }
}

export function selectEcsConfirmationCartPrimaryImage(product) {
  if (product?.imageStatus !== 'supplier-media-verified'
    || !Array.isArray(product.images) || product.images.length === 0) return null;
  const sources = product.images.map(image => publicImageSource(image?.src));
  if (sources.some(source => !source)) return null;
  if (sources.length === 1) return sources[0];

  const declaredPrimary = publicImageSource(product.imageSourceUrl);
  if (!declaredPrimary || !sources.includes(declaredPrimary)) return null;
  const identities = sources.map(ecsProductLibraryImageIdentity);
  if (identities.some(identity => !identity) || new Set(identities).size !== 1) return null;
  return declaredPrimary;
}

const MONTHS = Object.freeze({
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8,
  sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11
});

function parseEnglishDate(value) {
  const source = cleanText(value, 80);
  if (!source) return null;
  let match = source.match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
  let day;
  let month;
  let year;
  if (match) {
    [, month, day, year] = match;
  } else {
    match = source.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    if (!match) return null;
    [, day, month, year] = match;
  }
  const monthIndex = MONTHS[String(month).toLowerCase()];
  const dayNumber = Number(day);
  const yearNumber = Number(year);
  if (!Number.isInteger(monthIndex) || dayNumber < 1 || dayNumber > 31
    || yearNumber < 2020 || yearNumber > 2100) return null;
  const timestamp = Date.UTC(yearNumber, monthIndex, dayNumber);
  const parsed = new Date(timestamp);
  return parsed.getUTCFullYear() === yearNumber && parsed.getUTCMonth() === monthIndex
    && parsed.getUTCDate() === dayNumber ? timestamp : null;
}

export function classifyEcsObservedAvailability(value, nowValue) {
  const source = cleanText(value, 180);
  if (!source || !Number.isFinite(Number(nowValue))) return null;
  if (STOCK_AVAILABILITY.test(source)) return 'observed-stock';
  if (RELATIVE_AVAILABILITY.test(source)) return 'observed-dispatch-window';
  const future = source.match(FUTURE_AVAILABILITY);
  if (!future) return null;
  const shipAt = parseEnglishDate(future[1]);
  return shipAt !== null && shipAt >= Number(nowValue) ? 'observed-future-ship-date' : null;
}

function eligibilityFailure(reason) {
  return Object.freeze({ eligible: false, reason });
}

export function evaluateEcsConfirmationCartEligibility(product, { nowValue } = {}) {
  const evaluatedAt = Number(nowValue);
  if (!plainObject(product) || !Number.isFinite(evaluatedAt)) return eligibilityFailure('invalid_input');
  if (product.provider !== 'ECS Tuning' || product.providerSlug !== 'ecs'
    || product.shipping?.origin !== 'United States') return eligibilityFailure('invalid_supplier');

  const productId = cleanText(product.publicKey, 180);
  const slug = cleanText(product.slug, 180);
  const sku = cleanText(product.sku, 40);
  if (!productId || !slug || !sku || !ECS_SKU.test(sku) || product.ecsPartNumber !== sku) {
    return eligibilityFailure('invalid_identity');
  }
  const title = cleanText(product.title, 300);
  if (!title) return eligibilityFailure('missing_title');
  if (product.quoteOnly !== false || product.purchaseMode !== PURCHASE_MODE
    || product.priceStartingAt !== false || product.priceConflict !== false) {
    return eligibilityFailure('unsafe_purchase_policy');
  }
  if (!Array.isArray(product.options) || product.options.length !== 0
    || !Array.isArray(product.variants) || product.variants.length !== 0) {
    return eligibilityFailure('unresolved_options');
  }

  const unitAmountMinor = exactUsdMinorAmount(product);
  if (unitAmountMinor === null) return eligibilityFailure('invalid_price');
  const price = freshObservation(product.priceVerifiedAt, product, evaluatedAt);
  if (!price) return eligibilityFailure('stale_price');
  const availability = freshObservation(product.stockObservedAt || product.checkedAt, product, evaluatedAt);
  if (!availability) return eligibilityFailure('stale_availability');
  const availabilityClass = classifyEcsObservedAvailability(product.observedAvailability, evaluatedAt);
  if (!availabilityClass) return eligibilityFailure('unconfirmed_availability');
  const imageSrc = selectEcsConfirmationCartPrimaryImage(product);
  if (!imageSrc) return eligibilityFailure('unverified_image');

  const expiresAt = Math.min(price.expiresAt, availability.expiresAt);
  return Object.freeze({
    eligible: true,
    entry: Object.freeze({
      productId, slug, sku, title, imageSrc, unitAmountMinor,
      priceObservedAt: price.source,
      availabilityObservedAt: availability.source,
      expiresAt: new Date(expiresAt).toISOString(),
      observedAvailability: String(product.observedAvailability),
      availabilityClass
    })
  });
}

function packEntry(entry, fields = ECS_CONFIRMATION_CART_ENTRY_FIELDS) {
  return fields.map(field => entry[field]);
}

function unpackEntry(row, fields) {
  if (!Array.isArray(row) || row.length !== fields.length) return null;
  return Object.fromEntries(fields.map((field, index) => [field, row[index]]));
}

export function unpackEcsConfirmationCartEntry(row) {
  if (Array.isArray(row) && row.length === ECS_CONFIRMATION_CART_BASE_ENTRY_FIELDS.length) {
    return unpackEntry(row, ECS_CONFIRMATION_CART_BASE_ENTRY_FIELDS);
  }
  return unpackEntry(row, ECS_CONFIRMATION_CART_ENTRY_FIELDS);
}

export function canonicalEcsConfirmationCartIndexPayload(document) {
  if (!plainObject(document)) return '';
  const { contentSha256, ...payload } = document;
  return JSON.stringify(payload);
}

export function ecsConfirmationCartIndexSha256(document) {
  return sha256(canonicalEcsConfirmationCartIndexPayload(document));
}

function sourceHash(value, label) {
  const source = cleanText(value, 64);
  if (!source || !SHA256.test(source)) throw new TypeError(`${label} must be a SHA-256 digest.`);
  return source;
}

function countObject(value, { allowedKeys = null } = {}) {
  if (!plainObject(value)) return false;
  return Object.entries(value).every(([key, count]) => (
    (!allowedKeys || allowedKeys.has(key)) && Number.isSafeInteger(count) && count >= 0
  ));
}

function sumCounts(value) {
  return Object.values(value).reduce((total, count) => total + count, 0);
}

function supplierPolicyIsValid(document) {
  return exactKeys(document.supplier, ['id', 'name', 'origin'])
    && document.supplier.id === 'ecs' && document.supplier.name === 'ECS Tuning'
    && document.supplier.origin === 'United States'
    && exactKeys(document.policy, [
      'purchaseMode', 'checkoutMode', 'fitmentConfirmationRequired',
      'availabilityConfirmationRequired', 'paymentAllowed', 'shippingQuoteRequired'
    ])
    && document.policy.purchaseMode === PURCHASE_MODE
    && document.policy.checkoutMode === CHECKOUT_MODE
    && document.policy.fitmentConfirmationRequired === true
    && document.policy.availabilityConfirmationRequired === true
    && document.policy.paymentAllowed === false
    && document.policy.shippingQuoteRequired === true;
}

function validatePackedEntry(row, previousProductId, identities, fields, { requireCohort = false } = {}) {
  const entry = unpackEntry(row, fields);
  if (!entry) throw new Error('Invalid ECS confirmation-cart entry shape.');
  if (!cleanText(entry.productId, 180) || !cleanText(entry.slug, 180) || !ECS_SKU.test(entry.sku)
    || !cleanText(entry.title, 300) || !publicImageSource(entry.imageSrc)
    || !Number.isSafeInteger(entry.unitAmountMinor) || entry.unitAmountMinor <= 0
    || canonicalDateValue(entry.priceObservedAt) === null
    || canonicalDateValue(entry.availabilityObservedAt) === null
    || canonicalTimestamp(entry.expiresAt) === null
    || !cleanText(entry.observedAvailability, 180)
    || (requireCohort && !SOURCE_COHORTS.has(entry.sourceCohort))) {
    throw new Error(`Invalid ECS confirmation-cart entry for ${String(entry.productId || 'unknown product')}.`);
  }
  if (previousProductId !== null && previousProductId.localeCompare(entry.productId) >= 0) {
    throw new Error('ECS confirmation-cart entries must be uniquely sorted by productId.');
  }
  const aliases = new Set([entry.productId, entry.slug]);
  for (const value of aliases) {
    if (identities.aliases.has(value)) throw new Error(`Duplicate ECS confirmation-cart identity: ${value}`);
  }
  for (const value of aliases) identities.aliases.add(value);
  if (identities.skus.has(entry.sku)) {
    throw new Error(`Duplicate ECS confirmation-cart identity: ${entry.sku}`);
  }
  identities.skus.add(entry.sku);
  return entry;
}

function entryAvailabilityCounts(entries) {
  const result = { observedStock: 0, observedDispatchWindow: 0, observedFutureShipDate: 0 };
  for (const entry of entries) {
    if (entry.availabilityClass === 'observed-stock') result.observedStock += 1;
    else if (entry.availabilityClass === 'observed-dispatch-window') result.observedDispatchWindow += 1;
    else if (entry.availabilityClass === 'observed-future-ship-date') result.observedFutureShipDate += 1;
    else throw new Error(`Invalid ECS availability class for ${entry.productId}.`);
  }
  return result;
}

export function buildEcsConfirmationCartBaseSnapshot(products, {
  evaluatedAt, sourceReleaseId, sourceContentSha256, baseContentSha256,
  sourceProductCount, expectedCount = null
} = {}) {
  if (!Array.isArray(products)) throw new TypeError('ECS reviewed products must be an array.');
  const evaluatedAtValue = canonicalTimestamp(evaluatedAt);
  if (evaluatedAtValue === null) throw new TypeError('evaluatedAt must be a canonical UTC timestamp.');
  const releaseId = cleanText(sourceReleaseId, 120);
  if (!releaseId) throw new TypeError('sourceReleaseId is required.');
  const declaredSourceCount = Number(sourceProductCount);
  if (!Number.isSafeInteger(declaredSourceCount) || declaredSourceCount !== products.length) {
    throw new TypeError('sourceProductCount must match the merged reviewed product count.');
  }

  const eligible = [];
  const exclusions = new Map();
  for (const product of products) {
    const result = evaluateEcsConfirmationCartEligibility(product, { nowValue: evaluatedAtValue });
    if (result.eligible) eligible.push(result.entry);
    else exclusions.set(result.reason, (exclusions.get(result.reason) || 0) + 1);
  }
  eligible.sort((left, right) => left.productId.localeCompare(right.productId) || left.sku.localeCompare(right.sku));
  if (expectedCount !== null && eligible.length !== Number(expectedCount)) {
    throw new Error(`Expected ${Number(expectedCount).toLocaleString('en-US')} ECS confirmation-cart products; generated ${eligible.length.toLocaleString('en-US')}.`);
  }
  if (eligible.length === 0) throw new Error('The ECS confirmation-cart base snapshot cannot be empty.');

  const expiryValues = eligible.map(entry => Date.parse(entry.expiresAt));
  const document = {
    schemaVersion: ECS_CONFIRMATION_CART_BASE_SCHEMA_VERSION,
    kind: INDEX_KIND,
    supplier: { id: 'ecs', name: 'ECS Tuning', origin: 'United States' },
    policy: {
      purchaseMode: PURCHASE_MODE, checkoutMode: CHECKOUT_MODE,
      fitmentConfirmationRequired: true, availabilityConfirmationRequired: true,
      paymentAllowed: false, shippingQuoteRequired: true
    },
    source: {
      releaseId,
      contentSha256: sourceHash(sourceContentSha256, 'sourceContentSha256'),
      baseContentSha256: sourceHash(baseContentSha256, 'baseContentSha256'),
      mergedProductCount: declaredSourceCount
    },
    evaluatedAt,
    earliestExpiryAt: new Date(Math.min(...expiryValues)).toISOString(),
    latestExpiryAt: new Date(Math.max(...expiryValues)).toISOString(),
    productCount: eligible.length,
    availabilityCounts: entryAvailabilityCounts(eligible),
    exclusionCounts: Object.fromEntries([...exclusions].sort(([left], [right]) => left.localeCompare(right))),
    entryFields: [...ECS_CONFIRMATION_CART_BASE_ENTRY_FIELDS],
    entries: eligible.map(entry => packEntry(entry, ECS_CONFIRMATION_CART_BASE_ENTRY_FIELDS))
  };
  return Object.freeze({ ...document, contentSha256: ecsConfirmationCartIndexSha256(document) });
}

export const buildEcsConfirmationCartIndex = buildEcsConfirmationCartBaseSnapshot;

export function validateEcsConfirmationCartBaseSnapshot(document, {
  expectedCount = ECS_CONFIRMATION_CART_BASE_EXPECTED_PRODUCT_COUNT
} = {}) {
  const expectedKeys = [
    'schemaVersion', 'kind', 'supplier', 'policy', 'source', 'evaluatedAt', 'earliestExpiryAt',
    'latestExpiryAt', 'productCount', 'availabilityCounts', 'exclusionCounts', 'entryFields',
    'entries', 'contentSha256'
  ];
  if (!exactKeys(document, expectedKeys)
    || document.schemaVersion !== ECS_CONFIRMATION_CART_BASE_SCHEMA_VERSION
    || document.kind !== INDEX_KIND
    || !supplierPolicyIsValid(document)
    || !exactKeys(document.source, ['releaseId', 'contentSha256', 'baseContentSha256', 'mergedProductCount'])
    || !cleanText(document.source.releaseId, 120)
    || !SHA256.test(document.source.contentSha256)
    || !SHA256.test(document.source.baseContentSha256)
    || !Number.isSafeInteger(document.source.mergedProductCount)
    || canonicalTimestamp(document.evaluatedAt) === null
    || canonicalTimestamp(document.earliestExpiryAt) === null
    || canonicalTimestamp(document.latestExpiryAt) === null
    || !Number.isSafeInteger(document.productCount)
    || (expectedCount !== null && document.productCount !== Number(expectedCount))
    || !countObject(document.availabilityCounts)
    || !countObject(document.exclusionCounts, { allowedKeys: ALLOWED_EXCLUSION_REASONS })
    || document.productCount + sumCounts(document.exclusionCounts) !== document.source.mergedProductCount
    || !Array.isArray(document.entryFields)
    || JSON.stringify(document.entryFields) !== JSON.stringify(ECS_CONFIRMATION_CART_BASE_ENTRY_FIELDS)
    || !Array.isArray(document.entries) || document.entries.length !== document.productCount
    || !SHA256.test(document.contentSha256)
    || ecsConfirmationCartIndexSha256(document) !== document.contentSha256) {
    throw new Error('Invalid or modified ECS confirmation-cart base snapshot.');
  }

  const identities = { aliases: new Set(), skus: new Set() };
  const evaluatedAt = Date.parse(document.evaluatedAt);
  const availabilityCounts = { observedStock: 0, observedDispatchWindow: 0, observedFutureShipDate: 0 };
  let previousProductId = null;
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  for (const row of document.entries) {
    const entry = validatePackedEntry(row, previousProductId, identities, ECS_CONFIRMATION_CART_BASE_ENTRY_FIELDS);
    previousProductId = entry.productId;
    const availabilityClass = classifyEcsObservedAvailability(entry.observedAvailability, evaluatedAt);
    if (!availabilityClass) throw new Error('The ECS confirmation-cart base snapshot has an invalid availability row.');
    if (availabilityClass === 'observed-stock') availabilityCounts.observedStock += 1;
    if (availabilityClass === 'observed-dispatch-window') availabilityCounts.observedDispatchWindow += 1;
    if (availabilityClass === 'observed-future-ship-date') availabilityCounts.observedFutureShipDate += 1;
    const expiry = Date.parse(entry.expiresAt);
    earliest = Math.min(earliest, expiry);
    latest = Math.max(latest, expiry);
  }
  if (JSON.stringify(availabilityCounts) !== JSON.stringify(document.availabilityCounts)
    || new Date(earliest).toISOString() !== document.earliestExpiryAt
    || new Date(latest).toISOString() !== document.latestExpiryAt) {
    throw new Error('The ECS confirmation-cart base snapshot summary does not match its entries.');
  }
  return document;
}

function combinedSourceIsValid(source) {
  if (!exactKeys(source, [
    'releaseId', 'composition', 'runtimeProductCount', 'baseCart', 'reviewedBase',
    'f8xOverlay', 'stableHandles'
  ])
    || !cleanText(source.releaseId, 120)
    || source.composition !== SOURCE_COMPOSITION
    || source.runtimeProductCount !== ECS_CONFIRMATION_CART_RUNTIME_PRODUCT_COUNT
    || !exactKeys(source.baseCart, [
      'schemaVersion', 'releaseId', 'contentSha256', 'sourceContentSha256', 'baseContentSha256',
      'mergedProductCount', 'productCount', 'evaluatedAt'
    ])
    || source.baseCart.schemaVersion !== ECS_CONFIRMATION_CART_BASE_SCHEMA_VERSION
    || !cleanText(source.baseCart.releaseId, 120)
    || !SHA256.test(source.baseCart.contentSha256)
    || !SHA256.test(source.baseCart.sourceContentSha256)
    || !SHA256.test(source.baseCart.baseContentSha256)
    || source.baseCart.mergedProductCount !== ECS_CONFIRMATION_CART_BASE_RUNTIME_PRODUCT_COUNT
    || source.baseCart.productCount !== ECS_CONFIRMATION_CART_BASE_EXPECTED_PRODUCT_COUNT
    || canonicalTimestamp(source.baseCart.evaluatedAt) === null
    || !exactKeys(source.reviewedBase, [
      'releaseId', 'manifestSha256', 'contentSetSha256', 'artifactSetSha256', 'productCount',
      'routeCount', 'shardCount', 'quarantinedIdentityCount', 'productsSha256'
    ])
    || !cleanText(source.reviewedBase.releaseId, 120)
    || !SHA256.test(source.reviewedBase.manifestSha256)
    || !SHA256.test(source.reviewedBase.contentSetSha256)
    || !SHA256.test(source.reviewedBase.artifactSetSha256)
    || !SHA256.test(source.reviewedBase.productsSha256)
    || !Number.isSafeInteger(source.reviewedBase.productCount)
    || source.reviewedBase.routeCount !== source.reviewedBase.productCount
    || !Number.isSafeInteger(source.reviewedBase.shardCount)
    || !Number.isSafeInteger(source.reviewedBase.quarantinedIdentityCount)
    || !exactKeys(source.f8xOverlay, [
      'releaseId', 'baseReleaseId', 'manifestSha256', 'contentSetSha256', 'productCount',
      'routeCount', 'shardCount', 'finalAuditFileSha256', 'finalAuditInputSetSha256',
      'aggregateModuleSha256', 'projectedQuarantineIdentityCount',
      'projectedQuarantineIdentitiesSha256'
    ])
    || !cleanText(source.f8xOverlay.releaseId, 120)
    || !cleanText(source.f8xOverlay.baseReleaseId, 120)
    || !SHA256.test(source.f8xOverlay.manifestSha256)
    || !SHA256.test(source.f8xOverlay.contentSetSha256)
    || !SHA256.test(source.f8xOverlay.finalAuditFileSha256)
    || !SHA256.test(source.f8xOverlay.finalAuditInputSetSha256)
    || !SHA256.test(source.f8xOverlay.aggregateModuleSha256)
    || !SHA256.test(source.f8xOverlay.projectedQuarantineIdentitiesSha256)
    || source.f8xOverlay.productCount !== ECS_CONFIRMATION_CART_F8X_COVERAGE_COUNT
    || source.f8xOverlay.routeCount !== source.f8xOverlay.productCount
    || !Number.isSafeInteger(source.f8xOverlay.shardCount)
    || source.f8xOverlay.projectedQuarantineIdentityCount !== ECS_CONFIRMATION_CART_PROJECTED_QUARANTINE_COUNT
    || !exactKeys(source.stableHandles, [
      'kind', 'baseReleaseId', 'entryCount', 'contentSha256',
      'staticCatalogueSha256', 'staticProductCount'
    ])
    || source.stableHandles.kind !== 'ecs-confirmation-cart-stable-handle-overrides'
    || !cleanText(source.stableHandles.baseReleaseId, 120)
    || source.stableHandles.entryCount !== ECS_CONFIRMATION_CART_STABLE_HANDLE_COUNT
    || source.stableHandles.staticProductCount !== ECS_CONFIRMATION_CART_STATIC_PRODUCT_COUNT
    || source.stableHandles.staticCatalogueSha256 !== ECS_CONFIRMATION_CART_STATIC_CATALOGUE_SHA256
    || source.stableHandles.contentSha256 !== ECS_CONFIRMATION_CART_STABLE_HANDLES_SHA256) return false;
  return source.releaseId === source.f8xOverlay.releaseId
    && source.baseCart.releaseId === source.reviewedBase.releaseId
    && source.baseCart.sourceContentSha256 === source.reviewedBase.contentSetSha256
    && source.f8xOverlay.baseReleaseId === source.reviewedBase.releaseId
    && source.stableHandles.baseReleaseId === source.reviewedBase.releaseId;
}

function compositionIsValid(composition, source, productCount) {
  const countFields = [
    'baseEntryCount', 'supersededBaseEntryCount', 'quarantinedBaseEntryCount',
    'retainedBaseEntryCount', 'authoritativeF8xIdentityCount', 'projectedQuarantineIdentityCount',
    'f8xEligibleCount', 'f8xExcludedCount', 'f8xExistingBaseEligibleCount',
    'newF8xEligibleCount', 'stableHandleOverrideCount', 'stableHandleEligibleCount'
  ];
  if (!exactKeys(composition, [...countFields, 'f8xExclusionCounts'])
    || countFields.some(field => !Number.isSafeInteger(composition[field]) || composition[field] < 0)
    || !countObject(composition.f8xExclusionCounts, { allowedKeys: ALLOWED_EXCLUSION_REASONS })) return false;
  return composition.baseEntryCount === source.baseCart.productCount
    && composition.authoritativeF8xIdentityCount === source.f8xOverlay.productCount
    && composition.projectedQuarantineIdentityCount === source.f8xOverlay.projectedQuarantineIdentityCount
    && composition.retainedBaseEntryCount
      === composition.baseEntryCount - composition.supersededBaseEntryCount - composition.quarantinedBaseEntryCount
    && composition.supersededBaseEntryCount <= composition.authoritativeF8xIdentityCount
    && composition.quarantinedBaseEntryCount <= composition.projectedQuarantineIdentityCount
    && composition.f8xEligibleCount + composition.f8xExcludedCount === composition.authoritativeF8xIdentityCount
    && sumCounts(composition.f8xExclusionCounts) === composition.f8xExcludedCount
    && composition.f8xExistingBaseEligibleCount + composition.newF8xEligibleCount === composition.f8xEligibleCount
    && composition.f8xExistingBaseEligibleCount <= composition.supersededBaseEntryCount
    && composition.stableHandleOverrideCount === source.stableHandles.entryCount
    && composition.stableHandleOverrideCount <= composition.authoritativeF8xIdentityCount
    && composition.stableHandleEligibleCount <= composition.stableHandleOverrideCount
    && composition.stableHandleEligibleCount <= composition.f8xEligibleCount
    && composition.retainedBaseEntryCount + composition.f8xEligibleCount === productCount;
}

export function buildCombinedEcsConfirmationCartIndex(entries, {
  evaluatedAt, source, composition, expectedCount = ECS_CONFIRMATION_CART_EXPECTED_PRODUCT_COUNT
} = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new TypeError('Combined ECS confirmation-cart entries must be a non-empty array.');
  }
  if (canonicalTimestamp(evaluatedAt) === null) throw new TypeError('evaluatedAt must be a canonical UTC timestamp.');
  if (!combinedSourceIsValid(source)) throw new TypeError('The combined ECS source binding is invalid.');
  if (!compositionIsValid(composition, source, entries.length)) {
    throw new TypeError('The combined ECS composition summary is invalid.');
  }
  if (expectedCount !== null && entries.length !== Number(expectedCount)) {
    throw new Error(`Expected ${Number(expectedCount).toLocaleString('en-US')} ECS confirmation-cart products; generated ${entries.length.toLocaleString('en-US')}.`);
  }

  const ordered = entries.map(entry => ({ ...entry })).sort((left, right) => (
    left.productId.localeCompare(right.productId) || left.sku.localeCompare(right.sku)
  ));
  const expiryValues = ordered.map(entry => Date.parse(entry.expiresAt));
  const document = {
    schemaVersion: ECS_CONFIRMATION_CART_SCHEMA_VERSION,
    kind: INDEX_KIND,
    supplier: { id: 'ecs', name: 'ECS Tuning', origin: 'United States' },
    policy: {
      purchaseMode: PURCHASE_MODE, checkoutMode: CHECKOUT_MODE,
      fitmentConfirmationRequired: true, availabilityConfirmationRequired: true,
      paymentAllowed: false, shippingQuoteRequired: true
    },
    source: structuredClone(source),
    evaluatedAt,
    earliestExpiryAt: new Date(Math.min(...expiryValues)).toISOString(),
    latestExpiryAt: new Date(Math.max(...expiryValues)).toISOString(),
    productCount: ordered.length,
    availabilityCounts: entryAvailabilityCounts(ordered),
    composition: structuredClone(composition),
    entryFields: [...ECS_CONFIRMATION_CART_ENTRY_FIELDS],
    entries: ordered.map(entry => packEntry(entry))
  };
  const result = Object.freeze({ ...document, contentSha256: ecsConfirmationCartIndexSha256(document) });
  validateEcsConfirmationCartIndex(result, { expectedCount });
  return result;
}

export function validateEcsConfirmationCartIndex(document, {
  expectedCount = ECS_CONFIRMATION_CART_EXPECTED_PRODUCT_COUNT
} = {}) {
  const expectedKeys = [
    'schemaVersion', 'kind', 'supplier', 'policy', 'source', 'evaluatedAt', 'earliestExpiryAt',
    'latestExpiryAt', 'productCount', 'availabilityCounts', 'composition', 'entryFields',
    'entries', 'contentSha256'
  ];
  if (!exactKeys(document, expectedKeys)
    || document.schemaVersion !== ECS_CONFIRMATION_CART_SCHEMA_VERSION
    || document.kind !== INDEX_KIND
    || !supplierPolicyIsValid(document)
    || !combinedSourceIsValid(document.source)
    || canonicalTimestamp(document.evaluatedAt) === null
    || canonicalTimestamp(document.earliestExpiryAt) === null
    || canonicalTimestamp(document.latestExpiryAt) === null
    || !Number.isSafeInteger(document.productCount)
    || (expectedCount !== null && document.productCount !== Number(expectedCount))
    || !countObject(document.availabilityCounts)
    || !compositionIsValid(document.composition, document.source, document.productCount)
    || !Array.isArray(document.entryFields)
    || JSON.stringify(document.entryFields) !== JSON.stringify(ECS_CONFIRMATION_CART_ENTRY_FIELDS)
    || !Array.isArray(document.entries) || document.entries.length !== document.productCount
    || !SHA256.test(document.contentSha256)
    || ecsConfirmationCartIndexSha256(document) !== document.contentSha256) {
    throw new Error('Invalid or modified ECS confirmation-cart sellability index.');
  }

  const identities = { aliases: new Set(), skus: new Set() };
  const cohortCounts = { base: 0, f8x: 0 };
  const availabilityCounts = { observedStock: 0, observedDispatchWindow: 0, observedFutureShipDate: 0 };
  const baseEvaluatedAt = Date.parse(document.source.baseCart.evaluatedAt);
  const f8xEvaluatedAt = Date.parse(document.evaluatedAt);
  let previousProductId = null;
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  for (const row of document.entries) {
    const entry = validatePackedEntry(
      row, previousProductId, identities, ECS_CONFIRMATION_CART_ENTRY_FIELDS, { requireCohort: true }
    );
    previousProductId = entry.productId;
    cohortCounts[entry.sourceCohort] += 1;
    const availabilityClass = classifyEcsObservedAvailability(
      entry.observedAvailability, entry.sourceCohort === 'base' ? baseEvaluatedAt : f8xEvaluatedAt
    );
    if (!availabilityClass) throw new Error('The ECS confirmation-cart index has an invalid availability row.');
    if (availabilityClass === 'observed-stock') availabilityCounts.observedStock += 1;
    if (availabilityClass === 'observed-dispatch-window') availabilityCounts.observedDispatchWindow += 1;
    if (availabilityClass === 'observed-future-ship-date') availabilityCounts.observedFutureShipDate += 1;
    const expiry = Date.parse(entry.expiresAt);
    if (expiry < f8xEvaluatedAt) throw new Error('The ECS confirmation-cart index contains an already-expired entry.');
    earliest = Math.min(earliest, expiry);
    latest = Math.max(latest, expiry);
  }
  if (cohortCounts.base !== document.composition.retainedBaseEntryCount
    || cohortCounts.f8x !== document.composition.f8xEligibleCount
    || JSON.stringify(availabilityCounts) !== JSON.stringify(document.availabilityCounts)
    || new Date(earliest).toISOString() !== document.earliestExpiryAt
    || new Date(latest).toISOString() !== document.latestExpiryAt) {
    throw new Error('The ECS confirmation-cart index summary does not match its entries.');
  }
  return document;
}

function expandedEntry(entry) {
  return Object.freeze({
    productId: entry.productId,
    handle: entry.productId,
    slug: entry.slug,
    sku: entry.sku,
    title: entry.title,
    image: Object.freeze({ src: entry.imageSrc, alt: entry.title, status: 'supplier-media-verified' }),
    supplier: Object.freeze({
      id: 'ecs', slug: 'ecs', name: 'ECS Tuning', origin: 'United States',
      originCountryCode: 'US', originCountryName: 'United States'
    }),
    eligible: true,
    mode: 'confirmation-cart',
    action: 'add-to-cart',
    purchaseMode: PURCHASE_MODE,
    checkoutMode: CHECKOUT_MODE,
    fitmentConfirmationRequired: true,
    availabilityConfirmationRequired: true,
    paymentAllowed: false,
    shippingQuoteRequired: true,
    price: Object.freeze({
      currency: 'USD', unitAmountMinor: entry.unitAmountMinor, amount: entry.unitAmountMinor / 100,
      observedAt: entry.priceObservedAt, expiresAt: entry.expiresAt,
      finalPriceConfirmationRequired: true
    }),
    availability: Object.freeze({
      code: 'confirmation_required', observedText: entry.observedAvailability,
      observedAt: entry.availabilityObservedAt, expiresAt: entry.expiresAt,
      confirmationRequired: true
    }),
    expiresAt: entry.expiresAt
  });
}

export function createEcsConfirmationCartResolver(document) {
  validateEcsConfirmationCartIndex(document);
  const rowsByAlias = new Map();
  for (const row of document.entries) {
    const entry = unpackEcsConfirmationCartEntry(row);
    for (const alias of [entry.productId, entry.slug]) {
      const existing = rowsByAlias.get(alias);
      if (existing && existing[0] !== entry.productId) {
        throw new Error(`Ambiguous ECS confirmation-cart handle: ${alias}`);
      }
      rowsByAlias.set(alias, row);
    }
  }

  function lookup(handle, { nowValue = Date.now() } = {}) {
    const alias = cleanText(handle, 180);
    const row = alias ? rowsByAlias.get(alias) : null;
    if (!row) return eligibilityFailure('not_indexed');
    const entry = unpackEcsConfirmationCartEntry(row);
    const now = Number(nowValue);
    if (!Number.isFinite(now)) return eligibilityFailure('invalid_time');
    if (now > Date.parse(entry.expiresAt)) return eligibilityFailure('expired');
    const priceObserved = earliestObservationValue(entry.priceObservedAt);
    const availabilityObserved = earliestObservationValue(entry.availabilityObservedAt);
    if (priceObserved > now + ECS_CONFIRMATION_CART_MAX_FUTURE_SKEW_MS
      || availabilityObserved > now + ECS_CONFIRMATION_CART_MAX_FUTURE_SKEW_MS) {
      return eligibilityFailure('observation_not_yet_valid');
    }
    return Object.freeze({ eligible: true, commerce: expandedEntry(entry) });
  }

  function resolve(selection, { nowValue = Date.now() } = {}) {
    if (!plainObject(selection)) return Object.freeze({ ok: false, reason: 'invalid_selection' });
    const aliases = [selection.productId, selection.handle].map(value => cleanText(value, 180)).filter(Boolean);
    if (aliases.length === 0) return Object.freeze({ ok: false, reason: 'missing_product' });
    const resolved = aliases.map(alias => lookup(alias, { nowValue }));
    if (resolved.some(result => !result.eligible)) {
      return Object.freeze({ ok: false, reason: resolved.find(result => !result.eligible).reason });
    }
    if (new Set(resolved.map(result => result.commerce.productId)).size !== 1) {
      return Object.freeze({ ok: false, reason: 'identity_mismatch' });
    }
    const commerce = resolved[0].commerce;
    if (cleanText(selection.sku, 40) !== commerce.sku) {
      return Object.freeze({ ok: false, reason: 'sku_mismatch' });
    }
    const quantity = selection.quantity === undefined ? 1 : Number(selection.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) {
      return Object.freeze({ ok: false, reason: 'invalid_quantity' });
    }
    return Object.freeze({
      ok: true,
      selection: Object.freeze({ ...commerce, quantity, lineTotalMinor: commerce.price.unitAmountMinor * quantity })
    });
  }

  function status({ nowValue = Date.now() } = {}) {
    const now = Number(nowValue);
    let eligibleProductCount = 0;
    if (Number.isFinite(now)) {
      for (const row of document.entries) {
        const entry = unpackEcsConfirmationCartEntry(row);
        if (now <= Date.parse(entry.expiresAt)) eligibleProductCount += 1;
      }
    }
    return Object.freeze({
      productCount: document.productCount,
      eligibleProductCount,
      expiredProductCount: document.productCount - eligibleProductCount,
      evaluatedAt: document.evaluatedAt,
      earliestExpiryAt: document.earliestExpiryAt,
      latestExpiryAt: document.latestExpiryAt,
      contentSha256: document.contentSha256,
      sourceReleaseId: document.source.releaseId
    });
  }

  return Object.freeze({ lookup, resolve, status });
}
