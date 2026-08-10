const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const MAX_MINOR_AMOUNT = 1_000_000_000_000;
const CURRENCY_EXPONENTS = Object.freeze({ BHD: 3, IQD: 3, JOD: 3, KWD: 3, OMR: 3, TND: 3 });
const SUPPORTED_CURRENCIES = new Set([
  'AED', 'BHD', 'EUR', 'GBP', 'IQD', 'JOD', 'KWD', 'OMR', 'QAR', 'SAR', 'TND', 'USD'
]);

export class ShippingMoneyError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ShippingMoneyError';
    this.code = code;
  }
}

export function shippingCurrency(value) {
  const currency = String(value || '').trim().toUpperCase();
  if (!CURRENCY_PATTERN.test(currency) || !SUPPORTED_CURRENCIES.has(currency)) {
    throw new ShippingMoneyError('invalid_currency');
  }
  return currency;
}

export function shippingMinorAmount(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MINOR_AMOUNT) {
    throw new ShippingMoneyError('invalid_minor_amount');
  }
  return value;
}

export function shippingCurrencyExponent(value) {
  const currency = shippingCurrency(value);
  return CURRENCY_EXPONENTS[currency] ?? 2;
}

export function shippingMinorToDecimal(amountMinor, currency) {
  const amount = shippingMinorAmount(amountMinor);
  const exponent = shippingCurrencyExponent(currency);
  const factor = 10 ** exponent;
  const whole = Math.floor(amount / factor);
  const fraction = String(amount % factor).padStart(exponent, '0');
  return `${whole}.${fraction}`;
}

export function shippingDecimalToMinor(value, currency) {
  const exponent = shippingCurrencyExponent(currency);
  const normalized = String(value ?? '').trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(normalized);
  if (!match) throw new ShippingMoneyError('invalid_decimal_amount');
  const fraction = match[2] || '';
  if (fraction.length > exponent) throw new ShippingMoneyError('minor_precision_exceeded');
  const result = Number(match[1]) * (10 ** exponent) + Number(fraction.padEnd(exponent, '0') || 0);
  return shippingMinorAmount(result);
}

function decimalRatio(value) {
  const normalized = String(value ?? '').trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,12}))?$/.exec(normalized);
  if (!match) throw new ShippingMoneyError('invalid_exchange_rate');
  const scale = 10n ** BigInt((match[2] || '').length);
  const numerator = BigInt(match[1]) * scale + BigInt(match[2] || '0');
  if (numerator <= 0n) throw new ShippingMoneyError('invalid_exchange_rate');
  return { numerator, scale, normalized };
}

export function convertMinorAtRate(amountMinor, fromCurrency, toCurrency, exchangeRate) {
  const amount = shippingMinorAmount(amountMinor);
  const sourceExponent = shippingCurrencyExponent(fromCurrency);
  const targetExponent = shippingCurrencyExponent(toCurrency);
  const ratio = decimalRatio(exchangeRate);
  const numerator = BigInt(amount) * ratio.numerator * (10n ** BigInt(targetExponent));
  const denominator = ratio.scale * (10n ** BigInt(sourceExponent));
  const rounded = (numerator * 2n + denominator) / (denominator * 2n);
  if (rounded > BigInt(MAX_MINOR_AMOUNT)) throw new ShippingMoneyError('minor_amount_overflow');
  return Object.freeze({
    amountMinor: Number(rounded),
    currency: shippingCurrency(toCurrency),
    originalAmountMinor: amount,
    originalCurrency: shippingCurrency(fromCurrency),
    exchangeRate: ratio.normalized
  });
}

export function shippingMoney(amountMinor, currency) {
  return Object.freeze({
    amountMinor: shippingMinorAmount(amountMinor),
    currency: shippingCurrency(currency)
  });
}

export function addShippingMoney(values) {
  if (!Array.isArray(values) || values.length < 1) throw new ShippingMoneyError('invalid_money_values');
  const currency = shippingCurrency(values[0]?.currency);
  let amountMinor = 0;
  for (const value of values) {
    if (shippingCurrency(value?.currency) !== currency) throw new ShippingMoneyError('mixed_currency_total');
    amountMinor += shippingMinorAmount(value?.amountMinor);
    if (!Number.isSafeInteger(amountMinor) || amountMinor > MAX_MINOR_AMOUNT) {
      throw new ShippingMoneyError('minor_amount_overflow');
    }
  }
  return shippingMoney(amountMinor, currency);
}

export function createDisabledCurrencyConverter(reason = 'authorised_fx_access_required') {
  return Object.freeze({
    name: 'disabled',
    enabled: false,
    async convert({ amountMinor, fromCurrency, toCurrency }) {
      const source = shippingCurrency(fromCurrency);
      const target = shippingCurrency(toCurrency);
      const amount = shippingMinorAmount(amountMinor);
      if (source === target) {
        return Object.freeze({
          status: 'confirmed', amountMinor: amount, currency: target,
          originalAmountMinor: amount, originalCurrency: source,
          exchangeRate: '1', exchangeRateAsOf: null, provider: 'identity'
        });
      }
      return Object.freeze({
        status: 'confirmation_required', reason,
        amountMinor: null, currency: target,
        originalAmountMinor: amount, originalCurrency: source,
        exchangeRate: null, exchangeRateAsOf: null, provider: null
      });
    }
  });
}

export async function convertShippingMoney(converter, input, {
  now = Date.now(),
  maxAgeMs = 15 * 60_000,
  futureSkewMs = 5 * 60_000
} = {}) {
  const provider = converter || createDisabledCurrencyConverter();
  const requestedAmount = shippingMinorAmount(input?.amountMinor);
  const requestedSource = shippingCurrency(input?.fromCurrency);
  const requestedTarget = shippingCurrency(input?.toCurrency);
  const result = await provider.convert(input);
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new ShippingMoneyError('invalid_conversion_response');
  }
  const originalAmountMinor = shippingMinorAmount(result.originalAmountMinor);
  const originalCurrency = shippingCurrency(result.originalCurrency);
  const currency = shippingCurrency(result.currency);
  if (originalAmountMinor !== requestedAmount || originalCurrency !== requestedSource || currency !== requestedTarget) {
    throw new ShippingMoneyError('conversion_request_mismatch');
  }
  if (result.status !== 'confirmed') {
    return Object.freeze({
      status: 'confirmation_required',
      reason: String(result.reason || 'currency_conversion_unavailable').slice(0, 120),
      amountMinor: null,
      currency,
      originalAmountMinor,
      originalCurrency,
      exchangeRate: null,
      exchangeRateAsOf: null,
      provider: null
    });
  }
  const amountMinor = shippingMinorAmount(result.amountMinor);
  const exchangeRate = String(result.exchangeRate || '').trim();
  if (!/^(?:0\.\d{1,12}|[1-9]\d*(?:\.\d{1,12})?)$/.test(exchangeRate)) {
    throw new ShippingMoneyError('invalid_exchange_rate');
  }
  const exchangeRateAsOf = result.exchangeRateAsOf ? new Date(result.exchangeRateAsOf) : null;
  if (exchangeRateAsOf && !Number.isFinite(exchangeRateAsOf.getTime())) {
    throw new ShippingMoneyError('invalid_exchange_rate_timestamp');
  }
  const expected = convertMinorAtRate(requestedAmount, requestedSource, requestedTarget, exchangeRate);
  if (expected.amountMinor !== amountMinor || (requestedAmount > 0 && amountMinor === 0)) {
    throw new ShippingMoneyError('conversion_amount_mismatch');
  }
  const providerName = String(result.provider || provider.name || '').slice(0, 80) || null;
  if (requestedSource !== requestedTarget && (!exchangeRateAsOf || !providerName)) {
    throw new ShippingMoneyError('conversion_provenance_required');
  }
  const boundedMaxAge = Math.max(60_000, Math.min(86_400_000, Number(maxAgeMs) || 15 * 60_000));
  const boundedFutureSkew = Math.max(0, Math.min(15 * 60_000, Number(futureSkewMs) || 5 * 60_000));
  if (requestedSource !== requestedTarget) {
    const observed = exchangeRateAsOf.getTime();
    if (observed < now - boundedMaxAge || observed > now + boundedFutureSkew) {
      throw new ShippingMoneyError('exchange_rate_stale');
    }
  }
  return Object.freeze({
    status: 'confirmed', amountMinor, currency, originalAmountMinor, originalCurrency,
    exchangeRate, exchangeRateAsOf: exchangeRateAsOf?.toISOString() || null,
    provider: providerName
  });
}
