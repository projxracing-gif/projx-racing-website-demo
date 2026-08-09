import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { __test as imageValidation } from './materialize-page-assets.mjs';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const ECS_IMAGE_HOST = 'assets.ecstuning.com';
const ALLOWED_TYPES = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
});
const execFileAsync = promisify(execFile);

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function hasOption(name) {
  return process.argv.includes(name);
}

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function officialImageUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:' || url.hostname !== ECS_IMAGE_HOST
      || url.username || url.password || url.port || url.search || url.hash) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function ecsIdentity(record) {
  const source = String(record?.ecsPartNumber || '').trim();
  return source.match(/^(?:ES\s*#?\s*)?(\d{3,12})$/i)?.[1] || null;
}

function isQuarantinedRecord(record) {
  return record?.excludeFromCustomerFacing === true || record?.catalogueDisposition === 'quarantined';
}

function customerFacingRecords(records) {
  const identities = records.map(ecsIdentity);
  if (identities.some(identity => !identity)) {
    throw new Error('Every ECS media record must have a valid ECS identity.');
  }
  const quarantined = new Set(records
    .filter(isQuarantinedRecord)
    .map(ecsIdentity));
  return {
    records: records.filter((record, index) => !isQuarantinedRecord(record) && !quarantined.has(identities[index])),
    quarantinedIdentities: quarantined
  };
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, 'utf8'));
}

async function exists(filename) {
  try {
    return (await stat(filename)).isFile();
  } catch {
    return false;
  }
}

function createByteBudget(limit) {
  let used = 0;
  return Object.freeze({
    reserve(bytes) {
      if (!Number.isSafeInteger(bytes) || bytes < 1) throw new Error('Invalid ECS media byte count.');
      if (used + bytes > limit) {
        throw new Error(`ECS media download budget exceeded (${limit} bytes).`);
      }
      used += bytes;
    },
    get used() { return used; }
  });
}

function buildMediaPlan(records, existingImages = []) {
  const existingByUrl = new Map();
  for (const image of existingImages) {
    const sourceUrl = officialImageUrl(image?.sourceUrl);
    if (!sourceUrl) throw new Error('The existing ECS media index contains a non-official source URL.');
    const current = existingByUrl.get(sourceUrl);
    if (current && (current.localPath !== image.localPath || current.sha256 !== image.sha256)) {
      throw new Error(`The existing ECS media index conflicts for ${sourceUrl}.`);
    }
    if (!current) existingByUrl.set(sourceUrl, { ...image, sourceUrl });
  }
  const requestedByPrimaryUrl = new Map();
  const reusedByPrimaryUrl = new Map();
  for (const record of records) {
    const sourceUrl = officialImageUrl(record?.imageUrl) || officialImageUrl(record?.imageFallbackUrl);
    const fallbackUrl = officialImageUrl(record?.imageFallbackUrl);
    if (!sourceUrl) continue;
    const existingPrimary = existingByUrl.get(sourceUrl);
    const existingFallback = fallbackUrl ? existingByUrl.get(fallbackUrl) : null;
    if (existingPrimary) {
      reusedByPrimaryUrl.set(sourceUrl, existingPrimary);
      continue;
    }
    if (existingFallback) {
      reusedByPrimaryUrl.set(sourceUrl, {
        ...existingFallback,
        sourceUrl,
        downloadedFromUrl: fallbackUrl
      });
      continue;
    }
    const current = requestedByPrimaryUrl.get(sourceUrl);
    if (!current?.fallbackUrl || (fallbackUrl && fallbackUrl !== sourceUrl)) {
      requestedByPrimaryUrl.set(sourceUrl, {
        sourceUrl,
        fallbackUrl: fallbackUrl && fallbackUrl !== sourceUrl ? fallbackUrl : null
      });
    }
  }
  return {
    existingUrlCount: existingByUrl.size,
    requestedImages: [...requestedByPrimaryUrl.values()]
      .sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl)),
    reusedImages: [...reusedByPrimaryUrl.values()]
      .sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl))
  };
}

async function downloadImage(sourceUrl, outputDirectory, observedAt, byteBudget) {
  const sourceExtension = path.extname(new URL(sourceUrl).pathname).toLocaleLowerCase('en-US');
  const contentType = sourceExtension === '.webp' ? 'image/webp'
    : sourceExtension === '.jpg' || sourceExtension === '.jpeg' ? 'image/jpeg'
    : sourceExtension === '.png' ? 'image/png' : '';
  const fileExtension = ALLOWED_TYPES[contentType];
  if (!fileExtension) throw new Error(`Unsupported ECS media extension for ${sourceUrl}`);
  let stdout;
  try {
    ({ stdout } = await execFileAsync(process.platform === 'win32' ? 'curl.exe' : 'curl', [
      '--fail', '--silent', '--show-error', '--max-time', '30',
      '--retry', '4', '--retry-delay', '1', '--retry-all-errors',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
        + '(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
      '--referer', 'https://www.ecstuning.com/',
      '--header', 'Accept: image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5',
      '--output', '-', sourceUrl
    ], { encoding: 'buffer', maxBuffer: 25_000_000 }));
  } catch (error) {
    throw new Error(`ECS media request failed for ${sourceUrl}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const bytes = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  if (bytes.length < 32 || bytes.length > 25_000_000) {
    throw new Error(`Unsafe ECS media size for ${sourceUrl}`);
  }
  const size = imageValidation.dimensions(bytes, contentType);
  if (size.width < 100 || size.height < 100) {
    throw new Error(`ECS media is too small for a product card: ${sourceUrl}`);
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  byteBudget.reserve(bytes.length);
  const filename = `${sha256.slice(0, 24)}.${fileExtension}`;
  const destination = path.join(outputDirectory, filename);
  if (!(await exists(destination))) await writeFile(destination, bytes);
  return {
    sourceUrl,
    localPath: path.relative(REPO, destination).replaceAll('\\', '/'),
    width: size.width,
    height: size.height,
    contentType,
    sha256,
    observedAt,
    byteLength: bytes.length
  };
}

async function mapConcurrent(values, concurrency, mapper) {
  const output = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return output;
}

async function main() {
  const input = option('--input');
  const existingIndexPath = option('--existing-media-index');
  const outputDirectoryOption = option('--output-dir');
  const indexPathOption = option('--index');
  const allowMissing = hasOption('--allow-missing');
  const dryRun = hasOption('--dry-run');
  const concurrency = Math.min(8, Math.max(1, Number.parseInt(option('--concurrency') || '2', 10) || 2));
  const maxImages = Number.parseInt(option('--max-images') || '25000', 10);
  const maxTotalBytes = Number.parseInt(option('--max-total-bytes') || String(2 * 1024 * 1024 * 1024), 10);
  if (!input || !outputDirectoryOption || !indexPathOption) {
    throw new Error('Usage: materialize-remote-assets.mjs --input <capture.json> --output-dir <repo-directory> --index <media-index.json> [--existing-media-index <media-index.json>] [--allow-missing] [--dry-run] [--concurrency <1-8>] [--max-images <count>] [--max-total-bytes <bytes>]');
  }
  if (!Number.isSafeInteger(maxImages) || maxImages < 1 || maxImages > 100_000) {
    throw new Error('--max-images must be an integer from 1 to 100000.');
  }
  if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 1_000_000 || maxTotalBytes > 10_000_000_000) {
    throw new Error('--max-total-bytes must be an integer from 1000000 to 10000000000.');
  }
  const outputDirectory = path.resolve(outputDirectoryOption);
  const indexPath = path.resolve(indexPathOption);
  if (!inside(REPO, outputDirectory) || !inside(REPO, indexPath)) {
    throw new Error('Media output must stay inside the repository.');
  }
  const capture = await readJson(path.resolve(input));
  if (capture?.schemaVersion !== 1 || capture?.supplier !== 'ECS Tuning'
    || !Array.isArray(capture?.records) || capture.records.length < 1) {
    throw new Error('The ECS catalogue capture is invalid.');
  }
  const customerFacing = customerFacingRecords(capture.records);
  const existing = existingIndexPath
    ? await readJson(path.resolve(existingIndexPath))
    : { schemaVersion: 1, supplier: 'ECS Tuning', images: [] };
  if (existing?.schemaVersion !== 1 || existing?.supplier !== 'ECS Tuning'
    || !Array.isArray(existing?.images)) {
    throw new Error('The existing ECS media index is invalid.');
  }
  const observedAt = [...customerFacing.records.map(record => String(record?.observedAt || ''))]
    .filter(value => Number.isFinite(Date.parse(value))).sort().at(-1) || null;
  const mediaPlan = buildMediaPlan(customerFacing.records, existing.images);
  const { requestedImages, reusedImages } = mediaPlan;
  if (!observedAt) throw new Error('The ECS capture has no valid media observation timestamp.');
  if (requestedImages.length + reusedImages.length > maxImages) {
    throw new Error(`ECS media plan exceeds --max-images (${maxImages}).`);
  }
  if (dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      requestedImageCount: requestedImages.length,
      reusedImageMappings: reusedImages.length,
      totalImageMappings: requestedImages.length + reusedImages.length,
      existingMediaUrlCount: mediaPlan.existingUrlCount,
      quarantinedIdentityCount: customerFacing.quarantinedIdentities.size,
      maxImages,
      maxTotalBytes,
      generatedAt: observedAt
    }));
    return;
  }
  await mkdir(outputDirectory, { recursive: true });
  const byteBudget = createByteBudget(maxTotalBytes);
  const outcomes = await mapConcurrent(requestedImages, concurrency, async ({ sourceUrl, fallbackUrl }) => {
    try {
      return { image: await downloadImage(sourceUrl, outputDirectory, observedAt, byteBudget) };
    } catch (error) {
      if (fallbackUrl) {
        try {
          const fallbackImage = await downloadImage(fallbackUrl, outputDirectory, observedAt, byteBudget);
          return {
            image: {
              ...fallbackImage,
              sourceUrl,
              downloadedFromUrl: fallbackUrl
            }
          };
        } catch (fallbackError) {
          return { failure: {
            sourceUrl,
            fallbackUrl,
            reason: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
          } };
        }
      }
      return { failure: {
        sourceUrl,
        reason: error instanceof Error ? error.message : String(error)
      } };
    }
  });
  const images = outcomes.map(outcome => outcome.image).filter(Boolean);
  const failures = outcomes.map(outcome => outcome.failure).filter(Boolean);
  if (failures.length && !allowMissing) {
    throw new Error(`${failures.length} ECS media request(s) failed; rerun with --allow-missing to use the labelled supplier-media-unavailable fallback.`);
  }
  const document = {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    generatedAt: observedAt,
    images: [...reusedImages, ...images.map(({ observedAt: _ignored, byteLength: _bytes, ...image }) => image)]
      .sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl)),
    failures
  };
  await mkdir(path.dirname(indexPath), { recursive: true });
  const temporary = `${indexPath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  await rename(temporary, indexPath);
  console.log(JSON.stringify({
    requestedImageCount: requestedImages.length,
    downloadedImageMappings: images.length,
    reusedImageMappings: reusedImages.length,
    imageMappings: document.images.length,
    uniqueFiles: new Set(document.images.map(image => image.sha256)).size,
    failedImageCount: failures.length,
    existingMediaUrlCount: mediaPlan.existingUrlCount,
    downloadedBytes: byteBudget.used,
    maxImages,
    maxTotalBytes,
    quarantinedIdentityCount: customerFacing.quarantinedIdentities.size,
    generatedAt: observedAt
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export const __test = Object.freeze({
  officialImageUrl,
  inside,
  ecsIdentity,
  customerFacingRecords,
  buildMediaPlan,
  createByteBudget
});
