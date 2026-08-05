import crypto from 'node:crypto';
import enquiryHandler from './enquiry.js';
import { STAGING_COMMERCE_MODE, directCartProduct, policyPriceIsFresh } from './commerce-policy.js';

const MAX_BODY_BYTES = 24_000;
const completedRequests = new Map();
const pendingRequests = new Map();

function clean(value, limit = 3000) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, limit);
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
  const requestHost = clean(req.headers?.host, 255).toLowerCase();
  const origin = clean(req.headers?.origin, 500);
  if (!origin) return true;
  try {
    return !requestHost || new URL(origin).host.toLowerCase() === requestHost;
  } catch {
    return false;
  }
}

function validEmail(value) {
  return /^[^\s@]{1,128}@[^\s@]{1,190}\.[^\s@]{2,63}$/.test(value);
}

function orderReference(idempotencyKey) {
  const digest = crypto.createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 12).toUpperCase();
  return `PRX-TEST-${digest}`;
}

function validateItems(items, now = Date.now()) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) return null;
  const seen = new Set();
  const normalized = [];
  for (const submitted of items) {
    if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) return null;
    const productId = clean(submitted.productId, 180);
    const policy = directCartProduct(productId);
    const quantity = Number(submitted.quantity);
    const amount = Number(submitted.unitAmount);
    const currency = clean(submitted.currency, 3).toUpperCase();
    const sku = clean(submitted.sku, 120);
    if (!policy || seen.has(productId) || !policyPriceIsFresh(policy, now)) return null;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) return null;
    if (sku !== policy.sku || currency !== policy.currency || !Number.isFinite(amount) || Math.abs(amount - policy.unitAmount) > 0.001) return null;
    seen.add(productId);
    normalized.push({
      productId,
      title: policy.title,
      sku: policy.sku,
      quantity,
      unitAmount: policy.unitAmount,
      currency: policy.currency,
      fitmentConfirmationRequired: policy.fitmentConfirmationRequired
    });
  }
  return normalized;
}

function totalsFor(items) {
  const totals = new Map();
  for (const item of items) totals.set(item.currency, (totals.get(item.currency) || 0) + item.unitAmount * item.quantity);
  return [...totals.entries()].map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }));
}

function captureResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    end(value = '') { this.body = String(value); }
  };
}

async function deliverTestOrder(req, order) {
  const deliveryResponse = captureResponse();
  const itemLines = order.items.map(item => `${item.title} | ${item.sku} | ${item.quantity} × ${item.currency} ${item.unitAmount.toFixed(2)}`);
  const totalLines = order.totals.map(total => `${total.currency} ${total.amount.toFixed(2)}`);
  const message = [
    'STAGING TEST ORDER REQUEST — NO PAYMENT COLLECTED — NO STOCK RESERVED.',
    ...itemLines,
    `Reference subtotal: ${totalLines.join(' | ')}`,
    'Final selling price, supplier availability, vehicle fitment, shipping, tax and customs require Projx Racing confirmation.'
  ].join('\n');
  await enquiryHandler({
    method: 'POST',
    headers: req.headers || {},
    body: {
      ref: order.ref,
      type: 'Staging Test Order Enquiry',
      startedAt: order.startedAt,
      website: '',
      page: order.page,
      locale: order.locale,
      fields: {
        name: order.customer.name,
        email: order.customer.email,
        phone: order.customer.phone,
        vehicle: order.vehicle.description,
        vin: order.vehicle.vin,
        country: order.destination.country,
        city: order.destination.city,
        address: order.destination.addressLine,
        postcode: order.destination.postcode,
        fulfilment: order.destination.fulfilment,
        selectedItems: itemLines,
        notes: order.notes,
        paymentStatus: 'not_collected',
        message
      }
    }
  }, deliveryResponse);
  let deliveryBody = {};
  try { deliveryBody = JSON.parse(deliveryResponse.body || '{}'); } catch { /* response shape is checked below */ }
  if (deliveryResponse.statusCode === 503) throw Object.assign(new Error('order_notifications_not_configured'), { code: 'order_notifications_not_configured' });
  if (deliveryResponse.statusCode !== 200 || !deliveryBody.accepted) throw Object.assign(new Error('order_notification_failed'), { code: 'order_notification_failed' });
}

function remember(key, result) {
  // This cache only reduces accidental retries while a single warm process is alive.
  // It is deliberately not presented as durable order storage or distributed idempotency.
  completedRequests.set(key, result);
  if (completedRequests.size > 500) completedRequests.delete(completedRequests.keys().next().value);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  if (!sameOrigin(req)) return json(res, 403, { error: 'origin_not_allowed' });
  const length = Number(req.headers?.['content-length'] || 0);
  if (length > MAX_BODY_BYTES) return json(res, 413, { error: 'payload_too_large' });

  let body;
  try { body = parsedBody(req); } catch { return json(res, 400, { error: 'invalid_json' }); }
  try {
    const serialized = Buffer.isBuffer(req.body) ? req.body : (typeof req.body === 'string' ? req.body : JSON.stringify(body));
    if (Buffer.byteLength(serialized || '', 'utf8') > MAX_BODY_BYTES) return json(res, 413, { error: 'payload_too_large' });
  } catch {
    return json(res, 400, { error: 'invalid_payload' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'invalid_payload' });
  if (clean(body.website, 120)) return json(res, 202, { accepted: true, testMode: true, paymentStatus: 'not_collected' });

  const startedAt = Number(body.startedAt || 0);
  if (!Number.isFinite(startedAt) || Date.now() - startedAt < 1200) return json(res, 429, { error: 'submission_too_fast' });
  const idempotencyKey = clean(body.idempotencyKey, 100);
  const headerKey = clean(req.headers?.['idempotency-key'], 100);
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(idempotencyKey) || (headerKey && headerKey !== idempotencyKey)) return json(res, 400, { error: 'invalid_idempotency_key' });

  const previous = completedRequests.get(idempotencyKey);
  if (previous) return json(res, 200, { ...previous, duplicate: true });
  const pending = pendingRequests.get(idempotencyKey);
  if (pending) {
    try { return json(res, 200, { ...(await pending), duplicate: true }); }
    catch (error) { return json(res, error?.code === 'order_notifications_not_configured' ? 503 : 502, { error: error?.code || 'order_notification_failed' }); }
  }

  const customer = body.customer && typeof body.customer === 'object' && !Array.isArray(body.customer) ? {
    name: clean(body.customer.name, 160), email: clean(body.customer.email, 254), phone: clean(body.customer.phone, 50)
  } : null;
  const destination = body.destination && typeof body.destination === 'object' && !Array.isArray(body.destination) ? {
    country: clean(body.destination.country, 100), city: clean(body.destination.city, 100),
    addressLine: clean(body.destination.addressLine, 300), postcode: clean(body.destination.postcode, 30),
    fulfilment: body.destination.fulfilment === 'workshop' ? 'workshop' : 'courier'
  } : null;
  const vehicle = body.vehicle && typeof body.vehicle === 'object' && !Array.isArray(body.vehicle) ? {
    description: clean(body.vehicle.description, 300), vin: clean(body.vehicle.vin, 24)
  } : null;
  const items = validateItems(body.items);
  if (!customer || !destination || !vehicle || !customer.name || !customer.phone || !validEmail(customer.email)
      || !destination.country || !destination.city || !vehicle.description || body.acknowledgement !== true || body.consent !== true) {
    return json(res, 400, { error: 'missing_or_invalid_required_fields' });
  }
  if (!items) return json(res, 409, { error: 'invalid_or_stale_cart' });

  const emailDeliveryEnabled = process.env.STAGING_ORDER_EMAIL_DELIVERY_ENABLED === 'true';
  const durableAntiAbuseReady = process.env.PUBLIC_FORM_ANTI_ABUSE_READY === 'true';
  if (emailDeliveryEnabled && !durableAntiAbuseReady) {
    return json(res, 503, { error: 'order_email_anti_abuse_not_configured' });
  }

  const order = {
    ref: orderReference(idempotencyKey),
    startedAt,
    locale: body.locale === 'ar' ? 'ar-KW' : 'en-KW',
    page: clean(body.page, 500),
    customer,
    destination,
    vehicle,
    notes: clean(body.notes, 2000),
    items,
    totals: totalsFor(items)
  };
  const processing = (async () => {
    if (emailDeliveryEnabled) await deliverTestOrder(req, order);
    const result = {
      accepted: true,
      testMode: true,
      commerceMode: STAGING_COMMERCE_MODE,
      completionStatus: emailDeliveryEnabled ? 'test_enquiry_sent' : 'simulated_only',
      simulated: !emailDeliveryEnabled,
      notificationSent: emailDeliveryEnabled,
      paymentStatus: 'not_collected',
      stockReserved: false,
      durableOrderCreated: false,
      idempotencyProtection: 'best_effort_process_local',
      ref: order.ref,
      totals: order.totals,
      duplicate: false
    };
    remember(idempotencyKey, result);
    return result;
  })();
  pendingRequests.set(idempotencyKey, processing);
  try {
    return json(res, 200, await processing);
  } catch (error) {
    const status = error?.code === 'order_notifications_not_configured' ? 503 : 502;
    return json(res, status, { error: error?.code || 'order_notification_failed' });
  } finally {
    pendingRequests.delete(idempotencyKey);
  }
}
