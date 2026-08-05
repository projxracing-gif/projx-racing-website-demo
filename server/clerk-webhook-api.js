import { ApiError, assertMethod, runApiHandler, sendJson } from './http.js';
import { verifyClerkWebhook } from './clerk-webhook.js';
import { getCommerceDatabase } from './commerce-database.js';
import { createCommerceRepository } from './commerce-repository.js';
import { commerceEmailDefaults, EmailConfigurationError, sendShopEmail, shopAccountCreatedTemplate } from './transactional-email.js';

function selectedEmail(data) {
  const addresses = Array.isArray(data.email_addresses) ? data.email_addresses : [];
  const value = (addresses.find(address => address?.id === data.primary_email_address_id) || addresses[0])?.email_address;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 320);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned) ? cleaned : null;
}

function selectedPhone(data) {
  const numbers = Array.isArray(data.phone_numbers) ? data.phone_numbers : [];
  const value = (numbers.find(number => number?.id === data.primary_phone_number_id) || numbers[0])?.phone_number;
  return typeof value === 'string' ? value.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 60) || null : null;
}

function accountIdentity(data) {
  const userId = String(data?.id || '').trim();
  if (!/^[A-Za-z0-9_-]{3,255}$/.test(userId)) throw new ApiError(400, 'invalid_clerk_user');
  const displayName = [data.first_name, data.last_name].filter(value => typeof value === 'string' && value.trim())
    .join(' ').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 200)
    || (typeof data.username === 'string'
      ? data.username.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 200) || null : null);
  return {
    userId,
    email: selectedEmail(data),
    displayName,
    phone: selectedPhone(data)
  };
}

function accountUserId(data) {
  const userId = String(data?.id || '').trim();
  if (!/^[A-Za-z0-9_-]{3,255}$/.test(userId)) throw new ApiError(400, 'invalid_clerk_user');
  return userId;
}

export function createClerkWebhookHandler(overrides = {}) {
  const verify = overrides.verify || verifyClerkWebhook;
  const getDatabase = overrides.getDatabase || getCommerceDatabase;
  const createRepository = overrides.createRepository || createCommerceRepository;
  const sendEmail = overrides.sendEmail || sendShopEmail;
  return async function clerkWebhookHandler(req, res) {
    await runApiHandler(res, async () => {
      assertMethod(req, ['POST']);
      const verified = await verify(req);
      if (!['user.created', 'user.updated', 'user.deleted'].includes(verified.event.type)) {
        return sendJson(res, 200, { received: true, ignored: true });
      }
      const database = await getDatabase();
      const repository = createRepository(database);

      if (verified.event.type === 'user.deleted') {
        const userId = accountUserId(verified.event.data);
        const stored = await repository.anonymizeAccountByClerkUserId(userId);
        return sendJson(res, 200, {
          received: true,
          lifecycle: 'anonymized',
          accountStatus: stored?.status || 'anonymized'
        });
      }

      const identity = accountIdentity(verified.event.data);
      const stored = await repository.syncAccount(identity);
      if (!stored) throw new ApiError(500, 'account_persistence_failed');
      if (verified.event.type === 'user.updated') {
        return sendJson(res, 200, { received: true, lifecycle: 'synchronized', accountStatus: stored.status });
      }
      if (stored.status !== 'active') {
        return sendJson(res, 200, { received: true, ignored: true, accountStatus: stored.status });
      }
      const notificationPayload = {
        eventId: verified.messageId,
        account: { userId: identity.userId, displayName: identity.displayName, email: identity.email, phone: identity.phone }
      };
      const notification = await repository.createAccountNotification(
        stored.id, verified.messageId, notificationPayload, commerceEmailDefaults.recipient,
        commerceEmailDefaults.accountTemplateVersion
      );
      if (notification.delivered) {
        return sendJson(res, 200, { received: true, duplicate: true, notificationStatus: 'already_sent' });
      }
      if (!notification.outbox) throw new ApiError(409, 'notification_state_conflict');
      const template = shopAccountCreatedTemplate(notificationPayload);
      try {
        const delivered = await sendEmail({ idempotencyKey: notification.outbox.idempotency_key, template });
        await repository.markOutboxSent(notification.outbox.id, delivered.providerMessageId);
      } catch (error) {
        if (!(error instanceof EmailConfigurationError) && error?.code !== 'email_not_configured') {
          await repository.markOutboxFailed(notification.outbox.id, error?.code || 'delivery_failed');
          throw new ApiError(502, 'notification_delivery_failed');
        }
        throw new ApiError(503, 'email_not_configured');
      }
      return sendJson(res, 200, {
        received: true,
        duplicate: notification.duplicate,
        notificationStatus: 'sent'
      });
    });
  };
}
