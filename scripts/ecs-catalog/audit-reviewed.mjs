import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REVIEWED_ECS_PRODUCTS } from '../../server/ecs-reviewed-catalog.js';
import { __test as imageInspection } from './materialize-page-assets.mjs';

const repo = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const products = [...REVIEWED_ECS_PRODUCTS];

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function duplicateValues(field) {
  const values = new Map();
  for (const product of products) {
    const value = String(product[field] || '').normalize('NFKC').trim().toLocaleLowerCase('en-US');
    if (!value) continue;
    values.set(value, [...(values.get(value) || []), product.slug]);
  }
  return [...values.entries()].filter(([, slugs]) => slugs.length > 1)
    .map(([value, slugs]) => ({ value, slugs }));
}

function imageContentType(filename) {
  const extension = path.extname(filename).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  return null;
}

function gaps(product) {
  const fitments = product.fitments || [];
  const result = [];
  if (!product.detailedDescriptionAvailable) result.push('verified_detailed_description');
  if (!product.specifications?.length) result.push('verified_technical_specifications');
  if (!product.options?.length) result.push('verified_options');
  if (!product.variants?.length) result.push('verified_variations');
  if (!fitments.some(fitment => fitment.confidence === 'exact')) result.push('exact_vehicle_fitment');
  if (!fitments.some(fitment => fitment.drivetrains?.length)) result.push('drivetrain_fitment');
  if (!fitments.some(fitment => fitment.yearFrom || fitment.yearTo)) result.push('year_range');
  if (!product.projxSellingPrice) result.push('projx_selling_price');
  if (product.stockPolicy === 'manual-confirm') result.push('live_stock_feed');
  if ((product.images || []).length < 2) result.push('additional_product_images');
  return result;
}

const imageRecords = [];
const validationErrors = [];
const productSlugs = new Set(products.map(product => product.slug));
for (const product of products) {
  for (const required of [
    'slug', 'publicKey', 'title', 'titleAr', 'summary', 'summaryAr', 'brand', 'category',
    'ecsPartNumber', 'mpn', 'priceCurrency', 'priceVerifiedAt', 'checkedAt', 'originalUrl'
  ]) {
    if (product[required] === undefined || product[required] === null || String(product[required]).trim() === '') {
      validationErrors.push(`${product.slug || 'unknown'}: missing ${required}`);
    }
  }
  if (!/^ES#\d+$/.test(product.ecsPartNumber || '')) validationErrors.push(`${product.slug}: invalid ECS part number`);
  if (product.priceCurrency !== 'USD') validationErrors.push(`${product.slug}: public ECS price must remain USD`);
  if (product.fitmentConfidence !== 'possible' || product.fitments?.some(fitment => fitment.confidence !== 'possible')) {
    validationErrors.push(`${product.slug}: unverified fitment was not kept possible-only`);
  }
  if (product.availabilityCode !== 'check_availability') {
    validationErrors.push(`${product.slug}: manual supplier observation was presented as live availability`);
  }
  if (!product.relatedProductSlugs?.length) validationErrors.push(`${product.slug}: related product references are missing`);
  if (!product.seo?.pageTitle || !product.seo?.metaDescription || !/^\/parts\/[a-z0-9][a-z0-9-]*\/$/.test(product.seo?.path || '')) {
    validationErrors.push(`${product.slug}: SEO metadata is incomplete or invalid`);
  }
  for (const relatedSlug of product.relatedProductSlugs || []) {
    if (relatedSlug === product.slug || !productSlugs.has(relatedSlug)) {
      validationErrors.push(`${product.slug}: related product reference is invalid (${relatedSlug})`);
    }
  }
  for (const source of product.images || []) {
    const relative = String(source.src || '').replace(/^\/+/, '').replaceAll('/', path.sep);
    const absolute = path.resolve(repo, relative);
    if (!absolute.startsWith(`${repo}${path.sep}`)) {
      validationErrors.push(`${product.slug}: image escapes the repository`);
      continue;
    }
    try {
      const bytes = await readFile(absolute);
      const contentType = imageContentType(relative);
      const dimensions = contentType ? imageInspection.dimensions(bytes, contentType) : null;
      if (!dimensions) validationErrors.push(`${product.slug}: image type is not supported`);
      if (dimensions && (dimensions.width !== Number(source.width) || dimensions.height !== Number(source.height))) {
        validationErrors.push(`${product.slug}: declared image dimensions do not match the file`);
      }
      imageRecords.push({
        slug: product.slug,
        path: String(source.src),
        bytes: bytes.length,
        width: dimensions?.width || null,
        height: dimensions?.height || null,
        sha256: createHash('sha256').update(bytes).digest('hex')
      });
    } catch (error) {
      validationErrors.push(`${product.slug}: image cannot be read (${error.code || 'error'})`);
    }
  }
}

for (const [field, duplicates] of Object.entries({
  slug: duplicateValues('slug'),
  publicKey: duplicateValues('publicKey'),
  ecsPartNumber: duplicateValues('ecsPartNumber'),
  originalUrl: duplicateValues('originalUrl')
})) {
  if (duplicates.length) validationErrors.push(`duplicate ${field}: ${duplicates.map(item => item.value).join(', ')}`);
}

const duplicateImageHashes = [...imageRecords.reduce((map, imageRecord) => {
  map.set(imageRecord.sha256, [...(map.get(imageRecord.sha256) || []), imageRecord.slug]);
  return map;
}, new Map()).entries()].filter(([, slugs]) => slugs.length > 1)
  .map(([sha256, slugs]) => ({ sha256, slugs }));
const productRows = products.map(product => ({
  slug: product.slug,
  ecsPartNumber: product.ecsPartNumber,
  manufacturerMpn: product.mpn,
  brand: product.brand,
  category: product.category,
  price: { currency: product.priceCurrency, amount: product.priceAmount, checkedAt: product.priceVerifiedAt },
  availability: { policy: product.stockPolicy, observed: product.observedAvailability, checkedAt: product.checkedAt },
  fitmentConfidence: product.fitmentConfidence,
  fitmentCount: product.fitments?.length || 0,
  imageCount: product.images?.length || 0,
  relatedProductCount: product.relatedProductSlugs?.length || 0,
  missing: gaps(product)
}));

const coverageCount = predicate => products.filter(predicate).length;
const report = {
  schemaVersion: 1,
  supplier: 'ECS Tuning',
  grain: 'one reviewed public supplier product per ECS part number',
  productCount: products.length,
  valid: validationErrors.length === 0,
  validationErrors,
  duplicates: {
    slug: duplicateValues('slug'),
    publicKey: duplicateValues('publicKey'),
    ecsPartNumber: duplicateValues('ecsPartNumber'),
    manufacturerMpn: duplicateValues('mpn'),
    sourceUrl: duplicateValues('originalUrl'),
    imageContent: duplicateImageHashes
  },
  coverage: {
    publicUsdPrice: coverageCount(product => product.priceAmount !== null && product.priceAmount !== undefined
      && Number.isFinite(Number(product.priceAmount)) && product.priceCurrency === 'USD'),
    projxSellingPrice: coverageCount(product => product.projxSellingPrice !== null
      && product.projxSellingPrice !== undefined && Number.isFinite(Number(product.projxSellingPrice))
      && Number(product.projxSellingPrice) > 0),
    localPrimaryImage: coverageCount(product => product.images?.length > 0),
    multipleImages: coverageCount(product => product.images?.length > 1),
    reviewedSummary: coverageCount(product => product.summary && product.summaryAr),
    verifiedDetailedDescription: coverageCount(product => product.detailedDescriptionAvailable),
    verifiedSpecifications: coverageCount(product => product.specifications?.length > 0),
    verifiedOptions: coverageCount(product => product.options?.length > 0),
    verifiedVariations: coverageCount(product => product.variants?.length > 0),
    possibleFitment: coverageCount(product => product.fitments?.some(fitment => fitment.confidence === 'possible')),
    exactFitment: coverageCount(product => product.fitments?.some(fitment => fitment.confidence === 'exact')),
    yearRange: coverageCount(product => product.fitments?.some(fitment => fitment.yearFrom || fitment.yearTo)),
    drivetrain: coverageCount(product => product.fitments?.some(fitment => fitment.drivetrains?.length)),
    relatedProducts: coverageCount(product => product.relatedProductSlugs?.length > 0),
    liveStockFeed: coverageCount(product => product.stockPolicy !== 'manual-confirm')
  },
  products: productRows,
  images: imageRecords
};

const output = option('--output');
if (output) {
  const absolute = path.resolve(output);
  const relative = path.relative(repo, absolute);
  const insideRepo = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  if (insideRepo && !relative.startsWith(`private-imports${path.sep}`)) {
    throw new Error('Audit output inside this repository must stay under private-imports/.');
  }
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`ECS reviewed-catalogue audit written to ${relative}`);
} else {
  console.log(JSON.stringify(report, null, 2));
}

if (!report.valid) process.exitCode = 1;
