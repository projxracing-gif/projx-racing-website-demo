import { canonicalShippingItems } from '../shipping-policy.js';
import { canonicalDestination, ShippingValidationError, shippingAllowedCountryCodes } from './validation.js';
import { createConfiguredSupplierAdapters, shippingIntegrationReadiness } from './provider-adapters.js';
import { createDisabledCurrencyConverter } from './money.js';
import { revalidateShippingQuote } from './quote.js';
import { signShippingQuoteToken, verifyShippingQuoteToken, ShippingQuoteTokenError } from './quote-token.js';
import { shippingCommercialRulesFromEnvironment } from './commercial-rules.js';
import { persistShippingQuoteIfConfigured } from './repository.js';

export const SHIPPING_REVALIDATE_MAX_BODY_BYTES = 48_000;

function clean(value, maximum = 300) {
  return String(value ?? '').replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim().slice(0, maximum);
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

function sameOrigin(req) {
  const host = clean(req.headers?.['x-forwarded-host'] || req.headers?.host, 255).split(',')[0].toLowerCase();
  const origin = clean(req.headers?.origin, 500);
  const fetchSite = clean(req.headers?.['sec-fetch-site'], 40).toLowerCase();
  if (!host || !origin || fetchSite === 'cross-site') return false;
  try { return Boolean(host) && new URL(origin).host.toLowerCase() === host; }
  catch { return false; }
}

function parsedBody(req) {
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8') || '{}');
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  return req.body || {};
}

function selectedOptions(value, token) {
  if (value === undefined || value === null) {
    return token.groups.filter(group => group.selectedOptionId).map(group => ({
      supplier: group.supplier, originId: group.originId, optionId: group.selectedOptionId
    }));
  }
  if (!Array.isArray(value) || value.length > 20) throw new ShippingValidationError('invalid_shipping_option_selection');
  const seen = new Set();
  return value.map(selection => {
    if (!selection || typeof selection !== 'object' || Array.isArray(selection)) {
      throw new ShippingValidationError('invalid_shipping_option_selection');
    }
    const groupId = clean(selection.groupId, 80);
    const optionId = clean(selection.optionId, 120);
    const group = token.groups.find(candidate => candidate.groupId === groupId);
    if (!group || !optionId || seen.has(groupId)) throw new ShippingValidationError('invalid_shipping_option_selection');
    seen.add(groupId);
    return { supplier: group.supplier, originId: group.originId, optionId };
  });
}

export default async function shippingRevalidateHandler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  if (!sameOrigin(req)) return json(res, 403, { error: 'origin_not_allowed' });
  if (Number(req.headers?.['content-length'] || 0) > SHIPPING_REVALIDATE_MAX_BODY_BYTES) {
    return json(res, 413, { error: 'payload_too_large' });
  }
  let body;
  try {
    body = parsedBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)
        || Buffer.byteLength(JSON.stringify(body), 'utf8') > SHIPPING_REVALIDATE_MAX_BODY_BYTES) throw new Error('invalid');
  } catch {
    return json(res, 400, { error: 'invalid_payload' });
  }
  let destination;
  let token;
  try {
    destination = canonicalDestination(body.destination, {
      requireFullAddress: true,
      allowedCountryCodes: shippingAllowedCountryCodes(process.env)
    });
    token = verifyShippingQuoteToken(body.revalidationToken, { env: process.env });
  } catch (error) {
    if (error instanceof ShippingQuoteTokenError || error instanceof ShippingValidationError) {
      return json(res, error.status, { error: error.code });
    }
    return json(res, 400, { error: 'invalid_revalidation_request' });
  }
  if (body.quoteId && clean(body.quoteId, 80) !== token.quoteId) {
    return json(res, 409, { error: 'quote_identity_mismatch' });
  }
  let optionSelections;
  try { optionSelections = selectedOptions(body.selectedOptions, token); }
  catch (error) {
    return json(res, error.status || 400, { error: error.code || 'invalid_shipping_option_selection' });
  }
  const items = canonicalShippingItems(body.items);
  if (!items) return json(res, 409, { error: 'invalid_or_stale_cart' });
  const previousQuote = {
    quoteId: token.quoteId,
    fingerprint: token.fingerprint,
    status: token.status,
    expiresAt: token.expiresAt,
    totalShippingMinor: token.totalShippingMinor,
    currency: token.currency,
    baseShippingMinor: token.baseShippingMinor,
    commercialRulesVersion: token.commercialRulesVersion,
    commercialRulesEnabled: token.commercialRulesEnabled,
    protectionMarginMinor: token.protectionMarginMinor,
    handlingMinor: token.handlingMinor,
    insuranceMinor: token.insuranceMinor,
    fragileFeeMinor: token.fragileFeeMinor,
    oversizeFeeMinor: token.oversizeFeeMinor,
    forwarderFeeMinor: token.forwarderFeeMinor,
    localDeliveryMinor: token.localDeliveryMinor,
    roundingAdjustmentMinor: token.roundingAdjustmentMinor,
    manualReviewRequired: token.manualReviewRequired,
    groups: token.groups
  };
  const ttlSeconds = Math.max(60, Math.min(3_600,
    Number(process.env.SUPPLIER_SHIPPING_MAX_QUOTE_AGE_SECONDS) || 900));
  const timeoutMs = Math.max(10, Math.min(10_000,
    Number(process.env.SUPPLIER_SHIPPING_PROVIDER_TIMEOUT_MS) || 2_500));
  const fxMaxAgeMs = Math.max(60, Math.min(86_400,
    Number(process.env.SUPPLIER_SHIPPING_FX_MAX_AGE_SECONDS) || 900)) * 1_000;
  const fxFutureSkewMs = Math.max(0, Math.min(900,
    Number(process.env.SUPPLIER_SHIPPING_FX_FUTURE_SKEW_SECONDS) || 300)) * 1_000;
  let result;
  try {
    const commercialRules = shippingCommercialRulesFromEnvironment(process.env);
    result = await revalidateShippingQuote({
      previousQuote,
      items,
      destination,
      adapters: createConfiguredSupplierAdapters(process.env),
      currencyConverter: createDisabledCurrencyConverter(),
      targetCurrency: process.env.SUPPLIER_SHIPPING_TARGET_CURRENCY || 'KWD',
      ttlMs: ttlSeconds * 1_000,
      providerTimeoutMs: timeoutMs,
      fxMaxAgeMs,
      fxFutureSkewMs,
      selectedOptions: optionSelections,
      commercialRules,
      maxDeltaMinor: commercialRules.maxRevalidationDeltaMinor,
      maxDeltaBps: commercialRules.maxRevalidationDeltaBps
    });
  } catch {
    return json(res, 503, { error: 'shipping_revalidation_unavailable' });
  }
  if (result.quote) {
    try {
      const storedQuote = await persistShippingQuoteIfConfigured(result.quote, {
        env: process.env,
        eventType: 'revalidated',
        outcome: result.accepted ? 'accepted' : 'rejected',
        reason: result.reason
      });
      result = Object.freeze({ ...result, quote: storedQuote });
    } catch {
      return json(res, 503, { error: 'shipping_revalidation_unavailable' });
    }
  }
  let nextToken = null;
  try { nextToken = result.quote ? signShippingQuoteToken(result.quote, { env: process.env }) : null; }
  catch { return json(res, 503, { error: 'shipping_revalidation_unavailable' }); }
  return json(res, result.accepted ? 200 : 409, {
    accepted: result.accepted,
    reason: result.reason,
    estimate: result.quote ? {
      ...result.quote,
      ...(nextToken ? { revalidationToken: nextToken } : {}),
      integrationReadiness: shippingIntegrationReadiness(process.env)
    } : null,
    deltas: result.deltas
  });
}
