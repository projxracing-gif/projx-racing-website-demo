# Unified Parts Catalogue UI adapter

Status: implementation map for the first Neon-backed catalogue release. This note is based on `assets/app.js` at commit `6660a33` and the `/api/parts-catalog` contract being implemented alongside it.

## Outcome and release boundary

The Parts page must have one search form, one filter state, one result count, one results grid, one pagination control and one product modal. Tegiwa, ECS Tuning and Projx Racing quote packages are records in that same result set. The existing `/api/tegiwa-catalog` endpoint remains a one-release availability fallback only; it is not a second visible catalogue.

The primary flow is:

1. `GET /api/parts-catalog` returns all published suppliers and Projx packages from Neon.
2. The client renders every result through one supplier-neutral card renderer.
3. A saved vehicle is sent as structured year/make/model/generation/engine fields, not reduced to a make/model keyword.
4. Product clicks open the current modal pattern using a globally unique opaque product handle in `?product=`.
5. Only when the unified endpoint is missing or reports `service_unconfigured` does the same UI request `/api/tegiwa-catalog` and show a small temporary-availability notice. It must not restore the separate reviewed-products grid.

## Required API shape

The adapter consumes the following already-agreed contract:

- Request: `q`, `handle`, `page`, `cursor`, `suggest=1`, `sort`, `availability`, `pricing`, `match`, `supplier`, `brand`, `partType`, `currency`, `fitment`, `year`, `make`, `model`, `generation`, `engine`.
- Browse/search: `{ mode, items, meta, nextCursor }`, with `meta.pageSize` fixed at 100 and `meta` carrying totals, filters, suppliers and currencies.
- Card: existing Tegiwa fields plus `supplier: { slug, name }`, `publicKey`, `mpn` and `fitmentConfidence: "exact" | "possible" | null`.
- Detail: the same card fields plus `description`, `images`, `variants` and `fitments`.
- Suggest: the current suggestion/correction shape, with a supplier on each suggestion where available.
- Unconfigured primary service: HTTP 503 with `{ error: { code: "service_unconfigured", message } }`.

The API contract guarantees that `card.handle` equals the supplier-qualified `publicKey` (for example `tegiwa-product-slug` or `ecs-product-slug`), is globally unique, fits the existing 255-character validation and is the value accepted by detail `handle=`. Use that exact value in `?product=`. Never use an unqualified `sourceHandle`; any server-side source-handle lookup exists only for legacy compatibility.

## Data prerequisite: no client-side catalogue splice

Seed the currently reviewed `DATA.storeProducts` and `DATA.parts` records into Neon before removing their grid:

- `DATA.storeProducts`: preserve supplier, SKU/MPN/ECS number, original currency, checked dates, local authorised image, source URL and fitment evidence. `supplier-title-confirm` becomes `possible`; only independently verified fitment becomes `exact`.
- `DATA.parts`: use supplier `projx-racing`, `item_type = package`, request-price/no-price offer, and `possible` fitment unless an exact reviewed application exists. `universal-confirm` remains a visible “Universal / confirm fitment” note and must not be presented as exact.
- Preserve existing static `/parts/<slug>/` pages for bookmarks and SEO during this release. Catalogue cards should still use the modal URL selected for the new catalogue.

Do not inject these local arrays into page 1 in JavaScript. That would corrupt server totals, sorting and pagination and could duplicate a product once its Neon import is present.

## Smallest safe `assets/app.js` change map

The internal `tegiwa*` names may remain for one release to keep the diff small, but all user-visible text and all network access must be supplier-neutral. Renaming can be a later mechanical cleanup.

### 1. Constants and state (current lines 7-12 and 106-123)

- Add primary and fallback endpoint constants:
  - `PARTS_CATALOG_ENDPOINT = "/api/parts-catalog/"`
  - `PARTS_CATALOG_FALLBACK_ENDPOINT = "/api/tegiwa-catalog/"`
- Treat the product query parameter as an opaque catalogue handle. Keep the external parameter name `product` for link compatibility.
- Extend catalogue state with `supplier`, `brand`, `partType`, `currency`, `fitment`, `backend` (`"unified"` or `"tegiwa-fallback"`) and `fallbackReason`.
- Keep request cancellation, pagination, suggestion and detail controllers shared; never maintain a second catalogue state object.

### 2. One network adapter (new functions near current `loadTegiwaCatalog`)

Add:

```js
async function fetchPartsCatalogue(params, { signal } = {})
```

It should:

1. Request `/api/parts-catalog/` with the supplied parameters.
2. Return the payload with `{ backend: "unified" }` when the response is valid.
3. Fall back only for HTTP 404/501, HTTP 503 with `error.code === "service_unconfigured"`, or a genuine network-unavailable error.
4. Never fall back for aborts, validation errors (400), authentication errors, rate limits (429), or malformed successful payloads; show the primary error instead so defects are not silently hidden.
5. Strip unsupported unified-only parameters before calling `/api/tegiwa-catalog/`. For a vehicle fallback, pass the existing make/model keyword query and `match=vehicle`.
6. Normalise legacy Tegiwa cards/details by adding `supplier: { slug: "tegiwa", name: "Tegiwa" }`, `publicKey: handle`, and `fitmentConfidence: null`.

Use this adapter from all three request sites:

- suggestions (current `scheduleTegiwaSuggestions`, lines 1992-2018);
- browse/search (current `loadTegiwaCatalog`, lines 2150-2213);
- product detail (current `openTegiwaProduct`, lines 2313-2378).

This ensures search, product clicks and direct modal URLs all use the same release fallback policy.

### 3. Structured request builder

Add one pure function:

```js
function partsCatalogueParams({ query, page, suggest, handle } = {})
```

It must always include the active server-side sort and filters, including on unsearched browse pages. The current implementation only reloads some filters when a text query exists; that restriction must be removed.

When a vehicle is saved, send:

```text
match=vehicle
year=<selected year>
make=<selected make>
model=<selected model>
generation=<selected generation when meaningful>
engine=<selected engine when meaningful>
fitment=all
```

Do not send the sentinel values `supplier-directory` or `confirm-engine` as exact fitment claims. Omit them from structured params. The API may use make/model/title evidence to return a `possible` match.

`fitment=all` means exact and possible matches for the selected vehicle, not unrelated catalogue products. An explicit Exact/Possible filter changes that value to `exact` or `possible`.

### 4. Vehicle workflow (current lines 1669-1737)

- Keep `partsVehicleCatalogueQuery()` only for the old-endpoint fallback.
- Change `savePartsVehicle()` to call the unified loader with structured vehicle fields; do not place the make/model text in `q` unless the user had typed a separate search.
- `clear-parts-vehicle` must clear all five structured fields and `fitment`, then reload the same unified grid.
- `partsCatalogueDirectory()` and brand shortcuts must preserve the saved vehicle fields. Selecting a part type or brand narrows the same result set instead of replacing the vehicle match with a standalone keyword search.
- Keep the selector’s current static directory for this release, but treat it only as a selection vocabulary. The database’s product fitments are the authority for returned matches.

### 5. One generic price, availability and card renderer (current lines 1796-1854)

Replace the hard-coded GBP formatter with:

```js
function cataloguePriceLabel(price = {})
```

- Validate the three-letter `price.currency`.
- Format the value in that exact currency with no conversion: Tegiwa GBP, ECS USD; a Projx request-price package has no numeric price.
- Include an unambiguous currency code in the visible value (for example `GBP 112.50` / `USD 135.00`) so `$` is not mistaken for another dollar currency.
- Never show dealer/trade cost, tax additions or an automatic VAT adjustment.

Generalise availability labels for every API value (`in_stock`, `supplier_stock`, `available_to_order`, `backorder`, `out_of_stock`, `discontinued`, `unknown`) without claiming that supplier stock is physically at Projx Racing.

Convert `tegiwaProductCard(item)` into a supplier-neutral renderer (the CSS class may remain temporarily). It must show:

- product/category title;
- supplier name separately from brand/vendor;
- SKU or MPN when supplied;
- price in the offer’s original currency or Request price;
- supplier availability/lead time and checked date;
- `Exact match` or `Possible match — confirm before order` only when a saved vehicle produced that confidence;
- one modal link using the global handle and one quote button.

The quote ID must include the global public key, not only the source slug, so an ECS/Tegiwa collision cannot merge cart entries.

### 6. Modal and URL handling (current lines 598-657 and 2313-2397)

- Keep the public URL form `/en/parts/?product=<opaque-handle>` and its Arabic equivalent.
- Validate the opaque handle without assuming it is a Tegiwa source handle. The server remains the final authority.
- Fetch detail through `fetchPartsCatalogue({ handle })`.
- Render supplier and brand as separate facts; format every variant using its returned currency; show exact/possible fitment and any qualification note.
- Use the returned supplier name in the quote kind/details and label the external button “Original supplier listing.” Hide it when `sourceUrl` is absent (for example, a Projx package).
- Language switching must preserve the handle. Back/forward must open/close the modal without reloading the page.

### 7. Search, suggestions, filters and directory (current lines 1868-2240 and 2399-2415)

- Search and spell suggestions call the unified adapter.
- Add server-side supplier, brand, currency and fitment controls to the existing collapsible filter panel. Populate supplier/currency options from `meta`; use stable slugs as values.
- Directory buttons set `partType` for the primary endpoint. They may retain the human-readable `q` only as the fallback translation.
- Brand tiles set `brand=<slug>` and call the same loader. Remove static item counts because they are not full-catalogue counts.
- Every filter change reloads page 1, even when `q` is empty.
- “Browse catalogue” clears query and all catalogue filters but should not silently delete the user’s saved vehicle; provide the existing explicit Clear vehicle action for that.

### 8. Parts page markup (current `partsPage`, lines 2418-2498)

Remove the whole `store-catalogue-review` block and its client-only filter bar/grid (current lines 2486-2495). Do not render `productCard()` and `partCard()` on the listing page.

Keep:

- vehicle selector;
- Part Type Directory accordion;
- curated brand shortcuts (without false static counts);
- one supplier-neutral catalogue header, controls, status, grid and pagination;
- one compatibility disclaimer.

Change the hard-coded `193,253` and `26,349` initial stats to placeholders/skeletons. Only `meta.catalogProductCount` and `meta.availableProductCount` may publish totals after Neon is live.

Change the source note so it is true for mixed suppliers: prices remain in the supplier’s listed original currency; availability and fitment are checked before order; shipping and Kuwait duties are confirmed in the quotation. Do not claim that every record is GBP or follows one supplier’s VAT basis.

### 9. Old static filters and routes

- `applyFilter()`, `sortPartsGrid()`, `updatePartsFilterState()`, `selectPartsFilter()` and `clearPartsFilters()` should no longer be used for the Parts catalogue. They can remain for other local page grids during the first release.
- Keep `packageDetailPage()` and `storeProductDetailPage()` routing for existing `/parts/<slug>/` links, but stop creating a second listing from those arrays.

## Failure behavior

When the primary endpoint is temporarily unconfigured:

- the exact same grid switches to the old Tegiwa endpoint;
- a non-alarming notice explains that the complete multi-supplier catalogue is temporarily unavailable and that the currently displayed records are the supplier fallback;
- no ECS or Projx record is fabricated or appended client-side;
- all visible fallback cards and Tegiwa modal URLs remain functional;
- the client records the fallback only in state/markup, not with noisy console errors.

The fallback should be removed after one stable release and an observed period with successful primary requests.

## Acceptance tests

### API/adapter

1. Browse page 1 returns 100 records and one total/page count from `/api/parts-catalog`; page 2 contains no page-1 duplicates.
2. A search that matches Tegiwa and ECS returns both suppliers in one `items` array, one `totalResults`, one sorting order and one pagination sequence.
3. The same source slug under two suppliers produces distinct global handles, modal URLs and quote IDs.
4. Supplier, brand, part type, availability, pricing and currency filters work with an empty text query as well as with a search query.
5. Tegiwa prices render in GBP and ECS prices in USD, unchanged from API numeric values. Request-price packages show no fabricated numeric price. No dealer price or VAT uplift appears.
6. A 400, 429 or malformed primary response is shown as an error and does not call the fallback.
7. A 503 `service_unconfigured` primary response calls the legacy endpoint once and renders it in the same grid with a fallback notice.
8. Aborting an old request during fast typing neither triggers fallback nor overwrites the newest response.

### Vehicle fitment

9. Saving a vehicle sends all selected structured fields to `/api/parts-catalog`; it does not reduce the request to `q=<make model>`.
10. A known exact application is labelled Exact match; a title/supplier-directory candidate is labelled Possible match; an unrelated product is absent.
11. The year boundary is enforced (`year_from <= year <= year_to`). Generation and engine sentinels are never treated as exact values.
12. Selecting a part type or brand after saving a vehicle retains the vehicle match. Clearing the vehicle retains the user’s explicit product query and other filters.
13. English and Arabic show equivalent exact/possible warnings, and the Arabic card/modal remains correctly RTL while SKU/currency values remain readable LTR.

### UI and navigation

14. The Parts page DOM contains exactly one catalogue result grid and exactly one catalogue pagination region; `store-catalogue-review` and `data-filter-grid="parts"` are absent.
15. Product search, Part Type Directory, brand shortcuts and vehicle selector all update that same grid and status count.
16. Every visible card opens a modal at `?product=<global-handle>`. Direct loading, refresh, language switch, back and forward preserve the expected modal state.
17. The modal shows supplier, brand, SKU/MPN, original-currency price, availability, checked date and fitment confidence; the source link is present only when authorised `sourceUrl` exists.
18. Desktop and iPhone-class widths have no horizontal overflow; focus moves into the modal and returns to its opener; pagination and filter controls are keyboard operable.
19. English/Arabic, light/dark and 404/direct-route checks complete without uncaught console errors or failed visible assets.

## Recommended implementation order

1. Finish and test `/api/parts-catalog` plus global handle semantics.
2. Import Tegiwa and seed the reviewed ECS/Projx records into Neon.
3. Add the client network/normalisation adapter and generic card/modal formatting.
4. Wire structured vehicle and server-side filters.
5. Remove the duplicate static listing markup.
6. Run API tests, full production checks, browser verification and the explicit fallback tests.
