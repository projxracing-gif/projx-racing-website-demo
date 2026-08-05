import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ECS_PRODUCT_SHARD_COUNT,
  ECS_SITEMAP_INDEX,
  fetchApprovedXml,
  normalizeShardUrl,
  parseArguments,
  parseProductSitemap,
  parseSitemapIndex
} from "./collect-sitemaps.mjs";
import { AUTOMATION_ACKNOWLEDGEMENT } from "./lib.mjs";

function indexXml(overrides = new Map()) {
  const locations = [];
  for (let number = 0; number < ECS_PRODUCT_SHARD_COUNT; number += 1) {
    locations.push(overrides.get(number) ?? `https://www.ecstuning.com/sitemap_product_${number}.xml/`);
  }
  return `<?xml version="1.0"?><sitemapindex>${locations.map(value => `<sitemap><loc>${value}</loc></sitemap>`).join("")}</sitemapindex>`;
}

async function authorizationFixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projx-ecs-sitemaps-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "authorization.json");
  const value = {
    acknowledgement: AUTOMATION_ACKNOWLEDGEMENT,
    grantedBy: "ECS Wholesale",
    permissionReference: "document:test-fixture",
    reviewedBy: "Projx Racing",
    reviewedAt: "2026-08-05T00:00:00.000Z",
    validUntil: "2026-09-05T00:00:00.000Z",
    allowedHosts: ["www.ecstuning.com"]
  };
  const contents = `${JSON.stringify(value)}\n`;
  await writeFile(file, contents, "utf8");
  return { file, digest: (await import("node:crypto")).createHash("sha256").update(contents).digest("hex") };
}

test("normalizes only the final slash on the exact 177 approved shard URLs", () => {
  assert.deepEqual(normalizeShardUrl("https://www.ecstuning.com/sitemap_product_0.xml/"), {
    number: 0,
    url: "https://www.ecstuning.com/sitemap_product_0.xml"
  });
  assert.deepEqual(normalizeShardUrl("https://www.ecstuning.com/sitemap_product_176.xml"), {
    number: 176,
    url: "https://www.ecstuning.com/sitemap_product_176.xml"
  });
  assert.throws(() => normalizeShardUrl("https://www.ecstuning.com/sitemap_product_177.xml"), /approved product shard/);
  assert.throws(() => normalizeShardUrl("https://evil.invalid/sitemap_product_0.xml"), /approved public origin/);
  assert.throws(() => normalizeShardUrl("https://www.ecstuning.com/sitemap_product_0.xml/?next=1"), /approved public origin/);
});

test("requires a complete, unique and ordered 177-shard index", () => {
  const shards = parseSitemapIndex(indexXml());
  assert.equal(shards.length, 177);
  assert.deepEqual(shards[0], { number: 0, url: "https://www.ecstuning.com/sitemap_product_0.xml" });
  assert.deepEqual(shards[176], { number: 176, url: "https://www.ecstuning.com/sitemap_product_176.xml" });
  const missing = indexXml(new Map([[176, "https://www.ecstuning.com/sitemap_page.xml/"]]));
  assert.throws(() => parseSitemapIndex(missing), /Expected 177/);
  const duplicate = indexXml(new Map([[176, "https://www.ecstuning.com/sitemap_product_175.xml/"]]));
  assert.throws(() => parseSitemapIndex(duplicate), /Duplicate/);
});

test("canonicalizes and deduplicates only public ECS product paths", () => {
  const xml = `<?xml version="1.0"?><urlset>
    <url><loc>https://www.ecstuning.com/b-brembo-parts/front-rotor/example/</loc></url>
    <url><loc>https://www.ecstuning.com/b-brembo-parts/front-rotor/example/?ignored=1</loc></url>
  </urlset>`;
  assert.deepEqual(parseProductSitemap(xml), ["https://www.ecstuning.com/b-brembo-parts/front-rotor/example/"]);
  assert.deepEqual(
    parseProductSitemap("<urlset><url><loc>https://www.ecstuning.com/b-mahle_behr-parts/87c-thermostat/050121113c~ber/</loc></url></urlset>"),
    ["https://www.ecstuning.com/b-mahle_behr-parts/87c-thermostat/050121113c~ber/"]
  );
  assert.deepEqual(
    parseProductSitemap("<urlset><url><loc>https://www.ecstuning.com/b-k.a.e.-parts/electronic-control-module-relay/357906381a~kae/</loc></url></urlset>"),
    ["https://www.ecstuning.com/b-k.a.e.-parts/electronic-control-module-relay/357906381a~kae/"]
  );
  assert.deepEqual(
    parseProductSitemap("<urlset><url><loc>https://www.ecstuning.com/b-vemo-q+-parts/camshaft-position-sensor/12147539165~vem/</loc></url></urlset>"),
    ["https://www.ecstuning.com/b-vemo-q+-parts/camshaft-position-sensor/12147539165~vem/"]
  );
  assert.deepEqual(
    parseProductSitemap("<urlset><url><loc>https://www.ecstuning.com/b-air-products/expansion-valve/99657392901~apr/</loc></url></urlset>"),
    ["https://www.ecstuning.com/b-air-products/expansion-valve/99657392901~apr/"]
  );
  assert.deepEqual(
    parseProductSitemap("<urlset><url><loc>https://www.ecstuning.com/b-schrick-parts/05601880-00~dk/</loc></url></urlset>"),
    ["https://www.ecstuning.com/b-schrick-parts/05601880-00~dk/"]
  );
  assert.deepEqual(
    parseProductSitemap("<urlset><url><loc>https://www.ecstuning.com/b--advanced-fuel-dynamics-parts/proflex-system/pfc-c51.1~afu/</loc></url></urlset>"),
    ["https://www.ecstuning.com/b--advanced-fuel-dynamics-parts/proflex-system/pfc-c51.1~afu/"]
  );
  assert.throws(
    () => parseProductSitemap("<urlset><url><loc>https://www.ecstuning.com/account/</loc></url></urlset>"),
    /ECS public product path/
  );
});

test("authorized XML fetch refuses redirects without contacting their destination", async (t) => {
  const authorization = await authorizationFixture(t);
  let calls = 0;
  await assert.rejects(
    fetchApprovedXml(ECS_SITEMAP_INDEX, {
      authorizationFile: authorization.file,
      authorizationSha256: authorization.digest,
      retries: 0,
      nowDate: () => new Date("2026-08-05T12:00:00.000Z"),
      fetchImpl: async (_url, options) => {
        calls += 1;
        assert.equal(options.redirect, "manual");
        return new Response("", { status: 302, headers: { location: "https://evil.invalid/" } });
      }
    }),
    /Redirects are not allowed/
  );
  assert.equal(calls, 1);
});

test("authorized XML fetch stops on a Cloudflare challenge", async (t) => {
  const authorization = await authorizationFixture(t);
  await assert.rejects(
    fetchApprovedXml("https://www.ecstuning.com/sitemap_product_0.xml", {
      authorizationFile: authorization.file,
      authorizationSha256: authorization.digest,
      retries: 0,
      nowDate: () => new Date("2026-08-05T12:00:00.000Z"),
      fetchImpl: async () => new Response("<html><title>Just a moment...</title></html>", {
        status: 403,
        headers: { "content-type": "text/html", "cf-mitigated": "challenge", server: "cloudflare" }
      })
    }),
    /interactive access challenge/
  );
});

test("authorized XML fetch accepts a normal same-origin XML response", async (t) => {
  const authorization = await authorizationFixture(t);
  const xml = "<?xml version=\"1.0\"?><urlset><url><loc>https://www.ecstuning.com/b-brand-parts/item/code/</loc></url></urlset>";
  const result = await fetchApprovedXml("https://www.ecstuning.com/sitemap_product_0.xml", {
    authorizationFile: authorization.file,
    authorizationSha256: authorization.digest,
    retries: 0,
    nowDate: () => new Date("2026-08-05T12:00:00.000Z"),
    fetchImpl: async () => new Response(xml, { status: 200, headers: { "content-type": "application/xml" } })
  });
  assert.equal(result, xml);
});

test("collector CLI rejects unknown options and requires values", () => {
  assert.throws(() => parseArguments(["--unknown"]), /Unexpected argument/);
  assert.throws(() => parseArguments(["--output"]), /Missing value/);
  assert.deepEqual(parseArguments(["--fetch", "--retries", "0"]), { fetch: true, retries: "0" });
});
