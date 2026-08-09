import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ECS_PRODUCT_HOST = 'www.ecstuning.com';
const ECS_IMAGE_HOST = 'assets.ecstuning.com';
const PUBLIC_BLOB_HOST = /\.public\.blob\.vercel-storage\.com$/i;
const PRODUCT_PATH = /^\/b-[^/?#]+\/[^/?#]+\/[^/?#]+\/$/i;
const OBSERVATION_FUTURE_TOLERANCE_MS = 5 * 60 * 1_000;

export const BMW_M3_AGGREGATE_SECTIONS = Object.freeze({
  braking: Object.freeze({ label: 'Braking', labelAr: 'الفرامل', path: 'Braking' }),
  engine: Object.freeze({ label: 'Engine', labelAr: 'المحرك', path: 'Engine' }),
  exterior: Object.freeze({ label: 'Exterior', labelAr: 'الهيكل الخارجي', path: 'Exterior' }),
  interior: Object.freeze({ label: 'Interior', labelAr: 'المقصورة الداخلية', path: 'Interior' }),
  performance: Object.freeze({ label: 'Performance', labelAr: 'الأداء', path: 'Performance' }),
  suspension: Object.freeze({ label: 'Suspension', labelAr: 'نظام التعليق', path: 'Suspension' }),
  steering: Object.freeze({ label: 'Steering', labelAr: 'نظام التوجيه', path: 'Steering' })
});

function clean(value, maximum = 5_000) {
  return String(value ?? '').normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function slugify(value) {
  return clean(value, 500).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'uncategorized';
}

function ecsDigits(value) {
  const match = clean(value, 100).match(/^(?:ES\s*#?\s*)?(\d{3,12})$/i);
  return match?.[1] || null;
}

function exactTimestamp(value, nowMs) {
  const source = clean(value, 100);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(source)) return null;
  const parsed = Date.parse(source);
  if (!Number.isFinite(parsed) || parsed > nowMs + OBSERVATION_FUTURE_TOLERANCE_MS) return null;
  return new Date(parsed).toISOString();
}

function canonicalHttpsUrl(value, host, pathPattern = null, ensureTrailingSlash = true) {
  try {
    const url = new URL(clean(value, 2_000));
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hostname !== host) return null;
    url.hash = '';
    url.search = '';
    url.pathname = ensureTrailingSlash
      ? `${url.pathname.replace(/\/+$/, '')}/`
      : url.pathname.replace(/\/+$/, '');
    if (pathPattern && !pathPattern.test(url.pathname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function canonicalProductUrl(value) {
  const repaired = clean(value, 2_000)
    .replace(/\u00c2\u00ad/g, '\u00ad')
    .replace(/%C3%82%C2%AD/gi, '%C2%AD');
  return canonicalHttpsUrl(repaired, ECS_PRODUCT_HOST, PRODUCT_PATH);
}

function canonicalPublicBlobUrl(value) {
  try {
    const url = new URL(clean(value, 2_000));
    if (url.protocol !== 'https:' || !PUBLIC_BLOB_HOST.test(url.hostname)
      || url.username || url.password || url.port || url.search || url.hash) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function isPublicBlobAsset(value) {
  return Boolean(canonicalPublicBlobUrl(value));
}

function sectionDefinition(value) {
  const key = slugify(value);
  return Object.hasOwn(BMW_M3_AGGREGATE_SECTIONS, key)
    ? { key, ...BMW_M3_AGGREGATE_SECTIONS[key] }
    : null;
}

function canonicalSourceUrl(value, section) {
  const url = canonicalHttpsUrl(value, ECS_PRODUCT_HOST);
  if (!url || !section) return null;
  const expected = `/bmw-m3/${section.path.toLocaleLowerCase('en-US')}/`;
  return new URL(url).pathname.toLocaleLowerCase('en-US').startsWith(expected) ? url : null;
}

function imageUrls(record) {
  const primary = [
    ...(Array.isArray(record?.imageUrls) ? record.imageUrls : []),
    ...(Array.isArray(record?.images) ? record.images : []),
    record?.imageUrl
  ];
  const candidates = primary.some(value => clean(typeof value === 'object' ? value?.src : value))
    ? primary
    : [record?.imageFallbackUrl];
  return [...new Set(candidates.map(value => typeof value === 'object' ? value?.src : value)
    .map(value => canonicalHttpsUrl(value, ECS_IMAGE_HOST, null, false))
    .filter(value => value && !/\/ecs_box_no_image\.(?:avif|jpe?g|png|webp)$/i.test(new URL(value).pathname)))].sort();
}

function mediaIndexMap(document) {
  if (document === null || document === undefined) return new Map();
  if (document?.schemaVersion !== 1 || document?.supplier !== 'ECS Tuning' || !Array.isArray(document?.images)) {
    throw new Error('BMW M3 media index must use schemaVersion 1, supplier ECS Tuning and an images array.');
  }
  const result = new Map();
  for (const [index, image] of document.images.entries()) {
    const sourceUrl = canonicalHttpsUrl(image?.sourceUrl, ECS_IMAGE_HOST, null, false);
    const localPath = clean(image?.localPath, 1_000).replaceAll('\\', '/');
    const publicUrl = canonicalPublicBlobUrl(image?.publicUrl);
    const src = publicUrl || localPath;
    const width = Number(image?.width);
    const height = Number(image?.height);
    const sha256 = clean(image?.sha256, 100).toLocaleLowerCase('en-US');
    const unsafeSegment = localPath.split('/').some(segment => segment === '..' || segment === '.');
    if (!sourceUrl || (publicUrl && localPath) || (!publicUrl && (unsafeSegment
      || !/^assets\/products\/ecs\/[a-z0-9][a-z0-9._/-]*\.(?:avif|jpe?g|png|webp)$/i.test(localPath)))
      || !Number.isInteger(width) || width < 1 || width > 8_000
      || !Number.isInteger(height) || height < 1 || height > 8_000
      || !/^[a-f0-9]{64}$/.test(sha256)) {
      throw new Error(`BMW M3 media index entry ${index + 1} is invalid.`);
    }
    const existing = result.get(sourceUrl);
    if (existing && (existing.src !== src || existing.sha256 !== sha256)) {
      throw new Error(`BMW M3 media index has conflicting files for ${sourceUrl}.`);
    }
    if (!existing) result.set(sourceUrl, { sourceUrl, src, width, height, sha256 });
  }
  return result;
}

function parseUsdPrice(record) {
  const raw = record?.publicUsdPrice ?? record?.priceAmount ?? record?.priceText ?? null;
  const source = clean(raw, 200);
  const pricePresentation = [source, clean(record?.priceText, 200), clean(record?.priceBlockText, 500)];
  const startingAt = record?.priceStartingAt === true
    || pricePresentation.some(value => /^(?:starting\s+at|from)\b/i.test(value));
  if (raw === null || raw === undefined || source === '') return { amount: null, startingAt };
  if (typeof raw === 'number') return {
    amount: Number.isFinite(raw) && raw >= 0 ? Math.round(raw * 100) / 100 : null,
    startingAt
  };
  if (/\b(?:GBP|EUR|KWD|AED|SAR)\b|[£€]/i.test(source)) return { amount: null, startingAt };
  const match = source.replace(/,/g, '').match(/(?:USD\s*|\$\s*)?(\d+(?:\.\d{1,2})?)/i);
  const amount = match ? Number(match[1]) : Number.NaN;
  return {
    amount: Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : null,
    startingAt
  };
}

function recordTimestamp(record, document, nowMs) {
  return exactTimestamp(record?.priceObservedAt ?? record?.observedAt ?? document?.generatedAt, nowMs);
}

function normalizedMpn(value) {
  return clean(value, 200).toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '');
}

function normalizeRecord(record, index, document, nowMs) {
  const section = sectionDefinition(record?.section);
  const productUrl = canonicalProductUrl(record?.productUrl);
  const sourceUrl = canonicalSourceUrl(record?.sourceUrl ?? record?.source?.url ?? record?.source, section);
  const observedAt = recordTimestamp(record, document, nowMs);
  const suppliedBrand = clean(record?.brand, 200);
  const publicPrice = parseUsdPrice(record);
  const normalized = {
    index,
    title: clean(record?.title, 500),
    description: clean(record?.description, 5_000),
    brand: suppliedBrand || 'Supplier brand not provided',
    brandSupplied: Boolean(suppliedBrand),
    digits: ecsDigits(record?.ecsPartNumber ?? record?.['ES#'] ?? record?.identifiers?.ecs),
    mpn: clean(record?.manufacturerPartNumber ?? record?.mpn ?? record?.MPN, 200)
      .replace(/\u00ad/g, ''),
    priceAmount: publicPrice.amount,
    priceStartingAt: publicPrice.startingAt,
    availability: clean(record?.availabilityText ?? record?.availability, 500),
    productUrl,
    imageUrls: imageUrls(record),
    section,
    category: clean(record?.category, 300),
    sourceUrl,
    observedAt,
    relevancePosition: Number.isInteger(Number(record?.relevancePosition))
      && Number(record?.relevancePosition) > 0 ? Number(record.relevancePosition) : null
  };
  const reasons = [];
  for (const [field, value] of [
    ['title', normalized.title], ['brand', normalized.brand], ['ECS identity', normalized.digits],
    ['manufacturer part number', normalized.mpn], ['product URL', normalized.productUrl],
    ['section', normalized.section], ['category', normalized.category], ['source URL', normalized.sourceUrl],
    ['observation timestamp', normalized.observedAt]
  ]) {
    if (!value) reasons.push(`missing-or-invalid-${slugify(field)}`);
  }
  return { normalized, reasons };
}

function observationComparator(left, right) {
  return right.observedAt.localeCompare(left.observedAt)
    || left.section.key.localeCompare(right.section.key)
    || left.category.localeCompare(right.category)
    || left.sourceUrl.localeCompare(right.sourceUrl)
    || left.index - right.index;
}

function unique(values) {
  return [...new Set(values.filter(value => value !== null && value !== undefined && value !== ''))];
}

function conflictReasons(records) {
  const reasons = [];
  const mpns = unique(records.map(record => normalizedMpn(record.mpn)));
  const urls = unique(records.map(record => record.productUrl));
  if (mpns.length > 1) reasons.push('conflicting-manufacturer-part-number');
  if (urls.length > 1) reasons.push('conflicting-canonical-product-url');
  const pricesByDay = new Map();
  for (const record of records) {
    if (record.priceAmount === null) continue;
    const day = record.observedAt.slice(0, 10);
    if (!pricesByDay.has(day)) pricesByDay.set(day, new Set());
    pricesByDay.get(day).add(record.priceAmount);
  }
  if ([...pricesByDay.values()].some(prices => prices.size > 1)) reasons.push('conflicting-same-day-public-price');
  return reasons;
}

function priceCopy(amount, observedDate, startingAt = false) {
  if (startingAt && amount === 0) return {
    quoteOnly: true,
    purchaseMode: 'request-price',
    priceAmount: null,
    priceCurrency: 'USD',
    priceStartingAt: false,
    priceConflict: false,
    priceType: 'confirmation-required',
    priceIncludesShipping: false,
    priceVerifiedAt: observedDate,
    priceNote: 'The ECS listing showed a $0.00 starting value; it is not treated as a selling price. Select the exact variant and request the current price before order.',
    priceNoteAr: 'ظهر في إدراج ECS سعر ابتدائي بقيمة 0.00 دولار؛ لا تُعامل هذه القيمة كسعر بيع. يجب اختيار النسخة الدقيقة وطلب السعر الحالي قبل الطلب.'
  };
  if (amount === null) return {
    quoteOnly: true,
    purchaseMode: 'request-price',
    priceAmount: null,
    priceCurrency: 'USD',
    priceStartingAt: false,
    priceConflict: false,
    priceType: 'confirmation-required',
    priceIncludesShipping: false,
    priceVerifiedAt: observedDate,
    priceNote: 'No publishable public ECS USD price was captured; request the current price before order.',
    priceNoteAr: 'لم يُلتقط سعر عام قابل للنشر من ECS بالدولار الأمريكي؛ يرجى طلب السعر الحالي قبل الطلب.'
  };
  if (startingAt) return {
    quoteOnly: true,
    purchaseMode: 'variant-confirmation-required',
    priceAmount: amount,
    priceCurrency: 'USD',
    priceStartingAt: true,
    priceConflict: false,
    priceType: 'supplier-public-retail-starting-at',
    projxSellingPrice: null,
    priceIncludesShipping: false,
    priceVerifiedAt: observedDate,
    priceNote: `ECS public USD starting price observed ${observedDate}; this is not a fixed unit price. The exact variant, final selling price, shipping, customs and Kuwait delivery require confirmation before order.`,
    priceNoteAr: `سعر ابتدائي عام من ECS بالدولار الأمريكي كما ظهر بتاريخ ${observedDate}؛ هذه القيمة ليست سعراً ثابتاً للوحدة. يجب تأكيد النسخة الدقيقة وسعر البيع النهائي والشحن والجمارك والتوصيل في الكويت قبل الطلب.`
  };
  return {
    quoteOnly: false,
    purchaseMode: 'fitment-confirmation-required',
    priceAmount: amount,
    priceCurrency: 'USD',
    priceStartingAt: false,
    priceConflict: false,
    priceType: 'supplier-public-retail',
    projxSellingPrice: null,
    priceIncludesShipping: false,
    priceVerifiedAt: observedDate,
    priceNote: `ECS public USD retail price observed ${observedDate}; shipping, customs and Kuwait delivery are excluded and the current price must be confirmed before sale.`,
    priceNoteAr: `سعر التجزئة العام من ECS بالدولار الأمريكي كما ظهر بتاريخ ${observedDate}؛ لا يشمل الشحن أو الجمارك أو التوصيل في الكويت ويجب تأكيد السعر الحالي قبل البيع.`
  };
}

function availabilityCopy(record) {
  return {
    status: 'Supplier status — confirmation required',
    statusAr: 'حالة المورد — يلزم التأكيد',
    checkedAt: record.observedAt.slice(0, 10),
    stockObservedAt: record.observedAt.slice(0, 10),
    staleAfterDays: 7,
    stockPolicy: 'manual-confirm',
    availabilityCode: 'check_availability',
    observedAvailability: record.availability || null,
    observedAvailabilityAr: record.availability ? `حالة المورد كما ظهرت باللغة الإنجليزية: ${record.availability}` : null,
    availabilityNote: 'Availability confirmation required. This dated public listing observation is not a live stock promise.',
    availabilityNoteAr: 'يلزم تأكيد التوفر. ملاحظة الإدراج العام المؤرخة لا تمثل وعداً مباشراً بالمخزون.'
  };
}

function buildProduct(digits, records, mediaMap) {
  const sorted = [...records].sort(observationComparator);
  const current = sorted[0];
  const withPrice = sorted.filter(record => record.priceAmount !== null).sort(observationComparator)[0] || null;
  const selectedPriceDay = withPrice?.observedAt.slice(0, 10) || null;
  const priceStartingAt = Boolean(withPrice && sorted.some(record => record.priceStartingAt
    && record.priceAmount === withPrice.priceAmount
    && record.observedAt.slice(0, 10) === selectedPriceDay));
  const descriptions = sorted.filter(record => record.description);
  const description = descriptions[0]?.description || '';
  const observations = [...records].sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl)
    || left.category.localeCompare(right.category) || left.observedAt.localeCompare(right.observedAt));
  const sections = unique(observations.map(record => record.section.key));
  const sectionSlugs = sections.map(section => `bmw-m3-${section}`);
  const subcategorySlugs = unique(observations
    .map(record => `bmw-m3-${record.section.key}-${slugify(record.category)}`));
  const images = unique(observations.flatMap(record => record.imageUrls));
  const renderedImages = images.map(sourceUrl => {
    const local = mediaMap.get(sourceUrl);
    return local
      ? { src: local.src, width: local.width, height: local.height, sourceUrl }
      : { src: sourceUrl, sourceUrl };
  });
  const observedDate = (withPrice || current).observedAt.slice(0, 10);
  const fitmentNote = 'Listed by ECS under a model-level BMW M3 category. The aggregate listing does not establish model year, generation, chassis, engine, drivetrain or options; confirm all fitment details before order.';
  const fitmentNoteAr = 'أدرجت ECS القطعة ضمن فئة على مستوى طراز BMW M3. لا يحدد هذا الإدراج العام سنة الصنع أو الجيل أو رمز الهيكل أو المحرك أو نظام الدفع أو الخيارات؛ يجب تأكيد جميع تفاصيل الملاءمة قبل الطلب.';
  const sectionLabels = sections.map(section => BMW_M3_AGGREGATE_SECTIONS[section].label);
  const primaryCategory = current.category;
  const categorySlug = `bmw-m3-${current.section.key}`;
  const subcategorySlug = `bmw-m3-${current.section.key}-${slugify(primaryCategory)}`;
  const price = priceCopy(withPrice?.priceAmount ?? null, observedDate, priceStartingAt);
  const ranks = records.map(record => record.relevancePosition).filter(Number.isFinite);
  return {
    catalogType: 'product',
    provider: 'ECS Tuning',
    providerSlug: 'ecs',
    dataOrigin: 'authorized-public-bmw-m3-aggregate-review',
    dataOrigins: ['authorized-public-bmw-m3-aggregate-review'],
    catalogueStatus: 'reviewed-partial',
    ...price,
    slug: `es-${digits}`,
    publicKey: `ecs-es-${digits}`,
    title: current.title,
    titleAr: current.title,
    summary: description || 'Supplier description unavailable; confirm product details before order.',
    summaryAr: description
      ? `وصف المورد باللغة الإنجليزية: ${description}`
      : 'وصف المورد غير متوفر؛ يجب تأكيد تفاصيل المنتج قبل الطلب.',
    description: description || 'Supplier description unavailable; confirm product details before order.',
    descriptionAr: description
      ? `وصف المورد باللغة الإنجليزية: ${description}`
      : 'وصف المورد غير متوفر؛ يجب تأكيد تفاصيل المنتج قبل الطلب.',
    detailedDescriptionAvailable: Boolean(description),
    brand: current.brand,
    brandSlug: slugify(current.brand),
    brandSupplied: current.brandSupplied,
    section: current.section.label,
    sectionAr: current.section.labelAr,
    sectionSlug: categorySlug,
    category: `${current.section.label} Parts`,
    categoryAr: `قطع ${current.section.labelAr} — BMW M3`,
    categorySlug,
    subcategory: primaryCategory,
    subcategoryAr: primaryCategory,
    subcategorySlug,
    categoryMemberships: observations.map(record => ({
      section: record.section.label,
      sectionAr: record.section.labelAr,
      sectionSlug: `bmw-m3-${record.section.key}`,
      category: record.category,
      categorySlug: `bmw-m3-${record.section.key}-${slugify(record.category)}`,
      sourceUrl: record.sourceUrl,
      observedAt: record.observedAt
    })),
    sku: `ES#${digits}`,
    ecsPartNumber: `ES#${digits}`,
    mpn: current.mpn,
    identifiers: { ecs: `ES#${digits}`, sku: `ES#${digits}`, mpn: current.mpn },
    ...availabilityCopy(current),
    originalUrl: current.productUrl,
    imageSourceUrl: images[0] || null,
    imageStatus: renderedImages.length ? 'supplier-media-verified' : 'supplier-media-unavailable',
    images: renderedImages.map(image => ({
      ...image,
      alt: `ES#${digits} - ${current.mpn} - ${current.title} - ${current.brand}`,
      altAr: current.title
    })),
    fitmentStatus: 'supplier-model-category-confirm',
    fitmentConfidence: 'possible',
    fitments: [{
      make: 'BMW', model: 'M3', models: ['M3'], trim: null, generation: null,
      chassis: [], yearFrom: null, yearTo: null, engines: [], drivetrains: [],
      confidence: 'possible', evidence: 'ecs-bmw-m3-aggregate-category',
      note: fitmentNote, noteAr: fitmentNoteAr
    }],
    filters: {
      supplier: ['ecs'], makes: ['BMW'], models: ['M3'], chassis: [], years: [],
      engines: [], drivetrains: [], brands: [slugify(current.brand)],
      categories: unique(['bmw-m3', ...sectionSlugs]), subcategories: subcategorySlugs,
      availability: ['confirmation-required'], fitment: ['possible']
    },
    specifications: [], options: [], variants: [],
    selectionEvidence: 'ecs-model-category-observation',
    ...(ranks.length ? { selectionRank: Math.min(...ranks) } : {}),
    selectionNote: `Listed in ECS BMW M3 ${sectionLabels.join(', ')} model-level categories. Category presence is not exact vehicle fitment or a unit-sales ranking.`,
    selectionNoteAr: `مدرج ضمن فئات ${sectionLabels.join('، ')} على مستوى طراز BMW M3 لدى ECS. وجود القطعة في الفئة لا يثبت الملاءمة الدقيقة ولا يمثل ترتيباً حسب عدد الوحدات المباعة.`,
    selectionSources: observations.map(record => ({
      vehicle: 'BMW M3', section: record.section.label, category: record.category,
      sourceUrl: record.sourceUrl,
      ...(record.relevancePosition ? { relevancePosition: record.relevancePosition } : {}),
      observedAt: record.observedAt
    })),
    sourceObservations: observations.map(record => ({
      section: record.section.label, category: record.category, sourceUrl: record.sourceUrl,
      observedAt: record.observedAt, availability: record.availability || null,
      publicUsdPrice: record.priceAmount,
      priceStartingAt: record.priceStartingAt
    })),
    installation: { status: 'confirmation-required', note: 'Professional fitment review is required before order.' },
    shipping: {
      status: 'quote-required', origin: 'United States',
      note: 'Shipping to Kuwait, customs and local delivery are confirmed separately before order.'
    },
    seo: {
      pageTitle: `${current.title} | Projx Racing`,
      metaDescription: description || `ECS ES#${digits} for BMW M3; price, availability and fitment require confirmation.`,
      path: `/parts/es-${digits}/`
    },
    relatedProductSlugs: []
  };
}

function sectionAudit(products, records) {
  const result = {};
  for (const key of Object.keys(BMW_M3_AGGREGATE_SECTIONS)) {
    const matchingRecords = records.filter(record => record.section.key === key);
    result[key] = {
      label: BMW_M3_AGGREGATE_SECTIONS[key].label,
      observationCount: matchingRecords.length,
      productCount: products.filter(product => product.selectionSources.some(source => source.section === BMW_M3_AGGREGATE_SECTIONS[key].label)).length,
      categories: [...new Set(matchingRecords.map(record => record.category))].sort()
    };
  }
  return result;
}

export function prepareBmwM3AggregateCapture(document, options = {}) {
  if (document?.schemaVersion !== 1 || document?.supplier !== 'ECS Tuning'
    || document?.kind !== 'bmw-m3-aggregate-listing-capture' || !Array.isArray(document?.records)) {
    throw new Error('BMW M3 aggregate capture must use schemaVersion 1, supplier ECS Tuning, the expected kind and a records array.');
  }
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const mediaMap = mediaIndexMap(options.mediaIndex);
  const generatedAt = exactTimestamp(document.generatedAt, nowMs);
  if (!generatedAt) throw new Error('BMW M3 aggregate capture requires a valid generatedAt timestamp.');
  const valid = [];
  const invalidRecords = [];
  document.records.forEach((record, index) => {
    const { normalized, reasons } = normalizeRecord(record, index, document, nowMs);
    if (reasons.length) invalidRecords.push({ recordIndex: index, ecsPartNumber: normalized.digits ? `ES#${normalized.digits}` : null, reasons });
    else valid.push(normalized);
  });
  const groups = new Map();
  for (const record of valid) {
    if (!groups.has(record.digits)) groups.set(record.digits, []);
    groups.get(record.digits).push(record);
  }
  const products = [];
  const quarantine = [];
  for (const [digits, records] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, 'en', { numeric: true }))) {
    const reasons = conflictReasons(records);
    if (reasons.length) {
      quarantine.push({
        ecsPartNumber: `ES#${digits}`, reasons,
        recordIndexes: records.map(record => record.index).sort((left, right) => left - right),
        sections: unique(records.map(record => record.section.label)).sort(),
        productUrls: unique(records.map(record => record.productUrl)).sort()
      });
    } else {
      products.push(buildProduct(digits, records, mediaMap));
    }
  }
  const audit = {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    kind: 'bmw-m3-aggregate-import-audit',
    generatedAt,
    sourceKind: document.kind,
    sourceGeneratedAt: generatedAt,
    rawRecordCount: document.records.length,
    validatedRecordCount: valid.length,
    invalidRecordCount: invalidRecords.length,
    uniqueValidatedEcsIdentityCount: groups.size,
    productCount: products.length,
    quarantinedIdentityCount: quarantine.length,
    quarantinedRecordCount: quarantine.reduce((total, item) => total + item.recordIndexes.length, 0),
    duplicateObservationCount: valid.length - groups.size,
    publicUsdPriceProductCount: products.filter(product => product.priceAmount !== null).length,
    requestPriceProductCount: products.filter(product => product.priceAmount === null).length,
    startingPriceProductCount: products.filter(product => product.priceStartingAt
      && product.priceAmount !== null).length,
    zeroStartingPriceRequestProductCount: products.filter(product => product.priceAmount === null
      && product.sourceObservations.some(observation => observation.priceStartingAt
        && observation.publicUsdPrice === 0)).length,
    supplierImageProductCount: products.filter(product => product.images.length > 0).length,
    localAssetImageProductCount: products.filter(product => product.images.some(image => !/^https:/i.test(image.src))).length,
    blobAssetImageProductCount: products.filter(product => product.images
      .some(image => isPublicBlobAsset(image.src))).length,
    remoteCdnImageProductCount: products.filter(product => product.images
      .some(image => /^https:\/\/assets\.ecstuning\.com\//i.test(image.src))).length,
    missingSupplierDescriptionProductCount: products.filter(product => !product.detailedDescriptionAvailable).length,
    sections: sectionAudit(products, valid),
    invalidRecords,
    quarantine
  };
  return {
    products,
    quarantinedEcsIdentities: quarantine.map(item => item.ecsPartNumber.replace(/^ES#/, '')),
    audit
  };
}

export function combineBmwM3SectionCaptures(documents, options = {}) {
  if (!Array.isArray(documents) || !documents.length) throw new Error('BMW M3 section captures must be a non-empty array.');
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const seenSections = new Set();
  const records = [];
  const generatedTimes = [];
  for (const [documentIndex, document] of documents.entries()) {
    const section = sectionDefinition(document?.section);
    const expectedKind = section ? `bmw-m3-${section.key}-listing-capture` : null;
    const generatedAt = exactTimestamp(document?.generatedAt, nowMs);
    if (document?.schemaVersion !== 1 || document?.supplier !== 'ECS Tuning'
      || document?.accessClass !== 'public-retail' || document?.kind !== expectedKind
      || document?.vehicle !== 'BMW M3' || !generatedAt
      || !Array.isArray(document?.categories) || !Array.isArray(document?.records)) {
      throw new Error(`BMW M3 section capture ${documentIndex + 1} is invalid.`);
    }
    if (seenSections.has(section.key)) throw new Error(`Duplicate BMW M3 ${section.label} section capture.`);
    seenSections.add(section.key);
    generatedTimes.push(generatedAt);
    const categoryCounts = new Map();
    for (const category of document.categories) {
      const name = clean(category?.name, 300);
      const count = Number(category?.count);
      if (!name || !Number.isSafeInteger(count) || count < 0 || categoryCounts.has(name)) {
        throw new Error(`BMW M3 ${section.label} category manifest is invalid.`);
      }
      categoryCounts.set(name, count);
    }
    if ([...categoryCounts.values()].reduce((total, count) => total + count, 0) !== document.records.length) {
      throw new Error(`BMW M3 ${section.label} capture does not reconcile with its category counts.`);
    }
    for (const [category, count] of categoryCounts) {
      const placements = document.records.filter(record => record?.category === category);
      const positions = placements.map(record => Number(record?.relevancePosition)).sort((left, right) => left - right);
      if (placements.length !== count || positions.some((position, index) => position !== index + 1)) {
        throw new Error(`BMW M3 ${section.label} capture positions do not reconcile for ${category}.`);
      }
    }
    if (document.records.some(record => record?.section !== section.label || record?.vehicle !== 'BMW M3')) {
      throw new Error(`BMW M3 ${section.label} capture contains a record outside its declared scope.`);
    }
    records.push(...document.records);
  }
  if (options.requireAllSections !== false) {
    const missing = Object.keys(BMW_M3_AGGREGATE_SECTIONS).filter(section => !seenSections.has(section));
    if (missing.length) throw new Error(`BMW M3 section captures are incomplete; missing: ${missing.join(', ')}.`);
  }
  return {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    kind: 'bmw-m3-aggregate-listing-capture',
    generatedAt: generatedTimes.sort().at(-1),
    records
  };
}

export function renderBmwM3AggregateModule(result) {
  const products = JSON.stringify(result.products, null, 2);
  const quarantine = JSON.stringify(result.quarantinedEcsIdentities, null, 2);
  return `// Generated offline from a validated, dated ECS BMW M3 model-level category capture.\n`
    + `export const BMW_M3_AGGREGATE_QUARANTINED_ECS_IDENTITIES = Object.freeze(${quarantine});\n`
    + `export const BMW_M3_AGGREGATE_PRODUCTS = Object.freeze(${products});\n`;
}

function options(name) {
  return process.argv.flatMap((value, index) => value === name ? [process.argv[index + 1]] : []).filter(Boolean);
}

async function writeAtomic(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}`;
  await writeFile(temporary, value, 'utf8');
  await rename(temporary, filename);
}

async function main() {
  const inputs = options('--input');
  const [output] = options('--output');
  const [report] = options('--report');
  const [mediaIndexPath] = options('--media-index');
  if (!inputs.length || !output || !report) {
    throw new Error('Usage: prepare-bmw-m3-aggregate.mjs --input <aggregate.json | repeat for all 7 section captures> [--media-index <media-index.json>] --output <products.js> --report <audit.json>');
  }
  const documents = await Promise.all(inputs.map(async input => JSON.parse(await readFile(path.resolve(input), 'utf8'))));
  const document = documents.length === 1 && documents[0]?.kind === 'bmw-m3-aggregate-listing-capture'
    ? documents[0]
    : combineBmwM3SectionCaptures(documents);
  const mediaIndex = mediaIndexPath
    ? JSON.parse(await readFile(path.resolve(mediaIndexPath), 'utf8'))
    : null;
  const result = prepareBmwM3AggregateCapture(document, { mediaIndex });
  await writeAtomic(path.resolve(output), renderBmwM3AggregateModule(result));
  await writeAtomic(path.resolve(report), `${JSON.stringify(result.audit, null, 2)}\n`);
  console.log(JSON.stringify({
    products: result.products.length,
    quarantinedIdentities: result.quarantinedEcsIdentities.length,
    invalidRecords: result.audit.invalidRecordCount
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
