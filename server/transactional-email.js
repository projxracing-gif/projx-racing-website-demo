const SHOP_EMAIL = 'projxracing@gmail.com';
const TEMPLATE_VERSION = 'commerce-shop-v1';
const ACCOUNT_TEMPLATE_VERSION = 'account-shop-v1';
const EMPTY = '\u2014';
const AR = Object.freeze({
  request: '\u0637\u0644\u0628 \u0639\u0631\u0636 \u0633\u0639\u0631 \u062c\u062f\u064a\u062f',
  partsRequest: '\u0637\u0644\u0628 \u0639\u0631\u0636 \u0633\u0639\u0631 \u0642\u0637\u0639 \u062c\u062f\u064a\u062f',
  reference: '\u0627\u0644\u0645\u0631\u062c\u0639',
  name: '\u0627\u0644\u0627\u0633\u0645',
  phone: '\u0627\u0644\u0647\u0627\u062a\u0641',
  email: '\u0627\u0644\u0628\u0631\u064a\u062f',
  vehicle: '\u0627\u0644\u0645\u0631\u0643\u0628\u0629',
  destination: '\u0627\u0644\u0648\u062c\u0647\u0629',
  notes: '\u0645\u0644\u0627\u062d\u0638\u0627\u062a',
  product: '\u0627\u0644\u0645\u0646\u062a\u062c',
  quantity: '\u0627\u0644\u0643\u0645\u064a\u0629',
  price: '\u0627\u0644\u0633\u0639\u0631',
  disclaimer: '\u0627\u0644\u0623\u0633\u0639\u0627\u0631 \u0648\u0627\u0644\u062a\u0648\u0627\u0641\u0642 \u062e\u0627\u0636\u0639\u0627\u0646 \u0644\u062a\u0623\u0643\u064a\u062f \u0627\u0644\u0645\u062d\u0644.'
});

export class EmailConfigurationError extends Error {
  constructor() {
    super('email_not_configured');
    this.name = 'EmailConfigurationError';
    this.code = 'email_not_configured';
  }
}

function clean(value, maximum = 1000) {
  return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maximum);
}

function html(value, maximum = 1000) {
  return clean(value, maximum).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function itemRows(items) {
  return items.map(item => {
    return `<tr><td>${html(item.title, 500)}${item.optionTitle ? `<br><small>${html(item.optionTitle, 300)}</small>` : ''}</td>`
      + `<td>${html(item.sku || EMPTY, 255)}</td><td>${item.quantity}</td></tr>`;
  }).join('');
}

function textItems(items) {
  return items.map(item => `- ${clean(item.title, 500)} | SKU: ${clean(item.sku || EMPTY, 255)} | Qty: ${item.quantity}`).join('\n');
}

export function shopQuoteTemplate({ reference, quote }) {
  const customer = quote.customer;
  const destination = quote.destination;
  const vehicle = quote.vehicle;
  const direction = quote.locale === 'ar' ? 'rtl' : 'ltr';
  const subject = `[${clean(reference, 80)}] New parts quote request / ${AR.request}`;
  const rows = itemRows(quote.items);
  return {
    templateVersion: TEMPLATE_VERSION,
    subject,
    text: `New Projx Racing parts quote request / ${AR.partsRequest}\n`
      + `Reference / ${AR.reference}: ${reference}\nName / ${AR.name}: ${customer.name}\nPhone / ${AR.phone}: ${customer.phone}\n`
      + `Email / ${AR.email}: ${customer.email || EMPTY}\nVehicle / ${AR.vehicle}: ${vehicle.description || EMPTY}\n`
      + `Destination / ${AR.destination}: ${[destination.city, destination.country].filter(Boolean).join(', ') || EMPTY}\n\n`
      + `${textItems(quote.items)}\n\nCustomer-submitted prices are intentionally omitted. Resolve current price and fitment from the supplier catalogue.\n`
      + `Notes / ${AR.notes}: ${quote.notes || EMPTY}`,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111;line-height:1.5">`
      + `<main style="max-width:760px;margin:auto"><h1>New parts quote request</h1>`
      + `<h2 dir="rtl" lang="ar">${AR.partsRequest}</h2>`
      + `<p><strong>Reference / ${AR.reference}:</strong> ${html(reference, 80)}</p>`
      + `<section dir="${direction}"><p><strong>Name / ${AR.name}:</strong> ${html(customer.name, 200)}</p>`
      + `<p><strong>Phone / ${AR.phone}:</strong> ${html(customer.phone, 60)}</p>`
      + `<p><strong>Email / ${AR.email}:</strong> ${html(customer.email || EMPTY, 320)}</p>`
      + `<p><strong>Vehicle / ${AR.vehicle}:</strong> ${html(vehicle.description || EMPTY, 500)}</p></section>`
      + `<p style="padding:10px;background:#fff4d6"><strong>Price-integrity notice:</strong> Customer-submitted prices are intentionally omitted. Resolve the current price and fitment from the supplier catalogue.</p>`
      + `<table style="width:100%;border-collapse:collapse" border="1" cellpadding="8"><thead><tr>`
      + `<th>Product / ${AR.product}</th><th>SKU</th><th>Qty / ${AR.quantity}</th>`
      + `</tr></thead><tbody>${rows}</tbody></table>`
      + `<p><strong>Notes / ${AR.notes}:</strong><br>${html(quote.notes || EMPTY, 4000)}</p>`
      + `<p style="color:#555">Prices and fitment remain subject to shop confirmation. / ${AR.disclaimer}</p>`
      + `</main></body></html>`
  };
}

export function shopAccountCreatedTemplate({ account, eventId }) {
  const arabicTitle = '\u062a\u0645 \u062a\u0633\u062c\u064a\u0644 \u062d\u0633\u0627\u0628 \u0639\u0645\u064a\u0644 \u062c\u062f\u064a\u062f';
  const userIdLabel = '\u0645\u0639\u0631\u0641 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645';
  const subject = `New Projx Racing customer account / ${arabicTitle}`;
  const name = account.displayName || EMPTY;
  const emailAddress = account.email || EMPTY;
  const phone = account.phone || EMPTY;
  return {
    templateVersion: ACCOUNT_TEMPLATE_VERSION,
    subject,
    text: `New Projx Racing customer account / ${arabicTitle}\nEvent: ${clean(eventId, 100)}\n`
      + `User ID / ${userIdLabel}: ${clean(account.userId, 255)}\nName / ${AR.name}: ${clean(name, 200)}\n`
      + `Email / ${AR.email}: ${clean(emailAddress, 320)}\nPhone / ${AR.phone}: ${clean(phone, 60)}`,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111;line-height:1.5">`
      + `<main style="max-width:680px;margin:auto"><h1>New Projx Racing customer account</h1>`
      + `<h2 dir="rtl" lang="ar">${arabicTitle}</h2>`
      + `<p><strong>Event:</strong> ${html(eventId, 100)}</p>`
      + `<p><strong>User ID / ${userIdLabel}:</strong> ${html(account.userId, 255)}</p>`
      + `<p><strong>Name / ${AR.name}:</strong> ${html(name, 200)}</p>`
      + `<p><strong>Email / ${AR.email}:</strong> ${html(emailAddress, 320)}</p>`
      + `<p><strong>Phone / ${AR.phone}:</strong> ${html(phone, 60)}</p>`
      + `<p style="color:#555">Generated from a verified Clerk account event.</p></main></body></html>`
  };
}

export function validateCommerceEmailConfiguration(env = process.env) {
  const apiKey = clean(env.RESEND_API_KEY, 500);
  const from = clean(env.COMMERCE_FROM_EMAIL || env.ENQUIRY_FROM_EMAIL, 500);
  const recipient = clean(env.SHOP_NOTIFICATION_EMAIL || SHOP_EMAIL, 320).toLowerCase();
  if (!apiKey || !from || !recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    throw new EmailConfigurationError();
  }
  return { apiKey, from, recipient };
}

export async function sendShopEmail({ idempotencyKey, template, env = process.env, fetchImpl = globalThis.fetch }) {
  const { apiKey, from, recipient } = validateCommerceEmailConfiguration(env);
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify({ from, to: [recipient], subject: template.subject, html: template.html, text: template.text }),
    redirect: 'error',
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) {
    const error = new Error('email_delivery_failed');
    error.code = `resend_${response.status}`;
    throw error;
  }
  const result = await response.json().catch(() => ({}));
  return { providerMessageId: clean(result.id, 255) || null };
}

export const commerceEmailDefaults = Object.freeze({
  recipient: SHOP_EMAIL,
  templateVersion: TEMPLATE_VERSION,
  accountTemplateVersion: ACCOUNT_TEMPLATE_VERSION
});
