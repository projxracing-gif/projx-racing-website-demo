import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'assets/app.js', 'assets/data.js', 'assets/ecs-products.js', 'assets/tegiwa-vehicle-directory.js', 'assets/site-config.js',
  'assets/i18n/en.js', 'assets/i18n/ar.js', 'api/enquiry.js', 'api/tegiwa-catalog.js',
  'scripts/build.mjs', 'scripts/validate.mjs', 'scripts/serve.mjs',
  'scripts/test-api.mjs', 'scripts/test-tegiwa-catalog-api.mjs', 'scripts/lint.mjs',
  'scripts/catalog-import.mjs', 'scripts/build-tegiwa-stock-index.mjs',
  'scripts/build-tegiwa-sitemap-manifest.mjs', 'scripts/build-tegiwa-catalog-snapshot.mjs',
  'scripts/build-tegiwa-search-index.mjs',
  'scripts/scrape-tegiwa-vehicle-directory.mjs', 'scripts/validate-tegiwa-vehicle-directory.mjs', 'sw.js'
];

const failures = [];
for (const relative of files) {
  const full = path.join(repo, relative);
  if (!fs.existsSync(full)) {
    failures.push(`${relative}: missing`);
    continue;
  }
  const result = spawnSync(process.execPath, ['--check', full], { encoding: 'utf8' });
  if (result.status !== 0) failures.push(`${relative}: ${result.stderr || result.stdout}`);
}

const source = files.filter(file => fs.existsSync(path.join(repo, file))).map(file => fs.readFileSync(path.join(repo, file), 'utf8')).join('\n');
for (const [name, pattern] of [
  ['debugger statement', /\bdebugger\s*;/],
  ['hard-coded secret pattern', /(?:RESEND_API_KEY|API_KEY|SECRET|TOKEN)\s*[:=]\s*["'][A-Za-z0-9_\-]{20,}["']/],
  ['unsafe eval call', /\beval\s*\(/]
]) {
  if (pattern.test(source)) failures.push(`source: ${name} detected`);
}

if (failures.length) {
  failures.forEach(failure => console.error(`FAILED: ${failure}`));
  process.exit(1);
}
console.log(`Lint passed: ${files.length} JavaScript modules checked; no embedded secrets, debugger statements or eval calls found.`);
