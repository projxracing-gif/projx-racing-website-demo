-- Additive, fail-closed supplier shipping and quote-audit foundation.
--
-- This migration does not enable live rating, payment collection, supplier
-- ordering, or publish any secret. All new supplier origins are unverified and
-- inactive until written supplier evidence and package data are reviewed.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS supplier_fulfilment_origins (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supplier_id BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  origin_code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  country_code CHAR(2) NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  evidence_source TEXT,
  evidence_observed_at TIMESTAMPTZ,
  evidence_expires_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, supplier_id),
  UNIQUE (supplier_id, origin_code),
  CONSTRAINT supplier_fulfilment_origins_code CHECK (
    origin_code ~ '^[a-z0-9]+(?:[-_][a-z0-9]+)*$'
  ),
  CONSTRAINT supplier_fulfilment_origins_country CHECK (country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT supplier_fulfilment_origins_verification CHECK (
    verification_status IN ('unverified', 'verified', 'stale', 'disabled')
  ),
  CONSTRAINT supplier_fulfilment_origins_evidence_expiry CHECK (
    evidence_expires_at IS NULL OR evidence_observed_at IS NULL
      OR evidence_expires_at >= evidence_observed_at
  ),
  CONSTRAINT supplier_fulfilment_origins_active_verified CHECK (
    active = false OR (
      verification_status = 'verified' AND evidence_source IS NOT NULL
      AND evidence_observed_at IS NOT NULL AND evidence_expires_at IS NOT NULL
      AND verified_at IS NOT NULL AND evidence_observed_at <= verified_at + interval '5 minutes'
      AND evidence_expires_at > verified_at
      AND evidence_expires_at <= evidence_observed_at + interval '90 days'
    )
  )
);

CREATE INDEX IF NOT EXISTS supplier_fulfilment_origins_lookup_idx
  ON supplier_fulfilment_origins (supplier_id, active, country_code, origin_code);

CREATE UNIQUE INDEX IF NOT EXISTS products_id_supplier_uidx
  ON products (id, supplier_id);

-- This table supersedes the single-row, false-default measurement shape for
-- live rating. Every restriction/fee flag is nullable: NULL means unknown and
-- must block live rating. Multiple package rows per product/variant are valid.
CREATE TABLE IF NOT EXISTS product_fulfilment_packages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id BIGINT NOT NULL,
  supplier_id BIGINT NOT NULL,
  variant_id BIGINT,
  origin_id BIGINT,
  package_index INTEGER NOT NULL,
  package_state TEXT NOT NULL DEFAULT 'unverified',
  weight_grams BIGINT,
  length_mm BIGINT,
  width_mm BIGINT,
  height_mm BIGINT,
  oversized BOOLEAN,
  ships_separately BOOLEAN,
  hazardous BOOLEAN,
  fragile BOOLEAN,
  freight_only BOOLEAN,
  ground_only BOOLEAN,
  evidence_source TEXT,
  evidence_observed_at TIMESTAMPTZ,
  evidence_expires_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT product_fulfilment_packages_variant_fk
    FOREIGN KEY (variant_id, product_id) REFERENCES variants (id, product_id) ON DELETE CASCADE,
  CONSTRAINT product_fulfilment_packages_product_supplier_fk
    FOREIGN KEY (product_id, supplier_id) REFERENCES products (id, supplier_id) ON DELETE CASCADE,
  CONSTRAINT product_fulfilment_packages_origin_supplier_fk
    FOREIGN KEY (origin_id, supplier_id)
    REFERENCES supplier_fulfilment_origins (id, supplier_id),
  CONSTRAINT product_fulfilment_packages_index CHECK (package_index BETWEEN 0 AND 999),
  CONSTRAINT product_fulfilment_packages_state CHECK (
    package_state IN ('unverified', 'verified', 'stale', 'restricted', 'disabled')
  ),
  CONSTRAINT product_fulfilment_packages_measurements CHECK (
    (weight_grams IS NULL OR weight_grams > 0)
    AND (length_mm IS NULL OR length_mm > 0)
    AND (width_mm IS NULL OR width_mm > 0)
    AND (height_mm IS NULL OR height_mm > 0)
  ),
  CONSTRAINT product_fulfilment_packages_verified_complete CHECK (
    package_state <> 'verified' OR (
      origin_id IS NOT NULL AND weight_grams IS NOT NULL AND length_mm IS NOT NULL AND width_mm IS NOT NULL
      AND height_mm IS NOT NULL AND oversized IS NOT NULL AND ships_separately IS NOT NULL
      AND hazardous IS NOT NULL AND fragile IS NOT NULL AND freight_only IS NOT NULL
      AND ground_only IS NOT NULL AND evidence_source IS NOT NULL
      AND evidence_observed_at IS NOT NULL AND evidence_expires_at IS NOT NULL
      AND verified_at IS NOT NULL AND evidence_observed_at <= verified_at + interval '5 minutes'
      AND evidence_expires_at > verified_at
      AND evidence_expires_at <= evidence_observed_at + interval '90 days'
    )
  ),
  CONSTRAINT product_fulfilment_packages_restricted CHECK (
    NOT (oversized IS TRUE OR hazardous IS TRUE OR freight_only IS TRUE OR ground_only IS TRUE)
      OR package_state = 'restricted'
  ),
  CONSTRAINT product_fulfilment_packages_expiry CHECK (
    evidence_expires_at IS NULL OR evidence_observed_at IS NULL
      OR evidence_expires_at >= evidence_observed_at
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS product_fulfilment_packages_scope_uidx
  ON product_fulfilment_packages
  (product_id, COALESCE(variant_id, 0), COALESCE(origin_id, 0), package_index);

CREATE INDEX IF NOT EXISTS product_fulfilment_packages_origin_state_idx
  ON product_fulfilment_packages (origin_id, package_state, product_id, variant_id);

CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;

-- Configuration stores environment-variable references only, never secret
-- values. Provider-specific mappers are still required before test/live mode.
CREATE TABLE IF NOT EXISTS app_private.shipping_provider_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id BIGINT NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  origin_id BIGINT,
  adapter_key TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'disabled',
  endpoint_env_name TEXT,
  credential_env_name TEXT,
  allowed_country_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  timeout_ms INTEGER NOT NULL DEFAULT 2500,
  enabled BOOLEAN NOT NULL DEFAULT false,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT shipping_provider_config_mode CHECK (mode IN ('disabled', 'test', 'live')),
  CONSTRAINT shipping_provider_config_origin_supplier_fk
    FOREIGN KEY (origin_id, supplier_id)
    REFERENCES public.supplier_fulfilment_origins (id, supplier_id)
    ON DELETE CASCADE,
  CONSTRAINT shipping_provider_config_env_names CHECK (
    (endpoint_env_name IS NULL OR endpoint_env_name ~ '^[A-Z][A-Z0-9_]{2,119}$')
    AND (credential_env_name IS NULL OR credential_env_name ~ '^[A-Z][A-Z0-9_]{2,119}$')
  ),
  CONSTRAINT shipping_provider_config_timeout CHECK (timeout_ms BETWEEN 10 AND 10000),
  CONSTRAINT shipping_provider_config_country_codes CHECK (
    allowed_country_codes <@ ARRAY['KW','SA','AE','QA','BH','OM']::TEXT[]
  ),
  CONSTRAINT shipping_provider_config_activation CHECK (
    enabled = false OR (mode IN ('test', 'live') AND reviewed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS shipping_provider_config_scope_uidx
  ON app_private.shipping_provider_configurations
  (supplier_id, COALESCE(origin_id, 0), adapter_key);

CREATE TABLE IF NOT EXISTS app_private.shipping_commercial_rule_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key TEXT NOT NULL UNIQUE,
  version TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  currency CHAR(3) NOT NULL DEFAULT 'KWD',
  handling_bps INTEGER NOT NULL DEFAULT 0,
  minimum_handling_minor BIGINT NOT NULL DEFAULT 0,
  fx_protection_bps INTEGER NOT NULL DEFAULT 0,
  insurance_bps INTEGER NOT NULL DEFAULT 0,
  fragile_fee_minor BIGINT NOT NULL DEFAULT 0,
  oversize_fee_minor BIGINT NOT NULL DEFAULT 0,
  forwarder_fee_minor BIGINT NOT NULL DEFAULT 0,
  local_delivery_fee_minor BIGINT NOT NULL DEFAULT 0,
  rounding_increment_minor BIGINT NOT NULL DEFAULT 1,
  manual_review_threshold_minor BIGINT NOT NULL DEFAULT 0,
  max_revalidation_delta_minor BIGINT NOT NULL DEFAULT 0,
  max_revalidation_delta_bps INTEGER NOT NULL DEFAULT 0,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT shipping_commercial_rules_currency CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT shipping_commercial_rules_bps CHECK (
    handling_bps BETWEEN 0 AND 10000 AND fx_protection_bps BETWEEN 0 AND 10000
    AND insurance_bps BETWEEN 0 AND 10000 AND max_revalidation_delta_bps BETWEEN 0 AND 10000
  ),
  CONSTRAINT shipping_commercial_rules_nonnegative CHECK (
    minimum_handling_minor >= 0 AND fragile_fee_minor >= 0 AND oversize_fee_minor >= 0
    AND forwarder_fee_minor >= 0 AND local_delivery_fee_minor >= 0
    AND rounding_increment_minor > 0 AND manual_review_threshold_minor >= 0
    AND max_revalidation_delta_minor >= 0
  ),
  CONSTRAINT shipping_commercial_rules_activation CHECK (
    enabled = false OR reviewed_at IS NOT NULL
  )
);

INSERT INTO app_private.shipping_commercial_rule_sets (rule_key, version, enabled)
VALUES ('default', 'shipping-commercial-v1', false)
ON CONFLICT (rule_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS app_private.shipping_quotes (
  quote_id UUID PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  fingerprint CHAR(64) NOT NULL,
  selection_fingerprint CHAR(64) NOT NULL,
  status TEXT NOT NULL,
  destination_country_code CHAR(2) NOT NULL,
  destination_fingerprint CHAR(64) NOT NULL,
  fulfilment TEXT NOT NULL,
  target_currency CHAR(3),
  base_shipping_minor BIGINT,
  total_shipping_minor BIGINT,
  protection_margin_minor BIGINT,
  handling_minor BIGINT,
  insurance_minor BIGINT,
  fragile_fee_minor BIGINT,
  oversize_fee_minor BIGINT,
  forwarder_fee_minor BIGINT,
  local_delivery_minor BIGINT,
  rounding_adjustment_minor BIGINT,
  commercial_rules_version TEXT,
  commercial_rules_enabled BOOLEAN NOT NULL DEFAULT false,
  manual_review_required BOOLEAN NOT NULL DEFAULT false,
  revalidation_status TEXT NOT NULL DEFAULT 'not_revalidated',
  revalidated_from_quote_id UUID REFERENCES app_private.shipping_quotes(quote_id),
  quoted_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revalidated_at TIMESTAMPTZ,
  payment_eligible BOOLEAN NOT NULL DEFAULT false,
  record_state TEXT NOT NULL DEFAULT 'pending',
  audit_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  quote_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT shipping_quotes_fingerprint CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT shipping_quotes_selection_fingerprint CHECK (selection_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT shipping_quotes_destination_fingerprint CHECK (destination_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT shipping_quotes_status CHECK (status IN ('confirmed', 'partial', 'confirmation_required')),
  CONSTRAINT shipping_quotes_country CHECK (destination_country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT shipping_quotes_fulfilment CHECK (fulfilment IN ('courier', 'workshop')),
  CONSTRAINT shipping_quotes_currency CHECK (target_currency IS NULL OR target_currency ~ '^[A-Z]{3}$'),
  CONSTRAINT shipping_quotes_money_nonnegative CHECK (
    (base_shipping_minor IS NULL OR base_shipping_minor >= 0)
    AND (total_shipping_minor IS NULL OR total_shipping_minor >= 0)
    AND (protection_margin_minor IS NULL OR protection_margin_minor >= 0)
    AND (handling_minor IS NULL OR handling_minor >= 0)
    AND (insurance_minor IS NULL OR insurance_minor >= 0)
    AND (fragile_fee_minor IS NULL OR fragile_fee_minor >= 0)
    AND (oversize_fee_minor IS NULL OR oversize_fee_minor >= 0)
    AND (forwarder_fee_minor IS NULL OR forwarder_fee_minor >= 0)
    AND (local_delivery_minor IS NULL OR local_delivery_minor >= 0)
    AND (rounding_adjustment_minor IS NULL OR rounding_adjustment_minor >= 0)
  ),
  CONSTRAINT shipping_quotes_expiry CHECK (expires_at > quoted_at),
  CONSTRAINT shipping_quotes_no_payment CHECK (payment_eligible = false),
  CONSTRAINT shipping_quotes_record_state CHECK (record_state IN ('pending', 'complete', 'failed')),
  CONSTRAINT shipping_quotes_audit_object CHECK (jsonb_typeof(audit_snapshot) = 'object'),
  CONSTRAINT shipping_quotes_snapshot_object CHECK (jsonb_typeof(quote_snapshot) = 'object')
);

CREATE INDEX IF NOT EXISTS shipping_quotes_fingerprint_idx
  ON app_private.shipping_quotes (fingerprint, expires_at DESC, quote_id);
CREATE INDEX IF NOT EXISTS shipping_quotes_status_created_idx
  ON app_private.shipping_quotes (status, created_at DESC, quote_id);

CREATE TABLE IF NOT EXISTS app_private.shipping_quote_groups (
  group_id UUID PRIMARY KEY,
  quote_id UUID NOT NULL REFERENCES app_private.shipping_quotes(quote_id) ON DELETE CASCADE,
  supplier_slug TEXT NOT NULL,
  origin_code TEXT NOT NULL,
  origin_country_code CHAR(2) NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  package_data_status TEXT NOT NULL,
  provider_key TEXT,
  provider_duration_ms INTEGER,
  selected_option_id TEXT,
  rate_minor BIGINT,
  rate_currency CHAR(3),
  converted_rate_minor BIGINT,
  converted_currency CHAR(3),
  conversion_status TEXT NOT NULL,
  exchange_rate TEXT,
  exchange_rate_as_of TIMESTAMPTZ,
  exchange_rate_provider TEXT,
  restrictions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (quote_id, supplier_slug, origin_code),
  CONSTRAINT shipping_quote_groups_status CHECK (status IN ('confirmed', 'partial', 'confirmation_required')),
  CONSTRAINT shipping_quote_groups_country CHECK (origin_country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT shipping_quote_groups_currency CHECK (
    (rate_currency IS NULL OR rate_currency ~ '^[A-Z]{3}$')
    AND (converted_currency IS NULL OR converted_currency ~ '^[A-Z]{3}$')
  ),
  CONSTRAINT shipping_quote_groups_money CHECK (
    (rate_minor IS NULL OR rate_minor >= 0) AND (converted_rate_minor IS NULL OR converted_rate_minor >= 0)
  ),
  CONSTRAINT shipping_quote_groups_conversion CHECK (
    conversion_status IN ('confirmed', 'confirmation_required')
  ),
  CONSTRAINT shipping_quote_groups_restrictions_array CHECK (jsonb_typeof(restrictions) = 'array')
);

CREATE INDEX IF NOT EXISTS shipping_quote_groups_quote_idx
  ON app_private.shipping_quote_groups (quote_id, supplier_slug, origin_code);

CREATE TABLE IF NOT EXISTS app_private.shipping_quote_packages (
  package_id UUID PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES app_private.shipping_quote_groups(group_id) ON DELETE CASCADE,
  product_public_key TEXT NOT NULL,
  supplier_variant_key TEXT,
  sku TEXT,
  quantity INTEGER NOT NULL,
  package_count INTEGER NOT NULL,
  package_state TEXT NOT NULL,
  weight_grams BIGINT,
  length_mm BIGINT,
  width_mm BIGINT,
  height_mm BIGINT,
  oversized BOOLEAN,
  ships_separately BOOLEAN,
  hazardous BOOLEAN,
  fragile BOOLEAN,
  freight_only BOOLEAN,
  ground_only BOOLEAN,
  evidence_source TEXT,
  evidence_observed_at TIMESTAMPTZ,
  evidence_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT shipping_quote_packages_quantity CHECK (quantity BETWEEN 1 AND 999),
  CONSTRAINT shipping_quote_packages_count CHECK (package_count BETWEEN 1 AND 999),
  CONSTRAINT shipping_quote_packages_state CHECK (
    package_state IN ('missing', 'unverified', 'verified', 'stale', 'restricted')
  )
);

CREATE INDEX IF NOT EXISTS shipping_quote_packages_group_idx
  ON app_private.shipping_quote_packages (group_id, product_public_key, supplier_variant_key);

CREATE TABLE IF NOT EXISTS app_private.shipping_rate_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES app_private.shipping_quote_groups(group_id) ON DELETE CASCADE,
  provider_option_id TEXT NOT NULL,
  carrier TEXT NOT NULL,
  service TEXT NOT NULL,
  rate_minor BIGINT NOT NULL,
  currency CHAR(3) NOT NULL,
  converted_rate_minor BIGINT,
  converted_currency CHAR(3),
  conversion_status TEXT NOT NULL,
  dispatch_min_days INTEGER,
  dispatch_max_days INTEGER,
  transit_min_days INTEGER,
  transit_max_days INTEGER,
  incoterm TEXT NOT NULL DEFAULT 'unknown',
  duties_included BOOLEAN,
  tax_included BOOLEAN,
  insurance_minor BIGINT,
  handling_minor BIGINT,
  provider_reference_hash CHAR(64),
  quoted_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, provider_option_id),
  CONSTRAINT shipping_rate_options_currency CHECK (
    currency ~ '^[A-Z]{3}$' AND (converted_currency IS NULL OR converted_currency ~ '^[A-Z]{3}$')
  ),
  CONSTRAINT shipping_rate_options_money CHECK (
    rate_minor >= 0 AND (converted_rate_minor IS NULL OR converted_rate_minor >= 0)
    AND (insurance_minor IS NULL OR insurance_minor >= 0)
    AND (handling_minor IS NULL OR handling_minor >= 0)
  ),
  CONSTRAINT shipping_rate_options_conversion CHECK (
    conversion_status IN ('confirmed', 'confirmation_required')
  ),
  CONSTRAINT shipping_rate_options_expiry CHECK (expires_at > quoted_at),
  CONSTRAINT shipping_rate_options_reference_hash CHECK (
    provider_reference_hash IS NULL OR provider_reference_hash ~ '^[0-9a-f]{64}$'
  )
);

CREATE INDEX IF NOT EXISTS shipping_rate_options_group_expiry_idx
  ON app_private.shipping_rate_options (group_id, expires_at, provider_option_id);

CREATE TABLE IF NOT EXISTS app_private.shipping_rate_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quote_id UUID REFERENCES app_private.shipping_quotes(quote_id) ON DELETE SET NULL,
  group_id UUID REFERENCES app_private.shipping_quote_groups(group_id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  reason_code TEXT,
  provider_key TEXT,
  duration_ms INTEGER,
  request_fingerprint CHAR(64),
  previous_total_minor BIGINT,
  next_total_minor BIGINT,
  currency CHAR(3),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT shipping_rate_audit_outcome CHECK (outcome IN ('accepted', 'rejected', 'unavailable', 'error')),
  CONSTRAINT shipping_rate_audit_fingerprint CHECK (
    request_fingerprint IS NULL OR request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT shipping_rate_audit_currency CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  CONSTRAINT shipping_rate_audit_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS shipping_rate_audit_quote_created_idx
  ON app_private.shipping_rate_audit (quote_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS shipping_rate_audit_outcome_created_idx
  ON app_private.shipping_rate_audit (outcome, created_at DESC, id);

-- Seed only identities for suppliers that already exist. These records are
-- deliberately unverified/inactive and cannot enable a live quote.
INSERT INTO supplier_fulfilment_origins
  (supplier_id, origin_code, display_name, country_code, verification_status, active)
SELECT id, 'tegiwa-gb-primary', 'Tegiwa Great Britain origin (verification required)', 'GB', 'unverified', false
FROM suppliers WHERE slug = 'tegiwa'
ON CONFLICT (supplier_id, origin_code) DO NOTHING;

INSERT INTO supplier_fulfilment_origins
  (supplier_id, origin_code, display_name, country_code, verification_status, active)
SELECT id, 'ecs-us-primary', 'ECS United States origin (verification required)', 'US', 'unverified', false
FROM suppliers WHERE slug = 'ecs'
ON CONFLICT (supplier_id, origin_code) DO NOTHING;

REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app_private FROM PUBLIC;

COMMENT ON TABLE product_fulfilment_packages IS
  'Multi-package logistics evidence. Nullable flags are unknown and block live rating.';
COMMENT ON TABLE app_private.shipping_quotes IS
  'PII-minimised, no-payment shipping quote snapshots bound to canonical cart/destination fingerprints.';
COMMENT ON TABLE app_private.shipping_rate_audit IS
  'PII-safe supplier-rate and revalidation outcomes. Raw provider payloads and credentials are forbidden.';

COMMIT;
