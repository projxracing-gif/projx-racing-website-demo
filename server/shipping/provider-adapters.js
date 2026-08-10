import { shippingCurrency, shippingMinorAmount } from './money.js';

const RESULT_STATUSES = new Set(['confirmed', 'partial', 'confirmation_required']);
const INCOTERMS = new Set(['DAP', 'DDP', 'EXW', 'FCA', 'CPT', 'CIP', 'unknown']);
const MAX_PROVIDER_RESPONSE_BYTES = 256_000;

function clean(value, maximum = 160) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function dayRange(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Number.isInteger(value) && value >= 0 && value <= 365) return Object.freeze({ min: value, max: value });
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_day_range');
  const minimum = Number(value.min);
  const maximum = Number(value.max);
  if (!Number.isInteger(minimum) || !Number.isInteger(maximum)
      || minimum < 0 || maximum < minimum || maximum > 365) throw new Error('invalid_day_range');
  return Object.freeze({ min: minimum, max: maximum });
}

function validTimestamp(value, { required = false } = {}) {
  if (!value && !required) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error('invalid_provider_timestamp');
  return parsed.toISOString();
}

export function validateRateOption(option, { now = Date.now() } = {}) {
  if (!option || typeof option !== 'object' || Array.isArray(option)) throw new Error('invalid_rate_option');
  const id = clean(option.id, 120);
  const carrier = clean(option.carrier, 120);
  const service = clean(option.service, 160);
  if (!id || !carrier || !service) throw new Error('invalid_rate_option');
  const rateMinor = shippingMinorAmount(option.rateMinor);
  if (rateMinor === 0) throw new Error('zero_provider_rate_not_allowed');
  const currency = shippingCurrency(option.currency);
  const expiresAt = validTimestamp(option.expiresAt, { required: true });
  if (Date.parse(expiresAt) <= now) throw new Error('expired_rate_option');
  const incoterm = INCOTERMS.has(option.incoterm) ? option.incoterm : 'unknown';
  const dutiesIncluded = typeof option.dutiesIncluded === 'boolean' ? option.dutiesIncluded : null;
  const taxIncluded = typeof option.taxIncluded === 'boolean' ? option.taxIncluded : null;
  if ((incoterm === 'DDP' && dutiesIncluded !== true) || (incoterm === 'DAP' && dutiesIncluded === true)) {
    throw new Error('inconsistent_incoterm_duties');
  }
  const optionalMinor = value => value === null || value === undefined ? null : shippingMinorAmount(value);
  const convertedRateMinor = optionalMinor(option.convertedRateMinor);
  const convertedCurrency = convertedRateMinor === null ? null : shippingCurrency(option.convertedCurrency);
  return Object.freeze({
    id,
    carrier,
    service,
    rateMinor,
    currency,
    convertedRateMinor,
    convertedCurrency,
    dispatchDays: dayRange(option.dispatchDays),
    transitDays: dayRange(option.transitDays),
    incoterm,
    dutiesIncluded,
    taxIncluded,
    insuranceMinor: optionalMinor(option.insuranceMinor),
    handlingMinor: optionalMinor(option.handlingMinor),
    quotedAt: validTimestamp(option.quotedAt) || new Date(now).toISOString(),
    expiresAt,
    providerReference: clean(option.providerReference, 200) || null
  });
}

export function validateProviderQuoteResult(result, { now = Date.now() } = {}) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('invalid_provider_response');
  const status = RESULT_STATUSES.has(result.status) ? result.status : null;
  if (!status) throw new Error('invalid_provider_response');
  const options = Array.isArray(result.options)
    ? result.options.slice(0, 24).map(option => validateRateOption(option, { now }))
    : [];
  if (status === 'confirmed' && options.length < 1) throw new Error('invalid_provider_response');
  const selectedOptionId = clean(result.selectedOptionId, 120) || null;
  if (selectedOptionId && !options.some(option => option.id === selectedOptionId)) {
    throw new Error('invalid_selected_rate_option');
  }
  return Object.freeze({
    status,
    reason: status === 'confirmed' ? null : clean(result.reason, 120) || 'shipping_rate_confirmation_required',
    options: Object.freeze(options),
    selectedOptionId: selectedOptionId || (options.length === 1 ? options[0].id : null),
    provider: clean(result.provider, 80) || null,
    warnings: Object.freeze(Array.isArray(result.warnings)
      ? [...new Set(result.warnings.map(value => clean(value, 160)).filter(Boolean))].slice(0, 20)
      : [])
  });
}

export function createDisabledSupplierAdapter({
  supplierSlug,
  supplierName,
  originCountryCode,
  currency,
  reason = 'authorised_supplier_rate_access_required'
}) {
  const slug = clean(supplierSlug, 80).toLowerCase();
  return Object.freeze({
    id: `${slug}-disabled`,
    supplierSlug: slug,
    supplierName: clean(supplierName, 120),
    originCountryCode: clean(originCountryCode, 2).toUpperCase(),
    currency: shippingCurrency(currency),
    enabled: false,
    async quote() {
      return {
        status: 'confirmation_required', reason, options: [], selectedOptionId: null,
        provider: `${slug}-disabled`, warnings: []
      };
    }
  });
}

function safeFixedEndpoint(value) {
  let endpoint;
  try {
    endpoint = new URL(String(value || ''));
  } catch {
    throw new Error('invalid_provider_endpoint');
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash
      || endpoint.search || endpoint.port) {
    throw new Error('invalid_provider_endpoint');
  }
  return endpoint.href;
}

export function fixedProviderEndpoint(value, allowedEndpoints) {
  const endpoint = safeFixedEndpoint(value);
  const allowlist = new Set((allowedEndpoints || []).map(item => safeFixedEndpoint(item)));
  if (!allowlist.has(endpoint)) throw new Error('invalid_provider_endpoint');
  return endpoint;
}

export function createAuthorizedJsonSupplierAdapter({
  id,
  supplierSlug,
  supplierName,
  originCountryCode,
  currency,
  endpoint,
  allowedEndpoints,
  authorization,
  fetchImpl = globalThis.fetch
}) {
  const fixedEndpoint = fixedProviderEndpoint(endpoint, allowedEndpoints);
  if (typeof fetchImpl !== 'function') throw new Error('provider_fetch_unavailable');
  const auth = clean(authorization, 2_000);
  if (!auth) throw new Error('provider_authorization_unavailable');
  const slug = clean(supplierSlug, 80).toLowerCase();
  return Object.freeze({
    id: clean(id, 80) || `${slug}-authorized-json`,
    supplierSlug: slug,
    supplierName: clean(supplierName, 120),
    originCountryCode: clean(originCountryCode, 2).toUpperCase(),
    currency: shippingCurrency(currency),
    enabled: true,
    async quote(request, { signal } = {}) {
      const response = await fetchImpl(fixedEndpoint, {
        method: 'POST',
        redirect: 'error',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: auth
        },
        body: JSON.stringify(request),
        signal
      });
      const declaredLength = Number(response.headers?.get?.('content-length') || 0);
      if (!response.ok || !Number.isFinite(declaredLength) || declaredLength > MAX_PROVIDER_RESPONSE_BYTES) {
        throw new Error('provider_response_invalid');
      }
      const body = await response.text();
      if (Buffer.byteLength(body, 'utf8') > MAX_PROVIDER_RESPONSE_BYTES) throw new Error('provider_response_too_large');
      let value;
      try { value = JSON.parse(body); } catch { throw new Error('provider_response_invalid'); }
      return value;
    }
  });
}

function configuredMode(value) {
  const mode = clean(value || 'disabled', 40).toLowerCase();
  return ['disabled', 'test', 'live'].includes(mode) ? mode : 'configuration_error';
}

export function createConfiguredSupplierAdapters(env = process.env) {
  const globalMode = configuredMode(env.SUPPLIER_SHIPPING_MODE);
  const adapter = ({ slug, name, country, currency, mode }) => createDisabledSupplierAdapter({
    supplierSlug: slug,
    supplierName: name,
    originCountryCode: country,
    currency,
    reason: globalMode === 'configuration_error' || configuredMode(mode) === 'configuration_error'
      ? 'provider_configuration_invalid'
      : globalMode === 'disabled' ? 'authorised_supplier_rate_access_required'
      : configuredMode(mode) === 'disabled' ? 'authorised_supplier_rate_access_required'
        : 'provider_adapter_not_implemented'
  });
  return new Map([
    ['tegiwa', adapter({
      slug: 'tegiwa', name: 'Tegiwa', country: 'GB', currency: 'GBP',
      mode: env.TEGIWA_INTEGRATION_MODE
    })],
    ['ecs', adapter({
      slug: 'ecs', name: 'ECS Tuning', country: 'US', currency: 'USD',
      mode: env.ECS_INTEGRATION_MODE
    })]
  ]);
}

export function shippingIntegrationReadiness(env = process.env) {
  const globalMode = configuredMode(env.SUPPLIER_SHIPPING_MODE);
  const supplier = (slug, value) => {
    const requestedMode = configuredMode(value);
    return Object.freeze({
      supplier: slug,
      requestedMode,
      enabled: false,
      state: globalMode === 'configuration_error' || requestedMode === 'configuration_error'
        ? 'configuration_error'
        : globalMode === 'disabled' ? 'globally_disabled'
        : requestedMode === 'disabled' ? 'supplier_disabled' : 'adapter_not_implemented'
    });
  };
  return Object.freeze({
    globalMode,
    liveRatingAvailable: false,
    suppliers: Object.freeze([
      supplier('tegiwa', env.TEGIWA_INTEGRATION_MODE),
      supplier('ecs', env.ECS_INTEGRATION_MODE)
    ])
  });
}

function confirmation(reason, provider = null, durationMs = 0) {
  return Object.freeze({
    status: 'confirmation_required', reason, options: Object.freeze([]), selectedOptionId: null,
    provider, warnings: Object.freeze([]), durationMs
  });
}

export async function quoteSupplierAdapter(adapter, request, {
  timeoutMs = 2_500,
  now = Date.now()
} = {}) {
  if (!adapter || typeof adapter.quote !== 'function') return confirmation('provider_adapter_unavailable');
  const boundedTimeout = Math.max(10, Math.min(10_000, Number(timeoutMs) || 2_500));
  const controller = new AbortController();
  let timer;
  const startedAt = Date.now();
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(Object.assign(new Error('provider_timeout'), { code: 'provider_timeout' }));
      }, boundedTimeout);
    });
    const pending = Promise.resolve().then(() => adapter.quote(request, { signal: controller.signal }));
    const raw = await Promise.race([pending, timeout]);
    const result = validateProviderQuoteResult(raw, { now });
    return Object.freeze({ ...result, durationMs: Math.max(0, Date.now() - startedAt) });
  } catch (error) {
    const code = error?.code === 'provider_timeout' ? 'provider_timeout' : 'provider_response_invalid';
    return confirmation(code, clean(adapter.id, 80) || null, Math.max(0, Date.now() - startedAt));
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
