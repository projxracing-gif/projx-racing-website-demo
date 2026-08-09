# BMW M3 supplier-media recovery queue

## Purpose

The reviewed BMW M3 shard release can contain a labelled
`supplier-media-unavailable` product only when the reconciled listing capture did
not provide a supplier image URL. The recovery queue is an offline, deterministic
handoff for a later public ECS product-detail-page media pass. It does not browse,
download, publish, infer, or invent an image.

The queue generator reads the checked-in reviewed shard manifest, routing index,
and every product shard. It verifies their byte counts and SHA-256 checksums before
selecting missing-media products. It then writes an ignored private JSON file and a
full-file SHA-256 sidecar under `private-imports/`.

## Current verified-progress baseline

For release `20260809T185719876Z-974a9b9a8fabb2f2`:

- reviewed products: 10,267;
- supplier-media recovery candidates: 832;
- missing supplier descriptions within that queue: 75;
- missing supplied brands within that queue: 16;
- candidates by primary section: Braking 120, Engine 539, Suspension 144,
  Steering 29; and
- exact identity-set SHA-256:
  `7efa7f5f10770f61ee294856434fbee358239f23864d147402e09d6e1087f145`.

The 832 identities have 1,133 observations in the reconciled raw captures. Every
one of those observations has an empty primary image URL, fallback image URL, and
image alt field. No current fallback URL can therefore be promoted offline. This
does not prove that an ECS product-detail page has no supplier media; it only means
the current listing captures do not contain it.

## Generate the approved queue

Run the command from the repository root. The expected count and identity checksum
make the current handoff fail closed if the reviewed release changes before the
queue is generated.

```powershell
npm run catalog:ecs:bmw-m3-media-recovery-queue -- `
  --expect-count 832 `
  --expect-identity-sha256 7efa7f5f10770f61ee294856434fbee358239f23864d147402e09d6e1087f145
```

Default private outputs:

- `private-imports/ecs-bmw-m3-20260809/media-recovery-queue.json`
- `private-imports/ecs-bmw-m3-20260809/media-recovery-queue.json.sha256`

The directory is ignored by Git and must not be committed. Each queue item records
the canonical ECS product URL, ES number, manufacturer part number, title, supplied
brand when present, primary section/category, missing-description and missing-brand
flags, and exact source shard position. The document also records:

- source manifest and content-set checksums;
- candidate, description, brand, section, and category counts;
- a deterministic identity-set checksum; and
- a deterministic full-record-set checksum.

Queue output is create-only. The command accepts output files only below this
repository's `private-imports/` directory, rejects linked output directories, and
stops if either the JSON file or its checksum sidecar already exists. To generate
a replacement intentionally, preserve or remove both existing private artifacts
first; the command never overwrites an approved handoff.

## Fail-closed rules

Queue creation stops before writing output when it finds any of the following:

- a foreign, HTTP, credential-bearing, port-bearing, query-bearing,
  fragment-bearing, or non-product URL;
- mismatched public key, slug, ES number, SKU, identifier, or manufacturer part
  number;
- a duplicate ES identity or one product URL assigned to multiple identities;
- an unavailable-media product that already carries an image, or a verified-media
  product without one;
- a section outside the manifest's reconciled included sections;
- an invalid shard source reference; or
- a manifest, routing-index, shard byte-count, checksum, release-ID, route, or count
  mismatch.

## Later browser recovery policy

The queue is input to a separate, authorized browser pass. That pass must visit
only each recorded public ECS product detail URL and may accept only exact verified
supplier media. It must stop on an access challenge and must not bypass one. It
must not construct image paths from the ES number or MPN, reuse generic brand art,
or infer a product image from a title. Captured files still require content-type,
byte, dimension, and checksum validation through the existing BMW M3 media-index
pipeline before the aggregate and shards are regenerated.

The same detail-page pass can recover supplier description and brand evidence for
the flagged 75 and 16 products. Until evidence is captured, the current explicit
missing-data labels remain correct.

## Focused verification

```powershell
node --test scripts/ecs-catalog/build-bmw-m3-media-recovery-queue.test.mjs
```

Tests cover deterministic ordering and checksums, private output plus sidecar,
foreign/query/fragment URL rejection, duplicate and conflicting identities,
contradictory media state, shard checksum drift, private-only output confinement,
no-overwrite behavior, and linked-directory escape rejection where the operating
system permits directory links.
