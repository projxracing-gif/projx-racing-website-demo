-- Private customer-commerce foundation for the Projx Racing website.
--
-- This migration is intentionally additive and idempotent. Customer records are
-- isolated from the public catalogue so browser clients can never query them
-- directly through a public data API. Only the server-side Neon role receives
-- access through DATABASE_URL.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;

CREATE TABLE IF NOT EXISTS app_private.customer_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL UNIQUE,
  email TEXT,
  display_name TEXT,
  phone TEXT,
  preferred_locale TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customer_accounts_clerk_user_id_length CHECK (char_length(clerk_user_id) BETWEEN 3 AND 255),
  CONSTRAINT customer_accounts_email_length CHECK (email IS NULL OR char_length(email) BETWEEN 3 AND 320),
  CONSTRAINT customer_accounts_locale CHECK (preferred_locale IN ('en', 'ar')),
  CONSTRAINT customer_accounts_status CHECK (status IN ('active', 'disabled', 'deletion_requested', 'anonymized'))
);

CREATE INDEX IF NOT EXISTS customer_accounts_email_idx
  ON app_private.customer_accounts (lower(email))
  WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS app_private.customer_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES app_private.customer_accounts(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address_line_1 TEXT NOT NULL,
  address_line_2 TEXT,
  area TEXT,
  city TEXT NOT NULL,
  postal_code TEXT,
  country_code CHAR(2) NOT NULL,
  is_default_shipping BOOLEAN NOT NULL DEFAULT false,
  is_default_billing BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customer_addresses_label_length CHECK (char_length(label) BETWEEN 1 AND 80),
  CONSTRAINT customer_addresses_recipient_length CHECK (char_length(recipient_name) BETWEEN 1 AND 200),
  CONSTRAINT customer_addresses_country_code CHECK (country_code ~ '^[A-Z]{2}$')
);

CREATE INDEX IF NOT EXISTS customer_addresses_account_created_idx
  ON app_private.customer_addresses (account_id, created_at DESC, id);

CREATE UNIQUE INDEX IF NOT EXISTS customer_addresses_one_default_shipping_idx
  ON app_private.customer_addresses (account_id)
  WHERE is_default_shipping;

CREATE UNIQUE INDEX IF NOT EXISTS customer_addresses_one_default_billing_idx
  ON app_private.customer_addresses (account_id)
  WHERE is_default_billing;

CREATE TABLE IF NOT EXISTS app_private.carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES app_private.customer_accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT carts_status CHECK (status IN ('active', 'submitted', 'converted', 'abandoned'))
);

CREATE UNIQUE INDEX IF NOT EXISTS carts_one_active_per_account_idx
  ON app_private.carts (account_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS carts_account_updated_idx
  ON app_private.carts (account_id, updated_at DESC, id);

CREATE TABLE IF NOT EXISTS app_private.cart_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id UUID NOT NULL REFERENCES app_private.carts(id) ON DELETE CASCADE,
  supplier_slug TEXT NOT NULL,
  product_public_key TEXT NOT NULL,
  supplier_product_key TEXT,
  supplier_variant_key TEXT,
  sku TEXT,
  title TEXT NOT NULL,
  option_title TEXT,
  quantity INTEGER NOT NULL,
  unit_price_minor BIGINT,
  currency CHAR(3),
  product_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cart_items_quantity CHECK (quantity BETWEEN 1 AND 1000),
  CONSTRAINT cart_items_price CHECK (unit_price_minor IS NULL OR unit_price_minor >= 0),
  CONSTRAINT cart_items_currency CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  CONSTRAINT cart_items_snapshot_object CHECK (jsonb_typeof(product_snapshot) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS cart_items_variant_identity_idx
  ON app_private.cart_items (
    cart_id,
    supplier_slug,
    product_public_key,
    COALESCE(supplier_variant_key, ''),
    COALESCE(sku, '')
  );

CREATE INDEX IF NOT EXISTS cart_items_cart_created_idx
  ON app_private.cart_items (cart_id, created_at, id);

CREATE TABLE IF NOT EXISTS app_private.quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES app_private.customer_accounts(id) ON DELETE SET NULL,
  source_cart_id UUID REFERENCES app_private.carts(id) ON DELETE SET NULL,
  request_reference TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'submitted',
  locale TEXT NOT NULL DEFAULT 'en',
  customer_snapshot JSONB NOT NULL,
  destination_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  vehicle_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  totals JSONB NOT NULL DEFAULT '[]'::jsonb,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT quotes_reference_length CHECK (char_length(request_reference) BETWEEN 8 AND 80),
  CONSTRAINT quotes_idempotency_length CHECK (char_length(idempotency_key) BETWEEN 16 AND 200),
  CONSTRAINT quotes_status CHECK (status IN ('submitted', 'reviewing', 'quoted', 'accepted', 'declined', 'expired', 'cancelled')),
  CONSTRAINT quotes_locale CHECK (locale IN ('en', 'ar')),
  CONSTRAINT quotes_customer_object CHECK (jsonb_typeof(customer_snapshot) = 'object'),
  CONSTRAINT quotes_destination_object CHECK (jsonb_typeof(destination_snapshot) = 'object'),
  CONSTRAINT quotes_vehicle_object CHECK (jsonb_typeof(vehicle_snapshot) = 'object'),
  CONSTRAINT quotes_totals_array CHECK (jsonb_typeof(totals) = 'array')
);

CREATE INDEX IF NOT EXISTS quotes_account_submitted_idx
  ON app_private.quotes (account_id, submitted_at DESC, id);

CREATE INDEX IF NOT EXISTS quotes_status_submitted_idx
  ON app_private.quotes (status, submitted_at DESC, id);

CREATE TABLE IF NOT EXISTS app_private.quote_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES app_private.quotes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  supplier_slug TEXT NOT NULL,
  product_public_key TEXT NOT NULL,
  supplier_variant_key TEXT,
  sku TEXT,
  title TEXT NOT NULL,
  option_title TEXT,
  quantity INTEGER NOT NULL,
  unit_price_minor BIGINT,
  currency CHAR(3),
  item_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT quote_items_position CHECK (position BETWEEN 0 AND 9999),
  CONSTRAINT quote_items_quantity CHECK (quantity BETWEEN 1 AND 1000),
  CONSTRAINT quote_items_price CHECK (unit_price_minor IS NULL OR unit_price_minor >= 0),
  CONSTRAINT quote_items_currency CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  CONSTRAINT quote_items_snapshot_object CHECK (jsonb_typeof(item_snapshot) = 'object'),
  UNIQUE (quote_id, position)
);

CREATE INDEX IF NOT EXISTS quote_items_quote_position_idx
  ON app_private.quote_items (quote_id, position, id);

CREATE TABLE IF NOT EXISTS app_private.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES app_private.customer_accounts(id) ON DELETE SET NULL,
  quote_id UUID REFERENCES app_private.quotes(id) ON DELETE SET NULL,
  order_reference TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending_review',
  payment_status TEXT NOT NULL DEFAULT 'not_collected',
  locale TEXT NOT NULL DEFAULT 'en',
  customer_snapshot JSONB NOT NULL,
  destination_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  vehicle_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  totals JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT orders_reference_length CHECK (char_length(order_reference) BETWEEN 8 AND 80),
  CONSTRAINT orders_idempotency_length CHECK (char_length(idempotency_key) BETWEEN 16 AND 200),
  CONSTRAINT orders_status CHECK (status IN ('pending_review', 'confirmed', 'awaiting_payment', 'processing', 'shipped', 'completed', 'cancelled')),
  CONSTRAINT orders_payment_status CHECK (payment_status IN ('not_collected', 'pending', 'paid', 'partially_refunded', 'refunded', 'failed')),
  CONSTRAINT orders_locale CHECK (locale IN ('en', 'ar')),
  CONSTRAINT orders_customer_object CHECK (jsonb_typeof(customer_snapshot) = 'object'),
  CONSTRAINT orders_destination_object CHECK (jsonb_typeof(destination_snapshot) = 'object'),
  CONSTRAINT orders_vehicle_object CHECK (jsonb_typeof(vehicle_snapshot) = 'object'),
  CONSTRAINT orders_totals_array CHECK (jsonb_typeof(totals) = 'array')
);

CREATE INDEX IF NOT EXISTS orders_account_created_idx
  ON app_private.orders (account_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS orders_status_created_idx
  ON app_private.orders (status, created_at DESC, id);

CREATE TABLE IF NOT EXISTS app_private.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES app_private.orders(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  supplier_slug TEXT NOT NULL,
  product_public_key TEXT NOT NULL,
  supplier_variant_key TEXT,
  sku TEXT,
  title TEXT NOT NULL,
  option_title TEXT,
  quantity INTEGER NOT NULL,
  unit_price_minor BIGINT,
  currency CHAR(3),
  item_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT order_items_position CHECK (position BETWEEN 0 AND 9999),
  CONSTRAINT order_items_quantity CHECK (quantity BETWEEN 1 AND 1000),
  CONSTRAINT order_items_price CHECK (unit_price_minor IS NULL OR unit_price_minor >= 0),
  CONSTRAINT order_items_currency CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  CONSTRAINT order_items_snapshot_object CHECK (jsonb_typeof(item_snapshot) = 'object'),
  UNIQUE (order_id, position)
);

CREATE INDEX IF NOT EXISTS order_items_order_position_idx
  ON app_private.order_items (order_id, position, id);

CREATE TABLE IF NOT EXISTS app_private.email_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  recipient TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en',
  template_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  provider_message_id TEXT,
  last_error_code TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT email_outbox_aggregate_type CHECK (aggregate_type IN ('quote', 'order', 'account')),
  CONSTRAINT email_outbox_event_type_length CHECK (char_length(event_type) BETWEEN 3 AND 100),
  CONSTRAINT email_outbox_recipient_length CHECK (char_length(recipient) BETWEEN 3 AND 320),
  CONSTRAINT email_outbox_locale CHECK (locale IN ('en', 'ar')),
  CONSTRAINT email_outbox_idempotency_length CHECK (char_length(idempotency_key) BETWEEN 16 AND 200),
  CONSTRAINT email_outbox_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT email_outbox_status CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  CONSTRAINT email_outbox_attempts CHECK (attempt_count BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS email_outbox_delivery_idx
  ON app_private.email_outbox (status, next_attempt_at, created_at, id)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS email_outbox_aggregate_idx
  ON app_private.email_outbox (aggregate_type, aggregate_id, created_at DESC);

REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app_private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_private REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_private REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_private REVOKE ALL ON FUNCTIONS FROM PUBLIC;
