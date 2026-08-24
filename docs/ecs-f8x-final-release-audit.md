# ECS F8X final-release audit gate

`scripts/ecs-catalog/finalize-f8x-release-audit.mjs` is the private, offline gate between the 21-scope F80/F82/F83 normalizer and the reviewed-product union shard builder. It does not capture ECS pages, make network requests, write runtime data, publish Blob objects, call Vercel, or modify an existing release.

## Required inputs

The gate requires all of these inputs in one verification pass:

- the `ecs-f8x-aggregate-import-audit` JSON produced by `prepare-f8x-aggregate.mjs`;
- the deterministic aggregate module produced by that normalizer;
- all 21 reconciliation reports, each beside its exact `*-records.json` and `*-manifest.json` siblings: F80 M3, F82 M4 and F83 M4 across Braking, Engine, Exterior, Interior, Performance, Suspension and Steering;
- a create-only `ecs-reviewed-prior-quarantine` artifact proved from the canonical prior BMW M3 aggregate module and bound to the current shard release;
- that exact canonical prior BMW M3 aggregate module again, so the final gate can reopen it and reject a substituted artifact;
- the exact trusted `server/ecs-reviewed-catalog.js` module and its checksum-bound local dependency graph; and
- the current reviewed shard release directory, including its manifest, routing index and every product shard.

The aggregate module is parsed as canonical inline JSON and is never executed. The current normalizer exports `F8X_AGGREGATE_PRODUCTS` and `F8X_AGGREGATE_QUARANTINED_ECS_IDENTITIES`. The gate also recognizes the intended BMW-prefixed equivalents `BMW_F8X_AGGREGATE_PRODUCTS` and `BMW_F8X_AGGREGATE_QUARANTINED_ECS_IDENTITIES`, but it rejects mixed names, added code, imports and trailing content.

## What is proved

The gate infers the sibling records and manifest filenames from each strict reconciliation-report basename, reads all 63 JSON artifacts through canonical opened-file snapshots, and reruns the normalizer over those exact bundles. It independently verifies the exact three-vehicle by seven-section matrix, profile roots, section routes, timestamps, complete status, public-retail safeguards, category pagination, placement totals, required-field counts and unique scope coverage. Every category must contain the hardened terminal-pagination proof, its rendered-card total, absence of a next or higher page, validated flag and canonical observed links. `scope.terminalProofs` must equal the exact category count and the terminal safeguard must be true. The reconstructed audit, complete product objects and quarantine array must exactly equal the supplied normalizer audit and canonical aggregate module.

Every retained product must have one canonical ES identity, canonical public handles, valid selection evidence and structured possible-fitment rows that match only F80/M3/S55, F82/M4/S55 or F83/M4/S55. Its category filters must exactly match that evidence: one `bmw-f8x` root, the represented F80/F82/F83 profile keys and one exact `bmw-f8x-{section}` filter for every represented section. Legacy `f8x`/`f8x-{section}` values, missing section filters and unrelated extra category filters fail closed. The module quarantine must exactly match the detailed audit quarantine and cannot overlap a retained product.

The normalizer and final gate build the same canonical ordered tuple for every raw record: `[vehicle, section, categoryKey, page, position, ecsPartNumber]`. Per-scope and whole-matrix SHA-256 values are written into `placementIdentityEvidence`. A same-count ES substitution or a two-product position swap changes those hashes and fails. Every placement must also be represented exactly once by either a retained ES product or a detailed quarantine record. Retained evidence binds ES identity, vehicle key and label, section, category key and label, page URL, position and observation timestamp; quarantine evidence binds the ES identity, exact placement keys and its canonical reason, MPN, URL and scope sets. Their per-scope and whole-matrix hashes are written into `observationEvidence`. Finalization requires the raw-bundle binding, and the builder recomputes both bindings from the canonical overlay module before it can write a release.

The current shard release is checked file by file: manifest, index, shard byte counts, SHA-256 values, route positions, canonical identities and the complete artifact-set checksum. Its path-independent release ID, dataset checksum, content-set checksum, manifest file checksum, canonical manifest checksum, product checksum and identity-set checksum are recorded. The static reviewed module is restricted to the exact repository entry and checksum-bound local graph. The graph is reopened after verification and the builder independently compares the live graph checksum with the finalized value. Before approving the audit, the gate runs the same reviewed merge used by the runtime in this exact order: static reviewed products, unchanged current shard base and the F8X overlay. Cross-layer MPN, canonical URL and public-handle conflicts fail closed.

The prior-quarantine helper parses the canonical aggregate module as data without executing it. It proves that its complete product objects, canonical handles and identities exactly equal the current shard release and that its exact quarantine list matches the manifest count without overlapping products. The artifact records the source module byte count and checksum plus separate exact product and quarantine checksums. The final gate reopens the same module and reconstructs the whole artifact; a same-count quarantine substitution or changed product under the same ES identity fails closed. The final gate then unions prior and incoming quarantine identities, filters that exact set across static, base and overlay inputs before the projected runtime merge, and fails if any quarantined identity survives. Intentional current removals are recorded by exact count and identity-set checksum; any other current-product removal fails closed.

The output authorizes only a separate complete F8X overlay release. `publicationPlan.mode` is `separate-f8x-overlay`; the unchanged generic BMW M3 base remains `verified-progress`. A mixed base-plus-overlay release must never be relabelled complete. The plan binds the base manifest and product set, the exact prior/incoming/projected quarantine sets and the final runtime projection count.

## Local platform boundary

This gate is intentionally fail closed, but two privileged local-filesystem boundaries must remain visible:

- F8X aggregate and prior aggregate modules are parsed as canonical JSON exports and are never executed. The generic builder's longstanding `--input-module` mode remains executable for non-F8X workflows, but any recognizable F8X audit is rejected before that import path. The trusted repository static graph still has to be imported to run the runtime merge; it is byte-snapshotted and checked before and after import, but Node's path-based module loader cannot make a transient privileged replacement mathematically impossible.
- Inputs are read through opened file handles with identity, size, timestamp and checksum checks. Outputs use canonical non-linked directories, exclusive create, no-follow where the platform exposes it, fsync and directory/file identity checks before and after writes. Node does not expose `openat`/directory-handle-relative creation here, so a privileged concurrent Windows junction swap could cause an outside write before the post-check detects and rejects it. Run both passes in a private directory whose parent is not writable by another actor.

## Prove the prior quarantine

Create this private artifact before finalizing F8X. The source module is read only and the output is create-only.

```powershell
$work = 'D:\Projx-Racing-Website-Data\ecs-f8x-final-20260820'
$currentShards = Resolve-Path 'api\data\ecs-bmw-m3-reviewed'
$priorSource = Resolve-Path 'private-imports\ecs-bmw-m3-20260809\staging-progress-products.js'
$priorArtifact = Join-Path $work 'ecs-reviewed-prior-quarantine.json'

& node scripts/ecs-catalog/finalize-f8x-release-audit.mjs prior-quarantine `
  --verify-only `
  --work-dir $work `
  --prior-aggregate-module $priorSource `
  --current-reviewed-shards $currentShards

$priorInputSetSha256 = '<verified lowercase 64-character checksum>'
& node scripts/ecs-catalog/finalize-f8x-release-audit.mjs prior-quarantine `
  --work-dir $work `
  --expect-input-set-sha256 $priorInputSetSha256 `
  --output $priorArtifact `
  --prior-aggregate-module $priorSource `
  --current-reviewed-shards $currentShards
```

## Two-pass private workflow

When using `--work-dir`, use a new absolute directory outside the repository. To operate entirely below the ignored repository `private-imports` tree instead, omit `--work-dir`. The example below uses an external work directory while reading the already-collected private normalizer outputs and bundles.

```powershell
$work = 'D:\Projx-Racing-Website-Data\ecs-f8x-final-20260820'
$audit = Join-Path $work 'f8x-aggregate-audit.json'
$products = Join-Path $work 'f8x-aggregate-products.mjs'
$priorSource = Resolve-Path 'private-imports\ecs-bmw-m3-20260809\staging-progress-products.js'
$priorArtifact = Join-Path $work 'ecs-reviewed-prior-quarantine.json'
$currentModule = Resolve-Path 'server\ecs-reviewed-catalog.js'
$currentShards = Resolve-Path 'api\data\ecs-bmw-m3-reviewed'
$reports = Get-ChildItem 'private-imports\ecs-f8x-m3-m4-20260820' -Recurse -Filter '*-reconciliation-report.json'
if ($reports.Count -ne 21) { throw "Expected exactly 21 reports; found $($reports.Count)." }
$reportArgs = foreach ($report in $reports) { '--reconciliation'; $report.FullName }

& node scripts/ecs-catalog/finalize-f8x-release-audit.mjs `
  --verify-only `
  --work-dir $work `
  --audit $audit `
  --aggregate-module $products `
  --prior-aggregate-module $priorSource `
  --prior-quarantine $priorArtifact `
  --current-reviewed-module $currentModule `
  --current-reviewed-shards $currentShards `
  @reportArgs
```

Every report must remain beside the exact same-prefix `*-records.json` and `*-manifest.json` files. The gate infers those names and fails on missing, linked, renamed, scope-mismatched or changed siblings.

The verification result prints an `inputSetSha256` and writes nothing. Review the counts, then immediately run the create-only pass against the same inputs:

```powershell
$inputSetSha256 = '<verified lowercase 64-character checksum>'
$finalAudit = Join-Path $work 'f8x-final-release-audit.json'

& node scripts/ecs-catalog/finalize-f8x-release-audit.mjs `
  --work-dir $work `
  --expect-input-set-sha256 $inputSetSha256 `
  --output $finalAudit `
  --audit $audit `
  --aggregate-module $products `
  --prior-aggregate-module $priorSource `
  --prior-quarantine $priorArtifact `
  --current-reviewed-module $currentModule `
  --current-reviewed-shards $currentShards `
  @reportArgs
```

If any input changes, repeat verification and investigate the new checksum. Never reuse an old checksum merely to make the write pass succeed.

## Build a private F8X overlay candidate

The updated builder consumes `publicationPlan.mode = separate-f8x-overlay`, filters the exact projected quarantine set and creates an overlay-only manifest bound to the unchanged base release and static catalogue. In this mode, `--input-dir` identifies the immutable base solely for verification and binding; its products are not copied into the complete F8X overlay. A finalized F8X audit is rejected in generic `--input-dir` or `--input-module` mode; `--overlay-module` is mandatory.

```powershell
$overlayCandidate = Join-Path $work 'f8x-overlay-candidate'

& node scripts/ecs-catalog/build-reviewed-product-shards.mjs `
  --input-dir $currentShards `
  --overlay-module $products `
  --audit $finalAudit `
  --output-dir $overlayCandidate
```

The output directory must be a new private directory. The builder refuses the current base directory, repository runtime-data directories and existing output paths. A mixed base-plus-overlay artifact must never be labelled complete: the generic BMW M3 base remains `verified-progress`, while only the exact F80/F82/F83 three-by-seven overlay is complete.

The manifest uses the distinct `ecs-reviewed-f8x-overlay-shard-manifest` kind and carries the exact sorted projected-quarantine identities, their count and checksum. The builder checksum-checks the aggregate module before parsing it, never executes it, recomputes the full observation evidence, compares the actual trusted static graph with the finalized graph, applies the shared runtime product contract to every full shard product and compact route, recomputes the static-plus-10,267-base runtime union and verifies the authorized quarantine removals before writing any candidate artifact.

Run the local structural publisher check without credentials or network access:

```powershell
& node scripts/ecs-catalog/publish-reviewed-product-shards.mjs `
  --directory $overlayCandidate
```

This command is a credential-free structural dry run. It reads and verifies only the local candidate and does not authorize or perform publication.

After the candidate, final audit and operational approval have all been reviewed, a real preview-only overlay publication uses the same command with `--preview`. It requires Blob authentication plus the separate server-only `ECS_REVIEWED_F8X_OVERLAY_MANIFEST_SECRET`; the base `ECS_REVIEWED_SHARD_MANIFEST_SECRET` is never accepted as a fallback for an overlay.

```powershell
& node scripts/ecs-catalog/publish-reviewed-product-shards.mjs `
  --directory $overlayCandidate `
  --preview
```

The publisher writes immutable overlay artifacts only below `projx-racing/ecs-reviewed/f8x-overlay/releases/` and updates only `projx-racing/ecs-reviewed/f8x-overlay/preview/current.json` through a guarded compare-and-swap. It never reads or writes the base `projx-racing/ecs-reviewed/preview/current.json` pointer for an F8X release. The command returns the verified public `currentUrl`; configure that exact URL as the Preview value of `ECS_REVIEWED_F8X_OVERLAY_CURRENT_URL` together with the matching overlay secret, then redeploy and verify the complete runtime union.

This audit does not authorize publication. Do not overwrite `api/data/ecs-bmw-m3-reviewed`, mutate its metadata, change deployment configuration or publish Blob objects as part of the audit workflow.

## Focused verification

```powershell
node --test scripts/ecs-catalog/prepare-f8x-aggregate.test.mjs
node --test scripts/ecs-catalog/finalize-f8x-release-audit.test.mjs
node --test scripts/ecs-catalog/build-f8x-overlay-release.test.mjs
node --test scripts/ecs-catalog/reviewed-product-shards.test.mjs
node --test scripts/ecs-catalog/f8x-overlay-runtime.test.mjs
```
