import '../assets/ecs-products.js';
import { ECS_G_SERIES_PERFORMANCE_PRODUCTS } from './data/ecs-g-series-performance-products.js';
import { ECS_G_SERIES_EXTERIOR_PRODUCTS } from './data/ecs-g-series-exterior-products.js';
import { ECS_G_SERIES_INTERIOR_PRODUCTS } from './data/ecs-g-series-interior-products.js';
import {
  ECS_G_SERIES_DRIVETRAIN_PRODUCTS,
  ECS_G_SERIES_DRIVETRAIN_QUARANTINED_ECS_IDENTITIES
} from './data/ecs-g-series-drivetrain-products.js';
import {
  ECS_G_SERIES_BRAKING_PRODUCTS,
  ECS_G_SERIES_BRAKING_QUARANTINED_ECS_IDENTITIES
} from './data/ecs-g-series-braking-products.js';
import {
  ECS_G_SERIES_ENGINE_PRODUCTS,
  ECS_G_SERIES_ENGINE_QUARANTINED_ECS_IDENTITIES
} from './data/ecs-g-series-engine-products.js';
import {
  BMW_M3_AGGREGATE_PRODUCTS,
  BMW_M3_AGGREGATE_QUARANTINED_ECS_IDENTITIES
} from './data/ecs-bmw-m3-aggregate-products.js';
import {
  buildCatalogSearchPlan,
  catalogSearchMeta,
  catalogSearchVocabulary
} from './catalog-search-intelligence.js';
import {
  catalogueParentPartTypeFacets,
  cataloguePartTypeMatches
} from './catalog-taxonomy.js';

const PAGE_SIZE = 100;
const SUGGESTION_LIMIT = 8;
const PRICE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

function meaningful(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function ecsIdentity(product) {
  const dedicated = [product?.ecsPartNumber, product?.identifiers?.ecs];
  for (const value of dedicated) {
    const source = String(value ?? '').trim();
    const match = source.match(/^(?:ES\s*#?\s*)?(\d{3,12})$/i);
    if (match) return match[1];
  }
  const sku = String(product?.sku ?? '').trim().match(/^ES\s*#?\s*(\d{3,12})$/i);
  return sku?.[1] || null;
}

function valueKey(value) {
  if (value && typeof value === 'object') return JSON.stringify(value);
  return `${typeof value}:${String(value)}`;
}

function unionValues(...groups) {
  const result = [];
  const seen = new Set();
  for (const value of groups.flatMap(group => Array.isArray(group) ? group : [])) {
    if (value === null || value === undefined || value === '') continue;
    const key = valueKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function mergeMeaningfulObjects(preferred, fallback) {
  const result = { ...(fallback && typeof fallback === 'object' ? fallback : {}) };
  for (const [key, value] of Object.entries(preferred && typeof preferred === 'object' ? preferred : {})) {
    if (meaningful(value) || !Object.hasOwn(result, key)) result[key] = value;
  }
  return result;
}

function normalizedKey(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function fitmentKey(fitment) {
  return [fitment?.make, fitment?.model, fitment?.generation, fitment?.yearFrom, fitment?.yearTo]
    .map(normalizedKey).join('|');
}

function mergeFitments(existing, additions) {
  const result = [];
  const positions = new Map();
  for (const fitment of [...(existing || []), ...(additions || [])]) {
    if (!fitment || typeof fitment !== 'object') continue;
    const key = fitmentKey(fitment);
    const position = positions.get(key);
    if (position === undefined) {
      positions.set(key, result.length);
      result.push({
        ...fitment,
        models: unionValues(fitment.models),
        chassis: unionValues(fitment.chassis),
        engines: unionValues(fitment.engines),
        drivetrains: unionValues(fitment.drivetrains)
      });
      continue;
    }
    const preferred = result[position];
    const merged = mergeMeaningfulObjects(preferred, fitment);
    merged.models = unionValues(preferred.models, fitment.models);
    merged.chassis = unionValues(preferred.chassis, fitment.chassis);
    merged.engines = unionValues(preferred.engines, fitment.engines);
    merged.drivetrains = unionValues(preferred.drivetrains, fitment.drivetrains);
    result[position] = merged;
  }
  return result;
}

function mergeFilters(existing, additions) {
  const result = {};
  const keys = new Set([
    ...Object.keys(existing && typeof existing === 'object' ? existing : {}),
    ...Object.keys(additions && typeof additions === 'object' ? additions : {})
  ]);
  for (const key of keys) {
    const left = existing?.[key];
    const right = additions?.[key];
    result[key] = Array.isArray(left) || Array.isArray(right)
      ? unionValues(left, right)
      : meaningful(left) ? left : right;
  }
  return result;
}

function observationTime(product, fields) {
  const times = fields.map(field => Date.parse(String(product?.[field] ?? ''))).filter(Number.isFinite);
  return times.length ? Math.max(...times) : Number.NEGATIVE_INFINITY;
}

function incomingIsCurrent(existing, addition, fields) {
  const existingTime = observationTime(existing, fields);
  const incomingTime = observationTime(addition, fields);
  return incomingTime > Number.NEGATIVE_INFINITY && incomingTime >= existingTime;
}

function mergeSelectionSources(existing, additions) {
  const result = [];
  const positions = new Map();
  for (const source of [...(existing || []), ...(additions || [])]) {
    if (!source || typeof source !== 'object') continue;
    const key = normalizedKey(source.sourceUrl)
      || [source.vehicle, source.category, source.relevancePosition].map(normalizedKey).join('|');
    const position = positions.get(key);
    if (position === undefined) {
      positions.set(key, result.length);
      result.push({ ...source });
      continue;
    }
    const current = result[position];
    const currentTime = Date.parse(String(current.observedAt ?? ''));
    const incomingTime = Date.parse(String(source.observedAt ?? ''));
    const newer = Number.isFinite(incomingTime) && (!Number.isFinite(currentTime) || incomingTime >= currentTime);
    const ranks = [current.relevancePosition, source.relevancePosition]
      .map(Number).filter(Number.isFinite);
    result[position] = {
      ...current,
      ...(newer ? source : {}),
      ...(ranks.length ? { relevancePosition: Math.min(...ranks) } : {})
    };
  }
  return result;
}

const PRICE_REFRESH_FIELDS = Object.freeze([
  'quoteOnly', 'purchaseMode', 'priceAmount', 'originalPriceAmount', 'priceStartingAt',
  'priceCurrency', 'priceType', 'priceIncludesShipping', 'priceVerifiedAt', 'priceNote', 'priceNoteAr'
]);
const AVAILABILITY_REFRESH_FIELDS = Object.freeze([
  'status', 'statusAr', 'checkedAt', 'stockObservedAt', 'staleAfterDays', 'stockPolicy',
  'availabilityCode', 'observedAvailability', 'observedAvailabilityAr', 'availabilityNote',
  'availabilityNoteAr', 'stockNote', 'stockNoteAr'
]);

function copyRefreshFields(target, source, fields) {
  for (const field of fields) {
    if (Object.hasOwn(source, field)) target[field] = source[field];
  }
}

function normalizedIdentifier(value) {
  return normalizedKey(value).replace(/\s+/g, '');
}

function canonicalProductUrl(value) {
  try {
    const url = new URL(String(value ?? '').trim());
    url.hash = '';
    url.search = '';
    return `${url.origin.toLocaleLowerCase('en-US')}${url.pathname.replace(/\/+$/, '/')}`;
  } catch {
    return normalizedKey(value);
  }
}

function assertCompatibleSupplierIdentity(existing, addition) {
  const identifiers = [
    ['manufacturer part number', existing?.mpn || existing?.identifiers?.mpn,
      addition?.mpn || addition?.identifiers?.mpn, normalizedIdentifier],
    ['canonical product URL', existing?.originalUrl, addition?.originalUrl, canonicalProductUrl]
  ];
  for (const [label, leftValue, rightValue, normalize] of identifiers) {
    if (!meaningful(leftValue) || !meaningful(rightValue)) continue;
    if (normalize(leftValue) !== normalize(rightValue)) {
      throw new Error(`Conflicting ECS ${label} for ES#${ecsIdentity(existing)}.`);
    }
  }
}

function sameObservationDay(left, right) {
  const leftDate = String(left ?? '').slice(0, 10);
  const rightDate = String(right ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(leftDate) && leftDate === rightDate;
}

function hasConflictingCurrentPrice(existing, addition) {
  const leftAmount = finitePriceAmount(existing);
  const rightAmount = finitePriceAmount(addition);
  return leftAmount !== null && rightAmount !== null && leftAmount !== rightAmount
    && sameObservationDay(existing?.priceVerifiedAt || existing?.checkedAt,
      addition?.priceVerifiedAt || addition?.checkedAt);
}

function enforcePriceConflict(target) {
  target.quoteOnly = true;
  target.purchaseMode = 'request-price';
  target.priceAmount = null;
  target.originalPriceAmount = null;
  target.priceStartingAt = false;
  target.priceConflict = true;
  target.priceType = 'confirmation-required';
  target.priceNote = 'Conflicting public ECS prices were observed on the same date; confirm the applicable option and current price before order.';
  target.priceNoteAr = '\u0638\u0647\u0631\u062a \u0623\u0633\u0639\u0627\u0631 \u0639\u0627\u0645\u0629 \u0645\u062e\u062a\u0644\u0641\u0629 \u0645\u0646 ECS \u0641\u064a \u0627\u0644\u062a\u0627\u0631\u064a\u062e \u0646\u0641\u0633\u0647\u061b \u064a\u062c\u0628 \u062a\u0623\u0643\u064a\u062f \u0627\u0644\u062e\u064a\u0627\u0631 \u0648\u0627\u0644\u0633\u0639\u0631 \u0627\u0644\u062d\u0627\u0644\u064a \u0642\u0628\u0644 \u0627\u0644\u0637\u0644\u0628.';
  return target;
}

function mergeReviewedPair(existing, addition) {
  assertCompatibleSupplierIdentity(existing, addition);
  const merged = mergeMeaningfulObjects(existing, addition);
  // A price conflict is a fail-closed state. Once any reviewed scope has found
  // incompatible current prices, a later scope must not restore one of those
  // amounts simply because its observation is newer.
  const priceConflict = Boolean(
    existing.priceConflict || addition.priceConflict || hasConflictingCurrentPrice(existing, addition)
  );
  if (incomingIsCurrent(existing, addition, ['priceVerifiedAt', 'checkedAt'])) {
    copyRefreshFields(merged, addition, PRICE_REFRESH_FIELDS);
  }
  if (incomingIsCurrent(existing, addition, ['stockObservedAt', 'checkedAt'])) {
    copyRefreshFields(merged, addition, AVAILABILITY_REFRESH_FIELDS);
  }

  merged.publicKey = existing.publicKey || addition.publicKey;
  merged.slug = existing.slug || addition.slug;
  merged.identifiers = mergeMeaningfulObjects(existing.identifiers, addition.identifiers);
  merged.fitments = mergeFitments(existing.fitments, addition.fitments);
  merged.filters = mergeFilters(existing.filters, addition.filters);
  const replaceUnavailableMedia = existing.imageStatus === 'supplier-media-unavailable'
    && addition.imageStatus === 'supplier-media-verified' && meaningful(addition.images);
  merged.images = replaceUnavailableMedia || !meaningful(existing.images)
    ? unionValues(addition.images)
    : [...existing.images];
  if (replaceUnavailableMedia) {
    merged.imageStatus = addition.imageStatus;
    if (meaningful(addition.imageSourceUrl)) merged.imageSourceUrl = addition.imageSourceUrl;
  }
  merged.specifications = unionValues(existing.specifications, addition.specifications);
  merged.options = unionValues(existing.options, addition.options);
  merged.variants = unionValues(existing.variants, addition.variants);
  merged.relatedProductSlugs = unionValues(existing.relatedProductSlugs, addition.relatedProductSlugs);
  merged.selectionSources = mergeSelectionSources(existing.selectionSources, addition.selectionSources);
  merged.dataOrigins = unionValues(existing.dataOrigins, [existing.dataOrigin], addition.dataOrigins, [addition.dataOrigin]);
  merged.detailedDescriptionAvailable = Boolean(
    existing.detailedDescriptionAvailable || addition.detailedDescriptionAvailable
  );

  if (meaningful(addition.fitmentStatus)) merged.fitmentStatus = addition.fitmentStatus;
  if (meaningful(addition.fitmentConfidence)) merged.fitmentConfidence = addition.fitmentConfidence;
  const ranks = [existing.selectionRank, addition.selectionRank].map(Number).filter(Number.isFinite);
  if (ranks.length) merged.selectionRank = Math.min(...ranks);

  const shipping = mergeMeaningfulObjects(existing.shipping, addition.shipping);
  if (meaningful(addition.shipping?.origin)) shipping.origin = addition.shipping.origin;
  if (meaningful(addition.shipping?.observedSupplierMessage)) {
    shipping.observedSupplierMessage = addition.shipping.observedSupplierMessage;
  }
  if ([existing.shipping?.status, addition.shipping?.status].includes('quote-required')) {
    shipping.status = 'quote-required';
  }
  if (Object.keys(shipping).length) merged.shipping = shipping;
  if (priceConflict) {
    enforcePriceConflict(merged);
  }
  return merged;
}

function assertUniquePublicIdentities(products) {
  for (const field of ['publicKey', 'slug']) {
    const seen = new Set();
    for (const product of products) {
      const value = String(product?.[field] ?? '').trim();
      if (!value) continue;
      if (seen.has(value)) {
        throw new Error(`Conflicting ECS ${field} "${value}" is assigned to multiple products.`);
      }
      seen.add(value);
    }
  }
}

export function mergeReviewedEcsProducts(existingProducts, generatedProducts) {
  if (!Array.isArray(existingProducts) || !Array.isArray(generatedProducts)) {
    throw new TypeError('Reviewed ECS catalogue sources must be arrays.');
  }
  const products = [];
  const positions = new Map();
  const sources = [...existingProducts, ...generatedProducts];
  for (const product of sources) {
    if (!product || typeof product !== 'object') continue;
    const key = ecsIdentity(product);
    if (!key) {
      products.push(product);
      continue;
    }
    const position = positions.get(key);
    if (position === undefined) {
      positions.set(key, products.length);
      products.push(product);
    } else {
      products[position] = mergeReviewedPair(products[position], product);
    }
  }

  const slugAliases = new Map();
  for (const product of sources) {
    const key = ecsIdentity(product);
    const position = key ? positions.get(key) : undefined;
    const finalProduct = position === undefined ? product : products[position];
    if (product?.slug && finalProduct?.slug) slugAliases.set(product.slug, finalProduct.slug);
  }
  const remapped = products.map(product => {
    const remappedProduct = {
      ...product,
      relatedProductSlugs: unionValues(product.relatedProductSlugs)
        .map(slug => slugAliases.get(slug) || slug)
        .filter((slug, index, values) => slug && slug !== product.slug && values.indexOf(slug) === index)
    };
    return remappedProduct.priceConflict ? enforcePriceConflict(remappedProduct) : remappedProduct;
  });
  assertUniquePublicIdentities(remapped);
  return remapped;
}

const manuallyReviewedEcsProducts = globalThis.PROJX_ECS_PRODUCTS || [];
const boundedGSeriesProducts = [
  ...ECS_G_SERIES_PERFORMANCE_PRODUCTS, ...ECS_G_SERIES_EXTERIOR_PRODUCTS,
  ...ECS_G_SERIES_INTERIOR_PRODUCTS, ...ECS_G_SERIES_DRIVETRAIN_PRODUCTS,
  ...ECS_G_SERIES_BRAKING_PRODUCTS, ...ECS_G_SERIES_ENGINE_PRODUCTS
];
const bmwM3AggregateQuarantinedIdentities = new Set(
  BMW_M3_AGGREGATE_QUARANTINED_ECS_IDENTITIES.map(String)
);
const bmwM3AggregateMergeCandidates = BMW_M3_AGGREGATE_PRODUCTS
  .filter(product => !bmwM3AggregateQuarantinedIdentities.has(ecsIdentity(product)));
const mergedWithoutBmwM3Aggregate = mergeReviewedEcsProducts(
  manuallyReviewedEcsProducts,
  boundedGSeriesProducts
);
const mergedReviewedEcsProducts = mergeReviewedEcsProducts(
  manuallyReviewedEcsProducts,
  [...boundedGSeriesProducts, ...bmwM3AggregateMergeCandidates]
);
const quarantinedEcsIdentities = new Set([
  ...ECS_G_SERIES_DRIVETRAIN_QUARANTINED_ECS_IDENTITIES,
  ...ECS_G_SERIES_BRAKING_QUARANTINED_ECS_IDENTITIES,
  ...ECS_G_SERIES_ENGINE_QUARANTINED_ECS_IDENTITIES,
  ...BMW_M3_AGGREGATE_QUARANTINED_ECS_IDENTITIES
]);
const quarantinedProductSlugs = new Set(mergedReviewedEcsProducts
  .filter(product => quarantinedEcsIdentities.has(ecsIdentity(product)))
  .flatMap(product => [product?.slug, product?.publicKey]).filter(Boolean));
export const REVIEWED_ECS_PRODUCTS = Object.freeze(mergedReviewedEcsProducts
  .filter(product => !quarantinedEcsIdentities.has(ecsIdentity(product)))
  .map(product => ({
    ...product,
    relatedProductSlugs: (product.relatedProductSlugs || [])
      .filter(slug => !quarantinedProductSlugs.has(slug))
  })));
const reviewedEcsSourceRecordCounts = Object.freeze({
  manuallyReviewed: manuallyReviewedEcsProducts.length,
  gSeriesPerformance: ECS_G_SERIES_PERFORMANCE_PRODUCTS.length,
  gSeriesExterior: ECS_G_SERIES_EXTERIOR_PRODUCTS.length,
  gSeriesInterior: ECS_G_SERIES_INTERIOR_PRODUCTS.length,
  gSeriesDrivetrain: ECS_G_SERIES_DRIVETRAIN_PRODUCTS.length,
  gSeriesBraking: ECS_G_SERIES_BRAKING_PRODUCTS.length,
  gSeriesEngine: ECS_G_SERIES_ENGINE_PRODUCTS.length,
  bmwM3Aggregate: BMW_M3_AGGREGATE_PRODUCTS.length
});
const bmwM3RequestedSections = Object.freeze([
  'Braking', 'Engine', 'Exterior', 'Interior', 'Performance', 'Suspension', 'Steering'
]);
const bmwM3AggregateIncludedSections = Object.freeze([...new Set(BMW_M3_AGGREGATE_PRODUCTS
  .flatMap(product => (product.selectionSources || []).map(source => source?.section))
  .filter(section => bmwM3RequestedSections.includes(section)))].sort());
const bmwM3AggregateCaptureStatus = Object.freeze({
  stage: bmwM3AggregateIncludedSections.length === bmwM3RequestedSections.length
    ? 'complete'
    : 'staging-progress',
  complete: bmwM3AggregateIncludedSections.length === bmwM3RequestedSections.length,
  importPolicy: 'reconciled-sections-only',
  requestedSectionCount: bmwM3RequestedSections.length,
  includedSectionCount: bmwM3AggregateIncludedSections.length,
  includedSections: bmwM3AggregateIncludedSections,
  excludedSections: bmwM3RequestedSections
    .filter(section => !bmwM3AggregateIncludedSections.includes(section))
});
export const REVIEWED_ECS_CATALOGUE_STATUS = Object.freeze({
  schemaVersion: 1,
  sourceRecordCounts: reviewedEcsSourceRecordCounts,
  sourceRecordCount: Object.values(reviewedEcsSourceRecordCounts).reduce((total, count) => total + count, 0),
  preQuarantineUniqueProductCount: mergedReviewedEcsProducts.length,
  quarantinedIdentityCount: quarantinedEcsIdentities.size,
  publishedProductCount: REVIEWED_ECS_PRODUCTS.length,
  bmwM3AggregateNewUniqueProductCount: Math.max(
    0,
    mergedReviewedEcsProducts.length - mergedWithoutBmwM3Aggregate.length
  ),
  bmwM3AggregateCaptureStatus
});

function reviewedEcsCatalogueStatus(products) {
  if (products === REVIEWED_ECS_PRODUCTS) return REVIEWED_ECS_CATALOGUE_STATUS;
  return {
    schemaVersion: 1,
    sourceRecordCounts: null,
    sourceRecordCount: products.length,
    preQuarantineUniqueProductCount: products.length,
    quarantinedIdentityCount: null,
    publishedProductCount: products.length,
    bmwM3AggregateNewUniqueProductCount: null,
    bmwM3AggregateCaptureStatus: null
  };
}

export class ReviewedFallbackError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ReviewedFallbackError';
    this.status = status;
    this.code = code;
  }
}

function text(value, maximum = 500) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function identity(value) {
  return text(value, 2_000).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function identifierIdentity(value) {
  return identity(value).replace(/\s+/g, '');
}

function exactIdentifierMatch(product, query) {
  if (!query) return false;
  const queryIdentifier = identifierIdentity(query);
  return Boolean(queryIdentifier) && [product.ecsPartNumber, product.sku, product.mpn]
    .some(value => identifierIdentity(value) === queryIdentifier);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function facetSlug(value) {
  return identity(value).replace(/\s+/g, '-').slice(0, 100);
}

function normalizedFacetList(values) {
  const facets = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const slug = text(value?.slug, 100);
    const name = text(value?.name, 160);
    const nameAr = text(value?.nameAr, 160);
    if (slug && name && /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(slug)) {
      facets.set(slug, { slug, name, ...(nameAr ? { nameAr } : {}) });
    }
  }
  return facets;
}

function localCatalogueFacets(products) {
  const brands = new Map();
  const partTypes = new Map();
  const add = (target, slug, name, nameAr = '') => {
    const safeSlug = text(slug, 100);
    const safeName = text(name, 160);
    const safeNameAr = text(nameAr, 160);
    if (safeSlug && safeName && /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(safeSlug)) {
      const current = target.get(safeSlug);
      target.set(safeSlug, {
        slug: safeSlug,
        name: current?.name || safeName,
        ...((current?.nameAr || safeNameAr) ? { nameAr: current?.nameAr || safeNameAr } : {})
      });
    }
  };
  for (const product of products) {
    add(brands, product.brandSlug || facetSlug(product.brand), product.brand);
    add(partTypes, product.categorySlug || facetSlug(product.category), product.category, product.categoryAr);
    add(partTypes, product.subcategorySlug || facetSlug(product.subcategory), product.subcategory, product.subcategoryAr);
    for (const source of product.selectionSources || []) add(partTypes, facetSlug(source?.category), source?.category);
    for (const slug of product.filters?.categories || []) {
      if (!partTypes.has(slug)) add(partTypes, slug, slug === 'exterior' ? 'Exterior' : slug.replace(/-/g, ' '),
        slug === 'exterior' ? 'الهيكل الخارجي' : '');
    }
    for (const slug of product.filters?.subcategories || []) {
      if (!partTypes.has(slug)) add(partTypes, slug, slug.replace(/-/g, ' '));
    }
  }
  const exteriorArabicNames = new Map([
    ['exterior', 'الهيكل الخارجي'],
    ['exterior-body-parts', 'أجزاء الهيكل الخارجي'],
    ['exterior-vinyl-wrap', 'تغليف الفينيل الخارجي'],
    ['exterior-tools', 'أدوات الهيكل الخارجي'],
    ['exterior-wiper-parts', 'أجزاء مساحات الزجاج'],
    ['emblems-badges', 'الشعارات والشارات'],
    ['exterior-roof-rack-parts', 'أجزاء حوامل السقف'],
    ['exterior-mirror-parts', 'أجزاء المرايا الخارجية'],
    ['exterior-electrical-parts', 'الأجزاء الكهربائية الخارجية'],
    ['skid-plate-parts', 'ألواح حماية أسفل السيارة'],
    ['antenna-parts-accessories', 'أجزاء الهوائي وملحقاته'],
    ['exterior-window-parts', 'أجزاء النوافذ الخارجية'],
    ['exterior-alarm-systems-parts', 'أنظمة الإنذار الخارجية وأجزاؤها'],
    ['exterior-csl-parts', 'أجزاء CSL الخارجية'],
    ['exterior-electronic-accessories', 'ملحقات إلكترونية خارجية']
  ]);
  for (const [slug, nameAr] of exteriorArabicNames) {
    const current = partTypes.get(slug);
    if (current) partTypes.set(slug, { ...current, nameAr });
  }
  const interiorArabicNames = new Map([
    ['interior', 'المقصورة'],
    ['gauges', 'عدادات المقصورة'],
    ['seats', 'المقاعد'],
    ['steering', 'عجلة القيادة'],
    ['vinyl-wrap', 'تغليف الفينيل'],
    ['center-console', 'الكونسول الوسطي'],
    ['safety', 'السلامة'],
    ['trim', 'التطعيمات الداخلية'],
    ['floor-mats', 'دواسات الأرضية'],
    ['dashboard', 'لوحة العدادات'],
    ['pedal', 'الدواسات'],
    ['cellular-phone', 'الهاتف المحمول'],
    ['trunk', 'صندوق الأمتعة'],
    ['key-fob', 'ريموت المفتاح'],
    ['shifter', 'ناقل الحركة'],
    ['tools', 'الأدوات'],
    ['window', 'النوافذ'],
    ['sound-system', 'النظام الصوتي'],
    ['sun-shade', 'حاجب الشمس'],
    ['electronic', 'الإلكترونيات'],
    ['door', 'الأبواب'],
    ['hood-release', 'ذراع فتح غطاء المحرك'],
    ['lighting', 'الإضاءة'],
    ['storage', 'التخزين'],
    ['convertible', 'السقف القابل للطي'],
    ['headliner', 'بطانة السقف'],
    ['mirror', 'المرايا'],
    ['sunroof', 'فتحة السقف'],
    ['airbag', 'الوسائد الهوائية'],
    ['carpet', 'السجاد'],
    ['navigation', 'الملاحة'],
    ['armrest', 'مسند الذراع'],
    ['hatch', 'الباب الخلفي']
  ]);
  for (const [slug, nameAr] of interiorArabicNames) {
    const current = partTypes.get(slug);
    if (current) partTypes.set(slug, { ...current, nameAr });
  }
  const drivetrainFacetNames = new Map([
    ['g-series-drivetrain', ['G-Series Drivetrain', 'نظام نقل الحركة لسلسلة G']],
    ['drivetrain-tools', ['Drivetrain Tools', 'أدوات نظام نقل الحركة']],
    ['drivetrain-differential', ['Differential Parts', 'أجزاء الدفرنس']],
    ['drivetrain-manual-transmission', ['Manual Transmission Parts', 'أجزاء ناقل الحركة اليدوي']],
    ['drivetrain-shifter', ['Shifter Parts', 'أجزاء عصا ناقل الحركة']],
    ['drivetrain-automatic-transmission', ['Automatic Transmission Parts', 'أجزاء ناقل الحركة الأوتوماتيكي']],
    ['drivetrain-axles', ['Axle Parts', 'أجزاء المحاور']],
    ['drivetrain-clutch', ['Clutch Parts', 'أجزاء القابض']],
    ['drivetrain-mounts', ['Drivetrain Mounts', 'قواعد نظام نقل الحركة']],
    ['drivetrain-driveshafts', ['Driveshaft Parts', 'أجزاء أعمدة نقل الحركة']],
    ['drivetrain-wheel-bearings', ['Wheel Bearing Parts', 'أجزاء رمانات العجل']],
    ['drivetrain-skid-plate', ['Skid Plates', 'ألواح الحماية السفلية']],
    ['drivetrain-transfer-case', ['Transfer Case Parts', 'أجزاء علبة التحويل']]
  ]);
  for (const [slug, [name, nameAr]] of drivetrainFacetNames) {
    const current = partTypes.get(slug);
    if (current) partTypes.set(slug, { ...current, name, nameAr });
  }
  const brakingFacetNames = new Map([
    ['g-series-braking', ['G-Series Braking', 'فرامل سلسلة G']],
    ['braking-tools', ['Brake Tools', 'أدوات الفرامل']],
    ['braking-pads', ['Brake Pads', 'فحمات الفرامل']],
    ['braking-performance', ['Performance Brake Parts', 'قطع فرامل الأداء']],
    ['braking-fluid', ['Brake Fluids', 'سوائل الفرامل']],
    ['braking-rotors', ['Brake Rotors', 'أقراص الفرامل']],
    ['braking-calipers', ['Brake Calipers', 'كليبرات الفرامل']],
    ['braking-compounds', ['Brake Compounds & Lubricants', 'مركبات وشحوم الفرامل']],
    ['braking-lines', ['Brake Lines', 'خطوط الفرامل']],
    ['braking-big-brakes', ['Big Brake Upgrades', 'ترقيات الفرامل الكبيرة']],
    ['braking-service-kits', ['Brake Service Kits', 'أطقم صيانة الفرامل']],
    ['braking-electrical', ['Electrical Brake Parts & Components', 'قطع ومكونات الفرامل الكهربائية']],
    ['braking-sensors', ['Brake Sensors', 'حساسات الفرامل']],
    ['braking-abs', ['ABS Brake Parts', 'قطع نظام ABS']],
    ['braking-master-cylinder', ['Brake Master Cylinder Parts', 'قطع ماستر الفرامل']],
    ['braking-parking-brake', ['Emergency Parking Brake Parts', 'قطع فرامل التوقف الطارئة']]
  ]);
  for (const [slug, [name, nameAr]] of brakingFacetNames) {
    const current = partTypes.get(slug);
    if (current) partTypes.set(slug, { ...current, name, nameAr });
  }
  const engineFacetNames = new Map([
    ['g-series-engine', ['G-Series Engine', 'محرك سلسلة G']],
    ['engine-performance', ['Performance Engine Parts', 'قطع أداء المحرك']],
    ['engine-intake', ['Engine Intake Parts', 'قطع سحب هواء المحرك']],
    ['engine-fuel', ['Engine Fuel Parts', 'قطع وقود المحرك']],
    ['engine-tools', ['Engine Tools', 'أدوات المحرك']],
    ['engine-electrical', ['Engine Electrical Parts', 'قطع كهرباء المحرك']],
    ['engine-mechanical', ['Engine Mechanical Parts', 'القطع الميكانيكية للمحرك']],
    ['engine-cooling', ['Engine Cooling Parts', 'قطع تبريد المحرك']],
    ['engine-oil-service', ['Oil Change Service Kits and Accessories', 'أطقم وملحقات تغيير الزيت']],
    ['engine-covers', ['Engine Covers & Accessories', 'أغطية المحرك وملحقاته']],
    ['engine-ignition', ['Engine Ignition Parts', 'قطع إشعال المحرك']],
    ['engine-turbocharger', ['Engine Turbocharger Parts', 'قطع الشاحن التوربيني']],
    ['engine-gaskets-seals', ['Engine Gaskets & Seals', 'حشيات وأختام المحرك']],
    ['engine-filter', ['Engine Filter Parts', 'فلاتر المحرك']],
    ['engine-software', ['Engine Chips, Tunes & Software', 'شرائح وبرمجة وضبط المحرك']],
    ['engine-drive-belts', ['Engine Drive Belt Parts', 'قطع سيور المحرك']],
    ['engine-emissions', ['Engine Emission Parts', 'قطع انبعاثات المحرك']],
    ['engine-pulleys', ['Engine Pulley Parts', 'بكرات المحرك']],
    ['engine-timing', ['Engine Timing Parts', 'قطع توقيت المحرك']],
    ['engine-mount', ['Engine Mount Parts', 'قواعد المحرك']],
    ['engine-vacuum-system', ['Engine Vacuum System Parts', 'قطع نظام تفريغ المحرك']],
    ['engine-skid-plate', ['Engine Skid Plate Parts', 'ألواح حماية أسفل المحرك']],
    ['engine-fastener-kit', ['Engine Fastener Kit Parts', 'أطقم مثبتات المحرك']],
    ['engine-supercharger', ['Engine Supercharger Parts', 'قطع الشاحن الفائق']]
  ]);
  for (const [slug, [name, nameAr]] of engineFacetNames) {
    const current = partTypes.get(slug);
    if (current) partTypes.set(slug, { ...current, name, nameAr });
  }
  for (const facet of catalogueParentPartTypeFacets([...partTypes.keys()])) {
    partTypes.set(facet.slug, { ...(partTypes.get(facet.slug) || {}), ...facet });
  }
  const byName = (left, right) => left.name.localeCompare(right.name) || left.slug.localeCompare(right.slug);
  return {
    brands: [...brands.values()].sort(byName),
    partTypes: [...partTypes.values()].sort(byName)
  };
}

function rootAsset(value) {
  const source = text(value, 1_000);
  if (!source) return null;
  if (/^https:\/\//i.test(source)) {
    try {
      const url = new URL(source);
      const hostname = url.hostname.toLowerCase();
      if (url.protocol !== 'https:' || url.username || url.password || url.port
        || (hostname !== 'assets.ecstuning.com'
          && !/\.public\.blob\.vercel-storage\.com$/i.test(hostname))) return null;
      return source;
    } catch {
      return null;
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(source) || source.includes('\\')) return null;
  const local = source.replace(/^\/+/, '');
  return local ? `/${local}` : null;
}

function dateValue(value) {
  const source = text(value, 40);
  if (!source) return NaN;
  return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(source) ? `${source}T23:59:59.999Z` : source);
}

function priceIsFresh(product, nowValue) {
  const checkedAt = dateValue(product.priceVerifiedAt);
  const staleAfter = Number(product.staleAfterDays) * 24 * 60 * 60 * 1_000;
  const maximumAge = Number.isFinite(staleAfter) && staleAfter > 0 ? staleAfter : PRICE_MAX_AGE_MS;
  return Number.isFinite(checkedAt) && Number(nowValue) - checkedAt <= maximumAge;
}

function finitePriceAmount(product) {
  const value = product?.priceAmount;
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

export function reviewedEcsProductSearchDocument(product) {
  if (typeof product?.searchDocument === 'string' && product.searchDocument.trim()) {
    return product.searchDocument;
  }
  return [
    product.title, product.titleAr, product.brand, product.category, product.categoryAr,
    product.subcategory, product.subcategoryAr, product.ecsPartNumber, product.sku, product.mpn,
    product.description, product.descriptionAr, product.summary, product.summaryAr,
    ...(product.selectionSources || []).map(source => source?.category),
    ...(product.specifications || []).flatMap(specification => [
      specification?.name, specification?.label, specification?.value
    ]),
    ...(product.fitments || []).flatMap(fitment => [
      fitment.make, fitment.model, fitment.generation,
      ...(fitment.models || []), ...(fitment.chassis || []), ...(fitment.engines || [])
    ])
  ].filter(Boolean).join(' ');
}

function productSearchText(product) {
  return identity(reviewedEcsProductSearchDocument(product));
}

const vocabularyCache = new WeakMap();
function productSearchVocabulary(products) {
  if (!vocabularyCache.has(products)) {
    vocabularyCache.set(products, catalogSearchVocabulary(products.map(reviewedEcsProductSearchDocument)));
  }
  return vocabularyCache.get(products);
}

function searchPlanFor(products, query) {
  return query ? buildCatalogSearchPlan(query, { vocabulary: productSearchVocabulary(products) }) : null;
}

function textMatchesSearchPlan(value, plan) {
  const haystack = identity(value);
  return Boolean(haystack) && plan.tokenGroups.every(group => group.some(token => haystack.includes(token)));
}

function equalsOrContains(candidate, requested) {
  const left = identity(candidate);
  const right = identity(requested);
  if (!left || !right) return false;
  const leftTokens = new Set(left.split(' '));
  return left === right || right.split(' ').every(token => leftTokens.has(token));
}

function fitmentMatchesRequest(fitment, request) {
  if (request.make && !equalsOrContains(fitment.make, request.make)) return false;
  if (request.model && ![fitment.model, ...(fitment.models || [])].some(value => equalsOrContains(value, request.model))) return false;
  if (request.generation && ![
    fitment.generation, ...(fitment.chassis || [])
  ].some(value => equalsOrContains(value, request.generation))) return false;
  if (request.engine && !(fitment.engines || []).some(value => equalsOrContains(value, request.engine))) return false;
  if (request.year) {
    const hasRange = Number.isInteger(fitment.yearFrom) || Number.isInteger(fitment.yearTo);
    const hasOtherVehicleField = Boolean(request.make || request.model || request.generation || request.engine);
    if (!hasRange && !hasOtherVehicleField) return false;
    if (fitment.yearFrom && request.year < fitment.yearFrom) return false;
    if (fitment.yearTo && request.year > fitment.yearTo) return false;
  }
  return true;
}

function productVehicleMatches(product, request) {
  if (!request.structuredVehicle) return true;
  return (product.fitments || []).some(fitment => fitmentMatchesRequest(fitment, request));
}

function availabilityMatches(requested) {
  return requested === 'all' || requested === 'check';
}

function productMatches(product, request, nowValue, searchPlan = null) {
  if (request.supplier && request.supplier !== 'ecs') return false;
  if (request.currency && request.currency !== 'USD') return false;
  if (request.brand && request.brand !== product.brandSlug) return false;
  if (request.partType && !cataloguePartTypeMatches([
    product.categorySlug, product.subcategorySlug,
    ...(product.filters?.categories || []), ...(product.filters?.subcategories || [])
  ], request.partType)) return false;
  if (!availabilityMatches(request.availability || 'all')) return false;
  const priced = priceIsFresh(product, nowValue) && finitePriceAmount(product) !== null;
  if (request.pricing === 'priced' && !priced) return false;
  if (request.pricing === 'request_price' && priced) return false;
  if (request.fitment === 'exact') return false;
  if (!productVehicleMatches(product, request)) return false;
  if (!request.query) return true;
  const exact = [product.ecsPartNumber, product.sku, product.mpn]
    .some(value => identifierIdentity(value) === identifierIdentity(request.query));
  if (exact) return true;
  const plan = searchPlan || buildCatalogSearchPlan(request.query, {
    vocabulary: catalogSearchVocabulary([reviewedEcsProductSearchDocument(product)])
  });
  return plan.tokenGroups.length > 0 && textMatchesSearchPlan(productSearchText(product), plan);
}

function relevanceScore(product, query, searchPlan = null) {
  if (!query) return 0;
  const queryIdentifier = identifierIdentity(query);
  if ([product.ecsPartNumber, product.sku, product.mpn]
    .some(value => identifierIdentity(value) === queryIdentifier)) return 100_000;
  const plan = searchPlan || buildCatalogSearchPlan(query);
  const phrase = identity(plan.canonicalQuery || query);
  const title = identity(product.title);
  const brand = identity(product.brand);
  const category = identity([product.category, product.subcategory].filter(Boolean).join(' '));
  const haystack = productSearchText(product);
  const identifiers = [product.ecsPartNumber, product.sku, product.mpn].map(identifierIdentity).filter(Boolean);
  let score = 0;
  if (queryIdentifier && identifiers.some(value => value.startsWith(queryIdentifier))) score += 20_000;
  if (title === phrase) score += 12_000;
  else if (phrase && title.startsWith(phrase)) score += 8_000;
  else if (phrase && title.includes(phrase)) score += 5_000;
  if (brand === phrase) score += 3_500;
  if (category === phrase || (phrase && category.startsWith(phrase))) score += 2_500;
  const titleGroups = plan.tokenGroups.filter(group => group.some(token => title.includes(token))).length;
  const brandGroups = plan.tokenGroups.filter(group => group.some(token => brand.includes(token))).length;
  const categoryGroups = plan.tokenGroups.filter(group => group.some(token => category.includes(token))).length;
  const allGroups = plan.tokenGroups.filter(group => group.some(token => haystack.includes(token))).length;
  if (plan.tokenGroups.length && titleGroups === plan.tokenGroups.length) score += 2_000;
  score += titleGroups * 300 + brandGroups * 240 + categoryGroups * 180 + allGroups * 80;
  return score;
}

function sortProducts(products, request, nowValue, searchPlan = null) {
  return [...products].sort((left, right) => {
    if (request.sort === 'name_asc') return left.title.localeCompare(right.title);
    if (request.sort === 'name_desc') return right.title.localeCompare(left.title);
    if (request.sort === 'price_asc' || request.sort === 'price_desc') {
      const leftPrice = priceIsFresh(left, nowValue) ? finitePriceAmount(left) : null;
      const rightPrice = priceIsFresh(right, nowValue) ? finitePriceAmount(right) : null;
      if (leftPrice === null && rightPrice !== null) return 1;
      if (rightPrice === null && leftPrice !== null) return -1;
      if (leftPrice !== null && rightPrice !== null && leftPrice !== rightPrice) {
        return request.sort === 'price_asc' ? leftPrice - rightPrice : rightPrice - leftPrice;
      }
    }
    if (request.query) {
      const difference = relevanceScore(right, request.query, searchPlan) - relevanceScore(left, request.query, searchPlan);
      if (difference) return difference;
    }
    return left.title.localeCompare(right.title);
  });
}

export function selectReviewedEcsProducts(products, request, nowValue) {
  if (!Array.isArray(products)) throw new TypeError('Reviewed ECS products must be an array.');
  const searchPlan = searchPlanFor(products, request?.query);
  const matches = products.filter(product => productMatches(product, request, nowValue, searchPlan));
  const exactMatches = matches.filter(product => exactIdentifierMatch(product, request?.query));
  return sortProducts(exactMatches.length ? exactMatches : matches, request, nowValue, searchPlan);
}

function price(product, nowValue) {
  if (!priceIsFresh(product, nowValue)) return { currency: 'USD', min: null, max: null, note: 'Contact us for current price' };
  const amount = finitePriceAmount(product);
  const requestNote = product.priceConflict
    ? 'Conflicting public supplier prices were observed; confirm the applicable option and current price.'
    : 'The supplier listing requires configuration or current-price confirmation.';
  return {
    currency: 'USD',
    min: amount,
    max: amount,
    startingAt: amount !== null && Boolean(product.priceStartingAt),
    note: amount === null
      ? requestNote
      : `Public supplier retail price observed on ${text(product.priceVerifiedAt, 40)}; Projx selling price, shipping, customs and delivery are confirmed before order.`
  };
}

function availability(product, nowValue) {
  const checkedAt = text(product.checkedAt, 40) || null;
  const checkedValue = dateValue(checkedAt);
  const staleAfter = Number(product.staleAfterDays) * 24 * 60 * 60 * 1_000;
  const maximumAge = Number.isFinite(staleAfter) && staleAfter > 0 ? staleAfter : PRICE_MAX_AGE_MS;
  const snapshotStale = !Number.isFinite(checkedValue) || Number(nowValue) - checkedValue > maximumAge;
  const observation = text(product.observedAvailability, 180);
  const observationAr = text(product.observedAvailabilityAr, 180);
  return {
    code: 'check_availability',
    checkedAt,
    leadTime: snapshotStale
      ? 'Availability confirmation required; the previous supplier observation has expired.'
      : observation
      ? `Supplier listing observed: ${observation}. Availability and lead time require confirmation.`
      : 'Availability and lead time require confirmation.',
    leadTimeAr: snapshotStale
      ? 'يلزم تأكيد التوفر؛ انتهت صلاحية المراجعة السابقة لحالة المورد.'
      : observationAr
      ? `كانت حالة المورد عند المراجعة: ${observationAr}. يجب تأكيد التوفر ومدة التجهيز قبل الطلب.`
      : 'يجب تأكيد التوفر ومدة التجهيز قبل الطلب.',
    snapshotStale
  };
}

function image(product) {
  const source = product.images?.[0];
  if (!source) return null;
  return {
    src: rootAsset(source.src),
    width: Number(source.width) || null,
    height: Number(source.height) || null,
    alt: text(source.alt || product.title, 220),
    altAr: text(source.altAr || product.titleAr, 220) || null,
    status: text(product.imageStatus, 80) || null
  };
}

function card(product, request, nowValue) {
  const hasVehicleContext = Boolean(request.structuredVehicle || request.fitment !== 'all');
  return {
    handle: product.publicKey,
    publicKey: product.publicKey,
    title: text(product.title, 300),
    titleAr: text(product.titleAr, 300) || null,
    vendor: text(product.brand, 160) || null,
    category: text([...new Set([product.category, product.subcategory].filter(Boolean))].join(' / '), 160) || null,
    categoryAr: text([...new Set([product.categoryAr, product.subcategoryAr].filter(Boolean))].join(' / '), 160) || null,
    image: image(product),
    sku: text(product.ecsPartNumber, 120) || null,
    skuCount: product.ecsPartNumber ? 1 : 0,
    skuState: product.ecsPartNumber ? 'exact' : 'not_supplied',
    mpn: text(product.mpn, 120) || null,
    mpnCount: product.mpn ? 1 : 0,
    price: price(product, nowValue),
    availability: availability(product, nowValue),
    sourceUrl: text(product.originalUrl, 2_048) || null,
    supplier: { slug: 'ecs', name: 'ECS Tuning' },
    fitmentConfidence: hasVehicleContext ? 'possible' : null
  };
}

export function reviewedEcsProductCard(product, request, nowValue) {
  if (!product || typeof product !== 'object' || !request || typeof request !== 'object') {
    throw new ReviewedFallbackError(500, 'invalid_reviewed_product', 'A reviewed ECS product could not be rendered.');
  }
  return card(product, request, nowValue);
}

function detailFitments(product) {
  return (product.fitments || []).map(fitment => ({
    confidence: 'possible',
    yearFrom: fitment.yearFrom || null,
    yearTo: fitment.yearTo || null,
    make: text(fitment.make, 80),
    model: text(fitment.model, 100),
    generation: text(fitment.generation, 120),
    chassis: unique((fitment.chassis || []).map(value => text(value, 40))),
    engine: text((fitment.engines || []).join(' / '), 120) || null,
    drivetrain: null,
    note: text(fitment.note, 300) || 'Fitment confirmation required before order.',
    noteAr: text(fitment.noteAr, 300) || 'يجب تأكيد توافق القطعة مع السيارة قبل الطلب.'
  }));
}

function detail(product, products, request, nowValue) {
  const base = card(product, request, nowValue);
  return {
    ...base,
    description: text(product.description || product.summary, 5_000),
    descriptionAr: text(product.descriptionAr || product.summaryAr, 5_000),
    images: (product.images || []).map(source => ({
      src: rootAsset(source.src), width: Number(source.width) || null, height: Number(source.height) || null,
      alt: text(source.alt || product.title, 220), altAr: text(source.altAr, 220) || null,
      status: text(product.imageStatus, 80) || null
    })).filter(item => item.src),
    variants: [],
    options: [],
    specifications: Array.isArray(product.specifications) ? product.specifications : [],
    fitments: detailFitments(product),
    relatedProducts: (product.relatedProductSlugs || []).map(slug => products.find(candidate => candidate.slug === slug))
      .filter(Boolean).map(candidate => card(candidate, { ...request, structuredVehicle: false, fitment: 'all' }, nowValue)),
    installation: product.installation || { status: 'confirmation-required' },
    shipping: product.shipping || { status: 'quote-required' },
    seo: product.seo || null,
    dataQuality: {
      status: 'reviewed-partial',
      detailedDescriptionAvailable: Boolean(product.detailedDescriptionAvailable),
      specificationsAvailable: Boolean(product.specifications?.length),
      exactFitmentAvailable: false,
      stockFeedAvailable: false
    }
  };
}

function responseRecorder() {
  return {
    statusCode: 0,
    headers: Object.create(null),
    body: '',
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    end(value = '') { this.body = String(value); }
  };
}

async function invokeLegacy(handler, originalRequest, parameters) {
  if (typeof handler !== 'function') return null;
  const query = Object.fromEntries(parameters.entries());
  const req = {
    ...originalRequest,
    method: 'GET',
    query,
    url: `/api/tegiwa-catalog?${parameters.toString()}`
  };
  const res = responseRecorder();
  await handler(req, res);
  let body;
  try { body = JSON.parse(res.body || '{}'); } catch { body = {}; }
  const status = Number(res.statusCode) || 500;
  if (status >= 400) {
    throw new ReviewedFallbackError(
      status,
      text(body?.error?.code, 80) || 'supplier_fallback_unavailable',
      text(body?.error?.message, 300) || 'The supplier fallback catalogue is unavailable.'
    );
  }
  return body;
}

function tegiwaHandle(value) {
  const source = text(value, 255);
  return source.startsWith('tegiwa-') ? source : `tegiwa-${source}`;
}

function normalizedLegacyCard(value, request) {
  const handle = tegiwaHandle(value?.handle || value?.publicKey);
  return {
    ...value,
    handle,
    publicKey: handle,
    supplier: value?.supplier || { slug: 'tegiwa', name: 'Tegiwa' },
    fitmentConfidence: request.structuredVehicle ? 'possible' : (value?.fitmentConfidence || null)
  };
}

function normalizedLegacyPayload(payload, request) {
  if (!payload) return null;
  if (Array.isArray(payload.items)) {
    return { ...payload, items: payload.items.map(item => normalizedLegacyCard(item, request)) };
  }
  if (payload.product) {
    return { ...payload, product: normalizedLegacyCard(payload.product, request) };
  }
  if (Array.isArray(payload.suggestions)) {
    return {
      ...payload,
      suggestions: payload.suggestions.map(item => ({
        ...item,
        handle: tegiwaHandle(item.handle),
        supplier: item.supplier || { slug: 'tegiwa', name: 'Tegiwa' }
      }))
    };
  }
  return payload;
}

function legacyEligible(request) {
  if (request.supplier && request.supplier !== 'tegiwa') return false;
  if (request.currency && request.currency !== 'GBP') return false;
  if (request.brand || request.partType || request.fitment === 'exact') return false;
  if (request.fitment === 'possible' && !request.structuredVehicle) return false;
  return true;
}

function legacySearchQuery(request) {
  return text([
    request.query,
    request.structuredVehicle ? request.make : null,
    request.structuredVehicle ? request.model : null,
    request.structuredVehicle ? request.generation : null,
    request.structuredVehicle ? request.engine : null,
    request.structuredVehicle && !request.make && !request.model ? request.year : null
  ].filter(Boolean).join(' '), 120);
}

function legacyListParameters(request, page) {
  const parameters = new URLSearchParams();
  const query = legacySearchQuery(request);
  if (query) {
    parameters.set('q', query);
  }
  parameters.set('page', String(page));
  if (query || request.sort !== 'relevance') parameters.set('sort', request.sort || 'relevance');
  if (query || request.availability !== 'all') parameters.set('availability', request.availability || 'all');
  if (query || request.pricing !== 'all') parameters.set('pricing', request.pricing || 'all');
  if (query) parameters.set('match', request.structuredVehicle ? 'vehicle' : (request.match || 'any'));
  return parameters;
}

function resolvedSearchMeta(searchPlan, legacyMeta, request) {
  const local = searchPlan ? catalogSearchMeta(searchPlan) : null;
  const legacy = legacyMeta && (legacyMeta.corrected || legacyMeta.translated)
    ? {
        canonicalQuery: text(legacyMeta.canonicalQuery, 120) || request.query || null,
        translated: Boolean(legacyMeta.translated), corrected: Boolean(legacyMeta.corrected),
        corrections: Array.isArray(legacyMeta.corrections) ? legacyMeta.corrections.slice(0, 12) : []
      }
    : null;
  if (local?.corrected || local?.translated) return local;
  return legacy || local || {
    canonicalQuery: request.query || null, translated: false, corrected: false, corrections: []
  };
}

function overallMeta({
  request, localProducts, legacyMeta, count, totalResults, reason, nowValue,
  legacyError = null, mixedSupplierResults = false, legacyCatalogueMeta = null, searchPlan = null
}) {
  const legacyCatalogCount = Number(legacyMeta?.catalogProductCount ?? legacyCatalogueMeta?.catalogProductCount) || 0;
  const legacyAvailableCount = Number(legacyMeta?.availableProductCount ?? legacyCatalogueMeta?.availableProductCount) || 0;
  const legacyStockCount = Number(legacyMeta?.stockIndexedProductCount ?? legacyCatalogueMeta?.stockIndexedProductCount) || 0;
  const legacySkuCount = Number(legacyMeta?.skuIndexedProductCount ?? legacyCatalogueMeta?.skuIndexedProductCount) || 0;
  const localSkuCount = localProducts.filter(product => product.ecsPartNumber).length;
  const localStockCount = localProducts.filter(product => product.stockPolicy !== 'manual-confirm'
    && !availability(product, nowValue).snapshotStale
    && ['in_stock', 'supplier_stock', 'available_to_order'].includes(product.availabilityCode)).length;
  const localSnapshotStale = localProducts.some(product => availability(product, nowValue).snapshotStale);
  const localFacets = localCatalogueFacets(localProducts);
  const brands = normalizedFacetList(legacyMeta?.brands);
  const partTypes = normalizedFacetList(legacyMeta?.partTypes);
  localFacets.brands.forEach(value => brands.set(value.slug, value));
  localFacets.partTypes.forEach(value => partTypes.set(value.slug, value));
  const sortFacets = values => [...values.values()].sort((left, right) => left.name.localeCompare(right.name) || left.slug.localeCompare(right.slug));
  const suppliers = unique([
    ...(legacyCatalogCount ? [{ slug: 'tegiwa', name: 'Tegiwa' }] : []),
    ...(localProducts.length ? [{ slug: 'ecs', name: 'ECS Tuning' }] : [])
  ].map(value => JSON.stringify(value))).map(value => JSON.parse(value));
  const searchMeta = resolvedSearchMeta(searchPlan, legacyMeta, request);
  return {
    count,
    catalogProductCount: legacyCatalogCount + localProducts.length,
    stockIndexedProductCount: legacyStockCount + localStockCount,
    skuIndexedProductCount: legacySkuCount + localSkuCount,
    availableProductCount: legacyAvailableCount,
    checkedAt: [legacyMeta?.checkedAt ?? legacyCatalogueMeta?.checkedAt, ...localProducts.map(product => product.checkedAt)]
      .filter(Boolean).sort().at(-1) || null,
    stockSnapshotStale: Boolean(legacyMeta?.stockSnapshotStale || localSnapshotStale),
    suppliers,
    brands: sortFacets(brands),
    partTypes: sortFacets(partTypes),
    currencies: unique([...(legacyCatalogCount ? ['GBP'] : []), ...(localProducts.length ? ['USD'] : [])]),
    query: request.query || null,
    ...searchMeta,
    page: request.page,
    pageSize: PAGE_SIZE,
    totalResults,
    totalPages: Math.ceil(totalResults / PAGE_SIZE),
    sort: request.sort,
    sortScope: mixedSupplierResults ? 'supplier-groups' : 'single-supplier-or-currency',
    ...(mixedSupplierResults ? {
      sortNote: 'Mixed-currency results are grouped by supplier. Sorting is applied within each supplier; USD and GBP prices are not converted or compared.'
    } : {}),
    availability: request.availability,
    pricing: request.pricing,
    match: request.match,
    filters: {
      supplier: request.supplier, brand: request.brand, partType: request.partType,
      currency: request.currency, fitment: request.fitment, year: request.year,
      make: request.make, model: request.model, generation: request.generation, engine: request.engine
    },
    partialCatalogue: true,
    catalogueSource: 'reviewed-local-fallback',
    fallbackReason: reason,
    fallbackOrdering: 'reviewed-ecs-first-then-tegiwa',
    reviewedEcsProductCount: localProducts.length,
    reviewedEcsCatalogueStatus: reviewedEcsCatalogueStatus(localProducts),
    fitmentPolicy: 'supplier-title-possible',
    ...(legacyError ? { supplierFallbackError: legacyError.code } : {})
  };
}

async function listResponse({ request, req, nowValue, reason, legacyHandler, products }) {
  const searchPlan = searchPlanFor(products, request.query);
  const localMatches = products.filter(product => productMatches(product, request, nowValue, searchPlan));
  const exactIdentifierMatches = localMatches.filter(product => exactIdentifierMatch(product, request.query));
  const exactIdentifierOnly = exactIdentifierMatches.length > 0;
  const localAll = sortProducts(exactIdentifierOnly ? exactIdentifierMatches : localMatches, request, nowValue, searchPlan);
  const localSlice = localAll.slice(request.offset, request.offset + PAGE_SIZE);
  const items = localSlice.map(product => card(product, request, nowValue));
  let legacyMeta = null;
  let legacyTotal = 0;
  let legacyError = null;

  if (legacyHandler && legacyEligible(request)) {
    let legacyOffset = Math.max(0, request.offset - localAll.length);
    let page = Math.floor(legacyOffset / PAGE_SIZE) + 1;
    let skip = legacyOffset % PAGE_SIZE;
    while (items.length < PAGE_SIZE || legacyMeta === null) {
      let payload;
      try {
        payload = normalizedLegacyPayload(
          await invokeLegacy(legacyHandler, req, legacyListParameters(request, page)),
          request
        );
      } catch (error) {
        if (error instanceof ReviewedFallbackError && error.status >= 500) {
          legacyError = error;
          break;
        }
        throw error;
      }
      legacyMeta ||= payload?.meta || {};
      if (exactIdentifierOnly) break;
      legacyTotal = Number(payload?.meta?.totalResults ?? payload?.meta?.catalogProductCount) || 0;
      if (items.length >= PAGE_SIZE) break;
      const pageItems = (payload?.items || []).slice(skip);
      items.push(...pageItems.slice(0, PAGE_SIZE - items.length));
      if (!pageItems.length || items.length >= PAGE_SIZE || page * PAGE_SIZE >= legacyTotal) break;
      page += 1;
      skip = 0;
    }
  }

  const totalResults = localAll.length + legacyTotal;
  if (request.offset > 0 && request.offset >= totalResults) {
    throw new ReviewedFallbackError(
      400,
      request.positionSource === 'cursor' ? 'invalid_cursor' : 'invalid_page',
      'The requested catalog position does not exist.'
    );
  }
  const nextOffset = request.offset + items.length;
  return {
    mode: request.mode,
    items,
    meta: overallMeta({
      request, localProducts: products, legacyMeta, count: items.length,
      totalResults, reason, nowValue, legacyError,
      mixedSupplierResults: !request.supplier && !request.currency && localAll.length > 0 && legacyTotal > 0,
      legacyCatalogueMeta: legacyHandler?.catalogueMeta, searchPlan
    }),
    nextOffset: items.length === PAGE_SIZE && nextOffset < totalResults ? nextOffset : null
  };
}

async function suggestionResponse({ request, req, nowValue, reason, legacyHandler, products }) {
  const searchPlan = searchPlanFor(products, request.query);
  const localMatches = products.filter(product => productMatches(product, {
    ...request, availability: 'all', pricing: 'all', fitment: 'all', structuredVehicle: Boolean(
      request.year || request.make || request.model || request.generation || request.engine
    )
  }, nowValue, searchPlan));
  const exactIdentifierMatches = localMatches.filter(product => exactIdentifierMatch(product, request.query));
  const exactIdentifierOnly = exactIdentifierMatches.length > 0;
  const local = sortProducts(exactIdentifierOnly ? exactIdentifierMatches : localMatches,
    { ...request, sort: 'relevance' }, nowValue, searchPlan).slice(0, SUGGESTION_LIMIT);
  const suggestions = local.map(product => ({
    query: product.title, label: product.title, kind: 'product',
    labelAr: text(product.titleAr, 300) || null,
    handle: product.publicKey, supplier: { slug: 'ecs', name: 'ECS Tuning' },
    brand: text(product.brand, 120) || null,
    category: text(product.subcategory || product.category, 160) || null,
    sku: text(product.ecsPartNumber || product.sku || product.mpn, 120) || null,
    image: image(product)
  }));
  let legacyMeta = null;
  let legacyError = null;
  if (legacyHandler && legacyEligible(request) && suggestions.length < SUGGESTION_LIMIT) {
    const parameters = new URLSearchParams({ q: legacySearchQuery(request), suggest: '1' });
    try {
      const payload = normalizedLegacyPayload(await invokeLegacy(legacyHandler, req, parameters), request);
      legacyMeta = payload?.meta || {};
      if (!exactIdentifierOnly) {
        const seen = new Set(suggestions.map(item => item.handle));
        for (const suggestion of payload?.suggestions || []) {
          if (!seen.has(suggestion.handle)) suggestions.push(suggestion);
          seen.add(suggestion.handle);
          if (suggestions.length === SUGGESTION_LIMIT) break;
        }
      }
    } catch (error) {
      if (error instanceof ReviewedFallbackError && error.status >= 500) legacyError = error;
      else throw error;
    }
  }
  const correction = resolvedSearchMeta(searchPlan, legacyMeta, request);
  return {
    mode: 'suggest', suggestions,
    correction: { query: request.query, ...correction },
    meta: {
      count: suggestions.length, limit: SUGGESTION_LIMIT,
      ...overallMeta({
        request: { ...request, page: 1, sort: 'relevance', availability: 'all', pricing: 'all', match: 'any' },
        localProducts: products, legacyMeta, count: suggestions.length,
        totalResults: suggestions.length, reason, nowValue, legacyError,
        legacyCatalogueMeta: legacyHandler?.catalogueMeta, searchPlan
      })
    },
    nextCursor: null
  };
}

async function detailResponse({ request, req, nowValue, reason, legacyHandler, products }) {
  const local = products.find(product => [product.publicKey, product.slug].includes(request.handle));
  const localAllowed = (!request.supplier || request.supplier === 'ecs') && (!request.currency || request.currency === 'USD');
  if (local && localAllowed) {
    return {
      mode: 'detail',
      product: detail(local, products, { ...request, structuredVehicle: false, fitment: 'all' }, nowValue),
      meta: {
        ...overallMeta({
          request: { ...request, page: 1, sort: 'relevance', availability: 'all', pricing: 'all', match: 'any' },
          localProducts: products, legacyMeta: null, count: 1, totalResults: 1, reason, nowValue,
          legacyCatalogueMeta: legacyHandler?.catalogueMeta
        }),
        count: 1
      }
    };
  }
  if (request.handle.startsWith('ecs-') || request.supplier === 'ecs' || !legacyHandler) {
    throw new ReviewedFallbackError(404, 'product_not_found', 'The requested product was not found.');
  }
  const sourceHandle = request.handle.startsWith('tegiwa-') ? request.handle.slice('tegiwa-'.length) : request.handle;
  let payload;
  try {
    payload = normalizedLegacyPayload(
      await invokeLegacy(legacyHandler, req, new URLSearchParams({ handle: sourceHandle })),
      request
    );
  } catch (detailError) {
    if (!(detailError instanceof ReviewedFallbackError) || detailError.status < 500) throw detailError;
    const snapshot = normalizedLegacyPayload(
      await invokeLegacy(legacyHandler, req, new URLSearchParams({ q: sourceHandle, page: '1' })),
      request
    );
    const card = (snapshot?.items || []).find(item => item.handle === tegiwaHandle(sourceHandle));
    if (!card) throw detailError;
    payload = {
      mode: 'detail',
      product: {
        ...card,
        description: '',
        images: card.image ? [card.image] : [],
        variants: [],
        detailSnapshotOnly: true
      },
      meta: {
        ...(snapshot?.meta || {}),
        count: 1,
        detailSnapshotOnly: true,
        detailFallbackReason: detailError.code
      }
    };
  }
  return {
    ...payload,
    meta: {
      ...(payload?.meta || {}),
      partialCatalogue: true,
      catalogueSource: 'reviewed-local-fallback',
      fallbackReason: reason,
      reviewedEcsProductCount: products.length,
      reviewedEcsCatalogueStatus: reviewedEcsCatalogueStatus(products),
      fitmentPolicy: 'supplier-title-possible',
      suppliers: [{ slug: 'tegiwa', name: 'Tegiwa' }, { slug: 'ecs', name: 'ECS Tuning' }],
      currencies: ['GBP', 'USD']
    }
  };
}

export async function reviewedFallbackResponse({
  request,
  req,
  nowValue,
  reason,
  legacyHandler = null,
  products = REVIEWED_ECS_PRODUCTS
}) {
  if (!Array.isArray(products) || products.length === 0) {
    throw new ReviewedFallbackError(503, 'service_unconfigured', 'No reviewed fallback products are configured.');
  }
  if (request.mode === 'detail') return detailResponse({ request, req, nowValue, reason, legacyHandler, products });
  if (request.mode === 'suggest') return suggestionResponse({ request, req, nowValue, reason, legacyHandler, products });
  return listResponse({ request, req, nowValue, reason, legacyHandler, products });
}

export const __test = Object.freeze({
  productMatches,
  sortProducts,
  card,
  detail,
  legacyEligible,
  legacySearchQuery
});
