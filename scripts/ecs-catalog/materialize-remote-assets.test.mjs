import assert from 'node:assert/strict';
import path from 'node:path';
import { __test } from './materialize-remote-assets.mjs';

assert.equal(
  __test.officialImageUrl('https://assets.ecstuning.com/product_library/123_x300.webp'),
  'https://assets.ecstuning.com/product_library/123_x300.webp'
);
assert.equal(__test.officialImageUrl('http://assets.ecstuning.com/product_library/123_x300.webp'), null);
assert.equal(__test.officialImageUrl('https://assets.ecstuning.com.evil.test/product_library/123_x300.webp'), null);
assert.equal(__test.officialImageUrl('https://assets.ecstuning.com/product_library/123_x300.webp?token=secret'), null);

const parent = path.resolve('assets', 'products', 'ecs');
assert.equal(__test.inside(parent, path.join(parent, 'g-series-drivetrain', 'image.webp')), true);
assert.equal(__test.inside(parent, path.resolve(parent, '..', '..', 'outside.webp')), false);

const customerFacing = __test.customerFacingRecords([
  { ecsPartNumber: '2019435', imageUrl: 'https://assets.ecstuning.com/product_library/manual.webp' },
  {
    ecsPartNumber: 'ES#2019435', imageUrl: 'https://assets.ecstuning.com/product_library/pdk.webp',
    catalogueDisposition: 'quarantined', excludeFromCustomerFacing: true
  },
  { ecsPartNumber: '602', imageUrl: 'https://assets.ecstuning.com/product_library/brake-fluid.webp' }
]);
assert.deepEqual([...customerFacing.quarantinedIdentities], ['2019435']);
assert.deepEqual(customerFacing.records.map(record => __test.ecsIdentity(record)), ['602']);
assert.throws(() => __test.customerFacingRecords([{ imageUrl: 'https://assets.ecstuning.com/image.webp' }]),
  /valid ECS identity/);

const mediaPlan = __test.buildMediaPlan([
  {
    ecsPartNumber: '100',
    imageUrl: 'https://assets.ecstuning.com/product_library/primary.webp',
    imageFallbackUrl: 'https://assets.ecstuning.com/product_library/fallback.jpg'
  },
  {
    ecsPartNumber: '101',
    imageUrl: 'https://assets.ecstuning.com/product_library/new.webp',
    imageFallbackUrl: 'https://assets.ecstuning.com/product_library/new.jpg'
  }
], [{
  sourceUrl: 'https://assets.ecstuning.com/product_library/fallback.jpg',
  localPath: 'assets/products/ecs/g-series/fallback.jpg',
  width: 300,
  height: 225,
  contentType: 'image/jpeg',
  sha256: 'a'.repeat(64)
}]);
assert.equal(mediaPlan.requestedImages.length, 1);
assert.equal(mediaPlan.requestedImages[0].sourceUrl,
  'https://assets.ecstuning.com/product_library/new.webp');
assert.equal(mediaPlan.reusedImages.length, 1);
assert.equal(mediaPlan.reusedImages[0].sourceUrl,
  'https://assets.ecstuning.com/product_library/primary.webp');
assert.equal(mediaPlan.reusedImages[0].downloadedFromUrl,
  'https://assets.ecstuning.com/product_library/fallback.jpg');

const byteBudget = __test.createByteBudget(100);
byteBudget.reserve(60);
assert.equal(byteBudget.used, 60);
assert.throws(() => byteBudget.reserve(41), /budget exceeded/);
assert.equal(byteBudget.used, 60);
assert.throws(() => byteBudget.reserve(0), /Invalid ECS media byte count/);

console.log('materialize-remote-assets tests passed');
