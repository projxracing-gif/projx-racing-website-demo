import handler from '../api/enquiry.js';

function response() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value = '') { this.body = String(value); }
  };
}

async function invoke({ method = 'POST', body = {}, headers = { host: 'projxracing.com', origin: 'https://projxracing.com' } } = {}) {
  const req = { method, body, headers };
  const res = response();
  await handler(req, res);
  return { status: res.statusCode, body: JSON.parse(res.body || '{}'), headers: res.headers };
}

const valid = {
  ref: 'PRX-WEB-2026-ABCDE',
  type: 'Diagnostics & Troubleshooting Enquiry',
  startedAt: Date.now() - 5000,
  fields: {
    name: 'Website QA',
    phone: '+965 9797 6052',
    vehicle: '2024 Toyota GR Supra B58',
    message: 'Technical review request.'
  }
};

const tests = [
  ['rejects non-POST methods', (await invoke({ method: 'GET' })).status === 405],
  ['accepts honeypot silently', (await invoke({ body: { website: 'spam.example' } })).status === 202],
  ['measures parsed request bodies instead of trusting Content-Length', (await invoke({
    body: { ...valid, padding: 'x'.repeat(33_000) },
    headers: { host: 'projxracing.com', origin: 'https://projxracing.com', 'content-length': '1' }
  })).status === 413],
  ['rejects cross-origin posts', (await invoke({ headers: { host: 'projxracing.com', origin: 'https://example.com' }, body: valid })).status === 403],
  ['rejects malformed required data', (await invoke({ body: { ...valid, fields: { name: 'Only a name' } } })).status === 400],
  ['accepts controlled service enquiry type before delivery configuration', (await invoke({ body: valid })).status === 503],
  ['accepts platform-specific tuning type before delivery configuration', (await invoke({ body: { ...valid, type: 'MHD Online Tuning' } })).status === 503]
];

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.RESEND_API_KEY;
const originalTo = process.env.ENQUIRY_TO_EMAIL;
const originalFrom = process.env.ENQUIRY_FROM_EMAIL;
const originalAntiAbuse = process.env.PUBLIC_FORM_ANTI_ABUSE_READY;
let deliveredPayload;
let deliveredOptions;
process.env.RESEND_API_KEY = 'test-only-key';
delete process.env.ENQUIRY_TO_EMAIL;
process.env.ENQUIRY_FROM_EMAIL = 'Projx Racing Website <onboarding@resend.dev>';
delete process.env.PUBLIC_FORM_ANTI_ABUSE_READY;
globalThis.fetch = async (url, options) => {
  deliveredOptions = options;
  deliveredPayload = { url, ...JSON.parse(options.body) };
  return { ok: true, text: async () => '' };
};
const blockedWithoutAntiAbuse = await invoke({ body: valid });
tests.push(['fails closed with Resend credentials until durable anti-abuse is declared ready', blockedWithoutAntiAbuse.status === 503 && blockedWithoutAntiAbuse.body.error === 'anti_abuse_not_configured' && !deliveredPayload]);
process.env.PUBLIC_FORM_ANTI_ABUSE_READY = 'true';
const delivery = await invoke({ body: valid });
tests.push(['routes completed enquiries to projxracing@gmail.com', delivery.status === 200 && deliveredPayload?.to?.[0] === 'projxracing@gmail.com']);
tests.push(['uses a deterministic provider idempotency key', /^enquiry-[a-f0-9]{64}$/.test(deliveredOptions?.headers?.['Idempotency-Key'] || '')]);
globalThis.fetch = originalFetch;
if (originalApiKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = originalApiKey;
if (originalTo === undefined) delete process.env.ENQUIRY_TO_EMAIL; else process.env.ENQUIRY_TO_EMAIL = originalTo;
if (originalFrom === undefined) delete process.env.ENQUIRY_FROM_EMAIL; else process.env.ENQUIRY_FROM_EMAIL = originalFrom;
if (originalAntiAbuse === undefined) delete process.env.PUBLIC_FORM_ANTI_ABUSE_READY; else process.env.PUBLIC_FORM_ANTI_ABUSE_READY = originalAntiAbuse;

const failed = tests.filter(([, passed]) => !passed);
if (failed.length) {
  for (const [name] of failed) console.error(`FAILED: ${name}`);
  process.exit(1);
}
for (const [name] of tests) console.log(`PASS: ${name}`);
