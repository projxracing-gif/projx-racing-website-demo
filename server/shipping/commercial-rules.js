import { shippingCurrency, shippingMinorAmount } from './money.js';

const MAX_BPS = 10_000;
const MAX_MINOR = 1_000_000_000_000;

export class ShippingCommercialRuleError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ShippingCommercialRuleError';
    this.code = code;
  }
}

function integer(value, maximum, code) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new ShippingCommercialRuleError(code);
  return value;
}

function environmentInteger(env, name, fallback = 0) {
  const raw = String(env?.[name] ?? '').trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new ShippingCommercialRuleError(`invalid_${name.toLowerCase()}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new ShippingCommercialRuleError(`invalid_${name.toLowerCase()}`);
  return value;
}

export function validateShippingCommercialRules(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ShippingCommercialRuleError('invalid_commercial_rules');
  }
  const enabled = value.enabled === true;
  return Object.freeze({
    version: String(value.version || 'shipping-commercial-v1').slice(0, 80),
    enabled,
    currency: shippingCurrency(value.currency || 'KWD'),
    handlingBps: integer(value.handlingBps ?? 0, MAX_BPS, 'invalid_handling_bps'),
    minimumHandlingMinor: integer(value.minimumHandlingMinor ?? 0, MAX_MINOR, 'invalid_minimum_handling'),
    fxProtectionBps: integer(value.fxProtectionBps ?? 0, MAX_BPS, 'invalid_fx_protection_bps'),
    insuranceBps: integer(value.insuranceBps ?? 0, MAX_BPS, 'invalid_insurance_bps'),
    fragileFeeMinor: integer(value.fragileFeeMinor ?? 0, MAX_MINOR, 'invalid_fragile_fee'),
    oversizeFeeMinor: integer(value.oversizeFeeMinor ?? 0, MAX_MINOR, 'invalid_oversize_fee'),
    forwarderFeeMinor: integer(value.forwarderFeeMinor ?? 0, MAX_MINOR, 'invalid_forwarder_fee'),
    localDeliveryFeeMinor: integer(value.localDeliveryFeeMinor ?? 0, MAX_MINOR, 'invalid_local_delivery_fee'),
    roundingIncrementMinor: integer(value.roundingIncrementMinor ?? 1, 1_000_000, 'invalid_rounding_increment') || 1,
    manualReviewThresholdMinor: integer(value.manualReviewThresholdMinor ?? 0, MAX_MINOR, 'invalid_manual_review_threshold'),
    maxRevalidationDeltaMinor: integer(value.maxRevalidationDeltaMinor ?? 0, MAX_MINOR, 'invalid_revalidation_delta'),
    maxRevalidationDeltaBps: integer(value.maxRevalidationDeltaBps ?? 0, MAX_BPS, 'invalid_revalidation_delta_bps')
  });
}
export function shippingCommercialRulesFromEnvironment(env = process.env) {
  return validateShippingCommercialRules({
    enabled: String(env.SUPPLIER_SHIPPING_COMMERCIAL_RULES_ENABLED || '').toLowerCase() === 'true',
    currency: env.SUPPLIER_SHIPPING_TARGET_CURRENCY || 'KWD',
    handlingBps: environmentInteger(env, 'SUPPLIER_SHIPPING_HANDLING_BPS'),
    minimumHandlingMinor: environmentInteger(env, 'SUPPLIER_SHIPPING_MINIMUM_HANDLING_MINOR'),
    fxProtectionBps: environmentInteger(env, 'SUPPLIER_SHIPPING_FX_PROTECTION_BPS'),
    insuranceBps: environmentInteger(env, 'SUPPLIER_SHIPPING_INSURANCE_BPS'),
    fragileFeeMinor: environmentInteger(env, 'SUPPLIER_SHIPPING_FRAGILE_FEE_MINOR'),
    oversizeFeeMinor: environmentInteger(env, 'SUPPLIER_SHIPPING_OVERSIZE_FEE_MINOR'),
    forwarderFeeMinor: environmentInteger(env, 'SUPPLIER_SHIPPING_FORWARDER_FEE_MINOR'),
    localDeliveryFeeMinor: environmentInteger(env, 'SUPPLIER_SHIPPING_LOCAL_DELIVERY_FEE_MINOR'),
    roundingIncrementMinor: environmentInteger(env, 'SUPPLIER_SHIPPING_ROUNDING_INCREMENT_MINOR', 1),
    manualReviewThresholdMinor: environmentInteger(env, 'SUPPLIER_SHIPPING_MANUAL_REVIEW_THRESHOLD_MINOR'),
    maxRevalidationDeltaMinor: environmentInteger(env, 'SUPPLIER_SHIPPING_MAX_REVALIDATION_DELTA_MINOR'),
    maxRevalidationDeltaBps: environmentInteger(env, 'SUPPLIER_SHIPPING_MAX_REVALIDATION_DELTA_BPS')
  });
}

function percentageMinor(amountMinor, basisPoints) {
  const numerator = BigInt(amountMinor) * BigInt(basisPoints);
  const rounded = (numerator * 2n + 10_000n) / 20_000n;
  if (rounded > BigInt(MAX_MINOR)) throw new ShippingCommercialRuleError('commercial_total_overflow');
  return Number(rounded);
}

function safeTotal(values) {
  let result = 0n;
  for (const value of values) result += BigInt(value);
  if (result > BigInt(MAX_MINOR)) throw new ShippingCommercialRuleError('commercial_total_overflow');
  return Number(result);
}

function roundUpMinor(amountMinor, incrementMinor) {
  const amount = BigInt(amountMinor);
  const increment = BigInt(incrementMinor);
  const rounded = ((amount + increment - 1n) / increment) * increment;
  if (rounded > BigInt(MAX_MINOR)) throw new ShippingCommercialRuleError('commercial_total_overflow');
  return Number(rounded);
}

export function calculateShippingCommercialRules({
  baseRateMinor,
  currency,
  fragile = false,
  oversized = false,
  forwarder = false,
  localDelivery = false
}, configuredRules = {}) {
  const rules = validateShippingCommercialRules(configuredRules);
  const base = shippingMinorAmount(baseRateMinor);
  const normalizedCurrency = shippingCurrency(currency);
  if (normalizedCurrency !== rules.currency) throw new ShippingCommercialRuleError('commercial_rule_currency_mismatch');
  if (!rules.enabled) {
    return Object.freeze({
      version: rules.version, enabled: false, currency: normalizedCurrency,
      baseRateMinor: base, handlingMinor: 0, protectionMarginMinor: 0, insuranceMinor: 0,
      fragileFeeMinor: 0, oversizeFeeMinor: 0, forwarderFeeMinor: 0, localDeliveryMinor: 0,
      unroundedTotalMinor: base, roundingAdjustmentMinor: 0, totalMinor: base,
      manualReviewRequired: false,
      audit: Object.freeze({ ruleVersion: rules.version, appliedRules: Object.freeze([]) })
    });
  }
  const handlingMinor = Math.max(percentageMinor(base, rules.handlingBps), rules.minimumHandlingMinor);
  const protectionMarginMinor = percentageMinor(base, rules.fxProtectionBps);
  const insuranceMinor = percentageMinor(base, rules.insuranceBps);
  const fragileMinor = fragile ? rules.fragileFeeMinor : 0;
  const oversizeMinor = oversized ? rules.oversizeFeeMinor : 0;
  const forwarderMinor = forwarder ? rules.forwarderFeeMinor : 0;
  const localDeliveryMinor = localDelivery ? rules.localDeliveryFeeMinor : 0;
  const unroundedTotalMinor = safeTotal([
    base, handlingMinor, protectionMarginMinor, insuranceMinor, fragileMinor,
    oversizeMinor, forwarderMinor, localDeliveryMinor
  ]);
  const totalMinor = roundUpMinor(unroundedTotalMinor, rules.roundingIncrementMinor);
  const appliedRules = [
    rules.handlingBps || rules.minimumHandlingMinor ? 'handling' : null,
    rules.fxProtectionBps ? 'fx_protection' : null,
    rules.insuranceBps ? 'insurance' : null,
    fragileMinor ? 'fragile_fee' : null,
    oversizeMinor ? 'oversize_fee' : null,
    forwarderMinor ? 'forwarder_fee' : null,
    localDeliveryMinor ? 'local_delivery_fee' : null,
    totalMinor !== unroundedTotalMinor ? 'round_up' : null
  ].filter(Boolean);
  return Object.freeze({
    version: rules.version, enabled: true, currency: normalizedCurrency,
    baseRateMinor: base, handlingMinor, protectionMarginMinor, insuranceMinor,
    fragileFeeMinor: fragileMinor, oversizeFeeMinor: oversizeMinor,
    forwarderFeeMinor: forwarderMinor, localDeliveryMinor,
    unroundedTotalMinor, roundingAdjustmentMinor: totalMinor - unroundedTotalMinor, totalMinor,
    manualReviewRequired: rules.manualReviewThresholdMinor > 0 && totalMinor >= rules.manualReviewThresholdMinor,
    audit: Object.freeze({ ruleVersion: rules.version, appliedRules: Object.freeze(appliedRules) })
  });
}
