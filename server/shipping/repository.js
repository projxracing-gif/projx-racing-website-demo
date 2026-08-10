import { createHash } from 'node:crypto';
import { getCommerceDatabase } from '../commerce-database.js';
import { auditSafeShippingQuoteRecord } from './quote.js';
import { destinationFingerprintInput } from './validation.js';

export class ShippingPersistenceError extends Error {
  constructor(code = 'shipping_persistence_unavailable') {
    super(code);
    this.name = 'ShippingPersistenceError';
    this.code = code;
  }
}

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function persistenceEnabled(env) {
  return String(env?.SUPPLIER_SHIPPING_PERSIST_QUOTES || '').trim().toLowerCase() === 'true';
}

function persistedQuoteSnapshot(quote) {
  const { destination, persisted, replayed, ...safeQuote } = quote;
  return {
    ...safeQuote,
    destination: {
      countryCode: destination?.countryCode || null,
      fulfilment: destination?.fulfilment || null
    },
    groups: (quote.groups || []).map(group => ({
      ...group,
      options: (group.options || []).map(option => {
        const { providerReference, ...safeOption } = option;
        return safeOption;
      })
    }))
  };
}

function parsedSnapshot(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function groupStatements(quoteId, groups) {
  const statements = [];
  for (const group of groups || []) {
    statements.push({
      statement: `INSERT INTO app_private.shipping_quote_groups
        (group_id, quote_id, supplier_slug, origin_code, origin_country_code, status, reason,
          package_data_status, provider_key, provider_duration_ms, selected_option_id,
          rate_minor, rate_currency, converted_rate_minor, converted_currency, conversion_status,
          exchange_rate, exchange_rate_as_of, exchange_rate_provider, restrictions)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb)`,
      parameters: [
        group.groupId, quoteId, group.supplier, group.originId, group.originCountryCode,
        group.status, group.reason, group.packageVerificationStatus || group.packageDataStatus,
        group.provider, group.providerDurationMs, group.selectedOptionId, group.rateMinor,
        group.currency, group.convertedRateMinor, group.convertedCurrency, group.conversionStatus,
        group.exchangeRate, group.exchangeRateAsOf, group.exchangeRateProvider,
        json(group.restrictions || [])
      ]
    });
    for (const item of group.packages || []) {
      statements.push({
        statement: `INSERT INTO app_private.shipping_quote_packages
          (package_id, group_id, product_public_key, supplier_variant_key, sku, quantity,
            package_count, package_state, weight_grams, length_mm, width_mm, height_mm,
            oversized, ships_separately, hazardous, fragile, freight_only, ground_only,
            evidence_source, evidence_observed_at, evidence_expires_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
        parameters: [
          item.packageId, group.groupId, item.productId, item.variantId, item.sku, item.quantity,
          item.packageCount, item.status, item.weightGrams, item.lengthMm, item.widthMm, item.heightMm,
          item.oversized, item.shipsSeparately, item.hazardous, item.fragile, item.freightOnly,
          item.groundOnly, item.source, item.observedAt, item.expiresAt
        ]
      });
    }
    for (const option of group.options || []) {
      const providerReferenceHash = option.providerReference ? sha256(option.providerReference) : null;
      statements.push({
        statement: `INSERT INTO app_private.shipping_rate_options
          (group_id, provider_option_id, carrier, service, rate_minor, currency,
            converted_rate_minor, converted_currency, conversion_status,
            dispatch_min_days, dispatch_max_days, transit_min_days, transit_max_days,
            incoterm, duties_included, tax_included, insurance_minor, handling_minor,
            provider_reference_hash, quoted_at, expires_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
        parameters: [
          group.groupId, option.id, option.carrier, option.service, option.rateMinor, option.currency,
          option.convertedRateMinor, option.convertedCurrency, option.conversionStatus,
          option.dispatchDays?.min ?? null, option.dispatchDays?.max ?? null,
          option.transitDays?.min ?? null, option.transitDays?.max ?? null,
          option.incoterm, option.dutiesIncluded, option.taxIncluded, option.insuranceMinor,
          option.handlingMinor, providerReferenceHash, option.quotedAt, option.expiresAt
        ]
      });
    }
  }
  return statements;
}

export function createShippingQuoteRepository(database) {
  if (!database || typeof database.query !== 'function' || typeof database.transaction !== 'function') {
    throw new ShippingPersistenceError();
  }
  return Object.freeze({
    async recordQuote(quote, { eventType = 'estimated', outcome = null, reason = null } = {}) {
      const audit = auditSafeShippingQuoteRecord(quote);
      const destinationHash = sha256(destinationFingerprintInput(quote.destination));
      const rows = await database.query(`INSERT INTO app_private.shipping_quotes
        (quote_id, idempotency_key, fingerprint, selection_fingerprint, status, destination_country_code,
          destination_fingerprint, fulfilment, target_currency, base_shipping_minor,
          total_shipping_minor, protection_margin_minor, handling_minor, insurance_minor,
          fragile_fee_minor, oversize_fee_minor, forwarder_fee_minor, local_delivery_minor,
          rounding_adjustment_minor, commercial_rules_version, commercial_rules_enabled,
          manual_review_required, revalidation_status, revalidated_from_quote_id,
          quoted_at, expires_at, revalidated_at, payment_eligible, audit_snapshot, quote_snapshot)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
          $21,$22,$23,$24,$25,$26,$27,false,$28::jsonb,$29::jsonb)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING quote_id, fingerprint`, [
        quote.quoteId, quote.idempotencyKey, quote.fingerprint, quote.selectionFingerprint, quote.status,
        quote.destination.countryCode, destinationHash, quote.destination.fulfilment,
        quote.currency, quote.baseShippingMinor, quote.totalShippingMinor,
        quote.protectionMarginMinor, quote.handlingMinor, quote.insuranceMinor,
        quote.fragileFeeMinor, quote.oversizeFeeMinor, quote.forwarderFeeMinor,
        quote.localDeliveryMinor, quote.roundingAdjustmentMinor, quote.commercialRulesVersion,
        quote.commercialRulesEnabled === true, quote.manualReviewRequired === true,
        quote.revalidationStatus, quote.revalidatedFromQuoteId || null, quote.quotedAt,
        quote.expiresAt, quote.revalidatedAt, json(audit), json(persistedQuoteSnapshot(quote))
      ]);
      if (!rows[0]) {
        const existingRows = await database.query(`SELECT quote_id, fingerprint, selection_fingerprint,
            destination_fingerprint, record_state, quote_snapshot
          FROM app_private.shipping_quotes WHERE idempotency_key=$1 LIMIT 1`, [quote.idempotencyKey]);
        const existing = existingRows[0];
        const snapshot = parsedSnapshot(existing?.quote_snapshot);
        if (!existing || existing.record_state !== 'complete'
            || existing.fingerprint !== quote.fingerprint
            || existing.selection_fingerprint !== quote.selectionFingerprint
            || existing.destination_fingerprint !== destinationHash
            || snapshot?.fingerprint !== quote.fingerprint
            || snapshot?.selectionFingerprint !== quote.selectionFingerprint
            || snapshot?.idempotencyKey !== quote.idempotencyKey) {
          throw new ShippingPersistenceError('shipping_idempotency_conflict');
        }
        return Object.freeze({
          ...snapshot,
          quoteId: existing.quote_id,
          destination: quote.destination,
          persisted: true,
          replayed: true
        });
      }
      if (rows[0].fingerprint !== quote.fingerprint) {
        throw new ShippingPersistenceError('shipping_idempotency_conflict');
      }
      const storedQuoteId = rows[0].quote_id;
      const statements = [
        ...groupStatements(storedQuoteId, quote.groups),
        {
          statement: `INSERT INTO app_private.shipping_rate_audit
            (quote_id, event_type, outcome, reason_code, request_fingerprint,
              next_total_minor, currency, metadata)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
          parameters: [storedQuoteId, eventType, outcome || (quote.status === 'confirmed' ? 'accepted' : 'unavailable'),
            reason, quote.fingerprint, quote.totalShippingMinor, quote.currency,
            json({ suppliers: audit.suppliers, origins: audit.origins, ruleVersion: audit.commercialRulesVersion })]
        },
        {
          statement: `UPDATE app_private.shipping_quotes SET record_state='complete', last_seen_at=now()
            WHERE quote_id=$1 AND record_state='pending'`,
          parameters: [storedQuoteId]
        }
      ];
      try {
        await database.transaction(statements);
      } catch {
        // The header insert precedes the child transaction because the shared
        // database helper cannot feed one statement's RETURNING value into the
        // next statement. Compensate so a child failure never leaves a quote
        // that appears complete or replayable.
        try { await database.query('DELETE FROM app_private.shipping_quotes WHERE quote_id=$1', [storedQuoteId]); }
        catch { /* A later maintenance job can identify a header with no groups. */ }
        throw new ShippingPersistenceError();
      }
      return Object.freeze({ ...quote, quoteId: storedQuoteId, persisted: true });
    }
  });
}

export async function persistShippingQuoteIfConfigured(quote, {
  env = process.env,
  database = null,
  eventType = 'estimated',
  outcome = null,
  reason = null
} = {}) {
  if (!persistenceEnabled(env)) return quote;
  let resolvedDatabase = database;
  try {
    resolvedDatabase ||= await getCommerceDatabase({ env });
    return await createShippingQuoteRepository(resolvedDatabase).recordQuote(quote, { eventType, outcome, reason });
  } catch (error) {
    if (error instanceof ShippingPersistenceError) throw error;
    throw new ShippingPersistenceError();
  }
}
