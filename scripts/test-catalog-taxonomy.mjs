import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CATALOGUE_PARENT_PART_TYPES,
  catalogueParentPartTypeFacets,
  cataloguePartTypeMatches,
  cataloguePartTypeMembers
} from '../server/catalog-taxonomy.js';

const expectedParents = [
  'bmw-f8x', 'braking', 'engine', 'exterior', 'interior', 'performance', 'steering', 'suspension'
];

test('generic catalogue parents cover legacy, G-Series, BMW M3 and BMW F8X scopes', () => {
  assert.deepEqual(Object.keys(CATALOGUE_PARENT_PART_TYPES).sort(), expectedParents);
  assert.deepEqual(cataloguePartTypeMembers('braking'), [
    'braking', 'g-series-braking', 'bmw-m3-braking', 'bmw-f8x-braking',
    'performance-brake-parts-upgrades'
  ]);
  assert.deepEqual(cataloguePartTypeMembers('engine'), [
    'engine', 'g-series-engine', 'bmw-m3-engine', 'bmw-f8x-engine',
    'performance-engine-drivetrain-parts'
  ]);
  assert.equal(cataloguePartTypeMatches(['g-series-braking'], 'braking'), true);
  assert.equal(cataloguePartTypeMatches(['bmw-m3-braking'], 'braking'), true);
  assert.equal(cataloguePartTypeMatches(['bmw-f8x-braking'], 'braking'), true);
  assert.equal(cataloguePartTypeMatches(['bmw-f8x-engine'], 'engine'), true);
  assert.equal(cataloguePartTypeMatches(['performance-engine-drivetrain-parts'], 'performance'), true);
  assert.equal(cataloguePartTypeMatches(['bmw-m3-performance'], 'performance'), true);
  assert.equal(cataloguePartTypeMatches(['bmw-f8x-performance'], 'performance'), true);
  assert.equal(cataloguePartTypeMatches(['performance-suspension-parts-upgrades'], 'suspension'), true);
  assert.equal(cataloguePartTypeMatches(['bmw-f8x-suspension'], 'suspension'), true);
});

test('generation-specific and aggregate-specific facets remain precisely scoped', () => {
  assert.deepEqual(cataloguePartTypeMembers('g-series-braking'), ['g-series-braking']);
  assert.deepEqual(cataloguePartTypeMembers('bmw-m3-braking'), ['bmw-m3-braking']);
  assert.deepEqual(cataloguePartTypeMembers('bmw-f8x-braking'), ['bmw-f8x-braking']);
  assert.equal(cataloguePartTypeMatches(['bmw-m3-braking'], 'g-series-braking'), false);
  assert.equal(cataloguePartTypeMatches(['g-series-braking'], 'bmw-m3-braking'), false);
  assert.equal(cataloguePartTypeMatches(['bmw-f8x-engine'], 'bmw-f8x-braking'), false);
  assert.equal(cataloguePartTypeMatches(['bmw-m3-braking'], 'bmw-f8x-braking'), false);
});

test('BMW F8X parent facet covers only its seven supported section scopes', () => {
  assert.deepEqual(cataloguePartTypeMembers('bmw-f8x'), [
    'bmw-f8x',
    'bmw-f8x-braking',
    'bmw-f8x-engine',
    'bmw-f8x-exterior',
    'bmw-f8x-interior',
    'bmw-f8x-suspension',
    'bmw-f8x-steering',
    'bmw-f8x-performance'
  ]);
  for (const slug of cataloguePartTypeMembers('bmw-f8x')) {
    assert.equal(cataloguePartTypeMatches([slug], 'bmw-f8x'), true, `${slug} must match the BMW F8X parent.`);
  }
  assert.equal(cataloguePartTypeMatches(['bmw-m3-engine'], 'bmw-f8x'), false);
  assert.equal(cataloguePartTypeMatches(['g-series-engine'], 'bmw-f8x'), false);
});

test('parent facet labels are exposed only when a matching scope exists', () => {
  const facets = catalogueParentPartTypeFacets([
    'g-series-engine', 'bmw-m3-exterior', 'bmw-m3-steering', 'unrelated'
  ]);
  assert.deepEqual(facets.map(facet => facet.slug), ['engine', 'exterior', 'steering']);
  assert.ok(facets.every(facet => facet.name && /[\u0600-\u06ff]/u.test(facet.nameAr)));
});

test('BMW F8X parent facet has accurate bilingual labels and appears for any supported child', () => {
  const facets = catalogueParentPartTypeFacets(['bmw-f8x-engine', 'bmw-f8x-exterior']);
  assert.deepEqual(facets.map(facet => facet.slug), [
    'engine', 'exterior', 'bmw-f8x', 'bmw-f8x-engine', 'bmw-f8x-exterior'
  ]);
  assert.deepEqual(facets.find(facet => facet.slug === 'bmw-f8x'), {
    slug: 'bmw-f8x', name: 'BMW F8X Parts', nameAr: 'قطع BMW F8X'
  });
  assert.equal(catalogueParentPartTypeFacets(['unrelated']).some(facet => facet.slug === 'bmw-f8x'), false);
});

test('every BMW F8X section facet uses the normalized bilingual category label', () => {
  const expected = {
    'bmw-f8x': ['BMW F8X Parts', 'قطع BMW F8X'],
    'bmw-f8x-braking': ['Braking Parts', 'قطع الفرامل — BMW F8X'],
    'bmw-f8x-engine': ['Engine Parts', 'قطع المحرك — BMW F8X'],
    'bmw-f8x-exterior': ['Exterior Parts', 'قطع الهيكل الخارجي — BMW F8X'],
    'bmw-f8x-interior': ['Interior Parts', 'قطع المقصورة الداخلية — BMW F8X'],
    'bmw-f8x-suspension': ['Suspension Parts', 'قطع نظام التعليق — BMW F8X'],
    'bmw-f8x-steering': ['Steering Parts', 'قطع نظام التوجيه — BMW F8X'],
    'bmw-f8x-performance': ['Performance Parts', 'قطع الأداء — BMW F8X']
  };
  const facets = catalogueParentPartTypeFacets(Object.keys(expected));
  const bySlug = new Map(facets.map(facet => [facet.slug, facet]));
  for (const [slug, [name, nameAr]] of Object.entries(expected)) {
    assert.deepEqual(bySlug.get(slug), { slug, name, nameAr });
  }
});

test('unknown exact part types pass through without broadening', () => {
  assert.deepEqual(cataloguePartTypeMembers('drivetrain-transfer-case'), ['drivetrain-transfer-case']);
  assert.equal(cataloguePartTypeMatches(['drivetrain-transfer-case'], 'drivetrain-transfer-case'), true);
  assert.equal(cataloguePartTypeMatches(['drivetrain-differential'], 'drivetrain-transfer-case'), false);
});
