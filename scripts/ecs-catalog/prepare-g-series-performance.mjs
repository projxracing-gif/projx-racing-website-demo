import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const ECS_PRODUCT_HOST = 'www.ecstuning.com';
const ECS_IMAGE_HOST = 'assets.ecstuning.com';
const PRODUCT_PATH = /^\/b-[^/?#]+-parts\/[^/?#]+\/[^/?#]+\/$/i;
const SAFE_ASSET_PATH = /^assets\/products\/ecs\/g-series-performance\/[a-z0-9][a-z0-9._-]*\.(?:avif|jpe?g|png|webp)$/i;
const VEHICLES = Object.freeze({
  'BMW G87 M2 S58 3.0L': Object.freeze({ model: 'M2', trim: null, generation: 'G87' }),
  'BMW G80 M3 Competition S58 3.0L': Object.freeze({ model: 'M3', trim: 'Competition', generation: 'G80' }),
  'BMW G82 M4 Competition S58 3.0L': Object.freeze({ model: 'M4', trim: 'Competition', generation: 'G82' })
});
const VEHICLE_SOURCE_PATHS = Object.freeze({
  'BMW G87 M2 S58 3.0L': '/BMW-G87-M2-S58_3.0L/Performance/',
  'BMW G80 M3 Competition S58 3.0L': '/BMW-G80-M3_Competition-S58_3.0L/Performance/',
  'BMW G82 M4 Competition S58 3.0L': '/BMW-G82-M4_Competition-S58_3.0L/Performance/'
});
const ECS_PLACEHOLDER_IMAGE = 'https://assets.ecstuning.com/static/img/category/ecs_box_no_image.jpg';
const EXPECTED_CATEGORY_COUNTS = Object.freeze({
  'BMW G80 M3 Competition S58 3.0L': Object.freeze([251, 177, 116, 113, 76, 68, 50, 48, 18, 6, 3]),
  'BMW G82 M4 Competition S58 3.0L': Object.freeze([247, 176, 112, 115, 70, 70, 50, 49, 18, 6, 3]),
  'BMW G87 M2 S58 3.0L': Object.freeze([207, 158, 113, 100, 69, 65, 43, 32, 19, 6, 2])
});
const CATEGORY_AR = Object.freeze({
  'Performance Engine & Drivetrain Parts': 'أجزاء أداء المحرك ونظام الدفع',
  'Performance Exhaust Parts & Upgrades': 'أجزاء وترقيات عادم الأداء',
  'Performance Exterior Parts & Upgrades': 'أجزاء وترقيات الأداء الخارجية',
  'Interior Performance Parts & Upgrades': 'أجزاء وترقيات الأداء الداخلية',
  'Performance Suspension Parts & Upgrades': 'أجزاء وترقيات نظام التعليق',
  'Racing Safety Accessories': 'معدات السلامة للسباقات',
  'Performance Brake Parts & Upgrades': 'أجزاء وترقيات فرامل الأداء',
  'Performance Wheel Parts & Upgrades': 'أجزاء وترقيات عجلات الأداء',
  'Performance Software & Tuning': 'برامج وضبط الأداء',
  'Essential Performance Parts & Upgrades': 'أجزاء وترقيات الأداء الأساسية',
  'Performance Lighting Parts & Upgrades': 'أجزاء وترقيات إضاءة الأداء'
});
const CATEGORY_SOURCE_PATHS = Object.freeze({
  'Performance Engine & Drivetrain Parts': 'Engine_-or-_Drivetrain/',
  'Performance Exhaust Parts & Upgrades': 'Exhaust/',
  'Performance Exterior Parts & Upgrades': 'Exterior/',
  'Interior Performance Parts & Upgrades': 'Interior/',
  'Performance Suspension Parts & Upgrades': 'Suspension/',
  'Racing Safety Accessories': 'Racing_Safety_Accessories/',
  'Performance Brake Parts & Upgrades': 'Braking/',
  'Performance Wheel Parts & Upgrades': 'Wheels/',
  'Performance Software & Tuning': 'Software_-or-_Tuning/',
  'Essential Performance Parts & Upgrades': 'Essentials/',
  'Performance Lighting Parts & Upgrades': 'Lighting/'
});

function clean(value, maximum = 2_048) {
  return String(value ?? '').normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function supplierCopy(value, maximum = 5_000) {
  const entities = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' });
  const decoded = String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    const normalized = entity.toLowerCase();
    if (Object.hasOwn(entities, normalized)) return entities[normalized];
    const codePoint = normalized.startsWith('#x')
      ? Number.parseInt(normalized.slice(2), 16)
      : Number.parseInt(normalized.slice(1), 10);
    try {
      return Number.isInteger(codePoint) && codePoint > 0 ? String.fromCodePoint(codePoint) : ' ';
    } catch {
      return ' ';
    }
  });
  return clean(decoded
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/(?:\d+\s*[x×]\s*)?Entries For Our 25th Anniversary Sweepstakes!\s*/gi, ' ')
    .replace(/Call In Or Chat For Best Price!\s*/gi, ' ')
    .replace(/Want To Haggle\?\s*Give Us A Call Or Chat To Make An Offer On This Product!\s*/gi, ' '), maximum);
}

function slugify(value) {
  return clean(value, 500).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'product';
}

function canonicalUrl(value, hostname, pattern = null) {
  try {
    const parsed = new URL(clean(value, 4_096));
    if (parsed.protocol !== 'https:' || parsed.hostname !== hostname || parsed.username
      || parsed.password || parsed.port || parsed.search || parsed.hash
      || (pattern && !pattern.test(parsed.pathname))) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function observedAt(value) {
  const source = clean(value, 40);
  const milliseconds = Date.parse(source);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== source
    || milliseconds > Date.now() + 5 * 60 * 1_000) return null;
  return source;
}

function priceAmount(value) {
  const match = /^(?:Starting at )?\$([0-9][0-9,]*(?:\.\d{2})?) USD$/i.exec(clean(value, 300));
  if (!match) return null;
  const amount = Number(match[1].replaceAll(',', ''));
  return Number.isFinite(amount) && amount >= 0 ? Number(amount.toFixed(2)) : null;
}

function mediaMap(document) {
  if (document?.schemaVersion !== 1 || document?.supplier !== 'ECS Tuning') {
    throw new Error('The media index metadata is invalid.');
  }
  const entries = Array.isArray(document?.images) ? document.images : [];
  const result = new Map();
  for (const entry of entries) {
    const sourceUrl = canonicalUrl(entry?.sourceUrl, ECS_IMAGE_HOST);
    const localPath = clean(entry?.localPath, 500).replaceAll('\\', '/').replace(/^\/+/, '');
    const width = Number(entry?.width);
    const height = Number(entry?.height);
    const sha256 = clean(entry?.sha256, 64).toLowerCase();
    const contentType = clean(entry?.contentType, 40).toLowerCase();
    if (!sourceUrl || !SAFE_ASSET_PATH.test(localPath) || !Number.isInteger(width)
      || !Number.isInteger(height) || width < 100 || height < 100 || width > 8_000 || height > 8_000
      || !/^[a-f0-9]{64}$/.test(sha256) || !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
      throw new Error('The media index contains an invalid ECS product image.');
    }
    result.set(sourceUrl, { src: localPath, width, height, sourceUrl, sha256, contentType });
  }
  return result;
}

function validateRecord(record, index) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(`Record ${index + 1} is not an object.`);
  }
  const ecsDigits = clean(record.ecsPartNumber, 40).replace(/^ES#/i, '');
  const productUrl = canonicalUrl(record.productUrl, ECS_PRODUCT_HOST, PRODUCT_PATH);
  const imageUrl = canonicalUrl(record.imageUrl, ECS_IMAGE_HOST);
  const imageFallbackUrl = canonicalUrl(record.imageFallbackUrl, ECS_IMAGE_HOST);
  const vehicle = clean(record.vehicle, 160);
  const category = clean(record.category, 160);
  const sourceUrl = canonicalUrl(record.sourceUrl, ECS_PRODUCT_HOST);
  const timestamp = observedAt(record.observedAt);
  const price = priceAmount(record.priceText);
  let sourceMatchesScope = false;
  if (sourceUrl && VEHICLE_SOURCE_PATHS[vehicle] && CATEGORY_SOURCE_PATHS[category]) {
    const sourcePath = new URL(sourceUrl).pathname;
    const expectedPath = `${VEHICLE_SOURCE_PATHS[vehicle]}${CATEGORY_SOURCE_PATHS[category]}`;
    const pageSuffix = sourcePath.slice(expectedPath.length);
    sourceMatchesScope = sourcePath.startsWith(expectedPath)
      && (pageSuffix === '' || /^[1-9]\d*$/.test(pageSuffix));
  }
  if (!/^\d{4,12}$/.test(ecsDigits) || !productUrl || !imageUrl || !imageFallbackUrl
    || !VEHICLES[vehicle] || !CATEGORY_AR[category] || !sourceMatchesScope || !timestamp || price === null) {
    throw new Error(`Record ${index + 1} failed ECS source validation.`);
  }
  const required = ['title', 'manufacturerPartNumber', 'availabilityText'];
  for (const key of required) {
    if (!clean(record[key], key === 'description' ? 5_000 : 500)) {
      throw new Error(`Record ${index + 1} is missing ${key}.`);
    }
  }
  const position = Number(record.relevancePosition);
  if (!Number.isInteger(position) || position < 1 || position > 100_000) {
    throw new Error(`Record ${index + 1} has an invalid relevance position.`);
  }
  return {
    ...record,
    title: clean(record.title, 300),
    description: supplierCopy(record.description, 5_000),
    brand: clean(record.brand, 160),
    ecsDigits,
    manufacturerPartNumber: clean(record.manufacturerPartNumber, 160),
    price,
    availabilityText: clean(record.availabilityText, 300),
    shippingText: clean(record.shippingText, 300),
    productUrl,
    imageUrl,
    imageFallbackUrl,
    imageAlt: clean(record.imageAlt || record.title, 500),
    category,
    vehicle,
    sourceUrl,
    relevancePosition: position,
    observedAt: timestamp
  };
}

function validateCaptureCompleteness(document, records) {
  const expectedVehicles = Object.keys(VEHICLES);
  const expectedCategories = Object.keys(CATEGORY_AR);
  if (!Array.isArray(document.vehicleCategories)) {
    throw new Error('The ECS capture is missing its vehicle/category reconciliation manifest.');
  }
  const manifestVehicles = document.vehicleCategories.map(entry => clean(entry?.vehicle, 160));
  if (manifestVehicles.length !== expectedVehicles.length
    || new Set(manifestVehicles).size !== expectedVehicles.length
    || expectedVehicles.some(vehicle => !manifestVehicles.includes(vehicle))) {
    throw new Error('The ECS capture does not contain the complete requested G87/G80/G82 manifest.');
  }
  for (const vehicle of expectedVehicles) {
    for (const [categoryIndex, category] of expectedCategories.entries()) {
      const expectedCount = EXPECTED_CATEGORY_COUNTS[vehicle][categoryIndex];
      const matching = records.filter(record => record.vehicle === vehicle && record.category === category);
      const positions = new Set(matching.map(record => record.relevancePosition));
      if (matching.length !== expectedCount || positions.size !== expectedCount
        || [...positions].some(position => position < 1 || position > expectedCount)) {
        throw new Error(`The ECS capture does not reconcile ${vehicle} / ${category}.`);
      }
    }
  }
  for (const vehicleEntry of Array.isArray(document.vehicleCategories) ? document.vehicleCategories : []) {
    const vehicle = clean(vehicleEntry?.vehicle, 160);
    if (!VEHICLES[vehicle] || !Array.isArray(vehicleEntry.categories)) {
      throw new Error(`The ECS category manifest is invalid for ${vehicle || 'an unknown vehicle'}.`);
    }
    const manifestCategories = vehicleEntry.categories.map(entry => clean(entry?.name, 160));
    if (manifestCategories.length !== expectedCategories.length
      || new Set(manifestCategories).size !== expectedCategories.length
      || expectedCategories.some(category => !manifestCategories.includes(category))) {
      throw new Error(`The ECS category manifest is incomplete for ${vehicle}.`);
    }
    for (const categoryEntry of vehicleEntry.categories) {
      const category = clean(categoryEntry?.name, 160);
      const expectedIndex = expectedCategories.indexOf(category);
      const categoryUrl = canonicalUrl(categoryEntry?.url, ECS_PRODUCT_HOST);
      if (expectedIndex < 0 || !categoryUrl
        || Number(categoryEntry?.count) !== EXPECTED_CATEGORY_COUNTS[vehicle][expectedIndex]) {
        throw new Error(`The ECS category manifest conflicts with the captured scope for ${vehicle}.`);
      }
    }
  }
}

function fitmentFor(vehicle) {
  const details = VEHICLES[vehicle];
  return {
    make: 'BMW', model: details.model, models: [details.model], trim: details.trim, generation: details.generation,
    chassis: [details.generation], yearFrom: null, yearTo: null, engines: ['S58'], drivetrains: [],
    confidence: 'possible', evidence: 'ecs-vehicle-performance-category',
    note: 'Listed by ECS under this vehicle Performance category; confirm VIN, model year, engine, drivetrain and options before order.',
    noteAr: 'أدرجت ECS القطعة ضمن فئة الأداء لهذه السيارة؛ يجب تأكيد رقم الهيكل وسنة الصنع والمحرك ونظام الدفع والخيارات قبل الطلب.'
  };
}

function availabilityTextAr(value) {
  const source = clean(value, 300);
  if (/^in stock(?: at vendor)?$/i.test(source)) return 'متوفر لدى المورد';
  const businessDays = /^ships in (\d+) business days?$/i.exec(source);
  if (businessDays) return `يشحن المورد خلال ${businessDays[1]} أيام عمل`;
  const shipsOn = /^ships on (.+)$/i.exec(source);
  if (shipsOn) return `موعد شحن المورد المتوقع: ${shipsOn[1]}`;
  if (/back[ -]?ordered/i.test(source)) return 'طلب مؤجل لدى المورد';
  return source ? `حالة المورد: ${source}` : 'يلزم تأكيد حالة المورد';
}

function bestText(observations, key, maximum) {
  const value = observations.map(record => clean(record[key], maximum)).find(Boolean);
  return value || '';
}

function related(products, product) {
  return products.filter(candidate => candidate.slug !== product.slug).map(candidate => ({
    slug: candidate.slug,
    score: (candidate.category === product.category ? 4 : 0)
      + (candidate.brand === product.brand ? 2 : 0)
      + (candidate.fitments.some(fitment => product.fitments.some(item => item.generation === fitment.generation)) ? 1 : 0)
  })).filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.slug.localeCompare(right.slug))
    .slice(0, 4).map(candidate => candidate.slug);
}

export function prepareGSeriesPerformance(rawDocument, mediaDocument, {
  minimumProducts = 1,
  requireCompleteScope = true
} = {}) {
  if (!rawDocument || rawDocument.supplier !== 'ECS Tuning' || !Array.isArray(rawDocument.records)) {
    throw new Error('The ECS G-Series listing capture is invalid.');
  }
  if (!Number.isInteger(minimumProducts) || minimumProducts < 1) throw new Error('minimumProducts must be a positive integer.');
  const media = mediaMap(mediaDocument);
  const groups = new Map();
  const validatedRecords = rawDocument.records.map(validateRecord);
  if (requireCompleteScope) validateCaptureCompleteness(rawDocument, validatedRecords);
  validatedRecords.forEach(record => {
    groups.set(record.ecsDigits, [...(groups.get(record.ecsDigits) || []), record]);
  });
  const products = [];
  for (const [ecsDigits, observations] of groups) {
    const urls = new Set(observations.map(record => record.productUrl));
    const mpns = new Set(observations.map(record => record.manufacturerPartNumber.toLocaleLowerCase('en-US')));
    if (urls.size !== 1 || mpns.size !== 1) throw new Error(`Conflicting supplier identity for ES#${ecsDigits}.`);
    observations.sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt)
      || left.relevancePosition - right.relevancePosition);
    const current = observations[0];
    const preferredImageUrls = observations.flatMap(record => [record.imageUrl, record.imageFallbackUrl])
      .filter(url => url !== ECS_PLACEHOLDER_IMAGE);
    const sourceImage = preferredImageUrls.map(url => media.get(url)).find(Boolean);
    const image = sourceImage || media.get(ECS_PLACEHOLDER_IMAGE);
    if (!image) throw new Error(`Verified local media and the official ECS fallback are missing for ES#${ecsDigits}.`);
    const vehicles = [...new Set(observations.map(record => record.vehicle))];
    const categories = [...new Set(observations.map(record => record.category))];
    const category = categories[0];
    const checkedDate = current.observedAt.slice(0, 10);
    const slug = `es-${ecsDigits}`;
    const fitments = vehicles.map(fitmentFor);
    const brand = bestText(observations, 'brand', 160) || 'Supplier brand not provided';
    const supplierDescription = bestText(observations, 'description', 5_000);
    const description = supplierDescription || 'ECS did not provide a catalogue description for this listing. Confirm product details before order.';
    const descriptionAr = supplierDescription
      ? `وصف المورد الأصلي: ${supplierDescription}`
      : 'لم توفر ECS وصفاً لهذا المنتج في الكتالوج. يرجى تأكيد تفاصيل المنتج قبل الطلب.';
    const usesPlaceholder = image.sourceUrl === ECS_PLACEHOLDER_IMAGE || !sourceImage;
    const observedPrices = new Set(observations.map(record => record.price));
    const priceConflict = observedPrices.size > 1;
    const startingPrice = /^starting\s+at\b/i.test(current.priceText);
    const zeroPrice = current.price <= 0;
    const variablePrice = startingPrice || zeroPrice || priceConflict;
    const filters = {
      supplier: ['ecs'], makes: ['BMW'], models: [...new Set(fitments.flatMap(item => item.models))],
      chassis: [...new Set(fitments.flatMap(item => item.chassis))], years: [], engines: ['S58'], drivetrains: [],
      brands: [slugify(brand)], categories: categories.map(slugify),
      subcategories: [], availability: ['confirmation-required'], fitment: ['possible']
    };
    products.push({
      catalogType: 'product', provider: 'ECS Tuning', providerSlug: 'ecs',
      dataOrigin: 'authorized-public-vehicle-category-review', catalogueStatus: 'reviewed-partial',
      quoteOnly: variablePrice, purchaseMode: variablePrice ? 'request-price' : 'fitment-confirmation-required',
      slug, publicKey: `ecs-${slug}`,
      title: current.title, titleAr: current.title,
      summary: description, summaryAr: descriptionAr,
      description, descriptionAr,
      detailedDescriptionAvailable: Boolean(supplierDescription),
      brand, brandSlug: slugify(brand),
      category, categoryAr: CATEGORY_AR[category], categorySlug: slugify(category),
      subcategory: null, subcategoryAr: null, subcategorySlug: null,
      sku: `ES#${ecsDigits}`, ecsPartNumber: `ES#${ecsDigits}`, mpn: current.manufacturerPartNumber,
      identifiers: { ecs: `ES#${ecsDigits}`, sku: `ES#${ecsDigits}`, mpn: current.manufacturerPartNumber },
      priceAmount: zeroPrice || priceConflict ? null : current.price, priceCurrency: 'USD',
      priceStartingAt: startingPrice && !zeroPrice && !priceConflict,
      priceConflict,
      priceType: zeroPrice || priceConflict ? 'confirmation-required'
        : startingPrice ? 'supplier-public-retail-starting-at' : 'supplier-public-retail',
      projxSellingPrice: null, priceIncludesShipping: false, priceVerifiedAt: checkedDate,
      priceNote: priceConflict
        ? `Different public ECS prices were observed for this product across the requested vehicle categories on ${checkedDate}; confirm the applicable option and current price before order.`
        : `ECS public USD price observed ${checkedDate}; shipping, customs and Kuwait delivery are excluded and final sale requires confirmation.`,
      priceNoteAr: `سعر ECS العام بالدولار الأمريكي كما ظهر بتاريخ ${checkedDate}؛ لا يشمل الشحن والجمارك والتوصيل في الكويت ويلزم التأكيد قبل البيع.`,
      status: 'Supplier status — confirmation required', statusAr: 'حالة المورد — يلزم التأكيد',
      checkedAt: checkedDate, stockObservedAt: checkedDate, staleAfterDays: 7, stockPolicy: 'manual-confirm',
      availabilityCode: 'check_availability', observedAvailability: current.availabilityText,
      observedAvailabilityAr: availabilityTextAr(current.availabilityText),
      availabilityNote: 'Availability confirmation required. The dated supplier observation is not a live stock promise.',
      availabilityNoteAr: 'يلزم تأكيد التوفر. ملاحظة المورد المؤرخة لا تمثل وعداً مباشراً بالمخزون.',
      originalUrl: current.productUrl, imageSourceUrl: image.sourceUrl,
      imageStatus: usesPlaceholder ? 'supplier-media-unavailable' : 'supplier-media-verified',
      images: [{
        src: image.src,
        width: image.width,
        height: image.height,
        alt: usesPlaceholder ? `Product image not supplied by ECS for ${current.title}` : current.imageAlt,
        altAr: usesPlaceholder ? `لم توفر ECS صورة للمنتج: ${current.title}` : current.title
      }],
      fitmentStatus: 'supplier-vehicle-category-confirm', fitmentConfidence: 'possible', fitments, filters,
      specifications: [], options: [], variants: [],
      selectionEvidence: 'ecs-vehicle-category-relevance',
      selectionRank: Math.min(...observations.map(record => record.relevancePosition)),
      selectionNote: 'Listed in ECS vehicle Performance categories using the displayed Relevance order; ECS does not publish unit-sales ranking.',
      selectionNoteAr: 'مدرج ضمن فئات أداء السيارة لدى ECS وفق ترتيب الصلة الظاهر؛ لا تنشر ECS ترتيباً بحسب عدد الوحدات المباعة.',
      selectionSources: observations.map(record => ({
        vehicle: record.vehicle, category: record.category, sourceUrl: record.sourceUrl,
        relevancePosition: record.relevancePosition, observedAt: record.observedAt
      })),
      installation: { status: 'confirmation-required', note: 'Professional fitment review is required before order.' },
      shipping: {
        status: 'quote-required', origin: 'United States', observedSupplierMessage: current.shippingText || null,
        note: 'Shipping to Kuwait, customs and local delivery are confirmed separately before order.'
      },
      seo: { pageTitle: `${current.title} | Projx Racing`, metaDescription: description, path: `/parts/${slug}/` },
      relatedProductSlugs: []
    });
  }
  products.sort((left, right) => left.selectionRank - right.selectionRank || left.slug.localeCompare(right.slug));
  if (products.length < minimumProducts) throw new Error(`Only ${products.length} unique products were prepared; ${minimumProducts} are required.`);
  for (const product of products) product.relatedProductSlugs = related(products, product);
  return products;
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function verifyMediaIntegrity(document) {
  const indexed = mediaMap(document);
  for (const image of indexed.values()) {
    const absolute = path.resolve(REPO, image.src);
    if (!inside(REPO, absolute)) throw new Error('A media file resolves outside the repository.');
    let bytes;
    try {
      bytes = await readFile(absolute);
    } catch {
      throw new Error(`A verified media file is missing: ${image.src}`);
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== image.sha256) throw new Error(`A verified media file failed its SHA-256 check: ${image.src}`);
  }
}

async function writeAtomic(destination, value) {
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, value, 'utf8');
  await rename(temporary, destination);
}

async function main() {
  const input = option('--input');
  const mediaIndex = option('--media-index');
  const output = option('--output');
  const reportPath = option('--report');
  const minimumProducts = Number(option('--minimum-products') || 1);
  if (!input || !mediaIndex || !output) {
    throw new Error('Usage: prepare-g-series-performance.mjs --input <capture.json> --media-index <media.json> --output <module.js> [--report <report.json>] [--minimum-products <count>]');
  }
  const [rawDocument, mediaDocument] = await Promise.all([
    readFile(path.resolve(input), 'utf8').then(JSON.parse),
    readFile(path.resolve(mediaIndex), 'utf8').then(JSON.parse)
  ]);
  await verifyMediaIntegrity(mediaDocument);
  const products = prepareGSeriesPerformance(rawDocument, mediaDocument, { minimumProducts });
  const absoluteOutput = path.resolve(output);
  const relativeOutput = path.relative(REPO, absoluteOutput);
  if (relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput)) throw new Error('The generated module must stay inside the repository.');
  await mkdir(path.dirname(absoluteOutput), { recursive: true });
  const moduleBody = `// Generated from a validated, dated ECS vehicle-category capture.\nexport const ECS_G_SERIES_PERFORMANCE_PRODUCTS = Object.freeze(${JSON.stringify(products, null, 2)});\n`;
  await writeAtomic(absoluteOutput, moduleBody);
  const report = {
    schemaVersion: 1, supplier: 'ECS Tuning', generatedAt: observedAt(rawDocument.generatedAt),
    rawRecordCount: rawDocument.records.length, uniqueProductCount: products.length,
    duplicateObservationCount: rawDocument.records.length - products.length,
    imageCount: products.length,
    verifiedProductImageCount: products.filter(product => product.imageStatus === 'supplier-media-verified').length,
    placeholderImageCount: products.filter(product => product.imageStatus === 'supplier-media-unavailable').length,
    priceCount: products.filter(product => product.priceAmount !== null && Number.isFinite(product.priceAmount)).length,
    startingPriceCount: products.filter(product => product.priceStartingAt).length,
    requestPriceCount: products.filter(product => product.priceAmount === null).length,
    conflictingPriceCount: products.filter(product => product.priceConflict).length,
    missingDescriptionCount: products.filter(product => !product.detailedDescriptionAvailable).length,
    missingBrandCount: products.filter(product => product.brand === 'Supplier brand not provided').length,
    vehicleCounts: Object.fromEntries(Object.keys(VEHICLES).map(vehicle => [vehicle,
      products.filter(product => product.selectionSources.some(source => source.vehicle === vehicle)).length]))
  };
  if (reportPath) {
    const absoluteReport = path.resolve(reportPath);
    const relativeReport = path.relative(REPO, absoluteReport);
    if (relativeReport.startsWith('..') || path.isAbsolute(relativeReport)) throw new Error('The report must stay inside the repository.');
    await mkdir(path.dirname(absoluteReport), { recursive: true });
    await writeAtomic(absoluteReport, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
