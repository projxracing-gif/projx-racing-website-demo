import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEcsConfirmationCartResolver } from './ecs-confirmation-cart-sellability.js';

export const ECS_CONFIRMATION_CART_INDEX_PATH = fileURLToPath(
  new URL('./data/ecs-confirmation-cart-index.json', import.meta.url)
);

function loadCheckedInIndex() {
  const bytes = readFileSync(ECS_CONFIRMATION_CART_INDEX_PATH, 'utf8');
  return JSON.parse(bytes);
}

export const ECS_CONFIRMATION_CART_INDEX_DOCUMENT = Object.freeze(loadCheckedInIndex());
export const ECS_CONFIRMATION_CART_RESOLVER = createEcsConfirmationCartResolver(
  ECS_CONFIRMATION_CART_INDEX_DOCUMENT
);

export function lookupEcsConfirmationCartEligibility(handle, options) {
  return ECS_CONFIRMATION_CART_RESOLVER.lookup(handle, options);
}

export function lookupEcsConfirmationCartCommerce(handle, options) {
  const result = lookupEcsConfirmationCartEligibility(handle, options);
  return result.eligible ? result.commerce : null;
}

export function decorateEcsConfirmationCartProduct(product, options) {
  if (!product || typeof product !== 'object' || Array.isArray(product)) return product;
  const handle = product.handle || product.publicKey || product.productId || product.slug;
  const commerce = lookupEcsConfirmationCartCommerce(handle, options);
  return commerce ? { ...product, commerce } : product;
}

export function resolveEcsConfirmationCartSelection(selection, options) {
  return ECS_CONFIRMATION_CART_RESOLVER.resolve(selection, options);
}

export function getEcsConfirmationCartIndexStatus(options) {
  return ECS_CONFIRMATION_CART_RESOLVER.status(options);
}
