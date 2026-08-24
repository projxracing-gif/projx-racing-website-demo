# ECS F8X aggregate normalization

`scripts/ecs-catalog/prepare-f8x-aggregate.mjs` is a private, offline normalizer for the ECS F80 M3, F82 M4 and F83 M4 capture set. It does not browse ECS, publish catalogue data or modify a runtime shard.

## Required capture matrix

The normalizer fails closed unless it receives all 21 vehicle/section captures: each of these three exact ECS vehicle profiles across Braking, Engine, Exterior, Interior, Suspension, Steering and Performance.

| Vehicle key | Exact capture vehicle | Exact ECS root | Artifact prefix |
| --- | --- | --- | --- |
| `f80-m3` | `BMW F80 M3 S55 3.0L` | `https://www.ecstuning.com/BMW-F80-M3-S55_3.0L/` | `bmw-f80-m3` |
| `f82-m4` | `BMW F82 M4 S55 3.0L` | `https://www.ecstuning.com/BMW-F82-M4-S55_3.0L/` | `bmw-f82-m4` |
| `f83-m4` | `BMW F83 M4 S55 3.0L` | `https://www.ecstuning.com/BMW-F83-M4-S55_3.0L/` | `bmw-f83-m4` |

A generic `BMW M3` capture is rejected. It is never relabelled as F80, F82 or F83 evidence.

## Input contract

Pass exactly 21 `*-records.json` paths with repeated `--input` arguments. For every records file, the script reads the matching sibling files produced by the capture workflow:

- `*-manifest.json`
- `*-reconciliation-report.json`

The capture, manifest and report must agree on their kind, timestamp, vehicle, section, exact profile root, section route, categories, page counts, placement counts and identity totals. Both the manifest and reconciliation report must say the scope is complete. Required listing fields, category pages and positions must reconcile exactly, and the capture safeguards must show that no challenge bypass or guessed routes were used.

## Run it privately

The output directory must already exist. A repository-local directory is accepted only below the ignored `private-imports/` tree. An existing absolute directory outside the repository is also accepted. Output files are create-only and are never overwritten.

Example in PowerShell after all 21 capture bundles are complete:

```powershell
$records = Get-ChildItem private-imports/ecs-f8x-m3-m4-20260820 -Recurse -Filter 'bmw-f*-records.json'
if ($records.Count -ne 21) { throw "Expected 21 records files; found $($records.Count)." }
$normalizerArgs = foreach ($record in $records) { '--input'; $record.FullName }
& node scripts/ecs-catalog/prepare-f8x-aggregate.mjs @normalizerArgs `
  --work-dir private-imports/ecs-f8x-m3-m4-20260820/aggregate
```

The default private outputs are:

- `f8x-aggregate-products.mjs`
- `f8x-aggregate-audit.json`

Use `--output-name` and `--report-name` only to choose different safe filenames in the same work directory. The script does not accept an arbitrary output path.

## Normalization policy

- Products are deduplicated by validated ECS `ES#` identity.
- Every retained source observation keeps its vehicle key and label, section, category key and label, source URL, relevance position and observation timestamp.
- Structured fitment is emitted only as `possible`: F80 maps to BMW M3/F80/S55, F82 maps to BMW M4/F82/S55, and F83 maps to BMW M4/F83/S55.
- Model years, trims, options and drivetrains remain empty. They are not inferred from the profile route.
- A positive starting price remains quote-only and requires variant confirmation.
- Any captured zero price, including a `$0.00` starting price, is converted to request-price and never becomes a selling price.
- Shipping, customs, Kuwait delivery, current availability and exact fitment all remain confirmation-required.
- An ECS identity is quarantined when its observations disagree on normalized manufacturer part number, canonical product URL or same-day public price.
- Identities are also quarantined when multiple ECS identities share the same normalized manufacturer part number or canonical product URL.

The audit records the 21 validated scopes, observation and product totals, price safeguards and full quarantine reasons. For every raw record it also derives the canonical tuple `[vehicle, section, categoryKey, page, position, ecsPartNumber]`. Each capture entry carries its tuple count and SHA-256, while `placementIdentityEvidence` carries all 21 per-scope digests and one whole-matrix digest. A same-count ES substitution or position swap therefore changes the audit evidence even when all page and product totals remain unchanged. The final-release gate reopens all 21 records/manifest/report sibling bundles, reruns this normalizer and requires exact audit, product, quarantine and placement-digest equality. Ordering in both the audit and generated module is deterministic for the same input documents.

## Verification

Run the focused test directly; the repository package scripts are intentionally unchanged:

```powershell
node --test scripts/ecs-catalog/prepare-f8x-aggregate.test.mjs
```

Passing normalization does not authorize publication. A separate reviewed release step must decide whether and how a private aggregate enters the website catalogue.
