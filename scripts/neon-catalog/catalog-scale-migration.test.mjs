import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationPath = path.join(repo, 'migrations', '003_catalogue_scale_foundation.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

function tableBody(name) {
  const marker = `CREATE TABLE IF NOT EXISTS ${name} (`;
  const start = sql.indexOf(marker);
  assert.notEqual(start, -1, `${name} is missing`);
  let depth = 0;
  let opened = false;
  for (let index = start + marker.length - 1; index < sql.length; index += 1) {
    if (sql[index] === '(') {
      depth += 1;
      opened = true;
    } else if (sql[index] === ')') {
      depth -= 1;
      if (opened && depth === 0) return sql.slice(start, index + 1);
    }
  }
  throw new Error(`${name} has no balanced closing parenthesis`);
}

test('scale migration is additive and transaction-bounded', () => {
  assert.match(sql, /^--[\s\S]*?\bBEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE)\b/i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(sql, /\bUPDATE\s+(?:products|variants|offers|catalog_state)\b/i);
  assert.doesNotMatch(sql, /ALTER\s+TABLE\s+\w+\s+DROP/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS catalog_item_id BIGINT/);
  assert.match(sql, /FOREIGN KEY \(catalog_item_id\)[\s\S]*?NOT VALID/);
});

test('stable supplier identities enforce explicit supplier-wide uniqueness', () => {
  const items = tableBody('supplier_catalog_items');
  const variants = tableBody('supplier_variant_items');
  const identifiers = tableBody('supplier_identifier_registry');
  assert.match(items, /UNIQUE \(supplier_id, supplier_product_key\)/);
  assert.match(items, /UNIQUE \(supplier_id, public_key\)/);
  assert.match(variants, /UNIQUE \(supplier_id, catalog_item_id, supplier_variant_key\)/);
  assert.match(identifiers, /uniqueness_scope IN \('supplier', 'catalog_item'\)/);
  assert.match(sql, /supplier_identifier_registry_supplier_uidx[\s\S]*?\(supplier_id, kind, normalized_value\)[\s\S]*?WHERE uniqueness_scope = 'supplier'/);
  assert.match(sql, /supplier_identifier_registry_item_uidx[\s\S]*?WHERE uniqueness_scope = 'catalog_item'/);
});

test('stock is independently staged and atomically addressable', () => {
  const imports = tableBody('catalog_stock_imports');
  const state = tableBody('catalog_stock_state');
  const items = tableBody('catalog_stock_items');
  assert.match(imports, /status IN \('staging', 'validated', 'published', 'failed', 'retired'\)/);
  assert.match(imports, /checked_at TIMESTAMPTZ NOT NULL/);
  assert.match(state, /current_stock_import_id UUID NOT NULL/);
  assert.match(state, /FOREIGN KEY \(current_stock_import_id, supplier_id\)/);
  assert.match(items, /PRIMARY KEY \(stock_import_id, supplier_variant_item_id\)/);
  assert.match(items, /quantity_available IS NULL OR quantity_available >= 0/);
  assert.match(items, /expires_at IS NULL OR expires_at >= checked_at/);
});

test('listing projection has bounded keyset sort keys and precomputed counts', () => {
  const projection = tableBody('catalog_listing_projection');
  assert.match(projection, /price_asc_sort BIGINT GENERATED ALWAYS AS/);
  assert.match(projection, /price_desc_sort BIGINT GENERATED ALWAYS AS/);
  assert.match(projection, /FOREIGN KEY \(catalog_item_id, supplier_id\)/);
  assert.match(projection, /catalog_listing_projection_price_currency/);
  for (const index of [
    'catalog_listing_keyset_browse_idx',
    'catalog_listing_keyset_name_asc_idx',
    'catalog_listing_keyset_name_desc_idx',
    'catalog_listing_keyset_price_asc_idx',
    'catalog_listing_keyset_price_desc_idx'
  ]) assert.match(sql, new RegExp(`CREATE INDEX IF NOT EXISTS ${index}`));
  const counts = tableBody('catalog_listing_counts');
  const facets = tableBody('catalog_facet_counts');
  assert.match(counts, /priced_products BIGINT NOT NULL/);
  assert.match(counts, /in_stock_products <= available_products/);
  assert.match(facets, /scope_hash CHAR\(64\) NOT NULL/);
  assert.match(facets, /'generation', 'chassis', 'engine', 'drivetrain'/);
  assert.match(sql, /catalog_facet_counts_lookup_idx/);
});

test('fitment, option, specification, logistics, SEO and relation gaps are structured', () => {
  const vehicle = tableBody('vehicle_configurations');
  assert.match(vehicle, /chassis_code TEXT NOT NULL/);
  assert.match(vehicle, /drivetrain TEXT NOT NULL/);
  assert.match(vehicle, /transmission TEXT NOT NULL/);
  assert.match(tableBody('product_fitment_configurations'), /vehicle_configuration_id BIGINT NOT NULL/);
  assert.match(tableBody('product_options'), /normalized_name TEXT NOT NULL/);
  assert.match(tableBody('product_option_values'), /normalized_value TEXT NOT NULL/);
  assert.match(tableBody('variant_option_values'), /PRIMARY KEY \(variant_id, option_id\)/);
  assert.match(tableBody('product_specifications'), /value_text TEXT NOT NULL/);
  const shipping = tableBody('product_shipping_measurements');
  assert.match(shipping, /weight_grams BIGINT/);
  assert.match(shipping, /length_mm BIGINT/);
  assert.match(shipping, /width_mm BIGINT/);
  assert.match(shipping, /height_mm BIGINT/);
  assert.match(tableBody('product_seo'), /structured_data JSONB NOT NULL/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS product_seo_route_idx[\s\S]*?\(locale, slug\)/);
  assert.match(tableBody('catalog_item_relations'), /'related', 'accessory', 'replacement', 'requires', 'bundle', 'alternative'/);
});

test('dealer cost is isolated and never mixed into public retail evidence', () => {
  const retail = tableBody('catalog_retail_price_evidence');
  const privateCost = tableBody('catalog_private.supplier_cost_evidence');
  assert.match(retail, /price_minor BIGINT NOT NULL/);
  assert.match(retail, /observed_at TIMESTAMPTZ NOT NULL/);
  assert.doesNotMatch(retail, /cost_minor|dealer/i);
  assert.match(privateCost, /cost_minor BIGINT NOT NULL/);
  assert.match(sql, /REVOKE ALL ON SCHEMA catalog_private FROM PUBLIC/);
  assert.match(sql, /REVOKE ALL ON ALL TABLES IN SCHEMA catalog_private FROM PUBLIC/);
  assert.match(sql, /REVOKE ALL ON ALL SEQUENCES IN SCHEMA catalog_private FROM PUBLIC/);
});
