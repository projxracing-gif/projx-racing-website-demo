-- OPTIONAL LEAST-PRIVILEGE ROLE TEMPLATE — DO NOT APPLY AUTOMATICALLY.
--
-- Run this only after migrations/001_unified_parts_catalogue.sql and
-- migrations/002_private_customer_commerce.sql have been verified on a
-- temporary Neon branch. This creates a NOLOGIN privilege role only; it never
-- creates a password or changes DATABASE_URL. Create a separate SQL LOGIN role
-- with a securely generated credential outside this file, grant this role to
-- that LOGIN role, then use the LOGIN role's pooled connection string in
-- Vercel. Do not create the runtime LOGIN through a path that automatically
-- grants Neon administrative membership; verify its memberships first.

DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'projx_commerce_runtime') THEN
    CREATE ROLE projx_commerce_runtime
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$role$;

ALTER ROLE projx_commerce_runtime
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

REVOKE CREATE ON SCHEMA public FROM projx_commerce_runtime;
GRANT USAGE ON SCHEMA public, app_private TO projx_commerce_runtime;

-- Public catalogue access is deliberately read-only and explicitly named.
GRANT SELECT ON TABLE
  public.suppliers,
  public.catalog_imports,
  public.catalog_state,
  public.brands,
  public.part_types,
  public.products,
  public.product_part_types,
  public.variants,
  public.product_identifiers,
  public.offers,
  public.product_images,
  public.vehicle_makes,
  public.vehicle_models,
  public.vehicle_applications,
  public.product_fitments,
  public.product_search
TO projx_commerce_runtime;

-- Customer data is accessible only through the server-side application role.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app_private
  TO projx_commerce_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app_private
  TO projx_commerce_runtime;

-- These defaults apply to future objects created by the role executing this
-- template. Re-run the explicit grants after adding a new catalogue table.
ALTER DEFAULT PRIVILEGES IN SCHEMA app_private
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO projx_commerce_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_private
  GRANT USAGE, SELECT ON SEQUENCES TO projx_commerce_runtime;

-- After creating a separate least-privilege SQL LOGIN role, verify it has no
-- administrative memberships, then an administrator may run:
-- GRANT projx_commerce_runtime TO your_secure_runtime_login_role;
-- Do not grant neon_superuser membership or schema CREATE privileges.
