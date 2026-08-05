import { ApiError, assertMethod, assertSameOrigin, parseJsonObject, runApiHandler, sendJson, singleQueryValue } from './http.js';
import { verifyClerkRequest } from './clerk-auth.js';
import { getCommerceDatabase } from './commerce-database.js';
import { createCommerceRepository } from './commerce-repository.js';
import { idempotencyKey, uuid, validateAccountPatch, validateAddress, validateItems, validateQuoteRequest } from './commerce-validation.js';
import { commerceEmailDefaults, EmailConfigurationError, sendShopEmail, shopQuoteTemplate } from './transactional-email.js';

function dependencies(overrides = {}) {
  return {
    authenticate: overrides.authenticate || verifyClerkRequest,
    getDatabase: overrides.getDatabase || getCommerceDatabase,
    createRepository: overrides.createRepository || createCommerceRepository,
    sendEmail: overrides.sendEmail || sendShopEmail
  };
}

async function context(req, deps) {
  const identity = await deps.authenticate(req);
  const database = await deps.getDatabase();
  const repository = deps.createRepository(database);
  const currentAccount = await repository.ensureAccount(identity);
  if (!currentAccount || currentAccount.status !== 'active') throw new ApiError(403, 'account_unavailable');
  return { identity, repository, account: currentAccount };
}

export function createAccountHandler(overrides = {}) {
  const deps = dependencies(overrides);
  return async function accountHandler(req, res) {
    await runApiHandler(res, async () => {
      assertMethod(req, ['GET', 'PATCH']);
      if (req.method === 'PATCH') assertSameOrigin(req);
      const current = await context(req, deps);
      if (req.method === 'GET') return sendJson(res, 200, { account: current.account });
      const values = validateAccountPatch(parseJsonObject(req));
      const updated = await current.repository.updateAccount(current.account.id, values);
      if (!updated) throw new ApiError(404, 'account_not_found');
      return sendJson(res, 200, { account: updated });
    });
  };
}

export function createAddressesHandler(overrides = {}) {
  const deps = dependencies(overrides);
  return async function addressesHandler(req, res) {
    await runApiHandler(res, async () => {
      assertMethod(req, ['GET', 'POST', 'PUT', 'DELETE']);
      if (req.method !== 'GET') assertSameOrigin(req);
      const current = await context(req, deps);
      if (req.method === 'GET') {
        return sendJson(res, 200, { addresses: await current.repository.listAddresses(current.account.id) });
      }
      if (req.method === 'POST') {
        const created = await current.repository.createAddress(current.account.id, validateAddress(parseJsonObject(req)));
        if (!created) throw new ApiError(403, 'account_unavailable');
        return sendJson(res, 201, { address: created });
      }
      const addressId = uuid(singleQueryValue(req, 'id'), 'invalid_address_id');
      if (req.method === 'DELETE') {
        const removed = await current.repository.deleteAddress(current.account.id, addressId);
        if (!removed) throw new ApiError(404, 'address_not_found');
        return sendJson(res, 200, { deleted: true, id: addressId });
      }
      const updated = await current.repository.replaceAddress(
        current.account.id, addressId, validateAddress(parseJsonObject(req))
      );
      if (!updated) throw new ApiError(404, 'address_not_found');
      return sendJson(res, 200, { address: updated });
    });
  };
}

export function createCartHandler(overrides = {}) {
  const deps = dependencies(overrides);
  return async function cartHandler(req, res) {
    await runApiHandler(res, async () => {
      assertMethod(req, ['GET', 'PUT']);
      if (req.method === 'PUT') assertSameOrigin(req);
      const current = await context(req, deps);
      if (req.method === 'GET') return sendJson(res, 200, { cart: await current.repository.getCart(current.account.id) });
      const body = parseJsonObject(req, 128_000);
      if (Object.keys(body).some(key => key !== 'items')) throw new ApiError(400, 'invalid_payload');
      const cart = await current.repository.replaceCart(current.account.id, validateItems(body.items));
      if (!cart) throw new ApiError(403, 'account_unavailable');
      return sendJson(res, 200, { cart });
    });
  };
}

export function createQuotesHandler(overrides = {}) {
  const deps = dependencies(overrides);
  return async function quotesHandler(req, res) {
    await runApiHandler(res, async () => {
      assertMethod(req, ['GET', 'POST']);
      if (req.method === 'POST') assertSameOrigin(req);
      const current = await context(req, deps);
      if (req.method === 'GET') {
        return sendJson(res, 200, { quotes: await current.repository.listQuotes(current.account.id) });
      }
      const headerKey = req.headers?.['idempotency-key'];
      if (Array.isArray(headerKey)) throw new ApiError(400, 'invalid_idempotency_key');
      const request = validateQuoteRequest(parseJsonObject(req, 192_000), headerKey);
      idempotencyKey(request.idempotencyKey);
      const created = await current.repository.createQuote(
        current.account.id, request, commerceEmailDefaults.recipient, commerceEmailDefaults.templateVersion
      );
      if (!created.quote) throw new ApiError(409, 'idempotency_conflict');

      let notificationStatus = created.duplicate ? 'already_queued' : 'queued';
      if (created.outbox) {
        const template = shopQuoteTemplate({ reference: created.quote.reference, quote: request });
        try {
          const delivered = await deps.sendEmail({
            idempotencyKey: created.outbox.idempotency_key,
            template
          });
          await current.repository.markOutboxSent(created.outbox.id, delivered.providerMessageId);
          notificationStatus = 'sent';
        } catch (error) {
          if (error instanceof EmailConfigurationError || error?.code === 'email_not_configured') {
            notificationStatus = 'pending_configuration';
          } else {
            await current.repository.markOutboxFailed(created.outbox.id, error?.code || 'delivery_failed');
            notificationStatus = 'retry_pending';
          }
        }
      }
      return sendJson(res, created.duplicate ? 200 : 201, {
        accepted: true,
        duplicate: created.duplicate,
        quote: created.quote,
        notificationStatus
      });
    });
  };
}

export function createOrdersHandler(overrides = {}) {
  const deps = dependencies(overrides);
  return async function ordersHandler(req, res) {
    await runApiHandler(res, async () => {
      assertMethod(req, ['GET']);
      const current = await context(req, deps);
      return sendJson(res, 200, { orders: await current.repository.listOrders(current.account.id) });
    });
  };
}
