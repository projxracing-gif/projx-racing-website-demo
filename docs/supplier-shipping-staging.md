# Supplier shipping in staging

Status: supplier-split shipping planning is implemented. The website describes the verified rating method for each supplier, but it remains fail-closed and does not invent a delivery charge when an authorised, current quote is unavailable.

Research checked: 2026-08-10.

## What the suppliers actually do

### Tegiwa

Tegiwa is a Shopify storefront. Its privacy policy also names Despatch Cloud as an order-data processor. Despatch Cloud is therefore treated as a fulfilment system; it is not presented as the rate calculator without stronger supplier evidence.

A bounded public storefront check used one temporary cart, a Kuwait destination and no login, payment or order submission. Shopify returned one `DHL Express Worldwide` option sourced by `Calcurates`, with zero app-level markup in that response. Repeating the check at different cart weights changed the quoted amount. Changing only the product value in the tested pair did not change the rate. This verifies the observed tool chain and weight sensitivity for those samples, not Tegiwa's private tariff or a universal formula.

Observed inputs and behaviour:

- Shopify checkout/localisation orchestrates the customer quote.
- Calcurates was the rate source returned for the tested Kuwait cart.
- DHL Express Worldwide was the carrier/service returned for that cart.
- The rate changed with shipment weight.
- Kuwait governorate was required by the storefront.
- Kuwait localisation removed UK VAT from the tested product price.
- The Kuwait rate did not prove prepaid duties or DDP; customs and duties remain separate unless a future authoritative quote explicitly says otherwise.
- Tegiwa's exact packing rules, dimensional-weight divisor, carrier discounts, fuel/remote surcharges, and dealer/drop-ship rules are not public.

Official sources:

- Tegiwa privacy policy: https://www.tegiwa.com/policies/privacy-policy
- Tegiwa terms of service: https://www.tegiwa.com/policies/terms-of-service
- Tegiwa dealer information: https://www.tegiwa.com/pages/dealer-application
- Calcurates DHL capability: https://calcurates.com/carriers/dhl
- Calcurates dimensional-weight capability: https://calcurates.com/features/shopify-volumetric-dimensional-weight

### ECS Tuning

ECS exposes a dynamic cart quote. The customer selects a country and enters a postal code, then chooses from returned shipping options. ECS does not publicly name its rate-engine vendor or publish a reusable tariff formula, so the website must not label ECS as using ShipStation, EasyPost, Shopify, or another unverified platform.

Verified public rules:

- Quotes are destination- and cart-specific and remain in USD.
- ECS normally waits until the entire order is in stock.
- A customer-requested partial shipment can add shipping charges.
- `Ships in N days` is supplier-to-ECS preparation time, not carrier transit time.
- `Available/Direct Ship` can use an alternate warehouse, so an Ohio-origin rate must not be assumed.
- Back-order dates are not guaranteed.
- Oversized products can require a manual freight quote.
- Ground-only or otherwise restricted products exist and must fail closed for Kuwait until route eligibility is confirmed.
- ECS's policy references UPS, USPS and FedEx, but that does not prove that every service is available for every Kuwait shipment.
- International brokerage, customs and duties are normally separate unless ECS explicitly states otherwise for the exact quote.

Official sources:

- ECS international shipping FAQ: https://www.ecstuning.com/ContactUs/
- ECS terms and shipping policy: https://www.ecstuning.com/TermsOfUse/
- ECS checkout example: https://www.ecstuning.com/Audi-C5_Allroad-Quattro-2.7T/Checkout/

## Projx implementation rule

The website emulates the suppliers' decision structure, not their private prices:

1. Resolve every cart line on the server; never trust browser-supplied price, supplier, origin, weight, dimensions or restriction flags.
2. Split first by supplier and verified fulfilment origin. A direct-ship warehouse becomes its own shipment group.
3. Split again when an item is hazardous, oversized, freight-only or required to ship separately.
4. Build verified packages from weight, dimensions and quantity.
5. Request an authorised supplier or carrier quote for each group.
6. Display carrier, service, amount, currency, transit range, quote time and expiry only after validating the provider response.
7. If any required origin, package, route or authorised-rate input is missing, keep that group at `Shipping confirmation required` with a null amount.
8. Never average or silently convert Tegiwa GBP and ECS USD charges. A mixed cart shows separate UK and US shipment lines.
9. Kuwait customs, brokerage and local delivery remain separate unless the exact returned service explicitly confirms inclusion.

Exact live rating requires, per package:

- verified fulfilment origin and destination;
- quantity and packing result;
- actual packaged weight;
- length, width and height;
- declared value and currency;
- hazardous, oversized and freight-only flags;
- ready date;
- authorised carrier/service access; and
- a current quote expiry.

Dimensional weight may be shown as a diagnostic, but the carrier or approved rating service must apply its current divisor, zones, contract discounts and surcharges. Projx must not derive a final charge from sampled supplier prices.

## Current staging limits

Only one reviewed Tegiwa product currently satisfies the direct-cart policy, and its reference-price freshness expires after 2026-08-10 unless it is deliberately reverified. Reviewed ECS products remain quotation-only. A customer therefore cannot yet create a real mixed Tegiwa/ECS cart from the public catalogue even though the server split-group logic is tested for both suppliers.

The catalogue does not yet provide complete variant-level packaged measurements, verified fulfilment origins or hazardous/oversized completeness. The database foundation contains shipping-measurement fields, but they are not yet populated and connected to checkout. Unknown flags must remain unknown; a default `false` must never be treated as verified safe-to-ship evidence.

## Access still required for final live prices

Tegiwa needs to approve one supported route for dealer/drop-ship quoting: an authorised Shopify delivery-option integration, a dedicated B2B quote service, or explicitly scoped rate credentials. Public storefront observations are evidence for the interface, not permission to operate Tegiwa's checkout as Projx's production rate API.

ECS needs to supply an authorised dealer shipping quote path, package metadata, warehouse/origin data for direct-ship items, Kuwait service eligibility and surcharge/drop-ship rules. ECS has stated that it does not provide a catalogue API/CSV integration; no supported shipping API has been supplied either.

Until those inputs are available, the website's controlled confirmation-required state is the only production-safe result.
