import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { REVIEWED_ECS_PRODUCTS } from '../../server/ecs-reviewed-catalog.js';
import {
  createConfiguredEcsDiscoveryCatalogueProvider,
  createEcsDiscoveryCatalogueProvider,
  ECS_DISCOVERY_CURRENT_PATH,
  EcsDiscoveryError,
  signEcsDiscoveryManifest
} from '../../server/ecs-discovery-catalog.js';

const SECRET = 'ecs-discovery-test-secret-'.repeat(3);
const HOST = 'projx-unit-test.public.blob.vercel-storage.com';
const CURRENT_URL = `https://${HOST}/${ECS_DISCOVERY_CURRENT_PATH}`;
const NOW = Date.parse('2026-08-06T08:00:00.000Z');
const URL_A = 'https://www.ecstuning.com/b-test-parts/group/alpha-item/';
const URL_B = 'https://www.ecstuning.com/b-test-parts/group/bravo-item/';
const URL_C = 'https://www.ecstuning.com/b-other-parts/group/charlie-item/';
const REVIEWED_URL = REVIEWED_ECS_PRODUCTS[0].originalUrl;

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function releaseFixture({
  releaseId = '20260806T075500000Z-a1b2c3d4',
  groups = [[REVIEWED_URL, URL_A], [URL_B, URL_C]],
  publishedAt = '2026-08-06T07:55:00.000Z',
  expiresAt = '2026-08-06T10:00:00.000Z'
} = {}) {
  const bodies = new Map();
  const shards = groups.map((entries, offset) => {
    const sequence = offset + 1;
    const body = Buffer.from(`${JSON.stringify({
      schemaVersion: 1,
      supplier: 'ECS Tuning',
      kind: 'ecs-product-url-manifest',
      sequence,
      urlCount: entries.length,
      entries
    })}\n`);
    const url = `https://${HOST}/projx-racing/ecs-discovery/releases/${releaseId}/ecs-product-urls-${String(sequence).padStart(8, '0')}-immutable.json`;
    bodies.set(url, body);
    return { sequence, url, urlCount: entries.length, bytes: body.length, sha256: digest(body) };
  });
  const unsigned = {
    version: 1,
    vendor: 'ECS Tuning',
    kind: 'ecs-url-discovery-current',
    releaseId,
    publishedAt,
    expiresAt,
    counts: { urlCount: groups.flat().length, shardCount: shards.length },
    shards
  };
  const manifest = { ...unsigned, signature: signEcsDiscoveryManifest(unsigned, SECRET) };
  bodies.set(CURRENT_URL, Buffer.from(JSON.stringify(manifest)));
  return { bodies, manifest, shards };
}

function fetchFixture(initial, { headers = new Map(), hanging = false } = {}) {
  let bodies = initial;
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (hanging) return new Promise(() => {});
    const body = bodies.get(url);
    if (!body) return new Response('missing', { status: 404, headers: { 'content-type': 'text/plain' } });
    const extraHeaders = headers.get(url) || {};
    return new Response(Buffer.from(body), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-length': String(body.length),
        ...extraHeaders
      }
    });
  };
  return {
    calls,
    fetchImpl,
    replace(next) { bodies = next; }
  };
}

async function rejectsCode(action, code) {
  await assert.rejects(action, error => error instanceof EcsDiscoveryError && error.code === code);
}

test('serves only truthful discovery records with release-pinned cursor pagination', async () => {
  const fixture = releaseFixture();
  const network = fetchFixture(fixture.bodies);
  const provider = createEcsDiscoveryCatalogueProvider({
    currentUrl: CURRENT_URL,
    manifestSecret: SECRET,
    fetchImpl: network.fetchImpl,
    now: () => NOW
  });

  const first = await provider.list({ limit: 1 });
  assert.equal(first.releaseId, fixture.manifest.releaseId);
  assert.equal(first.count, 1);
  assert.equal(first.items[0].sourceUrl, URL_A);
  assert.match(first.items[0].handle, /^ecs-discovery-[a-f0-9]{64}$/);
  assert.equal(first.items[0].key, `sha256:${first.items[0].sha256Key}`);
  assert.deepEqual(first.items[0].supplier, { slug: 'ecs', name: 'ECS Tuning' });
  assert.equal(first.items[0].dataStatus, 'url_discovered');
  for (const field of [
    'title', 'sku', 'mpn', 'brand', 'category', 'subcategory', 'price', 'stock',
    'image', 'images', 'fitment', 'fitments'
  ]) assert.equal(first.items[0][field], null, `${field} must not be inferred`);
  assert.equal(first.items[0].pricing, 'request_price');
  assert.equal(first.items[0].availability, 'check');
  assert.equal(first.items[0].requestDetailsOnly, true);
  assert.equal(first.items[0].quoteOnly, true);
  assert.ok(first.nextCursor);

  const second = await provider.list({ cursor: first.nextCursor, limit: 2 });
  assert.deepEqual(second.items.map(item => item.sourceUrl), [URL_B, URL_C]);
  assert.equal(second.nextCursor, null);
  assert.equal(second.meta.discoveryOnly, true);
  assert.equal(second.meta.discoveredUrlCount, 4);
  assert.equal(second.meta.shardCount, 2);
  assert.equal(network.calls.filter(call => call.url === CURRENT_URL).length, 1);
});

test('exact lookup works while every reviewed ECS URL is suppressed before network access', async () => {
  const fixture = releaseFixture();
  const network = fetchFixture(fixture.bodies);
  const provider = createEcsDiscoveryCatalogueProvider({
    currentUrl: CURRENT_URL,
    manifestSecret: SECRET,
    fetchImpl: network.fetchImpl,
    now: () => NOW
  });

  assert.equal(await provider.getByCanonicalUrl(REVIEWED_URL), null);
  assert.equal(network.calls.length, 0);
  const found = await provider.getByCanonicalUrl(URL_C);
  assert.equal(found.sourceUrl, URL_C);
  assert.equal(await provider.getByCanonicalUrl('https://www.ecstuning.com/b-other-parts/group/missing-item/'), null);
  await rejectsCode(
    () => provider.getByCanonicalUrl(`${URL_C}?campaign=test`),
    'invalid_ecs_product_url'
  );
});

test('configured factory fails closed without both server-only environment values', () => {
  assert.throws(
    () => createConfiguredEcsDiscoveryCatalogueProvider({ env: {} }),
    error => error instanceof EcsDiscoveryError && error.code === 'invalid_ecs_discovery_configuration'
  );
  const fixture = releaseFixture();
  const network = fetchFixture(fixture.bodies);
  assert.doesNotThrow(() => createConfiguredEcsDiscoveryCatalogueProvider({
    env: {
      ECS_DISCOVERY_CURRENT_URL: CURRENT_URL,
      ECS_DISCOVERY_MANIFEST_SECRET: SECRET
    },
    fetchImpl: network.fetchImpl,
    now: () => NOW
  }));
});

test('manifest HMAC tampering and stale manifests fail closed with no shard reads', async () => {
  const tampered = releaseFixture();
  const tamperedManifest = JSON.parse(tampered.bodies.get(CURRENT_URL).toString('utf8'));
  tamperedManifest.counts.urlCount += 1;
  tamperedManifest.shards[0].urlCount += 1;
  tampered.bodies.set(CURRENT_URL, Buffer.from(JSON.stringify(tamperedManifest)));
  const tamperedNetwork = fetchFixture(tampered.bodies);
  const tamperedProvider = createEcsDiscoveryCatalogueProvider({
    currentUrl: CURRENT_URL, manifestSecret: SECRET, fetchImpl: tamperedNetwork.fetchImpl, now: () => NOW
  });
  await rejectsCode(() => tamperedProvider.list(), 'invalid_ecs_discovery_manifest');
  assert.deepEqual(tamperedNetwork.calls.map(call => call.url), [CURRENT_URL]);

  const stale = releaseFixture({ expiresAt: '2026-08-06T07:59:59.999Z' });
  const staleNetwork = fetchFixture(stale.bodies);
  const staleProvider = createEcsDiscoveryCatalogueProvider({
    currentUrl: CURRENT_URL, manifestSecret: SECRET, fetchImpl: staleNetwork.fetchImpl, now: () => NOW
  });
  await rejectsCode(() => staleProvider.list(), 'stale_ecs_discovery_manifest');
  assert.deepEqual(staleNetwork.calls.map(call => call.url), [CURRENT_URL]);
});

test('immutable shard checksum tampering fails closed', async () => {
  const fixture = releaseFixture({ groups: [[URL_A]] });
  const shardUrl = fixture.shards[0].url;
  const original = fixture.bodies.get(shardUrl).toString('utf8');
  const tampered = original.replace('alpha-item', 'bravo-item');
  assert.equal(Buffer.byteLength(tampered), Buffer.byteLength(original));
  fixture.bodies.set(shardUrl, Buffer.from(tampered));
  const network = fetchFixture(fixture.bodies);
  const provider = createEcsDiscoveryCatalogueProvider({
    currentUrl: CURRENT_URL, manifestSecret: SECRET, fetchImpl: network.fetchImpl, now: () => NOW
  });
  await rejectsCode(() => provider.list(), 'invalid_ecs_discovery_shard');
});

test('announced oversized responses and request timeouts fail closed', async () => {
  const fixture = releaseFixture({ groups: [[URL_A]] });
  const oversizedHeaders = new Map([[CURRENT_URL, { 'content-length': String(300 * 1_024) }]]);
  const oversizedNetwork = fetchFixture(fixture.bodies, { headers: oversizedHeaders });
  const oversizedProvider = createEcsDiscoveryCatalogueProvider({
    currentUrl: CURRENT_URL,
    manifestSecret: SECRET,
    fetchImpl: oversizedNetwork.fetchImpl,
    now: () => NOW
  });
  await rejectsCode(() => oversizedProvider.list(), 'invalid_ecs_discovery_manifest');

  const timeoutNetwork = fetchFixture(fixture.bodies, { hanging: true });
  const timeoutProvider = createEcsDiscoveryCatalogueProvider({
    currentUrl: CURRENT_URL,
    manifestSecret: SECRET,
    fetchImpl: timeoutNetwork.fetchImpl,
    now: () => NOW,
    timeoutMs: 5
  });
  await rejectsCode(() => timeoutProvider.list(), 'ecs_discovery_timeout');
});

test('cursor tampering and a changed current release are rejected', async () => {
  let clock = NOW;
  const firstRelease = releaseFixture({ groups: [[URL_A, URL_B]] });
  const network = fetchFixture(firstRelease.bodies);
  const provider = createEcsDiscoveryCatalogueProvider({
    currentUrl: CURRENT_URL,
    manifestSecret: SECRET,
    fetchImpl: network.fetchImpl,
    now: () => clock,
    currentCacheMs: 0
  });
  const first = await provider.list({ limit: 1 });
  const finalCharacter = first.nextCursor.at(-1);
  const tamperedCursor = `${first.nextCursor.slice(0, -1)}${finalCharacter === '0' ? '1' : '0'}`;
  await rejectsCode(() => provider.list({ cursor: tamperedCursor }), 'invalid_ecs_discovery_cursor');

  const secondRelease = releaseFixture({
    releaseId: '20260806T080001000Z-b2c3d4e5',
    groups: [[URL_A, URL_B]],
    publishedAt: '2026-08-06T08:00:01.000Z',
    expiresAt: '2026-08-06T10:00:00.000Z'
  });
  network.replace(secondRelease.bodies);
  clock += 1_001;
  await rejectsCode(() => provider.list({ cursor: first.nextCursor }), 'ecs_discovery_release_changed');
});
