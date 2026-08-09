# ECS catalogue integration status

Status date: 9 August 2026

## Verified outcome

The customer-facing staging ECS collection now contains **3,383 unique products**. This is the duplicate-safe merge of 41 earlier manually reviewed records plus the generated Performance, Exterior, Interior, Drivetrain, Braking and Engine scopes for BMW G87 M2, G80 M3 Competition and G82 M4 Competition. The Engine capture contains 1,260 unique ECS identities, 405 of which merge into an existing reviewed identity and 855 of which are new to the storefront. The Drivetrain capture contains 253 unique raw ECS identities; ES#2019435 is quarantined as an anomalous PDK placement and fully excluded, leaving 252 customer-facing Drivetrain products. The current local audit passes with:

- 3,383 unique ECS identities and storefront handles after duplicate-safe cross-scope merging;
- 12,945 official vehicle/category listing observations across the six generated scopes;
- 4,334 generated customer-facing scope records before cross-scope deduplication;
- 5,052 Engine placement observations from 355 public listing pages, reconciled as 1,727 G80, 1,729 G82 and 1,596 G87 placements;
- 1,260 unique Engine ECS identities, zero quarantined identities, 1,079 checksum-verified supplier images and 181 clearly labelled official ECS placeholders;
- 1,230 Engine products retaining a fixed public USD price observation plus 14 retaining a positive public `Starting at` observation, for 1,244 positive dated supplier price observations in total;
- 30 Engine products remaining in the quotation flow: the 14 configurable `Starting at` records retain their dated reference amount but are quote-only, while 13 conflicting-price records and 3 zero/variable-price records suppress the amount and require `Request price`; the generated report's `requestPriceCount` is therefore 16 because it counts only records without a publishable amount;
- zero Engine supplier-identity conflicts, zero same-category duplicate placements, possible-only vehicle evidence and confirmation-required availability;
- 732 Drivetrain placement observations from 64 public listing pages, reconciled as 244 G80, 248 G82 and 240 G87 placements;
- 253 unique raw Drivetrain ECS identities, one quarantined PDK identity and 252 customer-facing Drivetrain products;
- 232 Drivetrain products with checksum-verified supplier media and 20 with a clearly labelled official ECS placeholder;
- zero Drivetrain price conflicts, zero Drivetrain supplier-identity conflicts, public retail USD observations only and no wholesale or dealer-cost data;
- 822 Braking placement observations from 77 public listing pages, reconciled as 289 G80, 288 G82 and 245 G87 placements;
- 253 unique Braking ECS identities, zero quarantined identities, 216 checksum-verified supplier images and 37 clearly labelled official ECS placeholders;
- all 253 Braking products retaining a public retail USD observation, with zero within-scope price, availability or supplier-identity conflicts;
- 1,958 Interior placement observations reconciled to 678 unique products across 88 non-empty G87/G80/G82 category branches and 180 paginated listing pages;
- 559 of the 678 Interior products with product-specific supplier media and 119 using a visibly labelled supplier-media-unavailable image;
- 373 new Interior media files materialized locally, plus verified reuse of existing Performance and Exterior media;
- all 678 Interior products retaining ECS number, manufacturer part number, canonical source URL and dated supplier availability evidence; 677 retain a positive public USD price observation and one remains Request price;
- 643 of the 782 Exterior products with verified product-specific media;
- 139 Exterior products using a visibly labelled official ECS media-unavailable placeholder;
- all 782 Exterior products retaining a dated public USD price observation, including 5 `Starting at` prices;
- 31 same-day price conflicts in the merged catalogue held at `Request price` instead of exposing an ambiguous amount;
- 436 new Exterior media files materialized locally, plus verified reuse of existing Performance media; and
- possible-only ECS vehicle-category fitment evidence, confirmation-only availability and no claimed live stock.

The local staging storefront matcher returns 2,731 G87 M2, 2,956 G80 M3 and 2,919 G82 M4 records with possible supplier evidence after the generated catalogue and earlier reviewed records are merged. Filtering supports supplier, brand, category/subcategory, USD pricing, confirmation-required availability, saved vehicle, model, chassis, engine and possible fitment. Engine adds an English/Arabic parent plus all 23 exact bilingual child filters, including performance, intake, fuel, electrical, mechanical, cooling, oil service, ignition, turbocharger, software and service categories. The Interior directory retains its exact parent filter plus 32 bilingual child filters. Drivetrain adds an English/Arabic parent filter plus 12 customer-facing bilingual child filters; the quarantined PDK category is absent from customer search, API results and the directory. Braking adds an English/Arabic parent plus 15 exact bilingual child filters. No generated ECS record is exposed as independently verified exact fitment; VIN, vehicle-option and installation confirmation remain required.

## Private ECS discovery queue

The ECS sitemap inventory is retained as private ingestion data only. It is not a product catalogue and is not shown or counted in the customer storefront:

- **1,766,523** ECS sitemap URL observations collected from all 177 product sitemap shards;
- **404,990** exact duplicate observations removed;
- **1,361,533** unique canonical public ECS product-page URLs in 137 checksum-verified manifests;
- each manifest record contains only a canonical URL and discovery metadata; and
- there are zero verified titles, ECS/SKU/MPNs, prices, stock values, images or fitments in those URL-only records.

The earlier preview incorrectly exposed URL-derived cards and added URL counts to the public product total. That path has been removed. The public discovery API now fails closed, normal ECS browsing returns reviewed structured products only, and the UI rejects a stale response containing `url_discovered` records.

Together with the **193,253** Tegiwa catalogue entries, the local staging structured catalogue contains **196,636 products**. The private URL inventory is not included in this total. A URL can become a storefront product only after its commercial and fitment fields are retrieved, validated and published through the normal catalogue pipeline.

## ECS image coverage

All 41 legacy reviewed ECS products retain their approved local media. In the generated G-Series Performance scope, **824 products have verified product-specific media** and **285 use a visibly labelled official ECS placeholder**. In the generated G-Series Exterior scope, **643 products have verified product-specific media** and **139 use the same clearly labelled placeholder**. In the generated G-Series Interior scope, **559 products have verified product-specific media** and **119 use the labelled placeholder** because ECS supplied no retrievable product image. In the customer-facing G-Series Drivetrain scope, **232 products have verified supplier media** and **20 use the labelled official ECS placeholder**. The Braking scope has **216 products with verified supplier media** and **37 with the labelled official ECS placeholder**. The Engine scope has **1,079 products with verified supplier media** and **181 with the labelled official ECS placeholder**: 180 listings had no supplier image, and one product's WebP and JPG supplier URLs consistently returned HTTP 403 after bounded retries. Engine materialized 734 new checksum-verified supplier mappings and reused 309 existing mappings. Supplier watermarks and attribution are preserved.

Completing ECS image coverage requires an authorised ECS number, manufacturer part number or canonical URL to image mapping. Imported media must be validated, checksummed, deduplicated, kept with its supplier attribution or watermark intact, mirrored to approved object storage and reviewed before publication. Search thumbnails, guessed images and watermark removal are not acceptable substitutes.

Search and vehicle/product filters apply only to reviewed or supplier-fed product data. URL tokens are never used as product facts.

## Featured reviewed BMW M selections

This 26-product batch was manually reviewed on 6 August 2026 from ECS vehicle-category relevance and editorial placement for BMW M3/M4 F80, F82, G80 and G82 applications. ECS does not publish unit-sales counts or a verifiable bestseller ranking, so the storefront labels these as **featured reviewed selections**, not proven best sellers. All fitments remain possible-only and all stock phrases are dated observations requiring supplier confirmation.

| ECS part number | Manufacturer MPN | Product | Brand | Public USD price | Supplier observation on 6 August 2026 |
|---|---|---|---|---:|---|
| ES#4716362 | EVE-G8XMV2-CF-IN | Eventuri G8X Carbon Intake System V2 — Gloss | Eventuri | 2995.00 | In stock when checked — dispatch timing requires confirmation |
| ES#4642623 | D760-0063 | Dinan G8X Carbon Fiber Cold-Air Intake — Gloss | Dinan | 1664.96 | In stock — estimated dispatch today when checked |
| ES#4642560 | 013859LA10 | Turner G80/G82 Carbon Cold-Air Intake | Turner Motorsport | 1981.70 | In stock — estimated dispatch today when checked |
| ES#4465353 | BW-S5801 | MST S58 Cold-Air Intake — G80/G82 M3/M4 | MST Performance | 767.99 | Back ordered — no ETA when checked |
| ES#4658164 | 008621LA01 | Turner G80/G82 Stainless Valved Cat-Back Exhaust | Turner Motorsport | 1137.49 | Selected configuration in stock — estimated dispatch today when checked |
| ES#4361903 | 253200EB | KW H.A.S. Height-Adjustable Spring Kit — G80/G82 | KW Suspension | 1284.00 | Ships directly from supplier — estimated 5 business days when checked |
| ES#4726451 | CTS-LS-015 | CTS Turbo Lowering Springs — G82 M4 | CTS Turbo | 299.99 | Ships directly from supplier — estimated 7 business days when checked |
| ES#4726444 | CTS-LS-014 | CTS Turbo Lowering Springs — G80 M3 | CTS Turbo | 254.99 | Ships directly from supplier — estimated 7 business days when checked |
| ES#4430972 | 50496-77 | H&R Super Sport Springs — G80 M3 | H&R | 509.15 | In stock when checked — dispatch timing requires confirmation |
| ES#4375774 | 008771LA01-01 | Turner Aluminum Skid Plate — G80/G82 | Turner Motorsport | 866.99 | In stock — estimated dispatch today when checked |
| ES#4642692 | 008686LA01KT | Turner Carbon Fiber Front Lip — G80/G82 | Turner Motorsport | 893.34 | In stock when checked — dispatch timing requires confirmation |
| ES#4391015 | 013800LA01 | Turner Carbon Fiber Strut Brace — G80/G82 | Turner Motorsport | 1138.99 | In stock — estimated dispatch today when checked |
| ES#4642935 | 8221 | CSF Automatic Transmission Oil Cooler — G80/G82 | CSF Cooling | 599.00 | In stock — estimated 1 business day when checked |
| ES#4773018 | D650-0009KT2 | Dinan S58 Performance Ignition Coils — Red, Set of Six | Dinan | 233.99 | In stock — estimated dispatch today when checked |
| ES#3006162 | 002411ECSKT18 | ECS 12.5mm Wheel Spacer and Extended Bolt Kit | ECS Tuning | 153.70 | In stock — estimated dispatch today when checked |
| ES#4751482 | 008686LA01EBKT | G80 M3 Carbon Front Lip and High-Kick Spoiler Bundle | Enthusiast Bundles | 1399.00 | In stock when checked — dispatch timing requires confirmation |
| ES#4877104 | 055023LA02 | F8X S55 Luft-Technik Performance Intake System | ECS Tuning | 442.79 | In stock — estimated ship date in 3 business days when checked |
| ES#3984876 | 10801050 | VRSF S55 Charge Pipe Upgrade Kit | VRSF | 299.99 | In stock — estimated to ship today when checked |
| ES#4213325 | F8XDCTSKKT3 | F8X Ultimate DCT Transmission Service Kit | Assembled by ECS | 771.02 | On order — estimated ship date in 3 business days when checked |
| ES#4630139 | MAD-2050 | MAD S55 Catted Downpipes with Flex Sections | MAD | 569.00 | Available from supplier — estimated to ship in 6 business days when checked |
| ES#4674312 | 049453LA01-02 | Turner S55 Crank Seal Guard | Turner Motorsport | 99.99 | In stock — estimated to ship today when checked |
| ES#4690610 | D401-0042 | Dinan S55 High-Flow Drop-in Air Filter | Dinan | 86.30 | In stock — estimated to ship today when checked |
| ES#4745170 | 34112284809SKT | F8X Front and Rear Performance Brake Service Kit | Assembled by ECS | 1396.74 | In stock — estimated to ship today when checked |
| ES#4669181 | 34112284809-X | F8X Front V5 Drilled Brake Rotors — 380×30 mm Set | ECS Tuning | 467.38 | In stock — estimated to ship today when checked |
| ES#3006376 | 010025ECS02AKT | F8X Exact-Fit Stainless-Steel Brake Lines — Complete Kit | ECS Tuning | 190.79 | In stock — estimated to ship today when checked |
| ES#3508709 | JB4-S55 | Burger Motorsports S55 JB4 Tuning Module | Burger Motorsports | 599.00 | In stock — estimated to ship today when checked |


## Reviewed products

| ECS part number | Manufacturer MPN | Product | Brand | Category | Public USD price* | Structured year evidence |
|---|---|---|---|---|---:|---|
| ES#3987599 | 8131 | High Performance Heat Exchanger — Polished | CSF Cooling | Cooling / Heat Exchanger | 695.00 | Not supplied |
| ES#4905994 | 7089 | High-Performance Aluminum Radiator — Gen 1 B58 | CSF Cooling | Cooling / Radiator | 649.00 | Not supplied |
| ES#4642591 | VRSFFMI16 | VRSF B48/B46/B58 Front Mount Intercooler Upgrade | VRSF | Cooling / Front-Mount Intercooler | 449.99 | Not supplied |
| ES#4736753 | PR01000S55 | S55 Pro-Series Turbo Build Kit — Level 2 (1000 HP) | 5150 Autosport | Engine Build / Forged Internals | 6,299.99 | Not supplied |
| ES#4657797 | 8233 | S58 Charge Air Cooler Manifold — Raw Finish | CSF Cooling | Intake / Charge-Air Cooler Manifold | 6,599.00 | Not supplied |
| ES#3569215 | 025496ECS01KT | Audi B8.5 S4/S5 Luft-Technik Performance Supercharger Intercooler Kit | ECS Tuning | Cooling / Supercharger Intercooler Kit | 726.39 | Not supplied |
| ES#4447343 | VWR652000-RED | RacingLine Stage 2 EVO Monoblock Big Brake Kit — Red, 345mm | RacingLine | Braking / Big Brake Kit | 2,655.00 | Not supplied |
| ES#4045787 | 003929LB01 | MK7/MK8/8V Adjustable Damping Coilover System | ECS Tuning | Suspension / Coilovers | 779.99 | Not supplied |
| ES#4141464 | POR0100010-PDK | Porsche 718 Stage 1 Power Package with PDK Flashing | COBB Tuning | Software / ECU & TCU Tuning Hardware | 2,600.00 | 2017–2024 |
| ES#4858335 | 987.10.00.750 | High-Flow Catted Downpipe — Porsche 718 | Racing Dynamics | Exhaust / High-Flow Catted Downpipe | 1,395.00 | 2017–2021 |
| ES#3639608 | 034-102-1000 | 034Motorsport Supercharger Heat Exchanger Upgrade Kit | 034Motorsport | Cooling / Supercharger Heat Exchanger | 1,288.00 | Not supplied |
| ES#4872489 | J-27 | BR Series Coilover Suspension Kit — Mercedes-AMG C63 S Coupe | BC Racing | Suspension / Coilovers | 1,195.00 | 2017–2021 |
| ES#5375145 | 01-177-022XXX | Weistec M177 Upgraded Intake Manifolds — W205 C63 AMG | Weistec | Engine / Intake Manifolds | 3,499.00 | Not supplied |
| ES#4814055 | BBCAIS002 | Mercedes-AMG E63 / GT63 M177 Cold Air Intake System — Gen 2 | BlackBoost | Intake / Cold-Air Intake | 1,799.00 | Not supplied |
| ES#4877039 | 034-105-D300 | 034Motorsport 55mm Exhaust Clamp | 034Motorsport | Exhaust / Clamps & Hardware | 33.00 | 2010–2026 |

\* Public ECS USD retail observations checked 4 or 6 August 2026. They are not Projx selling prices and exclude confirmed shipping, customs and Kuwait delivery.

## Data still missing

The generated G-Series scopes still have controlled supplier-data gaps. For the Engine scope specifically:

- detailed supplier description is missing for 60 products;
- manufacturer brand is missing for 7 products;
- product-specific media is unavailable for 181 products, which use the labelled supplier placeholder;
- 14 configurable products retain a positive public `Starting at` observation but remain quote-only;
- 13 products have conflicting bounded public-price observations and are held at `Request price`;
- 3 additional zero/variable-price records require price confirmation;
- independently verified exact vehicle/VIN/options fitment is unavailable for all generated Engine products;
- Projx Racing selling prices are not yet approved; and
- ECS does not provide a live stock feed, so dated availability phrases remain confirmation-only.

For Drivetrain specifically, seven customer-facing products have no detailed supplier description and 20 have no product-specific supplier image, so the latter use the labelled official ECS placeholder. All 252 customer-facing Drivetrain products retain a public retail USD observation in the bounded source capture, and none has a within-scope price or supplier-identity conflict. The quarantined PDK record is evidence only and is not counted or returned as a customer product.

For Braking specifically, 15 products have no detailed supplier description and 37 have no product-specific supplier image, so the latter use the labelled official ECS placeholder. All 253 Braking products retain an ECS number, manufacturer part number, canonical product URL, public retail USD observation and dated supplier availability phrase. The API still returns confirmation-required availability and possible-only fitment for every Braking product.

Supplier availability phrases and public prices are dated scope observations, most recently including the 9 August 2026 Drivetrain and Braking captures. The API deliberately requires confirmation and does not publish them as guaranteed live stock, delivery times or final Projx selling prices.

## Permission and completion blocker

Projx Racing now has a written ECS approval dated 5 August 2026 for automated copying of ECS products onto the Projx website. The retained evidence and reviewed authorization record are private and excluded from Git. This supersedes the earlier manual-copy-only interpretation.

The approval does not provide an API, approved downloadable export, stock feed or request-rate agreement. ECS publishes a sitemap index with product shards, and all 177 product sitemap shards were collected successfully; however, normal automated requests to the individual product pages encounter an interactive Cloudflare challenge and the project must not bypass that control. The approval also does not authorize copying authenticated dealer data, publishing private dealer cost, credentials, removing watermarks or representing dated observations as live stock.

On 5 August 2026, ECS Wholesale advised by email that a private FTP file may be possible, containing ES numbers, manufacturer numbers, product descriptions, dealer cost, retail prices, weights and dimensions. ECS has not yet approved or delivered that feed; access is normally reserved for established high-volume customers. Dealer cost must remain private even if supplied. Completing the entire ECS catalogue therefore still requires:

1. approval and credentials for the proposed ECS FTP export, or another complete authorized product source;
2. an agreed collection rate and confirmation of public image/media reuse terms;
3. a streaming, sharded importer and online storage sized for more than two million products; and
4. staged count, duplicate, fitment, price, search and load validation before publication.

The current automated-access workflow may fetch only explicitly allowlisted public ECS product URLs while the private authorization gate remains valid. The completed Performance, Exterior, Interior, Drivetrain, Braking and Engine vehicle-category scopes are bounded staging collections, not the complete ECS catalogue. The workflow checkpoints and resumes bounded batches, rejects private/sensitive fields, deduplicates by ECS number and URL, and creates a non-publishing review queue. It must not traverse login areas, bypass Cloudflare or other controls, or claim the full supplier catalogue is complete until a complete source has been collected and verified.

At the current minimum two-second request interval, two million individual page requests would require about 46 days of uninterrupted collection before retries or review. The existing single-file workflow and current free Neon project are not sized for that run. The measured database footprint projects to roughly 9 GB for one sparse two-million-product snapshot and more than 18 GB during atomic blue/green publication, before detailed fitment, variants or media.

## Verification commands

```text
node scripts/ecs-catalog/audit-reviewed.mjs --output private-imports/ecs-catalog-review/reviewed-audit.json
node --test scripts/ecs-catalog/test.mjs
node scripts/test-parts-catalog-api.mjs
```

The tests are offline and do not contact ECS Tuning.
