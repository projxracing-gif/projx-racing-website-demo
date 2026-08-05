-- Additive catalogue-scale foundation for multi-million-row supplier feeds.
--
-- This migration does not backfill, publish, retire, or delete catalogue data.
-- Existing products/offers remain authoritative until an importer explicitly
-- populates and validates the new identity, snapshot, and projection tables.

BEGIN;

-- Stable identities survive immutable catalogue-import snapshots. They allow
-- stock, prices, relations, and supplier identifiers to update independently.
CREATE TABLE IF NOT EXISTS supplier_catalog_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supplier_id BIGINT NOT NULL REFERENCES suppliers(id),
  supplier_product_key TEXT NOT NULL,
  public_key TEXT NOT NULL,
  source_handle TEXT,
  source_url TEXT,
  first_seen_import_id UUID,
  last_seen_import_id UUID,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, supplier_id),
  UNIQUE (supplier_id, supplier_product_key),
  UNIQUE (supplier_id, public_key),
  CONSTRAINT supplier_catalog_items_first_import_fk
    FOREIGN KEY (first_seen_import_id, supplier_id)
    REFERENCES catalog_imports (id, supplier_id),
  CONSTRAINT supplier_catalog_items_last_import_fk
    FOREIGN KEY (last_seen_import_id, supplier_id)
    REFERENCES catalog_imports (id, supplier_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS supplier_catalog_items_source_url_uidx
  ON supplier_catalog_items (supplier_id, source_url)
  WHERE source_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS supplier_catalog_items_active_key_idx
  ON supplier_catalog_items (supplier_id, active, supplier_product_key, id);

CREATE TABLE IF NOT EXISTS supplier_variant_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supplier_id BIGINT NOT NULL,
  catalog_item_id BIGINT NOT NULL,
  supplier_variant_key TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, supplier_id),
  UNIQUE (id, catalog_item_id, supplier_id),
  UNIQUE (supplier_id, catalog_item_id, supplier_variant_key),
  CONSTRAINT supplier_variant_items_catalog_item_fk
    FOREIGN KEY (catalog_item_id, supplier_id)
    REFERENCES supplier_catalog_items (id, supplier_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS supplier_variant_items_lookup_idx
  ON supplier_variant_items (supplier_id, supplier_variant_key, catalog_item_id);

-- Uniqueness is explicit. Supplier-issued ES/SKU identifiers use the
-- supplier scope; manufacturer numbers that may legitimately repeat can use
-- the catalog_item scope. Conflicts are rejected before publication.
CREATE TABLE IF NOT EXISTS supplier_identifier_registry (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supplier_id BIGINT NOT NULL,
  catalog_item_id BIGINT NOT NULL,
  supplier_variant_item_id BIGINT,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  uniqueness_scope TEXT NOT NULL DEFAULT 'supplier',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, supplier_id),
  CONSTRAINT supplier_identifier_registry_kind CHECK (
    kind IN ('supplier_product_key', 'source_handle', 'sku', 'mpn', 'ecs', 'upc', 'ean', 'other')
  ),
  CONSTRAINT supplier_identifier_registry_scope CHECK (
    uniqueness_scope IN ('supplier', 'catalog_item')
  ),
  CONSTRAINT supplier_identifier_registry_value CHECK (length(normalized_value) BETWEEN 1 AND 240),
  CONSTRAINT supplier_identifier_registry_catalog_item_fk
    FOREIGN KEY (catalog_item_id, supplier_id)
    REFERENCES supplier_catalog_items (id, supplier_id)
    ON DELETE CASCADE,
  CONSTRAINT supplier_identifier_registry_variant_fk
    FOREIGN KEY (supplier_variant_item_id, catalog_item_id, supplier_id)
    REFERENCES supplier_variant_items (id, catalog_item_id, supplier_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS supplier_identifier_registry_supplier_uidx
  ON supplier_identifier_registry (supplier_id, kind, normalized_value)
  WHERE uniqueness_scope = 'supplier';

CREATE UNIQUE INDEX IF NOT EXISTS supplier_identifier_registry_item_uidx
  ON supplier_identifier_registry (catalog_item_id, kind, normalized_value)
  WHERE uniqueness_scope = 'catalog_item';

ALTER TABLE products ADD COLUMN IF NOT EXISTS catalog_item_id BIGINT;
ALTER TABLE variants ADD COLUMN IF NOT EXISTS supplier_variant_item_id BIGINT;
ALTER TABLE product_identifiers ADD COLUMN IF NOT EXISTS supplier_identifier_id BIGINT;

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_catalog_item_fk') THEN
    ALTER TABLE products
      ADD CONSTRAINT products_catalog_item_fk
      FOREIGN KEY (catalog_item_id) REFERENCES supplier_catalog_items(id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'variants_supplier_variant_item_fk') THEN
    ALTER TABLE variants
      ADD CONSTRAINT variants_supplier_variant_item_fk
      FOREIGN KEY (supplier_variant_item_id) REFERENCES supplier_variant_items(id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_identifiers_supplier_identifier_fk') THEN
    ALTER TABLE product_identifiers
      ADD CONSTRAINT product_identifiers_supplier_identifier_fk
      FOREIGN KEY (supplier_identifier_id) REFERENCES supplier_identifier_registry(id) NOT VALID;
  END IF;
END
$migration$;

CREATE UNIQUE INDEX IF NOT EXISTS products_import_catalog_item_uidx
  ON products (import_id, catalog_item_id)
  WHERE catalog_item_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS variants_product_stable_item_uidx
  ON variants (product_id, supplier_variant_item_id)
  WHERE supplier_variant_item_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS product_identifiers_product_registry_uidx
  ON product_identifiers (product_id, supplier_identifier_id)
  WHERE supplier_identifier_id IS NOT NULL;

-- Stock has its own immutable snapshot and publication pointer. A stock refresh
-- no longer requires duplicating or republishing two million product records.
CREATE TABLE IF NOT EXISTS catalog_stock_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id BIGINT NOT NULL REFERENCES suppliers(id),
  status TEXT NOT NULL DEFAULT 'staging',
  source_reference TEXT,
  source_generated_at TIMESTAMPTZ,
  checked_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  item_count BIGINT NOT NULL DEFAULT 0,
  available_count BIGINT NOT NULL DEFAULT 0,
  validation_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  UNIQUE (id, supplier_id),
  CONSTRAINT catalog_stock_imports_status CHECK (
    status IN ('staging', 'validated', 'published', 'failed', 'retired')
  ),
  CONSTRAINT catalog_stock_imports_counts CHECK (
    item_count >= 0 AND available_count >= 0 AND available_count <= item_count
  ),
  CONSTRAINT catalog_stock_imports_expiry CHECK (expires_at IS NULL OR expires_at >= checked_at)
);

CREATE INDEX IF NOT EXISTS catalog_stock_imports_supplier_checked_idx
  ON catalog_stock_imports (supplier_id, checked_at DESC, id);

CREATE TABLE IF NOT EXISTS catalog_stock_state (
  supplier_id BIGINT PRIMARY KEY REFERENCES suppliers(id),
  current_stock_import_id UUID NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT catalog_stock_state_current_fk
    FOREIGN KEY (current_stock_import_id, supplier_id)
    REFERENCES catalog_stock_imports (id, supplier_id)
);

CREATE TABLE IF NOT EXISTS catalog_stock_items (
  stock_import_id UUID NOT NULL,
  supplier_id BIGINT NOT NULL,
  catalog_item_id BIGINT NOT NULL,
  supplier_variant_item_id BIGINT NOT NULL,
  availability_code TEXT NOT NULL DEFAULT 'unknown',
  quantity_available BIGINT,
  lead_time TEXT,
  checked_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  source_payload_hash CHAR(64),
  PRIMARY KEY (stock_import_id, supplier_variant_item_id),
  CONSTRAINT catalog_stock_items_import_fk
    FOREIGN KEY (stock_import_id, supplier_id)
    REFERENCES catalog_stock_imports (id, supplier_id)
    ON DELETE CASCADE,
  CONSTRAINT catalog_stock_items_variant_fk
    FOREIGN KEY (supplier_variant_item_id, catalog_item_id, supplier_id)
    REFERENCES supplier_variant_items (id, catalog_item_id, supplier_id)
    ON DELETE CASCADE,
  CONSTRAINT catalog_stock_items_availability CHECK (
    availability_code IN ('in_stock', 'supplier_stock', 'available_to_order', 'backorder', 'out_of_stock', 'discontinued', 'unknown')
  ),
  CONSTRAINT catalog_stock_items_quantity CHECK (quantity_available IS NULL OR quantity_available >= 0),
  CONSTRAINT catalog_stock_items_expiry CHECK (expires_at IS NULL OR expires_at >= checked_at),
  CONSTRAINT catalog_stock_items_hash CHECK (
    source_payload_hash IS NULL OR source_payload_hash ~ '^[0-9a-f]{64}$'
  )
);

CREATE INDEX IF NOT EXISTS catalog_stock_items_current_lookup_idx
  ON catalog_stock_items (supplier_id, supplier_variant_item_id, stock_import_id);

CREATE INDEX IF NOT EXISTS catalog_stock_items_availability_idx
  ON catalog_stock_items (stock_import_id, availability_code, supplier_variant_item_id);

-- Public retail evidence is dated and intentionally contains no dealer cost.
CREATE TABLE IF NOT EXISTS catalog_retail_price_evidence (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supplier_id BIGINT NOT NULL,
  catalog_item_id BIGINT NOT NULL,
  supplier_variant_item_id BIGINT NOT NULL,
  currency CHAR(3) NOT NULL,
  evidence_kind TEXT NOT NULL DEFAULT 'retail',
  price_minor BIGINT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ,
  source_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT catalog_retail_price_currency CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT catalog_retail_price_kind CHECK (evidence_kind IN ('retail', 'list', 'sale')),
  CONSTRAINT catalog_retail_price_nonnegative CHECK (price_minor >= 0),
  CONSTRAINT catalog_retail_price_validity CHECK (valid_until IS NULL OR valid_until >= observed_at),
  CONSTRAINT catalog_retail_price_variant_fk
    FOREIGN KEY (supplier_variant_item_id, catalog_item_id, supplier_id)
    REFERENCES supplier_variant_items (id, catalog_item_id, supplier_id)
    ON DELETE CASCADE,
  UNIQUE (supplier_variant_item_id, currency, evidence_kind, observed_at)
);

CREATE INDEX IF NOT EXISTS catalog_retail_price_latest_idx
  ON catalog_retail_price_evidence
  (supplier_id, supplier_variant_item_id, currency, evidence_kind, observed_at DESC);

-- Dealer cost is isolated from all public catalogue tables and views. A
-- production rollout must use a non-owner runtime role with no USAGE grant on
-- this schema; owner credentials must never be used by the public API.
CREATE SCHEMA IF NOT EXISTS catalog_private;
REVOKE ALL ON SCHEMA catalog_private FROM PUBLIC;

CREATE TABLE IF NOT EXISTS catalog_private.supplier_cost_evidence (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supplier_id BIGINT NOT NULL,
  catalog_item_id BIGINT NOT NULL,
  supplier_variant_item_id BIGINT NOT NULL,
  currency CHAR(3) NOT NULL,
  cost_minor BIGINT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ,
  source_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT supplier_cost_currency CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT supplier_cost_nonnegative CHECK (cost_minor >= 0),
  CONSTRAINT supplier_cost_validity CHECK (valid_until IS NULL OR valid_until >= observed_at),
  CONSTRAINT supplier_cost_variant_fk
    FOREIGN KEY (supplier_variant_item_id, catalog_item_id, supplier_id)
    REFERENCES public.supplier_variant_items (id, catalog_item_id, supplier_id)
    ON DELETE CASCADE,
  UNIQUE (supplier_variant_item_id, currency, observed_at)
);

CREATE INDEX IF NOT EXISTS supplier_cost_evidence_latest_idx
  ON catalog_private.supplier_cost_evidence
  (supplier_id, supplier_variant_item_id, currency, observed_at DESC);

REVOKE ALL ON ALL TABLES IN SCHEMA catalog_private FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA catalog_private FROM PUBLIC;

-- One compact row per product provides stable keyset sort keys. Importers fill
-- this table only after dependent data validates; existing API queries do not
-- depend on it until the scale cutover is explicitly enabled.
CREATE TABLE IF NOT EXISTS catalog_listing_projection (
  product_id BIGINT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  import_id UUID NOT NULL,
  supplier_id BIGINT NOT NULL,
  catalog_item_id BIGINT,
  public_key TEXT NOT NULL,
  title_sort TEXT NOT NULL,
  browse_rank BIGINT NOT NULL DEFAULT 0,
  brand_id BIGINT REFERENCES brands(id),
  primary_part_type_id BIGINT REFERENCES part_types(id),
  currency CHAR(3),
  retail_price_minor BIGINT,
  availability_code TEXT NOT NULL DEFAULT 'unknown',
  availability_rank SMALLINT NOT NULL DEFAULT 100,
  price_evidence_observed_at TIMESTAMPTZ,
  stock_checked_at TIMESTAMPTZ,
  price_asc_sort BIGINT GENERATED ALWAYS AS (
    COALESCE(retail_price_minor, 9223372036854775807::bigint)
  ) STORED,
  price_desc_sort BIGINT GENERATED ALWAYS AS (
    CASE
      WHEN retail_price_minor IS NULL THEN 9223372036854775807::bigint
      ELSE -retail_price_minor
    END
  ) STORED,
  projected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT catalog_listing_projection_import_fk
    FOREIGN KEY (import_id, supplier_id)
    REFERENCES catalog_imports (id, supplier_id)
    ON DELETE CASCADE,
  CONSTRAINT catalog_listing_projection_item_fk
    FOREIGN KEY (catalog_item_id, supplier_id)
    REFERENCES supplier_catalog_items(id, supplier_id),
  CONSTRAINT catalog_listing_projection_currency CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  CONSTRAINT catalog_listing_projection_price CHECK (
    retail_price_minor IS NULL OR retail_price_minor BETWEEN 0 AND 9000000000000000000
  ),
  CONSTRAINT catalog_listing_projection_price_currency CHECK (
    (retail_price_minor IS NULL AND currency IS NULL)
    OR (retail_price_minor IS NOT NULL AND currency IS NOT NULL)
  ),
  CONSTRAINT catalog_listing_projection_availability CHECK (
    availability_code IN ('in_stock', 'supplier_stock', 'available_to_order', 'backorder', 'out_of_stock', 'discontinued', 'unknown')
  ),
  CONSTRAINT catalog_listing_projection_availability_rank CHECK (availability_rank BETWEEN 0 AND 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS catalog_listing_projection_import_public_uidx
  ON catalog_listing_projection (import_id, public_key);

CREATE INDEX IF NOT EXISTS catalog_listing_keyset_browse_idx
  ON catalog_listing_projection (import_id, browse_rank, product_id);

CREATE INDEX IF NOT EXISTS catalog_listing_keyset_name_asc_idx
  ON catalog_listing_projection (import_id, title_sort, product_id);

CREATE INDEX IF NOT EXISTS catalog_listing_keyset_name_desc_idx
  ON catalog_listing_projection (import_id, title_sort DESC, product_id DESC);

CREATE INDEX IF NOT EXISTS catalog_listing_keyset_price_asc_idx
  ON catalog_listing_projection (import_id, currency, price_asc_sort, product_id);

CREATE INDEX IF NOT EXISTS catalog_listing_keyset_price_desc_idx
  ON catalog_listing_projection (import_id, currency, price_desc_sort, product_id);

CREATE INDEX IF NOT EXISTS catalog_listing_availability_idx
  ON catalog_listing_projection (import_id, availability_code, availability_rank, browse_rank, product_id);

-- Count and facet tables are importer-built, never maintained by row triggers.
-- This avoids COUNT(*) and large DISTINCT/GROUP BY work on customer requests.
CREATE TABLE IF NOT EXISTS catalog_listing_counts (
  import_id UUID NOT NULL,
  supplier_id BIGINT NOT NULL,
  total_products BIGINT NOT NULL,
  active_products BIGINT NOT NULL,
  priced_products BIGINT NOT NULL,
  request_price_products BIGINT NOT NULL,
  available_products BIGINT NOT NULL,
  in_stock_products BIGINT NOT NULL,
  projected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (import_id, supplier_id),
  CONSTRAINT catalog_listing_counts_import_fk
    FOREIGN KEY (import_id, supplier_id)
    REFERENCES catalog_imports (id, supplier_id)
    ON DELETE CASCADE,
  CONSTRAINT catalog_listing_counts_nonnegative CHECK (
    total_products >= 0 AND active_products >= 0 AND priced_products >= 0
    AND request_price_products >= 0 AND available_products >= 0 AND in_stock_products >= 0
  ),
  CONSTRAINT catalog_listing_counts_bounds CHECK (
    active_products <= total_products
    AND priced_products <= total_products
    AND request_price_products <= total_products
    AND available_products <= total_products
    AND in_stock_products <= available_products
  )
);

CREATE TABLE IF NOT EXISTS catalog_facet_counts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_id UUID NOT NULL,
  supplier_id BIGINT NOT NULL,
  facet_kind TEXT NOT NULL,
  scope_hash CHAR(64) NOT NULL,
  scope_filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  value_key TEXT NOT NULL,
  value_label TEXT NOT NULL,
  parent_value_key TEXT,
  product_count BIGINT NOT NULL,
  projected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT catalog_facet_counts_import_fk
    FOREIGN KEY (import_id, supplier_id)
    REFERENCES catalog_imports (id, supplier_id)
    ON DELETE CASCADE,
  CONSTRAINT catalog_facet_counts_kind CHECK (
    facet_kind IN ('supplier', 'brand', 'part_type', 'currency', 'availability',
      'make', 'model', 'year', 'generation', 'chassis', 'engine', 'drivetrain')
  ),
  CONSTRAINT catalog_facet_counts_scope_hash CHECK (scope_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT catalog_facet_counts_count CHECK (product_count >= 0),
  UNIQUE (import_id, facet_kind, scope_hash, value_key)
);

CREATE INDEX IF NOT EXISTS catalog_facet_counts_lookup_idx
  ON catalog_facet_counts
  (supplier_id, import_id, facet_kind, scope_hash, product_count DESC, value_key);

CREATE INDEX IF NOT EXISTS catalog_facet_counts_parent_idx
  ON catalog_facet_counts
  (import_id, facet_kind, scope_hash, parent_value_key, value_key)
  WHERE parent_value_key IS NOT NULL;

-- Detailed vehicle qualifiers extend the existing year/make/model/application
-- model without changing or invalidating any existing fitment row.
CREATE TABLE IF NOT EXISTS vehicle_configurations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehicle_application_id BIGINT NOT NULL REFERENCES vehicle_applications(id) ON DELETE CASCADE,
  chassis_code TEXT NOT NULL DEFAULT '',
  drivetrain TEXT NOT NULL DEFAULT '',
  transmission TEXT NOT NULL DEFAULT '',
  body_style TEXT NOT NULL DEFAULT '',
  trim_name TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'supplier',
  reviewed BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (id, vehicle_application_id),
  UNIQUE (vehicle_application_id, chassis_code, drivetrain, transmission, body_style, trim_name)
);

CREATE INDEX IF NOT EXISTS vehicle_configurations_lookup_idx
  ON vehicle_configurations
  (vehicle_application_id, chassis_code, drivetrain, transmission, body_style, trim_name);

CREATE UNIQUE INDEX IF NOT EXISTS product_fitments_id_application_uidx
  ON product_fitments (id, vehicle_application_id);

CREATE TABLE IF NOT EXISTS product_fitment_configurations (
  product_fitment_id BIGINT NOT NULL,
  vehicle_application_id BIGINT NOT NULL,
  vehicle_configuration_id BIGINT NOT NULL,
  note TEXT,
  PRIMARY KEY (product_fitment_id, vehicle_configuration_id),
  CONSTRAINT product_fitment_configurations_fitment_fk
    FOREIGN KEY (product_fitment_id, vehicle_application_id)
    REFERENCES product_fitments (id, vehicle_application_id)
    ON DELETE CASCADE,
  CONSTRAINT product_fitment_configurations_vehicle_fk
    FOREIGN KEY (vehicle_configuration_id, vehicle_application_id)
    REFERENCES vehicle_configurations (id, vehicle_application_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS product_fitment_configurations_vehicle_idx
  ON product_fitment_configurations (vehicle_configuration_id, product_fitment_id);

-- Structured options retain supplier-provided variation instead of flattening
-- it into a title. Composite foreign keys prevent cross-product value mapping.
CREATE UNIQUE INDEX IF NOT EXISTS variants_id_product_uidx
  ON variants (id, product_id);

CREATE TABLE IF NOT EXISTS product_options (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  required BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (id, product_id),
  UNIQUE (product_id, normalized_name)
);

CREATE INDEX IF NOT EXISTS product_options_position_idx
  ON product_options (product_id, position, id);

CREATE TABLE IF NOT EXISTS product_option_values (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id BIGINT NOT NULL,
  option_id BIGINT NOT NULL,
  value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE (id, option_id, product_id),
  UNIQUE (option_id, normalized_value),
  CONSTRAINT product_option_values_option_fk
    FOREIGN KEY (option_id, product_id)
    REFERENCES product_options (id, product_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS product_option_values_position_idx
  ON product_option_values (option_id, position, id);

CREATE TABLE IF NOT EXISTS variant_option_values (
  product_id BIGINT NOT NULL,
  variant_id BIGINT NOT NULL,
  option_id BIGINT NOT NULL,
  option_value_id BIGINT NOT NULL,
  PRIMARY KEY (variant_id, option_id),
  CONSTRAINT variant_option_values_variant_fk
    FOREIGN KEY (variant_id, product_id)
    REFERENCES variants (id, product_id)
    ON DELETE CASCADE,
  CONSTRAINT variant_option_values_option_fk
    FOREIGN KEY (option_id, product_id)
    REFERENCES product_options (id, product_id)
    ON DELETE CASCADE,
  CONSTRAINT variant_option_values_value_fk
    FOREIGN KEY (option_value_id, option_id, product_id)
    REFERENCES product_option_values (id, option_id, product_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS variant_option_values_value_idx
  ON variant_option_values (option_value_id, variant_id);

CREATE TABLE IF NOT EXISTS product_specifications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id BIGINT,
  group_name TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  value_text TEXT NOT NULL,
  unit TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'supplier',
  CONSTRAINT product_specifications_variant_fk
    FOREIGN KEY (variant_id, product_id)
    REFERENCES variants (id, product_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS product_specifications_identity_uidx
  ON product_specifications
  (product_id, COALESCE(variant_id, 0), group_name, normalized_name, position);

CREATE INDEX IF NOT EXISTS product_specifications_display_idx
  ON product_specifications (product_id, variant_id, group_name, position, id);

-- Shipping measurements use integral SI units and keep the exact supplier
-- evidence date. Dimensions/weights can therefore be transformed for display
-- without floating-point drift or invented values.
CREATE TABLE IF NOT EXISTS product_shipping_measurements (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id BIGINT,
  weight_grams BIGINT,
  length_mm BIGINT,
  width_mm BIGINT,
  height_mm BIGINT,
  oversized BOOLEAN NOT NULL DEFAULT false,
  ships_separately BOOLEAN NOT NULL DEFAULT false,
  hazardous BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT 'supplier',
  observed_at TIMESTAMPTZ,
  CONSTRAINT product_shipping_measurements_variant_fk
    FOREIGN KEY (variant_id, product_id)
    REFERENCES variants (id, product_id)
    ON DELETE CASCADE,
  CONSTRAINT product_shipping_measurements_values CHECK (
    (weight_grams IS NULL OR weight_grams >= 0)
    AND (length_mm IS NULL OR length_mm >= 0)
    AND (width_mm IS NULL OR width_mm >= 0)
    AND (height_mm IS NULL OR height_mm >= 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS product_shipping_measurements_scope_uidx
  ON product_shipping_measurements (product_id, COALESCE(variant_id, 0));

CREATE TABLE IF NOT EXISTS product_seo (
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  locale TEXT NOT NULL,
  slug TEXT NOT NULL,
  page_title TEXT,
  meta_description TEXT,
  canonical_url TEXT,
  indexable BOOLEAN NOT NULL DEFAULT true,
  structured_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, locale),
  CONSTRAINT product_seo_locale CHECK (locale ~ '^[a-z]{2}(?:-[A-Z]{2})?$'),
  CONSTRAINT product_seo_slug CHECK (slug ~ '^[a-z0-9]+(?:[-_][a-z0-9]+)*$'),
  CONSTRAINT product_seo_description_length CHECK (
    meta_description IS NULL OR length(meta_description) <= 320
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS product_seo_route_idx
  ON product_seo (locale, slug);

-- Relations use stable catalogue identities, so they do not need to be
-- rebuilt merely because a supplier publishes a new product snapshot.
CREATE TABLE IF NOT EXISTS catalog_item_relations (
  source_supplier_id BIGINT NOT NULL,
  source_catalog_item_id BIGINT NOT NULL,
  target_supplier_id BIGINT NOT NULL,
  target_catalog_item_id BIGINT NOT NULL,
  relation_type TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'supplier',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_catalog_item_id, target_catalog_item_id, relation_type),
  CONSTRAINT catalog_item_relations_source_fk
    FOREIGN KEY (source_catalog_item_id, source_supplier_id)
    REFERENCES supplier_catalog_items (id, supplier_id)
    ON DELETE CASCADE,
  CONSTRAINT catalog_item_relations_target_fk
    FOREIGN KEY (target_catalog_item_id, target_supplier_id)
    REFERENCES supplier_catalog_items (id, supplier_id)
    ON DELETE CASCADE,
  CONSTRAINT catalog_item_relations_type CHECK (
    relation_type IN ('related', 'accessory', 'replacement', 'requires', 'bundle', 'alternative')
  ),
  CONSTRAINT catalog_item_relations_not_self CHECK (source_catalog_item_id <> target_catalog_item_id)
);

CREATE INDEX IF NOT EXISTS catalog_item_relations_target_idx
  ON catalog_item_relations (target_catalog_item_id, relation_type, source_catalog_item_id);

COMMENT ON TABLE catalog_listing_projection IS
  'Importer-built current-query projection with stable sort keys for keyset pagination.';
COMMENT ON TABLE catalog_facet_counts IS
  'Precomputed facet counts; scope_hash is SHA-256 of canonical filter JSON.';
COMMENT ON TABLE catalog_stock_items IS
  'Independent supplier stock observations; customer APIs should expose policy-safe availability, not assumed inventory.';
COMMENT ON TABLE catalog_retail_price_evidence IS
  'Dated public retail/list/sale evidence only; never dealer or wholesale cost.';
COMMENT ON TABLE catalog_private.supplier_cost_evidence IS
  'Private dealer-cost evidence. Never grant this schema to the public catalogue runtime role.';

COMMIT;
