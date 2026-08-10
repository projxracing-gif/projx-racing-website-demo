import { canonicalShippingItems, shippingPlan } from '../server/shipping-policy.js';
import { canonicalDestination, ShippingValidationError, shippingAllowedCountryCodes,
  shippingIdempotencyKey } from '../server/shipping/validation.js';
import { buildShippingQuote } from '../server/shipping/quote.js';
import { createConfiguredSupplierAdapters, shippingIntegrationReadiness } from '../server/shipping/provider-adapters.js';
import { createDisabledCurrencyConverter } from '../server/shipping/money.js';
import { signShippingQuoteToken } from '../server/shipping/quote-token.js';
import { shippingCommercialRulesFromEnvironment } from '../server/shipping/commercial-rules.js';
import { persistShippingQuoteIfConfigured } from '../server/shipping/repository.js';
import shippingRevalidateHandler from '../server/shipping/revalidate-handler.js';

const MAX_BODY_BYTES = 16_000;

function clean(value, maximum = 300) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maximum);
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

function parsedBody(req) {
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8') || '{}');
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  return req.body || {};
}

function sameOrigin(req) {
  const host = clean(req.headers?.['x-forwarded-host'] || req.headers?.host, 255).split(',')[0].toLowerCase();
  const origin = clean(req.headers?.origin, 500);
  const fetchSite = clean(req.headers?.['sec-fetch-site'], 40).toLowerCase();
  if (!host || !origin || fetchSite === 'cross-site') return false;
  try { return Boolean(host) && new URL(origin).host.toLowerCase() === host; }
  catch { return false; }
}

export async function shippingEstimateHandler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  if (!sameOrigin(req)) return json(res, 403, { error: 'origin_not_allowed' });
  if (Number(req.headers?.['content-length'] || 0) > MAX_BODY_BYTES) return json(res, 413, { error: 'payload_too_large' });
  let body;
  try { body = parsedBody(req); }
  catch { return json(res, 400, { error: 'invalid_json' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'invalid_payload' });
  try {
    if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_BODY_BYTES) return json(res, 413, { error: 'payload_too_large' });
  } catch {
    return json(res, 400, { error: 'invalid_payload' });
  }
  let destination;
  let idempotencyKey;
  try {
    destination = canonicalDestination(body.destination, {
      requireFullAddress: true,
      allowedCountryCodes: shippingAllowedCountryCodes(process.env)
    });
    idempotencyKey = shippingIdempotencyKey(body.idempotencyKey || req.headers?.['idempotency-key']);
  } catch (error) {
    if (error instanceof ShippingValidationError) return json(res, error.status, { error: error.code });
    return json(res, 400, { error: 'invalid_destination' });
  }
  const items = canonicalShippingItems(body.items);
  if (!items) return json(res, 409, { error: 'invalid_or_stale_cart' });
  try {
    const ttlSeconds = Math.max(60, Math.min(3_600,
      Number(process.env.SUPPLIER_SHIPPING_MAX_QUOTE_AGE_SECONDS) || 900));
    const timeoutMs = Math.max(10, Math.min(10_000,
      Number(process.env.SUPPLIER_SHIPPING_PROVIDER_TIMEOUT_MS) || 2_500));
    const fxMaxAgeMs = Math.max(60, Math.min(86_400,
      Number(process.env.SUPPLIER_SHIPPING_FX_MAX_AGE_SECONDS) || 900)) * 1_000;
    const fxFutureSkewMs = Math.max(0, Math.min(900,
      Number(process.env.SUPPLIER_SHIPPING_FX_FUTURE_SKEW_SECONDS) || 300)) * 1_000;
    let quote = await buildShippingQuote({
      items,
      destination,
      adapters: createConfiguredSupplierAdapters(process.env),
      currencyConverter: createDisabledCurrencyConverter(),
      targetCurrency: process.env.SUPPLIER_SHIPPING_TARGET_CURRENCY || 'KWD',
      idempotencyKey,
      ttlMs: ttlSeconds * 1_000,
      providerTimeoutMs: timeoutMs,
      fxMaxAgeMs,
      fxFutureSkewMs,
      selectedOptions: body.selectedOptions,
      commercialRules: shippingCommercialRulesFromEnvironment(process.env)
    });
    quote = await persistShippingQuoteIfConfigured(quote, {
      env: process.env,
      eventType: 'estimated',
      outcome: quote.status === 'confirmed' ? 'accepted' : 'unavailable'
    });
    const revalidationToken = signShippingQuoteToken(quote, { env: process.env });
    return json(res, 200, {
      accepted: true,
      estimate: {
        ...quote,
        ...(revalidationToken ? { revalidationToken } : {}),
        integrationReadiness: shippingIntegrationReadiness(process.env)
      }
    });
  } catch (error) {
    if (error instanceof ShippingValidationError) return json(res, error.status, { error: error.code });
    // Preserve the existing truthful, no-rate fallback if the new foundation cannot produce a quote.
    return json(res, 200, {
      accepted: true,
      estimate: { ...shippingPlan(items, destination), foundationStatus: 'unavailable' }
    });
  }
}

function shippingOperation(req) {
  const requested = typeof req.query?.shippingOperation === 'string'
    ? clean(req.query.shippingOperation, 30).toLowerCase() : '';
  let pathname = '';
  try { pathname = new URL(req.url || '/', 'https://shipping.local').pathname.replace(/\/+$/, ''); }
  catch { /* Query dispatch remains available for the fixed Vercel rewrite. */ }
  return pathname === '/api/shipping-revalidate' || requested === 'revalidate'
    ? 'revalidate' : 'estimate';
}

export default async function shippingGatewayHandler(req, res) {
  return shippingOperation(req) === 'revalidate'
    ? shippingRevalidateHandler(req, res)
    : shippingEstimateHandler(req, res);
}
