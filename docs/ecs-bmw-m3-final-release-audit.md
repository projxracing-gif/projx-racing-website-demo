# BMW M3 final-release audit gate

`scripts/ecs-catalog/finalize-bmw-m3-release-audit.mjs` is the offline gate between the seven-section aggregate importer and the reviewed-product shard builder. The gate itself does not capture pages, publish Blob objects, call Vercel APIs, or edit an existing audit. To calculate the existing reviewed-catalogue union, it evaluates only the exact trusted repository module at `server/ecs-reviewed-catalog.js`; alternate entry modules are rejected, and its discovered dependency graph is restricted to local repository files with dynamic, comment-separated, and external imports rejected. Built-in imports are also rejected except for the exact existing `node:fs` and `node:url` dependencies of `server/ecs-confirmation-cart-index.js` and the exact `node:crypto` dependency of `server/ecs-confirmation-cart-sellability.js`; both files remain checksum-bound as part of the trusted graph. This exact repository module is an intentional reviewed-code trust boundary, not a sandbox for arbitrary JavaScript, so its worktree diff must be reviewed before running the gate.

The gate accepts:

- the unfinalized JSON audit written by `prepare-bmw-m3-aggregate.mjs`;
- the exact deterministic generated aggregate product module; this input is parsed as two canonical `Object.freeze(JSON array)` exports and is never executed;
- the exact trusted current reviewed ECS module at `server/ecs-reviewed-catalog.js` (an alternate repository or work-directory module is rejected); and
- optionally, the directory of the current reviewed shard release, supplied with `--current-reviewed-shards`; and
- exactly one reconciliation report for each of Braking, Engine, Exterior, Interior, Performance, Suspension, and Steering.

It verifies exact pages, placements, categories, required fields, product scopes, product/quarantine counts, current-catalogue overlap, public-retail safeguards, and every input checksum. Pagination is fail-closed: expected pages must equal `ceil(category count / 16)`, every non-final page must contain 16 placements, the final page must contain the exact 1–16 remainder, page 1 must equal the category source URL, later pages must use the exact `/2`, `/3`, and subsequent numeric suffix in order, every page URL must be unique within its category, and no page URL may be reused by another category. Aggregate products must use their exact `ecs-es-<identity>` public key and `es-<identity>` slug, and aggregate quarantine entries must be unique digit-only ECS identities so the audit and runtime apply identical removal semantics. Each section's reported unique-product count must also equal the union of generated product identities observed in that section and quarantined identities carrying known section-set evidence. Quarantine record indexes are checked for range, uniqueness, and cardinality consistency with that section set; the audit does not claim an unavailable per-index-to-section mapping. It then computes `captureProgress` and `publicationMergeAudit` from those actual inputs.

When `--current-reviewed-shards` is present, the gate checksum-validates the manifest, routing index, every shard, route-to-product positions, canonical ECS identities, and the complete artifact-set hash. Publication overlap and projected counts then use the real runtime union of the static catalogue and current shards. An incoming quarantine may not overlap any currently published static or sharded identity, and the projected union must retain every current runtime identity; either condition fails the audit instead of subtracting products silently. A complete result remains impossible unless all seven reports reconcile.

## Safe output rules

The output is create-only. It must be in the repository's ignored `private-imports/` directory or in an existing, absolute `--work-dir` outside the repository. The tool rejects path escapes, symlink escapes, drive roots, existing output files, changed inputs, and a checksum that differs from the prior verification pass.

Do not write the finalized audit into `docs/`, `api/data/`, or another tracked/runtime directory. Do not build final shards from a temporary partial audit.

## Two-pass usage

First, complete all seven captures and run the aggregate importer. Then choose a new private work directory. This example assumes the generated audit and product module are in that directory and the reconciliation reports remain in the ignored capture directory.

```powershell
$capture = Resolve-Path 'private-imports\ecs-bmw-m3-20260809'
$work = 'D:\Projx-Racing-Website-Data\ecs-bmw-m3-complete-20260810'
$audit = Join-Path $work 'ecs-bmw-m3-aggregate-audit.json'
$products = Join-Path $work 'ecs-bmw-m3-aggregate-products.js'
$current = Resolve-Path 'server\ecs-reviewed-catalog.js'
$currentShards = Resolve-Path 'api\data\ecs-bmw-m3-reviewed'

node scripts/ecs-catalog/finalize-bmw-m3-release-audit.mjs `
  --verify-only `
  --work-dir $work `
  --audit $audit `
  --aggregate-module $products `
  --current-reviewed-module $current `
  --current-reviewed-shards $currentShards `
  --reconciliation (Join-Path $capture 'braking\bmw-m3-braking-reconciliation-report.json') `
  --reconciliation (Join-Path $capture 'engine\bmw-m3-engine-reconciliation-report.json') `
  --reconciliation (Join-Path $capture 'exterior\bmw-m3-exterior-reconciliation-report.json') `
  --reconciliation (Join-Path $capture 'interior\bmw-m3-interior-reconciliation-report.json') `
  --reconciliation (Join-Path $capture 'performance\bmw-m3-performance-reconciliation-report.json') `
  --reconciliation (Join-Path $capture 'suspension\bmw-m3-suspension-reconciliation-report.json') `
  --reconciliation (Join-Path $capture 'steering\bmw-m3-steering-reconciliation-report.json')
```

The verification result prints `inputSetSha256` and does not write a file. Review the counts, retain that checksum, and immediately run the create-only pass against the same inputs:

```powershell
$inputSetSha256 = '<the lowercase 64-character checksum from verify-only>'
$finalAudit = Join-Path $work 'ecs-bmw-m3-final-release-audit.json'

node scripts/ecs-catalog/finalize-bmw-m3-release-audit.mjs `
  --work-dir $work `
  --expect-input-set-sha256 $inputSetSha256 `
  --output $finalAudit `
  --audit $audit `
  --aggregate-module $products `
  --current-reviewed-module $current `
  --current-reviewed-shards $currentShards `
  --reconciliation (Join-Path $capture 'braking\bmw-m3-braking-reconciliation-report.json') `
  --reconciliation (Join-Path $capture 'engine\bmw-m3-engine-reconciliation-report.json') `
  --reconciliation (Join-Path $capture 'exterior\bmw-m3-exterior-reconciliation-report.json') `
  --reconciliation (Join-Path $capture 'interior\bmw-m3-interior-reconciliation-report.json') `
  --reconciliation (Join-Path $capture 'performance\bmw-m3-performance-reconciliation-report.json') `
  --reconciliation (Join-Path $capture 'suspension\bmw-m3-suspension-reconciliation-report.json') `
  --reconciliation (Join-Path $capture 'steering\bmw-m3-steering-reconciliation-report.json')
```

Use the create-only output as the `--audit` input for `build-reviewed-product-shards.mjs`. Always use a new private shard output directory.

```powershell
node scripts/ecs-catalog/build-reviewed-product-shards.mjs `
  --input-dir $currentShards `
  --overlay-module $products `
  --audit $finalAudit `
  --output-dir (Join-Path $work 'reviewed-release-final')
```

If any source changes after verification, repeat `--verify-only` and investigate the new checksum. Never copy the old checksum forward merely to make the write pass.

## Focused test

```powershell
node --test scripts/ecs-catalog/finalize-bmw-m3-release-audit.test.mjs
```
