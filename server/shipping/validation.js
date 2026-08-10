const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{15,199}$/;

export const GCC_COUNTRY_CODES = Object.freeze(['KW', 'SA', 'AE', 'QA', 'BH', 'OM']);

export function shippingAllowedCountryCodes(env = process.env) {
  const raw = shippingText(env?.SUPPLIER_SHIPPING_ALLOWED_COUNTRIES, 80);
  if (!raw) return GCC_COUNTRY_CODES;
  const values = [...new Set(raw.split(',').map(value => value.trim().toUpperCase()).filter(Boolean))];
  if (!values.length || values.some(value => !GCC_COUNTRY_CODES.includes(value))) {
    throw new ShippingValidationError('invalid_shipping_country_allowlist', 503);
  }
  return Object.freeze(values);
}

const COUNTRY_ALIASES = new Map([
  ['kw', { code: 'KW', name: 'Kuwait' }],
  ['kuwait', { code: 'KW', name: 'Kuwait' }],
  ['state of kuwait', { code: 'KW', name: 'Kuwait' }],
  ['الكويت', { code: 'KW', name: 'Kuwait' }],
  ['دولة الكويت', { code: 'KW', name: 'Kuwait' }],
  ['sa', { code: 'SA', name: 'Saudi Arabia' }],
  ['saudi arabia', { code: 'SA', name: 'Saudi Arabia' }],
  ['kingdom of saudi arabia', { code: 'SA', name: 'Saudi Arabia' }],
  ['السعودية', { code: 'SA', name: 'Saudi Arabia' }],
  ['المملكة العربية السعودية', { code: 'SA', name: 'Saudi Arabia' }],
  ['ae', { code: 'AE', name: 'United Arab Emirates' }],
  ['uae', { code: 'AE', name: 'United Arab Emirates' }],
  ['united arab emirates', { code: 'AE', name: 'United Arab Emirates' }],
  ['الإمارات', { code: 'AE', name: 'United Arab Emirates' }],
  ['الإمارات العربية المتحدة', { code: 'AE', name: 'United Arab Emirates' }],
  ['qa', { code: 'QA', name: 'Qatar' }],
  ['qatar', { code: 'QA', name: 'Qatar' }],
  ['قطر', { code: 'QA', name: 'Qatar' }],
  ['bh', { code: 'BH', name: 'Bahrain' }],
  ['bahrain', { code: 'BH', name: 'Bahrain' }],
  ['البحرين', { code: 'BH', name: 'Bahrain' }],
  ['om', { code: 'OM', name: 'Oman' }],
  ['oman', { code: 'OM', name: 'Oman' }],
  ['عمان', { code: 'OM', name: 'Oman' }],
  ['سلطنة عمان', { code: 'OM', name: 'Oman' }],
  ['gb', { code: 'GB', name: 'Great Britain' }],
  ['great britain', { code: 'GB', name: 'Great Britain' }],
  ['united kingdom', { code: 'GB', name: 'Great Britain' }],
  ['uk', { code: 'GB', name: 'Great Britain' }],
  ['us', { code: 'US', name: 'United States' }],
  ['usa', { code: 'US', name: 'United States' }],
  ['united states', { code: 'US', name: 'United States' }],
  ['united states of america', { code: 'US', name: 'United States' }]
]);

export class ShippingValidationError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'ShippingValidationError';
    this.code = code;
    this.status = status;
  }
}

export function shippingText(value, maximum = 300, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ShippingValidationError('missing_required_field');
    return '';
  }
  if (typeof value !== 'string') throw new ShippingValidationError('invalid_field');
  const result = value.normalize('NFKC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if ((required && !result) || Array.from(result).length > maximum) {
    throw new ShippingValidationError('invalid_field');
  }
  return result;
}

function canonicalCountry(value, explicitName = '') {
  const normalized = shippingText(value, 100, { required: true });
  const alias = COUNTRY_ALIASES.get(normalized.toLocaleLowerCase('en-US'));
  if (alias) return alias;
  const code = normalized.toUpperCase();
  if (!COUNTRY_CODE_PATTERN.test(code)) throw new ShippingValidationError('invalid_country_code');
  return { code, name: shippingText(explicitName, 100) || code };
}

export function canonicalDestination(input, {
  requireFullAddress = false,
  allowedCountryCodes = GCC_COUNTRY_CODES
} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ShippingValidationError('invalid_destination');
  }
  const countryInput = input.countryCode || input.country;
  let country;
  try {
    country = canonicalCountry(countryInput, input.country);
  } catch (error) {
    if (error instanceof ShippingValidationError) {
      throw new ShippingValidationError(error.code === 'missing_required_field' ? 'invalid_destination' : error.code);
    }
    throw error;
  }
  const allowed = new Set(allowedCountryCodes || []);
  if (allowed.size && !allowed.has(country.code)) throw new ShippingValidationError('unsupported_destination_country');
  const city = shippingText(input.city, 150, { required: true });
  const addressLine1 = shippingText(input.addressLine1 || input.addressLine, 300);
  const destination = Object.freeze({
    countryCode: country.code,
    country: country.name,
    governorate: shippingText(input.governorate || input.region, 150),
    area: shippingText(input.area, 150),
    city,
    addressLine1,
    addressLine2: shippingText(input.addressLine2, 300),
    postcode: shippingText(input.postcode || input.postalCode, 40),
    phone: shippingText(input.phone, 60),
    fulfilment: input.fulfilment === 'workshop' ? 'workshop' : 'courier'
  });
  if (requireFullAddress && destination.fulfilment === 'workshop') {
    throw new ShippingValidationError('workshop_rate_confirmation_required');
  }
  if (requireFullAddress && (!destination.governorate || !destination.area
      || !destination.addressLine1 || !destination.postcode || !destination.phone)) {
    throw new ShippingValidationError('incomplete_delivery_address');
  }
  return destination;
}

export function destinationFingerprintInput(destination) {
  const normalized = canonicalDestination(destination, { allowedCountryCodes: [] });
  return {
    countryCode: normalized.countryCode,
    governorate: normalized.governorate.toLocaleLowerCase('en-US'),
    area: normalized.area.toLocaleLowerCase('en-US'),
    city: normalized.city.toLocaleLowerCase('en-US'),
    addressLine1: normalized.addressLine1.toLocaleLowerCase('en-US'),
    addressLine2: normalized.addressLine2.toLocaleLowerCase('en-US'),
    postcode: normalized.postcode.toLocaleUpperCase('en-US'),
    fulfilment: normalized.fulfilment
  };
}

export function shippingIdempotencyKey(value) {
  const normalized = shippingText(value, 200);
  if (!normalized) return '';
  if (!IDEMPOTENCY_KEY_PATTERN.test(normalized)) {
    throw new ShippingValidationError('invalid_idempotency_key');
  }
  return normalized;
}
