import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDirectory = path.join(repo, 'api', 'data');
const manifestPath = path.join(dataDirectory, 'tegiwa-sitemap-manifest.json');
const outputDirectory = path.join(dataDirectory, 'tegiwa-catalog-pages');
const summaryPath = path.join(dataDirectory, 'tegiwa-catalog-summary.json');
const [inputArgument, generatedAtArgument] = process.argv.slice(2);

if (!inputArgument) {
  console.error('Usage: node scripts/build-tegiwa-catalog-snapshot.mjs <local-product-sitemap-directory> [generated-at-ISO]');
  process.exit(1);
}

const inputDirectory = path.resolve(inputArgument);
const maximumSitemapBytes = 12_000_000;
const maximumProductsPerShard = 50_000;
const maximumSitemaps = 512;
const maximumProductHandleLength = 255;
const officialOrigin = 'https://www.tegiwa.com';
const officialRootSitemap = `${officialOrigin}/sitemap.xml`;
const imageHosts = new Set(['cdn.shopify.com', 'www.tegiwa.com', 'tegiwa.com']);

if (!fs.existsSync(inputDirectory) || !fs.statSync(inputDirectory).isDirectory()) {
  throw new Error('The local Tegiwa product-sitemap directory was not found.');
}
if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
  throw new Error('The validated Tegiwa product-sitemap manifest was not found.');
}

function validGeneratedAt(value) {
  const text = String(value || '');
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === text;
}

function decodeEntities(value) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"'
  };
  return String(value ?? '').replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi, (match, entity) => {
    const lowered = entity.toLowerCase();
    if (lowered[0] !== '#') return named[lowered] ?? '';
    const hexadecimal = lowered.startsWith('#x');
    const codePoint = Number.parseInt(lowered.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return '';
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return '';
    }
  });
}

function cleanText(value, limit) {
  const normalized = decodeEntities(value)
    .normalize('NFKC')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized || normalized.length > limit) return null;
  return normalized;
}

function xmlValues(xml, tagName, limit) {
  const escaped = tagName.replace(':', '\\:');
  const pattern = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}\\s*>`, 'gi');
  const values = [];
  let match;
  while (values.length < limit && (match = pattern.exec(xml))) values.push(match[1]);
  return values;
}

function firstXmlValue(xml, tagName) {
  return xmlValues(xml, tagName, 1)[0] ?? '';
}

function validatedManifest() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.sitemaps)) {
    throw new Error('The Tegiwa product-sitemap manifest has an unsupported format.');
  }
  if (manifest.sitemaps.length < 1 || manifest.sitemaps.length > maximumSitemaps) {
    throw new Error('The Tegiwa product-sitemap manifest has an unsafe shard count.');
  }
  if (manifest.sitemapCount !== manifest.sitemaps.length) {
    throw new Error('The Tegiwa product-sitemap manifest count does not match its URL list.');
  }

  const seen = new Set();
  const sitemaps = manifest.sitemaps.map((value, index) => {
    let url;
    try {
      url = new URL(String(value));
    } catch {
      throw new Error(`Manifest sitemap ${index + 1} is not a valid URL.`);
    }
    if (
      url.protocol !== 'https:'
      || url.hostname !== 'www.tegiwa.com'
      || url.username
      || url.password
      || url.hash
      || !/^\/sitemap_products_\d+\.xml$/.test(url.pathname)
    ) {
      throw new Error(`Manifest sitemap ${index + 1} is not an allowed official Tegiwa product sitemap.`);
    }
    const normalized = url.toString();
    if (seen.has(normalized)) throw new Error(`Manifest sitemap ${index + 1} is duplicated.`);
    seen.add(normalized);
    return normalized;
  });

  return { ...manifest, sitemaps };
}

function productHandle(value, shardNumber) {
  let url;
  try {
    url = new URL(cleanText(value, 1_000) || '');
  } catch {
    throw new Error(`Shard ${shardNumber} contains an invalid product URL.`);
  }
  const match = url.pathname.match(/^\/products\/([a-z0-9]+(?:[-_][a-z0-9]+)*)\/?$/);
  if (
    url.protocol !== 'https:'
    || url.hostname !== 'www.tegiwa.com'
    || url.username
    || url.password
    || url.search
    || url.hash
    || !match
  ) {
    throw new Error(`Shard ${shardNumber} contains a product URL outside the official allowlist.`);
  }
  if (match[1].length > maximumProductHandleLength) {
    throw new Error(`Shard ${shardNumber} contains a product handle longer than ${maximumProductHandleLength} characters.`);
  }
  return match[1];
}

function titleFromHandle(handle) {
  return handle
    .split(/[-_]/)
    .filter(Boolean)
    .map(part => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function productImage(value, shardNumber, handle) {
  const cleaned = cleanText(value, 2_000);
  if (!cleaned) return '';
  let url;
  try {
    url = new URL(cleaned);
  } catch {
    throw new Error(`Shard ${shardNumber} contains an invalid image URL for ${handle}.`);
  }
  if (
    url.protocol !== 'https:'
    || !imageHosts.has(url.hostname)
    || url.username
    || url.password
    || url.hash
  ) {
    throw new Error(`Shard ${shardNumber} contains an image URL outside the approved allowlist for ${handle}.`);
  }
  return url.toString();
}

function inputFileForShard(index, sitemapUrl) {
  const sequence = String(index + 1).padStart(3, '0');
  const sitemapName = path.basename(new URL(sitemapUrl).pathname);
  const candidates = [
    path.join(inputDirectory, `sitemap-${sequence}.xml`),
    path.join(inputDirectory, sitemapName)
  ];
  const file = candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!file) throw new Error(`Local product sitemap ${index + 1} was not found.`);
  const size = fs.statSync(file).size;
  if (size < 1 || size > maximumSitemapBytes) {
    throw new Error(`Local product sitemap ${index + 1} exceeded the allowed size.`);
  }
  return file;
}

function parseShard(file, shardNumber, globalHandles) {
  const xml = fs.readFileSync(file, 'utf8');
  const entries = xmlValues(xml, 'url', maximumProductsPerShard + 2);
  if (!entries.length || entries.length > maximumProductsPerShard + 1) {
    throw new Error(`Shard ${shardNumber} has an invalid product-entry count.`);
  }

  const products = [];
  for (const entry of entries) {
    const rawLocation = firstXmlValue(entry, 'loc');
    const location = cleanText(rawLocation, 1_000);
    if (shardNumber === 1 && location === `${officialOrigin}/`) continue;
    const handle = productHandle(rawLocation, shardNumber);
    if (globalHandles.has(handle)) throw new Error(`Duplicate Tegiwa product handle detected: ${handle}`);

    const title = cleanText(firstXmlValue(entry, 'image:title'), 300)
      || cleanText(firstXmlValue(entry, 'image:caption'), 300)
      || cleanText(titleFromHandle(handle), 300);
    if (!title) throw new Error(`Shard ${shardNumber} contains an invalid title for ${handle}.`);

    const imageUrl = productImage(firstXmlValue(entry, 'image:loc'), shardNumber, handle);
    globalHandles.add(handle);
    products.push([handle, title, imageUrl]);
  }

  if (!products.length) throw new Error(`Shard ${shardNumber} did not contain any valid products.`);
  return products;
}

function safeRemove(directory) {
  if (!directory.startsWith(`${dataDirectory}${path.sep}`)) {
    throw new Error('Refused to remove a catalog path outside api/data.');
  }
  fs.rmSync(directory, { recursive: true, force: true });
}

const manifest = validatedManifest();
const generatedAt = generatedAtArgument || new Date().toISOString();
if (!validGeneratedAt(generatedAt)) {
  throw new Error('generated-at must be a canonical ISO timestamp, for example 2026-08-03T20:00:00.000Z.');
}

fs.mkdirSync(dataDirectory, { recursive: true });
const runToken = `${process.pid}-${Date.now()}`;
const stagingDirectory = path.join(dataDirectory, `.tegiwa-catalog-pages.tmp-${runToken}`);
const backupDirectory = path.join(dataDirectory, `.tegiwa-catalog-pages.backup-${runToken}`);
const temporarySummary = path.join(dataDirectory, `.tegiwa-catalog-summary.tmp-${runToken}.json`);
const backupSummary = path.join(dataDirectory, `.tegiwa-catalog-summary.backup-${runToken}.json`);
const globalHandles = new Set();
const shardProductCounts = [];
let productCount = 0;
let imageCount = 0;

try {
  fs.mkdirSync(stagingDirectory);
  for (let index = 0; index < manifest.sitemaps.length; index += 1) {
    const input = inputFileForShard(index, manifest.sitemaps[index]);
    const products = parseShard(input, index + 1, globalHandles);
    shardProductCounts.push(products.length);
    productCount += products.length;
    imageCount += products.filter(product => Boolean(product[2])).length;
    const filename = `${String(index).padStart(3, '0')}.json`;
    const temporaryPage = path.join(stagingDirectory, `${filename}.tmp`);
    const finalPage = path.join(stagingDirectory, filename);
    fs.writeFileSync(temporaryPage, `${JSON.stringify(products)}\n`, 'utf8');
    fs.renameSync(temporaryPage, finalPage);
  }

  const summary = {
    version: 1,
    generatedAt,
    shardCount: manifest.sitemaps.length,
    shardProductCounts,
    productCount,
    imageCount,
    uniqueHandleCount: globalHandles.size,
    source: officialRootSitemap
  };
  fs.writeFileSync(temporarySummary, `${JSON.stringify(summary)}\n`, 'utf8');

  let pagesBackedUp = false;
  let summaryBackedUp = false;
  try {
    if (fs.existsSync(outputDirectory)) {
      fs.renameSync(outputDirectory, backupDirectory);
      pagesBackedUp = true;
    }
    if (fs.existsSync(summaryPath)) {
      fs.renameSync(summaryPath, backupSummary);
      summaryBackedUp = true;
    }
    fs.renameSync(stagingDirectory, outputDirectory);
    fs.renameSync(temporarySummary, summaryPath);
  } catch (error) {
    if (fs.existsSync(outputDirectory)) safeRemove(outputDirectory);
    if (fs.existsSync(summaryPath)) fs.rmSync(summaryPath, { force: true });
    if (pagesBackedUp && fs.existsSync(backupDirectory)) fs.renameSync(backupDirectory, outputDirectory);
    if (summaryBackedUp && fs.existsSync(backupSummary)) fs.renameSync(backupSummary, summaryPath);
    throw error;
  }

  if (fs.existsSync(backupDirectory)) safeRemove(backupDirectory);
  if (fs.existsSync(backupSummary)) fs.rmSync(backupSummary, { force: true });

  const bytes = fs.readdirSync(outputDirectory)
    .filter(name => /^\d{3}\.json$/.test(name))
    .reduce((total, name) => total + fs.statSync(path.join(outputDirectory, name)).size, 0);
  console.log(`Public Tegiwa catalog snapshot written with ${productCount} unique products across ${manifest.sitemaps.length} shards.`);
  console.log(`Included ${imageCount} allowlisted product images; rejected zero duplicate handles.`);
  console.log(`Pages: ${path.relative(repo, outputDirectory)} (${bytes} bytes).`);
  console.log(`Summary: ${path.relative(repo, summaryPath)} (${fs.statSync(summaryPath).size} bytes).`);
} finally {
  if (fs.existsSync(stagingDirectory)) safeRemove(stagingDirectory);
  if (fs.existsSync(temporarySummary)) fs.rmSync(temporarySummary, { force: true });
  if (fs.existsSync(backupDirectory) && !fs.existsSync(outputDirectory)) fs.renameSync(backupDirectory, outputDirectory);
  if (fs.existsSync(backupSummary) && !fs.existsSync(summaryPath)) fs.renameSync(backupSummary, summaryPath);
}
