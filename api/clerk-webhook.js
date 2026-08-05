import { createClerkWebhookHandler } from '../server/clerk-webhook-api.js';

export const config = { api: { bodyParser: false } };

export default createClerkWebhookHandler();
