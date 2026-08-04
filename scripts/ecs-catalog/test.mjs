import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import {
  AUTOMATION_ACKNOWLEDGEMENT,
  canonicalizeProductUrl,
  parseProductHtml,
  runIngestion,
  validateAutomationAuthorization,
  validateProduct
} from "./lib.mjs";

const fixtures = path.resolve("scripts/ecs-catalog/fixtures");

test("parses a saved public-product HTML snapshot into the allowlisted schema", async () => {
  const html = await readFile(path.join(fixtures, "heat-exchanger.html"), "utf8");
  const record = parseProductHtml(html, {
    sourceUrl: "https://www.ecstuning.com/b-csf-parts/high-performance-heat-exchanger/8131~csf/?utm_source=test#details",
    checkedAt: "2026-08-04T09:30:00.000Z"
  });
  assert.equal(record.title, "High Performance Heat Exchanger - Polished");
  assert.equal(record.brand, "CSF Cooling");
  assert.equal(record.ecsSku, "ES#3987599");
  assert.equal(record.manufacturerMpn, "8131");
  assert.deepEqual(record.publicPrice, { amount: 695, currency: "USD", display: "$695.00" });
  assert.equal(record.publicAvailability, "In stock");
  assert.equal(record.category, "Cooling > Heat Exchangers");
  assert.equal(record.fitment.length, 2);
  assert.deepEqual(validateProduct(record), []);
});

test("canonicalizes ECS URLs for URL-level deduplication", () => {
  assert.equal(
    canonicalizeProductUrl("https://ecstuning.com/b-csf-parts/high-performance-heat-exchanger/8131~csf?x=1#top"),
    "https://www.ecstuning.com/b-csf-parts/high-performance-heat-exchanger/8131~csf/"
  );
});

test("rejects non-public and sensitive fields from normalized output", async () => {
  const html = await readFile(path.join(fixtures, "heat-exchanger.html"), "utf8");
  const record = parseProductHtml(html, {
    sourceUrl: "https://www.ecstuning.com/b-csf-parts/high-performance-heat-exchanger/8131~csf/",
    checkedAt: "2026-08-04T09:30:00.000Z"
  });
  record.dealerPrice = 1;
  const errors = validateProduct(record);
  assert.ok(errors.some((error) => error.includes("Unexpected product field")));
  assert.ok(errors.some((error) => error.includes("Forbidden product field")));
});

test("network mode remains locked without a current explicit automated-access grant", () => {
  const entries = [{ sourceUrl: "https://www.ecstuning.com/b-csf-parts/example/example/" }];
  assert.ok(validateAutomationAuthorization({}, entries).length > 0);
  const invalidManualCopyPermission = {
    acknowledgement: AUTOMATION_ACKNOWLEDGEMENT,
    grantedBy: "Supplier contact",
    permissionReference: "Manual-copy-only email",
    allowedHosts: ["www.ecstuning.com"],
    validUntil: "2026-01-01T00:00:00.000Z"
  };
  assert.ok(validateAutomationAuthorization(invalidManualCopyPermission, entries).length > 0);
});

test("CLI refuses to write raw review output into a public repository directory", () => {
  const result = spawnSync(process.execPath, [
    "scripts/ecs-catalog/ingest.mjs",
    "--manifest",
    "scripts/ecs-catalog/fixtures/manifest.json",
    "--output",
    "assets/unsafe-ecs-review"
  ], { cwd: process.cwd(), encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must stay under ignored private-imports/);
});

test("ingestion checkpoints, resumes, keeps raw snapshots and deduplicates by ECS SKU", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "projx-ecs-ingest-"));
  try {
    const entries = [
      {
        sourceUrl: "https://www.ecstuning.com/b-csf-parts/high-performance-heat-exchanger/8131~csf/",
        snapshotPath: path.join(fixtures, "heat-exchanger.html"),
        collectedAt: "2026-08-04T09:30:00.000Z"
      },
      {
        sourceUrl: "https://www.ecstuning.com/b-csf-parts/high-performance-heat-exchanger-copy/8131~csf/",
        snapshotPath: path.join(fixtures, "heat-exchanger.html"),
        collectedAt: "2026-08-04T10:30:00.000Z"
      },
      {
        sourceUrl: "https://www.ecstuning.com/b-csf-parts/gen-1-b58-aluminum-radiator/7089~csf/",
        snapshotPath: path.join(fixtures, "radiator.html"),
        collectedAt: "2026-08-04T11:30:00.000Z"
      }
    ];
    const first = await runIngestion({ entries, outputDir });
    assert.equal(first.summary.completed, 3);
    assert.equal(first.summary.failed, 0);
    assert.equal(first.catalog.productCount, 2);
    assert.equal(first.validation.valid, true);
    assert.equal(first.summary.deduplicated, 1);
    assert.equal(first.catalog.products.find((item) => item.ecsSku === "ES#3987599").checkedAt, "2026-08-04T10:30:00.000Z");
    assert.equal(Object.values(first.state.items).filter((item) => item.status === "completed").length, 3);

    const second = await runIngestion({ entries, outputDir });
    assert.equal(second.summary.skipped, 3);
    assert.equal(second.summary.completed, 0);
    assert.equal(second.catalog.productCount, 2);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
