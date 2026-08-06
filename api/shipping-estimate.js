import { canonicalShippingItems, shippingPlan } from '../server/shipping-policy.js';

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
  const host = clean(req.headers?.host, 255).toLowerCase();
  const origin = clean(req.headers?.origin, 500);
  if (!origin) return true;
  try { return !host || new URL(origin).host.toLowerCase() === host; }
  catch { return false; }
}

export default async function handler(req, res) {
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
  const destination = body.destination && typeof body.destination === 'object' && !Array.isArray(body.destination) ? {
    country: clean(body.destination.country, 100),
    city: clean(body.destination.city, 100),
    postcode: clean(body.destination.postcode, 30),
    fulfilment: body.destination.fulfilment === 'workshop' ? 'workshop' : 'courier'
  } : null;
  if (!destination?.country || !destination?.city) return json(res, 400, { error: 'invalid_destination' });
  const items = canonicalShippingItems(body.items);
  if (!items) return json(res, 409, { error: 'invalid_or_stale_cart' });
  return json(res, 200, { accepted: true, estimate: shippingPlan(items, destination) });
}
