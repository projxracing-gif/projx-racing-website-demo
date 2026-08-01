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
  ['rejects cross-origin posts', (await invoke({ headers: { host: 'projxracing.com', origin: 'https://example.com' }, body: valid })).status === 403],
  ['rejects malformed required data', (await invoke({ body: { ...valid, fields: { name: 'Only a name' } } })).status === 400],
  ['accepts controlled service enquiry type before delivery configuration', (await invoke({ body: valid })).status === 503],
  ['accepts platform-specific tuning type before delivery configuration', (await invoke({ body: { ...valid, type: 'MHD Online Tuning' } })).status === 503]
];

const failed = tests.filter(([, passed]) => !passed);
if (failed.length) {
  for (const [name] of failed) console.error(`FAILED: ${name}`);
  process.exit(1);
}
for (const [name] of tests) console.log(`PASS: ${name}`);
