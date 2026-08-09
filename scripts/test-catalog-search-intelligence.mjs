import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCatalogSearchPlan,
  catalogSearchVocabulary,
  normalizeCatalogSearchText
} from '../server/catalog-search-intelligence.js';

const vocabulary = catalogSearchVocabulary([
  'MHD CAN FlexFuel Analyzer G80 M3 S58 fuel sensor',
  'BMW S58 high flow intercooler performance engine part',
  'BMW G80 brake pads and brake discs',
  'S58 turbocharger intake filter'
]);

test('catalogue search corrects common automotive spelling errors', () => {
  const plan = buildCatalogSearchPlan('flex feul analizer', { vocabulary });
  assert.equal(plan.canonicalQuery, 'flex fuel analyzer');
  assert.equal(plan.corrected, true);
  assert.deepEqual(plan.corrections, [
    { from: 'feul', to: 'fuel' },
    { from: 'analizer', to: 'analyzer' }
  ]);
});

test('catalogue search protects vehicle codes, engine codes and tuning brands', () => {
  const plan = buildCatalogSearchPlan('MHD CAN G80 S58', { vocabulary });
  assert.equal(plan.canonicalQuery, 'mhd can g80 s58');
  assert.equal(plan.corrected, false);
});

test('catalogue search translates Kuwaiti Arabic automotive terms', () => {
  const plan = buildCatalogSearchPlan('محرك تيربو S58', { vocabulary });
  assert.equal(plan.canonicalQuery, 'engine turbo s58');
  assert.equal(plan.translated, true);
  assert.equal(plan.corrected, true);
  const brakes = buildCatalogSearchPlan('فحمات فرامل', { vocabulary });
  assert.equal(brakes.canonicalQuery, 'brake pad');
  assert.ok(brakes.tokenGroups.every(group => group.length > 0));
});

test('catalogue search treats common singular and plural part names as equivalents', () => {
  const plural = buildCatalogSearchPlan('turbochargers filters', { vocabulary });
  assert.ok(plural.tokenGroups[0].includes('turbocharger'));
  assert.ok(plural.tokenGroups[1].includes('filter'));
  assert.match(plural.prefixTsQuery, /turbocharger:\*/);
});

test('catalogue normalization is Unicode-safe and strips punctuation consistently', () => {
  assert.equal(normalizeCatalogSearchText('ES#4690036 / ECA-G-B58-S58-AT'), 'es 4690036 eca g b58 s58 at');
});
