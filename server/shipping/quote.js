import { createHash, randomUUID as nodeRandomUUID } from 'node:crypto';
import { canonicalDestination, destinationFingerprintInput, shippingIdempotencyKey, shippingText,
  ShippingValidationError } from './validation.js';
import { createDisabledCurrencyConverter, addShippingMoney, convertShippingMoney, shippingMinorToDecimal } from './money.js';
import { groupPackageDataStatus, packageRestrictions, packageStatesForItems } from './package-data.js';
import { createDisabledSupplierAdapter, quoteSupplierAdapter } from './provider-adapters.js';
import { calculateShippingCommercialRules, validateShippingCommercialRules } from './commercial-rules.js';
import { supplierShippingEvidence } from '../shipping-policy.js';

const MAX_ITEMS = 200;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function canonicalQuoteItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) throw new Error('invalid_shipping_items');
  const normalized = items.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('invalid_shipping_item');
    const productId = shippingText(item.productId, 180, { required: true });
    const sku = shippingText(item.sku, 120, { required: true });
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) throw new Error('invalid_shipping_quantity');
    const supplier = item.supplier;
    if (!supplier || typeof supplier !== 'object' || Array.isArray(supplier)) throw new Error('invalid_shipping_supplier');
    const supplierSlug = shippingText(supplier.slug, 80, { required: true }).toLowerCase();
    const originCountryCode = shippingText(supplier.originCountryCode, 2, { required: true }).toUpperCase();
    if (!/^[A-Z]{2}$/.test(originCountryCode)) throw new Error('invalid_shipping_origin');
    return Object.freeze({
      productId,
      variantId: shippingText(item.variantId, 255) || null,
      sku,
      quantity,
      fitmentConfirmationRequired: item.fitmentConfirmationRequired === true,
      purchaseMode: shippingText(item.purchaseMode, 80) || null,
      packageData: item.packageData || item.shippingPackage || null,
      supplier: Object.freeze({
        slug: supplierSlug,
        name: shippingText(supplier.name, 120, { required: true }),
        originId: shippingText(supplier.originId, 120) || `${supplierSlug}-${originCountryCode.toLowerCase()}`,
        originCountryCode,
        originCountryName: shippingText(supplier.originCountryName, 120, { required: true })
      })
    });
  });
  const identities = normalized.map(item => `${item.supplier.slug}\u0000${item.productId}\u0000${item.variantId || ''}\u0000${item.sku}`);
  if (new Set(identities).size !== identities.length) throw new Error('duplicate_shipping_item');
  return normalized;
}

function itemFingerprintValue(item, now) {
  const packageState = packageStatesForItems([item], { now })[0];
  return {
    supplier: item.supplier.slug,
    originId: item.supplier.originId,
    originCountryCode: item.supplier.originCountryCode,
    productId: item.productId,
    variantId: item.variantId,
    sku: item.sku,
    quantity: item.quantity,
    fitmentConfirmationRequired: item.fitmentConfirmationRequired,
    purchaseMode: item.purchaseMode,
    packageData: {
      status: packageState.status,
      weightGrams: packageState.weightGrams,
      lengthMm: packageState.lengthMm,
      widthMm: packageState.widthMm,
      heightMm: packageState.heightMm,
      oversized: packageState.oversized,
      shipsSeparately: packageState.shipsSeparately,
      hazardous: packageState.hazardous,
      fragile: packageState.fragile,
      freightOnly: packageState.freightOnly,
      groundOnly: packageState.groundOnly,
      observedAt: packageState.observedAt,
      expiresAt: packageState.expiresAt
    }
  };
}

export function shippingQuoteFingerprint({ items, destination, now = Date.now() }) {
  const normalizedItems = canonicalQuoteItems(items)
    .map(item => itemFingerprintValue(item, now))
    .sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
  const value = {
    version: 1,
    destination: destinationFingerprintInput(destination),
    items: normalizedItems
  };
  return createHash('sha256').update(stableStringify(value), 'utf8').digest('hex');
}

function shipmentGroups(items) {
  const groups = new Map();
  for (const item of items) {
    const key = `${item.supplier.slug}\u0000${item.supplier.originId}`;
    const group = groups.get(key) || {
      supplier: item.supplier.slug,
      supplierName: item.supplier.name,
      originId: item.supplier.originId,
      originCountryCode: item.supplier.originCountryCode,
      originCountryName: item.supplier.originCountryName,
      items: []
    };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => `${left.supplier}:${left.originId}`.localeCompare(`${right.supplier}:${right.originId}`));
}

function selectedOptionMap(value) {
  if (!value) return new Map();
  if (value instanceof Map) return new Map(value);
  if (!Array.isArray(value) || value.length > 20) throw new ShippingValidationError('invalid_shipping_option_selection');
  const result = new Map();
  for (const selection of value) {
    if (!selection || typeof selection !== 'object' || Array.isArray(selection)) {
      throw new ShippingValidationError('invalid_shipping_option_selection');
    }
    const supplier = shippingText(selection.supplier, 80, { required: true }).toLowerCase();
    const originId = shippingText(selection.originId, 120, { required: true });
    const optionId = shippingText(selection.optionId, 120, { required: true });
    const key = `${supplier}\u0000${originId}`;
    if (result.has(key)) throw new ShippingValidationError('duplicate_shipping_option_selection');
    result.set(key, optionId);
  }
  return result;
}

function selectionFingerprint(selections) {
  const values = [...selections.entries()]
    .map(([key, optionId]) => ({ key, optionId }))
    .sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
  return createHash('sha256').update(stableStringify(values), 'utf8').digest('hex');
}

function fallbackAdapter(group) {
  const currency = group.supplier === 'tegiwa' ? 'GBP' : group.supplier === 'ecs' ? 'USD' : 'KWD';
  return createDisabledSupplierAdapter({
    supplierSlug: group.supplier,
    supplierName: group.supplierName,
    originCountryCode: group.originCountryCode,
    currency,
    reason: 'provider_adapter_unavailable'
  });
}

function quoteWindow(now, ttlMs) {
  const boundedTtl = Math.max(60_000, Math.min(3_600_000, Number(ttlMs) || 900_000));
  return {
    quotedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + boundedTtl).toISOString(),
    bucket: Math.floor(now / boundedTtl)
  };
}

function groupStatusFromResult(result) {
  return result.status === 'confirmed' ? 'confirmed'
    : result.status === 'partial' ? 'partial' : 'confirmation_required';
}

function aggregateStatus(groups) {
  if (groups.every(group => group.status === 'confirmed' && group.conversionStatus === 'confirmed')) return 'confirmed';
  if (groups.some(group => group.status === 'confirmed' || group.status === 'partial')) return 'partial';
  return 'confirmation_required';
}

function selectedGroupMoney(groups) {
  const selected = groups.map(group => group.options.find(option => option.id === group.selectedOptionId)).filter(Boolean);
  if (selected.length !== groups.length || selected.length < 1) return null;
  try {
    return addShippingMoney(selected.map(option => ({ amountMinor: option.rateMinor, currency: option.currency })));
  } catch {
    return null;
  }
}

function convertedGroupMoney(groups) {
  if (!groups.every(group => group.status === 'confirmed' && group.conversionStatus === 'confirmed'
      && group.convertedRateMinor !== null && group.convertedCurrency)) return null;
  try {
    return addShippingMoney(groups.map(group => ({
      amountMinor: group.convertedRateMinor,
      currency: group.convertedCurrency
    })));
  } catch {
    return null;
  }
}

function confirmedCommercialTotal({ groups, convertedTotal, destination, commercialRules }) {
  if (!convertedTotal) return null;
  const packages = groups.flatMap(group => group.packages || []);
  return calculateShippingCommercialRules({
    baseRateMinor: convertedTotal.amountMinor,
    currency: convertedTotal.currency,
    fragile: packages.some(item => item.fragile === true),
    oversized: packages.some(item => item.oversized === true),
    forwarder: false,
    // Supplier rates already represent the selected service to the destination.
    // A separate local-delivery fee must be opted into by a future route adapter,
    // never inferred merely because the customer selected courier delivery.
    localDelivery: false
  }, commercialRules);
}

async function optionsWithConversions(options, converter, targetCurrency, {
  now,
  fxMaxAgeMs,
  fxFutureSkewMs
}) {
  return Promise.all(options.map(async option => {
    let conversion;
    try {
      conversion = await convertShippingMoney(converter, {
        amountMinor: option.rateMinor,
        fromCurrency: option.currency,
        toCurrency: targetCurrency
      }, { now, maxAgeMs: fxMaxAgeMs, futureSkewMs: fxFutureSkewMs });
    } catch {
      conversion = { status: 'confirmation_required', reason: 'currency_conversion_invalid' };
    }
    return Object.freeze({
      ...option,
      conversionStatus: conversion.status,
      conversionReason: conversion.reason || null,
      convertedRateMinor: conversion.status === 'confirmed' ? conversion.amountMinor : null,
      convertedCurrency: conversion.status === 'confirmed' ? conversion.currency : targetCurrency,
      exchangeRate: conversion.status === 'confirmed' ? conversion.exchangeRate : null,
      exchangeRateAsOf: conversion.status === 'confirmed' ? conversion.exchangeRateAsOf : null,
      exchangeRateProvider: conversion.status === 'confirmed' ? conversion.provider : null
    });
  }));
}

function selectedDutiesStatus(groups) {
  const selected = groups.map(group => group.options.find(option => option.id === group.selectedOptionId)).filter(Boolean);
  if (selected.length !== groups.length || !selected.length) return 'unknown';
  if (selected.every(option => option.dutiesIncluded === true)) return 'included';
  if (selected.every(option => option.dutiesIncluded === false)) return 'excluded';
  return 'unknown';
}

function selectedTaxStatus(groups) {
  const selected = groups.map(group => group.options.find(option => option.id === group.selectedOptionId)).filter(Boolean);
  if (selected.length !== groups.length || !selected.length) return 'unknown';
  if (selected.every(option => option.taxIncluded === true)) return 'included';
  if (selected.every(option => option.taxIncluded === false)) return 'excluded';
  return 'unknown';
}

function selectedIncoterm(groups) {
  const selected = groups.map(group => group.options.find(option => option.id === group.selectedOptionId)).filter(Boolean);
  if (selected.length !== groups.length || !selected.length) return 'unknown';
  const values = [...new Set(selected.map(option => option.incoterm))];
  return values.length === 1 ? values[0] : 'mixed';
}

function quoteExpiry(groups, localExpiry) {
  const expiries = groups
    .map(group => group.options.find(option => option.id === group.selectedOptionId)?.expiresAt)
    .filter(Boolean)
    .map(value => Date.parse(value))
    .filter(Number.isFinite);
  const local = Date.parse(localExpiry);
  const expiry = expiries.length ? Math.min(local, ...expiries) : local;
  return new Date(expiry).toISOString();
}

export async function buildShippingQuote({
  items,
  destination,
  adapters = new Map(),
  currencyConverter = createDisabledCurrencyConverter(),
  targetCurrency = 'KWD',
  idempotencyKey = '',
  now = Date.now(),
  ttlMs = 900_000,
  providerTimeoutMs = 2_500,
  fxMaxAgeMs = 15 * 60_000,
  fxFutureSkewMs = 5 * 60_000,
  selectedOptions = null,
  commercialRules = {},
  randomUUID = nodeRandomUUID
}) {
  const normalizedItems = canonicalQuoteItems(items);
  // Live/provider-bound quotes require a complete courier destination. Workshop
  // collection remains a manual confirmation flow and must not be sent to a
  // supplier adapter with a customer-controlled location.
  const normalizedDestination = canonicalDestination(destination, { requireFullAddress: true });
  const resolvedCommercialRules = validateShippingCommercialRules(commercialRules);
  const fingerprint = shippingQuoteFingerprint({ items: normalizedItems, destination: normalizedDestination, now });
  const window = quoteWindow(now, ttlMs);
  const explicitKey = shippingIdempotencyKey(idempotencyKey);
  const quoteId = randomUUID();
  const requestedSelections = selectedOptionMap(selectedOptions);
  const selectedFingerprint = selectionFingerprint(requestedSelections);
  const selectionSuffix = `:selection:${selectedFingerprint.slice(0, 24)}`;
  const resolvedIdempotencyKey = explicitKey
    ? `${explicitKey.slice(0, 200 - selectionSuffix.length)}${selectionSuffix}`
    : `auto:${fingerprint}:${window.bucket}${selectionSuffix}`;
  const plannedGroups = shipmentGroups(normalizedItems);
  const plannedKeys = new Set(plannedGroups.map(group => `${group.supplier}\u0000${group.originId}`));
  if ([...requestedSelections.keys()].some(key => !plannedKeys.has(key))) {
    throw new ShippingValidationError('invalid_shipping_option_selection');
  }
  const groups = [];
  for (const group of plannedGroups) {
    const groupId = randomUUID();
    const packages = packageStatesForItems(group.items, { now }).map(item => Object.freeze({ ...item, packageId: randomUUID() }));
    const packageDataStatus = groupPackageDataStatus(packages);
    const restrictions = packageRestrictions(packages);
    if (group.items.some(item => item.fitmentConfirmationRequired)) restrictions.push('fitment_confirmation_required');
    if (group.items.some(item => item.purchaseMode === 'quote-only')) restrictions.push('quote_only');
    const adapter = adapters.get(group.supplier) || fallbackAdapter(group);
    const evidence = supplierShippingEvidence(group.supplier);
    let result;
    const routeBlocked = packageDataStatus !== 'verified'
      || group.items.some(item => item.fitmentConfirmationRequired || item.purchaseMode === 'quote-only');
    if (adapter.enabled && routeBlocked) {
      result = {
        status: 'confirmation_required', reason: restrictions[0] || 'package_data_unavailable',
        options: [], selectedOptionId: null, provider: adapter.id, warnings: [], durationMs: 0
      };
    } else {
      result = await quoteSupplierAdapter(adapter, {
        schemaVersion: 1,
        quoteId,
        groupId,
        idempotencyKey: `${resolvedIdempotencyKey}:${group.supplier}:${group.originId}`,
        destination: normalizedDestination,
        origin: {
          id: group.originId,
          countryCode: group.originCountryCode,
          countryName: group.originCountryName
        },
        items: group.items.map(item => ({
          productId: item.productId, variantId: item.variantId, sku: item.sku, quantity: item.quantity
        })),
        packages
      }, { timeoutMs: providerTimeoutMs, now });
    }
    const requestedOptionId = requestedSelections.get(`${group.supplier}\u0000${group.originId}`) || null;
    const selectedOptionId = requestedOptionId || result.selectedOptionId;
    if (requestedOptionId && !result.options.some(option => option.id === requestedOptionId)) {
      result = { ...result, status: 'confirmation_required', reason: 'selected_shipping_option_unavailable' };
    }
    const status = groupStatusFromResult(result);
    const convertedOptions = await optionsWithConversions(result.options, currencyConverter, targetCurrency, {
      now, fxMaxAgeMs, fxFutureSkewMs
    });
    const selected = convertedOptions.find(option => option.id === selectedOptionId) || null;
    const conversionStatus = selected?.conversionStatus || 'confirmation_required';
    if (selected && conversionStatus !== 'confirmed') restrictions.push('currency_conversion_required');
    const providerUnavailable = adapter.enabled !== true;
    const truthfulReason = providerUnavailable
      ? packageDataStatus === 'verified'
        ? 'live_rate_access_not_connected'
        : 'verified_package_data_missing_and_live_rate_access_not_connected'
      : result.reason;
    groups.push(Object.freeze({
      groupId,
      supplier: group.supplier,
      supplierName: group.supplierName,
      originId: group.originId,
      originCountryCode: group.originCountryCode,
      originCountryName: group.originCountryName,
      itemCount: group.items.length,
      quantity: group.items.reduce((total, item) => total + item.quantity, 0),
      items: Object.freeze(group.items.map(item => ({
        productId: item.productId, variantId: item.variantId, sku: item.sku, quantity: item.quantity
      }))),
      packages: Object.freeze(packages),
      packageDataStatus: providerUnavailable && packageDataStatus !== 'verified'
        ? 'not_available' : packageDataStatus,
      packageVerificationStatus: packageDataStatus,
      rateAccessStatus: providerUnavailable ? 'not_connected' : 'connected',
      blockingReasons: Object.freeze(providerUnavailable
        ? [packageDataStatus === 'verified' ? null : 'verified_package_data_required',
          'authorised_dynamic_rate_access_required'].filter(Boolean)
        : [...new Set(restrictions)]),
      restrictions: Object.freeze([...new Set([...evidence.restrictions, ...restrictions])]),
      warnings: result.warnings,
      status,
      reason: truthfulReason,
      provider: result.provider,
      providerDurationMs: result.durationMs,
      options: Object.freeze(convertedOptions),
      selectedOptionId: selected ? selectedOptionId : null,
      rateMinor: selected?.rateMinor ?? null,
      rate: selected ? Number(shippingMinorToDecimal(selected.rateMinor, selected.currency)) : null,
      currency: selected?.currency ?? null,
      convertedRateMinor: selected?.convertedRateMinor ?? null,
      convertedCurrency: selected?.convertedCurrency ?? null,
      conversionStatus,
      conversionReason: selected?.conversionReason ?? (selected ? null : 'shipping_option_not_selected'),
      exchangeRate: selected?.exchangeRate ?? null,
      exchangeRateAsOf: selected?.exchangeRateAsOf ?? null,
      exchangeRateProvider: selected?.exchangeRateProvider ?? null,
      carrier: selected?.carrier ?? null,
      service: selected?.service ?? null,
      transitDays: selected?.transitDays ?? null,
      quoteMethod: evidence.quoteMethod,
      rateSource: evidence.rateSource,
      fulfilmentSystem: evidence.fulfilmentSystem,
      calculationFactors: evidence.calculationFactors,
      requiredInputs: evidence.requiredInputs,
      consolidationPolicy: evidence.consolidationPolicy,
      dutiesMode: evidence.dutiesMode,
      observedCarrierFamilies: evidence.observedCarrierFamilies,
      evidenceAsOf: evidence.evidenceAsOf
    }));
  }
  const originalTotal = selectedGroupMoney(groups);
  const convertedTotal = convertedGroupMoney(groups);
  const status = aggregateStatus(groups);
  const commercial = status === 'confirmed'
    ? confirmedCommercialTotal({
      groups,
      convertedTotal,
      destination: normalizedDestination,
      commercialRules: resolvedCommercialRules
    })
    : null;
  const expiresAt = quoteExpiry(groups, window.expiresAt);
  return Object.freeze({
    schemaVersion: 1,
    quoteId,
    idempotencyKey: resolvedIdempotencyKey,
    fingerprint,
    selectionFingerprint: selectedFingerprint,
    status,
    revalidated: false,
    revalidatedAt: null,
    revalidationStatus: 'not_revalidated',
    quotedAt: window.quotedAt,
    expiresAt,
    destination: normalizedDestination,
    splitShipment: groups.length > 1,
    groupCount: groups.length,
    groups: Object.freeze(groups),
    originalTotalMinor: originalTotal?.amountMinor ?? null,
    originalCurrency: originalTotal?.currency ?? null,
    baseShippingMinor: status === 'confirmed' ? convertedTotal?.amountMinor ?? null : null,
    totalShippingMinor: status === 'confirmed' ? commercial?.totalMinor ?? null : null,
    currency: status === 'confirmed' ? commercial?.currency ?? null : null,
    exchangeRate: groups.length === 1 && status === 'confirmed' ? groups[0].exchangeRate : null,
    exchangeRateAsOf: groups.length === 1 && status === 'confirmed' ? groups[0].exchangeRateAsOf : null,
    commercialRulesVersion: commercial?.version ?? resolvedCommercialRules.version,
    commercialRulesEnabled: commercial?.enabled ?? resolvedCommercialRules.enabled,
    protectionMarginMinor: commercial?.protectionMarginMinor ?? null,
    handlingMinor: commercial?.handlingMinor ?? null,
    insuranceMinor: commercial?.insuranceMinor ?? null,
    fragileFeeMinor: commercial?.fragileFeeMinor ?? null,
    oversizeFeeMinor: commercial?.oversizeFeeMinor ?? null,
    forwarderFeeMinor: commercial?.forwarderFeeMinor ?? null,
    localDeliveryMinor: commercial?.localDeliveryMinor ?? null,
    roundingAdjustmentMinor: commercial?.roundingAdjustmentMinor ?? null,
    manualReviewRequired: commercial?.manualReviewRequired ?? false,
    commercialAudit: commercial?.audit ?? null,
    dutiesStatus: selectedDutiesStatus(groups),
    taxStatus: selectedTaxStatus(groups),
    incoterm: selectedIncoterm(groups),
    dutiesIncluded: selectedDutiesStatus(groups) === 'included',
    taxIncluded: selectedTaxStatus(groups) === 'included',
    localDeliveryIncluded: false,
    paymentRequired: false,
    paymentEligible: false,
    message: status === 'confirmation_required'
      ? 'Live supplier shipping rates are unavailable or the package data is incomplete. No rate has been guessed.'
      : 'Shipping options are provisional until server revalidation at checkout.'
  });
}

export function revalidateShippingQuoteSnapshot(quote, { items, destination, now = Date.now() }) {
  if (!quote || typeof quote !== 'object' || Array.isArray(quote)) return { valid: false, reason: 'invalid_quote' };
  const expiry = Date.parse(quote.expiresAt || '');
  if (!Number.isFinite(expiry) || expiry <= now) return { valid: false, reason: 'quote_expired' };
  let fingerprint;
  try { fingerprint = shippingQuoteFingerprint({ items, destination, now }); }
  catch { return { valid: false, reason: 'quote_request_invalid' }; }
  if (fingerprint !== quote.fingerprint) return { valid: false, reason: 'quote_request_changed' };
  return { valid: true, reason: null, fingerprint };
}

function selectedConvertedRates(quote) {
  const rates = new Map();
  for (const group of quote?.groups || []) {
    if (group.status !== 'confirmed' || group.conversionStatus !== 'confirmed'
        || !Number.isSafeInteger(group.convertedRateMinor) || !group.convertedCurrency) return null;
    rates.set(`${group.supplier}\u0000${group.originId}`, {
      amountMinor: group.convertedRateMinor,
      currency: group.convertedCurrency
    });
  }
  return rates.size ? rates : null;
}

export function shippingQuoteRateDelta(previousQuote, nextQuote, {
  maxDeltaMinor = 0,
  maxDeltaBps = 0
} = {}) {
  const previous = selectedConvertedRates(previousQuote);
  const next = selectedConvertedRates(nextQuote);
  if (!previous || !next || previous.size !== next.size) {
    return { accepted: false, reason: 'shipping_rate_set_changed', deltas: [] };
  }
  const boundedMinor = Number.isSafeInteger(maxDeltaMinor) && maxDeltaMinor >= 0 ? maxDeltaMinor : 0;
  const boundedBps = Number.isInteger(maxDeltaBps) && maxDeltaBps >= 0 && maxDeltaBps <= 10_000 ? maxDeltaBps : 0;
  const allowance = amountMinor => Math.max(
    boundedMinor,
    Number((BigInt(amountMinor) * BigInt(boundedBps)) / 10_000n)
  );
  const deltas = [];
  for (const [key, before] of previous) {
    const after = next.get(key);
    if (!after || after.currency !== before.currency) {
      return { accepted: false, reason: 'shipping_rate_currency_changed', deltas };
    }
    const absoluteDeltaMinor = Math.abs(after.amountMinor - before.amountMinor);
    const allowedDeltaMinor = allowance(before.amountMinor);
    const accepted = absoluteDeltaMinor <= allowedDeltaMinor;
    deltas.push({ key, currency: before.currency, beforeMinor: before.amountMinor,
      afterMinor: after.amountMinor, absoluteDeltaMinor, allowedDeltaMinor, accepted });
    if (!accepted) return { accepted: false, reason: 'shipping_rate_changed_beyond_limit', deltas };
  }
  const beforeTotal = previousQuote?.totalShippingMinor;
  const afterTotal = nextQuote?.totalShippingMinor;
  const beforeCurrency = previousQuote?.currency;
  const afterCurrency = nextQuote?.currency;
  if (!Number.isSafeInteger(beforeTotal) || !Number.isSafeInteger(afterTotal)
      || !beforeCurrency || beforeCurrency !== afterCurrency) {
    return { accepted: false, reason: 'shipping_total_changed_or_unavailable', deltas };
  }
  const totalDelta = Math.abs(afterTotal - beforeTotal);
  const totalAllowed = allowance(beforeTotal);
  const totalAccepted = totalDelta <= totalAllowed;
  deltas.push({
    key: 'customer_total', currency: beforeCurrency, beforeMinor: beforeTotal,
    afterMinor: afterTotal, absoluteDeltaMinor: totalDelta,
    allowedDeltaMinor: totalAllowed, accepted: totalAccepted
  });
  if (!totalAccepted) return { accepted: false, reason: 'shipping_total_changed_beyond_limit', deltas };
  return { accepted: true, reason: null, deltas };
}

export async function revalidateShippingQuote({
  previousQuote,
  items,
  destination,
  adapters,
  currencyConverter,
  targetCurrency = 'KWD',
  now = Date.now(),
  ttlMs = 900_000,
  providerTimeoutMs = 2_500,
  fxMaxAgeMs = 15 * 60_000,
  fxFutureSkewMs = 5 * 60_000,
  selectedOptions = null,
  commercialRules = {},
  maxDeltaMinor = 0,
  maxDeltaBps = 0,
  randomUUID = nodeRandomUUID
}) {
  const snapshot = revalidateShippingQuoteSnapshot(previousQuote, { items, destination, now });
  if (!snapshot.valid) return Object.freeze({ accepted: false, reason: snapshot.reason, quote: null, deltas: [] });
  const next = await buildShippingQuote({
    items,
    destination,
    adapters,
    currencyConverter,
    targetCurrency,
    idempotencyKey: `revalidate:${previousQuote.quoteId}:${snapshot.fingerprint.slice(0, 48)}`,
    now,
    ttlMs,
    providerTimeoutMs,
    fxMaxAgeMs,
    fxFutureSkewMs,
    selectedOptions,
    commercialRules,
    randomUUID
  });
  if (next.status !== 'confirmed' || next.totalShippingMinor === null) {
    return Object.freeze({ accepted: false, reason: 'shipping_revalidation_unconfirmed', quote: next, deltas: [] });
  }
  const delta = shippingQuoteRateDelta(previousQuote, next, { maxDeltaMinor, maxDeltaBps });
  if (!delta.accepted) return Object.freeze({ accepted: false, reason: delta.reason, quote: next, deltas: delta.deltas });
  const revalidatedAt = new Date(now).toISOString();
  return Object.freeze({
    accepted: true,
    reason: null,
    deltas: Object.freeze(delta.deltas),
    quote: Object.freeze({
      ...next,
      revalidated: true,
      revalidatedAt,
      revalidationStatus: 'server_requoted',
      revalidatedFromQuoteId: previousQuote.quoteId,
      paymentEligible: false
    })
  });
}

export function auditSafeShippingQuoteRecord(quote) {
  if (!quote || typeof quote !== 'object') throw new Error('invalid_quote');
  return Object.freeze({
    quoteId: shippingText(quote.quoteId, 80, { required: true }),
    fingerprint: /^[a-f0-9]{64}$/.test(String(quote.fingerprint || '')) ? quote.fingerprint : null,
    status: quote.status,
    countryCode: quote.destination?.countryCode || null,
    fulfilment: quote.destination?.fulfilment || null,
    groupCount: Number(quote.groupCount) || 0,
    itemCount: (quote.groups || []).reduce((total, group) => total + (Number(group.itemCount) || 0), 0),
    suppliers: Object.freeze([...new Set((quote.groups || []).map(group => group.supplier).filter(Boolean))]),
    origins: Object.freeze([...new Set((quote.groups || []).map(group => group.originCountryCode).filter(Boolean))]),
    reasons: Object.freeze([...new Set((quote.groups || []).map(group => group.reason).filter(Boolean))]),
    totalShippingMinor: Number.isSafeInteger(quote.totalShippingMinor) ? quote.totalShippingMinor : null,
    currency: /^[A-Z]{3}$/.test(String(quote.currency || '')) ? quote.currency : null,
    commercialRulesVersion: shippingText(quote.commercialRulesVersion, 80) || null,
    manualReviewRequired: quote.manualReviewRequired === true,
    quotedAt: quote.quotedAt,
    expiresAt: quote.expiresAt
  });
}
