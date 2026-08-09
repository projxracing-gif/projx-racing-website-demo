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

console.log('materialize-remote-assets tests passed');
