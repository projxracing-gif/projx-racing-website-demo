export const STAGING_COMMERCE_MODE = 'request-only';

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
    supplier: Object.freeze({
      slug: 'tegiwa',
      name: 'Tegiwa',
      originCountryCode: 'GB',
      originCountryName: 'Great Britain'
    })
  })
});

export function directCartProduct(productId) {
  return DIRECT_CART_PRODUCTS[String(productId || '')] || null;
}

export function policyPriceIsFresh(policy, now = Date.now()) {
  if (!policy || !/^\d{4}-\d{2}-\d{2}$/.test(policy.priceVerifiedAt)) return false;
  const verifiedAt = Date.parse(`${policy.priceVerifiedAt}T23:59:59.999Z`);
  const maxAgeDays = Math.min(30, Math.max(1, Number(policy.maxPriceAgeDays) || 7));
  return Number.isFinite(verifiedAt) && now - verifiedAt <= maxAgeDays * 86_400_000;
}
