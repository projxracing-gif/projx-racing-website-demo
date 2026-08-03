import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [inputArgument, checkedAtArgument, outputArgument] = process.argv.slice(2);

if (!inputArgument || !checkedAtArgument) {
  console.error('Usage: node scripts/build-tegiwa-stock-index.mjs <private-stock.csv> <YYYY-MM-DD> [output.json]');
  process.exit(1);
}

const input = path.resolve(inputArgument);
const output = outputArgument ? path.resolve(outputArgument) : path.join(repo, 'api', 'data', 'tegiwa-stock-index.json');
const checkedAt = String(checkedAtArgument);

if (!fs.existsSync(input) || !fs.statSync(input).isFile()) throw new Error('The private stock CSV was not found.');
if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedAt) || Number.isNaN(Date.parse(`${checkedAt}T00:00:00Z`))) {
  throw new Error('checkedAt must be a valid ISO date in YYYY-MM-DD format.');
}

const requiredHeaders = [
  'Title',
  'Variant SKU',
  'Variant Inventory Qty',
  'RRP Inc VAT',
  'External Supplier Stock',
  'External Supplier Lead Time'
];

const normalizeTitle = value => String(value || '')
  .normalize('NFKC')
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase('en-US');

const normalizeSku = value => String(value || '')
  .normalize('NFKC')
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase('en-US');

const publicKey = normalizedTitle => crypto
  .createHash('sha256')
  .update(normalizedTitle, 'utf8')
  .digest('base64url')
  .slice(0, 16);

function parsePence(value) {
  const normalized = String(value || '').trim().replace(/^£\s*/, '').replaceAll(',', '');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const pence = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  return Number.isSafeInteger(pence) && pence > 0 ? pence : null;
}

function quantitySignal(value, { allowCall = false } = {}) {
  const normalized = String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en-US');
  if (allowCall && normalized === 'call for availability') return 'check';
  if (/^\d+(?:\.0+)?\+$/.test(normalized)) return Number.parseFloat(normalized) > 0 ? 'positive' : 'zero';
  if (/^\d+(?:\.0+)?$/.test(normalized)) return Number.parseFloat(normalized) > 0 ? 'positive' : 'zero';
  if (/^-\d+(?:\.\d+)?$/.test(normalized) || normalized === '#n/a') return 'invalid';
  return normalized ? 'invalid' : 'zero';
}

function normalizeLeadTime(value) {
  const normalized = String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  let match = /^(\d{1,2})-(\d{1,2})\s+working\s+days$/i.exec(normalized);
  if (match) {
    const minimum = Number(match[1]);
    const maximum = Number(match[2]);
    if (minimum > 0 && maximum >= minimum && maximum <= 60) return `${minimum}-${maximum} working days`;
    return '';
  }
  match = /^(\d{1,2})(?:-(\d{1,2}))?\s+weeks?$/i.exec(normalized);
  if (match) {
    const minimum = Number(match[1]);
    const maximum = Number(match[2] || match[1]);
    if (minimum > 0 && maximum >= minimum && maximum <= 52) {
      return minimum === maximum ? `${minimum} ${minimum === 1 ? 'week' : 'weeks'}` : `${minimum}-${maximum} weeks`;
    }
  }
  return '';
}

function publicAvailability(localInventory, supplierInventory, safeLeadTime) {
  const local = quantitySignal(localInventory);
  const supplier = quantitySignal(supplierInventory, { allowCall: true });
  if (local === 'positive') return { statusCode: 1, leadTime: '' };
  if (supplier === 'positive') return { statusCode: 2, leadTime: safeLeadTime };
  if (local === 'invalid' || supplier === 'invalid' || supplier === 'check' || safeLeadTime) {
    return { statusCode: 3, leadTime: safeLeadTime };
  }
  return { statusCode: 0, leadTime: '' };
}

async function parseCsv(file, onRow) {
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  let field = '';
  let row = [];
  let quoted = false;
  let closingQuote = false;
  let skipLineFeed = false;
  let firstCharacter = true;

  const finishField = () => {
    row.push(field);
    field = '';
  };
  const finishRow = () => {
    finishField();
    onRow(row);
    row = [];
  };

  for await (const chunk of stream) {
    for (const rawCharacter of chunk) {
      let character = rawCharacter;
      if (firstCharacter) {
        firstCharacter = false;
        if (character === '\uFEFF') continue;
      }
      if (skipLineFeed) {
        skipLineFeed = false;
        if (character === '\n') continue;
      }
      if (quoted) {
        if (closingQuote) {
          if (character === '"') {
            field += '"';
            closingQuote = false;
            continue;
          }
          quoted = false;
          closingQuote = false;
        } else if (character === '"') {
          closingQuote = true;
          continue;
        } else {
          field += character;
          continue;
        }
        if (character !== ',' && character !== '\r' && character !== '\n') {
          throw new Error('Malformed CSV: unexpected content followed a closing quote.');
        }
      }
      if (character === '"') {
        if (field) throw new Error('Malformed CSV: a quoted field started after unquoted content.');
        quoted = true;
      } else if (character === ',') {
        finishField();
      } else if (character === '\r') {
        finishRow();
        skipLineFeed = true;
      } else if (character === '\n') {
        finishRow();
      } else {
        field += character;
      }
    }
  }

  if (quoted && !closingQuote) throw new Error('Malformed CSV: an unterminated quoted field reached end of file.');
  if (field || row.length) finishRow();
}

const productsByTitle = new Map();
const titleByHash = new Map();
let headers;
let headerIndexes;
let rowCount = 0;
let blankTitleRows = 0;
let blankSkuRows = 0;
let invalidPriceRows = 0;

await parseCsv(input, row => {
  if (!headers) {
    headers = row;
    headerIndexes = new Map(headers.map((header, index) => [header, index]));
    for (const required of requiredHeaders) {
      if (!headerIndexes.has(required)) throw new Error(`Required CSV column is missing: ${required}`);
    }
    return;
  }
  if (row.length === 1 && row[0] === '') return;
  if (row.length !== headers.length) throw new Error(`Malformed CSV: row ${rowCount + 2} has ${row.length} fields instead of ${headers.length}.`);
  rowCount += 1;

  const get = header => row[headerIndexes.get(header)] || '';
  const normalizedTitle = normalizeTitle(get('Title'));
  if (!normalizedTitle) {
    blankTitleRows += 1;
    return;
  }
  const hash = publicKey(normalizedTitle);
  const priorTitle = titleByHash.get(hash);
  if (priorTitle && priorTitle !== normalizedTitle) throw new Error(`Public title-hash collision detected for key ${hash}; no output was written.`);
  titleByHash.set(hash, normalizedTitle);

  let product = productsByTitle.get(normalizedTitle);
  if (!product) {
    product = { hash, variants: new Map() };
    productsByTitle.set(normalizedTitle, product);
  }

  const sku = normalizeSku(get('Variant SKU'));
  if (!sku) {
    blankSkuRows += 1;
    return;
  }
  let variant = product.variants.get(sku);
  if (!variant) {
    variant = { signature: '', ambiguous: false, invalidPrice: false, value: null };
    product.variants.set(sku, variant);
  }

  const pricePence = parsePence(get('RRP Inc VAT'));
  if (pricePence === null) {
    variant.invalidPrice = true;
    invalidPriceRows += 1;
    return;
  }
  const safeLeadTime = normalizeLeadTime(get('External Supplier Lead Time'));
  const availability = publicAvailability(
    get('Variant Inventory Qty'),
    get('External Supplier Stock'),
    safeLeadTime
  );
  const signature = `${pricePence}|${availability.statusCode}|${availability.leadTime}`;
  if (variant.invalidPrice || (variant.signature && variant.signature !== signature)) {
    variant.ambiguous = true;
    return;
  }
  variant.signature = signature;
  variant.value = { pricePence, ...availability };
});

const productRows = [];
let quarantinedVariants = 0;
let excludedProducts = 0;

for (const product of productsByTitle.values()) {
  const variants = [];
  for (const variant of product.variants.values()) {
    if (variant.invalidPrice || variant.ambiguous || !variant.value) {
      quarantinedVariants += 1;
      continue;
    }
    variants.push(variant.value);
  }
  if (!variants.length) {
    excludedProducts += 1;
    continue;
  }

  const prices = variants.map(variant => variant.pricePence);
  const statusCode = variants.some(variant => variant.statusCode === 1) ? 1
    : variants.some(variant => variant.statusCode === 2) ? 2
      : variants.some(variant => variant.statusCode === 3) ? 3
        : 0;
  const matchingLeads = new Set(
    variants
      .filter(variant => variant.statusCode === statusCode && variant.leadTime)
      .map(variant => variant.leadTime)
  );
  productRows.push({
    hash: product.hash,
    minPence: Math.min(...prices),
    maxPence: Math.max(...prices),
    statusCode,
    leadTime: matchingLeads.size === 1 ? [...matchingLeads][0] : ''
  });
}

const leadTimes = [
  '',
  ...new Set(productRows.map(product => product.leadTime).filter(Boolean))
];
leadTimes.splice(1, leadTimes.length - 1, ...leadTimes.slice(1).sort((a, b) => a.localeCompare(b, 'en')));
const leadTimeIndexes = new Map(leadTimes.map((leadTime, index) => [leadTime, index]));
const products = Object.create(null);

for (const product of productRows.sort((a, b) => a.hash.localeCompare(b.hash, 'en'))) {
  if (Object.hasOwn(products, product.hash)) throw new Error(`Duplicate public product key detected: ${product.hash}`);
  products[product.hash] = [
    product.minPence,
    product.maxPence,
    product.statusCode,
    leadTimeIndexes.get(product.leadTime) || 0
  ];
}

const publicIndex = {
  version: 1,
  checkedAt,
  productCount: productRows.length,
  availableProductCount: productRows.filter(product => product.statusCode === 1 || product.statusCode === 2).length,
  leadTimes,
  products
};

fs.mkdirSync(path.dirname(output), { recursive: true });
const temporaryOutput = `${output}.tmp`;
fs.writeFileSync(temporaryOutput, `${JSON.stringify(publicIndex)}\n`, 'utf8');
fs.renameSync(temporaryOutput, output);

console.log(`Public Tegiwa stock index written with ${publicIndex.productCount} products and ${publicIndex.availableProductCount} available products.`);
console.log(`Processed ${rowCount} private rows; quarantined ${quarantinedVariants} ambiguous/invalid-price variants, ${blankSkuRows} blank-SKU rows and ${invalidPriceRows} invalid/zero-price rows.`);
console.log(`Excluded ${excludedProducts} products without a safe variant; ignored ${blankTitleRows} blank-title rows; verified ${titleByHash.size} unique title hashes with zero collisions.`);
console.log(`Output: ${path.relative(repo, output)} (${fs.statSync(output).size} bytes).`);
