import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(repo, 'api', 'data', 'tegiwa-sitemap-manifest.json');
const checkedAt = process.argv[2] || new Date().toISOString().slice(0, 10);
const rootUrl = 'https://www.tegiwa.com/sitemap.xml';
const maximumSitemaps = 512;
const maximumBytes = 1_000_000;

if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedAt) || Number.isNaN(Date.parse(`${checkedAt}T00:00:00Z`))) {
  console.error('Usage: node scripts/build-tegiwa-sitemap-manifest.mjs [YYYY-MM-DD]');
  process.exit(1);
}

const response = await fetch(rootUrl, {
  method: 'GET',
  redirect: 'error',
  headers: {
    Accept: 'application/xml, text/xml;q=0.9',
    'User-Agent': 'Projx-Racing-Catalog-Manifest/1.0'
  }
});
if (!response.ok) throw new Error(`Official Tegiwa sitemap returned HTTP ${response.status}.`);

const xml = await response.text();
if (new TextEncoder().encode(xml).byteLength > maximumBytes) throw new Error('Official Tegiwa sitemap exceeded the safety limit.');

const urls = [];
const seen = new Set();
for (const match of xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)) {
  const decoded = match[1].replace(/&amp;/gi, '&').trim();
  let url;
  try {
    url = new URL(decoded);
  } catch {
    continue;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'www.tegiwa.com' || !/^\/sitemap_products[^/]*\.xml$/.test(url.pathname)) continue;
  url.hash = '';
  const normalized = url.toString();
  if (seen.has(normalized)) continue;
  seen.add(normalized);
  urls.push(normalized);
  if (urls.length > maximumSitemaps) throw new Error('Official Tegiwa sitemap count exceeded the safety limit.');
}

if (!urls.length) throw new Error('No official Tegiwa product sitemaps were found.');

const manifest = { version: 1, checkedAt, sitemapCount: urls.length, sitemaps: urls };
fs.mkdirSync(path.dirname(output), { recursive: true });
const temporary = `${output}.tmp`;
fs.writeFileSync(temporary, `${JSON.stringify(manifest)}\n`, 'utf8');
fs.renameSync(temporary, output);

console.log(`Public Tegiwa sitemap manifest written with ${urls.length} product sitemaps.`);
console.log(`Output: ${path.relative(repo, output)} (${fs.statSync(output).size} bytes).`);
