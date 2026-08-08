import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

function options(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) values.push(process.argv[index + 1]);
  }
  return values;
}

function option(name) {
  return options(name)[0] || null;
}

async function main() {
  const inputs = options('--input');
  const output = option('--output');
  if (inputs.length < 1 || !output) {
    throw new Error('Usage: merge-media-indexes.mjs --input <media-index.json> [--input <media-index.json>] --output <media-index.json>');
  }

  const documents = await Promise.all(inputs.map(filename =>
    readFile(path.resolve(filename), 'utf8').then(JSON.parse)));
  const images = new Map();
  for (const [documentIndex, document] of documents.entries()) {
    if (document?.schemaVersion !== 1 || document?.supplier !== 'ECS Tuning'
      || !Array.isArray(document?.images)) {
      throw new Error(`Media index ${documentIndex + 1} is invalid.`);
    }
    for (const image of document.images) {
      const sourceUrl = String(image?.sourceUrl || '').trim();
      if (!sourceUrl) throw new Error('A media index contains an empty source URL.');
      const existing = images.get(sourceUrl);
      if (existing && existing.sha256 !== image.sha256) {
        throw new Error(`Conflicting media bytes were supplied for ${sourceUrl}.`);
      }
      if (!existing) images.set(sourceUrl, image);
    }
  }

  const generatedAt = documents.map(document => document.generatedAt)
    .filter(value => Number.isFinite(Date.parse(value))).sort().at(-1) || null;
  const merged = {
    schemaVersion: 1,
    supplier: 'ECS Tuning',
    generatedAt,
    images: [...images.values()].sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl))
  };
  const destination = path.resolve(output);
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  await rename(temporary, destination);
  console.log(JSON.stringify({ imageMappings: merged.images.length,
    uniqueFiles: new Set(merged.images.map(image => image.sha256)).size }));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
