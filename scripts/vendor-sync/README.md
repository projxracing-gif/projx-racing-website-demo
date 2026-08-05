# Local vendor-stock sync foundation

This folder contains the local-only updater foundation for supplier stock. Tegiwa is the first supported supplier.

The updater deliberately does **not**:

- contact any supplier except when an operator explicitly selects `--download`;
- store supplier credentials;
- register Windows Task Scheduler;
- publish to GitHub, Vercel, Neon or another cloud service;
- modify the website's checked-in `api/data` files.

`--download` is hard-coded to the approved `https://scripts.tegiwa.de/dealer-stock/` HTTPS URL. It blocks redirects, requires identity transfer encoding, and validates status, content type, declared and streamed size, UTF-8 encoding and required CSV headers before the existing index builder can read the file. Tests inject a fake fetch implementation and never contact the supplier.

The updater stages an operator-supplied input or explicit approved download, builds or validates a compact public stock index, compares it with the previous good index, creates an immutable checksummed release, and atomically changes the local `current.json` pointer only after every gate succeeds.

## Workspace

Recommended Windows location:

`D:\Projx-Racing-Website-Data\vendor-feeds\tegiwa`

Approved-download promotions also require the separate private archive:

`D:\Projx-Racing-Website-Data\secure-private\tegiwa\source-archives`

Preview the directory setup:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\vendor-sync\install-local-workspace.ps1 -InspectOnly
```

`-InspectOnly` resolves the two separate D: trees and prints the intended ACL principals without reading or changing them. `-WhatIf` adds a ShouldProcess preview and also returns before filesystem or ACL changes:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\vendor-sync\install-local-workspace.ps1 -WhatIf
```

Create the local directories and apply verified private ACLs only after explicit approval:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\vendor-sync\install-local-workspace.ps1
```

The installer is a template. On an actual apply it disables inherited access recursively, makes the current desktop user the owner, and leaves exactly three full-control principals: that user SID, SYSTEM (`S-1-5-18`) and built-in Administrators (`S-1-5-32-544`). It rejects reparse points, reapplies the policy to existing descendants, reads every ACL back, and fails closed if ownership, inheritance protection or any rule differs. It prepares both separate directory trees but never creates a scheduled task and never copies credentials. This implementation did not run the apply mode against the real D: directories.

Read-only verification of an already prepared tree is available with `-VerifyOnly`. It checks the exact SID set, rejects duplicate or missing approved entries, verifies ownership and inheritance flags, and changes nothing. The hourly runner performs this verification before its validation-only output or any Node/network action, so ACL drift fails closed.

## Required manual sequence

1. Either place a fully completed supplier file in `incoming`, or explicitly use the fixed-URL `--download` mode. A separate downloader must use a temporary filename and rename it only after the transfer finishes.
2. Run a dry-run with a previous-good baseline.
3. Review the safe count/change summary and the local JSONL health event.
4. Run the same command without `--dry-run` only if the dry-run passed.
5. Keep `current.json`, every versioned release, and the previous-release pointer local until a separate publication review is approved.

Private CSV dry-run:

```powershell
node scripts\vendor-sync\tegiwa.mjs `
  --workspace D:\Projx-Racing-Website-Data\vendor-feeds\tegiwa `
  --stock-csv D:\Projx-Racing-Website-Data\vendor-feeds\tegiwa\incoming\tegiwa-stock.ready.csv `
  --checked-at 2026-08-05 `
  --baseline api\data\tegiwa-stock-index.json `
  --dry-run
```

Approved fixed-URL download dry-run (the check date defaults to the current UTC date):

```powershell
node scripts\vendor-sync\tegiwa.mjs `
  --workspace D:\Projx-Racing-Website-Data\vendor-feeds\tegiwa `
  --download `
  --private-archive D:\Projx-Racing-Website-Data\secure-private\tegiwa\source-archives `
  --baseline api\data\tegiwa-stock-index.json `
  --dry-run
```

The network request occurs only when `--download` is present. It uses a bounded user agent, sends no credentials, rejects redirects and never stores the source URL in health logs. A dry-run validates the separate archive directory but writes no archive. Run the same command without `--dry-run` only after reviewing the dry-run result; the promotion run downloads and fully validates a fresh snapshot again, archives that exact CSV, verifies its SHA-256 and byte count, and only then creates a release.

Promotion uses the identical command without `--dry-run`. A prepared public index can be checked with `--prepared-index <file>` instead of `--stock-csv`; it still passes the same schema, freshness, aggregate and abnormal-change gates.

The first promotion requires either `--baseline` or a pre-existing, checksum-valid `current.json`. `--allow-initial` exists only for an explicitly reviewed initial setup and should not be used by a future unattended schedule.

## Release and rollback model

- `.vendor-sync.lock` is created with exclusive-create semantics. It is never broken automatically. After a crash, confirm no updater process is running and move the stale lock aside for audit before retrying.
- `staging/<run-id>` contains the temporary private input and candidate. It is removed after success or failure; the original incoming file remains untouched.
- Approved-download promotions copy the exact staged CSV to the separate private archive with exclusive-create semantics. The filename is `tegiwa-stock-<UTC timestamp>-<full SHA-256>.csv`; an existing name is never replaced.
- `releases/<release-id>` contains only `tegiwa-stock-index.json` and its checksummed `manifest.json`. Existing release IDs are never overwritten.
- `current.json` is an atomic pointer to the promoted release and carries `previousReleaseId` plus manifest/artifact checksums.
- `history/` retains every replaced pointer. Releases are not deleted automatically, so the previous good data remains available.
- `health/tegiwa-YYYY-MM.jsonl` contains only status, counts, change ratios and bounded failure codes. It never contains file paths, SKUs, prices, credentials or raw supplier rows.

The release manifest records the raw source byte count, SHA-256 and `privateArchiveVerified: true`, but never the private path or raw rows. Its creation timestamp plus source SHA-256 deterministically identifies the archive filename. If exclusive creation, durable flush, or either checksum pass fails, the updater rejects the promotion before creating the release or changing `current.json`. A later release failure may leave a verified orphan archive; it remains immutable audit evidence and is not deleted automatically.

If a fully validated candidate index has the same SHA-256 as the current index, the updater records a privacy-safe `no_change` health event and stops. It does not create another raw archive, release, history pointer or `current.json` write. This check occurs before disk-space and retention accounting, so unchanged hourly runs do not consume retained-data capacity.

Validate the previous rollback target without changing the pointer:

```powershell
node scripts\vendor-sync\rollback.mjs --workspace D:\Projx-Racing-Website-Data\vendor-feeds\tegiwa --previous --dry-run
```

Perform the locally validated rollback:

```powershell
node scripts\vendor-sync\rollback.mjs --workspace D:\Projx-Racing-Website-Data\vendor-feeds\tegiwa --previous
```

No rollback command publishes anything. It changes only the local pointer.

## Prepared Vercel Blob publisher

`publish-vercel-blob.mjs` is the reviewed bridge between the large private local workspace and the small public stock data the website can read. It does not create a Blob store, contact a supplier, schedule itself, or publish during a dry-run.

Validate the selected local release without credentials or network access:

```powershell
node scripts\vendor-sync\publish-vercel-blob.mjs `
  --workspace D:\Projx-Racing-Website-Data\vendor-feeds\tegiwa `
  --dry-run
```

An approved real publication requires an existing public Vercel Blob store and exactly these two server-only environment variables:

- `BLOB_READ_WRITE_TOKEN`: the existing store's scoped read/write token;
- `TEGIWA_STOCK_MANIFEST_SECRET`: the same 32-to-1,024-byte HMAC secret configured only on the website server.

The real command is the same command without `--dry-run`. It first checksum-validates `current.json`, the immutable release manifest and artifact, then recomputes the public SKU-mapping fingerprint and compares it with the checked-in search summary. It accepts a current `approved-download` release, or a checksum-identical `public-index` release whose retained previous release proves the approved-download provenance. It never invents a retrieval time and fails closed if that chain is missing.

Only two public JSON objects can be uploaded:

1. the compact stock index as a randomly suffixed, immutable artifact;
2. a fixed `current.json` containing only version, vendor, release ID, timestamps, three aggregate counts, artifact URL/size/SHA-256 and an HMAC signature.

The raw CSV, local manifest, paths, source metadata, price gates, baselines and private archive details are never sent. If the artifact SHA-256 already matches the signed remote current manifest, all writes and cleanup are skipped. Otherwise the immutable artifact is uploaded first and the current pointer is changed with an ETag precondition (or protected create for the first release), preventing concurrent publishers from silently overwriting each other. Cleanup runs only after that pointer succeeds, keeps the new and previous artifacts, is bounded to ten list pages and 100 deletes, and uses ETag preconditions where available.

The hourly Windows runner is local-only by default. Its explicit `-PublishAfterSync` mode first checks the two environment variables above by validity shape without displaying either value, then runs the approved local sync, and invokes this publisher only after the sync exits successfully. Missing or invalid environment configuration stops the run before the sync or any network request. `-PublishAfterSync` cannot be combined with `-DryRun`, because publishing the previously selected release after a non-promoting dry-run would be ambiguous. A publisher failure does not roll back the valid local release; the publisher's guarded remote pointer remains unchanged and a later successful run can retry.

The implementation uses the official [`@vercel/blob` SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk) and follows Vercel's [upload](https://vercel.com/docs/vercel-blob/using-blob-sdk#upload-a-blob), [download](https://vercel.com/docs/vercel-blob/using-blob-sdk#download-a-blob), [list](https://vercel.com/docs/vercel-blob/using-blob-sdk#list-blobs), and [delete](https://vercel.com/docs/vercel-blob/using-blob-sdk#delete-blobs) contracts.

## Validation gates

The updater rejects:

- missing, symbolic, empty or oversized inputs;
- download redirects, non-200 responses, non-CSV or encoded content, truncated streams, invalid UTF-8 and missing required feed headers;
- malformed JSON/CSV or an unsupported stock-index schema/price basis;
- invalid public keys, price ranges, stock codes, lead times or SKU state;
- stale, excessively future-dated or regressed check dates;
- aggregate counts that do not match the normalized records;
- abnormal product, SKU, availability, key or changed-record movement;
- any individual minimum/maximum price movement over 50% when the absolute movement is at least 5,000 pence;
- any catastrophic endpoint movement over 90%, regardless of absolute price;
- endpoint movement over 10% affecting more than 8% of comparable products;
- an absolute median representative-price movement over 10% or nearest-rank 90th-percentile endpoint movement over 35% when at least 20 products are comparable;
- priced-to-null regressions over 2% of baseline priced products or over 250 products;
- overlapping runs, corrupt release checksums or corrupt pointers;
- missing, nested, symbolic or unavailable private archive directories for approved downloads;
- archive filename collisions, copy failures or checksum changes before release creation;
- any initial promotion without a baseline or explicit initial approval.

`thresholds.example.json` documents the conservative defaults. Override files accept only those keys and bounded numeric values. Threshold failures cannot be bypassed by a generic force flag.

Price diagnostics contain only aggregate ratios and counts. Failure codes and health events never include a product key, SKU, title, old price or new price. The 5,000-pence floor avoids blocking a single low-value rounding change, while the no-floor 90% backstop catches catastrophic changes on low-priced products. Endpoint and material-share gates prevent balanced increases/decreases or minimum/maximum range reshaping from hiding behind an unchanged midpoint.

## Retention and disk-space guard

Before any changed promotion, the updater counts immutable releases and approved-download archives and measures available space using the local filesystem. These are fail-closed circuit breakers, not an automatic deletion policy. Defaults are:

- at least 5,000,000,000 bytes must remain available, plus twice the combined source/candidate size as a write reserve;
- at most 9,000 versioned release directories;
- at most 9,000 immutable private source archives.

The checks run before private archival and release creation. An unavailable disk-space measurement, low reserve, or reached count limit blocks promotion without deleting anything. No unattended cleanup is implemented.

When a limit is reached, either expand the local volume or use a separately approved retention procedure. Back up and checksum retained data first; never remove `current.json`, its current or previous release, the source archive corresponding to any retained release, pointer history needed for audit, or an active lock. Re-run a dry-run and a changed promotion after capacity is restored. Threshold overrides can lower limits for testing but should not be raised without reviewing expected hourly growth and backup capacity.

## Tests

```powershell
node --test scripts\vendor-sync\test.mjs
node --test scripts\vendor-sync\publish-vercel-blob.test.mjs
```

The tests use temporary directories, prepared public-index fixtures, injected disk-space results and mocked download responses. They verify no-change short-circuiting, price gates, low-space/retention failures, dry-run non-archival, exact archive bytes and release blocking. They make no supplier or cloud request.

## Windows hourly scheduler templates

The scheduler package is prepared but **not registered**:

- `run-hourly-tegiwa-sync.ps1` validates an explicit repository root, `node.exe`, existing D: workspace and separate existing D: private archive, then verifies every protected ACL before it can invoke the updater; its optional `-PublishAfterSync` mode preflights environment configuration and runs the verified publisher only after exit code 0;
- `install-hourly-tegiwa-task.ps1` prepares an hourly task at minute 15 by default and adds only the boolean `-PublishAfterSync` argument when explicitly requested;
- `uninstall-hourly-tegiwa-task.ps1` accepts the local-only or publish-after-sync action, refuses credential-bearing action arguments, and refuses to remove a same-named task unless its action points to this repository's validated runner;
- `scheduler-common.ps1` centralizes absolute-path, reparse-point, task-name, command-line quoting and value-free publication-environment checks;
- `test-scheduler-templates.ps1` performs Pester-free parser, helper and static-policy checks without accessing Task Scheduler.

The proposed task uses the current Windows user's interactive token with limited run level. It stores no password or credential. Local-only is the default. It runs every hour at minute 15, uses `StartWhenAvailable` after a missed start, and adds a current-user logon trigger as the no-admin catch-up path. A startup trigger is intentionally omitted because creating machine-startup tasks commonly needs administrator rights. `MultipleInstances IgnoreNew` and the updater's exclusive local lock provide two no-overlap layers.

Validate the runner's paths without downloading or promoting anything:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\vendor-sync\run-hourly-tegiwa-sync.ps1 `
  -RepoRoot C:\absolute\path\to\projx-racing-website-demo `
  -NodeExecutable C:\absolute\path\to\node.exe `
  -WorkspaceRoot D:\Projx-Racing-Website-Data\vendor-feeds\tegiwa `
  -PrivateArchiveRoot D:\Projx-Racing-Website-Data\secure-private\tegiwa\source-archives `
  -ValidateOnly
```

Inspect the complete proposed task definition without calling any ScheduledTasks command:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\vendor-sync\install-hourly-tegiwa-task.ps1 `
  -RepoRoot C:\absolute\path\to\projx-racing-website-demo `
  -NodeExecutable C:\absolute\path\to\node.exe `
  -WorkspaceRoot D:\Projx-Racing-Website-Data\vendor-feeds\tegiwa `
  -PrivateArchiveRoot D:\Projx-Racing-Website-Data\secure-private\tegiwa\source-archives `
  -InspectOnly
```

`-WhatIf` provides the same no-registration inspection path with a ShouldProcess message. Add `-ScheduledDryRun` to either inspection command to preview a task that would always pass `--dry-run` to the updater. The installer refuses an existing task name and never uses `-Force`. Inspection output confirms the private archive validation but redacts its action-argument value.

To inspect the optional post-sync publication mode, add `-PublishAfterSync`. Inspection remains read-only and reports only whether each required environment variable has a valid shape; it never returns a value. For a future real registration, both `BLOB_READ_WRITE_TOKEN` and `TEGIWA_STOCK_MANIFEST_SECRET` must be configured outside the repository in the Windows environment for the same scheduled-task identity. Never put those values in a script, task action, task XML, command-line argument or committed `.env` file. In a fresh PowerShell process for that identity, use runner `-ValidateOnly -PublishAfterSync` to verify the complete path, ACL and environment preflight without a supplier or cloud request. The installer rejects `-ScheduledDryRun -PublishAfterSync`.

Actual registration is a separate future external-write action. It must be explicitly approved and performed manually by rerunning the installer without `-InspectOnly` or `-WhatIf`. This implementation did not do that.

Inspect a future removal without querying or changing Task Scheduler:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\vendor-sync\uninstall-hourly-tegiwa-task.ps1 `
  -RepoRoot C:\absolute\path\to\projx-racing-website-demo `
  -InspectOnly
```

Run the scheduler-template checks:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\vendor-sync\test-scheduler-templates.ps1
```

Because the task uses an interactive token, it is intended to run while that user is signed in. If the computer is off or the user is signed out, `StartWhenAvailable` and the logon trigger provide the next feasible catch-up. If D: or the network is unavailable, validation stops safely and a later hourly trigger can retry. The default runner publishes nothing to GitHub, Vercel or another cloud service; only the explicit `-PublishAfterSync` mode may invoke the existing Vercel Blob publisher after a successful sync.
