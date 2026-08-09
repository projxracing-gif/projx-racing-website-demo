const PARENT_PART_TYPES = Object.freeze({
  braking: Object.freeze({
    name: 'Brakes',
    nameAr: 'الفرامل',
    members: Object.freeze([
      'braking', 'g-series-braking', 'bmw-m3-braking', 'performance-brake-parts-upgrades'
    ])
  }),
  engine: Object.freeze({
    name: 'Engine',
    nameAr: 'المحرك',
    members: Object.freeze([
      'engine', 'g-series-engine', 'bmw-m3-engine', 'performance-engine-drivetrain-parts'
    ])
  }),
  exterior: Object.freeze({
    name: 'Exterior',
    nameAr: 'الهيكل الخارجي',
    members: Object.freeze(['exterior', 'bmw-m3-exterior', 'performance-exterior-parts-upgrades'])
  }),
  interior: Object.freeze({
    name: 'Interior',
    nameAr: 'المقصورة',
    members: Object.freeze(['interior', 'bmw-m3-interior', 'interior-performance-parts-upgrades'])
  }),
  performance: Object.freeze({
    name: 'Performance',
    nameAr: 'الأداء',
    members: Object.freeze([
      'performance', 'bmw-m3-performance',
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
    members: Object.freeze(['suspension', 'bmw-m3-suspension', 'performance-suspension-parts-upgrades'])
  }),
  steering: Object.freeze({
    name: 'Steering',
    nameAr: 'نظام التوجيه',
    members: Object.freeze(['steering', 'bmw-m3-steering'])
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
  return Object.entries(PARENT_PART_TYPES)
    .filter(([, definition]) => definition.members.some(slug => slugs.includes(slug)))
    .map(([slug, definition]) => ({ slug, name: definition.name, nameAr: definition.nameAr }));
}
