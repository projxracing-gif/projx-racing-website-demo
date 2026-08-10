import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(repo, 'assets/app.js'), 'utf8');
const styles = fs.readFileSync(path.join(repo, 'assets/styles.css'), 'utf8');
const build = fs.readFileSync(path.join(repo, 'scripts/build.mjs'), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

test('checkout captures a normalized GCC destination without guessing missing fields', () => {
  for (const countryCode of ['KW', 'SA', 'AE', 'QA', 'BH', 'OM']) {
    assert.match(app, new RegExp(`\\b${countryCode}: Object\\.freeze\\(`));
  }

  const fields = sourceBetween(app, 'function checkoutDestinationFields(', 'function checkoutPage(');
  for (const name of ['countryCode', 'governorate', 'city', 'area', 'addressLine1', 'addressLine2', 'postcode', 'fulfilment']) {
    assert.match(fields, new RegExp(`name="${name}"`), `missing normalized checkout field ${name}`);
  }
  for (const requiredName of ['countryCode', 'governorate', 'city', 'area', 'addressLine1', 'postcode']) {
    assert.match(fields, new RegExp(`name="${requiredName}"[^>]*required`), `${requiredName} must be required`);
  }
  assert.match(fields, /<label class="required" for="checkout-postcode">\$\{esc\(text\.postcode\)\}<\/label>/);
  assert.doesNotMatch(fields, /for="checkout-postcode"[^<]*<small>\$\{esc\(text\.optional\)\}/);
  assert.match(fields, /autocomplete="address-line1"/);
  assert.match(fields, /aria-describedby="checkout-postcode-help"/);
  assert.match(app, /Use a carrier-contactable number including the country code\./);
  assert.match(app, /Required for courier delivery\. Workshop collection or installation remains subject to manual confirmation\./);
  assert.match(app, /مطلوب للشحن إلى العنوان\. يظل الاستلام أو التركيب في الورشة خاضعاً للتأكيد اليدوي\./);
  assert.match(app, /Workshop collection or installation — confirmation pending/);

  const payload = sourceBetween(app, 'function checkoutShippingPayload(', 'function resetShippingEstimate(');
  for (const key of ['countryCode', 'governorate', 'city', 'area', 'addressLine1', 'addressLine2', 'postcode', 'phone', 'fulfilment']) {
    assert.match(payload, new RegExp(`\\b${key}(?:\\s*:|\\s*,)`), `shipping request omits ${key}`);
  }
});

test('shipping money uses integer minor units and preserves three-decimal KWD display', () => {
  const normalizer = sourceBetween(app, 'function safeShippingMinor(', 'function safeShippingDecimal(');
  assert.match(normalizer, /Number\.isSafeInteger/);
  assert.match(normalizer, /value >= 0/);

  const digits = sourceBetween(app, 'function shippingMinorDigits(', 'function shippingMoneyMinor(');
  assert.match(digits, /\["KWD", "BHD", "OMR", "JOD", "TND", "IQD"\]/);
  assert.match(digits, /\? 3 : 2/);

  const formatter = sourceBetween(app, 'function shippingMoneyMinor(', 'function shippingGroupKey(');
  assert.match(formatter, /amountMinor \/ \(10 \*\* digits\)/);
  assert.match(formatter, /minimumFractionDigits: digits/);
  assert.match(formatter, /maximumFractionDigits: digits/);

  const decimal = sourceBetween(app, 'function safeShippingDecimal(', 'function safeShippingCurrency(');
  assert.match(decimal, /typeof value !== "string" && typeof value !== "number"/);
  assert.match(decimal, /const decimal = String\(value\)/);
  assert.match(decimal, /\.test\(decimal\)/);
});

test('plan-level commercial components are bounded, disclosed and reconcile to the quoted total', () => {
  const planNormalizer = sourceBetween(app, 'function safeShippingPlan(', 'function shippingOriginLabel(');
  assert.match(planNormalizer, /plan\.groups\.slice\(0, 20\)/);
  assert.match(planNormalizer, /group\.options\.slice\(0, 24\)/);
  for (const field of [
    'baseShippingMinor',
    'handlingMinor',
    'protectionMarginMinor',
    'insuranceMinor',
    'fragileFeeMinor',
    'oversizeFeeMinor',
    'forwarderFeeMinor',
    'localDeliveryMinor',
    'roundingAdjustmentMinor'
  ]) assert.match(planNormalizer, new RegExp(`${field}: safeShippingMinor\\(plan\\.${field}\\)`), `unbounded or missing ${field}`);
  assert.match(planNormalizer, /commercialRulesVersion: safeShippingId\(plan\.commercialRulesVersion, 80\)/);
  assert.match(planNormalizer, /commercialRulesEnabled: plan\.commercialRulesEnabled === true/);
  assert.match(planNormalizer, /manualReviewRequired: plan\.manualReviewRequired === true/);

  const breakdown = sourceBetween(app, 'function shippingPlanCommercialBreakdown(', 'function shippingGroupKey(');
  for (const field of [
    'baseShippingMinor', 'handlingMinor', 'protectionMarginMinor', 'insuranceMinor',
    'fragileFeeMinor', 'oversizeFeeMinor', 'forwarderFeeMinor', 'localDeliveryMinor',
    'roundingAdjustmentMinor'
  ]) assert.match(breakdown, new RegExp(`key: "${field}"`), `total reconciliation omits ${field}`);
  assert.match(breakdown, /components\.reduce\(\(sum, component\) => sum \+ component\.amountMinor, 0\)/);
  assert.match(breakdown, /componentTotal === totalMinor/);

  const audit = sourceBetween(app, 'function shippingPlanPricingAuditMarkup(', 'function shippingOptionsMarkup(');
  assert.match(audit, /component\.key === "baseShippingMinor" \|\| component\.amountMinor > 0/);
  for (const label of [
    'baseShipping', 'handlingFee', 'protectionMargin', 'insuranceFee', 'fragileFee',
    'oversizeFee', 'forwarderFee', 'localDeliveryFee', 'roundingAdjustment'
  ]) assert.match(audit, new RegExp(`text\\.${label}`), `total audit omits ${label}`);
  assert.match(audit, /plan\.commercialRulesEnabled \? text\.commercialRulesEnabled : text\.commercialRulesDisabled/);
  assert.match(audit, /plan\.manualReviewRequired \? text\.manualReviewRequired : text\.manualReviewNotRequired/);
  assert.match(audit, /breakdown\.reconciles \? text\.breakdownReconciled : text\.breakdownMismatch/);

  const summary = sourceBetween(app, 'function shippingPlanSummaryMarkup(', 'function shippingCalculationMarkup(');
  assert.match(summary, /const totalReconciles = selectionsAligned && commercialBreakdown\.reconciles/);
  assert.match(summary, /class="shipping-manual-notice" role="status"/);
  for (const phrase of [
    'Fragile-item handling',
    'Oversize shipment charge',
    'Freight-forwarder charge',
    'Required before order approval',
    'رسوم مناولة المواد القابلة للكسر',
    'مطلوبة قبل اعتماد الطلب'
  ]) assert.ok(app.includes(phrase), `missing bilingual commercial disclosure: ${phrase}`);
});

test('shipping services and totals remain fail closed without quote, expiry and server revalidation', () => {
  const tokenGuard = sourceBetween(app, 'function safeShippingToken(', 'function safeShippingMinor(');
  assert.match(tokenGuard, /token\.length <= 24_000/);
  assert.match(tokenGuard, /\^\[A-Za-z0-9_\-\]\+\\\.\[A-Za-z0-9_\-\]\+\$/);

  const quoteGuard = sourceBetween(app, 'function shippingOptionHasConfirmedQuote(', 'function shippingGroupHasConfirmedRate(');
  for (const guard of [
    /status === "confirmed"/,
    /Boolean\(currency\)/,
    /Boolean\(carrier\)/,
    /Boolean\(service\)/,
    /Boolean\(quote\.quoteId\)/,
    /quote\.expiry > Date\.now\(\)/
  ]) assert.match(quoteGuard, guard);

  const revalidation = sourceBetween(app, 'function shippingPlanHasCurrentRevalidation(', 'function shippingDayRangeLabel(');
  assert.match(revalidation, /revalidated === true/);
  assert.match(revalidation, /revalidationStatus === "server_requoted"/);
  assert.match(revalidation, /quoteId/);
  assert.match(revalidation, /revalidatedAt/);
  assert.match(revalidation, /expiry > Date\.now\(\)/);
  assert.match(revalidation, /optionExpiries\.every\(optionExpiry => Number\.isFinite\(optionExpiry\) && optionExpiry > Date\.now\(\)\)/);
  assert.match(revalidation, /revalidationToken/);
  assert.match(revalidation, /groups\.every\(group => shippingGroupHasConfirmedRate\(group, plan\)\)/);

  assert.match(app, /data-shipping-option/);
  assert.match(app, /function shippingEstimateSelectionSnapshot\(plan\)/);
  assert.match(app, /supplier: group\.supplier, originId: group\.originId, optionId: option\.id/);
  assert.match(app, /shippingDestinationReady\(checkoutShippingPayload\(form\)\.destination\)\) requestShippingEstimate\(form\)/);
  assert.match(app, /data-action="revalidate-shipping"/);
  assert.match(app, /disabled/);
  assert.match(app, /const selectionsAligned = fullyConfirmed/);
  assert.match(app, /shippingSelectedOption\(group\)\?\.id === group\.selectedOptionId/);
  assert.match(app, /No payment gateway exists in this flow\./);
  assert.match(app, /Revalidation failed\. No free rate was inserted and payment remains disabled\./);
});

test('partial, manual and duties states are explicit in both languages', () => {
  for (const phrase of [
    'Only some shipments are confirmed',
    'Manual confirmation required',
    'DDP — duties and taxes included only as stated by the confirmed quote',
    'DAP / DDU — duties or clearance may be payable on arrival',
    'تم تأكيد بعض الشحنات فقط',
    'تأكيد يدوي مطلوب'
  ]) assert.ok(app.includes(phrase), `missing shipping disclosure: ${phrase}`);

  assert.match(app, /class="shipping-plan-status\$\{allRatesConfirmed \? " is-confirmed" : safePlan\?\.status === "partial" \? " is-partial" : ""\}"/);
  assert.match(app, /class="shipping-manual-notice"/);
  assert.match(app, /function shippingIncotermLabel\(/);
});

test('shipping administration is noindex, role-gated and exposes no operational data or writes', () => {
  assert.match(build, /add\('\/admin\/shipping',[\s\S]*?indexable: false,/);
  assert.match(app, /path === "\/admin\/shipping"/);

  const page = sourceBetween(app, 'function shippingAdminLockedMarkup(', 'function mountShippingAdminDashboard(');
  assert.match(page, /shipping-admin-shell/);
  assert.match(page, /shipping-admin-grid/);
  assert.match(page, /shipping-admin-card/);
  assert.match(page, /disabled/);
  assert.match(app, /Protected administration API not configured/);
  assert.match(app, /No live credentials are exposed to the browser/);
  assert.doesNotMatch(page, /fetch\s*\(/);
  assert.doesNotMatch(page, /data-shipping-admin-(?:write|approve|payment|supplier-order)/);

  const mount = sourceBetween(app, 'function mountShippingAdminDashboard(', 'function ');
  assert.match(mount, /loadClerk\(/);
  assert.match(mount, /isSignedIn/);
  assert.doesNotMatch(mount, /fetch\s*\(/);
});

test('checkout, option, audit and protected-admin presentation is accessible on mobile and RTL', () => {
  for (const selector of [
    '.checkout-destination',
    '.checkout-fieldset-help',
    '.shipping-options',
    '.shipping-option',
    '.shipping-pricing-audit',
    '.shipping-manual-notice',
    '.shipping-total-panel',
    '.shipping-revalidation-status',
    '.shipping-admin-shell',
    '.shipping-admin-grid',
    '.shipping-admin-card',
    '.shipping-admin-actions',
    '.shipping-admin-security-note'
  ]) assert.ok(styles.includes(selector), `missing styles for ${selector}`);

  assert.match(styles, /\.shipping-option > label,[^{]*\{[^}]*min-height: 64px/s);
  assert.match(styles, /\.shipping-pricing-audit summary \{[^}]*min-height: 44px/s);
  assert.match(styles, /\.shipping-total-panel \.btn \{[^}]*min-height: 44px/s);
  assert.match(styles, /\[dir="rtl"\] \.shipping-option\.is-selected/);
  assert.match(styles, /text-align: start/);
  assert.match(styles, /text-align: end/);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.shipping-admin-grid, \.shipping-admin-actions \{ grid-template-columns: 1fr; \}/);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.shipping-option > label, \.shipping-option > div \{ grid-template-columns: auto minmax\(0, 1fr\)/);
});
