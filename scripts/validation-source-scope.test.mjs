import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { isRemovedFeatureSearchableSource } from './validation-source-scope.mjs';

const repo = path.resolve('validation-scope-fixture');
const removedFeature = new RegExp(['build', 'your', 'engine'].join(' '), 'i');

test('reviewed ECS shard copy is exempt while normal site JSON remains searchable', () => {
  const reviewedShard = path.join(repo, 'api', 'data', 'ecs-bmw-m3-reviewed', 'shard-00005.json');
  const siteJson = path.join(repo, 'assets', 'site-copy.json');
  const phrase = ['Build', 'your', 'engine', 'the right way!'].join(' ');

  assert.equal(isRemovedFeatureSearchableSource(reviewedShard, repo), false);
  assert.equal(isRemovedFeatureSearchableSource(siteJson, repo), true);
  assert.doesNotMatch([
    { file: reviewedShard, text: phrase },
  ].filter(item => isRemovedFeatureSearchableSource(item.file, repo)).map(item => item.text).join('\n'), removedFeature);
  assert.match([
    { file: reviewedShard, text: phrase },
    { file: siteJson, text: phrase },
  ].filter(item => isRemovedFeatureSearchableSource(item.file, repo)).map(item => item.text).join('\n'), removedFeature);
});

test('existing generated-catalogue exclusions and ordinary source coverage are preserved', () => {
  assert.equal(isRemovedFeatureSearchableSource(
    path.join(repo, 'api', 'data', 'tegiwa-catalog-pages', '001.json'), repo,
  ), false);
  assert.equal(isRemovedFeatureSearchableSource(
    path.join(repo, 'api', 'data', 'tegiwa-search-terms.json'), repo,
  ), false);
  assert.equal(isRemovedFeatureSearchableSource(path.join(repo, 'scripts', 'validate.mjs'), repo), false);
  assert.equal(isRemovedFeatureSearchableSource(path.join(repo, 'assets', 'app.js'), repo), true);
  assert.equal(isRemovedFeatureSearchableSource(path.join(repo, 'template.html'), repo), true);
});
