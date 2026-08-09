import assert from 'node:assert/strict';
import test from 'node:test';
import { __test } from './materialize-bmw-m3-assets.mjs';

function fixture(sectionKey, index = 1) {
  const section = sectionKey[0].toLocaleUpperCase('en-US') + sectionKey.slice(1);
  const categoryKey = `bmw-m3-${sectionKey}-fixture`;
  return {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    accessClass: 'public-retail',
    kind: `bmw-m3-${sectionKey}-listing-capture`,
    generatedAt: `2026-08-09T12:00:0${index}.000Z`,
    vehicle: 'BMW M3',
    section,
    categories: [{
      key: categoryKey,
      count: 1,
      expectedPages: 1,
      pages: 1,
      pageCounts: [1],
      positionsContiguous: true
    }],
    records: [{
      ecsPartNumber: String(1000 + index),
      categoryKey,
      section,
      vehicle: 'BMW M3',
      observedAt: `2026-08-09T12:00:0${index}.000Z`,
      imageUrl: `https://assets.ecstuning.com/product_library/${1000 + index}_x300.webp`
    }]
  };
}

test('accepts exactly seven fully reconciled BMW M3 section captures', () => {
  const documents = __test.BMW_M3_SECTIONS.map(fixture);
  const combined = __test.combinedCapture(documents);
  assert.equal(combined.kind, 'bmw-m3-all-sections-media-capture');
  assert.equal(combined.records.length, 7);
  assert.equal(combined.generatedAt, '2026-08-09T12:00:06.000Z');
});

test('rejects an incomplete category before any media request', () => {
  const document = fixture('engine');
  document.categories[0].expectedPages = 2;
  assert.throws(() => __test.validateBmwM3SectionCapture(document, 'engine'),
    /not fully reconciled/);
});

test('rejects non-official product media before any media request', () => {
  const document = fixture('exterior');
  document.records[0].imageUrl = 'https://example.test/product.webp';
  assert.throws(() => __test.validateBmwM3SectionCapture(document, 'exterior'),
    /not safe to materialize/);
});
