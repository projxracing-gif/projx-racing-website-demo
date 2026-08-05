import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { AUTOMATION_ACKNOWLEDGEMENT } from "./lib.mjs";
import { buildUrlManifests } from "./build-url-manifests.mjs";
import { createShardJobPlan, runShardJob, shardJobStatus } from "./shard-jobs.mjs";

const fixedNow = new Date("2026-08-05T12:00:00.000Z");

function authorization() {
  return {
    acknowledgement: AUTOMATION_ACKNOWLEDGEMENT,
    grantedBy: "Named ECS representative",
    permissionReference: "document:private-permission-record#sha256=example",
    reviewedBy: "Named Projx reviewer",
    reviewedAt: "2026-08-05T10:00:00.000Z",
    allowedHosts: ["www.ecstuning.com"],
    validUntil: "2026-09-05T10:00:00.000Z"
  };
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "projx-ecs-shard-jobs-"));
  const source = path.join(root, "ecs-urls.txt");
  const manifestDirectory = path.join(root, "manifests");
  const workspace = path.join(root, "jobs");
  const authorizationPath = path.join(root, "authorization.json");
  await writeFile(source, [
    "https://www.ecstuning.com/b-csf-parts/one/one~csf/",
    "https://www.ecstuning.com/b-csf-parts/two/two~csf/",
    "https://www.ecstuning.com/b-csf-parts/three/three~csf/",
    "https://www.ecstuning.com/b-csf-parts/four/four~csf/",
    "https://www.ecstuning.com/b-csf-parts/five/five~csf/"
  ].join("\n"), "utf8");
  await writeFile(authorizationPath, `${JSON.stringify(authorization(), null, 2)}\n`, "utf8");
  await buildUrlManifests({
    inputPath: source,
    outputPath: manifestDirectory,
    maxUrls: 2,
    maxBytes: 8192,
    bucketCount: 4,
    generatedAt: fixedNow.toISOString()
  });
  return { root, manifestDirectory, workspace, authorizationPath };
}

test("plans checksum-bound independent ECS jobs without retaining URLs or public output", async (t) => {
  const files = await fixture();
  t.after(() => rm(files.root, { recursive: true, force: true }));
  const result = await createShardJobPlan({
    indexPath: path.join(files.manifestDirectory, "index.json"),
    workspacePath: files.workspace,
    authorizationPath: files.authorizationPath,
    at: fixedNow
  });
  assert.equal(result.plan.counts.urls, 5);
  assert.equal(result.plan.counts.jobs, 3);
  assert.equal(result.plan.safety.urlDiscovery, false);
  assert.equal(result.plan.safety.crawling, false);
  assert.equal(result.plan.safety.storefrontPublishing, false);
  assert.equal(result.plan.safety.publicDataPolicy.dealerCost, "forbidden");
  assert.ok(result.plan.jobs.every((job) => job.urlCount <= 2));
  assert.doesNotMatch(await readFile(path.join(files.workspace, "plan.json"), "utf8"), /ecstuning\.com\/b-/);
  assert.deepEqual(await shardJobStatus(files.workspace), {
    jobs: 3,
    urls: 5,
    counts: { pending: 3, running: 0, completed: 0, failed: 0 }
  });
});

test("runs exactly one authorized shard, checkpoints it and skips its durable result on resume", async (t) => {
  const files = await fixture();
  t.after(() => rm(files.root, { recursive: true, force: true }));
  await createShardJobPlan({
    indexPath: path.join(files.manifestDirectory, "index.json"),
    workspacePath: files.workspace,
    authorizationPath: files.authorizationPath,
    at: fixedNow
  });
  await assert.rejects(
    runShardJob({
      workspacePath: files.workspace,
      sequence: 1,
      authorizationPath: files.authorizationPath,
      at: fixedNow
    }),
    /locked by default/
  );
  let invocations = 0;
  const first = await runShardJob({
    workspacePath: files.workspace,
    sequence: 1,
    authorizationPath: files.authorizationPath,
    fetchMode: true,
    at: fixedNow,
    ingestionRunner: async ({ entries, fetchMode, authorization: grant }) => {
      invocations += 1;
      assert.ok(entries.length > 0 && entries.length <= 2);
      assert.ok(entries.every((entry) => Object.keys(entry).join() === "sourceUrl"));
      assert.equal(fetchMode, true);
      assert.deepEqual(grant, authorization());
      return {
        summary: { completed: entries.length, skipped: 0, failed: 0, deduplicated: 0 },
        validation: { valid: true, productCount: entries.length, invalidProductCount: 0 }
      };
    }
  });
  assert.equal(first.skipped, false);
  assert.equal(first.result.storefrontPublished, false);
  assert.equal(invocations, 1);
  const resumed = await runShardJob({
    workspacePath: files.workspace,
    sequence: 1,
    authorizationPath: files.authorizationPath,
    fetchMode: true,
    at: fixedNow,
    ingestionRunner: async () => {
      throw new Error("completed shard must not run again");
    }
  });
  assert.equal(resumed.skipped, true);
  assert.deepEqual((await shardJobStatus(files.workspace)).counts, {
    pending: 2,
    running: 0,
    completed: 1,
    failed: 0
  });
});

test("revalidates authorization and rejects a changed grant or changed shard", async (t) => {
  const files = await fixture();
  t.after(() => rm(files.root, { recursive: true, force: true }));
  await createShardJobPlan({
    indexPath: path.join(files.manifestDirectory, "index.json"),
    workspacePath: files.workspace,
    authorizationPath: files.authorizationPath,
    at: fixedNow
  });
  await writeFile(files.authorizationPath, `${JSON.stringify({ ...authorization(), reviewedBy: "Different reviewer" }, null, 2)}\n`, "utf8");
  await assert.rejects(
    runShardJob({
      workspacePath: files.workspace,
      sequence: 1,
      authorizationPath: files.authorizationPath,
      fetchMode: true,
      at: fixedNow,
      ingestionRunner: async () => { throw new Error("must not execute"); }
    }),
    /Authorization file changed/
  );
});
