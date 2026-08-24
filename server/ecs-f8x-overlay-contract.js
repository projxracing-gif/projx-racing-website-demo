const ECS_IDENTITY = /^ES#(\d{3,12})$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ECS_PRODUCT_PATH = /^\/b-[^/?#]+\/[^/?#]+\/[^/?#]+\/$/i;

export const ECS_F8X_OVERLAY_SCOPE = Object.freeze({
  kind: 'bmw-f8x',
  profiles: Object.freeze(['f80-m3', 'f82-m4', 'f83-m4']),
  chassis: Object.freeze(['F80', 'F82', 'F83']),
  sections: Object.freeze(['braking', 'engine', 'exterior', 'interior', 'performance', 'suspension', 'steering']),
  complete: true
});

export const ECS_F8X_PROFILE_CONTRACTS = Object.freeze({
  'f80-m3': Object.freeze({
    vehicle: 'BMW F80 M3 S55 3.0L', model: 'M3', generation: 'F80', chassis: 'F80'
  }),
  'f82-m4': Object.freeze({
    vehicle: 'BMW F82 M4 S55 3.0L', model: 'M4', generation: 'F82', chassis: 'F82'
  }),
  'f83-m4': Object.freeze({
    vehicle: 'BMW F83 M4 S55 3.0L', model: 'M4', generation: 'F83', chassis: 'F83'
  })
});

const SECTION_LABELS = Object.freeze({
  braking: 'Braking',
  engine: 'Engine',
  exterior: 'Exterior',
  interior: 'Interior',
  performance: 'Performance',
  suspension: 'Suspension',
  steering: 'Steering'
});

export class EcsF8xOverlayContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EcsF8xOverlayContractError';
    this.code = 'invalid_f8x_overlay_product';
  }
}

function invalid(label, message) {
  throw new EcsF8xOverlayContractError(`${label} ${message}`);
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactStringSet(values, expected) {
  return Array.isArray(values)
    && values.every(value => typeof value === 'string' && value.length > 0)
    && new Set(values).size === values.length
    && JSON.stringify([...values].sort()) === JSON.stringify([...expected].sort());
}

function emptyArray(value) {
  return Array.isArray(value) && value.length === 0;
}

function canonicalTimestamp(value) {
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value ? value : null;
}

function f8xCategorySlug(value) {
  return String(value ?? '').normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 500)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'uncategorized';
}

function canonicalEcsUrl(value, { product = false } = {}) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'www.ecstuning.com' || url.username
      || url.password || url.port || url.search || url.hash || url.toString() !== value
      || (product && !ECS_PRODUCT_PATH.test(url.pathname))) return null;
    return value;
  } catch {
    return null;
  }
}

function identityDigits(value) {
  return typeof value === 'string' ? value.match(ECS_IDENTITY)?.[1] || null : null;
}

export function canonicalEcsF8xIdentity(product, { compact = false, label = 'The F8X overlay product' } = {}) {
  if (!plainObject(product)) invalid(label, 'must be a plain object.');
  const identity = identityDigits(product.ecsPartNumber);
  if (!identity || identityDigits(product.sku) !== identity
    || product.publicKey !== `ecs-es-${identity}` || product.slug !== `es-${identity}`) {
    invalid(label, 'has inconsistent ecsPartNumber, sku, publicKey or slug identity fields.');
  }
  if (!compact || product.identifiers !== undefined) {
    if (!plainObject(product.identifiers) || identityDigits(product.identifiers.ecs) !== identity
      || (product.identifiers.sku !== undefined && identityDigits(product.identifiers.sku) !== identity)
      || (product.identifiers.mpn !== undefined && product.identifiers.mpn !== product.mpn)) {
      invalid(label, `ES#${identity} has inconsistent canonical identifiers.`);
    }
  }
  return identity;
}

function profileKeysFromCategories(categories, label, identity) {
  const profiles = ECS_F8X_OVERLAY_SCOPE.profiles.filter(value => categories.includes(value));
  if (!profiles.length) invalid(label, `ES#${identity} has no canonical F8X profile filter.`);
  return profiles;
}

function sectionKeysFromCategories(categories, label, identity) {
  const sections = ECS_F8X_OVERLAY_SCOPE.sections.filter(value => categories.includes(`bmw-f8x-${value}`));
  if (!sections.length) invalid(label, `ES#${identity} has no canonical F8X section filter.`);
  return sections;
}

function validateFitments(product, profiles, label, identity, { compact }) {
  if (!Array.isArray(product.fitments) || product.fitments.length !== profiles.length) {
    invalid(label, `ES#${identity} fitments do not match its F8X profile filters.`);
  }
  const remaining = new Set(profiles);
  for (const fitment of product.fitments) {
    if (!plainObject(fitment)) invalid(label, `ES#${identity} contains a non-object fitment.`);
    const profileKey = profiles.find(key => {
      const profile = ECS_F8X_PROFILE_CONTRACTS[key];
      return fitment.make === 'BMW' && fitment.model === profile.model
        && exactStringSet(fitment.models, [profile.model])
        && fitment.generation === profile.generation
        && exactStringSet(fitment.chassis, [profile.chassis])
        && exactStringSet(fitment.engines, ['S55']);
    });
    if (!profileKey || !remaining.has(profileKey)) {
      invalid(label, `ES#${identity} contains foreign, duplicated or cross-profile fitment claims.`);
    }
    if (fitment.yearFrom !== null || fitment.yearTo !== null || fitment.confidence !== 'possible'
      || (!compact && fitment.trim !== null)
      || (!compact && !emptyArray(fitment.drivetrains))
      || (!compact && fitment.evidence !== 'ecs-exact-f8x-vehicle-category')
      || (!compact && Object.hasOwn(fitment, 'options') && !emptyArray(fitment.options))) {
      invalid(label, `ES#${identity} contains non-canonical year, drivetrain, option, confidence or evidence claims.`);
    }
    remaining.delete(profileKey);
  }
  if (remaining.size) invalid(label, `ES#${identity} is missing an exact F8X profile fitment.`);
}

function validateSelectionSources(product, profiles, sections, label, identity) {
  if (!Array.isArray(product.selectionSources) || !product.selectionSources.length) {
    invalid(label, `ES#${identity} has no dated F8X selection evidence.`);
  }
  const sourceProfiles = new Set();
  const sourceSections = new Set();
  const subcategories = new Set();
  const placements = new Set();
  const observedAt = [];
  for (const source of product.selectionSources) {
    const profile = ECS_F8X_PROFILE_CONTRACTS[source?.vehicleKey];
    const section = Object.entries(SECTION_LABELS).find(([, value]) => value === source?.section)?.[0];
    const timestamp = canonicalTimestamp(source?.observedAt);
    const categoryKey = typeof source?.categoryKey === 'string' ? source.categoryKey.trim() : '';
    const position = source?.relevancePosition;
    if (!profile || !profiles.includes(source.vehicleKey) || source.vehicle !== profile.vehicle
      || !section || !sections.includes(section) || typeof source.category !== 'string'
      || !source.category.trim() || !categoryKey || !canonicalEcsUrl(source.sourceUrl)
      || !Number.isSafeInteger(position) || position < 1 || !timestamp) {
      invalid(label, `ES#${identity} has incomplete, foreign or undated vehicle-category evidence.`);
    }
    const placement = `${source.vehicleKey}|${section}|${categoryKey}|${position}|${source.sourceUrl}`;
    if (placements.has(placement)) invalid(label, `ES#${identity} repeats one F8X evidence placement.`);
    placements.add(placement);
    sourceProfiles.add(source.vehicleKey);
    sourceSections.add(section);
    subcategories.add(`bmw-f8x-${section}-${f8xCategorySlug(source.category)}`);
    observedAt.push(timestamp);
  }
  if (!exactStringSet([...sourceProfiles], profiles) || !exactStringSet([...sourceSections], sections)) {
    invalid(label, `ES#${identity} profile or section filters do not match its dated evidence.`);
  }
  const latestDay = observedAt.sort().at(-1).slice(0, 10);
  if (!ISO_DAY.test(product.checkedAt || '') || product.checkedAt !== latestDay
    || product.stockObservedAt !== latestDay) {
    invalid(label, `ES#${identity} stock dates do not match its latest source observation.`);
  }
  return [...subcategories];
}

export function validateCanonicalEcsF8xOverlayProduct(product, {
  compact = false,
  label = 'The F8X overlay product'
} = {}) {
  const identity = canonicalEcsF8xIdentity(product, { compact, label });
  const categories = product?.filters?.categories;
  const allowedCategories = new Set([
    'bmw-f8x',
    ...ECS_F8X_OVERLAY_SCOPE.profiles,
    ...ECS_F8X_OVERLAY_SCOPE.sections.map(value => `bmw-f8x-${value}`)
  ]);
  if (!Array.isArray(categories) || !categories.includes('bmw-f8x')
    || new Set(categories).size !== categories.length
    || categories.some(value => typeof value !== 'string' || !allowedCategories.has(value))) {
    invalid(label, `ES#${identity} has non-canonical F8X category filters.`);
  }
  const profiles = profileKeysFromCategories(categories, label, identity);
  const sections = sectionKeysFromCategories(categories, label, identity);
  const expectedCategories = [
    'bmw-f8x', ...profiles, ...sections.map(value => `bmw-f8x-${value}`)
  ];
  if (!exactStringSet(categories, expectedCategories)) {
    invalid(label, `ES#${identity} category filters contain unrelated or missing F8X scope.`);
  }
  validateFitments(product, profiles, label, identity, { compact });
  if (product.fitmentConfidence !== 'possible' || product.stockPolicy !== 'manual-confirm'
    || product.availabilityCode !== 'check_availability') {
    invalid(label, `ES#${identity} must remain possible-fitment and manual-confirm stock.`);
  }
  if (!compact) {
    const expectedModels = [...new Set(profiles.map(key => ECS_F8X_PROFILE_CONTRACTS[key].model))];
    const expectedChassis = profiles.map(key => ECS_F8X_PROFILE_CONTRACTS[key].chassis);
    if (product.catalogType !== 'product' || product.provider !== 'ECS Tuning'
      || product.providerSlug !== 'ecs' || product.dataOrigin !== 'authorized-public-ecs-f8x-vehicle-category-review'
      || product.fitmentStatus !== 'supplier-vehicle-category-confirm'
      || !plainObject(product.filters)
      || !exactStringSet(product.filters.supplier, ['ecs'])
      || !exactStringSet(product.filters.makes, ['BMW'])
      || !exactStringSet(product.filters.models, expectedModels)
      || !exactStringSet(product.filters.chassis, expectedChassis)
      || !emptyArray(product.filters.years) || !exactStringSet(product.filters.engines, ['S55'])
      || !emptyArray(product.filters.drivetrains)
      || !exactStringSet(product.filters.availability, ['confirmation-required'])
      || !exactStringSet(product.filters.fitment, ['possible'])
      || !emptyArray(product.options) || !emptyArray(product.variants)
      || !canonicalEcsUrl(product.originalUrl, { product: true })
      || product.staleAfterDays !== 7) {
      invalid(label, `ES#${identity} has non-canonical supplier, filter, option, URL or confirmation policy.`);
    }
    if (!Array.isArray(product.filters.subcategories) || !product.filters.subcategories.length
      || new Set(product.filters.subcategories).size !== product.filters.subcategories.length
      || product.filters.subcategories.some(value => typeof value !== 'string'
        || !sections.some(section => value.startsWith(`bmw-f8x-${section}-`)))
      || sections.some(section => !product.filters.subcategories
        .some(value => value.startsWith(`bmw-f8x-${section}-`)))) {
      invalid(label, `ES#${identity} has foreign or missing F8X subcategory filters.`);
    }
    const evidenceSubcategories = validateSelectionSources(
      product, profiles, sections, label, identity
    );
    if (!exactStringSet(product.filters.subcategories, evidenceSubcategories)) {
      invalid(label, `ES#${identity} deep-category filters do not match its dated evidence.`);
    }
  } else if (!ISO_DAY.test(product.checkedAt || '')) {
    invalid(label, `ES#${identity} has no canonical dated catalogue observation.`);
  }
  return Object.freeze({ identity, profiles: Object.freeze(profiles), sections: Object.freeze(sections) });
}
