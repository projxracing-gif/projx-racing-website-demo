# Tegiwa integration request email draft

Status: draft only. This message has not been sent and contains no credentials.

Before sending, Projx Racing should confirm the recipient address, sender name, signature and telephone number. Remove any request that Tegiwa has already answered conclusively.

**To:** Tegiwa Dealer Support / Technical Integrations — address to be confirmed
**Subject:** Projx Racing dealer integration request — Kuwait shipping quotes, drop-ship orders and product logistics

Dear Tegiwa Dealer Support Team,

Projx Racing is developing the testing version of our performance-parts website for customers in Kuwait. We are an existing dealer and would like to integrate Tegiwa products in a way that keeps product availability, shipping charges and delivery expectations accurate.

We have observed that the public Tegiwa storefront uses Shopify and, in one limited Kuwait checkout test, returned a DHL Express Worldwide option with Calcurates identified as the rate source. We understand that this does not reveal your private rate configuration and does not give us permission to use the public checkout as a production API. We also understand that Despatch Cloud appears in your published privacy information as an order-data processor; we are not asking to reuse any credential or assume that it is your rating engine.

Could you please advise which supported dealer integration route, if any, Tegiwa can approve for Projx Racing?

We would appreciate information on the following:

1. A B2B shipping-quote API, approved Shopify delivery-option method, or another documented quote service for dealer/drop-ship orders.
2. Test or sandbox access, authentication method, allowed hosts, rate limits, timeouts and any IP allowlisting requirements.
3. The fields returned with a quote, including quote ID, carrier, service, amount, currency, package count, dispatch estimate, transit estimate, expiry, surcharges and duties/incoterms.
4. Product- or variant-level packaged weight, dimensions, package count, warehouse/origin identifier, and flags for hazardous, ground-only, oversized, freight-only or separate-shipment items.
5. How stock status and preparation time should be interpreted separately from carrier transit time.
6. Permission and commercial rules for shipping directly to a customer in Kuwait, including dealer freight treatment, neutral packing/branding, insurance, partial shipments, returns and warranty handling.
7. A supported order-submission process, test orders, idempotency or duplicate protection, cancellation windows, order acknowledgement and tracking/status updates.
8. Signed webhooks or an approved polling/feed alternative for stock, order status, shipment, tracking, cancellation and return events, including retry and signature-verification documentation.
9. Whether the exact returned dealer/drop-ship freight amount may be displayed to our customer, and whether any handling margin is permitted or required.
10. A small supplier-approved test set covering a light parcel, heavy parcel, multi-package order, restricted/oversized item, unavailable route and mixed-stock order to a Kuwait destination.

Our intended design is fail-closed: if an authorised current rate or verified package/origin data is unavailable, the website will show that shipping confirmation is required and will not invent a charge. Credentials would be stored only in encrypted server-side settings and would never be placed in browser code or a public repository.

If no API is available, we would be grateful for the safest approved alternative, such as a dedicated B2B quote endpoint, structured request/response file, secure portal workflow or documented manual quote process.

Please also let us know the appropriate technical and commercial contacts, any agreement or data-processing terms we should review, and the next steps for obtaining test access.

Kind regards,

Projx Racing
Kuwait
projxracing@gmail.com
