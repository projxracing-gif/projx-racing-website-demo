import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateCatalog } from './lib.mjs';
import '../../assets/ecs-products.js';

const repo = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

function normalize(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en-US');
}

function safeSlug(value) {
  return normalize(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'review-required';
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function existingIndex(products) {
  const maps = { ecs: new Map(), mpn: new Map(), url: new Map() };
  for (const product of products) {
    maps.ecs.set(normalize(product.ecsPartNumber), product);
    maps.mpn.set(normalize(product.mpn), product);
    maps.url.set(normalize(product.originalUrl), product);
  }
  return maps;
}

function findExisting(candidate, index) {
  return index.ecs.get(normalize(candidate.ecsSku))
    || index.url.get(normalize(candidate.sourceUrl))
    || index.mpn.get(normalize(candidate.manufacturerMpn))
    || null;
}

function changedFields(candidate, existing) {
  if (!existing) return [];
  const comparisons = {
    title: [candidate.title, existing.title],
    brand: [candidate.brand, existing.brand],
    manufacturerMpn: [candidate.manufacturerMpn, existing.mpn],
    publicPrice: [candidate.publicPrice, {
      amount: existing.priceAmount,
      currency: existing.priceCurrency,
      display: `$${Number(existing.priceAmount).toFixed(2)}`
    }],
    publicAvailability: [candidate.publicAvailability, existing.observedAvailability],
    sourceUrl: [candidate.sourceUrl, existing.originalUrl]
  };
  return Object.entries(comparisons).filter(([, [left, right]]) => !same(left, right)).map(([field]) => field);
}

const REQUIRED_REVIEW = Object.freeze([
  'confirm_public_supplier_price_and_date',
  'confirm_availability_wording_without_stock_promise',
  'download_and_approve_local_product_images_no_hotlinking',
  'write_and_review_english_summary',
  'write_and_review_arabic_title_and_summary',
  'assign_category_and_subcategory',
  'convert_fitment_evidence_to_possible_structured_records',
  'confirm_year_chassis_engine_and_drivetrain_only_when_evidenced',
  'review_shipping_installation_and_special_order_notices',
  'review_seo_title_description_and_slug',
  'approve_related_products',
  'human_sign_off_before_storefront_or_database_publication'
]);

export function buildReviewQueue(catalog, baseline = globalThis.PROJX_ECS_PRODUCTS || []) {
  const products = Array.isArray(catalog?.products) ? catalog.products : [];
  const validation = validateCatalog(products);
  if (!validation.valid) {
    const errors = validation.products.flatMap(product => product.errors.map(error => `${product.ecsSku || product.index}: ${error}`));
    throw new Error(`Input ECS catalogue is invalid:\n- ${[
      ...errors,
      ...validation.duplicateSkus.map(value => `duplicate ECS number ${value}`),
      ...validation.duplicateUrls.map(value => `duplicate source URL ${value}`)
    ].join('\n- ')}`);
  }
  const index = existingIndex(baseline);
  const items = products.map(candidate => {
    const existing = findExisting(candidate, index);
    const changes = changedFields(candidate, existing);
    return {
      reviewKey: candidate.ecsSku,
      action: existing ? 'review_existing' : 'review_new',
      existingSlug: existing?.slug || null,
      proposedSlug: existing?.slug || safeSlug(candidate.title),
      changedFields: changes,
      duplicatePrevention: {
        matchedBy: existing
          ? (normalize(existing.ecsPartNumber) === normalize(candidate.ecsSku) ? 'ecs_part_number'
            : normalize(existing.originalUrl) === normalize(candidate.sourceUrl) ? 'source_url' : 'manufacturer_mpn')
          : null,
        createNewProduct: !existing
      },
      supplierRecord: candidate,
      requiredReview: [...REQUIRED_REVIEW],
      blockers: [
        ...(candidate.fitment?.length ? [] : ['missing_public_fitment_evidence']),
        ...(candidate.imageUrls?.length ? [] : ['missing_public_product_image']),
        ...(candidate.category ? [] : ['missing_category']),
        'no_verified_projx_selling_price',
        'no_live_stock_feed',
        'no_exact_fitment_evidence'
      ],
      publishApproved: false
    };
  });
  return {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    sourceCatalogGeneratedAt: catalog.generatedAt || null,
    baselineProductCount: baseline.length,
    candidateCount: items.length,
    existingReviewCount: items.filter(item => item.action === 'review_existing').length,
    newReviewCount: items.filter(item => item.action === 'review_new').length,
    publishApprovedCount: 0,
    blockedFromAutomaticPublication: true,
    items
  };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function assertPrivatePath(filePath, label) {
  const absolute = path.resolve(filePath);
  const relative = path.relative(repo, absolute);
  const insideRepo = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  if (insideRepo && !relative.startsWith(`private-imports${path.sep}`)) {
    throw new Error(`${label} inside this repository must stay under private-imports/.`);
  }
  return absolute;
}

async function main() {
  const catalogPath = argument('--catalog');
  const outputPath = argument('--output');
  if (!catalogPath || !outputPath) {
    throw new Error('Usage: node scripts/ecs-catalog/prepare-review.mjs --catalog <private catalog.json> --output <private review-queue.json>');
  }
  const input = assertPrivatePath(catalogPath, 'Catalogue input');
  const output = assertPrivatePath(outputPath, 'Review output');
  const catalog = JSON.parse(await readFile(input, 'utf8'));
  const queue = buildReviewQueue(catalog);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(queue, null, 2)}\n`, 'utf8');
  console.log(`Prepared ${queue.candidateCount} ECS review item(s): ${queue.newReviewCount} new, ${queue.existingReviewCount} existing.`);
  console.log('Automatic publication remains blocked pending human review.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
