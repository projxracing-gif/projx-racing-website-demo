# Supplier-direct shipping in staging

Status: split-shipment planning is implemented; live supplier rates remain disabled until authorised rate access is supplied.

## Current behaviour

The cart and staging checkout group server-verified lines by their fulfilment supplier. A mixed cart is presented as separate supplier shipments so customers are not shown one misleading combined freight charge:

- Tegiwa items are grouped under the verified supplier profile for Great Britain.
- ECS Tuning items will be grouped under their verified supplier fulfilment profile when an ECS item becomes eligible for direct cart purchase.
- A supplier group without a supported live-rate adapter is labelled `Shipping confirmation required` and has no fabricated amount.

`POST /api/shipping-estimate` accepts a bounded same-origin request containing internal product IDs, SKUs, quantities and a destination. It resolves every line against the server commerce policy, rejects stale or tampered items, and returns separate supplier groups. The staging-order endpoint independently rebuilds and snapshots the same grouping. No payment is collected, no stock is reserved and customs are not represented as included.

Only one reviewed Tegiwa product currently satisfies the direct-cart policy. All reviewed ECS items and URL-only ECS references remain quotation-only, so a real mixed cart cannot yet be created from the public catalogue. The grouping logic is tested with both Great Britain and United States supplier profiles in preparation for a safely approved ECS direct-cart item.

## Why live rates are not shown

ECS advised Projx Racing that it does not provide an API, CSV or Excel integration. Its public cart can calculate international shipping, but no supported dealer rate endpoint or credentials have been supplied.

Tegiwa calculates shipping during its Shopify checkout and identifies Despatch Cloud as a service provider. Neither a dealer shipping-rate API nor rate credentials have been provided. A supplier-approved Shopify Storefront integration could return delivery groups and carrier options, but it requires an authorised Storefront token, exact Shopify variant IDs and confirmation that the returned prices are valid for dealer or drop-ship orders. Despatch Cloud credentials must not be reused without explicit, narrowly scoped supplier authorisation.

Product weight without verified packaged dimensions is insufficient for accurate international freight, especially for oversized, hazardous or separate-shipment products. A Projx carrier-account estimate would not be the same as the freight amount billed by ECS or Tegiwa and therefore must not be labelled as an accurate supplier rate.

## Access required for live supplier rates

Tegiwa must provide one supported route:

1. an approved Shopify Storefront endpoint and token with delivery-option access plus exact variant IDs;
2. a dedicated read-only B2B shipping quote endpoint; or
3. explicitly scoped Despatch Cloud quote credentials and written confirmation of the rates Projx may display.

ECS must provide a supported wholesale shipping-rate or order-quote service and credentials. A future product FTP feed may provide weights and dimensions, but does not by itself provide ECS's billed freight rates.

Until that access is granted, the implemented manual supplier quote adapter is the only truthful production-safe fallback.
