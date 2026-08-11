import { randomBytes, randomUUID } from 'node:crypto';

function account(row) {
  return row ? {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    phone: row.phone,
    preferredLocale: row.preferred_locale,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } : null;
}

function address(row) {
  return {
    id: row.id,
    label: row.label,
    recipientName: row.recipient_name,
    phone: row.phone,
    addressLine1: row.address_line_1,
    addressLine2: row.address_line_2,
    area: row.area,
    city: row.city,
    postalCode: row.postal_code,
    countryCode: row.country_code,
    isDefaultShipping: row.is_default_shipping,
    isDefaultBilling: row.is_default_billing,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function cartItem(row) {
  const snapshot = row?.product_snapshot && typeof row.product_snapshot === 'object' && !Array.isArray(row.product_snapshot)
    ? row.product_snapshot
    : {};
  return {
    id: row.id,
    supplier: row.supplier_slug,
    productId: row.product_public_key,
    sourceHandle: typeof snapshot.sourceHandle === 'string' ? snapshot.sourceHandle : null,
    supplierProductId: row.supplier_product_key,
    variantId: row.supplier_variant_key,
    sku: row.sku,
    title: row.title,
    optionTitle: row.option_title,
    quantity: row.quantity,
    unitAmount: row.unit_price_minor === null ? null : Number(row.unit_price_minor),
    currency: row.currency
  };
}

function quote(row) {
  return {
    id: row.id,
    reference: row.request_reference,
    status: row.status,
    locale: row.locale,
    customer: row.customer_snapshot,
    destination: row.destination_snapshot,
    vehicle: row.vehicle_snapshot,
    notes: row.notes,
    totals: row.totals,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at
  };
}

function order(row) {
  return {
    id: row.id,
    reference: row.order_reference,
    status: row.status,
    paymentStatus: row.payment_status,
    locale: row.locale,
    totals: row.totals,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function reference(prefix) {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `PRX-${prefix}-${stamp}-${randomBytes(5).toString('hex').toUpperCase()}`;
}

export function createCommerceRepository(database) {
  async function ensureAccount(identity) {
    const rows = await database.query(`
      INSERT INTO app_private.customer_accounts (clerk_user_id, email, display_name, phone)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (clerk_user_id) DO UPDATE SET
        email = CASE WHEN app_private.customer_accounts.status = 'active'
          THEN COALESCE(EXCLUDED.email, app_private.customer_accounts.email)
          ELSE app_private.customer_accounts.email END,
        display_name = CASE WHEN app_private.customer_accounts.status = 'active'
          THEN COALESCE(EXCLUDED.display_name, app_private.customer_accounts.display_name)
          ELSE app_private.customer_accounts.display_name END,
        phone = CASE WHEN app_private.customer_accounts.status = 'active'
          THEN COALESCE(EXCLUDED.phone, app_private.customer_accounts.phone)
          ELSE app_private.customer_accounts.phone END,
        updated_at = CASE
          WHEN app_private.customer_accounts.status = 'active'
            AND (EXCLUDED.email IS NOT NULL OR EXCLUDED.display_name IS NOT NULL OR EXCLUDED.phone IS NOT NULL) THEN now()
          ELSE app_private.customer_accounts.updated_at
        END
      RETURNING *
    `, [identity.userId, identity.email, identity.displayName, identity.phone || null]);
    return account(rows[0]);
  }

  return {
    ensureAccount,

    async syncAccount(identity) {
      const rows = await database.query(`
        INSERT INTO app_private.customer_accounts (clerk_user_id, email, display_name, phone)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (clerk_user_id) DO UPDATE SET
          email = CASE WHEN app_private.customer_accounts.status = 'active'
            THEN EXCLUDED.email ELSE app_private.customer_accounts.email END,
          display_name = CASE WHEN app_private.customer_accounts.status = 'active'
            THEN EXCLUDED.display_name ELSE app_private.customer_accounts.display_name END,
          phone = CASE WHEN app_private.customer_accounts.status = 'active'
            THEN EXCLUDED.phone ELSE app_private.customer_accounts.phone END,
          updated_at = CASE WHEN app_private.customer_accounts.status = 'active'
            THEN now() ELSE app_private.customer_accounts.updated_at END
        RETURNING *
      `, [identity.userId, identity.email, identity.displayName, identity.phone || null]);
      return account(rows[0]);
    },

    async anonymizeAccountByClerkUserId(userId) {
      const results = await database.transaction([
        {
          statement: `INSERT INTO app_private.customer_accounts (clerk_user_id, status)
            VALUES ($1, 'anonymized')
            ON CONFLICT (clerk_user_id) DO UPDATE SET
              email=NULL, display_name=NULL, phone=NULL, status='anonymized', updated_at=now()
            RETURNING *`,
          parameters: [userId]
        },
        {
          statement: `DELETE FROM app_private.customer_addresses
            WHERE account_id IN (SELECT id FROM app_private.customer_accounts WHERE clerk_user_id=$1)`,
          parameters: [userId]
        },
        {
          statement: `DELETE FROM app_private.carts
            WHERE account_id IN (SELECT id FROM app_private.customer_accounts WHERE clerk_user_id=$1)`,
          parameters: [userId]
        },
        {
          statement: `UPDATE app_private.email_outbox SET
            payload=jsonb_build_object('event','account.anonymized'),
            status=CASE WHEN status IN ('pending','failed','sending') THEN 'cancelled' ELSE status END,
            last_error_code=CASE WHEN status IN ('pending','failed','sending') THEN 'account_anonymized' ELSE last_error_code END,
            updated_at=now()
            WHERE aggregate_type='account' AND aggregate_id IN
              (SELECT id FROM app_private.customer_accounts WHERE clerk_user_id=$1)`,
          parameters: [userId]
        }
      ]);
      return account(results[0][0]);
    },

    async updateAccount(accountId, values) {
      const rows = await database.query(`
        UPDATE app_private.customer_accounts SET
          display_name = CASE WHEN $2 THEN $3 ELSE display_name END,
          phone = CASE WHEN $4 THEN $5 ELSE phone END,
          preferred_locale = CASE WHEN $6 THEN $7 ELSE preferred_locale END,
          updated_at = now()
        WHERE id = $1 AND status = 'active'
        RETURNING *
      `, [
        accountId,
        Object.hasOwn(values, 'displayName'), values.displayName ?? null,
        Object.hasOwn(values, 'phone'), values.phone ?? null,
        Object.hasOwn(values, 'preferredLocale'), values.preferredLocale ?? null
      ]);
      return account(rows[0]);
    },

    async listAddresses(accountId) {
      const rows = await database.query(`
        SELECT * FROM app_private.customer_addresses
        WHERE account_id = $1
        ORDER BY is_default_shipping DESC, is_default_billing DESC, created_at DESC, id
      `, [accountId]);
      return rows.map(address);
    },

    async createAddress(accountId, value) {
      const id = randomUUID();
      const statements = [];
      if (value.isDefaultShipping) statements.push({
        statement: `UPDATE app_private.customer_addresses SET is_default_shipping = false, updated_at = now()
          WHERE account_id = $1 AND is_default_shipping`, parameters: [accountId]
      });
      if (value.isDefaultBilling) statements.push({
        statement: `UPDATE app_private.customer_addresses SET is_default_billing = false, updated_at = now()
          WHERE account_id = $1 AND is_default_billing`, parameters: [accountId]
      });
      statements.push({
        statement: `INSERT INTO app_private.customer_addresses (
          id, account_id, label, recipient_name, phone, address_line_1, address_line_2, area, city,
          postal_code, country_code, is_default_shipping, is_default_billing
        ) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
          WHERE EXISTS (SELECT 1 FROM app_private.customer_accounts WHERE id=$2 AND status='active')
          RETURNING *`,
        parameters: [id, accountId, value.label, value.recipientName, value.phone, value.addressLine1,
          value.addressLine2, value.area, value.city, value.postalCode, value.countryCode,
          value.isDefaultShipping, value.isDefaultBilling]
      });
      const results = await database.transaction(statements);
      return results.at(-1)[0] ? address(results.at(-1)[0]) : null;
    },

    async replaceAddress(accountId, addressId, value) {
      const statements = [];
      if (value.isDefaultShipping) statements.push({
        statement: `UPDATE app_private.customer_addresses SET is_default_shipping = false, updated_at = now()
          WHERE account_id = $1 AND id <> $2 AND is_default_shipping
          AND EXISTS (SELECT 1 FROM app_private.customer_addresses target WHERE target.account_id=$1 AND target.id=$2)`,
        parameters: [accountId, addressId]
      });
      if (value.isDefaultBilling) statements.push({
        statement: `UPDATE app_private.customer_addresses SET is_default_billing = false, updated_at = now()
          WHERE account_id = $1 AND id <> $2 AND is_default_billing
          AND EXISTS (SELECT 1 FROM app_private.customer_addresses target WHERE target.account_id=$1 AND target.id=$2)`,
        parameters: [accountId, addressId]
      });
      statements.push({
        statement: `UPDATE app_private.customer_addresses SET
          label=$3, recipient_name=$4, phone=$5, address_line_1=$6, address_line_2=$7, area=$8,
          city=$9, postal_code=$10, country_code=$11, is_default_shipping=$12,
          is_default_billing=$13, updated_at=now()
          WHERE account_id=$1 AND id=$2
            AND EXISTS (SELECT 1 FROM app_private.customer_accounts WHERE id=$1 AND status='active')
          RETURNING *`,
        parameters: [accountId, addressId, value.label, value.recipientName, value.phone, value.addressLine1,
          value.addressLine2, value.area, value.city, value.postalCode, value.countryCode,
          value.isDefaultShipping, value.isDefaultBilling]
      });
      const results = await database.transaction(statements);
      return results.at(-1)[0] ? address(results.at(-1)[0]) : null;
    },

    async deleteAddress(accountId, addressId) {
      const rows = await database.query(
        `DELETE FROM app_private.customer_addresses WHERE account_id=$1 AND id=$2
          AND EXISTS (SELECT 1 FROM app_private.customer_accounts WHERE id=$1 AND status='active') RETURNING id`,
        [accountId, addressId]
      );
      return Boolean(rows[0]);
    },

    async getCart(accountId) {
      const carts = await database.query(`
        INSERT INTO app_private.carts (account_id) VALUES ($1)
        ON CONFLICT (account_id) WHERE status = 'active' DO UPDATE SET account_id = EXCLUDED.account_id
        RETURNING *
      `, [accountId]);
      const cart = carts[0];
      const items = await database.query(
        'SELECT * FROM app_private.cart_items WHERE cart_id=$1 ORDER BY created_at, id', [cart.id]
      );
      return { id: cart.id, status: cart.status, items: items.map(cartItem), updatedAt: cart.updated_at };
    },

    async replaceCart(accountId, items) {
      const cartId = randomUUID();
      const payload = JSON.stringify(items);
      const rows = await database.query(`
        WITH selected_cart AS (
          INSERT INTO app_private.carts (id, account_id)
          SELECT $1, $2 WHERE EXISTS
            (SELECT 1 FROM app_private.customer_accounts WHERE id=$2 AND status='active')
          ON CONFLICT (account_id) WHERE status = 'active'
          DO UPDATE SET updated_at = now()
          RETURNING id
        ), removed AS (
          DELETE FROM app_private.cart_items WHERE cart_id = (SELECT id FROM selected_cart)
        ), inserted AS (
          INSERT INTO app_private.cart_items (
            cart_id, supplier_slug, product_public_key, supplier_product_key, supplier_variant_key,
            sku, title, option_title, quantity, unit_price_minor, currency, product_snapshot
          )
          SELECT (SELECT id FROM selected_cart), item->>'supplier', item->>'productId',
            NULLIF(item->>'supplierProductId',''), NULLIF(item->>'variantId',''), NULLIF(item->>'sku',''),
            item->>'title', NULLIF(item->>'optionTitle',''), (item->>'quantity')::integer,
            NULLIF(item->>'unitAmount','')::bigint, NULLIF(item->>'currency',''), item
          FROM jsonb_array_elements($3::jsonb) AS item
          RETURNING *
        )
        SELECT * FROM inserted ORDER BY created_at, id
      `, [cartId, accountId, payload]);
      return rows[0] ? { id: rows[0].cart_id, status: 'active', items: rows.map(cartItem) } : null;
    },

    async listQuotes(accountId) {
      const rows = await database.query(`
        SELECT * FROM app_private.quotes WHERE account_id=$1
        ORDER BY submitted_at DESC, id LIMIT 100
      `, [accountId]);
      return rows.map(quote);
    },

    async createQuote(accountId, request, emailRecipient, templateVersion) {
      const existing = await database.query(
        'SELECT * FROM app_private.quotes WHERE account_id=$1 AND idempotency_key=$2',
        [accountId, request.idempotencyKey]
      );
      if (existing[0]) {
        const pending = await database.query(`SELECT * FROM app_private.email_outbox
          WHERE aggregate_type='quote' AND aggregate_id=$1 AND status IN ('pending','failed')
          ORDER BY created_at DESC LIMIT 1`, [existing[0].id]);
        return { quote: quote(existing[0]), duplicate: true, outbox: pending[0] || null };
      }

      const quoteId = randomUUID();
      const outboxId = randomUUID();
      const quoteReference = reference('Q');
      const outboxKey = `quote:${quoteId}:${templateVersion}`;
      const itemPayload = JSON.stringify(request.items);
      const outboxPayload = JSON.stringify({ reference: quoteReference, quote: request });
      const statements = [
        {
          statement: `INSERT INTO app_private.quotes (
            id, account_id, request_reference, idempotency_key, locale, customer_snapshot,
            destination_snapshot, vehicle_snapshot, notes, totals
          ) SELECT $1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10::jsonb
            WHERE EXISTS (SELECT 1 FROM app_private.customer_accounts WHERE id=$2 AND status='active')
          ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`,
          parameters: [quoteId, accountId, quoteReference, request.idempotencyKey, request.locale,
            JSON.stringify(request.customer), JSON.stringify(request.destination), JSON.stringify(request.vehicle),
            request.notes, JSON.stringify(request.totals)]
        },
        {
          statement: `INSERT INTO app_private.quote_items (
            quote_id, position, supplier_slug, product_public_key, supplier_variant_key, sku, title,
            option_title, quantity, unit_price_minor, currency, item_snapshot
          ) SELECT owned_quote.id, (ordinality - 1)::integer, item->>'supplier', item->>'productId',
            NULLIF(item->>'variantId',''), NULLIF(item->>'sku',''), item->>'title',
            NULLIF(item->>'optionTitle',''), (item->>'quantity')::integer,
            NULLIF(item->>'unitAmount','')::bigint, NULLIF(item->>'currency',''), item
          FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS source(item, ordinality)
          CROSS JOIN (
            SELECT id FROM app_private.quotes WHERE id=$1 AND account_id=$3
          ) AS owned_quote
          ON CONFLICT (quote_id, position) DO NOTHING`,
          parameters: [quoteId, itemPayload, accountId]
        },
        {
          statement: `INSERT INTO app_private.email_outbox (
            id, aggregate_type, aggregate_id, event_type, recipient, locale, template_version,
            idempotency_key, payload
          ) SELECT $1,'quote',$2,'quote.submitted',$3,$4,$5,$6,$7::jsonb
          WHERE EXISTS (SELECT 1 FROM app_private.quotes WHERE id=$2 AND account_id=$8)
          ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`,
          parameters: [outboxId, quoteId, emailRecipient, request.locale, templateVersion, outboxKey, outboxPayload, accountId]
        }
      ];
      const results = await database.transaction(statements);
      if (!results[0][0]) {
        const raced = await database.query(
          'SELECT * FROM app_private.quotes WHERE account_id=$1 AND idempotency_key=$2',
          [accountId, request.idempotencyKey]
        );
        const pending = raced[0] ? await database.query(`SELECT * FROM app_private.email_outbox
          WHERE aggregate_type='quote' AND aggregate_id=$1 AND status IN ('pending','failed')
          ORDER BY created_at DESC LIMIT 1`, [raced[0].id]) : [];
        return { quote: raced[0] ? quote(raced[0]) : null, duplicate: true, outbox: pending[0] || null };
      }
      return { quote: quote(results[0][0]), duplicate: false, outbox: results[2][0] || null };
    },

    async markOutboxSent(outboxId, providerMessageId) {
      await database.query(`UPDATE app_private.email_outbox SET status='sent', provider_message_id=$2,
        sent_at=now(), attempt_count=attempt_count+1, last_error_code=NULL, updated_at=now() WHERE id=$1`,
      [outboxId, providerMessageId]);
    },

    async markOutboxFailed(outboxId, errorCode) {
      await database.query(`UPDATE app_private.email_outbox SET status='failed', attempt_count=attempt_count+1,
        last_error_code=$2, next_attempt_at=now() + interval '15 minutes', updated_at=now() WHERE id=$1`,
      [outboxId, String(errorCode || 'delivery_failed').slice(0, 100)]);
    },

    async claimEmailOutbox(limit = 20) {
      const batchSize = Number.isInteger(limit) ? Math.min(50, Math.max(1, limit)) : 20;
      return database.query(`
        WITH candidates AS (
          SELECT id FROM app_private.email_outbox
          WHERE attempt_count < 100 AND next_attempt_at <= now()
            AND (status IN ('pending','failed') OR status = 'sending')
          ORDER BY next_attempt_at, created_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT $1
        )
        UPDATE app_private.email_outbox AS outbox SET
          status='sending', attempt_count=outbox.attempt_count+1,
          next_attempt_at=now() + interval '10 minutes', updated_at=now()
        FROM candidates WHERE outbox.id=candidates.id
        RETURNING outbox.*
      `, [batchSize]);
    },

    async markClaimedOutboxSent(outboxId, providerMessageId) {
      const rows = await database.query(`UPDATE app_private.email_outbox SET status='sent', provider_message_id=$2,
        sent_at=now(), last_error_code=NULL, updated_at=now() WHERE id=$1 AND status='sending' RETURNING id`,
      [outboxId, providerMessageId]);
      return Boolean(rows[0]);
    },

    async markClaimedOutboxFailed(outboxId, errorCode) {
      const rows = await database.query(`UPDATE app_private.email_outbox SET status='failed',
        last_error_code=$2, next_attempt_at=now() + interval '15 minutes', updated_at=now()
        WHERE id=$1 AND status='sending' RETURNING id`,
      [outboxId, String(errorCode || 'delivery_failed').slice(0, 100)]);
      return Boolean(rows[0]);
    },

    async createAccountNotification(accountId, eventId, payload, emailRecipient, templateVersion) {
      const outboxKey = `account:${eventId}:${templateVersion}`;
      const existing = await database.query(
        'SELECT * FROM app_private.email_outbox WHERE idempotency_key=$1 LIMIT 1', [outboxKey]
      );
      if (existing[0]) return {
        duplicate: true,
        delivered: existing[0].status === 'sent',
        outbox: ['pending', 'failed'].includes(existing[0].status) ? existing[0] : null
      };
      const rows = await database.query(`INSERT INTO app_private.email_outbox (
        id, aggregate_type, aggregate_id, event_type, recipient, locale, template_version,
        idempotency_key, payload
      ) SELECT $1,'account',$2,'account.created',$3,'en',$4,$5,$6::jsonb
        WHERE EXISTS (SELECT 1 FROM app_private.customer_accounts WHERE id=$2 AND status='active')
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`,
      [randomUUID(), accountId, emailRecipient, templateVersion, outboxKey, JSON.stringify(payload)]);
      if (rows[0]) return { duplicate: false, delivered: false, outbox: rows[0] };
      const raced = await database.query(
        'SELECT * FROM app_private.email_outbox WHERE idempotency_key=$1 LIMIT 1', [outboxKey]
      );
      return {
        duplicate: true,
        delivered: raced[0]?.status === 'sent',
        outbox: ['pending', 'failed'].includes(raced[0]?.status) ? raced[0] : null
      };
    },

    async listOrders(accountId) {
      const rows = await database.query(`
        SELECT * FROM app_private.orders WHERE account_id=$1 ORDER BY created_at DESC, id LIMIT 100
      `, [accountId]);
      return rows.map(order);
    }
  };
}
