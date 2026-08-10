import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_TOKEN_BYTES = 24_000;

export class ShippingQuoteTokenError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'ShippingQuoteTokenError';
    this.code = code;
    this.status = status;
  }
}

function signingSecret(env) {
  const value = String(env?.SUPPLIER_SHIPPING_QUOTE_SIGNING_SECRET || '');
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes < 32 || bytes > 512) return null;
  return value;
}

function selectedGroupSnapshots(quote) {
  return (quote.groups || []).map(group => ({
    groupId: String(group.groupId || '').slice(0, 80),
    supplier: String(group.supplier || '').slice(0, 80),
    originId: String(group.originId || '').slice(0, 120),
    status: group.status,
    conversionStatus: group.conversionStatus,
    selectedOptionId: String(group.selectedOptionId || '').slice(0, 120) || null,
    rateMinor: Number.isSafeInteger(group.rateMinor) ? group.rateMinor : null,
    currency: /^[A-Z]{3}$/.test(String(group.currency || '')) ? group.currency : null,
    convertedRateMinor: Number.isSafeInteger(group.convertedRateMinor) ? group.convertedRateMinor : null,
    convertedCurrency: /^[A-Z]{3}$/.test(String(group.convertedCurrency || '')) ? group.convertedCurrency : null,
    exchangeRate: /^(?:0|[1-9]\d*)(?:\.\d{1,12})?$/.test(String(group.exchangeRate || ''))
      ? String(group.exchangeRate) : null,
    exchangeRateAsOf: group.exchangeRateAsOf || null,
    exchangeRateProvider: String(group.exchangeRateProvider || '').slice(0, 80) || null
  }));
}

export function shippingQuoteTokenSnapshot(quote) {
  if (!quote || typeof quote !== 'object' || !/^[a-f0-9]{64}$/.test(String(quote.fingerprint || ''))) {
    throw new ShippingQuoteTokenError('invalid_quote');
  }
  const expiresAt = new Date(quote.expiresAt || '');
  if (!Number.isFinite(expiresAt.getTime())) throw new ShippingQuoteTokenError('invalid_quote_expiry');
  return Object.freeze({
    v: 1,
    quoteId: String(quote.quoteId || '').slice(0, 80),
    fingerprint: quote.fingerprint,
    selectionFingerprint: /^[a-f0-9]{64}$/.test(String(quote.selectionFingerprint || ''))
      ? quote.selectionFingerprint : null,
    status: quote.status,
    expiresAt: expiresAt.toISOString(),
    totalShippingMinor: Number.isSafeInteger(quote.totalShippingMinor) ? quote.totalShippingMinor : null,
    currency: /^[A-Z]{3}$/.test(String(quote.currency || '')) ? quote.currency : null,
    baseShippingMinor: Number.isSafeInteger(quote.baseShippingMinor) ? quote.baseShippingMinor : null,
    commercialRulesVersion: String(quote.commercialRulesVersion || '').slice(0, 80) || null,
    commercialRulesEnabled: quote.commercialRulesEnabled === true,
    protectionMarginMinor: Number.isSafeInteger(quote.protectionMarginMinor) ? quote.protectionMarginMinor : null,
    handlingMinor: Number.isSafeInteger(quote.handlingMinor) ? quote.handlingMinor : null,
    insuranceMinor: Number.isSafeInteger(quote.insuranceMinor) ? quote.insuranceMinor : null,
    fragileFeeMinor: Number.isSafeInteger(quote.fragileFeeMinor) ? quote.fragileFeeMinor : null,
    oversizeFeeMinor: Number.isSafeInteger(quote.oversizeFeeMinor) ? quote.oversizeFeeMinor : null,
    forwarderFeeMinor: Number.isSafeInteger(quote.forwarderFeeMinor) ? quote.forwarderFeeMinor : null,
    localDeliveryMinor: Number.isSafeInteger(quote.localDeliveryMinor) ? quote.localDeliveryMinor : null,
    roundingAdjustmentMinor: Number.isSafeInteger(quote.roundingAdjustmentMinor) ? quote.roundingAdjustmentMinor : null,
    manualReviewRequired: quote.manualReviewRequired === true,
    groups: Object.freeze(selectedGroupSnapshots(quote))
  });
}

export function signShippingQuoteToken(quote, { env = process.env } = {}) {
  const secret = signingSecret(env);
  if (!secret) return null;
  const payload = Buffer.from(JSON.stringify(shippingQuoteTokenSnapshot(quote)), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(payload, 'ascii').digest('base64url');
  const token = `${payload}.${signature}`;
  if (Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES) {
    throw new ShippingQuoteTokenError('quote_token_too_large', 503);
  }
  return token;
}

export function verifyShippingQuoteToken(token, { env = process.env, now = Date.now() } = {}) {
  const secret = signingSecret(env);
  if (!secret) throw new ShippingQuoteTokenError('shipping_quote_signing_not_configured', 503);
  const value = String(token || '').trim();
  if (!value || Buffer.byteLength(value, 'utf8') > MAX_TOKEN_BYTES) throw new ShippingQuoteTokenError('invalid_quote_token');
  const parts = value.split('.');
  if (parts.length !== 2 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) {
    throw new ShippingQuoteTokenError('invalid_quote_token');
  }
  const expected = createHmac('sha256', secret).update(parts[0], 'ascii').digest();
  let supplied;
  try { supplied = Buffer.from(parts[1], 'base64url'); } catch { throw new ShippingQuoteTokenError('invalid_quote_token'); }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new ShippingQuoteTokenError('invalid_quote_token');
  }
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); }
  catch { throw new ShippingQuoteTokenError('invalid_quote_token'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.v !== 1
      || !payload.quoteId || !/^[a-f0-9]{64}$/.test(String(payload.fingerprint || ''))
      || (payload.selectionFingerprint !== null
        && !/^[a-f0-9]{64}$/.test(String(payload.selectionFingerprint || '')))
      || !Array.isArray(payload.groups) || payload.groups.length > 20) {
    throw new ShippingQuoteTokenError('invalid_quote_token');
  }
  const expiresAt = Date.parse(payload.expiresAt || '');
  if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new ShippingQuoteTokenError('quote_expired', 409);
  for (const group of payload.groups) {
    if (!group || typeof group !== 'object' || Array.isArray(group)
        || !group.groupId || !group.supplier || !group.originId
        || (group.rateMinor !== null && !Number.isSafeInteger(group.rateMinor))
        || (group.currency !== null && !/^[A-Z]{3}$/.test(String(group.currency)))
        || (group.convertedRateMinor !== null && !Number.isSafeInteger(group.convertedRateMinor))
        || (group.convertedCurrency !== null && !/^[A-Z]{3}$/.test(String(group.convertedCurrency)))) {
      throw new ShippingQuoteTokenError('invalid_quote_token');
    }
  }
  return Object.freeze(payload);
}
