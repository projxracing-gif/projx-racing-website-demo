import path from 'node:path';

const SEARCHABLE_SOURCE_EXTENSION = /\.(?:js|mjs|html|css|json|webmanifest)$/i;

export function isRemovedFeatureSearchableSource(file, repo) {
  const relative = path.relative(repo, file).replaceAll(path.sep, '/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)
    || !SEARCHABLE_SOURCE_EXTENSION.test(relative)
    || relative === 'scripts/validate.mjs'
    || relative.startsWith('api/data/tegiwa-catalog-pages/')
    || relative.startsWith('api/data/tegiwa-search-')
    || relative.startsWith('api/data/ecs-bmw-m3-reviewed/')) {
    return false;
  }
  return true;
}
