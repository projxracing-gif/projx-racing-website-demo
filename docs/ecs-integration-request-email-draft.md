# ECS Tuning integration request email draft

Status: draft only. This message has not been sent and contains no credentials.

Before sending, Projx Racing should confirm the sender name, signature and telephone number. Remove any request that ECS has already answered conclusively.

**To:** Jack M., Wholesale Department Manager — Jack@ecstuning.com
**Subject:** Projx Racing wholesale integration request — accurate Kuwait freight, drop-ship orders and product logistics

Dear Jack,

Thank you for confirming that ECS Tuning does not currently offer a general catalogue API or downloadable CSV/Excel catalogue, and for granting Projx Racing permission to add products manually.

We are now preparing the testing version of our customer checkout for Kuwait. We do not want to scrape the public cart, guess freight, publish dealer pricing, or present preparation time as carrier transit time. Our goal is to keep ECS product, stock, origin and shipping information accurate while following the workflow ECS approves for wholesale customers.

Could you please confirm whether ECS can provide any wholesale-only integration or documented alternative for the following areas?

1. A destination- and cart-specific shipping quote, dealer-portal quote request, secure endpoint, structured file exchange or documented manual workflow.
2. Test access or test orders, authentication method, allowed hosts, rate limits and any IP allowlisting requirements.
3. Quote fields including quote ID, carrier, service, amount, currency, package count, dispatch estimate, transit estimate, expiry, surcharges and duties/incoterms.
4. Product- or variant-level packaged weight, dimensions and package count, plus flags for hazardous, ground-only, oversized, freight-only and separate-shipment products.
5. The actual warehouse/origin identifier for normal, alternate-warehouse and Direct Ship items, without assuming that every product ships from one US location.
6. The correct meaning and update cadence for stock, back-order and `Ships in N days` information, kept separate from carrier transit time.
7. Permission and terms for shipping directly to a Projx Racing customer in Kuwait, including freight treatment, neutral packing/branding, insurance, partial shipments, order consolidation, returns and warranty handling.
8. A supported wholesale order-submission process, test mode, idempotency or duplicate protection, order acknowledgement, cancellation windows and tracking/status updates.
9. Signed webhooks or an approved polling/feed alternative for stock, order status, shipment, tracking, cancellation and return events, including retry and signature-verification documentation.
10. Whether the exact wholesale/drop-ship freight amount may be displayed to our customer, and whether any handling margin is permitted or required.
11. A small ECS-approved test set for a light parcel, heavy parcel, multi-package order, Direct Ship item, oversized/manual-freight item, ground-only or unavailable route, partial shipment and mixed-stock order to Kuwait.

Our website is designed to fail closed. Without a current authorised quote and verified package/origin data, it will show `Shipping confirmation required` and will not add or collect a guessed delivery charge. Any credential would be stored only in encrypted server-side settings and never exposed in browser code or our public repository.

We understand that a general catalogue API is not available. If live quote or order access is also unavailable, please let us know the wholesale process ECS would prefer us to use so that our team can confirm freight and availability accurately before accepting a customer order.

Please also advise the best technical contact, any agreement or security review required, and whether a short call would be useful to confirm the workflow.

Best regards,

Projx Racing
Kuwait
projxracing@gmail.com
