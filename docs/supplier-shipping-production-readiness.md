# Supplier shipping production-readiness plan

Document status: implementation and access plan; no credentials or secret values are included.

Audit date: 2026-08-10.

## Evidence labels used in this document

- **Verified** means confirmed from the deployed Projx system, an official supplier page, or a bounded observation recorded in `docs/supplier-shipping-staging.md`.
- **Inference** means a recommended engineering decision based on the verified facts. It is not presented as a supplier feature or commercial agreement.
- **Unknown** means Projx Racing still needs written supplier confirmation, data, credentials, or a controlled test.

## Executive decision

The current preview is safe to keep online because it explains supplier-specific shipping inputs while refusing to invent a delivery charge. It is not ready to promise or collect live freight. Production live-rating must remain disabled until each supplier provides an authorised quote route, verified package and origin data, permitted drop-ship terms, and a testable order lifecycle.

Projx should emulate the suppliers' decision structure, not copy sampled prices or reverse-engineer a private tariff. Every exact charge must come from a current authorised quote for the exact cart, packages, origin, destination, and service.

## Current-system audit

### Deployed preview

| Item | Current status | Evidence classification |
| --- | --- | --- |
| Vercel project | `projx-racing-website-demo` | Verified from Vercel deployment metadata |
| Preview branch | `preview/ecs-catalogue-review` | Verified from Vercel deployment metadata |
| Preview commit | `cbf9f3aa0d4ee1c91a299a1d4529eba4b7cc4e33` | Verified from Vercel deployment metadata |
| Preview deployment | `dpl_4xdbv2Jm3XeVq5VNyDDheV6yoViD`, state `READY` | Verified from Vercel deployment metadata |
| Public branch alias | `https://projx-racing-website-demo-git-preview-ecs-c-166f91-projx-racing.vercel.app` | Verified by deployment metadata and direct HTTP checks |
| English and Arabic cart/checkout routes | Returned HTTP 200 in the post-deployment audit | Verified by direct HTTP checks |
| Shipping estimator | Returned HTTP 200 with a controlled `confirmation_required` result and a null rate | Verified by direct API check |
| Runtime health | No shipping-route runtime-error cluster and no deployment-scoped 5xx log in the checked period | Verified through Vercel runtime evidence |

### Functional status

| Capability | Status | Production decision |
| --- | --- | --- |
| Server-side cart identity validation | Implemented for the approved direct-cart policy | Retain |
| Split by supplier | Implemented | Retain |
| Split by supplier plus explicit fulfilment origin | Implemented and collision-tested | Retain |
| English/Arabic shipping disclosure | Implemented in the preview | Retain |
| Exact supplier freight amount | Not connected | Keep `Shipping confirmation required` |
| Verified packaged weight and dimensions | Not complete at variant level | Do not calculate a live charge |
| Hazardous, oversized, freight-only and separate-package flags | Not complete | Treat unknown as blocked, never as safe |
| Verified supplier warehouse/origin for every line | Not complete | Do not assume one UK or US warehouse |
| Quote ID and expiry | Schema guard exists; no authorised provider emits them yet | Require before displaying a confirmed amount |
| Duties/incoterms | Not proven for a general Kuwait route | Show duties, brokerage and local delivery as separate unless the exact quote proves inclusion |
| Tegiwa direct-cart scope | One reviewed product; its price evidence requires deliberate re-verification after 2026-08-10 | Reverify before later use |
| ECS direct-cart scope | Reviewed ECS products remain quotation-only | Do not convert until price, fitment, availability and shipping gates pass |
| Mixed Tegiwa/ECS checkout | Grouping is tested, but a customer cannot yet create a fully approved mixed direct-cart order | Keep as a future controlled test |
| Payment capture | Disabled in staging | Do not activate as part of shipping work |
| Supplier order submission | Not connected | Do not claim that a supplier order has been placed |
| Supplier webhooks | Not connected | Use polling/manual confirmation until authorised webhooks exist |

## Supplier evidence register

### Tegiwa

**Verified facts**

- Tegiwa operates a Shopify storefront. Shopify documents that rates can depend on origin, destination, weight, dimensions, value, shipping profile, carrier/app configuration and handling adjustments. [Shopify shipping-rate documentation](https://help.shopify.com/en/manual/fulfillment/setup/shipping-rates/setting-up-shipping-rates)
- Tegiwa's privacy policy names Despatch Cloud as an order-data processor. This supports identifying it as part of fulfilment/data processing, not as a proven rating engine. [Tegiwa privacy policy](https://www.tegiwa.com/policies/privacy-policy)
- One bounded Kuwait storefront test returned `DHL Express Worldwide` with `Calcurates` identified as the rate source. The tested rate changed with weight. This is evidence for that sample only. Calcurates documents DHL, dimensional-weight and multi-origin capabilities, but those product capabilities do not reveal Tegiwa's private configuration. [Calcurates DHL](https://calcurates.com/carriers/dhl), [Calcurates dimensional weight](https://calcurates.com/features/shopify-volumetric-dimensional-weight), [Calcurates multi-origin shipping](https://calcurates.com/features/shopify-multi-origin-shipping)
- Tegiwa publishes terms and dealer information, but the public pages do not provide Projx with a production shipping API credential or a reusable dealer tariff. [Tegiwa terms](https://www.tegiwa.com/policies/terms-of-service), [Tegiwa dealer information](https://www.tegiwa.com/pages/dealer-application)

**Engineering inference**

- The preferred path is a supplier-approved quote API or approved Shopify delivery-option integration that returns an exact, expiring quote for dealer/drop-ship use.
- Despatch Cloud should be integrated only if Tegiwa explicitly authorises a narrowly scoped quote/order use case and confirms which returned amount Projx may show to customers.

**Unknowns requiring Tegiwa confirmation**

- Supported B2B quote and order interface, authentication method, sandbox and rate limits.
- Whether public Shopify delivery options may be reused for dealer/drop-ship orders.
- Variant-level packaged measurements, packing rules, warehouse/origin identifiers and restricted-item flags.
- Dealer freight discounts, fuel/remote-area surcharges, insurance, minimum charges and multi-package handling.
- Kuwait service eligibility, duties/incoterms, returns, neutral packing, partial shipment and drop-ship rules.
- Order-status, stock, tracking and cancellation webhook or feed support.

### ECS Tuning

**Verified facts**

- ECS exposes destination- and cart-specific shipping choices in its public checkout. Its public pages do not identify the underlying rating-engine vendor or publish a reusable tariff formula. [ECS international shipping FAQ](https://www.ecstuning.com/ContactUs/), [ECS checkout example](https://www.ecstuning.com/Audi-C5_Allroad-Quattro-2.7T/Checkout/)
- ECS explains that it normally holds an order until all items are available, that a requested partial shipment can add shipping cost, and that preparation estimates are not carrier transit promises. Direct-ship, back-order, oversized, ground-only and restricted-item cases must therefore remain route-specific. [ECS terms and shipping policy](https://www.ecstuning.com/TermsOfUse/)
- ECS names UPS, USPS and FedEx in its public policy. That is supplier-disclosed carrier information, not proof that each carrier or service is available for a specific Kuwait package.
- Project correspondence records that ECS does not currently provide a general catalogue API, CSV or Excel export. This is project evidence, not a claim derived from the public pages.

**Engineering inference**

- Projx should request a wholesale-only quote/order method or a documented alternative workflow. The public cart must not be treated as an undocumented production API.
- If ECS cannot provide a live quote integration, ECS products should retain a manual shipping-confirmation step even when product price and fitment are otherwise suitable for cart.

**Unknowns requiring ECS confirmation**

- Any wholesale quote endpoint, dealer-portal request, structured order file, secure SFTP exchange or documented manual quote workflow.
- Per-SKU packaged measurements, restriction flags, direct-ship origin/warehouse, handling time and package count.
- Kuwait carrier/service eligibility, dealer freight treatment, surcharges, duties/incoterms and freight-quote rules.
- Drop-ship permission, neutral packing, split-shipment policy, order submission, test mode and idempotency support.
- Stock, order-status, tracking, cancellation and return webhook/feed support.

## Recommended architecture

### 1. Product logistics truth layer

Store logistics independently from marketing copy and stock. Each supplier variant needs:

- supplier and supplier product/variant identity;
- verified fulfilment-origin identifier and country;
- packaged weight plus length, width and height with units;
- package quantity or a supplier-approved packing rule;
- hazardous, ground-only, oversized, freight-only and ships-separately states;
- declared-value currency basis;
- source, verification timestamp and freshness/expiry;
- an explicit `unknown` state for every unverified restriction.

Browser-supplied logistics data must never override this layer.

### 2. Shipment planner

The server resolves every cart line, then groups by supplier and verified origin. It creates additional groups for direct-ship warehouses, freight, restricted products or required separate packages. Mixed suppliers always remain separate even when origin labels happen to match.

If any line lacks verified package or route data, only that group fails closed; the site may still explain the other groups without inventing a combined charge.

### 3. Provider adapters

Use one internal contract with separate adapters for Tegiwa and ECS. A quote request should contain only the required cart identity, verified packages, origin, destination, declared value and requested service context. A normalised response must include:

- supplier and origin group identity;
- provider quote ID;
- carrier and service;
- amount as a real finite nonnegative number;
- three-letter currency;
- quote creation and expiry times;
- transit estimate and ready/dispatch estimate as separate fields;
- package count;
- duties/incoterms and surcharge disclosures;
- provider test/live mode; and
- raw-provider reference retained only in protected server logs.

Reject missing, malformed, expired, mismatched-destination or mismatched-cart quotes. Do not average currencies or convert them silently.

### 4. Quote lifecycle and checkout lock

1. Create a quote only after the customer supplies the complete destination.
2. Bind the quote to the canonical cart, destination, supplier group and package fingerprint.
3. Display the charge only while the quote is current.
4. Requote immediately before a future order/payment step.
5. If price, stock, package, origin or route changes, invalidate the quote and return to confirmation-required.
6. Persist the supplier quote ID and evidence with the order snapshot; never rely on browser storage as the commercial record.

### 5. Supplier order orchestration

Supplier order submission is a later, separately approved phase. It requires a durable Projx order, idempotency key, exact customer consent, verified totals and an approved payment/credit workflow. A supplier acknowledgement is not the same as shipment confirmation.

Webhooks must be signature-verified, replay-protected, idempotent and mapped to the stored supplier order. Polling may be used only when the supplier documents it and no webhook exists.

### 6. Security and observability

- Keep credentials in encrypted Vercel environment settings and local secret storage only.
- Never include credentials, raw provider payloads, customer addresses or supplier account terms in Git or public logs.
- Apply bounded timeouts, no automatic redirect across hosts, strict response-size limits and an allowlist of supplier hosts.
- Log quote outcome, latency, supplier, route category, quote expiry and a non-reversible request fingerprint; redact PII and credentials.
- Alert on 5xx, provider authentication failures, quote rejection rate, stale package data and large price deltas.
- Rate-limit public quote requests and cache only provider-permitted, cart-bound results for no longer than their expiry.

## Supplier-by-supplier delivery plan

### Tegiwa plan

1. Obtain written permission and select exactly one supported quote route.
2. Receive documentation, test credentials, allowed hosts, rate limits and a test account.
3. Import or request authoritative variant package/origin/restriction data.
4. Build a test-only adapter and verify known Kuwait destinations, light/heavy carts, multi-package carts, oversized/restricted items and unavailable routes.
5. Reconcile Projx results against a supplier-provided expected quote set; sampled public-store prices are not the acceptance oracle.
6. Add order submission only after quote accuracy and dealer/drop-ship terms are approved.
7. Add signed status/tracking/stock webhooks or the supplier's documented polling alternative.
8. Enable Tegiwa live quotes independently; retain the manual fallback per group.

### ECS plan

1. Acknowledge ECS's stated lack of a general catalogue API/CSV and request a wholesale-specific quote/order alternative without scraping the public cart.
2. Obtain package, restriction and origin data for the products ECS permits Projx to sell directly.
3. Confirm dealer/drop-ship rules, direct-ship warehouse handling, split shipments, freight/manual-quote cases and Kuwait eligibility.
4. Build a test-only adapter or structured manual workflow using ECS-approved documentation.
5. Test stock/preparation time separately from transit time and verify that unavailable or ground-only routes fail closed.
6. Keep every unsupported ECS item on `Request a Quote` or `Shipping confirmation required`.
7. Add order/status/tracking integration only when ECS provides an authorised mechanism.
8. Enable ECS independently from Tegiwa so one supplier outage cannot produce a guessed combined rate.

## Environment-variable contract

No live shipping credential is currently required because live rating is disabled. The shipping foundation now consumes the shared safety, quote-signing, persistence, commercial-rule and per-supplier mode names below. The Tegiwa and ECS provider adapters remain deliberately disabled/unimplemented until a supplier-authorised mapper, endpoint and credential set has been reviewed. Merely setting a mode or URL cannot enable live rates. Configure only variables required by the approved route. Never place values in Git, documentation, client configuration or screenshots.

### Shared controls

| Name | Description |
| --- | --- |
| `SUPPLIER_SHIPPING_MODE` | Global activation state for disabled, supplier-test and live operation. Live must remain unavailable until the release checklist passes. |
| `SUPPLIER_SHIPPING_ALLOWED_COUNTRIES` | Server-side destination allowlist for routes that have been contractually and technically verified. |
| `SUPPLIER_SHIPPING_QUOTE_SIGNING_SECRET` | Server-only secret used by the implemented HMAC token layer to bind a returned quote to its canonical cart, packages, destination and supplier groups. |
| `SUPPLIER_SHIPPING_MAX_QUOTE_AGE_SECONDS` | Maximum local acceptance age; it must never extend a shorter provider expiry. |
| `SUPPLIER_SHIPPING_ALERT_RECIPIENT` | Operational recipient for provider-authentication, repeated quote and webhook failures. |

### Tegiwa conditional settings

| Name | Description |
| --- | --- |
| `TEGIWA_INTEGRATION_MODE` | Independent Tegiwa disabled/test/live gate. |
| `TEGIWA_QUOTE_API_URL` | Supplier-approved quote endpoint; host must be allowlisted. |
| `TEGIWA_QUOTE_API_TOKEN` | Server-only least-privilege quote credential. |
| `TEGIWA_SHOP_DOMAIN` | Approved Shopify store domain if Tegiwa selects a Shopify delivery-option route. |
| `TEGIWA_STOREFRONT_ACCESS_TOKEN` | Server-only Storefront credential, only if Tegiwa explicitly authorises dealer/drop-ship delivery quoting. |
| `TEGIWA_ORDER_API_URL` | Supplier-approved order-submission endpoint, configured only in the later order phase. |
| `TEGIWA_ORDER_API_TOKEN` | Server-only least-privilege order credential, separate from quote access where supported. |
| `TEGIWA_ACCOUNT_REFERENCE` | Projx dealer/drop-ship account identifier; treat as private operational data. |
| `TEGIWA_WEBHOOK_SECRET` | Server-only signing secret for authorised Tegiwa callbacks. |

### ECS conditional settings

| Name | Description |
| --- | --- |
| `ECS_INTEGRATION_MODE` | Independent ECS disabled/test/live gate. |
| `ECS_QUOTE_API_URL` | ECS-approved wholesale quote endpoint or gateway, if one is offered. |
| `ECS_QUOTE_API_TOKEN` | Server-only least-privilege quote credential. |
| `ECS_ORDER_API_URL` | ECS-approved order-submission endpoint or gateway, if one is offered. |
| `ECS_ORDER_API_TOKEN` | Server-only least-privilege order credential, separate from quote access where supported. |
| `ECS_ACCOUNT_REFERENCE` | Projx wholesale/drop-ship account identifier; treat as private operational data. |
| `ECS_WEBHOOK_SECRET` | Server-only signing secret for authorised ECS callbacks. |

If a supplier chooses mutual TLS, SFTP, OAuth or a direct carrier-account route, add narrowly named variables only after the protocol is documented and approved. Do not create generic credentials that can access catalogue cost, customer data and order mutation when quote-only access would suffice.

## Deployment instructions

### Documentation-only release

These documents do not alter runtime behaviour. Review spelling, evidence labels, links and the absence of secret values; then commit only the intended documentation files to the preview branch.

### Future shipping implementation release

1. Obtain written supplier authorisation and an approved data-processing/security record.
2. Implement on a dedicated preview branch; do not overwrite the approved production deployment.
3. Add credentials only to encrypted Preview environment settings. Keep both supplier integrations disabled by default.
4. Run dependency installation from the lockfile and the complete project check, including shipping, commerce, Arabic/English and account tests.
5. Deploy a public preview that cannot take real payment or submit a live supplier order.
6. Verify English and Arabic cart/checkout pages, mobile layout, API method/origin/body guards, strict quote validation, expiry, mixed-supplier separation and failure states.
7. Verify supplier sandbox/test quotes against supplier-provided expected results. Include light, heavy, multi-package, direct-ship, oversized, restricted, unavailable and expired-quote cases.
8. Check Vercel build logs, runtime errors and 5xx logs. Confirm that logs contain no credentials or customer address data.
9. Enable one supplier in test mode at a time. Keep the other supplier and the global live gate disabled.
10. Require explicit approval before adding Production credentials or promoting a live-rate deployment.
11. Requote at final checkout and prove that no payment/order can proceed with an expired, malformed or unconfirmed supplier group.
12. Record commit, deployment ID, environment scope, supplier approval reference, test evidence and rollback target.

## Rollback instructions

Use the least disruptive rollback that restores the fail-closed state:

1. Disable the affected supplier integration, or the global shipping integration, in Vercel and redeploy. The website must fall back to `Shipping confirmation required` with no amount.
2. If code is faulty, roll the preview/production alias back to the last known-good Vercel deployment. Do not delete the failed deployment or its evidence during the incident.
3. If a credential may be exposed or misused, revoke or rotate it at the supplier first, then update encrypted environment settings. Never paste the old or new value into an issue, chat, log or commit.
4. Suspend supplier order submission independently from quote display. Preserve accepted order and quote records for reconciliation.
5. Stop webhook processing only after preventing retries from creating duplicates; retain event IDs and idempotency records.
6. Do not delete customer, quote, order or logistics tables as a rollback. Use a reviewed forward migration after customer data exists. Before customer data exists, a verified database branch/checkpoint restore may be used with explicit approval.
7. Re-run the HTTP/API/runtime sanity audit after rollback and document the restored deployment ID and failure cause.

## Production release gates

Live supplier shipping remains blocked until all applicable gates are complete:

- written permission to display and use the returned dealer/drop-ship rate;
- approved quote endpoint/protocol and least-privilege credential;
- verified product/variant package, restriction and origin coverage;
- documented Kuwait carrier eligibility, duties/incoterms and surcharge rules;
- provider test cases reconciled within the supplier-approved tolerance;
- current quote ID, amount, currency, service and expiry validation;
- durable quote/order idempotency and audit records;
- signed webhook or approved polling behaviour;
- English/Arabic/mobile and error-path verification;
- no secret or PII leakage in repository, browser payloads or logs;
- monitored preview soak with no unexplained 5xx or quote mismatch; and
- explicit approval for Production environment variables and deployment.
