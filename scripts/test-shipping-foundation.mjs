import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonicalDestination, shippingAllowedCountryCodes } from '../server/shipping/validation.js';
import { packageDataState } from '../server/shipping/package-data.js';
import { convertMinorAtRate, convertShippingMoney, shippingCurrencyExponent,
  shippingDecimalToMinor, shippingMinorToDecimal } from '../server/shipping/money.js';
import { createConfiguredSupplierAdapters, fixedProviderEndpoint, quoteSupplierAdapter,
  validateRateOption } from '../server/shipping/provider-adapters.js';
import { buildShippingQuote, revalidateShippingQuote, shippingQuoteRateDelta } from '../server/shipping/quote.js';
import { signShippingQuoteToken, verifyShippingQuoteToken } from '../server/shipping/quote-token.js';
import { calculateShippingCommercialRules } from '../server/shipping/commercial-rules.js';
import { createShippingQuoteRepository } from '../server/shipping/repository.js';
import shippingEstimateHandler from '../api/shipping-estimate.js';
import shippingRevalidateHandler from '../server/shipping/revalidate-handler.js';
import { policyPriceIsFresh } from '../server/commerce-policy.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const now = Date.parse('2026-08-10T10:00:00.000Z');
const destination = { countryCode: 'KW', governorate: 'Al Asimah', city: 'Kuwait City', area: 'Shuwaikh',
  addressLine1: 'Test address', postcode: '70050', phone: '+96500000000', fulfilment: 'courier' };

function apiResponse() {
  return {
    statusCode: 0, headers: {}, body: '',
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    end(value = '') { this.body = String(value); }
  };
}

async function invokeApi(handler, request) {
  const response = apiResponse();
  await handler({ method: 'POST', headers: {}, body: {}, ...request }, response);
  return { status: response.statusCode, body: JSON.parse(response.body || '{}') };
}

function packageData() {
  return { status: 'verified', weightGrams: 1000, lengthMm: 200, widthMm: 150, heightMm: 100,
    oversized: false, shipsSeparately: false, hazardous: false, fragile: false,
    freightOnly: false, groundOnly: false, source: 'test-fixture',
    observedAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 86_400_000).toISOString() };
}

const items = [
  { productId: 'tegiwa-item', sku: 'TEG-1', quantity: 1, purchaseMode: 'direct-cart',
    packageData: packageData(), supplier: { slug: 'tegiwa', name: 'Tegiwa', originId: 'tegiwa-gb-primary',
      originCountryCode: 'GB', originCountryName: 'Great Britain' } },
  { productId: 'ecs-item', sku: 'ECS-1', quantity: 1, purchaseMode: 'direct-cart',
    packageData: packageData(), supplier: { slug: 'ecs', name: 'ECS Tuning', originId: 'ecs-us-primary',
      originCountryCode: 'US', originCountryName: 'United States' } }
];

function adapters({ tegiwaRate = 1000, ecsRate = 2000 } = {}) {
  const make = (slug, rateMinor, currency, optionId) => ({ id: `${slug}-fixture`, enabled: true,
    async quote() { return { status: 'confirmed', selectedOptionId: optionId, provider: `${slug}-fixture`,
      options: [{ id: optionId, carrier: 'Fixture Carrier', service: 'Express', rateMinor, currency,
        incoterm: 'unknown', dutiesIncluded: null, taxIncluded: null,
        quotedAt: new Date(now).toISOString(), expiresAt: new Date(now + 300_000).toISOString() }] }; } });
  return new Map([
    ['tegiwa', make('tegiwa', tegiwaRate, 'GBP', 'tegiwa-express')],
    ['ecs', make('ecs', ecsRate, 'USD', 'ecs-express')]
  ]);
}

const rates = { GBP: '0.390', USD: '0.307' };
const converter = { name: 'fixture-fx', enabled: true,
  async convert({ amountMinor, fromCurrency, toCurrency }) {
    return { status: 'confirmed', ...convertMinorAtRate(amountMinor, fromCurrency, toCurrency, rates[fromCurrency] || '1'),
      exchangeRateAsOf: new Date(now - 30_000).toISOString(), provider: 'fixture-fx' };
  } };

test('GCC destinations and Arabic aliases canonicalize; outside routes fail closed', () => {
  assert.equal(canonicalDestination({ ...destination, countryCode: '', country: 'الكويت' }).countryCode, 'KW');
  assert.equal(canonicalDestination({ ...destination, countryCode: 'SA' }).countryCode, 'SA');
  assert.deepEqual(shippingAllowedCountryCodes({ SUPPLIER_SHIPPING_ALLOWED_COUNTRIES: 'KW,AE' }), ['KW', 'AE']);
  assert.throws(() => shippingAllowedCountryCodes({ SUPPLIER_SHIPPING_ALLOWED_COUNTRIES: 'GB' }),
    /invalid_shipping_country_allowlist/);
  assert.throws(() => canonicalDestination({ ...destination, countryCode: 'GB' }), /unsupported_destination_country/);
  for (const field of ['governorate', 'area', 'addressLine1', 'postcode', 'phone']) {
    assert.throws(() => canonicalDestination({ ...destination, [field]: '' }, { requireFullAddress: true }),
      /incomplete_delivery_address/);
  }
  assert.throws(() => canonicalDestination({ ...destination, fulfilment: 'workshop' }, { requireFullAddress: true }),
    /workshop_rate_confirmation_required/);
});

test('integer currency conversion preserves three-decimal KWD', () => {
  assert.equal(shippingCurrencyExponent('KWD'), 3);
  assert.equal(shippingCurrencyExponent('JOD'), 3);
  assert.equal(shippingDecimalToMinor('12.345', 'KWD'), 12345);
  assert.equal(shippingMinorToDecimal(12345, 'KWD'), '12.345');
  assert.equal(convertMinorAtRate(1000, 'GBP', 'KWD', '0.390').amountMinor, 3900);
});

test('FX is input-bound and rejects zero, mismatched, and stale results', async () => {
  const base = { amountMinor: 1000, fromCurrency: 'GBP', toCurrency: 'KWD' };
  await assert.rejects(convertShippingMoney({ convert: async () => ({ status: 'confirmed', amountMinor: 0,
    currency: 'KWD', originalAmountMinor: 1000, originalCurrency: 'GBP', exchangeRate: '0.390',
    exchangeRateAsOf: new Date(now).toISOString(), provider: 'bad' }) }, base, { now }), /conversion_amount_mismatch/);
  await assert.rejects(convertShippingMoney({ convert: async () => ({ status: 'confirmed', amountMinor: 3900,
    currency: 'KWD', originalAmountMinor: 999, originalCurrency: 'GBP', exchangeRate: '0.390',
    exchangeRateAsOf: new Date(now).toISOString(), provider: 'bad' }) }, base, { now }), /conversion_request_mismatch/);
  await assert.rejects(convertShippingMoney({ convert: async () => ({ status: 'confirmed', amountMinor: 3900,
    currency: 'KWD', originalAmountMinor: 1000, originalCurrency: 'GBP', exchangeRate: '0.390',
    exchangeRateAsOf: new Date(now - 3_600_000).toISOString(), provider: 'old' }) }, base,
  { now, maxAgeMs: 60_000 }), /exchange_rate_stale/);
});

test('unknown package flags remain blocking', () => {
  const incomplete = packageDataState({ ...packageData(), fragile: undefined }, { now });
  assert.equal(incomplete.status, 'unverified');
  assert.equal(incomplete.fragile, null);
  assert.equal(packageDataState(null, { now }).oversized, null);
  assert.equal(packageDataState({ ...packageData(), observedAt: new Date(now + 3_600_000).toISOString() }, { now }).status,
    'unverified');
  assert.equal(packageDataState({ ...packageData(), expiresAt: null }, { now }).status, 'unverified');
});

test('verified package evidence cannot expire before it was observed', () => {
  const state = packageDataState({ ...packageData(), observedAt: new Date(now + 240_000).toISOString(),
    expiresAt: new Date(now + 120_000).toISOString() }, { now });
  assert.equal(state.status, 'unverified');
  assert.equal(state.reason, 'package_evidence_invalid');
});

test('future-dated price evidence is never treated as fresh', () => {
  assert.equal(policyPriceIsFresh({ priceVerifiedAt: '2026-08-10', maxPriceAgeDays: 7 },
    Date.parse('2026-08-01T12:00:00.000Z')), false);
  assert.equal(policyPriceIsFresh({ priceVerifiedAt: '2026-08-10', maxPriceAgeDays: 7 },
    Date.parse('2026-08-10T12:00:00.000Z')), true);
});

test('provider boundary rejects zero, contradictory duties, SSRF variants, and timeout', async () => {
  assert.throws(() => validateRateOption({ id: 'free', carrier: 'x', service: 'x', rateMinor: 0,
    currency: 'USD', expiresAt: new Date(now + 60_000).toISOString() }, { now }), /zero_provider_rate_not_allowed/);
  assert.throws(() => validateRateOption({ id: 'bad-ddp', carrier: 'x', service: 'x', rateMinor: 100,
    currency: 'USD', incoterm: 'DDP', dutiesIncluded: false,
    expiresAt: new Date(now + 60_000).toISOString() }, { now }), /inconsistent_incoterm_duties/);
  assert.equal(fixedProviderEndpoint('https://quotes.example.test/v1', ['https://quotes.example.test/v1']),
    'https://quotes.example.test/v1');
  assert.throws(() => fixedProviderEndpoint('https://quotes.example.test:444/v1', ['https://quotes.example.test/v1']));
  assert.throws(() => fixedProviderEndpoint('https://quotes.example.test/other', ['https://quotes.example.test/v1']));
  const timed = await quoteSupplierAdapter({ id: 'slow', quote: () => new Promise(() => {}) }, {},
    { timeoutMs: 10, now });
  assert.equal(timed.reason, 'provider_timeout');
});

test('invalid integration modes are redacted and disabled', () => {
  const configured = createConfiguredSupplierAdapters({ SUPPLIER_SHIPPING_MODE: 'secret-looking-value' });
  assert.equal(configured.get('tegiwa').enabled, false);
  assert.equal(configured.get('tegiwa').id, 'tegiwa-disabled');
});

test('mixed GBP and USD rates convert independently and total in KWD', async () => {
  const quote = await buildShippingQuote({ items, destination, adapters: adapters(), currencyConverter: converter, now });
  assert.equal(quote.status, 'confirmed');
  assert.equal(quote.groupCount, 2);
  assert.equal(quote.originalTotalMinor, null);
  assert.equal(quote.totalShippingMinor, 10040);
  assert.equal(quote.currency, 'KWD');
  assert.equal(quote.expiresAt, new Date(now + 300_000).toISOString());
  assert.deepEqual(quote.groups.map(group => group.exchangeRateProvider), ['fixture-fx', 'fixture-fx']);
  assert.equal(quote.paymentEligible, false);
});

test('commercial rules use integer minor units', () => {
  const result = calculateShippingCommercialRules({ baseRateMinor: 10040, currency: 'KWD' }, {
    enabled: true, currency: 'KWD', handlingBps: 500, fxProtectionBps: 200,
    insuranceBps: 100, roundingIncrementMinor: 10, manualReviewThresholdMinor: 10_000 });
  assert.equal(result.handlingMinor, 502);
  assert.equal(result.protectionMarginMinor, 201);
  assert.equal(result.insuranceMinor, 100);
  assert.equal(result.totalMinor, 10850);
  assert.equal(result.manualReviewRequired, true);
});

test('signed token rejects tampering and expiry', async () => {
  const quote = await buildShippingQuote({ items, destination, adapters: adapters(), currencyConverter: converter, now });
  const env = { SUPPLIER_SHIPPING_QUOTE_SIGNING_SECRET: 'test-only-signing-secret-that-is-at-least-32-bytes' };
  const token = signShippingQuoteToken(quote, { env });
  assert.equal(verifyShippingQuoteToken(token, { env, now: now + 1 }).totalShippingMinor, 10040);
  const separator = token.indexOf('.');
  const signatureStart = separator + 1;
  const tamperedToken = `${token.slice(0, signatureStart)}${token[signatureStart] === 'A' ? 'B' : 'A'}${token.slice(signatureStart + 1)}`;
  assert.throws(() => verifyShippingQuoteToken(tamperedToken, { env, now: now + 1 }), /invalid_quote_token/);
  assert.throws(() => verifyShippingQuoteToken(token, { env, now: now + 300_001 }), /quote_expired/);
});

test('revalidation enforces fresh options and customer-total delta', async () => {
  const previous = await buildShippingQuote({ items, destination, adapters: adapters(), currencyConverter: converter, now });
  const selectedOptions = previous.groups.map(group => ({ supplier: group.supplier,
    originId: group.originId, optionId: group.selectedOptionId }));
  const accepted = await revalidateShippingQuote({ previousQuote: previous, items, destination,
    adapters: adapters(), currencyConverter: converter, selectedOptions, now: now + 1000 });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.quote.revalidationStatus, 'server_requoted');
  assert.equal(accepted.quote.paymentEligible, false);
  const changed = await buildShippingQuote({ items, destination, adapters: adapters({ tegiwaRate: 1100 }),
    currencyConverter: converter, now });
  assert.equal(shippingQuoteRateDelta(previous, changed).accepted, false);
});

test('migration preserves unknown flags, origin integrity, private audit, and no-payment state', () => {
  const sql = fs.readFileSync(path.join(repo, 'migrations/004_supplier_shipping_foundation.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS product_fulfilment_packages/);
  assert.match(sql, /oversized BOOLEAN,\s+ships_separately BOOLEAN,\s+hazardous BOOLEAN,/);
  assert.match(sql, /FOREIGN KEY \(origin_id, supplier_id\)/);
  assert.match(sql, /COALESCE\(origin_id, 0\), adapter_key/);
  assert.match(sql, /shipping_provider_config_origin_supplier_fk[\s\S]+FOREIGN KEY \(origin_id, supplier_id\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS app_private\.shipping_rate_audit/);
  assert.match(sql, /duties_included BOOLEAN,\s+tax_included BOOLEAN,/);
  assert.match(sql, /payment_eligible = false/);
  assert.match(sql, /record_state TEXT NOT NULL DEFAULT 'pending'/);
  assert.match(sql, /quote_snapshot JSONB NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(sql, /evidence_expires_at <= evidence_observed_at \+ interval '90 days'/);
});

test('persistence cannot report a complete quote when child transaction fails', async () => {
  const quote = await buildShippingQuote({ items, destination, adapters: adapters(), currencyConverter: converter, now });
  const queries = [];
  let childStatements = [];
  const database = {
    async query(statement) {
      queries.push(statement);
      if (/INSERT INTO app_private\.shipping_quotes/.test(statement)) {
        return [{ quote_id: quote.quoteId, fingerprint: quote.fingerprint }];
      }
      return [];
    },
    async transaction(statements) {
      childStatements = statements;
      throw new Error('fixture_child_failure');
    }
  };
  await assert.rejects(createShippingQuoteRepository(database).recordQuote(quote), /shipping_persistence_unavailable/);
  assert.ok(childStatements.some(entry => /record_state='complete'/.test(entry.statement)),
    'complete state must be part of the failing child transaction');
  assert.ok(queries.some(statement => /DELETE FROM app_private\.shipping_quotes/.test(statement)),
    'a failed child transaction must trigger compensating cleanup');
});

test('exact persisted retries replay one immutable PII-minimised complete snapshot', async () => {
  const quote = await buildShippingQuote({ items, destination, adapters: adapters(), currencyConverter: converter, now });
  let stored = null;
  let transactionCount = 0;
  const database = {
    async query(statement, parameters = []) {
      if (/INSERT INTO app_private\.shipping_quotes/.test(statement)) {
        if (stored) return [];
        stored = {
          quote_id: parameters[0], fingerprint: parameters[2], selection_fingerprint: parameters[3],
          destination_fingerprint: parameters[6], record_state: 'pending', quote_snapshot: parameters[28]
        };
        return [{ quote_id: stored.quote_id, fingerprint: stored.fingerprint }];
      }
      if (/SELECT quote_id, fingerprint, selection_fingerprint/.test(statement)) {
        return [{ ...stored, record_state: 'complete' }];
      }
      return [];
    },
    async transaction() { transactionCount += 1; stored.record_state = 'complete'; return []; }
  };
  const repository = createShippingQuoteRepository(database);
  const first = await repository.recordQuote(quote);
  const replay = await repository.recordQuote(quote);
  assert.equal(first.persisted, true);
  assert.equal(replay.persisted, true);
  assert.equal(replay.replayed, true);
  assert.equal(replay.quoteId, first.quoteId);
  assert.equal(transactionCount, 1, 'an exact retry must not replace immutable child rows');
  assert.doesNotMatch(String(stored.quote_snapshot), /Test address|\+96500000000/);
  assert.equal(replay.destination.addressLine1, destination.addressLine1,
    'the verified current request supplies the non-persisted destination details');
});

test('shipping APIs reject missing Origin and over-limit revalidation bodies before processing', async () => {
  const missingOrigin = await invokeApi(shippingEstimateHandler, {
    headers: { host: 'projxracing.example' }, body: {}
  });
  assert.equal(missingOrigin.status, 403);
  assert.equal(missingOrigin.body.error, 'origin_not_allowed');
  const oversized = await invokeApi(shippingRevalidateHandler, {
    headers: {
      host: 'projxracing.example', origin: 'https://projxracing.example',
      'content-length': '48001'
    },
    body: {}
  });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.body.error, 'payload_too_large');
  const serveSource = fs.readFileSync(path.join(repo, 'scripts/serve.mjs'), 'utf8');
  assert.match(serveSource, /shipping-revalidate'.+limit: 48_000/);
  assert.match(serveSource, /server\/shipping\/revalidate-handler\.js/);
});

test('one deployable shipping function preserves both public operations without body-controlled dispatch', async () => {
  const apiFiles = fs.readdirSync(path.join(repo, 'api')).filter(name => name.endsWith('.js'));
  assert.equal(apiFiles.length, 12);
  assert.equal(apiFiles.includes('shipping-revalidate.js'), false);
  const vercel = JSON.parse(fs.readFileSync(path.join(repo, 'vercel.json'), 'utf8'));
  const rewrites = vercel.rewrites || [];
  assert.ok(rewrites.some(rule => rule.source === '/api/shipping-revalidate'
    && rule.destination === '/api/shipping-estimate?shippingOperation=revalidate'));
  assert.ok(rewrites.some(rule => rule.source === '/api/shipping-revalidate/'
    && rule.destination === '/api/shipping-estimate?shippingOperation=revalidate'));
  const bodyCannotSelect = await invokeApi(shippingEstimateHandler, {
    url: '/api/shipping-estimate/', query: {},
    headers: {
      host: 'projxracing.example', origin: 'https://projxracing.example',
      'content-length': '17000'
    },
    body: { shippingOperation: 'revalidate' }
  });
  assert.equal(bodyCannotSelect.status, 413, 'estimate keeps its 16KB cap even if body requests revalidation');
});
