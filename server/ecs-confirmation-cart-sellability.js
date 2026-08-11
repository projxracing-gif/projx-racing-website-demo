import { createHash } from 'node:crypto';

export const ECS_CONFIRMATION_CART_SCHEMA_VERSION = 1;
export const ECS_CONFIRMATION_CART_EXPECTED_PRODUCT_COUNT = 9_790;
export const ECS_CONFIRMATION_CART_SOURCE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
export const ECS_CONFIRMATION_CART_REFERENCE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const ECS_CONFIRMATION_CART_MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
export const ECS_CONFIRMATION_CART_ENTRY_FIELDS = Object.freeze([
  'productId',
  'slug',
  'sku',
  'title',
  'imageSrc',
  'unitAmountMinor',
  'priceObservedAt',
  'availabilityObservedAt',
  'expiresAt',
  'observedAvailability'
]);

const INDEX_KIND = 'ecs-confirmation-cart-sellability-index';
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
    ? `${source}T23:59:59.999Z`
    : source);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function earliestObservationValue(value) {
  const source = cleanText(value, 40);
  if (!source) return null;
  const timestamp = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(source)
    ? `${source}T00:00:00.000Z`
    : source);
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
  return {
    source: String(value),
    observedAt,
    expiresAt: observedAt + ECS_CONFIRMATION_CART_REFERENCE_RETENTION_MS
  };
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

  if (product.imageStatus !== 'supplier-media-verified'
    || !Array.isArray(product.images) || product.images.length !== 1) {
    return eligibilityFailure('unverified_image');
  }
  const imageSrc = publicImageSource(product.images[0]?.src);
  if (!imageSrc) return eligibilityFailure('unverified_image');

  const expiresAt = Math.min(price.expiresAt, availability.expiresAt);
  return Object.freeze({
    eligible: true,
    entry: Object.freeze({
      productId,
      slug,
      sku,
      title,
      imageSrc,
      unitAmountMinor,
      priceObservedAt: price.source,
      availabilityObservedAt: availability.source,
      expiresAt: new Date(expiresAt).toISOString(),
      observedAvailability: String(product.observedAvailability),
      availabilityClass
    })
  });
}

function packEntry(entry) {
  return [
    entry.productId,
    entry.slug,
    entry.sku,
    entry.title,
    entry.imageSrc,
    entry.unitAmountMinor,
    entry.priceObservedAt,
    entry.availabilityObservedAt,
    entry.expiresAt,
    entry.observedAvailability
  ];
}

export function unpackEcsConfirmationCartEntry(row) {
  if (!Array.isArray(row) || row.length !== ECS_CONFIRMATION_CART_ENTRY_FIELDS.length) return null;
  return Object.fromEntries(ECS_CONFIRMATION_CART_ENTRY_FIELDS.map((field, index) => [field, row[index]]));
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

export function buildEcsConfirmationCartIndex(products, {
  evaluatedAt,
  sourceReleaseId,
  sourceContentSha256,
  baseContentSha256,
  sourceProductCount,
  expectedCount = null
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

  const identitySets = [new Set(), new Set(), new Set()];
  for (const entry of eligible) {
    for (const [position, value] of [entry.productId, entry.slug, entry.sku].entries()) {
      if (identitySets[position].has(value)) throw new Error(`Duplicate ECS sellability identity: ${value}`);
      identitySets[position].add(value);
    }
  }
  if (expectedCount !== null && eligible.length !== Number(expectedCount)) {
    throw new Error(`Expected ${Number(expectedCount).toLocaleString('en-US')} ECS confirmation-cart products; generated ${eligible.length.toLocaleString('en-US')}.`);
  }
  if (eligible.length === 0) throw new Error('The ECS confirmation-cart index cannot be empty.');

  const availabilityCounts = { observedStock: 0, observedDispatchWindow: 0, observedFutureShipDate: 0 };
  for (const entry of eligible) {
    if (entry.availabilityClass === 'observed-stock') availabilityCounts.observedStock += 1;
    if (entry.availabilityClass === 'observed-dispatch-window') availabilityCounts.observedDispatchWindow += 1;
    if (entry.availabilityClass === 'observed-future-ship-date') availabilityCounts.observedFutureShipDate += 1;
  }
  const expiryValues = eligible.map(entry => Date.parse(entry.expiresAt));
  const document = {
    schemaVersion: ECS_CONFIRMATION_CART_SCHEMA_VERSION,
    kind: INDEX_KIND,
    supplier: { id: 'ecs', name: 'ECS Tuning', origin: 'United States' },
    policy: {
      purchaseMode: PURCHASE_MODE,
      checkoutMode: CHECKOUT_MODE,
      fitmentConfirmationRequired: true,
      availabilityConfirmationRequired: true,
      paymentAllowed: false,
      shippingQuoteRequired: true
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
    availabilityCounts,
    exclusionCounts: Object.fromEntries([...exclusions].sort(([left], [right]) => left.localeCompare(right))),
    entryFields: [...ECS_CONFIRMATION_CART_ENTRY_FIELDS],
    entries: eligible.map(packEntry)
  };
  return Object.freeze({ ...document, contentSha256: ecsConfirmationCartIndexSha256(document) });
}

function validatePackedEntry(row, previousProductId, identities) {
  const entry = unpackEcsConfirmationCartEntry(row);
  if (!entry) throw new Error('Invalid ECS confirmation-cart entry shape.');
  if (!cleanText(entry.productId, 180) || !cleanText(entry.slug, 180) || !ECS_SKU.test(entry.sku)
    || !cleanText(entry.title, 300) || !publicImageSource(entry.imageSrc)
    || !Number.isSafeInteger(entry.unitAmountMinor) || entry.unitAmountMinor <= 0
    || canonicalDateValue(entry.priceObservedAt) === null
    || canonicalDateValue(entry.availabilityObservedAt) === null
    || canonicalTimestamp(entry.expiresAt) === null
    || !cleanText(entry.observedAvailability, 180)) {
    throw new Error(`Invalid ECS confirmation-cart entry for ${String(entry.productId || 'unknown product')}.`);
  }
  if (previousProductId !== null && previousProductId.localeCompare(entry.productId) >= 0) {
    throw new Error('ECS confirmation-cart entries must be uniquely sorted by productId.');
  }
  for (const [position, value] of [entry.productId, entry.slug, entry.sku].entries()) {
    if (identities[position].has(value)) throw new Error(`Duplicate ECS confirmation-cart identity: ${value}`);
    identities[position].add(value);
  }
  return entry;
}

export function validateEcsConfirmationCartIndex(document) {
  const expectedKeys = [
    'schemaVersion', 'kind', 'supplier', 'policy', 'source', 'evaluatedAt', 'earliestExpiryAt',
    'latestExpiryAt', 'productCount', 'availabilityCounts', 'exclusionCounts', 'entryFields',
    'entries', 'contentSha256'
  ];
  if (!exactKeys(document, expectedKeys)
    || document.schemaVersion !== ECS_CONFIRMATION_CART_SCHEMA_VERSION
    || document.kind !== INDEX_KIND
    || !exactKeys(document.supplier, ['id', 'name', 'origin'])
    || document.supplier.id !== 'ecs' || document.supplier.name !== 'ECS Tuning'
    || document.supplier.origin !== 'United States'
    || !exactKeys(document.policy, [
      'purchaseMode', 'checkoutMode', 'fitmentConfirmationRequired',
      'availabilityConfirmationRequired', 'paymentAllowed', 'shippingQuoteRequired'
    ])
    || document.policy.purchaseMode !== PURCHASE_MODE
    || document.policy.checkoutMode !== CHECKOUT_MODE
    || document.policy.fitmentConfirmationRequired !== true
    || document.policy.availabilityConfirmationRequired !== true
    || document.policy.paymentAllowed !== false
    || document.policy.shippingQuoteRequired !== true
    || !exactKeys(document.source, ['releaseId', 'contentSha256', 'baseContentSha256', 'mergedProductCount'])
    || !cleanText(document.source.releaseId, 120)
    || !SHA256.test(document.source.contentSha256)
    || !SHA256.test(document.source.baseContentSha256)
    || !Number.isSafeInteger(document.source.mergedProductCount)
    || canonicalTimestamp(document.evaluatedAt) === null
    || canonicalTimestamp(document.earliestExpiryAt) === null
    || canonicalTimestamp(document.latestExpiryAt) === null
    || !Number.isSafeInteger(document.productCount)
    || document.productCount !== ECS_CONFIRMATION_CART_EXPECTED_PRODUCT_COUNT
    || !Array.isArray(document.entryFields)
    || JSON.stringify(document.entryFields) !== JSON.stringify(ECS_CONFIRMATION_CART_ENTRY_FIELDS)
    || !Array.isArray(document.entries) || document.entries.length !== document.productCount
    || !SHA256.test(document.contentSha256)
    || ecsConfirmationCartIndexSha256(document) !== document.contentSha256) {
    throw new Error('Invalid or modified ECS confirmation-cart sellability index.');
  }

  const identities = [new Set(), new Set(), new Set()];
  let previousProductId = null;
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  for (const row of document.entries) {
    const entry = validatePackedEntry(row, previousProductId, identities);
    previousProductId = entry.productId;
    const expiry = Date.parse(entry.expiresAt);
    earliest = Math.min(earliest, expiry);
    latest = Math.max(latest, expiry);
  }
  if (new Date(earliest).toISOString() !== document.earliestExpiryAt
    || new Date(latest).toISOString() !== document.latestExpiryAt) {
    throw new Error('The ECS confirmation-cart expiry summary does not match its entries.');
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
    image: Object.freeze({
      src: entry.imageSrc,
      alt: entry.title,
      status: 'supplier-media-verified'
    }),
    supplier: Object.freeze({
      id: 'ecs',
      slug: 'ecs',
      name: 'ECS Tuning',
      origin: 'United States',
      originCountryCode: 'US',
      originCountryName: 'United States'
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
      currency: 'USD',
      unitAmountMinor: entry.unitAmountMinor,
      amount: entry.unitAmountMinor / 100,
      observedAt: entry.priceObservedAt,
      expiresAt: entry.expiresAt,
      finalPriceConfirmationRequired: true
    }),
    availability: Object.freeze({
      code: 'confirmation_required',
      observedText: entry.observedAvailability,
      observedAt: entry.availabilityObservedAt,
      expiresAt: entry.expiresAt,
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
      selection: Object.freeze({
        ...commerce,
        quantity,
        lineTotalMinor: commerce.price.unitAmountMinor * quantity
      })
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
