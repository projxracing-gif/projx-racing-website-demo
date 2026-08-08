import test from 'node:test';
import assert from 'node:assert/strict';
import { __test } from './materialize-page-assets.mjs';

test('validates official ECS media URLs', () => {
  assert.equal(__test.officialImageUrl('https://assets.ecstuning.com/product_library/1.webp'),
    'https://assets.ecstuning.com/product_library/1.webp');
  assert.equal(__test.officialImageUrl('http://assets.ecstuning.com/product_library/1.webp'), null);
  assert.equal(__test.officialImageUrl('https://example.com/product_library/1.webp'), null);
});

test('reads a bounded VP8X image header', () => {
  const image = Buffer.alloc(30);
  image.write('RIFF', 0, 'ascii');
  image.writeUInt32LE(22, 4);
  image.write('WEBP', 8, 'ascii');
  image.write('VP8X', 12, 'ascii');
  image.writeUInt32LE(10, 16);
  image[24] = 99;
  image[27] = 199;
  assert.deepEqual(__test.webpSize(image), { width: 100, height: 200 });
});

test('rejects a lossy WebP sync marker outside the frame header', () => {
  const image = Buffer.alloc(40);
  image.write('RIFF', 0, 'ascii');
  image.writeUInt32LE(32, 4);
  image.write('WEBP', 8, 'ascii');
  image.write('VP8 ', 12, 'ascii');
  image.writeUInt32LE(20, 16);
  image.set([0x9d, 0x01, 0x2a], 30);
  assert.equal(__test.webpSize(image), null);
});

test('requires the PNG IHDR chunk before trusting dimensions', () => {
  const image = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(image, 0);
  image.writeUInt32BE(13, 8);
  image.write('IHDR', 12, 'ascii');
  image.writeUInt32BE(100, 16);
  image.writeUInt32BE(200, 20);
  assert.deepEqual(__test.pngSize(image), { width: 100, height: 200 });
  image.write('IDAT', 12, 'ascii');
  assert.equal(__test.pngSize(image), null);
});
