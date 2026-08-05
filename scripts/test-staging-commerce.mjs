import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import handler from '../api/staging-order.js';
import { DIRECT_CART_PRODUCTS, policyPriceIsFresh } from '../server/commerce-policy.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadCatalogue() {
  const context = { window: {} };
  vm.createContext(context);
  for (const file of ['assets/data.js', 'assets/ecs-products.js']) {
    vm.runInContext(fs.readFileSync(path.join(repo, file), 'utf8'), context, { filename: file });
  }
  return context.window.PROJX_DATA;
}

function response() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    end(value = '') { this.body = String(value); }
  };
}

async function invoke({ method = 'POST', body = {}, origin = 'https://projxracing.com' } = {}) {
  const headers = { host: 'projxracing.com', origin, 'idempotency-key': body.idempotencyKey || '' };
  const req = { method, body, headers };
  const res = response();
  await handler(req, res);
  return { status: res.statusCode, body: JSON.parse(res.body || '{}'), headers: res.headers };
}

const data = loadCatalogue();
const policyIds = Object.keys(DIRECT_CART_PRODUCTS);
const directProduct = data.storeProducts.find(product => product.slug === policyIds[0]);
const ecsProducts = data.storeProducts.filter(product => product.provider === 'ECS Tuning');
const quotePackages = data.parts.filter(product => product.catalogType === 'quote-package');
const excludedReviewedProducts = data.storeProducts.filter(product => !policyIds.includes(product.slug));
const policy = DIRECT_CART_PRODUCTS[policyIds[0]];

const tests = [
  ['converts exactly one explicitly approved product', policyIds.length === 1],
  ['approved product exists in reviewed catalogue', Boolean(directProduct)],
  ['approved SKU and price match reviewed data', directProduct?.sku === policy.sku && directProduct?.priceCurrency === policy.currency && directProduct?.priceAmount === policy.unitAmount],
  ['approved price review is fresh on 2026-08-05', policyPriceIsFresh(policy, Date.parse('2026-08-05T12:00:00.000Z'))],
  ['keeps every ECS item in quotation flow', ecsProducts.length === 14 && ecsProducts.every(product => !policyIds.includes(product.slug))],
  ['keeps every configured package in quotation flow', quotePackages.length > 0 && quotePackages.every(product => !policyIds.includes(product.slug))],
  ['keeps all non-approved reviewed products in quotation flow', excludedReviewedProducts.length === data.storeProducts.length - 1]
];

const basePayload = {
  idempotencyKey: 'a'.repeat(48),
  locale: 'en',
  page: 'https://projxracing.com/en/checkout/',
  startedAt: Date.now() - 5000,
  website: '',
  customer: { name: 'Commerce QA', email: 'qa@example.com', phone: '+965 5555 0000' },
  destination: { country: 'Kuwait', city: 'Kuwait City', addressLine: '', postcode: '', fulfilment: 'courier' },
  vehicle: { description: '2024 Toyota GR Yaris LHD', vin: '' },
  notes: 'Staging request only.',
  acknowledgement: true,
  consent: true,
  items: [{ productId: policy.productId, sku: policy.sku, quantity: 2, unitAmount: policy.unitAmount, currency: policy.currency }]
};

tests.push(['rejects non-POST methods', (await invoke({ method: 'GET' })).status === 405]);
tests.push(['rejects cross-origin submission', (await invoke({ body: basePayload, origin: 'https://example.com' })).status === 403]);
tests.push(['measures parsed request bodies instead of trusting Content-Length', (await invoke({
  body: { ...basePayload, idempotencyKey: 'z'.repeat(48), padding: 'x'.repeat(25_000) }
})).status === 413]);
tests.push(['rejects missing checkout consent', (await invoke({ body: { ...basePayload, idempotencyKey: 'b'.repeat(48), consent: false } })).status === 400]);
tests.push(['rejects tampered price', (await invoke({ body: { ...basePayload, idempotencyKey: 'c'.repeat(48), items: [{ ...basePayload.items[0], unitAmount: 1 }] } })).status === 409]);

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.RESEND_API_KEY;
const originalFrom = process.env.ENQUIRY_FROM_EMAIL;
const originalTo = process.env.ENQUIRY_TO_EMAIL;
const originalAntiAbuse = process.env.PUBLIC_FORM_ANTI_ABUSE_READY;
const originalOrderEmail = process.env.STAGING_ORDER_EMAIL_DELIVERY_ENABLED;
delete process.env.RESEND_API_KEY;
delete process.env.ENQUIRY_FROM_EMAIL;
delete process.env.ENQUIRY_TO_EMAIL;
delete process.env.PUBLIC_FORM_ANTI_ABUSE_READY;
delete process.env.STAGING_ORDER_EMAIL_DELIVERY_ENABLED;
const simulated = await invoke({ body: { ...basePayload, idempotencyKey: 'd'.repeat(48) } });
tests.push(['defaults to a no-send simulated completion', simulated.status === 200 && simulated.body.accepted === true && simulated.body.simulated === true && simulated.body.notificationSent === false && simulated.body.completionStatus === 'simulated_only' && simulated.body.durableOrderCreated === false]);

process.env.STAGING_ORDER_EMAIL_DELIVERY_ENABLED = 'true';
const blockedWithoutAntiAbuse = await invoke({ body: { ...basePayload, idempotencyKey: 'f'.repeat(48) } });
tests.push(['fails closed when email is requested without durable anti-abuse readiness', blockedWithoutAntiAbuse.status === 503 && blockedWithoutAntiAbuse.body.error === 'order_email_anti_abuse_not_configured']);

let deliveryCalls = 0;
let deliveredPayload;
let deliveredOptions;
process.env.RESEND_API_KEY = 'test-only-key';
process.env.ENQUIRY_FROM_EMAIL = 'Projx Racing Staging <staging@example.com>';
delete process.env.ENQUIRY_TO_EMAIL;
process.env.PUBLIC_FORM_ANTI_ABUSE_READY = 'true';
globalThis.fetch = async (url, options) => {
  deliveryCalls += 1;
  deliveredOptions = options;
  deliveredPayload = { url, ...JSON.parse(options.body) };
  return { ok: true, text: async () => '' };
};
const acceptedPayload = { ...basePayload, idempotencyKey: 'e'.repeat(48) };
const accepted = await invoke({ body: acceptedPayload });
const duplicate = await invoke({ body: acceptedPayload });
tests.push(['creates a no-payment test-order enquiry only when explicitly enabled', accepted.status === 200 && accepted.body.accepted === true && accepted.body.testMode === true && accepted.body.simulated === false && accepted.body.notificationSent === true && accepted.body.paymentStatus === 'not_collected' && accepted.body.stockReserved === false && accepted.body.durableOrderCreated === false]);
tests.push(['calculates reference subtotal server-side', accepted.body.totals?.[0]?.currency === policy.currency && accepted.body.totals?.[0]?.amount === 62.38]);
tests.push(['routes test-order notification to Projx Racing default inbox', deliveredPayload?.to?.[0] === 'projxracing@gmail.com']);
tests.push(['passes a deterministic provider idempotency key to Resend', /^enquiry-[a-f0-9]{64}$/.test(deliveredOptions?.headers?.['Idempotency-Key'] || '')]);
tests.push(['returns the same request for duplicate submission without resending', duplicate.status === 200 && duplicate.body.duplicate === true && duplicate.body.ref === accepted.body.ref && deliveryCalls === 1]);
tests.push(['labels warm-process retry protection as best-effort only', accepted.body.idempotencyProtection === 'best_effort_process_local']);

globalThis.fetch = originalFetch;
if (originalApiKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = originalApiKey;
if (originalFrom === undefined) delete process.env.ENQUIRY_FROM_EMAIL; else process.env.ENQUIRY_FROM_EMAIL = originalFrom;
if (originalTo === undefined) delete process.env.ENQUIRY_TO_EMAIL; else process.env.ENQUIRY_TO_EMAIL = originalTo;
if (originalAntiAbuse === undefined) delete process.env.PUBLIC_FORM_ANTI_ABUSE_READY; else process.env.PUBLIC_FORM_ANTI_ABUSE_READY = originalAntiAbuse;
if (originalOrderEmail === undefined) delete process.env.STAGING_ORDER_EMAIL_DELIVERY_ENABLED; else process.env.STAGING_ORDER_EMAIL_DELIVERY_ENABLED = originalOrderEmail;

const failed = tests.filter(([, passed]) => !passed);
if (failed.length) {
  for (const [name] of failed) console.error(`FAILED: ${name}`);
  process.exit(1);
}
for (const [name] of tests) console.log(`PASS: ${name}`);
