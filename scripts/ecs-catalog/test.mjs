import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import {
  AUTOMATION_ACKNOWLEDGEMENT,
  canonicalizeProductUrl,
  fetchWithRetry,
  parseProductHtml,
  runIngestion,
  validateAutomationAuthorization,
  validateManualRecordInput,
  validateProduct
} from "./lib.mjs";

const fixtures = path.resolve("scripts/ecs-catalog/fixtures");
const fixedNow = () => new Date("2026-08-05T12:00:00.000Z");

function validManualRecord(overrides = {}) {
  return {
    title: "High Performance Heat Exchanger - Polished",
    brand: "CSF Cooling",
    ecsSku: "ES#3987599",
    manufacturerMpn: "8131",
    publicPrice: { amount: 695, currency: "USD" },
    publicAvailability: "In stock",
    imageUrls: ["https://assets.ecstuning.com/product.jpg"],
    fitment: ["BMW G80 M3"],
    category: "Cooling > Heat Exchangers",
    ...overrides
  };
}

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
  assert.throws(
    () => canonicalizeProductUrl("https://user:pass@www.ecstuning.com/b-csf-parts/example/example~csf/"),
    /must not contain credentials/
  );
  assert.throws(
    () => canonicalizeProductUrl("https://www.ecstuning.com:8443/b-csf-parts/example/example~csf/"),
    /default HTTPS port/
  );
  assert.throws(() => canonicalizeProductUrl("https://www.ecstuning.com/Search/"), /public product path/);
});

test("rejects unknown and sensitive manual fields recursively", () => {
  const record = validManualRecord({
    publicPrice: { amount: 695, currency: "USD", metadata: { dealerToken: "must-not-write" } }
  });
  const errors = validateManualRecordInput(record);
  assert.ok(errors.some((error) => error.includes("Unexpected manual field: record.publicPrice.metadata")));
  assert.ok(errors.some((error) => error.includes("record.publicPrice.metadata.dealerToken")));
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
  const otherwiseComplete = {
    acknowledgement: AUTOMATION_ACKNOWLEDGEMENT,
    grantedBy: "Named ECS representative",
    permissionReference: "email:retained-message-id",
    reviewedBy: "Named Projx reviewer",
    reviewedAt: "2026-08-05T10:00:00.000Z",
    allowedHosts: ["www.ecstuning.com"],
    validUntil: "2026-09-05T10:00:00.000Z",
    accessToken: "must-never-be-accepted"
  };
  const tightenedErrors = validateAutomationAuthorization(otherwiseComplete, entries, fixedNow());
  assert.ok(tightenedErrors.some((error) => error.includes("Unexpected authorization field")));
  assert.ok(tightenedErrors.some((error) => error.includes("Forbidden field")));
});

test("accepts the reviewed public-product automated-access grant", () => {
  const entries = [{ sourceUrl: "https://www.ecstuning.com/b-csf-parts/example/example~csf/" }];
  const authorization = {
    acknowledgement: AUTOMATION_ACKNOWLEDGEMENT,
    grantedBy: "Named ECS representative",
    permissionReference: "document:private-permission-record#sha256=example",
    reviewedBy: "Named Projx reviewer",
    reviewedAt: "2026-08-05T10:00:00.000Z",
    allowedHosts: ["www.ecstuning.com"],
    validUntil: "2026-09-05T10:00:00.000Z"
  };
  assert.deepEqual(validateAutomationAuthorization(authorization, entries, fixedNow()), []);
});

test("authorized fetch rejects redirect escapes, non-HTML and oversized responses without retries", async () => {
  const sourceUrl = "https://www.ecstuning.com/b-csf-parts/example/example~csf/";
  const cases = [
    {
      response: {
        ok: true,
        url: "https://example.com/b-csf-parts/example/example~csf/",
        headers: new Headers({ "content-type": "text/html" }),
        text: async () => "<html></html>"
      },
      expected: /Final response URL/
    },
    {
      response: {
        ok: true,
        url: sourceUrl,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () => "{}"
      },
      expected: /not HTML/
    },
    {
      response: {
        ok: true,
        url: sourceUrl,
        headers: new Headers({ "content-type": "text/html", "content-length": "2048" }),
        text: async () => "x".repeat(2048)
      },
      expected: /exceeds/
    },
    {
      response: { ok: false, status: 404, statusText: "Not Found", headers: new Headers() },
      expected: /HTTP 404/
    }
  ];

  for (const testCase of cases) {
    let attempts = 0;
    let sleeps = 0;
    await assert.rejects(
      fetchWithRetry(sourceUrl, {
        retries: 3,
        maxResponseBytes: 1024,
        fetchImpl: async () => {
          attempts += 1;
          return testCase.response;
        },
        sleep: async () => {
          sleeps += 1;
        }
      }),
      testCase.expected
    );
    assert.equal(attempts, 1);
    assert.equal(sleeps, 0);
  }
});

test("invalid numeric ingestion options are rejected", async () => {
  await assert.rejects(
    runIngestion({
      entries: [{ sourceUrl: "https://www.ecstuning.com/b-csf-parts/example/example~csf/" }],
      outputDir: path.join(os.tmpdir(), "unused-ecs-output"),
      retries: Number.NaN
    }),
    /retries must be an integer/
  );
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

test("saved snapshots cannot escape the manifest snapshot root", async () => {
  const workingDir = await mkdtemp(path.join(os.tmpdir(), "projx-ecs-snapshot-root-"));
  try {
    const snapshotRoot = path.join(workingDir, "manifest");
    const outputDir = path.join(workingDir, "output");
    const outsideSnapshot = path.join(workingDir, "unrelated.html");
    await mkdir(snapshotRoot);
    await writeFile(outsideSnapshot, "<html>unrelated local file</html>", "utf8");
    const result = await runIngestion({
      outputDir,
      snapshotRoot,
      now: fixedNow,
      entries: [{
        sourceUrl: "https://www.ecstuning.com/b-csf-parts/escape/example~csf/",
        collectedAt: "2026-08-04T09:30:00.000Z",
        snapshotPath: outsideSnapshot
      }]
    });
    assert.equal(result.summary.failed, 1);
    assert.match(Object.values(result.state.items)[0].error, /must stay inside the manifest snapshot root/);
    assert.deepEqual(await readdir(path.join(outputDir, "raw")), []);
  } finally {
    await rm(workingDir, { recursive: true, force: true });
  }
});

test("offline failures are isolated and sensitive manual input is rejected before raw retention", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "projx-ecs-failures-"));
  try {
    const result = await runIngestion({
      outputDir,
      now: fixedNow,
      snapshotRoot: fixtures,
      entries: [
        {
          sourceUrl: "https://www.ecstuning.com/b-csf-parts/sensitive/example~csf/",
          collectedAt: "2026-08-04T09:30:00.000Z",
          record: validManualRecord({ dealerPrice: 1 })
        },
        {
          sourceUrl: "https://www.ecstuning.com/b-csf-parts/bad-time/example~csf/",
          collectedAt: "not-a-date",
          snapshotPath: path.join(fixtures, "heat-exchanger.html")
        },
        {
          sourceUrl: "https://www.ecstuning.com/b-csf-parts/future-time/example~csf/",
          collectedAt: "2026-08-05T12:06:00.000Z",
          snapshotPath: path.join(fixtures, "heat-exchanger.html")
        },
        {
          sourceUrl: "https://www.ecstuning.com/b-csf-parts/high-performance-heat-exchanger/8131~csf/",
          collectedAt: "2026-08-04T09:30:00.000Z",
          snapshotPath: path.join(fixtures, "heat-exchanger.html")
        }
      ]
    });
    assert.equal(result.summary.failed, 3);
    assert.equal(result.summary.completed, 1);
    const rawFiles = await readdir(path.join(outputDir, "raw"));
    assert.equal(rawFiles.length, 1);
    assert.ok(Object.values(result.state.items).some((item) => /Forbidden field/.test(item.error ?? "")));
    assert.ok(Object.values(result.state.items).some((item) => /ISO date-time/.test(item.error ?? "")));
    assert.ok(Object.values(result.state.items).some((item) => /five minutes in the future/.test(item.error ?? "")));
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
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
    const first = await runIngestion({ entries, outputDir, now: fixedNow, snapshotRoot: fixtures });
    assert.equal(first.summary.completed, 3);
    assert.equal(first.summary.failed, 0);
    assert.equal(first.catalog.productCount, 2);
    assert.equal(first.validation.valid, true);
    assert.equal(first.summary.deduplicated, 1);
    assert.equal(first.catalog.products.find((item) => item.ecsSku === "ES#3987599").checkedAt, "2026-08-04T10:30:00.000Z");
    assert.equal(Object.values(first.state.items).filter((item) => item.status === "completed").length, 3);
    const rawFiles = await readdir(path.join(outputDir, "raw"));
    assert.equal(rawFiles.length, 3);
    assert.ok(rawFiles.every((file) => /-[a-f0-9]{64}\.html$/.test(file)));

    const second = await runIngestion({ entries, outputDir, now: fixedNow, snapshotRoot: fixtures });
    assert.equal(second.summary.skipped, 3);
    assert.equal(second.summary.completed, 0);
    assert.equal(second.catalog.productCount, 2);

    const withoutRadiator = {
      ...second.catalog,
      productCount: 1,
      products: second.catalog.products.filter((item) => item.ecsSku !== "ES#4905994")
    };
    await writeFile(path.join(outputDir, "catalog.json"), `${JSON.stringify(withoutRadiator, null, 2)}\n`, "utf8");
    const reconciled = await runIngestion({ entries: [entries[2]], outputDir, now: fixedNow, snapshotRoot: fixtures });
    assert.equal(reconciled.summary.skipped, 0);
    assert.equal(reconciled.summary.completed, 1);
    assert.equal(reconciled.catalog.productCount, 2);
    assert.equal((await readdir(path.join(outputDir, "raw"))).length, 3);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
