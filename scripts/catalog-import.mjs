import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inputArgument = process.argv[2];

if (!inputArgument) {
  console.error('Usage: npm run catalog:prepare -- private-imports/<curated-candidates.json>');
  process.exit(1);
}

const privateRoot = path.join(repo, 'private-imports');
const input = path.resolve(repo, inputArgument);
const relativeInput = path.relative(privateRoot, input);
if (relativeInput.startsWith('..') || path.isAbsolute(relativeInput)) throw new Error('Catalogue candidates must remain inside ignored private-imports/.');
if (!fs.existsSync(input) || !fs.statSync(input).isFile()) throw new Error(`Candidate file not found: ${inputArgument}`);
if (fs.statSync(input).size > 20_000_000) throw new Error('Candidate file is too large. Curate a small review batch; do not pass a raw supplier feed.');

const parsed = JSON.parse(fs.readFileSync(input, 'utf8'));
const candidates = Array.isArray(parsed) ? parsed : parsed.products;
if (!Array.isArray(candidates)) throw new Error('Candidate input must be an array or an object with a products array.');
if (candidates.length > 250) throw new Error('A review batch may contain at most 250 products. Curate the feed before validation.');

const forbiddenKey = /(?:trade|wholesale|dealer.?cost|password|secret|token|credential|api.?key)/i;
const slugs = new Set();
const identities = new Set();
const failures = [];
const fail = (index, message) => failures.push(`Product ${index + 1}: ${message}`);

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function localImageValid(image) {
  if (!image || image.imageRole !== 'exact-product' || image.imageRightsConfirmed !== true) return false;
  if (!/^assets\/(?:products|catalog)\/[A-Za-z0-9_./-]+\.(?:avif|jpe?g|png|webp)$/i.test(String(image.src || ''))) return false;
  const full = path.join(repo, image.src);
  return fs.existsSync(full) && fs.statSync(full).isFile() && Number(image.width) > 0 && Number(image.height) > 0 && String(image.alt || '').trim().length >= 8;
}

const sanitized = candidates.map((candidate, index) => {
  for (const key of Object.keys(candidate || {})) if (forbiddenKey.test(key)) fail(index, `forbidden private field "${key}" is present.`);
  const slug = String(candidate?.slug || '').trim();
  const sku = String(candidate?.sku || candidate?.mpn || '').trim();
  const identity = `${String(candidate?.brand || '').toLowerCase()}::${sku.toLowerCase()}`;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) fail(index, 'slug must be stable lowercase kebab-case.');
  if (slugs.has(slug)) fail(index, `duplicate slug "${slug}".`);
  if (identities.has(identity)) fail(index, `duplicate brand + SKU/MPN identity "${identity}".`);
  slugs.add(slug);
  identities.add(identity);
  for (const field of ['title', 'titleAr', 'summary', 'summaryAr', 'brand', 'category', 'status', 'statusAr', 'sourceUrl']) {
    if (!String(candidate?.[field] || '').trim()) fail(index, `${field} is required.`);
  }
  if (!/^https:\/\//.test(String(candidate?.sourceUrl || ''))) fail(index, 'sourceUrl must be HTTPS.');
  if (!isIsoDate(candidate?.checkedAt)) fail(index, 'checkedAt must be an ISO date.');
  if (!['supplier-title-confirm', 'universal-confirm', 'verified'].includes(candidate?.fitmentStatus)) fail(index, 'fitmentStatus is invalid.');
  if (!Array.isArray(candidate?.fitments) || candidate.fitments.length === 0) fail(index, 'at least one structured fitment is required.');
  if (!Array.isArray(candidate?.images) || candidate.images.length === 0 || !candidate.images.every(localImageValid)) fail(index, 'every image must be an exact, rights-confirmed local product image with intrinsic dimensions and alt text.');
  const quoteOnly = candidate?.quoteOnly === true;
  const hasVerifiedPrice = /^[A-Z]{3}$/.test(String(candidate?.priceCurrency || '')) && Number(candidate?.priceAmount) > 0 && isIsoDate(candidate?.priceVerifiedAt);
  if (!quoteOnly && !hasVerifiedPrice) fail(index, 'use quoteOnly=true or a verified positive price in the supplier original currency with verification date.');
  if (hasVerifiedPrice && (!String(candidate?.priceNote || '').trim() || !String(candidate?.priceNoteAr || '').trim())) fail(index, 'priced products require bilingual currency/tax notes.');

  return {
    slug,
    catalogType: 'product',
    title: String(candidate?.title || '').trim(),
    titleAr: String(candidate?.titleAr || '').trim(),
    summary: String(candidate?.summary || '').trim(),
    summaryAr: String(candidate?.summaryAr || '').trim(),
    brand: String(candidate?.brand || '').trim(),
    category: String(candidate?.category || '').trim(),
    categoryAr: String(candidate?.categoryAr || candidate?.category || '').trim(),
    sku: String(candidate?.sku || '').trim(),
    mpn: String(candidate?.mpn || '').trim(),
    quoteOnly,
    ...(quoteOnly ? {} : { priceCurrency: candidate.priceCurrency, priceAmount: Number(candidate.priceAmount), priceVerifiedAt: candidate.priceVerifiedAt, priceNote: candidate.priceNote, priceNoteAr: candidate.priceNoteAr }),
    status: String(candidate?.status || '').trim(),
    statusAr: String(candidate?.statusAr || '').trim(),
    checkedAt: candidate?.checkedAt,
    fitmentStatus: candidate?.fitmentStatus,
    fitments: candidate?.fitments,
    images: candidate?.images.map(({ src, width, height, alt, altAr }) => ({ src, width: Number(width), height: Number(height), alt, altAr })),
    sourceUrl: candidate?.sourceUrl,
    sourceCurrency: candidate?.sourceCurrency,
    vatIncluded: candidate?.vatIncluded === true
  };
});

if (failures.length) {
  console.error(`Catalogue candidate validation failed with ${failures.length} issue(s):`);
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

const output = path.join(privateRoot, 'sanitized', 'catalog-products.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify({ generatedAt: new Date().toISOString(), products: sanitized }, null, 2)}\n`);
console.log(`Prepared ${sanitized.length} sanitised product record(s) for manual review at ${path.relative(repo, output)}.`);
console.log('No public catalogue source file was changed. Review every record before copying approved products into assets/data.js.');
