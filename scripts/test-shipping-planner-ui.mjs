import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(repo, 'assets/app.js'), 'utf8');
const styles = fs.readFileSync(path.join(repo, 'assets/styles.css'), 'utf8');

test('shipping response metadata is bounded and sanitised before rendering', () => {
  for (const field of [
    'quoteMethod', 'rateSource', 'fulfilmentSystem', 'calculationFactors',
    'requiredInputs', 'restrictions', 'consolidationPolicy', 'dutiesMode',
    'observedCarrierFamilies', 'blockingReasons', 'evidenceAsOf',
    'quoteId', 'quoteExpiresAt'
  ]) {
    assert.match(app, new RegExp(`${field}:`));
  }
  assert.match(app, /function safeShippingTextList\(value, maximum = 12, textLimit = 180\)/);
  assert.match(app, /function safeShippingCode\(value, maximum = 100\)/);
  assert.ok(app.includes('evidenceAsOf: /^\\d{4}-\\d{2}-\\d{2}$/'));
});

test('supplier calculation disclosures are native, bilingual and evidence-qualified', () => {
  assert.match(app, /<details class="shipping-calculation-details">/);
  assert.match(app, /How this shipment is calculated/);
  assert.match(app, /كيف تُحسب هذه الشحنة/u);
  assert.match(app, /one bounded Kuwait test/);
  assert.match(app, /Despatch Cloud is identified as a fulfilment and data-processing system, not as a proven Tegiwa rate engine/);
  assert.match(app, /ECS returns shipping options specific to the destination and cart\. Its underlying rating engine is not publicly disclosed/);
  assert.match(app, /Observed or supplier-disclosed carrier families/);
  assert.match(app, /shopify_dynamic_checkout: "Dynamic supplier Shopify-checkout quote"/);
  assert.match(app, /not_proven_included_confirm_exact_quote: "Duties and taxes are not proven included; confirm the exact quote\."/);
});

test('shipping money remains fail-closed until a current provider quote is fully verified', () => {
  assert.match(app, /function shippingGroupHasConfirmedRate\(group\)/);
  assert.match(app, /rate: typeof group\?\.rate === "number" && Number\.isFinite\(group\.rate\) && group\.rate >= 0 \? group\.rate : null/);
  assert.match(app, /const hasRate = typeof group\?\.rate === "number"/);
  assert.match(app, /group\?\.status === "confirmed"/);
  assert.match(app, /Number\.isFinite\(amount\)[\s\S]*amount >= 0/);
  assert.match(app, /Boolean\(cleanText\(group\?\.carrier/);
  assert.match(app, /Boolean\(cleanText\(group\?\.service/);
  assert.match(app, /Boolean\(cleanText\(group\?\.quoteId/);
  assert.match(app, /expiry > Date\.now\(\)/);
  assert.match(app, /const rate = shippingGroupHasConfirmedRate\(group\)/);
  assert.match(app, /No confirmed live shipping rate exists for this shipment/);
  assert.match(app, /No unconfirmed shipping charge is added or collected/);
  assert.match(app, /shippingGroupHasConfirmedRate\(group\) \? text\.shippingRateConfirmed : text\.shippingNoConfirmedRate/);
});

test('saved-account cart derives each supplier from the approved product policy', () => {
  const start = app.indexOf('function accountCartItemsForApi()');
  const end = app.indexOf('async function showAccountDashboardTab', start);
  const accountCartSource = app.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(app, /const supplier = cleanText\(policy\?\.supplier\?\.slug \|\| "", 80\)\.toLowerCase\(\)/);
  assert.doesNotMatch(accountCartSource, /supplier:\s*"tegiwa"/);
  assert.match(app, /if \(!product \|\| !policy \|\| !supplier\) return null/);
  assert.match(app, /\}\)\.filter\(Boolean\)/);
});

test('shipping disclosure styling is touch-sized, logical-direction and mobile safe', () => {
  assert.match(styles, /\.shipping-calculation-details summary \{[^}]*min-height: 44px/s);
  assert.match(styles, /\.shipping-calculation-grid ul \{[^}]*font-size: \.75rem/s);
  assert.match(styles, /text-align: start/);
  assert.match(styles, /padding-inline-start: 16px/);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.shipping-calculation-facts, \.shipping-calculation-grid \{ grid-template-columns: 1fr; \}/);
});
