CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS suppliers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  default_currency CHAR(3) NOT NULL,
  source_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT suppliers_slug_format CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT suppliers_currency_format CHECK (default_currency ~ '^[A-Z]{3}$')
);

CREATE TABLE IF NOT EXISTS catalog_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id BIGINT NOT NULL REFERENCES suppliers(id),
  status TEXT NOT NULL DEFAULT 'staging',
  source_reference TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  product_count BIGINT NOT NULL DEFAULT 0,
  variant_count BIGINT NOT NULL DEFAULT 0,
  available_count BIGINT NOT NULL DEFAULT 0,
  validation_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT catalog_imports_status CHECK (status IN ('staging', 'validated', 'published', 'failed', 'retired')),
  UNIQUE (id, supplier_id)
);

CREATE INDEX IF NOT EXISTS catalog_imports_supplier_started_idx
  ON catalog_imports (supplier_id, started_at DESC);

CREATE TABLE IF NOT EXISTS catalog_state (
  supplier_id BIGINT PRIMARY KEY REFERENCES suppliers(id),
  current_import_id UUID NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT catalog_state_current_import_fk
    FOREIGN KEY (current_import_id, supplier_id)
    REFERENCES catalog_imports (id, supplier_id)
);

CREATE TABLE IF NOT EXISTS brands (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  logo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS part_types (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parent_id BIGINT REFERENCES part_types(id),
  slug TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS part_types_parent_sort_idx
  ON part_types (parent_id, sort_order, name_en);

CREATE TABLE IF NOT EXISTS products (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_id UUID NOT NULL,
  supplier_id BIGINT NOT NULL,
  public_key TEXT NOT NULL,
  supplier_product_key TEXT NOT NULL,
  source_handle TEXT,
  source_url TEXT,
  item_type TEXT NOT NULL DEFAULT 'product',
  title TEXT NOT NULL,
  description TEXT,
  brand_id BIGINT REFERENCES brands(id),
  primary_part_type_id BIGINT REFERENCES part_types(id),
  active BOOLEAN NOT NULL DEFAULT true,
  checked_at TIMESTAMPTZ,
  browse_rank BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT products_import_supplier_fk
    FOREIGN KEY (import_id, supplier_id)
    REFERENCES catalog_imports (id, supplier_id)
    ON DELETE CASCADE,
  CONSTRAINT products_item_type CHECK (item_type IN ('product', 'package')),
  UNIQUE (import_id, supplier_product_key),
  UNIQUE (import_id, public_key),
  UNIQUE (import_id, source_url)
);

CREATE INDEX IF NOT EXISTS products_supplier_browse_active_idx
  ON products (supplier_id, browse_rank, id)
  WHERE active;

CREATE INDEX IF NOT EXISTS products_brand_browse_active_idx
  ON products (brand_id, browse_rank, id)
  WHERE active;

CREATE INDEX IF NOT EXISTS products_part_type_browse_active_idx
  ON products (primary_part_type_id, browse_rank, id)
  WHERE active;

CREATE INDEX IF NOT EXISTS products_public_key_idx
  ON products (public_key);

CREATE TABLE IF NOT EXISTS product_part_types (
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  part_type_id BIGINT NOT NULL REFERENCES part_types(id),
  PRIMARY KEY (product_id, part_type_id)
);

CREATE INDEX IF NOT EXISTS product_part_types_part_product_idx
  ON product_part_types (part_type_id, product_id);

CREATE TABLE IF NOT EXISTS variants (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_variant_key TEXT NOT NULL,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, supplier_variant_key)
);

CREATE INDEX IF NOT EXISTS variants_product_position_idx
  ON variants (product_id, position, id);

CREATE TABLE IF NOT EXISTS product_identifiers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id BIGINT REFERENCES variants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  CONSTRAINT product_identifiers_kind CHECK (kind IN ('sku', 'mpn', 'ecs', 'upc', 'ean', 'other')),
  UNIQUE (product_id, variant_id, kind, normalized_value)
);

CREATE INDEX IF NOT EXISTS product_identifiers_normalized_idx
  ON product_identifiers (normalized_value);

CREATE INDEX IF NOT EXISTS product_identifiers_product_kind_idx
  ON product_identifiers (product_id, kind, normalized_value);

CREATE TABLE IF NOT EXISTS offers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id BIGINT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  currency CHAR(3) NOT NULL,
  price_minor BIGINT,
  availability_code TEXT NOT NULL DEFAULT 'unknown',
  lead_time TEXT,
  price_checked_at TIMESTAMPTZ,
  stock_checked_at TIMESTAMPTZ,
  stock_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT offers_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT offers_price_nonnegative CHECK (price_minor IS NULL OR price_minor >= 0),
  CONSTRAINT offers_availability CHECK (availability_code IN ('in_stock', 'supplier_stock', 'available_to_order', 'backorder', 'out_of_stock', 'discontinued', 'unknown')),
  UNIQUE (variant_id, currency)
);

CREATE INDEX IF NOT EXISTS offers_currency_price_idx
  ON offers (currency, price_minor, variant_id)
  WHERE price_minor IS NOT NULL;

CREATE INDEX IF NOT EXISTS offers_availability_freshness_idx
  ON offers (availability_code, stock_expires_at, variant_id);

CREATE TABLE IF NOT EXISTS product_images (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  url TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  alt_en TEXT,
  alt_ar TEXT,
  UNIQUE (product_id, position)
);

CREATE TABLE IF NOT EXISTS vehicle_makes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vehicle_models (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  make_id BIGINT NOT NULL REFERENCES vehicle_makes(id),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  UNIQUE (make_id, slug)
);

CREATE TABLE IF NOT EXISTS vehicle_applications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  model_id BIGINT NOT NULL REFERENCES vehicle_models(id),
  generation TEXT NOT NULL DEFAULT '',
  engine TEXT NOT NULL DEFAULT '',
  year_from INTEGER,
  year_to INTEGER,
  source TEXT NOT NULL DEFAULT 'supplier',
  reviewed BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT vehicle_applications_years CHECK (
    (year_from IS NULL OR year_from BETWEEN 1886 AND 2200)
    AND (year_to IS NULL OR year_to BETWEEN 1886 AND 2200)
    AND (year_from IS NULL OR year_to IS NULL OR year_from <= year_to)
  ),
  UNIQUE (model_id, generation, engine, year_from, year_to)
);

CREATE INDEX IF NOT EXISTS vehicle_applications_lookup_idx
  ON vehicle_applications (model_id, year_from, year_to, generation, engine);

CREATE TABLE IF NOT EXISTS product_fitments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id BIGINT REFERENCES variants(id) ON DELETE CASCADE,
  vehicle_application_id BIGINT NOT NULL REFERENCES vehicle_applications(id),
  confidence TEXT NOT NULL,
  source TEXT NOT NULL,
  note TEXT,
  CONSTRAINT product_fitments_confidence CHECK (confidence IN ('exact', 'possible')),
  UNIQUE (product_id, variant_id, vehicle_application_id, confidence)
);

CREATE INDEX IF NOT EXISTS product_fitments_application_confidence_idx
  ON product_fitments (vehicle_application_id, confidence, product_id);

CREATE INDEX IF NOT EXISTS product_fitments_product_confidence_idx
  ON product_fitments (product_id, confidence);

CREATE TABLE IF NOT EXISTS product_search (
  product_id BIGINT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  supplier_id BIGINT NOT NULL REFERENCES suppliers(id),
  title_sort TEXT NOT NULL,
  search_text TEXT NOT NULL,
  vehicle_text TEXT NOT NULL DEFAULT '',
  browse_rank BIGINT NOT NULL DEFAULT 0,
  search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', search_text)) STORED,
  vehicle_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', vehicle_text)) STORED
);

CREATE INDEX IF NOT EXISTS product_search_vector_idx
  ON product_search USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS product_search_vehicle_vector_idx
  ON product_search USING GIN (vehicle_vector);

CREATE INDEX IF NOT EXISTS product_search_text_trgm_idx
  ON product_search USING GIN (search_text gin_trgm_ops);

CREATE INDEX IF NOT EXISTS product_search_supplier_rank_idx
  ON product_search (supplier_id, browse_rank, product_id);

CREATE INDEX IF NOT EXISTS product_search_title_idx
  ON product_search (title_sort, product_id);
