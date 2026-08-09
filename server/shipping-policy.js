import { directCartProduct, policyPriceIsFresh } from './commerce-policy.js';

const MAX_ITEMS = 20;

const EVIDENCE_AS_OF = '2026-08-10';

const SUPPLIER_SHIPPING_METHODS = Object.freeze({
  tegiwa: Object.freeze({
    quoteMethod: 'shopify_dynamic_checkout',
    rateSource: 'Calcurates',
    fulfilmentSystem: 'Despatch Cloud',
    calculationFactors: Object.freeze([
      'destination',
      'cart_contents',
      'verified_package_weight_and_dimensions',
      'eligible_carrier_service',
      'supplier_shipping_rules'
    ]),
    requiredInputs: Object.freeze([
      'destination_country',
      'destination_city',
      'destination_postcode',
      'cart_contents',
      'verified_package_weight_and_dimensions'
    ]),
    restrictions: Object.freeze([
      'live_rate_requires_supplier_checkout_or_authorised_rate_access',
      'dhl_express_observation_is_limited_to_one_bounded_kuwait_test',
      'despatch_cloud_is_a_fulfilment_and_data_processor_not_a_verified_rating_engine'
    ]),
    consolidationPolicy: 'supplier_checkout_confirmation_required',
    dutiesMode: 'not_proven_included_confirm_exact_quote',
    observedCarrierFamilies: Object.freeze(['DHL Express']),
    evidenceAsOf: EVIDENCE_AS_OF
  }),
  ecs: Object.freeze({
    quoteMethod: 'dynamic_destination_aware_supplier_cart',
    rateSource: 'undisclosed_supplier_backend',
    fulfilmentSystem: 'undisclosed',
    calculationFactors: Object.freeze([
      'destination',
      'cart_contents',
      'verified_package_weight_and_dimensions',
      'eligible_carrier_service',
      'fulfilment_location',
      'supplier_shipping_rules'
    ]),
    requiredInputs: Object.freeze([
      'destination_country',
      'destination_city',
      'destination_postcode',
      'cart_contents',
      'verified_package_weight_and_dimensions',
      'fulfilment_location'
    ]),
    restrictions: Object.freeze([
      'backend_rating_vendor_is_not_publicly_disclosed',
      'live_rate_requires_supplier_cart_and_complete_package_data',
      'direct_ship_freight_and_partial_shipments_may_price_separately',
      'carrier_availability_varies_by_destination_and_package'
    ]),
    consolidationPolicy: 'hold_until_all_items_are_in_stock_unless_partial_shipment_is_requested',
    dutiesMode: 'recipient_responsible_unless_supplier_explicitly_states_otherwise',
    observedCarrierFamilies: Object.freeze(['UPS', 'FedEx', 'USPS']),
    evidenceAsOf: EVIDENCE_AS_OF
  })
});

const DEFAULT_SHIPPING_METHOD = Object.freeze({
  quoteMethod: 'supplier_confirmation',
  rateSource: 'undisclosed',
  fulfilmentSystem: 'undisclosed',
  calculationFactors: Object.freeze([
    'destination',
    'cart_contents',
    'verified_package_weight_and_dimensions',
    'supplier_shipping_rules'
  ]),
  requiredInputs: Object.freeze([
    'destination_country',
    'destination_city',
    'destination_postcode',
    'cart_contents',
    'verified_package_weight_and_dimensions'
  ]),
  restrictions: Object.freeze(['live_rate_requires_authorised_supplier_or_carrier_access']),
  consolidationPolicy: 'supplier_confirmation_required',
  dutiesMode: 'supplier_confirmation_required',
  observedCarrierFamilies: Object.freeze([]),
  evidenceAsOf: EVIDENCE_AS_OF
});

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
    const supplierSlug = text(item?.supplier?.slug, 80).toLowerCase();
    const originId = text(item?.supplier?.originId, 100);
    const key = originId ? `origin:${supplierSlug}:${originId.toLowerCase()}` : `supplier:${supplierSlug}`;
    const current = grouped.get(key) || {
      supplier: supplierSlug,
      supplierName: item.supplier.name,
      originCountryCode: item.supplier.originCountryCode,
      originCountryName: item.supplier.originCountryName,
      originId: originId || null,
      groupBasis: originId ? 'origin_id' : 'supplier',
      itemCount: 0,
      quantity: 0,
      items: []
    };
    current.itemCount += 1;
    current.quantity += item.quantity;
    current.items.push({ productId: item.productId, sku: item.sku, quantity: item.quantity });
    grouped.set(key, current);
  }
  return [...grouped.values()].map(group => {
    const method = SUPPLIER_SHIPPING_METHODS[group.supplier] || DEFAULT_SHIPPING_METHOD;
    return Object.freeze({
      ...group,
      items: Object.freeze(group.items),
      status: 'confirmation_required',
      rate: null,
      carrier: null,
      service: null,
      transitDays: null,
      packageDataStatus: 'not_available',
      rateAccessStatus: 'not_connected',
      reason: 'verified_package_data_missing_and_live_rate_access_not_connected',
      blockingReasons: Object.freeze([
        'verified_package_data_required',
        'authorised_dynamic_rate_access_required'
      ]),
      quoteMethod: method.quoteMethod,
      rateSource: method.rateSource,
      fulfilmentSystem: method.fulfilmentSystem,
      calculationFactors: method.calculationFactors,
      requiredInputs: method.requiredInputs,
      restrictions: method.restrictions,
      consolidationPolicy: method.consolidationPolicy,
      dutiesMode: method.dutiesMode,
      observedCarrierFamilies: method.observedCarrierFamilies,
      evidenceAsOf: method.evidenceAsOf
    });
  });
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
