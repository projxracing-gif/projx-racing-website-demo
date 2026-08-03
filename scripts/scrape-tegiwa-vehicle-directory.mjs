#!/usr/bin/env node

/**
 * Read-only extractor for Tegiwa's public two-stage vehicle directory.
 *
 * This script never writes project files. It prints the current supplier labels
 * as JSON so updates can be reviewed before the committed snapshot is changed.
 * An optional --output=<scratch-path> argument is available for large audit runs.
 * Official source retrieved for the current snapshot on 2026-08-03:
 * https://www.tegiwa.com/collections/select-your-car
 */

const ROOT_URL = "https://www.tegiwa.com";
const DIRECTORY_URL = `${ROOT_URL}/collections/select-your-car`;
const MAX_ATTEMPTS = 3;
const CONCURRENCY = 4;
const outputArgument = process.argv.find((argument) =>
  argument.startsWith("--output="),
);

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const decodeHtml = (value) =>
  value
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

async function fetchHtml(url) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "Projx-Racing-directory-audit/1.0",
        },
        redirect: "follow",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(500 * attempt);
      }
    }
  }

  throw new Error(`${url}: ${lastError?.message || "request failed"}`);
}

function extractDirectoryCards(html) {
  const cards = [];
  const cardPattern =
    /<div\s+class="mdb-collection-list-item-container"[^>]*>([\s\S]*?)<\/a>\s*<\/div>/gi;

  for (const match of html.matchAll(cardPattern)) {
    const body = match[1];
    const href = body.match(/<a\s+href="([^"]+)"/i)?.[1];
    const heading = body.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1];
    if (!href || !heading) continue;

    cards.push({
      label: decodeHtml(heading),
      path: decodeHtml(href),
    });
  }

  return cards;
}

function assertUniqueNonEmpty(items, field, context) {
  const values = items.map((item) => item[field]);
  const empty = values.filter((value) => !value);
  const duplicates = values.filter(
    (value, index) => values.indexOf(value) !== index,
  );

  if (empty.length || duplicates.length) {
    throw new Error(
      `${context}: empty=${empty.length}, duplicates=${[
        ...new Set(duplicates),
      ].join(", ") || "none"}`,
    );
  }
}

async function mapConcurrent(items, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, runWorker),
  );
  return results;
}

async function main() {
  const directoryHtml = await fetchHtml(DIRECTORY_URL);
  const manufacturers = extractDirectoryCards(directoryHtml)
    .filter(({ path }) => /^\/collections\/[a-z0-9-]+\/?$/i.test(path))
    .map(({ label, path }) => ({
      make: label,
      sourceUrl: new URL(path, ROOT_URL).href,
    }));

  if (manufacturers.length !== 37) {
    throw new Error(
      `manufacturer directory: expected 37 cards, found ${manufacturers.length}`,
    );
  }

  assertUniqueNonEmpty(manufacturers, "make", "manufacturer directory");
  assertUniqueNonEmpty(manufacturers, "sourceUrl", "manufacturer URLs");

  const failures = [];
  const entries = await mapConcurrent(manufacturers, async (manufacturer) => {
    try {
      const html = await fetchHtml(manufacturer.sourceUrl);
      const modelCards = extractDirectoryCards(html);
      const models = [...new Set(modelCards.map(({ label }) => label))];

      if (!models.length) {
        throw new Error("no Stage 2 model cards found");
      }

      assertUniqueNonEmpty(
        models.map((label) => ({ label })),
        "label",
        manufacturer.make,
      );

      return {
        ...manufacturer,
        selectionMode: "supplier-directory",
        engineSelection: "Confirm engine",
        models,
      };
    } catch (error) {
      failures.push({
        make: manufacturer.make,
        sourceUrl: manufacturer.sourceUrl,
        error: error.message,
      });
      return {
        ...manufacturer,
        selectionMode: "supplier-directory",
        engineSelection: "Confirm engine",
        models: [],
      };
    }
  });

  const result = {
    provenance: {
      supplier: "Tegiwa",
      directoryUrl: DIRECTORY_URL,
      retrievedDate: "2026-08-03",
      note: "Supplier directory labels only; vehicle engine must be confirmed.",
    },
    counts: {
      makes: entries.length,
      models: entries.reduce((sum, entry) => sum + entry.models.length, 0),
      failedPages: failures.length,
    },
    failures,
    makes: entries,
  };

  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (outputArgument) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(outputArgument.slice("--output=".length), serialized, "utf8");
  } else {
    process.stdout.write(serialized);
  }
  if (failures.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
