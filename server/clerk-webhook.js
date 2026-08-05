import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from './http.js';

const MAX_BODY_BYTES = 128_000;
const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

function singleHeader(req, name) {
  const value = req.headers?.[name];
  if (Array.isArray(value)) throw new ApiError(401, 'invalid_webhook_signature');
  return String(value || '').trim();
}

async function rawBody(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.rawBody === 'string') return Buffer.from(req.rawBody, 'utf8');
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');
  if (req.body !== undefined && req.body !== null) throw new ApiError(400, 'raw_body_required');
  if (!req?.[Symbol.asyncIterator]) throw new ApiError(400, 'raw_body_required');
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw new ApiError(413, 'payload_too_large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function webhookSecret(env) {
  const configured = String(env.CLERK_WEBHOOK_SECRET || '').trim();
  if (!configured) throw new ApiError(503, 'webhook_not_configured');
  const encoded = configured.startsWith('whsec_') ? configured.slice(6) : configured;
  if (!/^[A-Za-z0-9+/=_-]{20,500}$/.test(encoded)) throw new ApiError(503, 'webhook_not_configured');
  const normalized = encoded.replaceAll('-', '+').replaceAll('_', '/');
  const secret = Buffer.from(normalized, 'base64');
  if (secret.length < 16) throw new ApiError(503, 'webhook_not_configured');
  return secret;
}

function signatureCandidates(header) {
  return header.split(/\s+/).map(value => value.split(',', 2))
    .filter(([version, signature]) => version === 'v1' && /^[A-Za-z0-9+/=_-]{20,500}$/.test(signature || ''))
    .map(([, signature]) => Buffer.from(signature.replaceAll('-', '+').replaceAll('_', '/'), 'base64'));
}

export async function verifyClerkWebhook(req, options = {}) {
  const env = options.env || process.env;
  const nowMs = options.nowMs ?? Date.now();
  const messageId = singleHeader(req, 'svix-id');
  const timestamp = singleHeader(req, 'svix-timestamp');
  const signatureHeader = singleHeader(req, 'svix-signature');
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(messageId) || !/^\d{10}$/.test(timestamp) || !signatureHeader) {
    throw new ApiError(401, 'invalid_webhook_signature');
  }
  const timestampNumber = Number(timestamp);
  if (Math.abs(Math.floor(nowMs / 1000) - timestampNumber) > TIMESTAMP_TOLERANCE_SECONDS) {
    throw new ApiError(401, 'stale_webhook');
  }
  const body = await rawBody(req);
  if (!body.length || body.length > MAX_BODY_BYTES) throw new ApiError(body.length ? 413 : 400, body.length ? 'payload_too_large' : 'invalid_payload');
  const expected = createHmac('sha256', webhookSecret(env))
    .update(`${messageId}.${timestamp}.`, 'utf8').update(body).digest();
  const valid = signatureCandidates(signatureHeader)
    .some(candidate => candidate.length === expected.length && timingSafeEqual(candidate, expected));
  if (!valid) throw new ApiError(401, 'invalid_webhook_signature');
  let event;
  try {
    event = JSON.parse(body.toString('utf8'));
  } catch {
    throw new ApiError(400, 'invalid_json');
  }
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new ApiError(400, 'invalid_payload');
  return { event, messageId };
}
