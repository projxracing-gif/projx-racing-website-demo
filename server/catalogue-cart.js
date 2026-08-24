import { directCartProduct, policyPriceIsFresh } from './commerce-policy.js';
import { resolveTegiwaLiveCartItems, TegiwaLiveCommerceError } from './tegiwa-live-commerce.js';
import { resolveEcsConfirmationCartSelection } from './ecs-confirmation-cart-index.js';

const MAX_ITEMS = 20;

export class CatalogueCartError extends Error {
  constructor(code = 'invalid_or_stale_cart', status = 409, cause = undefined) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = 'CatalogueCartError';
    this.code = code;
    this.status = status;
  }
}

function fail(code = 'invalid_or_stale_cart', status = 409, cause = undefined) {
  throw new CatalogueCartError(code, status, cause);
}

function text(value, maximum = 300) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .trim()
    .slice(0, maximum);
}

function cartSelectionIdentity(item) {
  const supplier = text(item?.supplier?.slug, 80).toLowerCase();
  const handle = text(item?.sourceHandle || item?.productId, 255).toLowerCase();
  return [
    supplier,
    handle,
    text(item?.sku, 120).toUpperCase()
  ].join('\u0000');
}

function directPolicyCartItem(submitted, now, requireMoney) {
  const productId = text(submitted?.productId, 180);
  const policy = directCartProduct(productId);
  if (!policy) return null;
  const quantity = Number(submitted.quantity);
  const unitAmount = Number(submitted.unitAmount);
  const currency = text(submitted.currency, 3).toUpperCase();
  const sku = text(submitted.sku, 120);
  const moneySubmitted = submitted.unitAmount !== undefined && submitted.currency !== undefined;
  if (!policyPriceIsFresh(policy, now)
      || !Number.isInteger(quantity) || quantity < 1 || quantity > 99
      || sku !== policy.sku || (requireMoney && !moneySubmitted)
      || (moneySubmitted && (currency !== policy.currency
        || !Number.isFinite(unitAmount) || Math.abs(unitAmount - policy.unitAmount) > 0.001))) {
    fail();
  }
  if (!policy.supplier?.slug || !policy.supplier?.originCountryCode || !policy.supplier?.originCountryName) fail();
  return Object.freeze({
    source: 'direct_policy',
    productId,
    sourceHandle: policy.sourceHandle || null,
    title: policy.title || productId,
    optionTitle: policy.variantTitle || null,
    sku: policy.sku,
    variantId: policy.variantId || policy.sku,
    quantity,
    unitAmount: policy.unitAmount,
    currency: policy.currency,
    image: policy.image ? { ...policy.image } : null,
    supplierAvailable: typeof policy.supplierAvailable === 'boolean' ? policy.supplierAvailable : null,
    availabilityConfirmationRequired: true,
    fitmentConfirmationRequired: policy.fitmentConfirmationRequired === true,
    purchaseMode: policy.purchaseMode || 'availability-confirmation-required',
    packageData: policy.packageData || null,
    supplier: Object.freeze({ ...policy.supplier }),
    paymentAllowed: false,
    paymentStatus: 'not_collected',
    stockReserved: false
  });
}

function tegiwaSubmittedItem(submitted) {
  const supplier = text(submitted?.supplier, 80).toLowerCase();
  const productId = text(submitted?.productId, 100);
  if (supplier !== 'tegiwa' || !productId.startsWith('tegiwa-live-')) return null;
  return {
    productId,
    sourceHandle: text(submitted.sourceHandle, 255),
    sku: text(submitted.sku, 120),
    quantity: submitted.quantity,
    unitAmount: submitted.unitAmount,
    currency: text(submitted.currency, 3).toUpperCase()
  };
}

function ecsCartItem(submitted, nowValue, requireMoney) {
  const supplier = text(submitted?.supplier, 80).toLowerCase();
  const productId = text(submitted?.productId, 180);
  const handle = text(submitted?.sourceHandle || productId, 180);
  if (supplier !== 'ecs' && !productId.startsWith('ecs-') && !handle.startsWith('ecs-')) return null;
  const result = resolveEcsConfirmationCartSelection({
    productId,
    handle,
    sku: text(submitted?.sku, 40),
    quantity: submitted?.quantity
  }, { nowValue });
  if (!result.ok) fail('invalid_or_stale_cart');
  const selection = result.selection;
  const submittedAmount = Number(submitted?.unitAmount);
  const submittedCurrency = text(submitted?.currency, 3).toUpperCase();
  const moneySubmitted = submitted?.unitAmount !== undefined && submitted?.currency !== undefined;
  if ((requireMoney && !moneySubmitted)
      || (moneySubmitted && (submittedCurrency !== 'USD' || !Number.isFinite(submittedAmount)
        || Math.abs(submittedAmount - selection.price.amount) > 0.001))) fail('invalid_or_stale_cart');
  return Object.freeze({
    source: 'ecs_confirmation_cart_index',
    productId: selection.productId,
    sourceHandle: selection.handle,
    title: selection.title,
    optionTitle: null,
    sku: selection.sku,
    variantId: selection.sku,
    quantity: selection.quantity,
    unitAmount: selection.price.amount,
    currency: 'USD',
    image: { ...selection.image },
    supplierAvailable: null,
    availabilityConfirmationRequired: true,
    fitmentConfirmationRequired: true,
    purchaseMode: selection.purchaseMode,
    packageData: null,
    supplier: Object.freeze({
      slug: 'ecs',
      name: 'ECS Tuning',
      originId: 'ecs-us',
      originCountryCode: 'US',
      originCountryName: 'United States'
    }),
    observedAt: selection.availability.observedAt,
    expiresAt: selection.expiresAt,
    paymentAllowed: false,
    paymentStatus: 'not_collected',
    stockReserved: false
  });
}

function canonicalTegiwaCartItem(item) {
  return Object.freeze({
    source: 'official_tegiwa_product_detail',
    productId: item.productId,
    sourceHandle: item.sourceHandle,
    title: item.title,
    optionTitle: item.variant?.title || null,
    sku: item.sku,
    variantId: item.sku,
    quantity: item.quantity,
    unitAmount: item.unitAmount,
    currency: item.currency,
    image: item.image ? { ...item.image } : null,
    supplierAvailable: item.supplierAvailable === true,
    availabilityConfirmationRequired: true,
    fitmentConfirmationRequired: true,
    purchaseMode: 'availability-confirmation-required',
    packageData: null,
    supplier: Object.freeze({ ...item.supplier }),
    observedAt: item.observedAt,
    expiresAt: item.expiresAt,
    paymentAllowed: false,
    paymentStatus: 'not_collected',
    stockReserved: false
  });
}

export async function resolveCatalogueCartItems(submittedItems, {
  now = Date.now(), fetchImpl = globalThis.fetch, requireMoney = true
} = {}) {
  if (!Array.isArray(submittedItems) || submittedItems.length < 1 || submittedItems.length > MAX_ITEMS) fail();
  const nowValue = typeof now === 'function' ? Number(now()) : Number(now);
  if (!Number.isFinite(nowValue)) fail('invalid_catalogue_clock', 500);
  const resolved = new Array(submittedItems.length);
  const liveSubmitted = [];
  const liveIndexes = [];
  const seen = new Set();
  for (let index = 0; index < submittedItems.length; index += 1) {
    const submitted = submittedItems[index];
    if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) fail();
    const direct = directPolicyCartItem(submitted, nowValue, requireMoney === true);
    if (direct) {
      const identity = cartSelectionIdentity(direct);
      if (seen.has(identity)) fail('duplicate_cart_item');
      seen.add(identity);
      resolved[index] = direct;
      continue;
    }
    const ecs = ecsCartItem(submitted, nowValue, requireMoney === true);
    if (ecs) {
      const identity = cartSelectionIdentity(ecs);
      if (seen.has(identity)) fail('duplicate_cart_item');
      seen.add(identity);
      resolved[index] = ecs;
      continue;
    }
    const live = tegiwaSubmittedItem(submitted);
    const liveIdentity = live ? cartSelectionIdentity({
      productId: live.productId,
      sourceHandle: live.sourceHandle,
      sku: live.sku,
      supplier: { slug: 'tegiwa' }
    }) : '';
    if (!live || seen.has(liveIdentity)) fail(live ? 'duplicate_cart_item' : 'invalid_or_stale_cart');
    seen.add(liveIdentity);
    liveIndexes.push(index);
    liveSubmitted.push(live);
  }
  if (liveSubmitted.length) {
    let liveResolved;
    try {
      liveResolved = await resolveTegiwaLiveCartItems(liveSubmitted, { now: nowValue, fetchImpl });
    } catch (error) {
      if (error instanceof TegiwaLiveCommerceError) fail('invalid_or_stale_cart', error.status === 400 ? 400 : 409, error);
      fail('invalid_or_stale_cart', 409, error);
    }
    for (let index = 0; index < liveResolved.length; index += 1) {
      resolved[liveIndexes[index]] = canonicalTegiwaCartItem(liveResolved[index]);
    }
  }
  if (resolved.some(item => !item)) fail();
  return Object.freeze(resolved);
}

export function shippingItemsFromResolvedCart(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) fail();
  return items.map(item => Object.freeze({
    productId: item.productId,
    sku: item.sku,
    quantity: item.quantity,
    variantId: item.variantId || item.sku,
    purchaseMode: item.purchaseMode || 'availability-confirmation-required',
    fitmentConfirmationRequired: item.fitmentConfirmationRequired === true,
    packageData: item.packageData || null,
    supplier: Object.freeze({ ...item.supplier })
  }));
}
