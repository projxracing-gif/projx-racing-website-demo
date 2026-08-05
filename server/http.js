const DEFAULT_BODY_LIMIT = 64_000;

export class ApiError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function sendJson(res, status, body, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [name, value] of Object.entries(extraHeaders)) res.setHeader(name, value);
  res.end(JSON.stringify(body));
}

export function assertMethod(req, allowed) {
  const methods = new Set(allowed);
  if (!methods.has(req.method)) {
    throw new ApiError(405, 'method_not_allowed', 'This request method is not supported.');
  }
}

export function assertSameOrigin(req) {
  const origin = String(req.headers?.origin || '').trim();
  const fetchSite = String(req.headers?.['sec-fetch-site'] || '').trim().toLowerCase();
  if (!origin) {
    if (fetchSite === 'cross-site') throw new ApiError(403, 'origin_not_allowed');
    return;
  }
  const forwarded = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '')
    .split(',')[0].trim().toLowerCase();
  try {
    const parsed = new URL(origin);
    if (!forwarded || !['https:', 'http:'].includes(parsed.protocol) || parsed.host.toLowerCase() !== forwarded) {
      throw new Error('origin mismatch');
    }
  } catch {
    throw new ApiError(403, 'origin_not_allowed');
  }
}

export function parseJsonObject(req, maximumBytes = DEFAULT_BODY_LIMIT) {
  const declaredLength = Number(req.headers?.['content-length'] || 0);
  if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > maximumBytes) {
    throw new ApiError(413, 'payload_too_large');
  }
  let value;
  try {
    if (typeof req.body === 'string') {
      if (Buffer.byteLength(req.body, 'utf8') > maximumBytes) throw new ApiError(413, 'payload_too_large');
      value = JSON.parse(req.body || '{}');
    } else {
      value = req.body ?? {};
      if (Buffer.byteLength(JSON.stringify(value), 'utf8') > maximumBytes) throw new ApiError(413, 'payload_too_large');
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'invalid_json');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'invalid_payload');
  return value;
}

export function singleQueryValue(req, name) {
  const direct = req.query?.[name];
  if (Array.isArray(direct)) throw new ApiError(400, `invalid_${name}`);
  let parsed;
  try {
    parsed = new URL(req.url || '/', 'https://local.invalid').searchParams.getAll(name);
  } catch {
    throw new ApiError(400, 'invalid_request_url');
  }
  if (parsed.length > 1) throw new ApiError(400, `invalid_${name}`);
  return direct === undefined ? parsed[0] : direct;
}

export function handleApiError(res, error) {
  if (error instanceof ApiError) return sendJson(res, error.status, { error: error.code });
  if (Number.isInteger(error?.status) && error.status >= 400 && error.status <= 503
    && ['authentication_required', 'invalid_session_token', 'auth_not_configured',
      'authentication_service_unavailable'].includes(error?.code)) {
    return sendJson(res, error.status, { error: error.code });
  }
  if (error?.code === 'backend_not_configured' || error?.code === 'auth_not_configured') {
    return sendJson(res, 503, { error: error.code });
  }
  console.error('Customer commerce API request failed', error?.code || error?.name || 'unknown_error');
  return sendJson(res, 500, { error: 'internal_error' });
}

export async function runApiHandler(res, callback) {
  try {
    await callback();
  } catch (error) {
    handleApiError(res, error);
  }
}
