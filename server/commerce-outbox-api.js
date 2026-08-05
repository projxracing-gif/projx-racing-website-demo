import { timingSafeEqual } from 'node:crypto';
import { ApiError, assertMethod, runApiHandler, sendJson } from './http.js';
import { getCommerceDatabase } from './commerce-database.js';
import { createCommerceRepository } from './commerce-repository.js';
import {
  EmailConfigurationError,
  sendShopEmail,
  shopAccountCreatedTemplate,
  shopQuoteTemplate,
  validateCommerceEmailConfiguration
} from './transactional-email.js';

const RETRY_BATCH_SIZE = 5;
const SECRET_PATTERN = /^[\x21-\x7E]{32,512}$/;

function workerSecret(req, env) {
  const configured = String(env.COMMERCE_OUTBOX_RETRY_SECRET || '').trim();
  if (!SECRET_PATTERN.test(configured)) throw new ApiError(503, 'outbox_retry_not_configured');
  const authorization = req.headers?.authorization;
  if (Array.isArray(authorization)) throw new ApiError(401, 'outbox_retry_authentication_required');
  const match = /^Bearer ([\x21-\x7E]{32,512})$/.exec(String(authorization || '').trim());
  if (!match) throw new ApiError(401, 'outbox_retry_authentication_required');
  const actual = Buffer.from(match[1], 'utf8');
  const expected = Buffer.from(configured, 'utf8');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new ApiError(401, 'outbox_retry_authentication_required');
  }
}

function objectPayload(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // The caller records a bounded non-sensitive failure code.
    }
  }
  throw Object.assign(new Error('invalid_outbox_payload'), { code: 'invalid_outbox_payload' });
}

function outboxTemplate(row) {
  const payload = objectPayload(row.payload);
  let template;
  if (row.event_type === 'quote.submitted') {
    template = shopQuoteTemplate(payload);
  } else if (row.event_type === 'account.created') {
    template = shopAccountCreatedTemplate(payload);
  } else {
    throw Object.assign(new Error('unsupported_outbox_event'), { code: 'unsupported_outbox_event' });
  }
  if (row.template_version !== template.templateVersion) {
    throw Object.assign(new Error('unsupported_template_version'), { code: 'unsupported_template_version' });
  }
  return template;
}

export function createCommerceOutboxRetryHandler(overrides = {}) {
  const env = overrides.env || process.env;
  const getDatabase = overrides.getDatabase || getCommerceDatabase;
  const createRepository = overrides.createRepository || createCommerceRepository;
  const sendEmail = overrides.sendEmail || sendShopEmail;
  const validateEmail = overrides.validateEmail || validateCommerceEmailConfiguration;

  return async function commerceOutboxRetryHandler(req, res) {
    await runApiHandler(res, async () => {
      assertMethod(req, ['POST']);
      workerSecret(req, env);
      try {
        validateEmail(env);
      } catch (error) {
        if (error instanceof EmailConfigurationError || error?.code === 'email_not_configured') {
          throw new ApiError(503, 'email_not_configured');
        }
        throw error;
      }

      const repository = createRepository(await getDatabase());
      const rows = await repository.claimEmailOutbox(RETRY_BATCH_SIZE);
      const outcomes = await Promise.all(rows.map(async row => {
        try {
          const delivered = await sendEmail({
            idempotencyKey: row.idempotency_key,
            template: outboxTemplate(row),
            env
          });
          await repository.markClaimedOutboxSent(row.id, delivered.providerMessageId);
          return 'sent';
        } catch (error) {
          await repository.markClaimedOutboxFailed(row.id, error?.code || 'delivery_failed');
          return 'failed';
        }
      }));
      const sent = outcomes.filter(value => value === 'sent').length;
      const failed = outcomes.length - sent;
      return sendJson(res, 200, { processed: rows.length, sent, failed });
    });
  };
}
