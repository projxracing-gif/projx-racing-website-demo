import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildUrlManifests,
  parseArguments,
  resolveSafeOutputPath
} from "./build-url-manifests.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readAllManifestUrls(output, index) {
  const urls = [];
  for (const entry of index.manifests) {
    const contents = await readFile(path.join(output, entry.file), "utf8");
    assert.equal(Buffer.byteLength(contents, "utf8"), entry.bytes);
    assert.equal(digest(contents), entry.sha256);
    const manifest = JSON.parse(contents);
    assert.equal(manifest.urlCount, manifest.entries.length);
    assert.ok(manifest.entries.every((value) => typeof value === "string"));
    urls.push(...manifest.entries);
  }
  return urls;
}

test("offline URL intake canonicalizes, deduplicates, bounds and checksums manifests", async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), "projx-ecs-url-manifests-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const input = path.join(workspace, "ecs-urls.txt");
  const output = path.join(workspace, "prepared");
  await writeFile(
    input,
    [
      "\uFEFFurl",
      "# ECS-provided public product URLs",
      "",
      "https://ecstuning.com/b-test-brand-parts/group/product-one?campaign=dealer#details",
      "https://www.ecstuning.com//b-test-brand-parts/group/product-one/",
      "https://www.ecstuning.com/b-test-brand-parts/group/product-two",
      "https://www.ecstuning.com/b-other-brand-parts/group/product-three/"
    ].join("\r\n"),
    "utf8"
  );

  const result = await buildUrlManifests({
    inputPath: input,
    outputPath: output,
    maxUrls: 2,
    maxBytes: 8 * 1024,
    bucketCount: 4,
    generatedAt: "2026-08-05T00:00:00.000Z"
  });

  assert.equal(result.offlineOnly, true);
  assert.equal(result.counts.inputLines, 7);
  assert.equal(result.counts.candidateLines, 4);
  assert.equal(result.counts.acceptedEntries, 4);
  assert.equal(result.counts.uniqueUrls, 3);
  assert.equal(result.counts.duplicateUrls, 1);
  assert.equal(result.counts.invalidLines, 0);
  assert.equal(result.counts.manifests, 2);
  assert.equal((await readdir(output)).includes(".buckets"), false);

  const urls = await readAllManifestUrls(output, result);
  assert.deepEqual(
    [...urls].sort(),
    [
      "https://www.ecstuning.com/b-other-brand-parts/group/product-three/",
      "https://www.ecstuning.com/b-test-brand-parts/group/product-one/",
      "https://www.ecstuning.com/b-test-brand-parts/group/product-two/"
    ].sort()
  );
  assert.equal(new Set(urls).size, urls.length);
  for (const entry of result.manifests) {
    assert.ok(entry.urlCount <= 2);
    assert.ok(entry.bytes <= 8 * 1024);
  }

  const indexContents = await readFile(path.join(output, "index.json"), "utf8");
  const checksumContents = await readFile(path.join(output, "index.json.sha256"), "utf8");
  assert.equal(checksumContents, `${digest(indexContents)}  index.json\n`);
  assert.equal(result.indexSha256, digest(indexContents));
});

test("invalid input fails closed and publishes no output directory", async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), "projx-ecs-url-invalid-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const input = path.join(workspace, "ecs-urls.txt");
  const output = path.join(workspace, "prepared");
  await writeFile(
    input,
    [
      "https://www.ecstuning.com/b-test-brand-parts/group/valid-product/",
      "https://example.com/b-test-brand-parts/group/not-ecs/",
      "https://www.ecstuning.com/account/"
    ].join("\n"),
    "utf8"
  );

  await assert.rejects(
    buildUrlManifests({ inputPath: input, outputPath: output, bucketCount: 4 }),
    /contains 2 invalid line\(s\); no manifests were published/
  );
  await assert.rejects(lstat(output), { code: "ENOENT" });
  assert.deepEqual((await readdir(workspace)).sort(), ["ecs-urls.txt"]);
});

test("repository output is allowed only below private-imports and never overwritten", async (t) => {
  const unsafe = path.join(repoRoot, "docs", `.ecs-url-output-${process.pid}`);
  await assert.rejects(resolveSafeOutputPath(unsafe), /must be a directory below ignored private-imports/);

  const privateParent = path.join(repoRoot, "private-imports", `.url-manifest-test-${process.pid}`);
  const privateOutput = path.join(privateParent, "snapshot");
  t.after(() => rm(privateParent, { recursive: true, force: true }));
  await mkdir(privateParent, { recursive: true });
  assert.equal(await resolveSafeOutputPath(privateOutput), privateOutput);
  await mkdir(privateOutput);
  await assert.rejects(resolveSafeOutputPath(privateOutput), /already exists and will not be overwritten/);
});

test("argument parser rejects unknown command options", () => {
  assert.deepEqual(parseArguments(["--input", "urls.txt", "--output", "private-imports/out"]), {
    input: "urls.txt",
    output: "private-imports/out"
  });
  assert.throws(() => parseArguments(["--fetch"]), /Unexpected argument: --fetch/);
});
