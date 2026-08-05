import { createPublicKey, verify as verifySignature } from 'node:crypto';

const MAX_TOKEN_LENGTH = 16_384;
const MAX_JWKS_BYTES = 200_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 30;
const MAX_SCOPE_VALUES = 20;
const jwksCache = new Map();

export class ClerkAuthError extends Error {
  constructor(status, code) {
    super(code);
    this.name = 'ClerkAuthError';
    this.status = status;
    this.code = code;
  }
}

function decodeJsonSegment(segment) {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new ClerkAuthError(401, 'invalid_session_token');
  try {
    const value = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid object');
    return value;
  } catch {
    throw new ClerkAuthError(401, 'invalid_session_token');
  }
}

function configuredUrl(value, code) {
  if (!value) throw new ClerkAuthError(503, 'auth_not_configured');
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('unsafe url');
    return url;
  } catch {
    throw new ClerkAuthError(503, code);
  }
}

function bearerToken(req) {
  const authorization = String(req.headers?.authorization || '').trim();
  const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(authorization);
  if (!match || match[1].length > MAX_TOKEN_LENGTH) throw new ClerkAuthError(401, 'authentication_required');
  return match[1];
}

function audienceMatches(actual, configured) {
  const values = Array.isArray(actual) ? actual : [actual];
  return configured.some(expected => values.includes(expected));
}

function configuredList(value, code) {
  const values = String(value || '').split(',').map(item => item.trim()).filter(Boolean);
  if (values.length > MAX_SCOPE_VALUES || values.some(item => item.length > 500)) {
    throw new ClerkAuthError(503, code);
  }
  return [...new Set(values)];
}

function authorizedParty(value, configuration = false) {
  try {
    const url = new URL(value);
    const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password || url.pathname !== '/'
      || url.search || url.hash) throw new Error('unsafe party');
    return url.origin;
  } catch {
    if (configuration) throw new ClerkAuthError(503, 'auth_not_configured');
    return null;
  }
}

function tokenScope(env) {
  const audience = configuredList(env.CLERK_AUDIENCE, 'auth_not_configured');
  const parties = configuredList(env.CLERK_AUTHORIZED_PARTIES, 'auth_not_configured')
    .map(value => authorizedParty(value, true));
  if (!audience.length && !parties.length) throw new ClerkAuthError(503, 'auth_not_configured');
  return { audience, parties };
}

async function fetchJwks(url, fetchImpl, nowMs) {
  const key = url.href;
  const cached = jwksCache.get(key);
  if (cached && cached.expiresAt > nowMs) return cached.value;

  let response;
  try {
    response = await fetchImpl(key, {
      method: 'GET',
      redirect: 'error',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4_000)
    });
  } catch {
    throw new ClerkAuthError(503, 'authentication_service_unavailable');
  }
  const declared = Number(response.headers?.get?.('content-length') || 0);
  if (!response.ok || declared > MAX_JWKS_BYTES) throw new ClerkAuthError(503, 'authentication_service_unavailable');
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_JWKS_BYTES) throw new ClerkAuthError(503, 'authentication_service_unavailable');
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ClerkAuthError(503, 'authentication_service_unavailable');
  }
  if (!Array.isArray(value?.keys) || value.keys.length < 1 || value.keys.length > 20) {
    throw new ClerkAuthError(503, 'authentication_service_unavailable');
  }
  jwksCache.set(key, { value, expiresAt: nowMs + CACHE_TTL_MS });
  return value;
}

function claimText(claims, names, maximum) {
  for (const name of names) {
    const value = claims?.[name];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, maximum);
  }
  return null;
}

export async function verifyClerkRequest(req, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const nowMs = options.nowMs ?? Date.now();
  const token = bearerToken(req);
  const parts = token.split('.');
  if (parts.length !== 3) throw new ClerkAuthError(401, 'invalid_session_token');
  const header = decodeJsonSegment(parts[0]);
  const claims = decodeJsonSegment(parts[1]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid || header.kid.length > 255) {
    throw new ClerkAuthError(401, 'invalid_session_token');
  }

  const issuer = configuredUrl(env.CLERK_ISSUER, 'auth_not_configured');
  const jwksUrl = configuredUrl(env.CLERK_JWKS_URL || new URL('/.well-known/jwks.json', issuer).href, 'auth_not_configured');
  const scope = tokenScope(env);
  const jwks = await fetchJwks(jwksUrl, fetchImpl, nowMs);
  const jwk = jwks.keys.find(candidate => candidate?.kid === header.kid && candidate?.kty === 'RSA'
    && (!candidate.alg || candidate.alg === 'RS256') && (!candidate.use || candidate.use === 'sig'));
  if (!jwk) throw new ClerkAuthError(401, 'invalid_session_token');

  let verified = false;
  try {
    const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
    verified = verifySignature('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`, 'ascii'), publicKey,
      Buffer.from(parts[2], 'base64url'));
  } catch {
    verified = false;
  }
  if (!verified) throw new ClerkAuthError(401, 'invalid_session_token');

  const nowSeconds = Math.floor(nowMs / 1000);
  const claimParty = typeof claims.azp === 'string' ? authorizedParty(claims.azp) : null;
  if (claims.iss !== issuer.href.replace(/\/$/, '')
    || typeof claims.sub !== 'string' || !/^[A-Za-z0-9_-]{3,255}$/.test(claims.sub)
    || !Number.isFinite(claims.exp) || claims.exp < nowSeconds - CLOCK_SKEW_SECONDS
    || (Number.isFinite(claims.nbf) && claims.nbf > nowSeconds + CLOCK_SKEW_SECONDS)
    || (Number.isFinite(claims.iat) && claims.iat > nowSeconds + CLOCK_SKEW_SECONDS)
    || (scope.audience.length > 0 && !audienceMatches(claims.aud, scope.audience))
    || (scope.parties.length > 0 && (!claimParty || !scope.parties.includes(claimParty)))) {
    throw new ClerkAuthError(401, 'invalid_session_token');
  }

  return {
    userId: claims.sub,
    sessionId: claimText(claims, ['sid'], 255),
    email: claimText(claims, ['email', 'primary_email_address'], 320),
    displayName: claimText(claims, ['name', 'full_name'], 200),
    claims
  };
}

export function resetClerkJwksCacheForTests() {
  jwksCache.clear();
}
