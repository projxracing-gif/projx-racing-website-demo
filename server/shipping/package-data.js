const PACKAGE_STATES = new Set(['missing', 'unverified', 'verified', 'stale', 'restricted']);
const MAX_MEASUREMENT = 100_000_000;
const MAX_EVIDENCE_AGE_MS = 90 * 86_400_000;
const MAX_FUTURE_SKEW_MS = 5 * 60_000;

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_MEASUREMENT ? value : null;
}

function clean(value, maximum = 120) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .trim()
    .slice(0, maximum);
}

function timestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export function packageDataState(input, { now = Date.now() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return Object.freeze({
      status: 'missing', reason: 'package_data_unavailable',
      weightGrams: null, lengthMm: null, widthMm: null, heightMm: null,
      oversized: null, shipsSeparately: null, hazardous: null,
      fragile: null, freightOnly: null, groundOnly: null,
      source: null, observedAt: null, expiresAt: null
    });
  }
  const requestedState = PACKAGE_STATES.has(input.status) ? input.status : 'unverified';
  const weightGrams = positiveInteger(input.weightGrams ?? input.weight_grams);
  const lengthMm = positiveInteger(input.lengthMm ?? input.length_mm);
  const widthMm = positiveInteger(input.widthMm ?? input.width_mm);
  const heightMm = positiveInteger(input.heightMm ?? input.height_mm);
  const dimensionsComplete = Boolean(weightGrams && lengthMm && widthMm && heightMm);
  const flagsComplete = typeof input.oversized === 'boolean'
    && typeof (input.shipsSeparately ?? input.ships_separately) === 'boolean'
    && typeof input.hazardous === 'boolean'
    && typeof input.fragile === 'boolean'
    && typeof (input.freightOnly ?? input.freight_only) === 'boolean'
    && typeof (input.groundOnly ?? input.ground_only) === 'boolean';
  const observedAt = timestamp(input.observedAt ?? input.observed_at);
  const expiresAt = timestamp(input.expiresAt ?? input.expires_at);
  const expired = Boolean(expiresAt && Date.parse(expiresAt) <= now);
  const source = clean(input.source);
  const observedMs = observedAt ? Date.parse(observedAt) : null;
  const expiresMs = expiresAt ? Date.parse(expiresAt) : null;
  const evidenceInvalid = requestedState === 'verified' && (
    !source || !observedAt || !expiresAt
    || observedMs > now + MAX_FUTURE_SKEW_MS
    || expiresMs < observedMs
    || expiresMs > observedMs + MAX_EVIDENCE_AGE_MS
  );
  const oversized = typeof input.oversized === 'boolean' ? input.oversized : null;
  const shipsSeparatelyValue = input.shipsSeparately ?? input.ships_separately;
  const shipsSeparately = typeof shipsSeparatelyValue === 'boolean' ? shipsSeparatelyValue : null;
  const hazardous = typeof input.hazardous === 'boolean' ? input.hazardous : null;
  const fragile = typeof input.fragile === 'boolean' ? input.fragile : null;
  const freightOnlyValue = input.freightOnly ?? input.freight_only;
  const freightOnly = typeof freightOnlyValue === 'boolean' ? freightOnlyValue : null;
  const groundOnlyValue = input.groundOnly ?? input.ground_only;
  const groundOnly = typeof groundOnlyValue === 'boolean' ? groundOnlyValue : null;
  const restricted = oversized === true || hazardous === true || freightOnly === true
    || groundOnly === true || requestedState === 'restricted';
  let status = requestedState;
  let reason = clean(input.reason);
  if (expired || requestedState === 'stale') {
    status = 'stale';
    reason = reason || 'package_data_stale';
  } else if (restricted) {
    status = 'restricted';
    reason = reason || (hazardous ? 'hazardous_shipping_review_required'
      : freightOnly ? 'freight_shipping_review_required'
        : groundOnly ? 'ground_only_route_review_required' : 'oversized_shipping_review_required');
  } else if (requestedState === 'verified' && dimensionsComplete && flagsComplete && !evidenceInvalid) {
    status = 'verified';
    reason = '';
  } else if (!dimensionsComplete || !flagsComplete || evidenceInvalid) {
    status = 'unverified';
    reason = reason || (evidenceInvalid ? 'package_evidence_invalid' : 'package_data_incomplete');
  }
  return Object.freeze({
    status,
    reason: reason || null,
    weightGrams,
    lengthMm,
    widthMm,
    heightMm,
    oversized,
    shipsSeparately,
    hazardous,
    fragile,
    freightOnly,
    groundOnly,
    source,
    observedAt,
    expiresAt
  });
}

export function packageStatesForItems(items, { now = Date.now() } = {}) {
  if (!Array.isArray(items)) return [];
  return items.map(item => {
    const state = packageDataState(item?.packageData || item?.shippingPackage, { now });
    const quantity = Number.isInteger(item?.quantity) && item.quantity > 0 ? item.quantity : 1;
    return Object.freeze({
      productId: clean(item?.productId, 180),
      variantId: clean(item?.variantId, 255) || null,
      sku: clean(item?.sku, 120) || null,
      quantity,
      packageCount: state.shipsSeparately === true ? quantity : 1,
      ...state
    });
  });
}

export function groupPackageDataStatus(packages) {
  if (!Array.isArray(packages) || packages.length < 1) return 'missing';
  if (packages.some(item => item.status === 'restricted')) return 'restricted';
  if (packages.some(item => item.status === 'stale')) return 'stale';
  if (packages.some(item => item.status === 'missing')) return 'missing';
  if (packages.some(item => item.status !== 'verified')) return 'unverified';
  return 'verified';
}

export function packageRestrictions(packages) {
  const restrictions = new Set();
  for (const item of packages || []) {
    if (item.status !== 'verified') restrictions.add(item.reason || 'package_data_unavailable');
    if (item.oversized === true) restrictions.add('oversized_shipping_review_required');
    if (item.hazardous === true) restrictions.add('hazardous_shipping_review_required');
    if (item.freightOnly === true) restrictions.add('freight_shipping_review_required');
    if (item.groundOnly === true) restrictions.add('ground_only_route_review_required');
    if (item.shipsSeparately === true) restrictions.add('ships_separately');
  }
  return [...restrictions];
}
