# Local Tegiwa stock updater operating note

The implementation is in `scripts/vendor-sync/`. It extends the local storage design in `docs/local-catalogue-storage.md` without changing the public website or creating an online stock service.

## Approved local flow

```text
operator-supplied file OR explicit fixed-URL approved download
  -> incoming ready file OR run-scoped exclusive staging file
  -> exclusive local run lock
  -> private temporary staging copy
  -> existing Tegiwa public-index builder
  -> schema, freshness, aggregate and abnormal-change gates
  -> identical public-index SHA-256: privacy-safe no_change stop
  -> changed candidate: price, retention and disk-space gates
  -> approved-download promotion: exclusive exact-source private archive + SHA-256 recheck
  -> immutable checksummed release
  -> atomic current.json pointer
  -> private-safe JSONL health event
```

The built-in network path runs only with `--download` and can reach only the exact approved `https://scripts.tegiwa.de/dealer-stock/` endpoint. Redirects are disabled and identity transfer encoding is required. HTTP status, `text/csv` content type, declared and actual byte counts, UTF-8 decoding, maximum size and the required source headers are checked before building. No credential is sent or stored.

The source CSV is never copied into a release. For approved-download promotions only, the exact validated staged CSV is copied first to `D:\Projx-Racing-Website-Data\secure-private\tegiwa\source-archives` using an immutable UTC-timestamp/full-SHA-256 filename. Exclusive creation, byte count, SHA-256 and a post-flush SHA-256 check must all pass before a release can be created. Dry-runs validate the directory but never archive a file.

The release contains only the compact customer-safe stock index and a manifest. The manifest records the source hash, byte count and verified-archive boolean, not the private path. The health log contains no SKU, price, archive path, source path, supplier URL, credential, token or raw row.

The local workspace installer has `-InspectOnly` and `-WhatIf` paths that make no filesystem or ACL change. Actual apply mode protects the private archive first and then both directory trees recursively, verifying that only the current desktop user, SYSTEM and built-in Administrators have full control; inheritance is disabled and the current user owns each item. Exact SID-set comparison rejects duplicate or missing entries. Any service identity, reparse point, ACL application error or verification mismatch fails closed. `-VerifyOnly` performs the same read-back checks without mutation, and the hourly runner requires it to pass before Node or network activity.

## Separation from publication

`current.json` is a local pointer only. Vercel and the live website cannot read the D: drive. The prepared `publish-vercel-blob.mjs` bridge independently verifies the selected release and can copy only the approved compact public artifact plus a signed public pointer; it cannot upload the raw CSV or private local manifest.

Publication is opt-in. The Windows runner remains local-only unless `-PublishAfterSync` is explicitly selected. In that mode it validates `BLOB_READ_WRITE_TOKEN` and `TEGIWA_STOCK_MANIFEST_SECRET` from the process environment without returning their values, runs the local sync, and invokes the publisher only after the updater exits successfully. Missing or invalid environment configuration stops before sync or network activity. A local/scheduled dry-run cannot be combined with publication. If publication later fails, the valid local release is retained and the publisher's remote-current safeguards determine the unchanged remote state; no rollback or destructive cleanup is attempted.

## Scheduling status

Windows Task Scheduler is intentionally **not registered**. Guarded runner, installer and uninstaller templates now exist under `scripts/vendor-sync/`, together with a Pester-free verifier. `-InspectOnly`, `-WhatIf` and runner `-ValidateOnly` resolve and display the proposed configuration without registering a task or making a supplier request.

The proposed default is hourly at minute 15, local-only, `StartWhenAvailable`, network required and `MultipleInstances IgnoreNew`. It also has a current-user logon trigger for no-admin catch-up. It uses the current interactive user at limited run level, so no password is stored; a machine-startup trigger is intentionally excluded. The runner independently validates the explicit repository, `node.exe`, previous-good baseline, existing D: workspace and separate existing D: private archive before selecting `--download`. Inspection output redacts the private archive argument.

Installer `-PublishAfterSync` adds only that boolean switch to the task action. It never places a token, manifest secret or credential value in task arguments. Read-only inspection reports the two required environment-variable names and readiness booleans only; an actual registration fails before accessing Task Scheduler if either value is missing or invalid. Configure any future values outside Git for the same Windows identity, then verify from a fresh process with runner `-ValidateOnly -PublishAfterSync`. The uninstaller recognizes both supported modes but rejects a credential-bearing or duplicated publication argument as an ownership mismatch.

First complete multiple manual dry-runs and promotions, confirm realistic threshold behavior, retain the supplier authorization record outside the release data, and decide how operators will be alerted when a run is locked or blocked. Actual task registration remains a separate external-write action requiring explicit approval.

## Failure rules

- A validation-blocked or other pre-promotion failure leaves `current.json` unchanged.
- An interrupted run may leave `.vendor-sync.lock`; it is not automatically removed because doing so could start overlapping writers.
- Task Scheduler's `IgnoreNew` policy adds a second no-overlap guard but does not replace the updater lock.
- A candidate release is never promoted when counts regress beyond thresholds, data is stale, validation fails or a prior release checksum is inconsistent.
- Material individual, catastrophic no-floor, affected-share, median, nearest-rank 90th-percentile endpoint, or priced-to-null price changes block promotion using only privacy-safe aggregate metrics.
- Approved-download promotion stops before release creation when its exact raw source cannot be archived and re-verified.
- Identical current/candidate index hashes produce `no_change` without another archive, release or pointer write.
- The Blob publisher is never called unless opt-in environment preflight passes and the local updater exits with code 0.
- Changed promotions stop when the 5 GB plus projected-write reserve is unavailable, release/archive count reaches 9,000, or filesystem capacity cannot be measured. Nothing is deleted automatically.
- Previous pointer history and versioned releases are retained. Rollback validates the target release again before the atomic pointer change.
- Never delete `releases`, `history`, or a lock as part of an unattended job.

Run and rollback examples, workspace setup, thresholds and tests are documented in `scripts/vendor-sync/README.md`.
