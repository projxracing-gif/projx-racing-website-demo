# ECS catalogue integration status

Status date: 6 August 2026

## Verified outcome

The reviewed collection contains exactly **14 ECS Tuning products**. The catalogue audit passes with:

- 14 unique storefront slugs and global `ecs-...` public handles;
- 14 unique ECS part numbers;
- 14 unique manufacturer MPNs;
- 14 unique canonical ECS product URLs;
- 14 unique local primary-image hashes;
- 14 reviewed public USD supplier prices dated 4 August 2026;
- 14 bilingual titles, summaries and primary-image alternative texts;
- 14 possible-only supplier-title fitment records; and
- 0 exact fitment claims, 0 live-stock claims and 0 duplicate products.

The unified API now exposes the records when the database is unconfigured, unpublished or has not yet seeded ECS. The server merges the 14 reviewed ECS cards ahead of the existing Tegiwa fallback, uses stable global pagination, and returns a `partialCatalogue` marker. Filtering is supported for ECS supplier, brand, category/subcategory, USD pricing, confirmation-required availability, make, model, available chassis/year/engine evidence and possible fitment. Exact-fitment filtering returns no ECS records because none is independently verified.

## Full public ECS reference integration

The preview catalogue also exposes the complete signed public-URL collection inside the normal Parts result grid when ECS is selected:

- **1,766,523** ECS sitemap URL observations collected from all 177 product sitemap shards;
- **404,990** exact duplicate observations removed;
- **1,361,533** unique canonical public ECS product-page URLs in 137 checksum-verified manifests;
- 11 reviewed products replace their matching URL-only records;
- 3 reviewed products absent from the sitemap release are added separately; and
- **1,361,536** duplicate-free ECS catalogue entries in the storefront union.

The integrated ECS view uses 100 entries per numbered page. The 14 reviewed records retain their verified fields. The other **1,361,522** entries remain explicitly labelled URL-derived catalogue references. They provide only a canonical public ECS link, a stable identity, a human-readable URL-derived label, `Request price`, `Availability confirmation required`, an original-page link and an enquiry action. They do not expose or infer a product title, ECS/SKU/MPN, category, price, stock, image, fitment, variation or Add to Cart action.

Search and vehicle/product filters apply only to reviewed or supplier-fed product data. They are disabled while browsing the full URL-reference layer because the sitemap does not contain those facts. This limitation is deliberate and prevents URL tokens from being misrepresented as verified commercial or fitment data.

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

\* Public ECS USD retail observation checked 4 August 2026. It is not a Projx selling price and excludes confirmed shipping, customs and Kuwait delivery.

## Data still missing

These gaps apply to all 14 products unless stated otherwise:

- verified detailed supplier description: missing for 14;
- verified technical specifications: missing for 14;
- verified product options: missing for 14;
- verified variations: missing for 14;
- independently verified exact vehicle fitment: missing for 14;
- drivetrain fitment: missing for 14;
- Projx Racing selling price: missing for 14;
- live supplier stock feed: missing for 14;
- additional approved product gallery images: missing for 14; and
- model-year ranges: present for 3, missing for 11.

The source observations include a manually checked availability phrase for each product, but the API deliberately returns `check_availability`. Supplier dispatch estimates are retained as dated observations only and are not published as guaranteed delivery times.

## Permission and completion blocker

Projx Racing now has a written ECS approval dated 5 August 2026 for automated copying of ECS products onto the Projx website. The retained evidence and reviewed authorization record are private and excluded from Git. This supersedes the earlier manual-copy-only interpretation.

The approval does not provide an API, approved downloadable export, stock feed or request-rate agreement. ECS publishes a sitemap index with product shards, and all 177 product sitemap shards were collected successfully; however, normal automated requests to the individual product pages encounter an interactive Cloudflare challenge and the project must not bypass that control. The approval also does not authorize copying authenticated dealer data, publishing private dealer cost, credentials, removing watermarks or representing dated observations as live stock.

On 5 August 2026, ECS Wholesale advised by email that a private FTP file may be possible, containing ES numbers, manufacturer numbers, product descriptions, dealer cost, retail prices, weights and dimensions. ECS has not yet approved or delivered that feed; access is normally reserved for established high-volume customers. Dealer cost must remain private even if supplied. Completing the entire ECS catalogue therefore still requires:

1. approval and credentials for the proposed ECS FTP export, or another complete authorized product source;
2. an agreed collection rate and confirmation of public image/media reuse terms;
3. a streaming, sharded importer and online storage sized for more than two million products; and
4. staged count, duplicate, fitment, price, search and load validation before publication.

The current automated-access workflow may fetch only explicitly allowlisted public ECS product URLs while the private authorization gate remains valid. It checkpoints and resumes bounded batches, rejects private/sensitive fields, deduplicates by ECS number and URL, and creates a non-publishing review queue. It must not traverse login areas, bypass Cloudflare or other controls, or claim the full supplier catalogue is complete until a complete source has been collected and verified.

At the current minimum two-second request interval, two million individual page requests would require about 46 days of uninterrupted collection before retries or review. The existing single-file workflow and current free Neon project are not sized for that run. The measured database footprint projects to roughly 9 GB for one sparse two-million-product snapshot and more than 18 GB during atomic blue/green publication, before detailed fitment, variants or media.

## Verification commands

```text
node scripts/ecs-catalog/audit-reviewed.mjs --output private-imports/ecs-catalog-review/reviewed-audit.json
node --test scripts/ecs-catalog/test.mjs
node scripts/test-parts-catalog-api.mjs
```

The tests are offline and do not contact ECS Tuning.
