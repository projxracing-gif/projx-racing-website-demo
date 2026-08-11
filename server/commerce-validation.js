import { ApiError } from './http.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;
const SIMPLE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/;
const SOURCE_HANDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function rejectUnknown(value, allowed) {
  const unknown = Object.keys(value).filter(key => !allowed.has(key));
  if (unknown.length) throw new ApiError(400, 'invalid_payload');
}

export function text(value, maximum, { required = false, minimum = 1 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ApiError(400, 'missing_required_field');
    return null;
  }
  if (typeof value !== 'string') throw new ApiError(400, 'invalid_field');
  const cleaned = value.normalize('NFKC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .trim();
  const length = Array.from(cleaned).length;
  if (length < minimum || length > maximum) throw new ApiError(400, 'invalid_field');
  return cleaned;
}

export function locale(value, fallback = 'en') {
  const normalized = String(value || fallback).toLowerCase();
  if (!['en', 'ar'].includes(normalized)) throw new ApiError(400, 'invalid_locale');
  return normalized;
}

export function uuid(value, code = 'invalid_id') {
  const normalized = String(value || '').trim();
  if (!UUID_PATTERN.test(normalized)) throw new ApiError(400, code);
  return normalized.toLowerCase();
}

export function idempotencyKey(value) {
  const normalized = text(value, 200, { required: true, minimum: 16 });
  if (!SIMPLE_KEY_PATTERN.test(normalized)) throw new ApiError(400, 'invalid_idempotency_key');
  return normalized;
}

export function validateAccountPatch(value) {
  rejectUnknown(value, new Set(['displayName', 'phone', 'preferredLocale']));
  if (!Object.keys(value).length) throw new ApiError(400, 'empty_update');
  const result = {};
  if ('displayName' in value) result.displayName = text(value.displayName, 200);
  if ('phone' in value) result.phone = text(value.phone, 60);
  if ('preferredLocale' in value) result.preferredLocale = locale(value.preferredLocale);
  return result;
}

export function validateAddress(value) {
  rejectUnknown(value, new Set([
    'label', 'recipientName', 'phone', 'addressLine1', 'addressLine2', 'area', 'city',
    'postalCode', 'countryCode', 'isDefaultShipping', 'isDefaultBilling'
  ]));
  const countryCode = text(value.countryCode, 2, { required: true }).toUpperCase();
  if (!COUNTRY_PATTERN.test(countryCode)) throw new ApiError(400, 'invalid_country_code');
  if (typeof value.isDefaultShipping !== 'undefined' && typeof value.isDefaultShipping !== 'boolean') {
    throw new ApiError(400, 'invalid_default_shipping');
  }
  if (typeof value.isDefaultBilling !== 'undefined' && typeof value.isDefaultBilling !== 'boolean') {
    throw new ApiError(400, 'invalid_default_billing');
  }
  return {
    label: text(value.label, 80, { required: true }),
    recipientName: text(value.recipientName, 200, { required: true }),
    phone: text(value.phone, 60, { required: true }),
    addressLine1: text(value.addressLine1, 300, { required: true }),
    addressLine2: text(value.addressLine2, 300),
    area: text(value.area, 150),
    city: text(value.city, 150, { required: true }),
    postalCode: text(value.postalCode, 40),
    countryCode,
    isDefaultShipping: value.isDefaultShipping === true,
    isDefaultBilling: value.isDefaultBilling === true
  };
}

function safeAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000_000) {
    throw new ApiError(400, 'invalid_unit_amount');
  }
  return value;
}

function safeCurrency(value, amount) {
  if (amount === null && (value === null || value === undefined || value === '')) return null;
  const normalized = String(value || '').toUpperCase();
  if (!CURRENCY_PATTERN.test(normalized)) throw new ApiError(400, 'invalid_currency');
  return normalized;
}

function validateItem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'invalid_item');
  rejectUnknown(value, new Set([
    'supplier', 'productId', 'sourceHandle', 'supplierProductId', 'variantId', 'sku', 'title', 'optionTitle',
    'quantity', 'unitAmount', 'currency'
  ]));
  if (!Number.isInteger(value.quantity) || value.quantity < 1 || value.quantity > 1000) {
    throw new ApiError(400, 'invalid_quantity');
  }
  const supplier = text(value.supplier, 100, { required: true }).toLowerCase();
  const productId = text(value.productId, 255, { required: true });
  const sourceHandle = text(value.sourceHandle, 255);
  if (!SIMPLE_KEY_PATTERN.test(supplier) || !SIMPLE_KEY_PATTERN.test(productId)
      || (sourceHandle && !SOURCE_HANDLE_PATTERN.test(sourceHandle))) throw new ApiError(400, 'invalid_product_identity');
  const unitAmount = safeAmount(value.unitAmount);
  return {
    supplier,
    productId,
    sourceHandle,
    supplierProductId: text(value.supplierProductId, 255),
    variantId: text(value.variantId, 255),
    sku: text(value.sku, 255),
    title: text(value.title, 500, { required: true }),
    optionTitle: text(value.optionTitle, 300),
    quantity: value.quantity,
    unitAmount,
    currency: safeCurrency(value.currency, unitAmount)
  };
}

export function validateItems(value, maximum = 200) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) throw new ApiError(400, 'invalid_items');
  const items = value.map(validateItem);
  const identities = new Set();
  for (const item of items) {
    const identity = [item.supplier, item.productId, item.variantId || '', item.sku || ''].join('\u0000');
    if (identities.has(identity)) throw new ApiError(400, 'duplicate_item');
    identities.add(identity);
  }
  return items;
}

export function calculateTotals(items) {
  const totals = new Map();
  for (const item of items) {
    if (item.unitAmount === null || !item.currency) continue;
    const next = (totals.get(item.currency) || 0) + item.unitAmount * item.quantity;
    if (!Number.isSafeInteger(next)) throw new ApiError(400, 'total_out_of_range');
    totals.set(item.currency, next);
  }
  return [...totals.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amount]) => ({ currency, amount }));
}

function validateCustomer(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'invalid_customer');
  rejectUnknown(value, new Set(['name', 'email', 'phone']));
  const email = text(value.email, 320);
  if (email && !EMAIL_PATTERN.test(email)) throw new ApiError(400, 'invalid_email');
  return {
    name: text(value.name, 200, { required: true }),
    email,
    phone: text(value.phone, 60, { required: true })
  };
}

function validateDestination(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'invalid_destination');
  rejectUnknown(value, new Set(['country', 'city', 'addressLine', 'postcode', 'fulfilment']));
  return {
    country: text(value.country, 100),
    city: text(value.city, 150),
    addressLine: text(value.addressLine, 500),
    postcode: text(value.postcode, 40),
    fulfilment: text(value.fulfilment, 60)
  };
}

function validateVehicle(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'invalid_vehicle');
  rejectUnknown(value, new Set(['description', 'vin']));
  return {
    description: text(value.description, 500),
    vin: text(value.vin, 40)
  };
}

export function validateQuoteRequest(value, headerKey) {
  rejectUnknown(value, new Set(['idempotencyKey', 'locale', 'customer', 'destination', 'vehicle', 'notes', 'items']));
  const bodyKey = value.idempotencyKey;
  if (bodyKey && headerKey && bodyKey !== headerKey) throw new ApiError(400, 'idempotency_key_mismatch');
  const items = validateItems(value.items);
  return {
    idempotencyKey: idempotencyKey(headerKey || bodyKey),
    locale: locale(value.locale),
    customer: validateCustomer(value.customer),
    destination: validateDestination(value.destination),
    vehicle: validateVehicle(value.vehicle),
    notes: text(value.notes, 4000),
    items,
    totals: calculateTotals(items)
  };
}
