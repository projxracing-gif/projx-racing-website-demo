import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import handler from '../api/staging-order.js';
import shippingHandler from '../api/shipping-estimate.js';
import { DIRECT_CART_PRODUCTS, policyPriceIsFresh } from '../server/commerce-policy.js';
import { shippingPlan } from '../server/shipping-policy.js';

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

async function invokeShipping({ method = 'POST', body = {}, origin = 'https://projxracing.com' } = {}) {
  const req = { method, body, headers: { host: 'projxracing.com', origin } };
  const res = response();
  await shippingHandler(req, res);
  return { status: res.statusCode, body: JSON.parse(res.body || '{}'), headers: res.headers };
}

const data = loadCatalogue();
const clientSource = fs.readFileSync(path.join(repo, 'assets/app.js'), 'utf8');
const commerceStyles = fs.readFileSync(path.join(repo, 'assets/styles.css'), 'utf8');
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
  ['approved cart product has a verified supplier fulfilment profile', policy.supplier?.slug === 'tegiwa' && policy.supplier?.originCountryCode === 'GB'],
  ['client cart policy carries the same supplier origin profile', clientSource.includes('originCountryCode: "GB"') && clientSource.includes('originCountryName: "Great Britain"')],
  ['checkout requests a destination-aware shipping plan', clientSource.includes('const SHIPPING_ESTIMATE_ENDPOINT = "/api/shipping-estimate/"') && clientSource.includes('async function requestShippingEstimate(form)')],
  ['checkout receipt preserves the server shipping snapshot', clientSource.includes('shipping: safeShippingPlan(result.shipping)')],
  ['supplier shipment cards have responsive presentation styles', commerceStyles.includes('.shipping-planner') && commerceStyles.includes('.shipping-group') && commerceStyles.includes('.shipping-split-notice')],
  ['keeps every ECS item in quotation flow', ecsProducts.length > 0 && ecsProducts.every(product => !policyIds.includes(product.slug))],
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

const shippingPayload = {
  destination: basePayload.destination,
  items: basePayload.items.map(({ productId, sku, quantity }) => ({ productId, sku, quantity }))
};

tests.push(['shipping estimator rejects non-POST methods', (await invokeShipping({ method: 'GET' })).status === 405]);
tests.push(['shipping estimator rejects cross-origin submission', (await invokeShipping({ body: shippingPayload, origin: 'https://example.com' })).status === 403]);
tests.push(['shipping estimator requires a usable destination', (await invokeShipping({ body: { ...shippingPayload, destination: { country: '', city: '' } } })).status === 400]);
tests.push(['shipping estimator rejects a tampered product identity', (await invokeShipping({ body: { ...shippingPayload, items: [{ ...shippingPayload.items[0], sku: 'TAMPERED' }] } })).status === 409]);
const shippingEstimate = await invokeShipping({ body: shippingPayload });
tests.push(['shipping estimator returns one truthful Great Britain supplier group', shippingEstimate.status === 200
  && shippingEstimate.body.estimate?.groupCount === 1
  && shippingEstimate.body.estimate?.groups?.[0]?.supplier === 'tegiwa'
  && shippingEstimate.body.estimate?.groups?.[0]?.originCountryCode === 'GB']);
tests.push(['shipping estimator never fabricates an unavailable rate', shippingEstimate.body.estimate?.status === 'confirmation_required'
  && shippingEstimate.body.estimate?.groups?.[0]?.rate === null
  && shippingEstimate.body.estimate?.groups?.[0]?.carrier === null
  && shippingEstimate.body.estimate?.groups?.[0]?.service === null
  && shippingEstimate.body.estimate?.groups?.[0]?.reason === 'verified_package_data_missing_and_live_rate_access_not_connected'
  && shippingEstimate.body.estimate?.groups?.[0]?.packageDataStatus === 'not_available'
  && shippingEstimate.body.estimate?.groups?.[0]?.rateAccessStatus === 'not_connected'
  && shippingEstimate.body.estimate?.groups?.[0]?.blockingReasons?.join(',') === 'verified_package_data_required,authorised_dynamic_rate_access_required']);
const tegiwaShippingGroup = shippingEstimate.body.estimate?.groups?.[0];
tests.push(['Tegiwa group identifies the verified checkout and rate-source evidence', tegiwaShippingGroup?.quoteMethod === 'shopify_dynamic_checkout'
  && tegiwaShippingGroup?.rateSource === 'Calcurates'
  && tegiwaShippingGroup?.fulfilmentSystem === 'Despatch Cloud'
  && tegiwaShippingGroup?.evidenceAsOf === '2026-08-10']);
tests.push(['Tegiwa metadata does not promote a bounded DHL observation to a live quote', tegiwaShippingGroup?.carrier === null
  && tegiwaShippingGroup?.observedCarrierFamilies?.join(',') === 'DHL Express'
  && tegiwaShippingGroup?.restrictions?.includes('dhl_express_observation_is_limited_to_one_bounded_kuwait_test')
  && tegiwaShippingGroup?.restrictions?.includes('despatch_cloud_is_a_fulfilment_and_data_processor_not_a_verified_rating_engine')]);
tests.push(['Tegiwa metadata exposes required calculation inputs without a proprietary formula', tegiwaShippingGroup?.calculationFactors?.includes('verified_package_weight_and_dimensions')
  && tegiwaShippingGroup?.requiredInputs?.includes('destination_postcode')
  && tegiwaShippingGroup?.consolidationPolicy === 'supplier_checkout_confirmation_required'
  && tegiwaShippingGroup?.dutiesMode === 'not_proven_included_confirm_exact_quote']);
const mixedPlan = shippingPlan([
  { productId: 'tegiwa-test', sku: 'TEG-1', quantity: 1, supplier: { slug: 'tegiwa', name: 'Tegiwa', originCountryCode: 'GB', originCountryName: 'Great Britain' } },
  { productId: 'ecs-test', sku: 'ECS-1', quantity: 2, supplier: { slug: 'ecs', name: 'ECS Tuning', originCountryCode: 'US', originCountryName: 'United States' } }
], basePayload.destination);
tests.push(['mixed supplier carts are explicitly split into separate origin groups', mixedPlan.splitShipment === true
  && mixedPlan.groupCount === 2
  && mixedPlan.groups.map(group => group.originCountryCode).sort().join(',') === 'GB,US']);
const ecsShippingGroup = mixedPlan.groups.find(group => group.supplier === 'ecs');
tests.push(['ECS group truthfully exposes dynamic method and undisclosed backend metadata', ecsShippingGroup?.quoteMethod === 'dynamic_destination_aware_supplier_cart'
  && ecsShippingGroup?.rateSource === 'undisclosed_supplier_backend'
  && ecsShippingGroup?.fulfilmentSystem === 'undisclosed'
  && ecsShippingGroup?.observedCarrierFamilies?.join(',') === 'UPS,FedEx,USPS'
  && ecsShippingGroup?.restrictions?.includes('backend_rating_vendor_is_not_publicly_disclosed')
  && ecsShippingGroup?.evidenceAsOf === '2026-08-10']);
tests.push(['ECS metadata preserves disclosed consolidation and duties constraints', ecsShippingGroup?.calculationFactors?.includes('fulfilment_location')
  && ecsShippingGroup?.requiredInputs?.includes('verified_package_weight_and_dimensions')
  && ecsShippingGroup?.consolidationPolicy === 'hold_until_all_items_are_in_stock_unless_partial_shipment_is_requested'
  && ecsShippingGroup?.dutiesMode === 'recipient_responsible_unless_supplier_explicitly_states_otherwise']);
const originPlan = shippingPlan([
  { productId: 'ecs-ohio-a', sku: 'ECS-OH-1', quantity: 1, supplier: { slug: 'ecs', name: 'ECS Tuning', originId: 'ECS-OH', originCountryCode: 'US', originCountryName: 'United States' } },
  { productId: 'ecs-ohio-b', sku: 'ECS-OH-2', quantity: 2, supplier: { slug: 'ecs', name: 'ECS Tuning', originId: 'ecs-oh', originCountryCode: 'US', originCountryName: 'United States' } },
  { productId: 'ecs-direct', sku: 'ECS-DS-1', quantity: 1, supplier: { slug: 'ecs', name: 'ECS Tuning', originId: 'DIRECT-SHIP-1', originCountryCode: 'US', originCountryName: 'United States' } }
], basePayload.destination);
tests.push(['explicit origin IDs override supplier grouping and consolidate case-insensitively', originPlan.groupCount === 2
  && originPlan.groups.find(group => group.originId === 'ECS-OH')?.itemCount === 2
  && originPlan.groups.every(group => group.groupBasis === 'origin_id')]);
const crossSupplierOriginPlan = shippingPlan([
  { productId: 'tegiwa-main', sku: 'TEG-MAIN', quantity: 1, supplier: { slug: 'tegiwa', name: 'Tegiwa', originId: 'MAIN', originCountryCode: 'GB', originCountryName: 'Great Britain' } },
  { productId: 'ecs-main', sku: 'ECS-MAIN', quantity: 1, supplier: { slug: 'ecs', name: 'ECS Tuning', originId: 'main', originCountryCode: 'US', originCountryName: 'United States' } }
], basePayload.destination);
tests.push(['equal origin IDs never merge across different suppliers', crossSupplierOriginPlan.groupCount === 2
  && crossSupplierOriginPlan.groups.map(group => group.supplier).sort().join(',') === 'ecs,tegiwa']);
const supplierFallbackPlan = shippingPlan([
  { productId: 'tegiwa-a', sku: 'TEG-A', quantity: 1, supplier: { slug: 'tegiwa', name: 'Tegiwa', originCountryCode: 'GB', originCountryName: 'Great Britain' } },
  { productId: 'tegiwa-b', sku: 'TEG-B', quantity: 1, supplier: { slug: 'tegiwa', name: 'Tegiwa', originCountryCode: 'GB', originCountryName: 'Great Britain' } }
], basePayload.destination);
tests.push(['supplier is the grouping fallback when no origin ID is available', supplierFallbackPlan.groupCount === 1
  && supplierFallbackPlan.groups[0]?.groupBasis === 'supplier'
  && supplierFallbackPlan.groups[0]?.originId === null
  && supplierFallbackPlan.groups[0]?.itemCount === 2]);

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
tests.push(['staging order snapshots supplier shipping groups without inventing charges', simulated.body.shipping?.status === 'confirmation_required'
  && simulated.body.shipping?.groups?.[0]?.originCountryCode === 'GB'
  && simulated.body.shipping?.groups?.[0]?.rate === null]);

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
