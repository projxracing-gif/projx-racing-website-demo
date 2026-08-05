import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(repo, 'assets/app.js'), 'utf8');
const styles = fs.readFileSync(path.join(repo, 'assets/styles.css'), 'utf8');

test('account API calls use the active Clerk session bearer token and fail closed', () => {
  assert.match(app, /clerk\?\.session\?\.getToken\?\.\(\)/);
  assert.match(app, /Authorization: `Bearer \$\{token\}`/);
  assert.match(app, /Account data could not be loaded\. No private information has been displayed\./);
  assert.match(app, /تخزين بيانات الحساب غير مفعّل بعد/u);
});

test('profile form sends only supported account fields with PATCH', () => {
  for (const field of ['displayName', 'phone', 'preferredLocale']) {
    assert.match(app, new RegExp(`name=\\"${field}\\"`));
  }
  assert.match(app, /accountApi\("account",\s*\{\s*method: "PATCH"/s);
  assert.match(app, /data-account-profile-form/);
});

test('address UI covers create, edit and delete with native validation', () => {
  for (const field of ['label', 'recipientName', 'phone', 'addressLine1', 'city', 'countryCode']) {
    assert.match(app, new RegExp(`name=\\"${field}\\"[^>]*required`));
  }
  assert.match(app, /method: addressId \? "PUT" : "POST"/);
  assert.match(app, /data-account-edit-address/);
  assert.match(app, /data-account-delete-address/);
  assert.match(app, /method: "DELETE"/);
});

test('saved-cart UI explicitly saves canonical items and restores only eligible products', () => {
  assert.match(app, /data-account-save-cart/);
  assert.match(app, /accountApi\("cart", \{ method: "PUT", body: \{ items \} \}\)/);
  assert.match(app, /normalizeCart\(savedItems\.map/);
  assert.match(app, /Wishlist sync is not enabled in this testing build/);
});

test('signed-in website quotes are persisted to account history before public fallback', () => {
  assert.match(app, /async function saveWebsiteQuoteToAccount/);
  assert.match(app, /accountApi\("quotes",\s*\{\s*method: "POST"/s);
  assert.match(app, /if \(!savedToAccount && \["api", "auto"\]\.includes\(CONFIG\.formMode\)\)/);
  assert.match(app, /Quote saved to your account\./);
});

test('checkout keeps guest mode while offering account access and safe Clerk prefilling', () => {
  assert.match(app, /An account is optional\. Sign in to prefill known Clerk details, or continue as a guest\./);
  assert.match(app, /href=\"\$\{routeUrl\("\/account"\)\}\"/);
  assert.match(app, /function prefillCheckoutAccount\(\)/);
  assert.match(app, /if \(value && !cleanText\(form\.elements\[name\]\?\.value/);
});

test('account and checkout controls have responsive styling', () => {
  for (const selector of ['.account-dashboard-tabs', '.account-address-form', '.account-cart-actions', '.checkout-account-option']) {
    assert.match(styles, new RegExp(selector.replace('.', '\\.') + '\\s*\\{'));
  }
});
