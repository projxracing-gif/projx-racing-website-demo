import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CATALOGUE_PARENT_PART_TYPES,
  catalogueParentPartTypeFacets,
  cataloguePartTypeMatches,
  cataloguePartTypeMembers
} from '../server/catalog-taxonomy.js';

const expectedParents = ['braking', 'engine', 'exterior', 'interior', 'performance', 'steering', 'suspension'];

test('generic BMW M3 catalogue parents cover legacy, G-Series and aggregate scopes', () => {
  assert.deepEqual(Object.keys(CATALOGUE_PARENT_PART_TYPES).sort(), expectedParents);
  assert.deepEqual(cataloguePartTypeMembers('braking'), [
    'braking', 'g-series-braking', 'bmw-m3-braking', 'performance-brake-parts-upgrades'
  ]);
  assert.deepEqual(cataloguePartTypeMembers('engine'), [
    'engine', 'g-series-engine', 'bmw-m3-engine', 'performance-engine-drivetrain-parts'
  ]);
  assert.equal(cataloguePartTypeMatches(['g-series-braking'], 'braking'), true);
  assert.equal(cataloguePartTypeMatches(['bmw-m3-braking'], 'braking'), true);
  assert.equal(cataloguePartTypeMatches(['performance-engine-drivetrain-parts'], 'performance'), true);
  assert.equal(cataloguePartTypeMatches(['bmw-m3-performance'], 'performance'), true);
  assert.equal(cataloguePartTypeMatches(['performance-suspension-parts-upgrades'], 'suspension'), true);
});

test('generation-specific and aggregate-specific facets remain precisely scoped', () => {
  assert.deepEqual(cataloguePartTypeMembers('g-series-braking'), ['g-series-braking']);
  assert.deepEqual(cataloguePartTypeMembers('bmw-m3-braking'), ['bmw-m3-braking']);
  assert.equal(cataloguePartTypeMatches(['bmw-m3-braking'], 'g-series-braking'), false);
  assert.equal(cataloguePartTypeMatches(['g-series-braking'], 'bmw-m3-braking'), false);
});

test('parent facet labels are exposed only when a matching scope exists', () => {
  const facets = catalogueParentPartTypeFacets([
    'g-series-engine', 'bmw-m3-exterior', 'bmw-m3-steering', 'unrelated'
  ]);
  assert.deepEqual(facets.map(facet => facet.slug), ['engine', 'exterior', 'steering']);
  assert.ok(facets.every(facet => facet.name && /[\u0600-\u06ff]/u.test(facet.nameAr)));
});

test('unknown exact part types pass through without broadening', () => {
  assert.deepEqual(cataloguePartTypeMembers('drivetrain-transfer-case'), ['drivetrain-transfer-case']);
  assert.equal(cataloguePartTypeMatches(['drivetrain-transfer-case'], 'drivetrain-transfer-case'), true);
  assert.equal(cataloguePartTypeMatches(['drivetrain-differential'], 'drivetrain-transfer-case'), false);
});
