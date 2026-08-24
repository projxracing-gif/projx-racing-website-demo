# ECS F8X overlay media readiness

`scripts/ecs-catalog/build-f8x-overlay-media-recovery-queue.mjs` is the offline gate for identifying products that still lack supplier media after the separate F80/F82/F83 overlay has been built. It does not open a browser, request an ECS page, download an image, run recovery, publish media, modify the overlay or change runtime data.

The F8X queue is intentionally distinct from the generic BMW M3 recovery queue. The generic tool accepts the older `ecs-reviewed-product-shard-*` release contract; this tool accepts only `ecs-reviewed-f8x-overlay-*` artifacts and emits `ecs-f8x-overlay-supplier-media-recovery-queue`.

## Required evidence

One verification pass requires:

- the complete, private F8X overlay release directory, including its manifest checksum sidecar, routing index and every shard; and
- the exact create-only F8X final-release audit used to authorize that overlay.

The gate verifies every release byte and the deterministic release ID, then binds the queue to the overlay manifest, product set, artifact set, unchanged generic base release, projected quarantine and final-audit file. The final audit must still carry its valid input-set checksum and authorize `publicationPlan.mode = separate-f8x-overlay` for the exact overlay product and section counts.

Every overlay product is checked at ES-number grain. Canonical identity, MPN, public product URL, structured possible fitments and the full vehicle/section/category observation set must agree. A product is queued only when `imageStatus` is `supplier-media-unavailable` with no retained image. Products marked `supplier-media-verified` must carry exact official `assets.ecstuning.com` media or the gate fails closed.

Each queued item preserves all observed F80/F82/F83 profiles, chassis, sections, categories and dated category placements. It also records the exact overlay shard position and whether supplier brand or description evidence is missing. Queue records and the sorted candidate identity set have separate deterministic checksums.

## Two-pass private workflow

Use the same private work directory that contains the finalized audit and overlay candidate. The first pass writes nothing:

```powershell
$work = 'D:\Projx-Racing-Website-Data\ecs-f8x-final-20260820'
$overlay = Join-Path $work 'f8x-overlay-candidate'
$audit = Join-Path $work 'f8x-final-release-audit.json'
$queue = Join-Path $work 'f8x-overlay-media-recovery-queue.json'

& node scripts/ecs-catalog/build-f8x-overlay-media-recovery-queue.mjs `
  --verify-only `
  --work-dir $work `
  --overlay-release $overlay `
  --final-audit $audit
```

Review `recoveryCandidateCount`, the vehicle and section counts, `queueSha256` and `inputSetSha256`. If they are expected, immediately repeat against the same unchanged inputs with the printed input-set checksum:

```powershell
$inputSetSha256 = '<verified lowercase 64-character checksum>'

& node scripts/ecs-catalog/build-f8x-overlay-media-recovery-queue.mjs `
  --work-dir $work `
  --overlay-release $overlay `
  --final-audit $audit `
  --expect-input-set-sha256 $inputSetSha256 `
  --output $queue
```

The queue and `.sha256` sidecar are create-only. If an input changes between passes, the pinned checksum fails and nothing is approved. Use a new output filename after intentionally rebuilding or re-auditing the overlay; never overwrite the old evidence.

The actual missing-media count is unknown until the live 21-scope capture, final audit and overlay build are complete. Do not invent a count from the current generic BMW M3 release.

## Authorization boundary

This gate only prepares and verifies a private queue. It does not authorize browser recovery, challenge bypass, media download, Blob publication or deployment. Any later recovery runner must consume this exact F8X queue kind and its checksums; it must not reuse the BMW M3 runner by relabelling the queue.

## Focused verification

```powershell
node --test scripts/ecs-catalog/build-f8x-overlay-media-recovery-queue.test.mjs
```
