#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chunkByJsonBytes,
  DEFAULT_BATCH_BYTES,
  DEFAULT_BATCH_ROWS,
  deterministicImportUuid,
  MAX_BATCH_BYTES,
  MAX_BATCH_ROWS,
  resumeRequiresFullReplay,
  safeJsonForDatabase,
  validateImportCounts
} from './lib.mjs';
import { createNeonHttpClient } from './neon-http.mjs';
import { preflightTegiwaSource } from './source.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoDirectory = path.resolve(scriptDirectory, '..', '..');

const HELP = `
Import the approved local Tegiwa snapshot into the unified Neon catalogue.

Usage:
  node scripts/neon-catalog/import-tegiwa.mjs --dry-run
  DATABASE_URL=postgresql://... node scripts/neon-catalog/import-tegiwa.mjs

Options:
  --dry-run                 Validate every local artifact and report expected rows without database access.
  --batch-size <rows>       Products per request (default ${DEFAULT_BATCH_ROWS}, maximum ${MAX_BATCH_ROWS}).
  --max-batch-bytes <bytes> Maximum JSON payload per request (default ${DEFAULT_BATCH_BYTES}, maximum ${MAX_BATCH_BYTES}).
  --help                    Show this help.

Safety:
  - DATABASE_URL is read from the environment and is never printed or written.
  - Progress checkpoints are written below ignored private-imports/neon-catalog/.
  - The importer is idempotent and can replay a committed batch after interruption.
  - catalog_state is changed only after exact database counts pass validation.
`;

export const BATCH_SQL = `
WITH input AS (
  SELECT *
  FROM jsonb_to_recordset($3::jsonb) AS i(
    public_key text,
    supplier_product_key text,
    source_handle text,
    source_url text,
    title text,
    brand_slug text,
    brand_name text,
    checked_at text,
    browse_rank bigint,
    variant_key text,
    variant_title text,
    currency text,
    price_minor bigint,
    availability_code text,
    lead_time text,
    price_checked_at text,
    stock_checked_at text,
    stock_expires_at text,
    image_url text,
    image_alt_en text,
    title_sort text,
    search_text text,
    vehicle_text text,
    skus jsonb,
    normalized_skus jsonb,
    mpns jsonb,
    normalized_mpns jsonb
  )
), input_brands AS (
  SELECT DISTINCT ON (brand_slug) brand_slug, brand_name
  FROM input
  ORDER BY brand_slug, brand_name
), brand_resolve AS (
  INSERT INTO brands (slug, name)
  SELECT brand_slug, brand_name
  FROM input_brands
  ON CONFLICT (slug) DO UPDATE SET name = brands.name
  RETURNING id, slug
), product_upsert AS (
  INSERT INTO products (
    import_id, supplier_id, public_key, supplier_product_key, source_handle, source_url,
    item_type, title, brand_id, active, checked_at, browse_rank
  )
  SELECT
    $1::uuid, $2::bigint, i.public_key, i.supplier_product_key, i.source_handle, i.source_url,
    'product', i.title, b.id, true, i.checked_at::timestamptz, i.browse_rank
  FROM input i
  JOIN brand_resolve b ON b.slug = i.brand_slug
  ON CONFLICT (import_id, supplier_product_key) DO UPDATE SET
    public_key = EXCLUDED.public_key,
    source_handle = EXCLUDED.source_handle,
    source_url = EXCLUDED.source_url,
    title = EXCLUDED.title,
    brand_id = EXCLUDED.brand_id,
    active = true,
    checked_at = EXCLUDED.checked_at,
    browse_rank = EXCLUDED.browse_rank
  RETURNING id, supplier_product_key
), variant_upsert AS (
  INSERT INTO variants (product_id, supplier_variant_key, title, position, active)
  SELECT p.id, i.variant_key, i.variant_title, 0, true
  FROM product_upsert p
  JOIN input i USING (supplier_product_key)
  ON CONFLICT (product_id, supplier_variant_key) DO UPDATE SET
    title = EXCLUDED.title,
    position = EXCLUDED.position,
    active = true
  RETURNING id, product_id, supplier_variant_key
), sku_input AS (
  SELECT p.id AS product_id, v.id AS variant_id, s.value, ns.normalized_value
  FROM product_upsert p
  JOIN input i USING (supplier_product_key)
  JOIN variant_upsert v ON v.product_id = p.id AND v.supplier_variant_key = i.variant_key
  CROSS JOIN LATERAL jsonb_array_elements_text(i.skus) WITH ORDINALITY AS s(value, ordinal)
  JOIN LATERAL jsonb_array_elements_text(i.normalized_skus) WITH ORDINALITY AS ns(normalized_value, ordinal)
    ON ns.ordinal = s.ordinal
), mpn_input AS (
  SELECT p.id AS product_id, v.id AS variant_id, m.value, nm.normalized_value
  FROM product_upsert p
  JOIN input i USING (supplier_product_key)
  JOIN variant_upsert v ON v.product_id = p.id AND v.supplier_variant_key = i.variant_key
  CROSS JOIN LATERAL jsonb_array_elements_text(i.mpns) WITH ORDINALITY AS m(value, ordinal)
  JOIN LATERAL jsonb_array_elements_text(i.normalized_mpns) WITH ORDINALITY AS nm(normalized_value, ordinal)
    ON nm.ordinal = m.ordinal
), identifier_rows AS (
  SELECT product_id, variant_id, 'sku', value, normalized_value FROM sku_input
  UNION ALL
  SELECT product_id, variant_id, 'mpn', value, normalized_value FROM mpn_input
), identifier_upsert AS (
  INSERT INTO product_identifiers (product_id, variant_id, kind, value, normalized_value)
  SELECT * FROM identifier_rows
  ON CONFLICT (product_id, variant_id, kind, normalized_value) DO UPDATE SET value = EXCLUDED.value
  RETURNING id, kind
), offer_upsert AS (
  INSERT INTO offers (
    variant_id, currency, price_minor, availability_code, lead_time,
    price_checked_at, stock_checked_at, stock_expires_at
  )
  SELECT
    v.id, i.currency::char(3), i.price_minor, i.availability_code, i.lead_time,
    i.price_checked_at::timestamptz, i.stock_checked_at::timestamptz, i.stock_expires_at::timestamptz
  FROM product_upsert p
  JOIN input i USING (supplier_product_key)
  JOIN variant_upsert v ON v.product_id = p.id AND v.supplier_variant_key = i.variant_key
  ON CONFLICT (variant_id, currency) DO UPDATE SET
    price_minor = EXCLUDED.price_minor,
    availability_code = EXCLUDED.availability_code,
    lead_time = EXCLUDED.lead_time,
    price_checked_at = EXCLUDED.price_checked_at,
    stock_checked_at = EXCLUDED.stock_checked_at,
    stock_expires_at = EXCLUDED.stock_expires_at
  RETURNING id
), image_upsert AS (
  INSERT INTO product_images (product_id, position, url, alt_en)
  SELECT p.id, 0, i.image_url, i.image_alt_en
  FROM product_upsert p
  JOIN input i USING (supplier_product_key)
  WHERE i.image_url IS NOT NULL
  ON CONFLICT (product_id, position) DO UPDATE SET url = EXCLUDED.url, alt_en = EXCLUDED.alt_en
  RETURNING id
), search_upsert AS (
  INSERT INTO product_search (product_id, supplier_id, title_sort, search_text, vehicle_text, browse_rank)
  SELECT p.id, $2::bigint, i.title_sort, i.search_text, i.vehicle_text, i.browse_rank
  FROM product_upsert p
  JOIN input i USING (supplier_product_key)
  ON CONFLICT (product_id) DO UPDATE SET
    supplier_id = EXCLUDED.supplier_id,
    title_sort = EXCLUDED.title_sort,
    search_text = EXCLUDED.search_text,
    vehicle_text = EXCLUDED.vehicle_text,
    browse_rank = EXCLUDED.browse_rank
  RETURNING product_id
)
SELECT
  (SELECT count(*) FROM product_upsert) AS products,
  (SELECT count(*) FROM variant_upsert) AS variants,
  (SELECT count(*) FROM identifier_upsert) AS identifiers,
  (SELECT count(*) FROM offer_upsert) AS offers,
  (SELECT count(*) FROM image_upsert) AS images,
  (SELECT count(*) FROM search_upsert) AS search_rows;
`;

const COUNT_SQL = `
SELECT
  count(DISTINCT p.id) AS products,
  count(DISTINCT v.id) AS variants,
  count(DISTINCT o.id) AS offers,
  count(DISTINCT pi.id) AS images,
  count(DISTINCT ps.product_id) AS search_rows,
  count(DISTINCT i.id) FILTER (WHERE i.kind = 'sku') AS sku_identifiers,
  count(DISTINCT i.id) FILTER (WHERE i.kind = 'mpn') AS mpn_identifiers,
  count(DISTINCT o.id) FILTER (WHERE o.price_minor IS NOT NULL) AS priced_offers,
  count(DISTINCT o.id) FILTER (WHERE o.availability_code IN ('in_stock', 'supplier_stock')) AS available_offers,
  count(DISTINCT p.brand_id) AS distinct_brands
FROM products p
LEFT JOIN variants v ON v.product_id = p.id
LEFT JOIN offers o ON o.variant_id = v.id
LEFT JOIN product_images pi ON pi.product_id = p.id
LEFT JOIN product_search ps ON ps.product_id = p.id
LEFT JOIN product_identifiers i ON i.product_id = p.id
WHERE p.import_id = $1::uuid AND p.supplier_id = $2::bigint;
`;

export const PUBLISH_LOCK_SQL = `
SELECT pg_advisory_xact_lock(hashtextextended('projx-catalog-publish:' || $1::text, 0)) AS locked;
`;

export const PUBLISH_SQL = `
WITH supplier_lock AS MATERIALIZED (
  SELECT pg_advisory_xact_lock(hashtextextended('projx-catalog-publish:' || $2::text, 0)) AS locked
), current_state AS MATERIALIZED (
  SELECT cs.current_import_id
  FROM supplier_lock
  LEFT JOIN catalog_state cs ON cs.supplier_id = $2::bigint
), current_import AS MATERIALIZED (
  SELECT
    ci.id,
    ci.started_at,
    COALESCE(
      NULLIF(ci.validation_summary ->> 'catalogGeneratedAt', '')::timestamptz,
      '-infinity'::timestamptz
    ) AS catalog_generated_at
  FROM current_state state
  LEFT JOIN catalog_imports ci ON ci.id = state.current_import_id
), candidate AS MATERIALIZED (
  SELECT ci.*, $4::timestamptz AS catalog_generated_at
  FROM supplier_lock
  JOIN catalog_imports ci ON ci.id = $1::uuid AND ci.supplier_id = $2::bigint
), actual AS (
  SELECT
    count(DISTINCT p.id) AS products,
    count(DISTINCT v.id) AS variants,
    count(DISTINCT o.id) AS offers,
    count(DISTINCT pi.id) AS images,
    count(DISTINCT ps.product_id) AS search_rows,
    count(DISTINCT i.id) FILTER (WHERE i.kind = 'sku') AS sku_identifiers,
    count(DISTINCT i.id) FILTER (WHERE i.kind = 'mpn') AS mpn_identifiers,
    count(DISTINCT o.id) FILTER (WHERE o.price_minor IS NOT NULL) AS priced_offers,
    count(DISTINCT o.id) FILTER (WHERE o.availability_code IN ('in_stock', 'supplier_stock')) AS available_offers,
    count(DISTINCT p.brand_id) AS distinct_brands
  FROM supplier_lock
  CROSS JOIN products p
  LEFT JOIN variants v ON v.product_id = p.id
  LEFT JOIN offers o ON o.variant_id = v.id
  LEFT JOIN product_images pi ON pi.product_id = p.id
  LEFT JOIN product_search ps ON ps.product_id = p.id
  LEFT JOIN product_identifiers i ON i.product_id = p.id
  WHERE p.import_id = $1::uuid AND p.supplier_id = $2::bigint
), eligible AS (
  SELECT a.*
  FROM actual a, candidate ci, current_state state, current_import current
  WHERE a.products = ($3::jsonb ->> 'products')::bigint
    AND a.variants = ($3::jsonb ->> 'variants')::bigint
    AND a.offers = ($3::jsonb ->> 'offers')::bigint
    AND a.images = ($3::jsonb ->> 'images')::bigint
    AND a.search_rows = ($3::jsonb ->> 'searchRows')::bigint
    AND a.sku_identifiers = ($3::jsonb ->> 'skuIdentifiers')::bigint
    AND a.mpn_identifiers = ($3::jsonb ->> 'mpnIdentifiers')::bigint
    AND a.priced_offers = ($3::jsonb ->> 'pricedOffers')::bigint
    AND a.available_offers = ($3::jsonb ->> 'availableOffers')::bigint
    AND a.distinct_brands = ($3::jsonb ->> 'distinctBrands')::bigint
    AND (
      ci.status = 'validated'
      OR (ci.status = 'published' AND state.current_import_id = $1::uuid)
    )
    AND (
      state.current_import_id IS NULL
      OR state.current_import_id = $1::uuid
      OR (
        (
          ci.catalog_generated_at > current.catalog_generated_at
          OR (
            ci.catalog_generated_at = current.catalog_generated_at
            AND ci.started_at >= current.started_at
          )
        )
        AND (
          state.current_import_id IS NOT DISTINCT FROM $5::uuid
          OR ci.catalog_generated_at > current.catalog_generated_at
          OR (
            ci.catalog_generated_at = current.catalog_generated_at
            AND ci.started_at > current.started_at
          )
        )
      )
    )
), state_upsert AS (
  INSERT INTO catalog_state (supplier_id, current_import_id, published_at)
  SELECT $2::bigint, $1::uuid, now() FROM eligible
  ON CONFLICT (supplier_id) DO UPDATE SET current_import_id = EXCLUDED.current_import_id, published_at = now()
  RETURNING current_import_id, published_at
), published AS (
  UPDATE catalog_imports
  SET status = 'published', finished_at = now()
  WHERE id = $1::uuid AND supplier_id = $2::bigint AND EXISTS (SELECT 1 FROM state_upsert)
  RETURNING id
), retired AS (
  UPDATE catalog_imports
  SET status = 'retired'
  WHERE id = (SELECT current_import_id FROM current_state)
    AND id <> $1::uuid
    AND EXISTS (SELECT 1 FROM state_upsert)
  RETURNING id
)
SELECT
  (SELECT count(*) FROM published) AS published,
  (SELECT current_import_id FROM state_upsert) AS current_import_id,
  (SELECT published_at FROM state_upsert) AS published_at,
  (SELECT count(*) FROM retired) AS retired;
`;

function parseInteger(value, label, minimum, maximum) {
  if (!/^\d+$/.test(String(value || ''))) throw new Error(`${label} must be an integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

export function parseArguments(argv) {
  const options = {
    dryRun: false,
    help: false,
    batchSize: DEFAULT_BATCH_ROWS,
    maxBatchBytes: DEFAULT_BATCH_BYTES
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--batch-size') options.batchSize = parseInteger(argv[++index], '--batch-size', 1, MAX_BATCH_ROWS);
    else if (argument.startsWith('--batch-size=')) options.batchSize = parseInteger(argument.slice(13), '--batch-size', 1, MAX_BATCH_ROWS);
    else if (argument === '--max-batch-bytes') options.maxBatchBytes = parseInteger(argv[++index], '--max-batch-bytes', 1_024, MAX_BATCH_BYTES);
    else if (argument.startsWith('--max-batch-bytes=')) options.maxBatchBytes = parseInteger(argument.slice(18), '--max-batch-bytes', 1_024, MAX_BATCH_BYTES);
    else throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

function checkpointPath(fingerprint) {
  return path.join(repoDirectory, 'private-imports', 'neon-catalog', `tegiwa-${fingerprint.slice(0, 16)}.json`);
}

function readCheckpoint(file, fingerprint, importId) {
  if (!fs.existsSync(file)) return null;
  let checkpoint;
  try {
    checkpoint = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error('The local Tegiwa import checkpoint is unreadable.');
  }
  if (checkpoint?.version !== 2 || checkpoint.fingerprint !== fingerprint || checkpoint.importId !== importId
    || !(checkpoint.baseCurrentImportId === null || /^[a-f0-9-]{36}$/i.test(String(checkpoint.baseCurrentImportId)))
    || !Number.isInteger(checkpoint.nextShard) || checkpoint.nextShard < 0
    || !Number.isInteger(checkpoint.nextOffset) || checkpoint.nextOffset < 0
    || !Number.isInteger(checkpoint.completedProducts) || checkpoint.completedProducts < 0) {
    throw new Error('The local Tegiwa import checkpoint does not match this source snapshot.');
  }
  return checkpoint;
}

function writeCheckpoint(file, checkpoint) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ ...checkpoint, updatedAt: new Date().toISOString() }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
}

function countRow(row) {
  const aliases = {
    products: 'products',
    variants: 'variants',
    offers: 'offers',
    images: 'images',
    searchRows: 'search_rows',
    skuIdentifiers: 'sku_identifiers',
    mpnIdentifiers: 'mpn_identifiers',
    pricedOffers: 'priced_offers',
    availableOffers: 'available_offers',
    distinctBrands: 'distinct_brands'
  };
  return Object.fromEntries(Object.entries(aliases).map(([key, field]) => [key, Number(row?.[field])]));
}

function printPreflight(source, dryRun) {
  const report = {
    mode: dryRun ? 'dry-run' : 'import',
    importFormatVersion: source.importFormatVersion,
    sourceFingerprint: source.fingerprint,
    generatedAt: source.catalogSummary.generatedAt,
    stockCheckedAt: source.stockSummary.checkedAt,
    priceBasis: 'GBP; source snapshot already excludes UK VAT and is not adjusted again',
    expectedRows: source.expected,
    sourceAudit: source.audit
  };
  console.log(JSON.stringify(report, null, 2));
}

async function ensureSupplierAndImport(client, source, importId) {
  const sourceReference = `tegiwa-local-snapshot:sha256:${source.fingerprint}`;
  const initialSummary = JSON.stringify({
    sourceFingerprint: source.fingerprint,
    importFormatVersion: source.importFormatVersion,
    expected: source.expected,
    audit: source.audit,
    catalogGeneratedAt: source.catalogSummary.generatedAt,
    stockCheckedAt: source.stockSummary.checkedAt,
    priceBasis: 'gbp_ex_uk_vat'
  });
  const supplierResult = await client.query(`
    INSERT INTO suppliers (slug, display_name, default_currency, source_url, updated_at)
    VALUES ('tegiwa', 'Tegiwa', 'GBP', 'https://www.tegiwa.com/', now())
    ON CONFLICT (slug) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      default_currency = EXCLUDED.default_currency,
      source_url = EXCLUDED.source_url,
      updated_at = now()
    RETURNING id;
  `);
  const supplierId = supplierResult.rows[0]?.id;
  if (!supplierId) throw new Error('The Tegiwa supplier row could not be resolved.');
  const [, importResult] = await client.transaction([
    {
      query: `
        INSERT INTO catalog_imports (id, supplier_id, status, source_reference, validation_summary)
        VALUES ($1::uuid, $2::bigint, 'staging', $3, $4::jsonb)
        ON CONFLICT (id) DO NOTHING;
      `,
      params: [importId, supplierId, sourceReference, initialSummary]
    },
    {
      query: `
        SELECT ci.id, ci.supplier_id, ci.status, ci.source_reference, cs.current_import_id
        FROM catalog_imports ci
        LEFT JOIN catalog_state cs ON cs.supplier_id = ci.supplier_id
        WHERE ci.id = $1::uuid;
      `,
      params: [importId]
    }
  ]);
  const importRow = importResult.rows[0];
  if (!importRow || String(importRow.supplier_id) !== String(supplierId) || importRow.source_reference !== sourceReference) {
    throw new Error('The deterministic Tegiwa import ID is already associated with different source data.');
  }
  return { supplierId, importRow };
}

async function databaseCounts(client, importId, supplierId) {
  const result = await client.query(COUNT_SQL, [importId, supplierId]);
  if (result.rows.length !== 1) throw new Error('The staged catalogue count query returned no result.');
  return countRow(result.rows[0]);
}

async function importSource(options, source) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required unless --dry-run is used.');
  const client = createNeonHttpClient({ databaseUrl });
  const importId = deterministicImportUuid(source.fingerprint);
  const file = checkpointPath(source.fingerprint);
  const { supplierId, importRow } = await ensureSupplierAndImport(client, source, importId);
  const status = String(importRow.status);
  if (status === 'published') {
    if (String(importRow.current_import_id) !== importId) throw new Error('This import is published but is not the current Tegiwa catalogue state.');
    validateImportCounts(source.expected, await databaseCounts(client, importId, supplierId));
    console.log(`Tegiwa snapshot ${source.fingerprint.slice(0, 16)} is already published and valid.`);
    return;
  }
  if (!['staging', 'validated'].includes(status)) throw new Error(`Tegiwa import cannot resume from status ${status}.`);

  let checkpoint = readCheckpoint(file, source.fingerprint, importId) || {
    version: 2,
    supplier: 'tegiwa',
    fingerprint: source.fingerprint,
    importId,
    baseCurrentImportId: importRow.current_import_id || null,
    nextShard: 0,
    nextOffset: 0,
    completedProducts: 0,
    completed: false
  };
  if (checkpoint.nextShard > source.catalogSummary.shardCount) throw new Error('The checkpoint is beyond the final Tegiwa shard.');
  if (checkpoint.nextShard === source.catalogSummary.shardCount && checkpoint.nextOffset !== 0) {
    throw new Error('The completed Tegiwa checkpoint has a nonzero shard offset.');
  }
  const checkpointPosition = source.catalogSummary.shardProductCounts
    .slice(0, checkpoint.nextShard)
    .reduce((total, count) => total + count, checkpoint.nextOffset);
  if (checkpoint.completedProducts !== checkpointPosition) {
    throw new Error('The Tegiwa checkpoint product count does not match its shard position.');
  }

  const currentCounts = await databaseCounts(client, importId, supplierId);
  const expectedPrefix = source.expectedAt(checkpoint.nextShard, checkpoint.nextOffset);
  if (resumeRequiresFullReplay(expectedPrefix, currentCounts)) {
    checkpoint = { ...checkpoint, nextShard: 0, nextOffset: 0, completedProducts: 0, completed: false };
    writeCheckpoint(file, checkpoint);
    console.log('Staged dependency counts did not match the checkpoint; replaying idempotently from the first shard.');
  }

  for (let shardIndex = checkpoint.nextShard; shardIndex < source.catalogSummary.shardCount; shardIndex += 1) {
    const products = source.loadShard(shardIndex);
    let offset = shardIndex === checkpoint.nextShard ? checkpoint.nextOffset : 0;
    if (offset > products.length) throw new Error(`The checkpoint offset exceeds Tegiwa shard ${shardIndex}.`);
    const remaining = products.slice(offset).map(safeJsonForDatabase);
    const batches = chunkByJsonBytes(remaining, { maxRows: options.batchSize, maxBytes: options.maxBatchBytes });
    for (const batch of batches) {
      const result = await client.query(BATCH_SQL, [importId, supplierId, JSON.stringify(batch)]);
      const row = result.rows[0];
      if (Number(row?.products) !== batch.length || Number(row?.variants) !== batch.length
        || Number(row?.offers) !== batch.length || Number(row?.search_rows) !== batch.length) {
        throw new Error(`Neon did not stage every product in Tegiwa shard ${shardIndex}.`);
      }
      offset += batch.length;
      checkpoint = {
        ...checkpoint,
        nextShard: offset === products.length ? shardIndex + 1 : shardIndex,
        nextOffset: offset === products.length ? 0 : offset,
        completedProducts: checkpoint.completedProducts + batch.length,
        completed: false
      };
      writeCheckpoint(file, checkpoint);
      console.log(`Staged ${checkpoint.completedProducts.toLocaleString('en-US')} / ${source.expected.products.toLocaleString('en-US')} Tegiwa products.`);
    }
  }

  const actual = await databaseCounts(client, importId, supplierId);
  validateImportCounts(source.expected, actual);
  const validationSummary = JSON.stringify({
    sourceFingerprint: source.fingerprint,
    importFormatVersion: source.importFormatVersion,
    catalogGeneratedAt: source.catalogSummary.generatedAt,
    expected: source.expected,
    actual,
    audit: source.audit,
    priceBasis: 'gbp_ex_uk_vat',
    validatedAt: new Date().toISOString()
  });
  await client.query(`
    UPDATE catalog_imports
    SET status = 'validated',
        product_count = $3::bigint,
        variant_count = $4::bigint,
        available_count = $5::bigint,
        validation_summary = $6::jsonb,
        finished_at = NULL
    WHERE id = $1::uuid AND supplier_id = $2::bigint AND status IN ('staging', 'validated')
    RETURNING id;
  `, [importId, supplierId, source.expected.products, source.expected.variants, source.expected.availableOffers, validationSummary]);

  const [, publish] = await client.transaction([
    { query: PUBLISH_LOCK_SQL, params: [supplierId] },
    {
      query: PUBLISH_SQL,
      params: [
        importId,
        supplierId,
        JSON.stringify(source.expected),
        source.catalogSummary.generatedAt,
        checkpoint.baseCurrentImportId
      ]
    }
  ], { isolationLevel: 'ReadCommitted' });
  if (Number(publish.rows[0]?.published) !== 1 || String(publish.rows[0]?.current_import_id) !== importId) {
    throw new Error('The staged catalogue passed client validation but the atomic publish guard rejected it.');
  }
  checkpoint = { ...checkpoint, completedProducts: source.expected.products, completed: true, publishedAt: publish.rows[0].published_at };
  writeCheckpoint(file, checkpoint);
  console.log(`Published ${source.expected.products.toLocaleString('en-US')} Tegiwa products to the unified catalogue state.`);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    console.log(HELP.trim());
    return;
  }
  const source = preflightTegiwaSource(repoDirectory);
  printPreflight(source, options.dryRun);
  if (options.dryRun) return;
  await importSource(options, source);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Tegiwa Neon import failed: ${error.message}`);
    process.exitCode = 1;
  });
}
