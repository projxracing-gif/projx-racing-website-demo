#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(repo, "assets", "tegiwa-vehicle-directory.js");
const EXPECTED_MAKE_COUNT = 37;
const EXPECTED_MODEL_COUNT = 418;
const EXPECTED_MODEL_COUNTS = new Map([
  ["Alfa Romeo", 15],
  ["Audi", 50],
  ["Bentley", 2],
  ["BMW", 50],
  ["Chevrolet", 6],
  ["Citroen", 3],
  ["Cupra", 8],
  ["Dodge", 2],
  ["Fiat", 4],
  ["Ford", 12],
  ["Honda", 36],
  ["Hyundai", 3],
  ["Infiniti", 3],
  ["Jaguar", 1],
  ["KIA", 1],
  ["Lamborghini", 4],
  ["Lexus", 5],
  ["Lotus", 9],
  ["Maserati", 5],
  ["Mazda", 8],
  ["Mclaren", 2],
  ["Mercedes", 27],
  ["Mini", 6],
  ["Mitsubishi", 11],
  ["Nissan", 13],
  ["Peugeot", 6],
  ["Porsche", 22],
  ["Renault", 14],
  ["Seat", 6],
  ["Skoda", 6],
  ["Subaru", 14],
  ["Suzuki", 10],
  ["Tesla", 4],
  ["Toyota", 18],
  ["Vauxhall", 7],
  ["Volkswagen", 21],
  ["Volvo", 4],
]);

const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

assert(fs.existsSync(sourcePath), "Vehicle directory snapshot is missing.");

const context = { window: {} };
vm.createContext(context);
if (fs.existsSync(sourcePath)) {
  vm.runInContext(fs.readFileSync(sourcePath, "utf8"), context, {
    filename: "assets/tegiwa-vehicle-directory.js",
  });
}

const directory = context.window.PROJX_TEGIWA_VEHICLE_DIRECTORY;
assert(directory && typeof directory === "object", "Vehicle directory did not load.");

if (directory) {
  assert(directory.schemaVersion === 1, "Unexpected vehicle directory schema.");
  assert(
    directory.entryType === "supplier-directory",
    "Entries must remain marked as supplier-directory data.",
  );
  assert(
    directory.engineSelection === "Confirm engine",
    'Engine selection must remain "Confirm engine".',
  );
  assert(
    directory.provenance?.directoryUrl ===
      "https://www.tegiwa.com/collections/select-your-car",
    "Unexpected vehicle-directory provenance URL.",
  );
  assert(
    directory.provenance?.retrievedDate === "2026-08-03",
    "Unexpected vehicle-directory retrieval date.",
  );
  assert(Array.isArray(directory.makes), "Vehicle makes must be an array.");

  const makes = Array.isArray(directory.makes) ? directory.makes : [];
  const makeLabels = makes.map(({ make }) => make);
  const duplicateMakes = makeLabels.filter(
    (make, index) => makeLabels.indexOf(make) !== index,
  );

  assert(
    makes.length === EXPECTED_MAKE_COUNT,
    `Expected ${EXPECTED_MAKE_COUNT} makes; found ${makes.length}.`,
  );
  assert(
    makeLabels.every((make) => typeof make === "string" && make.trim() === make),
    "Make labels must be non-empty, trimmed strings.",
  );
  assert(!duplicateMakes.length, `Duplicate makes: ${[...new Set(duplicateMakes)]}.`);

  let totalModels = 0;
  for (const entry of makes) {
    const models = Array.isArray(entry.models) ? entry.models : [];
    totalModels += models.length;

    assert(
      EXPECTED_MODEL_COUNTS.has(entry.make),
      `Unexpected make: ${entry.make || "(empty)"}.`,
    );
    assert(
      models.length === EXPECTED_MODEL_COUNTS.get(entry.make),
      `${entry.make}: expected ${EXPECTED_MODEL_COUNTS.get(entry.make)} models; found ${models.length}.`,
    );
    assert(
      models.every(
        (label) => typeof label === "string" && label.length > 0 && label.trim() === label,
      ),
      `${entry.make}: model labels must be non-empty, trimmed strings.`,
    );

    const duplicateModels = models.filter(
      (label, index) => models.indexOf(label) !== index,
    );
    assert(
      !duplicateModels.length,
      `${entry.make}: duplicate model labels: ${[...new Set(duplicateModels)]}.`,
    );

    try {
      const sourceUrl = new URL(entry.sourceUrl);
      assert(sourceUrl.protocol === "https:", `${entry.make}: source URL is not HTTPS.`);
      assert(
        sourceUrl.hostname === "www.tegiwa.com",
        `${entry.make}: source URL is not on the official Tegiwa domain.`,
      );
      assert(
        sourceUrl.pathname.startsWith("/collections/"),
        `${entry.make}: source URL is not a Tegiwa collection.`,
      );
    } catch {
      assert(false, `${entry.make}: invalid source URL.`);
    }
  }

  assert(
    EXPECTED_MODEL_COUNTS.size === makes.length,
    "Expected make-count map and snapshot are out of sync.",
  );
  assert(
    totalModels === EXPECTED_MODEL_COUNT,
    `Expected ${EXPECTED_MODEL_COUNT} total model labels; found ${totalModels}.`,
  );
  assert(
    directory.counts?.makes === EXPECTED_MAKE_COUNT &&
      directory.counts?.models === EXPECTED_MODEL_COUNT,
    "Published directory counts are out of sync with the validated snapshot.",
  );
}

if (failures.length) {
  failures.forEach((failure) => console.error(`FAILED: ${failure}`));
  process.exit(1);
}

console.log(
  `Tegiwa vehicle directory passed: ${EXPECTED_MAKE_COUNT} makes and ${EXPECTED_MODEL_COUNT} unique make-scoped model labels.`,
);
