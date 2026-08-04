import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  writeFile
} from "node:fs/promises";
import path from "node:path";

export const SCHEMA_VERSION = 1;

export const AUTOMATION_ACKNOWLEDGEMENT =
  "I CONFIRM THAT ECS TUNING HAS GRANTED WRITTEN PERMISSION FOR AUTOMATED ACCESS TO THE URLS IN THIS RUN.";

const ALLOWED_PRODUCT_KEYS = new Set([
  "schemaVersion",
  "supplier",
  "title",
  "brand",
  "ecsSku",
  "manufacturerMpn",
  "publicPrice",
  "publicAvailability",
  "sourceUrl",
  "checkedAt",
  "imageUrls",
  "fitment",
  "category"
]);

const FORBIDDEN_KEY =
  /(?:dealer|wholesale|trade|tax|vat|cost|margin|credential|password|secret|token|api[-_]?key|cookie|session)/i;

const HTML_ENTITY_MAP = Object.freeze({
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"'
});

function decodeHtml(value = "") {
  return String(value).replace(
    /&(#x?[0-9a-f]+|[a-z]+);/gi,
    (match, entity) => {
      if (entity[0] === "#") {
        const hexadecimal = entity[1]?.toLowerCase() === "x";
        const parsed = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
        return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : match;
      }
      return HTML_ENTITY_MAP[entity.toLowerCase()] ?? match;
    }
  );
}
function cleanText(value = "") {
  return decodeHtml(String(value))
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textLines(html) {
  return decodeHtml(
    String(html)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<\/(?:div|p|h[1-6]|li|tr|td|th|section)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
  )
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function metaContent(html, key, attribute = "property") {
  const escapedKey = escapeRegExp(key);
  const patterns = [
    new RegExp(
      `<meta\\b[^>]*${attribute}=["']${escapedKey}["'][^>]*content=["']([^"']+)["'][^>]*>`,
      "i"
    ),
    new RegExp(
      `<meta\\b[^>]*content=["']([^"']+)["'][^>]*${attribute}=["']${escapedKey}["'][^>]*>`,
      "i"
    )
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return cleanText(match[1]);
  }
  return "";
}

function labelValue(lines, labels) {
  const normalizedLabels = labels.map((label) => label.toLowerCase().replace(/\s+/g, " "));
  for (let index = 0; index < lines.length; index += 1) {
    const normalizedLine = lines[index].toLowerCase().replace(/\s+/g, " ");
    for (const label of normalizedLabels) {
      if (normalizedLine === label || normalizedLine === `${label}:`) {
        return lines[index + 1] ?? "";
      }
      if (normalizedLine.startsWith(`${label}:`)) {
        return lines[index].slice(lines[index].indexOf(":") + 1).trim();
      }
    }
  }
  return "";
}

function flattenJsonLd(value) {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== "object") return [];
  const graph = Array.isArray(value["@graph"]) ? value["@graph"].flatMap(flattenJsonLd) : [];
  return [value, ...graph];
}

function jsonLdObjects(html) {
  const objects = [];
  const pattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      objects.push(...flattenJsonLd(JSON.parse(decodeHtml(match[1]).trim())));
    } catch {
      // A malformed analytics block must not prevent the visible product data fallback.
    }
  }
  return objects;
}

function hasType(value, type) {
  const types = Array.isArray(value?.["@type"]) ? value["@type"] : [value?.["@type"]];
  return types.some((candidate) => String(candidate).toLowerCase() === type.toLowerCase());
}

function firstOffer(product) {
  const offers = Array.isArray(product?.offers) ? product.offers : [product?.offers];
  return offers.find((offer) => offer && typeof offer === "object") ?? {};
}

function brandName(value) {
  if (typeof value === "string") return cleanText(value);
  if (value && typeof value === "object") return cleanText(value.name ?? value["@id"] ?? "");
  return "";
}

function imageUrlsFrom(product, html, sourceUrl) {
  const values = [];
  const add = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(add);
      return;
    }
    if (typeof value === "object") {
      add(value.url ?? value.contentUrl);
      return;
    }
    try {
      const url = new URL(String(value), sourceUrl);
      if (url.protocol === "https:") values.push(url.href);
    } catch {
      // Invalid images are omitted and reported by the product validator.
    }
  };
  add(product?.image);
  add(metaContent(html, "og:image"));
  return [...new Set(values)];
}

function publicAvailability(product, html, lines) {
  const offer = firstOffer(product);
  const explicit =
    metaContent(html, "projx:public-availability", "name") ||
    labelValue(lines, ["Availability", "Availability / status"]);
  if (explicit) return cleanText(explicit);
  const schemaValue = String(offer.availability ?? "").split("/").pop() ?? "";
  return cleanText(schemaValue.replace(/([a-z])([A-Z])/g, "$1 $2"));
}

function extractFitment(product, html) {
  const values = [];
  const properties = Array.isArray(product?.additionalProperty)
    ? product.additionalProperty
    : [product?.additionalProperty];
  for (const property of properties) {
    if (!property || typeof property !== "object") continue;
    if (/fitment|vehicle|application/i.test(String(property.name ?? ""))) {
      const value = cleanText(property.value ?? property.description ?? "");
      if (value) values.push(value);
    }
  }
  const metaFitment = metaContent(html, "projx:fitment", "name");
  if (metaFitment) {
    values.push(...metaFitment.split("|").map(cleanText).filter(Boolean));
  }
  return [...new Set(values)];
}

function extractCategory(product, html, jsonLd) {
  const direct = cleanText(
    product?.category || metaContent(html, "product:category") || metaContent(html, "projx:category", "name")
  );
  if (direct) return direct;
  const breadcrumb = jsonLd.find((object) => hasType(object, "BreadcrumbList"));
  const items = Array.isArray(breadcrumb?.itemListElement) ? breadcrumb.itemListElement : [];
  const names = items.map((item) => cleanText(item?.name ?? item?.item?.name ?? "")).filter(Boolean);
  return names.slice(-2, -1)[0] ?? "";
}

function normalizeEcsSku(value) {
  const match = cleanText(value).match(/ES\s*#?\s*(\d+)/i);
  return match ? `ES#${match[1]}` : "";
}

function normalizePrice(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(2)) : null;
}

function extractVisiblePrice(html, lines) {
  const metaPrice =
    metaContent(html, "product:price:amount") ||
    html.match(/itemprop=["']price["'][^>]*content=["']([0-9.,]+)["']/i)?.[1] ||
    html.match(/content=["']([0-9.,]+)["'][^>]*itemprop=["']price["']/i)?.[1];
  if (metaPrice) return metaPrice;
  const priceLabel = labelValue(lines, ["Public price", "Price"]);
  return priceLabel.match(/\$?\s*([0-9][0-9,.]*)/)?.[1] ?? "";
}

export function canonicalizeProductUrl(value) {
  const url = new URL(String(value));
  if (url.protocol !== "https:") throw new Error(`Product URL must use HTTPS: ${value}`);
  url.hostname = url.hostname.toLowerCase();
  if (url.hostname !== "www.ecstuning.com" && url.hostname !== "ecstuning.com") {
    throw new Error(`Product URL is not on the ECS Tuning public host: ${value}`);
  }
  url.hostname = "www.ecstuning.com";
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}

export function parseProductHtml(html, { sourceUrl, checkedAt }) {
  const canonicalUrl = canonicalizeProductUrl(sourceUrl);
  const jsonLd = jsonLdObjects(html);
  const product = jsonLd.find((object) => hasType(object, "Product")) ?? {};
  const offer = firstOffer(product);
  const lines = textLines(html);

  const title = cleanText(
    product.name ||
      metaContent(html, "og:title") ||
      html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
      ""
  );
  const ecsSku = normalizeEcsSku(product.sku || labelValue(lines, ["ECS Part #", "ECS Part#", "ECS SKU"]));
  const manufacturerMpn = cleanText(
    product.mpn || labelValue(lines, ["Mfg Part #", "MFG Part#", "Manufacturer part number", "MPN"])
  );
  const brand = brandName(product.brand) || labelValue(lines, ["Brand"]);
  const priceAmount = normalizePrice(offer.price ?? extractVisiblePrice(html, lines));
  const currency = cleanText(
    offer.priceCurrency || metaContent(html, "product:price:currency") || "USD"
  ).toUpperCase();

  return {
    schemaVersion: SCHEMA_VERSION,
    supplier: "ECS Tuning",
    title,
    brand: cleanText(brand),
    ecsSku,
    manufacturerMpn,
    publicPrice: {
      amount: priceAmount,
      currency,
      display: priceAmount === null ? "" : `$${priceAmount.toFixed(2)}`
    },
    publicAvailability: publicAvailability(product, html, lines),
    sourceUrl: canonicalUrl,
    checkedAt: new Date(checkedAt).toISOString(),
    imageUrls: imageUrlsFrom(product, html, canonicalUrl),
    fitment: extractFitment(product, html),
    category: extractCategory(product, html, jsonLd)
  };
}

export function normalizeManualRecord(record, { sourceUrl, checkedAt }) {
  const normalized = {
    schemaVersion: SCHEMA_VERSION,
    supplier: "ECS Tuning",
    title: cleanText(record.title),
    brand: cleanText(record.brand),
    ecsSku: normalizeEcsSku(record.ecsSku),
    manufacturerMpn: cleanText(record.manufacturerMpn),
    publicPrice: {
      amount: normalizePrice(record.publicPrice?.amount),
      currency: cleanText(record.publicPrice?.currency || "USD").toUpperCase(),
      display: ""
    },
    publicAvailability: cleanText(record.publicAvailability),
    sourceUrl: canonicalizeProductUrl(sourceUrl || record.sourceUrl),
    checkedAt: new Date(checkedAt || record.checkedAt).toISOString(),
    imageUrls: [...new Set((record.imageUrls ?? []).map(String))],
    fitment: [...new Set((record.fitment ?? []).map(cleanText).filter(Boolean))],
    category: cleanText(record.category)
  };
  if (normalized.publicPrice.amount !== null) {
    normalized.publicPrice.display = `$${normalized.publicPrice.amount.toFixed(2)}`;
  }
  return normalized;
}

function validateHttpsUrl(value, label, errors, allowedHosts = null) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") errors.push(`${label} must use HTTPS`);
    if (allowedHosts && !allowedHosts.has(url.hostname.toLowerCase())) {
      errors.push(`${label} uses an unapproved host: ${url.hostname}`);
    }
  } catch {
    errors.push(`${label} is not a valid URL`);
  }
}

export function validateProduct(record) {
  const errors = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return ["Product must be an object"];
  }
  for (const key of Object.keys(record)) {
    if (!ALLOWED_PRODUCT_KEYS.has(key)) errors.push(`Unexpected product field: ${key}`);
    if (FORBIDDEN_KEY.test(key)) errors.push(`Forbidden product field: ${key}`);
  }
  if (record.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (record.supplier !== "ECS Tuning") errors.push("supplier must be ECS Tuning");
  for (const field of ["title", "brand", "manufacturerMpn", "publicAvailability", "category"]) {
    if (typeof record[field] !== "string" || !record[field].trim()) errors.push(`${field} is required`);
  }
  if (!/^ES#\d+$/.test(record.ecsSku ?? "")) errors.push("ecsSku must match ES# followed by digits");
  if (!record.publicPrice || typeof record.publicPrice !== "object") {
    errors.push("publicPrice is required");
  } else {
    const allowedPriceKeys = new Set(["amount", "currency", "display"]);
    for (const key of Object.keys(record.publicPrice)) {
      if (!allowedPriceKeys.has(key)) errors.push(`Unexpected publicPrice field: ${key}`);
      if (FORBIDDEN_KEY.test(key)) errors.push(`Forbidden publicPrice field: ${key}`);
    }
    if (!Number.isFinite(record.publicPrice.amount) || record.publicPrice.amount < 0) {
      errors.push("publicPrice.amount must be a non-negative number");
    }
    if (record.publicPrice.currency !== "USD") errors.push("publicPrice.currency must be USD");
    if (record.publicPrice.display !== `$${Number(record.publicPrice.amount).toFixed(2)}`) {
      errors.push("publicPrice.display does not match the public USD amount");
    }
  }
  validateHttpsUrl(record.sourceUrl, "sourceUrl", errors, new Set(["www.ecstuning.com"]));
  if (!Number.isFinite(Date.parse(record.checkedAt))) errors.push("checkedAt must be an ISO timestamp");
  if (!Array.isArray(record.imageUrls) || record.imageUrls.length === 0) {
    errors.push("imageUrls must contain at least one image");
  } else {
    record.imageUrls.forEach((url, index) => validateHttpsUrl(url, `imageUrls[${index}]`, errors));
  }
  if (!Array.isArray(record.fitment) || record.fitment.length === 0) {
    errors.push("fitment must contain at least one public fitment/application value");
  }
  return [...new Set(errors)];
}

export function validateCatalog(records) {
  const results = records.map((record, index) => ({
    index,
    ecsSku: record?.ecsSku ?? "",
    sourceUrl: record?.sourceUrl ?? "",
    errors: validateProduct(record)
  }));
  const duplicateSkus = findDuplicates(records.map((record) => record.ecsSku));
  const duplicateUrls = findDuplicates(records.map((record) => record.sourceUrl));
  return {
    valid: results.every((result) => result.errors.length === 0) && duplicateSkus.length === 0 && duplicateUrls.length === 0,
    productCount: records.length,
    invalidProductCount: results.filter((result) => result.errors.length > 0).length,
    duplicateSkus,
    duplicateUrls,
    products: results
  };
}

function findDuplicates(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values.filter(Boolean)) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

async function readJsonIfPresent(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeTimestamp(value) {
  return new Date(value).toISOString().replace(/[:.]/g, "-");
}

function newerRecord(left, right) {
  return Date.parse(right.checkedAt) >= Date.parse(left.checkedAt) ? right : left;
}

function dedupeRecords(records) {
  const bySku = new Map();
  const byUrl = new Map();
  for (const record of records) {
    const existing = bySku.get(record.ecsSku) ?? byUrl.get(record.sourceUrl);
    const winner = existing ? newerRecord(existing, record) : record;
    if (existing && existing !== winner) {
      bySku.delete(existing.ecsSku);
      byUrl.delete(existing.sourceUrl);
    }
    bySku.set(winner.ecsSku, winner);
    byUrl.set(winner.sourceUrl, winner);
  }
  return [...new Set(bySku.values())].sort((left, right) => left.ecsSku.localeCompare(right.ecsSku));
}

export function validateAutomationAuthorization(value, entries, at = new Date()) {
  const errors = [];
  if (!value || typeof value !== "object") return ["Authorization file must contain a JSON object"];
  if (value.acknowledgement !== AUTOMATION_ACKNOWLEDGEMENT) {
    errors.push("The exact automated-access acknowledgement is missing");
  }
  if (typeof value.grantedBy !== "string" || !value.grantedBy.trim()) {
    errors.push("grantedBy is required");
  }
  if (typeof value.permissionReference !== "string" || !value.permissionReference.trim()) {
    errors.push("permissionReference is required");
  }
  if (!Array.isArray(value.allowedHosts) || !value.allowedHosts.includes("www.ecstuning.com")) {
    errors.push("allowedHosts must explicitly include www.ecstuning.com");
  }
  if (!Number.isFinite(Date.parse(value.validUntil)) || Date.parse(value.validUntil) < at.getTime()) {
    errors.push("validUntil must be a future ISO timestamp");
  }
  for (const entry of entries) {
    try {
      const host = new URL(entry.sourceUrl).hostname.toLowerCase();
      if (!value.allowedHosts?.includes(host) && !(host === "ecstuning.com" && value.allowedHosts?.includes("www.ecstuning.com"))) {
        errors.push(`Authorization does not include host: ${host}`);
      }
    } catch {
      errors.push(`Invalid authorized URL: ${entry.sourceUrl}`);
    }
  }
  return [...new Set(errors)];
}

export async function fetchWithRetry(url, options = {}) {
  const retries = Math.max(0, Math.min(5, Number(options.retries ?? 3)));
  const timeoutMs = Math.max(1_000, Number(options.timeoutMs ?? 30_000));
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "ProjxRacingAuthorizedCatalogueIngest/1.0"
        },
        redirect: "follow",
        signal: controller.signal
      });
      if (response.ok) return await response.text();
      if (response.status !== 429 && response.status < 500) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      lastError = new Error(`HTTP ${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < retries) {
      const waitMs = Math.min(60_000, 1_000 * 2 ** attempt);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw lastError;
}

export async function runIngestion({
  entries,
  outputDir,
  fetchMode = false,
  authorization = null,
  rateLimitMs = 5_000,
  retries = 3,
  timeoutMs = 30_000,
  refresh = false
}) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("At least one manifest entry is required");
  const normalizedOutput = path.resolve(outputDir);
  const rawDir = path.join(normalizedOutput, "raw");
  const statePath = path.join(normalizedOutput, "checkpoint.json");
  const catalogPath = path.join(normalizedOutput, "catalog.json");
  const validationPath = path.join(normalizedOutput, "validation.json");
  await mkdir(rawDir, { recursive: true });

  if (fetchMode) {
    const authErrors = validateAutomationAuthorization(authorization, entries);
    if (authErrors.length) throw new Error(`Automated access is not authorized:\n- ${authErrors.join("\n- ")}`);
  }

  const state = await readJsonIfPresent(statePath, {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    updatedAt: null,
    items: {}
  });
  const existingCatalog = await readJsonIfPresent(catalogPath, { products: [] });
  const collected = Array.isArray(existingCatalog.products) ? [...existingCatalog.products] : [];
  const summary = { completed: 0, skipped: 0, failed: 0, deduplicated: 0 };
  let lastNetworkRequestAt = 0;

  for (const entry of entries) {
    const canonicalUrl = canonicalizeProductUrl(entry.sourceUrl);
    const key = sha256(canonicalUrl);
    if (!refresh && state.items[key]?.status === "completed") {
      summary.skipped += 1;
      continue;
    }

    const checkedAt = new Date(entry.collectedAt ?? new Date()).toISOString();
    state.items[key] = {
      sourceUrl: canonicalUrl,
      status: "processing",
      attempts: Number(state.items[key]?.attempts ?? 0) + 1,
      updatedAt: new Date().toISOString(),
      error: null,
      rawSnapshot: state.items[key]?.rawSnapshot ?? null,
      ecsSku: state.items[key]?.ecsSku ?? null
    };
    state.updatedAt = new Date().toISOString();
    await writeJsonAtomic(statePath, state);

    try {
      let record;
      let rawPath;
      if (entry.record && typeof entry.record === "object") {
        record = normalizeManualRecord(entry.record, { sourceUrl: canonicalUrl, checkedAt });
        rawPath = path.join(rawDir, `${safeTimestamp(checkedAt)}-${key}.json`);
        await writeJsonAtomic(rawPath, entry.record);
      } else {
        let html;
        if (entry.snapshotPath) {
          const sourcePath = path.resolve(entry.snapshotPath);
          html = await readFile(sourcePath, "utf8");
          rawPath = path.join(rawDir, `${safeTimestamp(checkedAt)}-${key}.html`);
          await copyFile(sourcePath, rawPath);
        } else {
          if (!fetchMode) {
            throw new Error("Entry needs snapshotPath or record unless the separately authorized --fetch mode is enabled");
          }
          const elapsed = Date.now() - lastNetworkRequestAt;
          const minimumDelay = Math.max(2_000, Number(rateLimitMs));
          if (elapsed < minimumDelay) {
            await new Promise((resolve) => setTimeout(resolve, minimumDelay - elapsed));
          }
          html = await fetchWithRetry(canonicalUrl, { retries, timeoutMs });
          lastNetworkRequestAt = Date.now();
          rawPath = path.join(rawDir, `${safeTimestamp(checkedAt)}-${key}.html`);
          await writeFile(rawPath, html, "utf8");
        }
        record = parseProductHtml(html, { sourceUrl: canonicalUrl, checkedAt });
      }

      const errors = validateProduct(record);
      if (errors.length) throw new Error(`Product validation failed:\n- ${errors.join("\n- ")}`);
      collected.push(record);
      state.items[key] = {
        ...state.items[key],
        status: "completed",
        updatedAt: new Date().toISOString(),
        rawSnapshot: path.relative(normalizedOutput, rawPath).replace(/\\/g, "/"),
        ecsSku: record.ecsSku
      };
      summary.completed += 1;
    } catch (error) {
      state.items[key] = {
        ...state.items[key],
        status: "failed",
        updatedAt: new Date().toISOString(),
        error: String(error?.message ?? error)
      };
      summary.failed += 1;
    }
    state.updatedAt = new Date().toISOString();
    await writeJsonAtomic(statePath, state);
  }

  const products = dedupeRecords(collected);
  summary.deduplicated = collected.length - products.length;
  const validation = validateCatalog(products);
  const catalog = {
    schemaVersion: SCHEMA_VERSION,
    supplier: "ECS Tuning",
    generatedAt: new Date().toISOString(),
    productCount: products.length,
    products
  };
  await writeJsonAtomic(catalogPath, catalog);
  await writeJsonAtomic(validationPath, validation);
  return { summary, catalog, validation, state };
}
