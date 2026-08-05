import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyClerkRequest, resetClerkJwksCacheForTests } from '../server/clerk-auth.js';
import { getCommerceDatabase, resetCommerceDatabaseForTests } from '../server/commerce-database.js';
import { validateItems, validateQuoteRequest } from '../server/commerce-validation.js';
import { createAccountHandler, createQuotesHandler } from '../server/customer-commerce-api.js';
import { createClerkWebhookHandler } from '../server/clerk-webhook-api.js';
import { verifyClerkWebhook } from '../server/clerk-webhook.js';
import { createCommerceOutboxRetryHandler } from '../server/commerce-outbox-api.js';
import { createCommerceRepository } from '../server/commerce-repository.js';
import { sendShopEmail, shopQuoteTemplate } from '../server/transactional-email.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function response() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value = '') { this.body = String(value); }
  };
}

async function invoke(handler, request) {
  const res = response();
  await handler({ query: {}, url: '/', headers: {}, body: {}, ...request }, res);
  return { status: res.statusCode, headers: res.headers, body: JSON.parse(res.body || '{}') };
}

function jwt(privateKey, kid, claims) {
  const encode = value => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  const first = encode({ alg: 'RS256', typ: 'JWT', kid });
  const second = encode(claims);
  const signature = sign('RSA-SHA256', Buffer.from(`${first}.${second}`, 'ascii'), privateKey).toString('base64url');
  return `${first}.${second}.${signature}`;
}

test('Clerk verifier validates an RS256 session using the configured issuer JWKS', async () => {
  resetClerkJwksCacheForTests();
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const now = Date.now();
  const token = jwt(privateKey, 'test-key', {
    iss: 'https://clerk.example.test', sub: 'user_test_123', sid: 'sess_test',
    aud: 'projx-website', iat: Math.floor(now / 1000) - 5, exp: Math.floor(now / 1000) + 300
  });
  let fetchCount = 0;
  const fetchImpl = async () => {
    fetchCount += 1;
    return {
      ok: true,
      headers: { get: () => null },
      text: async () => JSON.stringify({ keys: [{ ...jwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] })
    };
  };
  const request = { headers: { authorization: `Bearer ${token}` } };
  const options = {
    env: { CLERK_ISSUER: 'https://clerk.example.test', CLERK_AUDIENCE: 'projx-website' }, fetchImpl, nowMs: now
  };
  assert.equal((await verifyClerkRequest(request, options)).userId, 'user_test_123');
  assert.equal((await verifyClerkRequest(request, options)).sessionId, 'sess_test');
  assert.equal(fetchCount, 1, 'JWKS should be cached between verifications');
});

test('Clerk verifier requires audience or an authorized-party allowlist', async () => {
  resetClerkJwksCacheForTests();
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const now = Date.now();
  const token = jwt(privateKey, 'party-key', {
    iss: 'https://clerk.example.test', sub: 'user_party_123', azp: 'https://preview.projx.example',
    iat: Math.floor(now / 1000) - 5, exp: Math.floor(now / 1000) + 300
  });
  const request = { headers: { authorization: `Bearer ${token}` } };
  const fetchImpl = async () => ({
    ok: true, headers: { get: () => null },
    text: async () => JSON.stringify({ keys: [{ ...jwk, kid: 'party-key', alg: 'RS256', use: 'sig' }] })
  });
  const base = { CLERK_ISSUER: 'https://clerk.example.test' };
  const accepted = await verifyClerkRequest(request, {
    env: { ...base, CLERK_AUTHORIZED_PARTIES: 'https://preview.projx.example' }, fetchImpl, nowMs: now
  });
  assert.equal(accepted.userId, 'user_party_123');
  await assert.rejects(verifyClerkRequest(request, {
    env: { ...base, CLERK_AUTHORIZED_PARTIES: 'https://other.projx.example' }, fetchImpl, nowMs: now
  }), error => error.status === 401 && error.code === 'invalid_session_token');
  await assert.rejects(verifyClerkRequest(request, { env: base, fetchImpl, nowMs: now }),
    error => error.status === 503 && error.code === 'auth_not_configured');
});

test('Clerk verifier fails closed without authentication configuration', async () => {
  await assert.rejects(
    verifyClerkRequest({ headers: { authorization: 'Bearer a.b.c' } }, { env: {} }),
    error => error.code === 'invalid_session_token' || error.code === 'auth_not_configured'
  );
  await assert.rejects(
    verifyClerkRequest({ headers: {} }, { env: {} }),
    error => error.status === 401 && error.code === 'authentication_required'
  );
});

test('Clerk account webhook rejects unsigned events and accepts a fresh verified user.created event', async () => {
  const rawSecret = Buffer.from('test-only-clerk-webhook-secret-32-bytes', 'utf8');
  const env = { CLERK_WEBHOOK_SECRET: `whsec_${rawSecret.toString('base64')}` };
  const nowMs = Date.parse('2026-08-05T17:00:00.000Z');
  const timestamp = String(Math.floor(nowMs / 1000));
  const messageId = 'msg_account_created_123';
  const body = JSON.stringify({
    type: 'user.created',
    data: {
      id: 'user_clerk_123', first_name: 'Test', last_name: 'Customer',
      primary_email_address_id: 'email_1', email_addresses: [{ id: 'email_1', email_address: 'test@example.com' }],
      primary_phone_number_id: 'phone_1', phone_numbers: [{ id: 'phone_1', phone_number: '+965 0000 0000' }]
    }
  });
  const signature = createHmac('sha256', rawSecret).update(`${messageId}.${timestamp}.${body}`, 'utf8').digest('base64');
  const signed = {
    method: 'POST', body,
    headers: { 'svix-id': messageId, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` }
  };
  const verified = await verifyClerkWebhook(signed, { env, nowMs });
  assert.equal(verified.messageId, messageId);
  assert.equal(verified.event.type, 'user.created');
  await assert.rejects(verifyClerkWebhook({ ...signed, headers: {} }, { env, nowMs }),
    error => error.status === 401 && error.code === 'invalid_webhook_signature');

  let notificationEventId;
  let markedSent = false;
  let accountTemplate;
  const repository = {
    syncAccount: async identity => ({ id: 'account-1', status: 'active', ...identity }),
    createAccountNotification: async (_accountId, eventId) => {
      notificationEventId = eventId;
      return { duplicate: false, delivered: false, outbox: { id: 'outbox-1', idempotency_key: 'account:msg_account_created_123:account-shop-v1' } };
    },
    markOutboxSent: async () => { markedSent = true; },
    markOutboxFailed: async () => { throw new Error('unexpected delivery failure'); }
  };
  const handler = createClerkWebhookHandler({
    verify: request => verifyClerkWebhook(request, { env, nowMs }),
    getDatabase: async () => ({}), createRepository: () => repository,
    sendEmail: async ({ template }) => { accountTemplate = template; return { providerMessageId: 'email-account-1' }; }
  });
  const accepted = await invoke(handler, signed);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.notificationStatus, 'sent');
  assert.equal(notificationEventId, messageId);
  assert.equal(markedSent, true);
  assert.match(accountTemplate.subject, /تم تسجيل حساب عميل جديد/u);
  const rejected = await invoke(handler, { method: 'POST', body, headers: {} });
  assert.equal(rejected.status, 401);
});

test('verified Clerk update and delete events synchronize then anonymize without email', async () => {
  const calls = [];
  let emailCount = 0;
  const repository = {
    syncAccount: async identity => {
      calls.push(['sync', identity]);
      return { id: 'account-1', status: 'active', ...identity };
    },
    anonymizeAccountByClerkUserId: async userId => {
      calls.push(['anonymize', userId]);
      return { id: 'account-1', status: 'anonymized' };
    }
  };
  const handler = createClerkWebhookHandler({
    verify: async request => ({ event: request.verifiedEvent, messageId: request.messageId || 'msg_lifecycle' }),
    getDatabase: async () => ({}), createRepository: () => repository,
    sendEmail: async () => { emailCount += 1; return { providerMessageId: 'unexpected' }; }
  });
  const updated = await invoke(handler, {
    method: 'POST', verifiedEvent: {
      type: 'user.updated', data: {
        id: 'user_clerk_123', first_name: 'Updated', last_name: 'Customer',
        primary_email_address_id: 'email_1', email_addresses: [{ id: 'email_1', email_address: 'updated@example.com' }]
      }
    }
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.lifecycle, 'synchronized');
  const deleted = await invoke(handler, {
    method: 'POST', verifiedEvent: { type: 'user.deleted', data: { id: 'user_clerk_123', deleted: true } }
  });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.lifecycle, 'anonymized');
  assert.deepEqual(calls.map(call => call[0]), ['sync', 'anonymize']);
  assert.equal(emailCount, 0);
});

test('commerce database fails closed without DATABASE_URL', async () => {
  resetCommerceDatabaseForTests();
  await assert.rejects(getCommerceDatabase({ env: {} }), error => error.code === 'backend_not_configured');
});

test('cart and quote validation rejects unbounded or malformed money and identities', () => {
  assert.throws(() => validateItems([{ supplier: 'tegiwa', productId: 'part-1', title: 'Part', quantity: 0 }]),
    error => error.code === 'invalid_quantity');
  assert.throws(() => validateItems([{ supplier: 'tegiwa', productId: 'part-1', title: 'Part', quantity: 1,
    unitAmount: 100, currency: 'pounds' }]), error => error.code === 'invalid_currency');
  assert.throws(() => validateItems([
    { supplier: 'tegiwa', productId: 'part-1', title: 'Part', quantity: 1 },
    { supplier: 'tegiwa', productId: 'part-1', title: 'Part', quantity: 2 }
  ]), error => error.code === 'duplicate_item');
  const quote = validateQuoteRequest({
    idempotencyKey: 'quote-test-123456789', locale: 'ar',
    customer: { name: 'Customer', phone: '+965 0000 0000', email: 'customer@example.com' },
    destination: { country: 'Kuwait', city: 'Kuwait City' },
    vehicle: { description: 'BMW B58' },
    items: [{ supplier: 'tegiwa', productId: 'part-1', sku: 'SKU-1', title: 'Part', quantity: 2,
      unitAmount: 1250, currency: 'GBP' }]
  });
  assert.deepEqual(quote.totals, [{ currency: 'GBP', amount: 2500 }]);
});

test('bilingual quote template escapes customer content and includes Arabic', () => {
  const template = shopQuoteTemplate({
    reference: 'PRX-Q-TEST',
    quote: {
      locale: 'ar', customer: { name: '<script>', phone: '+965', email: null },
      destination: { city: 'Kuwait', country: 'Kuwait' }, vehicle: { description: 'BMW' }, notes: '<b>note</b>',
      items: [{ title: '<img>', optionTitle: null, sku: 'SKU', quantity: 1, unitAmount: 12345, currency: 'GBP' }]
    }
  });
  assert.match(template.subject, /طلب عرض سعر جديد/u);
  assert.doesNotMatch(template.html, /<script>|<img>|<b>note<\/b>/);
  assert.match(template.html, /&lt;script&gt;/);
  assert.match(template.html, /Customer-submitted prices are intentionally omitted/);
  assert.doesNotMatch(template.html, /123\.45|Listed price|>GBP</);
});

test('Resend delivery uses the shop address and deterministic idempotency header', async () => {
  let request;
  const result = await sendShopEmail({
    idempotencyKey: 'quote:00000000-0000-4000-8000-000000000000:commerce-shop-v1',
    template: { subject: 'Subject', html: '<p>Body</p>', text: 'Body' },
    env: { RESEND_API_KEY: 'test-key', COMMERCE_FROM_EMAIL: 'Projx Racing <web@example.com>' },
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return { ok: true, json: async () => ({ id: 'email_test' }) };
    }
  });
  assert.equal(request.body.to[0], 'projxracing@gmail.com');
  assert.equal(request.options.headers['Idempotency-Key'], 'quote:00000000-0000-4000-8000-000000000000:commerce-shop-v1');
  assert.equal(result.providerMessageId, 'email_test');
});

test('account endpoint is Clerk-protected and blocks cross-origin updates', async () => {
  const account = { id: 'account-1', status: 'active', preferredLocale: 'en' };
  const repository = {
    ensureAccount: async () => account,
    updateAccount: async (_id, values) => ({ ...account, ...values })
  };
  const handler = createAccountHandler({
    authenticate: async () => ({ userId: 'user-1' }), getDatabase: async () => ({}),
    createRepository: () => repository
  });
  const get = await invoke(handler, { method: 'GET' });
  assert.equal(get.status, 200);
  const blocked = await invoke(handler, {
    method: 'PATCH', headers: { host: 'projx.example', origin: 'https://evil.example' },
    body: { displayName: 'Customer' }
  });
  assert.equal(blocked.status, 403);
});

test('quote endpoint persists before sending and records successful delivery', async () => {
  let markedSent = false;
  let sentKey;
  const repository = {
    ensureAccount: async () => ({ id: 'account-1', status: 'active' }),
    createQuote: async (_accountId, request) => ({
      quote: { id: 'quote-1', reference: 'PRX-Q-TEST', status: 'submitted', ...request }, duplicate: false,
      outbox: { id: 'outbox-1', idempotency_key: 'quote:quote-1:commerce-shop-v1' }
    }),
    markOutboxSent: async () => { markedSent = true; },
    markOutboxFailed: async () => { throw new Error('unexpected failure'); }
  };
  const handler = createQuotesHandler({
    authenticate: async () => ({ userId: 'user-1' }), getDatabase: async () => ({}),
    createRepository: () => repository,
    sendEmail: async ({ idempotencyKey: key }) => { sentKey = key; return { providerMessageId: 'email-1' }; }
  });
  const created = await invoke(handler, {
    method: 'POST', url: '/api/quotes',
    headers: { host: 'projx.example', origin: 'https://projx.example', 'idempotency-key': 'quote-test-123456789' },
    body: {
      locale: 'en', customer: { name: 'Customer', phone: '+965', email: 'customer@example.com' },
      destination: { country: 'Kuwait' }, vehicle: { description: 'BMW' },
      items: [{ supplier: 'tegiwa', productId: 'part-1', sku: 'SKU-1', title: 'Part', quantity: 1,
        unitAmount: 1000, currency: 'GBP' }]
    }
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.notificationStatus, 'sent');
  assert.equal(sentKey, 'quote:quote-1:commerce-shop-v1');
  assert.equal(markedSent, true);
});

test('account anonymization removes mutable profile data but retains legal snapshots', async () => {
  let statements;
  const repository = createCommerceRepository({
    query: async () => [],
    transaction: async values => {
      statements = values;
      return [[{
        id: 'account-1', clerk_user_id: 'user_clerk_123', email: null, display_name: null,
        phone: null, preferred_locale: 'en', status: 'anonymized', created_at: 'created', updated_at: 'updated'
      }], [], [], []];
    }
  });
  const result = await repository.anonymizeAccountByClerkUserId('user_clerk_123');
  assert.equal(result.status, 'anonymized');
  const sql = statements.map(value => value.statement).join('\n');
  assert.match(sql, /INSERT INTO app_private\.customer_accounts \(clerk_user_id, status\)/);
  assert.match(sql, /email=NULL, display_name=NULL, phone=NULL, status='anonymized'/);
  assert.match(sql, /DELETE FROM app_private\.customer_addresses/);
  assert.match(sql, /DELETE FROM app_private\.carts/);
  assert.match(sql, /aggregate_type='account'/);
  assert.doesNotMatch(sql, /DELETE FROM app_private\.(?:quotes|orders)/);
});

test('outbox retry worker fails closed and sends a claimed message once', async () => {
  const secret = 'test-only-retry-secret-32-bytes-long';
  const quote = {
    locale: 'en', customer: { name: 'Customer', phone: '+965', email: 'customer@example.com' },
    destination: { country: 'Kuwait', city: 'Kuwait City' }, vehicle: { description: 'BMW' }, notes: null,
    items: [{ title: 'Part', optionTitle: null, sku: 'SKU-1', quantity: 1, unitAmount: 1000, currency: 'GBP' }]
  };
  let claimed = 0;
  let markedSent = 0;
  let deliveredKey;
  const repository = {
    claimEmailOutbox: async limit => {
      claimed += 1;
      assert.equal(limit, 5);
      return [{
        id: 'outbox-1', event_type: 'quote.submitted', template_version: 'commerce-shop-v1',
        idempotency_key: 'quote:quote-1:commerce-shop-v1', payload: { reference: 'PRX-Q-TEST', quote }
      }];
    },
    markClaimedOutboxSent: async () => { markedSent += 1; return true; },
    markClaimedOutboxFailed: async () => { throw new Error('unexpected failure'); }
  };
  const handler = createCommerceOutboxRetryHandler({
    env: { COMMERCE_OUTBOX_RETRY_SECRET: secret },
    validateEmail: () => ({}), getDatabase: async () => ({}), createRepository: () => repository,
    sendEmail: async ({ idempotencyKey: key }) => { deliveredKey = key; return { providerMessageId: 'email-1' }; }
  });
  const missingAuth = await invoke(handler, { method: 'POST' });
  assert.equal(missingAuth.status, 401);
  assert.equal(claimed, 0);
  const accepted = await invoke(handler, {
    method: 'POST', headers: { authorization: `Bearer ${secret}` }
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(accepted.body, { processed: 1, sent: 1, failed: 0 });
  assert.equal(deliveredKey, 'quote:quote-1:commerce-shop-v1');
  assert.equal(markedSent, 1);

  const unconfigured = createCommerceOutboxRetryHandler({
    env: {}, getDatabase: async () => { throw new Error('database must not be reached'); }
  });
  const unavailable = await invoke(unconfigured, { method: 'POST' });
  assert.equal(unavailable.status, 503);
});

test('private commerce migration remains additive and isolated', () => {
  const migration = fs.readFileSync(path.join(repo, 'migrations/002_private_customer_commerce.sql'), 'utf8');
  const roleTemplate = fs.readFileSync(path.join(repo, 'migrations/002_private_customer_commerce_role_template.sql'), 'utf8');
  assert.match(migration, /CREATE SCHEMA IF NOT EXISTS app_private/);
  assert.match(migration, /REVOKE ALL ON SCHEMA app_private FROM PUBLIC/);
  for (const table of ['customer_accounts', 'customer_addresses', 'carts', 'cart_items', 'quotes',
    'quote_items', 'orders', 'order_items', 'email_outbox']) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS app_private\\.${table}`));
  }
  assert.doesNotMatch(migration, /\bDROP\s+(?:TABLE|SCHEMA|COLUMN)\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.match(migration, /'anonymized'/);
  assert.match(migration, /'cancelled'/);
  assert.match(roleTemplate, /CREATE ROLE projx_commerce_runtime\s+NOLOGIN/);
  assert.match(roleTemplate, /REVOKE CREATE ON SCHEMA public FROM projx_commerce_runtime/);
  assert.doesNotMatch(roleTemplate, /GRANT\s+ALL/i);
  assert.doesNotMatch(roleTemplate, /PASSWORD\s+['"]/i);
});
