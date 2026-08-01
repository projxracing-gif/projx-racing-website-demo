const MAX_BODY_BYTES = 32_000;
const allowedTypes = new Set([
  'Website Enquiry', 'General Enquiry', 'General Quote', 'Workshop Consultation',
  'Online Tuning Compatibility Review', 'Engine Build Enquiry', 'Parts Enquiry',
  'Brand / Parts Enquiry', 'Project Consultation', 'Technical Enquiry',
  'MHD Online Tuning', 'Porsche COBB Online Tuning', 'GM HP Tuners Online Tuning'
]);

function clean(value, limit = 3000) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, limit);
}

function html(value, limit = 3000) {
  return clean(value, limit).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function validType(value) {
  return allowedTypes.has(value) || /^(?:[A-Za-z0-9/&+.,() -]{2,100}) Enquiry$/.test(value);
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

  const requestHost = clean(req.headers.host, 255).toLowerCase();
  const origin = clean(req.headers.origin, 500);
  if (origin) {
    try {
      const originHost = new URL(origin).host.toLowerCase();
      if (requestHost && originHost !== requestHost) return json(res, 403, { error: 'origin_not_allowed' });
    } catch {
      return json(res, 403, { error: 'origin_not_allowed' });
    }
  }

  const length = Number(req.headers['content-length'] || 0);
  if (length > MAX_BODY_BYTES) return json(res, 413, { error: 'payload_too_large' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    return json(res, 400, { error: 'invalid_json' });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'invalid_payload' });
  if (clean(body.website, 120)) return json(res, 202, { accepted: true });

  const startedAt = Number(body.startedAt || 0);
  if (startedAt && Date.now() - startedAt < 1200) return json(res, 429, { error: 'submission_too_fast' });

  const ref = clean(body.ref, 80);
  const type = clean(body.type, 120);
  const fields = body.fields && typeof body.fields === 'object' && !Array.isArray(body.fields) ? body.fields : {};
  const name = clean(fields.name, 200);
  const phone = clean(fields.phone, 200);
  const vehicle = clean(fields.vehicle, 300);
  const message = clean(fields.message || fields.modifications || fields.engineDetails, 3000);

  if (!ref || !validType(type) || !name || !phone || !vehicle || !message) {
    return json(res, 400, { error: 'missing_or_invalid_required_fields' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const to = clean(process.env.ENQUIRY_TO_EMAIL, 500);
  const from = clean(process.env.ENQUIRY_FROM_EMAIL, 500);
  if (!apiKey || !to || !from) return json(res, 503, { error: 'backend_not_configured' });

  const rows = Object.entries(fields)
    .filter(([key, value]) => value && !['website', 'startedAt'].includes(key))
    .slice(0, 80)
    .map(([key, value]) => `<tr><td style="padding:8px;border:1px solid #ddd;font-weight:700">${html(key, 80)}</td><td style="padding:8px;border:1px solid #ddd;white-space:pre-wrap">${html(Array.isArray(value) ? value.join(', ') : value, 3000)}</td></tr>`)
    .join('');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: to.split(',').map(value => value.trim()).filter(Boolean),
      subject: `[${ref}] ${type} — ${name}`,
      html: `<h1>Projx Racing website enquiry</h1><p><strong>Reference:</strong> ${html(ref, 80)}</p><p><strong>Request type:</strong> ${html(type, 120)}</p><table style="border-collapse:collapse;width:100%">${rows}</table><p>Submitted from ${html(body.page, 500)}</p>`
    })
  });

  if (!response.ok) {
    const provider = await response.text().catch(() => '');
    console.error('Resend delivery failed', response.status, provider.slice(0, 500));
    return json(res, 502, { error: 'delivery_failed' });
  }

  return json(res, 200, { accepted: true, ref });
}
