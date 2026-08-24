const BMW_F8X_FACETS = Object.freeze({
  'bmw-f8x': Object.freeze({ name: 'BMW F8X Parts', nameAr: 'قطع BMW F8X' }),
  'bmw-f8x-braking': Object.freeze({ name: 'Braking Parts', nameAr: 'قطع الفرامل — BMW F8X' }),
  'bmw-f8x-engine': Object.freeze({ name: 'Engine Parts', nameAr: 'قطع المحرك — BMW F8X' }),
  'bmw-f8x-exterior': Object.freeze({ name: 'Exterior Parts', nameAr: 'قطع الهيكل الخارجي — BMW F8X' }),
  'bmw-f8x-interior': Object.freeze({ name: 'Interior Parts', nameAr: 'قطع المقصورة الداخلية — BMW F8X' }),
  'bmw-f8x-suspension': Object.freeze({ name: 'Suspension Parts', nameAr: 'قطع نظام التعليق — BMW F8X' }),
  'bmw-f8x-steering': Object.freeze({ name: 'Steering Parts', nameAr: 'قطع نظام التوجيه — BMW F8X' }),
  'bmw-f8x-performance': Object.freeze({ name: 'Performance Parts', nameAr: 'قطع الأداء — BMW F8X' })
});
const BMW_F8X_PART_TYPES = Object.freeze(Object.keys(BMW_F8X_FACETS));

const PARENT_PART_TYPES = Object.freeze({
  braking: Object.freeze({
    name: 'Brakes',
    nameAr: 'الفرامل',
    members: Object.freeze([
      'braking', 'g-series-braking', 'bmw-m3-braking', 'bmw-f8x-braking',
      'performance-brake-parts-upgrades'
    ])
  }),
  engine: Object.freeze({
    name: 'Engine',
    nameAr: 'المحرك',
    members: Object.freeze([
      'engine', 'g-series-engine', 'bmw-m3-engine', 'bmw-f8x-engine',
      'performance-engine-drivetrain-parts'
    ])
  }),
  exterior: Object.freeze({
    name: 'Exterior',
    nameAr: 'الهيكل الخارجي',
    members: Object.freeze([
      'exterior', 'bmw-m3-exterior', 'bmw-f8x-exterior', 'performance-exterior-parts-upgrades'
    ])
  }),
  interior: Object.freeze({
    name: 'Interior',
    nameAr: 'المقصورة',
    members: Object.freeze([
      'interior', 'bmw-m3-interior', 'bmw-f8x-interior', 'interior-performance-parts-upgrades'
    ])
  }),
  performance: Object.freeze({
    name: 'Performance',
    nameAr: 'الأداء',
    members: Object.freeze([
      'performance', 'bmw-m3-performance', 'bmw-f8x-performance',
      'performance-engine-drivetrain-parts', 'performance-exterior-parts-upgrades',
      'performance-exhaust-parts-upgrades', 'interior-performance-parts-upgrades',
      'performance-suspension-parts-upgrades', 'performance-wheel-parts-upgrades',
      'performance-brake-parts-upgrades', 'performance-software-tuning',
      'essential-performance-parts-upgrades', 'performance-lighting-parts-upgrades'
    ])
  }),
  suspension: Object.freeze({
    name: 'Suspension',
    nameAr: 'نظام التعليق',
    members: Object.freeze([
      'suspension', 'bmw-m3-suspension', 'bmw-f8x-suspension',
      'performance-suspension-parts-upgrades'
    ])
  }),
  steering: Object.freeze({
    name: 'Steering',
    nameAr: 'نظام التوجيه',
    members: Object.freeze(['steering', 'bmw-m3-steering', 'bmw-f8x-steering'])
  }),
  'bmw-f8x': Object.freeze({
    ...BMW_F8X_FACETS['bmw-f8x'],
    members: BMW_F8X_PART_TYPES
  })
});

export const CATALOGUE_PARENT_PART_TYPES = PARENT_PART_TYPES;

export function cataloguePartTypeMembers(value) {
  const slug = String(value || '').trim().toLocaleLowerCase('en-US');
  return PARENT_PART_TYPES[slug]?.members || Object.freeze(slug ? [slug] : []);
}

export function cataloguePartTypeMatches(productSlugs, requested) {
  const available = new Set((Array.isArray(productSlugs) ? productSlugs : [])
    .map(value => String(value || '').trim().toLocaleLowerCase('en-US')).filter(Boolean));
  return cataloguePartTypeMembers(requested).some(slug => available.has(slug));
}

export function catalogueParentPartTypeFacets(productSlugs) {
  const slugs = Array.isArray(productSlugs) ? productSlugs : [];
  const facets = new Map(Object.entries(PARENT_PART_TYPES)
    .filter(([, definition]) => definition.members.some(slug => slugs.includes(slug)))
    .map(([slug, definition]) => [slug, { slug, name: definition.name, nameAr: definition.nameAr }]));
  for (const slug of slugs) {
    const definition = BMW_F8X_FACETS[slug];
    if (definition) facets.set(slug, { slug, name: definition.name, nameAr: definition.nameAr });
  }
  return [...facets.values()];
}
