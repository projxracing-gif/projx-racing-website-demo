import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BRAKING_CAPTURE_VEHICLES,
  combineGSeriesBrakingCaptures
} from './combine-g-series-braking-captures.mjs';

const observedAt = new Date(Date.now() - 60_000).toISOString();
const manifest = {
  schemaVersion: 1,
  supplier: 'ECS Tuning',
  kind: 'g-series-braking-scope-manifest',
  categories: {
    'fixture-pads': {
      name: 'Fixture Brake Pads',
      nameAr: '\u0641\u062d\u0645\u0627\u062a \u0641\u0631\u0627\u0645\u0644 \u0644\u0644\u0627\u062e\u062a\u0628\u0627\u0631',
      sourcePath: 'Braking/Pads/',
      slug: 'braking-fixture-pads'
    },
    'fixture-tools': {
      name: 'Fixture Brake Tools',
      nameAr: '\u0623\u062f\u0648\u0627\u062a \u0641\u0631\u0627\u0645\u0644 \u0644\u0644\u0627\u062e\u062a\u0628\u0627\u0631',
      sourcePath: 'Braking/Tools/',
      slug: 'braking-fixture-tools'
    }
  },
  counts: {
    'BMW G87 M2 S58 3.0L': { 'fixture-pads': 0, 'fixture-tools': 1 },
    'BMW G80 M3 Competition S58 3.0L': { 'fixture-pads': 17, 'fixture-tools': 0 },
    'BMW G82 M4 Competition S58 3.0L': { 'fixture-pads': 1, 'fixture-tools': 1 }
  }
};

const quarantinedManifest = structuredClone(manifest);
quarantinedManifest.categories['fixture-unverified'] = {
  name: 'Fixture Unverified Brake Parts',
  nameAr: '\u0623\u062c\u0632\u0627\u0621 \u0641\u0631\u0627\u0645\u0644 \u063a\u064a\u0631 \u0645\u062a\u062d\u0642\u0642\u0629 \u0644\u0644\u0627\u062e\u062a\u0628\u0627\u0631',
  sourcePath: 'Braking/Unverified/',
  slug: 'braking-fixture-unverified',
  catalogueDisposition: 'quarantined',
  excludeFromCustomerFacing: true,
  quarantineReason: 'Supplier taxonomy anomaly under test.'
};
for (const [vehicle, counts] of Object.entries(quarantinedManifest.counts)) {
  counts['fixture-unverified'] = vehicle === 'BMW G82 M4 Competition S58 3.0L' ? 1 : 0;
}

function expectedPageUrl(root, pageNumber) {
  return pageNumber === 1 ? root : `${root}${pageNumber}`;
}

function captureFor(vehicle, vehicleIndex, scopeManifest = manifest) {
  const categories = [];
  const records = [];
  Object.entries(scopeManifest.categories).forEach(([key, category], categoryIndex) => {
    const count = scopeManifest.counts[vehicle.name][key];
    const pages = count ? Math.ceil(count / 16) : 0;
    const root = new URL(category.sourcePath, vehicle.baseUrl).toString();
    const quarantine = category.excludeFromCustomerFacing === true ? {
      catalogueDisposition: 'quarantined',
      excludeFromCustomerFacing: true,
      quarantineReason: category.quarantineReason
    } : {};
    categories.push({
      key,
      name: category.name,
      count,
      pages,
      pageCounts: Array.from({ length: pages }, (_, pageIndex) => pageIndex === pages - 1
        ? ((count - 1) % 16) + 1
        : 16),
      pageUrls: Array.from({ length: pages }, (_, pageIndex) => expectedPageUrl(root, pageIndex + 1)),
      positionsContiguous: true,
      ...quarantine
    });
    for (let position = 1; position <= count; position += 1) {
      const digits = position === 1
        ? '4700001'
        : `49${vehicleIndex}${categoryIndex}${String(position).padStart(4, '0')}`;
      records.push({
        title: `Fixture ${digits}`,
        vehicle: vehicle.name,
        category: category.name,
        ecsPartNumber: digits,
        manufacturerPartNumber: digits === '4700001' ? 'SHARED-MPN' : `MPN-${digits}`,
        productUrl: digits === '4700001'
          ? 'https://www.ecstuning.com/b-fixture-parts/shared-brake-item/shared-brake/'
          : `https://www.ecstuning.com/b-fixture-parts/item-${digits}/fixture-${digits}/`,
        sourceUrl: expectedPageUrl(root, Math.ceil(position / 16)),
        relevancePosition: position,
        observedAt,
        ...quarantine
      });
    }
  });
  return {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    kind: `${vehicle.key}-braking-listing-capture`,
    generatedAt: observedAt,
    categories,
    records
  };
}

function fixtureCaptures(scopeManifest = manifest) {
  return Object.fromEntries(BRAKING_CAPTURE_VEHICLES.map((vehicle, index) => [
    vehicle.key,
    captureFor(vehicle, index, scopeManifest)
  ]));
}

test('strictly combines complete keyed Braking captures, including the Tools route', () => {
  const { combined, summary } = combineGSeriesBrakingCaptures(fixtureCaptures(), manifest);
  assert.equal(combined.schemaVersion, 1);
  assert.equal(combined.supplier, 'ECS Tuning');
  assert.equal(combined.kind, 'g-series-braking-listing-capture');
  assert.equal(combined.records.length, 20);
  assert.equal(summary.uniqueEcsProductCount, 17);
  assert.deepEqual(summary.vehicleCounts, { g80: 17, g82: 2, g87: 1 });
  assert.deepEqual(combined.vehicleCategories.map(entry => entry.categories.length), [1, 2, 1]);
  assert.equal(combined.vehicleCategories[1].categories[1].url,
    'https://www.ecstuning.com/BMW-G82-M4_Competition-S58_3.0L/Braking/Tools/');
  assert.equal(combined.scopeManifest.categories['fixture-tools'].sourcePath, 'Braking/Tools/');
  assert.equal(combined.scopeManifest.counts['BMW G80 M3 Competition S58 3.0L']['fixture-pads'], 17);
  assert.equal(combined.generatedAt, observedAt);
  assert.equal(combined.records.filter(record => record.ecsPartNumber === '4700001').length, 4);
});

test('preserves quarantined Braking audit rows while identifying the complete identity exclusion', () => {
  const { combined, summary } = combineGSeriesBrakingCaptures(
    fixtureCaptures(quarantinedManifest), quarantinedManifest
  );
  assert.equal(combined.records.length, 21);
  assert.equal(combined.scopeManifest.categories['fixture-unverified'].excludeFromCustomerFacing, true);
  assert.equal(combined.quarantinedCategories.length, 1);
  assert.equal(combined.quarantinedCategories[0].slug, 'braking-fixture-unverified');
  assert.equal(summary.quarantinedPlacementCount, 1);
  assert.equal(summary.quarantinedProductCount, 1);
  assert.equal(summary.customerFacingRawRecordCount, 16);

  const missingRecordQuarantine = fixtureCaptures(quarantinedManifest);
  const record = missingRecordQuarantine.g82.records
    .find(item => item.category === 'Fixture Unverified Brake Parts');
  delete record.excludeFromCustomerFacing;
  assert.throws(() => combineGSeriesBrakingCaptures(missingRecordQuarantine, quarantinedManifest),
    /invalid or unreconciled/);
});

test('rejects incomplete, misordered or malformed Braking category manifests', () => {
  const wrongSupplier = fixtureCaptures();
  wrongSupplier.g80.supplier = 'Other';
  assert.throws(() => combineGSeriesBrakingCaptures(wrongSupplier, manifest), /capture is incomplete or invalid/);

  const missingCategory = fixtureCaptures();
  missingCategory.g82.categories.pop();
  assert.throws(() => combineGSeriesBrakingCaptures(missingCategory, manifest), /category manifest is incomplete/);

  const wrongPagination = fixtureCaptures();
  wrongPagination.g80.categories[0].pageCounts = [15, 2];
  assert.throws(() => combineGSeriesBrakingCaptures(wrongPagination, manifest), /category manifest is invalid/);
});

test('recomputes Braking positions and enforces exact full vehicle-relative category routes', () => {
  const wrongToolsRoute = fixtureCaptures();
  const toolsRecord = wrongToolsRoute.g82.records.find(record => record.category === 'Fixture Brake Tools');
  toolsRecord.sourceUrl = 'https://www.ecstuning.com/BMW-G82-M4_Competition-S58_3.0L/Tools/Braking/';
  assert.throws(() => combineGSeriesBrakingCaptures(wrongToolsRoute, manifest), /invalid or unreconciled/);

  const lyingPositionsFlag = fixtureCaptures();
  const lastRecord = lyingPositionsFlag.g80.records.at(-1);
  lastRecord.relevancePosition = 16;
  lastRecord.sourceUrl = 'https://www.ecstuning.com/BMW-G80-M3_Competition-S58_3.0L/Braking/Pads/';
  assert.throws(() => combineGSeriesBrakingCaptures(lyingPositionsFlag, manifest), /positions do not reconcile/);
});

test('rejects conflicting Braking supplier identity and non-namespaced manifest slugs', () => {
  const identityConflict = fixtureCaptures();
  identityConflict.g82.records[0].manufacturerPartNumber = 'CONFLICTING-MPN';
  assert.throws(() => combineGSeriesBrakingCaptures(identityConflict, manifest), /Conflicting supplier identity/);

  const unsafeManifest = structuredClone(manifest);
  unsafeManifest.categories['fixture-tools'].slug = 'tools';
  assert.throws(() => combineGSeriesBrakingCaptures(fixtureCaptures(), unsafeManifest),
    /category manifest is invalid/);
});
