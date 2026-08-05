# Customer commerce backend

This is the server-side foundation for Projx Racing customer accounts, saved addresses, persistent carts, quote requests, order history and shop notifications. It preserves Clerk as the only identity provider, stores private data only in Neon, and uses Resend only from Vercel Functions.

## Current activation status

The code and automated tests are complete locally. `migrations/002_private_customer_commerce.sql` has **not** been applied to Neon: the required temporary migration branch could not be created because the `projx-racing-parts-catalogue` project is above its 512 MB storage limit. The failed preparation made no schema changes to the main branch.

Increase the Neon project storage allowance before activation. Do not bypass temporary-branch verification by applying the migration directly to `main`.

## Private data boundary

All customer-commerce tables live under the `app_private` schema:

- `customer_accounts`
- `customer_addresses`
- `carts` and `cart_items`
- `quotes` and `quote_items`
- `orders` and `order_items`
- `email_outbox`

The migration revokes access from PostgreSQL's `PUBLIC` role and configures the same default for future objects in that schema. Catalogue tables remain unchanged. Product, price and address details are snapshotted into quotes and orders so supplier catalogue refreshes cannot rewrite customer history.

Verified `user.deleted` events anonymize the live account row and remove saved addresses and carts. The Clerk user ID remains only as a tombstone so a delayed token or out-of-order event cannot silently recreate the profile. Quote and order snapshots are not silently erased because they may form part of a commercial or legal record. Account-notification outbox payloads are scrubbed and unsent account notifications are cancelled. Projx Racing must approve a retention period and scheduled purge or anonymization policy for quote/order snapshots before production customer data is accepted.

## Authentication

Protected routes require `Authorization: Bearer <Clerk session JWT>`. The server verifies the JWT signature against the configured Clerk JWKS and enforces issuer, expiry and not-before time. Token scoping is mandatory: configure at least one expected audience or an authorized-party origin allowlist. When both are configured, both must match. A Clerk browser session by itself never grants database access.

Required production settings:

- `CLERK_PUBLISHABLE_KEY` — browser-side Clerk key already used by the approved site
- `CLERK_ISSUER` — exact HTTPS issuer from the Clerk instance
- `CLERK_JWKS_URL` — optional HTTPS JWKS override; normally derived from the issuer
- `CLERK_AUDIENCE` — expected audience; comma-separated values are accepted
- `CLERK_AUTHORIZED_PARTIES` — comma-separated exact HTTPS origins allowed in the token `azp` claim; local HTTP is accepted only for `localhost`, `127.0.0.1` or `[::1]`
- `CLERK_WEBHOOK_SECRET` — server-only signing secret for Clerk account lifecycle webhooks
- `DATABASE_URL` — server-only Neon connection string for the application database

At least one of `CLERK_AUDIENCE` or `CLERK_AUTHORIZED_PARTIES` is required. Without a valid token or required server configuration, protected routes fail closed.

## Routes

| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/account` | `GET`, `PATCH` | Read or update the signed-in account profile |
| `/api/addresses` | `GET`, `POST`, `PUT`, `DELETE` | Manage account-owned saved addresses; updates/deletes use `?id=<uuid>` |
| `/api/cart` | `GET`, `PUT` | Read or atomically replace the signed-in account's active cart |
| `/api/quotes` | `GET`, `POST` | Read quote history or submit an idempotent parts quote request |
| `/api/orders` | `GET` | Read account-owned order history; customers cannot create paid orders |
| `/api/clerk-webhook` | `POST` | Receive signed Clerk lifecycle events; not a browser endpoint |
| `/api/commerce-email-retry` | `POST` | Claim and retry due shop-notification outbox rows; requires a separate bearer secret |

Mutating requests are same-origin only. Payloads have strict field and size limits. Monetary values use integer minor units plus the supplier's three-letter currency; the server does not add VAT, convert currency, or claim that a quote is a paid order.

## Shop email notifications

Quote submission writes the quote, its items and a pending outbox event in one database transaction. It then attempts delivery through Resend with a deterministic idempotency key. A successful provider ID is recorded; a provider failure remains retryable without duplicating the customer record.

Messages contain English and Arabic labels, escape all customer-controlled text, and default to `projxracing@gmail.com`. Customer-submitted prices are intentionally omitted from quote notification emails so they cannot be mistaken for supplier-verified prices. The destination can later be changed with `SHOP_NOTIFICATION_EMAIL` without changing source code.

New-account notifications come only from Clerk's signed `user.created` webhook. Verified `user.updated` events synchronize the active account profile, and verified `user.deleted` events run the anonymization lifecycle above without sending a registration email. The endpoint verifies the raw-body HMAC, delivery ID and five-minute timestamp window before parsing or storing the payload. Unsigned, stale, malformed or already-delivered events cannot trigger a new email. Configure the Clerk webhook target as `/api/clerk-webhook`; webhook activation is pending until the deployed URL exists and `CLERK_WEBHOOK_SECRET` is set.

The retry endpoint atomically claims at most five due rows with `FOR UPDATE SKIP LOCKED`, gives each claim a ten-minute recovery lease, delivers the bounded batch concurrently, and reuses the stored Resend idempotency key. It rejects missing or incorrect credentials before opening a database connection and rejects missing email configuration before claiming work. Set a random `COMMERCE_OUTBOX_RETRY_SECRET` of at least 32 visible ASCII characters, then configure a trusted scheduler to send `POST /api/commerce-email-retry` with `Authorization: Bearer <secret>`. This repository does not create that scheduler or expose the secret to browser code.

Required settings for live delivery:

- `RESEND_API_KEY`
- `COMMERCE_FROM_EMAIL` (or the existing `ENQUIRY_FROM_EMAIL`)
- `SHOP_NOTIFICATION_EMAIL` (optional; defaults to `projxracing@gmail.com`)
- `COMMERCE_OUTBOX_RETRY_SECRET` (server-only, at least 32 characters)

No email is sent when these settings are absent. The quote remains recorded with a pending outbox event. This repository does not provision Resend, verify a sender domain, or send a test message automatically.

## Safe Neon activation

1. Increase the Neon project storage limit so a temporary branch can be created.
2. Prepare `migrations/002_private_customer_commerce.sql` against `neondb` in a temporary child branch.
3. Verify that the nine tables exist under `app_private`, that `PUBLIC` has no schema/table privileges, and that the existing public catalogue counts are unchanged.
4. Apply that exact verified migration to the `main` branch.
5. Re-run the schema and privilege checks on `main`.
6. Review `migrations/002_private_customer_commerce_role_template.sql`, create a separate SQL LOGIN role with an externally generated credential, verify that it has no Neon administrative memberships, apply the explicit grants, and test it on the temporary branch. Neon documents that SQL-created roles receive only explicitly granted PostgreSQL privileges; do not substitute a role that automatically receives administrative membership.
7. Add the least-privilege pooled connection string and other required values only in Vercel's encrypted environment settings and redeploy the preview branch.

The migration is additive and idempotent: it contains no drops, truncation, renames or catalogue mutations. Before customer data exists, rollback is best performed by restoring the pre-migration Neon branch/checkpoint. After customer data exists, do not drop the schema; disable the routes, preserve the data, and use a separately reviewed forward migration. Any destructive rollback requires explicit approval and a verified backup.

## Verification

Run `npm run test:customer-commerce`. The suite covers Clerk signature verification, mandatory audience/authorized-party scoping, fail-closed behavior, signed account lifecycle events, validation and currency totals, price omission, Arabic/English email rendering, HTML escaping, Resend recipient/idempotency, protected API behavior, authenticated outbox retry, account anonymization, and migration/role isolation.
