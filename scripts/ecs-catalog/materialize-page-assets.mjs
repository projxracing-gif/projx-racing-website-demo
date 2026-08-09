import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const BROWSER_ASSET_ROOT = path.resolve(tmpdir(), 'browser-use', 'assets');
const ALLOWED_TYPES = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
});

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function officialImageUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:' || url.hostname !== 'assets.ecstuning.com'
      || url.username || url.password || url.port || url.search || url.hash) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function uint24le(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function webpSize(buffer) {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF'
    || buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
  const riffEnd = buffer.readUInt32LE(4) + 8;
  const chunkLength = buffer.readUInt32LE(16);
  if (riffEnd > buffer.length || 20 + chunkLength > buffer.length) return null;
  const kind = buffer.toString('ascii', 12, 16);
  if (kind === 'VP8X' && chunkLength >= 10) {
    return { width: uint24le(buffer, 24) + 1, height: uint24le(buffer, 27) + 1 };
  }
  if (kind === 'VP8L' && chunkLength >= 5 && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (kind === 'VP8 ' && chunkLength >= 10
    && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff
    };
  }
  return null;
}

function jpegSize(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) continue;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  return null;
}

function pngSize(buffer) {
  const signature = '89504e470d0a1a0a';
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== signature
    || buffer.readUInt32BE(8) !== 13 || buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function dimensions(buffer, type) {
  const value = type === 'image/webp' ? webpSize(buffer)
    : type === 'image/jpeg' ? jpegSize(buffer)
    : type === 'image/png' ? pngSize(buffer) : null;
  if (!value || !Number.isInteger(value.width) || !Number.isInteger(value.height)
    || value.width < 1 || value.height < 1 || value.width > 8_000 || value.height > 8_000) {
    throw new Error(`Could not verify ${type} dimensions.`);
  }
  return value;
}

async function main() {
  const input = option('--input');
  const outputDirectory = option('--output-dir');
  const indexPath = option('--index');
  if (!input || !outputDirectory || !indexPath) {
    throw new Error('Usage: materialize-page-assets.mjs --input <bundle-map.json> --output-dir <repo-directory> --index <media-index.json>');
  }
  const output = path.resolve(outputDirectory);
  const index = path.resolve(indexPath);
  if (!inside(REPO, output) || !inside(REPO, index)) throw new Error('Media output must stay inside the repository.');
  const document = JSON.parse(await readFile(path.resolve(input), 'utf8'));
  if (document?.schemaVersion !== 1 || document?.supplier !== 'ECS Tuning' || !Array.isArray(document.images)) {
    throw new Error('The browser media bundle map is invalid.');
  }
  await mkdir(output, { recursive: true });
  const seen = new Set();
  const images = [];
  for (const [position, item] of document.images.entries()) {
    const sourceUrl = officialImageUrl(item?.sourceUrl);
    const bundlePath = path.resolve(String(item?.bundlePath || ''));
    const contentType = String(item?.contentType || '').toLowerCase();
    if (!sourceUrl || seen.has(sourceUrl) || !inside(BROWSER_ASSET_ROOT, bundlePath)
      || !ALLOWED_TYPES[contentType] || !(await stat(bundlePath)).isFile()) {
      if (sourceUrl && seen.has(sourceUrl)) continue;
      throw new Error(`Media entry ${position + 1} failed validation.`);
    }
    seen.add(sourceUrl);
    const bytes = await readFile(bundlePath);
    if (bytes.length < 32 || bytes.length > 25_000_000) throw new Error(`Media entry ${position + 1} has an unsafe size.`);
    const size = dimensions(bytes, contentType);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const filename = `${sha256.slice(0, 24)}.${ALLOWED_TYPES[contentType]}`;
    const destination = path.join(output, filename);
    await writeFile(destination, bytes);
    images.push({
      sourceUrl,
      localPath: path.relative(REPO, destination).replaceAll('\\', '/'),
      width: size.width,
      height: size.height,
      contentType,
      sha256
    });
  }
  images.sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl));
  await mkdir(path.dirname(index), { recursive: true });
  const generatedAt = document.images.map(item => String(item?.observedAt || ''))
    .filter(value => Number.isFinite(Date.parse(value))).sort().at(-1) || null;
  const temporaryIndex = `${index}.tmp-${process.pid}`;
  await writeFile(temporaryIndex, `${JSON.stringify({
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    generatedAt,
    images
  }, null, 2)}\n`, 'utf8');
  await rename(temporaryIndex, index);
  console.log(JSON.stringify({ imageMappings: images.length, uniqueFiles: new Set(images.map(item => item.sha256)).size }));
}

export const __test = Object.freeze({ officialImageUrl, webpSize, jpegSize, pngSize, dimensions });

if (process.argv?.[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
