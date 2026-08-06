import { directCartProduct, policyPriceIsFresh } from './commerce-policy.js';

const MAX_ITEMS = 20;

function text(value, maximum = 300) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

export function canonicalShippingItems(items, now = Date.now()) {
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) return null;
  const normalized = [];
  const seen = new Set();
  for (const submitted of items) {
    if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) return null;
    const productId = text(submitted.productId, 180);
    const policy = directCartProduct(productId);
    const quantity = Number(submitted.quantity);
    const sku = text(submitted.sku, 120);
    if (!policy || seen.has(productId) || !policyPriceIsFresh(policy, now)) return null;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99 || sku !== policy.sku) return null;
    const supplier = policy.supplier;
    if (!supplier?.slug || !supplier?.name || !supplier?.originCountryCode || !supplier?.originCountryName) return null;
    seen.add(productId);
    normalized.push(Object.freeze({
      productId,
      sku: policy.sku,
      quantity,
      supplier: Object.freeze({ ...supplier })
    }));
  }
  return normalized;
}

export function supplierShipmentGroups(items) {
  const grouped = new Map();
  for (const item of items || []) {
    const key = item.supplier.slug;
    const current = grouped.get(key) || {
      supplier: item.supplier.slug,
      supplierName: item.supplier.name,
      originCountryCode: item.supplier.originCountryCode,
      originCountryName: item.supplier.originCountryName,
      itemCount: 0,
      quantity: 0,
      items: []
    };
    current.itemCount += 1;
    current.quantity += item.quantity;
    current.items.push({ productId: item.productId, sku: item.sku, quantity: item.quantity });
    grouped.set(key, current);
  }
  return [...grouped.values()].map(group => Object.freeze({
    ...group,
    items: Object.freeze(group.items),
    status: 'confirmation_required',
    rate: null,
    carrier: null,
    service: null,
    transitDays: null,
    reason: 'authorised_supplier_rate_access_required'
  }));
}

export function shippingPlan(items, destination) {
  const groups = supplierShipmentGroups(items);
  return Object.freeze({
    status: 'confirmation_required',
    destination: Object.freeze({
      country: text(destination?.country, 100),
      city: text(destination?.city, 100),
      postcode: text(destination?.postcode, 30),
      fulfilment: destination?.fulfilment === 'workshop' ? 'workshop' : 'courier'
    }),
    splitShipment: groups.length > 1,
    groupCount: groups.length,
    groups: Object.freeze(groups),
    dutiesIncluded: false,
    paymentRequired: false,
    message: 'Live supplier shipping rates require authorised ECS Tuning and Tegiwa rate access. No rate has been guessed.'
  });
}
