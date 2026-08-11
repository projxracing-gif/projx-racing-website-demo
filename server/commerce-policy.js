export const STAGING_COMMERCE_MODE = 'request-only';

const TEGIWA_GB_SUPPLIER = Object.freeze({
  slug: 'tegiwa',
  name: 'Tegiwa',
  originCountryCode: 'GB',
  originCountryName: 'Great Britain'
});

function tsukiTshirtPolicy(sizeSlug, sizeTitle, sku) {
  return Object.freeze({
    productId: `tegiwa-2026-team-tegiwa-tsuki-t-shirt-${sizeSlug}`,
    sourceHandle: '2026-team-tegiwa-tsuki-t-shirt',
    title: `2026 Tegiwa Racing Tsuki Team T-Shirt — ${sizeTitle}`,
    variantTitle: sizeTitle,
    variantId: sku,
    sku,
    currency: 'GBP',
    unitAmount: 27.49,
    priceVerifiedAt: '2026-08-10',
    maxPriceAgeDays: 7,
    availabilityVerifiedAt: '2026-08-10',
    maxAvailabilityAgeDays: 7,
    fitmentConfirmationRequired: false,
    purchaseMode: 'direct',
    supplier: TEGIWA_GB_SUPPLIER
  });
}

export const DIRECT_CART_PRODUCTS = Object.freeze({
  'tegiwa-magnust-gr-yaris-gopro-headrest-mount-lhd': Object.freeze({
    productId: 'tegiwa-magnust-gr-yaris-gopro-headrest-mount-lhd',
    title: 'Tegiwa × MagnusT GoPro Headrest Mount — LHD',
    sku: 'T-GOPRO-MOUNT-YARISGR-LHD',
    currency: 'GBP',
    unitAmount: 31.19,
    priceVerifiedAt: '2026-08-03',
    maxPriceAgeDays: 7,
    fitmentConfirmationRequired: true,
    supplier: TEGIWA_GB_SUPPLIER
  }),
  'tegiwa-2026-team-tegiwa-tsuki-t-shirt-s': tsukiTshirtPolicy('s', 'Small', 'T-TSUKITEAM-TSHIRT-S'),
  'tegiwa-2026-team-tegiwa-tsuki-t-shirt-m': tsukiTshirtPolicy('m', 'Medium', 'T-TSUKITEAM-TSHIRT-M'),
  'tegiwa-2026-team-tegiwa-tsuki-t-shirt-l': tsukiTshirtPolicy('l', 'Large', 'T-TSUKITEAM-TSHIRT-L'),
  'tegiwa-2026-team-tegiwa-tsuki-t-shirt-xl': tsukiTshirtPolicy('xl', 'X-Large', 'T-TSUKITEAM-TSHIRT-XL'),
  'tegiwa-2026-team-tegiwa-tsuki-t-shirt-xxl': tsukiTshirtPolicy('xxl', 'XX-Large', 'T-TSUKITEAM-TSHIRT-XXL')
});

export function directCartProduct(productId) {
  return DIRECT_CART_PRODUCTS[String(productId || '')] || null;
}

export function policyPriceIsFresh(policy, now = Date.now()) {
  if (!policy || !/^\d{4}-\d{2}-\d{2}$/.test(policy.priceVerifiedAt)) return false;
  const verifiedDayStarts = Date.parse(`${policy.priceVerifiedAt}T00:00:00.000Z`);
  const verifiedAt = Date.parse(`${policy.priceVerifiedAt}T23:59:59.999Z`);
  const maxAgeDays = Math.min(30, Math.max(1, Number(policy.maxPriceAgeDays) || 7));
  const priceIsFresh = Number.isFinite(verifiedAt) && Number.isFinite(verifiedDayStarts)
    && now >= verifiedDayStarts - 5 * 60_000
    && now - verifiedAt <= maxAgeDays * 86_400_000;
  if (!priceIsFresh || !policy.availabilityVerifiedAt) return priceIsFresh;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(policy.availabilityVerifiedAt)) return false;
  const availabilityDayStarts = Date.parse(`${policy.availabilityVerifiedAt}T00:00:00.000Z`);
  const availabilityVerifiedAt = Date.parse(`${policy.availabilityVerifiedAt}T23:59:59.999Z`);
  const maxAvailabilityAgeDays = Math.min(30, Math.max(1, Number(policy.maxAvailabilityAgeDays) || 7));
  return Number.isFinite(availabilityVerifiedAt)
    && Number.isFinite(availabilityDayStarts)
    && now >= availabilityDayStarts - 5 * 60_000
    && now - availabilityVerifiedAt <= maxAvailabilityAgeDays * 86_400_000;
}
