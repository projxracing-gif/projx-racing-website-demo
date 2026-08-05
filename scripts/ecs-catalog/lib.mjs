import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  realpath,
  rename,
  writeFile
} from "node:fs/promises";
import path from "node:path";

export const SCHEMA_VERSION = 1;
export const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
export const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

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

const ALLOWED_PRICE_KEYS = new Set(["amount", "currency", "display"]);
const ALLOWED_AUTHORIZATION_KEYS = new Set([
  "acknowledgement",
  "grantedBy",
  "permissionReference",
  "reviewedBy",
  "reviewedAt",
  "allowedHosts",
  "validUntil"
]);
const ECS_HOST = "www.ecstuning.com";

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
  if (url.username || url.password) {
    throw new Error(`Product URL must not contain credentials: ${value}`);
  }
  if (url.port) throw new Error(`Product URL must use the default HTTPS port: ${value}`);
  url.hostname = url.hostname.toLowerCase();
  if (url.hostname !== "www.ecstuning.com" && url.hostname !== "ecstuning.com") {
    throw new Error(`Product URL is not on the ECS Tuning public host: ${value}`);
  }
  url.hostname = ECS_HOST;
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  const segments = url.pathname.split("/").filter(Boolean);
  if (
    segments.length < 3 ||
    !/^b-[a-z0-9][a-z0-9-]*-parts$/i.test(segments[0]) ||
    segments.slice(1).some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Product URL does not use an ECS public product path: ${value}`);
  }
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

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function findForbiddenKeys(value, currentPath = "record", errors = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenKeys(item, `${currentPath}[${index}]`, errors));
    return errors;
  }
  if (!value || typeof value !== "object") return errors;
  for (const [key, child] of Object.entries(value)) {
    const fieldPath = `${currentPath}.${key}`;
    if (FORBIDDEN_KEY.test(key)) errors.push(`Forbidden field: ${fieldPath}`);
    findForbiddenKeys(child, fieldPath, errors);
  }
  return errors;
}

export function validateManualRecordInput(record) {
  const errors = [];
  if (!isPlainObject(record)) return ["Manual record must be a JSON object"];
  findForbiddenKeys(record, "record", errors);
  for (const key of Object.keys(record)) {
    if (!ALLOWED_PRODUCT_KEYS.has(key)) errors.push(`Unexpected manual field: record.${key}`);
  }
  if ("schemaVersion" in record && record.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`record.schemaVersion must be ${SCHEMA_VERSION}`);
  }
  if ("supplier" in record && record.supplier !== "ECS Tuning") {
    errors.push("record.supplier must be ECS Tuning");
  }
  for (const field of [
    "title",
    "brand",
    "ecsSku",
    "manufacturerMpn",
    "publicAvailability",
    "sourceUrl",
    "checkedAt",
    "category"
  ]) {
    if (field in record && typeof record[field] !== "string") {
      errors.push(`record.${field} must be a string`);
    }
  }
  if ("publicPrice" in record) {
    if (!isPlainObject(record.publicPrice)) {
      errors.push("record.publicPrice must be an object");
    } else {
      for (const key of Object.keys(record.publicPrice)) {
        if (!ALLOWED_PRICE_KEYS.has(key)) {
          errors.push(`Unexpected manual field: record.publicPrice.${key}`);
        }
      }
      if ("amount" in record.publicPrice && typeof record.publicPrice.amount !== "number") {
        errors.push("record.publicPrice.amount must be a number");
      }
      for (const field of ["currency", "display"]) {
        if (field in record.publicPrice && typeof record.publicPrice[field] !== "string") {
          errors.push(`record.publicPrice.${field} must be a string`);
        }
      }
    }
  }
  for (const field of ["imageUrls", "fitment"]) {
    if (field in record) {
      if (!Array.isArray(record[field])) {
        errors.push(`record.${field} must be an array`);
      } else {
        record[field].forEach((value, index) => {
          if (typeof value !== "string") errors.push(`record.${field}[${index}] must be a string`);
        });
      }
    }
  }
  return [...new Set(errors)];
}

function parseCollectedAt(value, { required = false, at = new Date() } = {}) {
  if ((value === undefined || value === null || value === "") && required) {
    throw new Error("collectedAt is required for every offline manifest entry");
  }
  const candidate = value ?? at;
  if (typeof candidate !== "string" && !(candidate instanceof Date) && typeof candidate !== "number") {
    throw new Error("collectedAt must be an ISO date-time");
  }
  if (typeof candidate === "string" && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(candidate)) {
    throw new Error("collectedAt must be an ISO date-time with a timezone");
  }
  const parsed = new Date(candidate);
  if (!Number.isFinite(parsed.getTime())) throw new Error("collectedAt must be a valid ISO date-time");
  const reference = at instanceof Date ? at : new Date(at);
  if (!Number.isFinite(reference.getTime())) throw new Error("The ingestion clock returned an invalid date");
  if (parsed.getTime() > reference.getTime() + MAX_FUTURE_CLOCK_SKEW_MS) {
    throw new Error("collectedAt cannot be more than five minutes in the future");
  }
  return parsed.toISOString();
}

function validateHttpsUrl(value, label, errors, allowedHosts = null) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") errors.push(`${label} must use HTTPS`);
    if (url.username || url.password) errors.push(`${label} must not contain credentials`);
    if (url.port) errors.push(`${label} must use the default HTTPS port`);
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
    for (const key of Object.keys(record.publicPrice)) {
      if (!ALLOWED_PRICE_KEYS.has(key)) errors.push(`Unexpected publicPrice field: ${key}`);
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
  try {
    canonicalizeProductUrl(record.sourceUrl);
  } catch (error) {
    errors.push(String(error?.message ?? error).replace(/^Product URL/, "sourceUrl"));
  }
  try {
    parseCollectedAt(record.checkedAt, { required: true });
  } catch (error) {
    errors.push(String(error?.message ?? error).replace(/^collectedAt/, "checkedAt"));
  }
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

async function writeImmutableSnapshot(rawDir, { checkedAt, urlKey, extension, contents }) {
  const buffer = Buffer.isBuffer(contents) ? contents : Buffer.from(String(contents), "utf8");
  const contentHash = sha256(buffer);
  const snapshotName = `${safeTimestamp(checkedAt)}-${urlKey.slice(0, 16)}-${contentHash}.${extension}`;
  const snapshotPath = path.join(rawDir, snapshotName);
  try {
    await writeFile(snapshotPath, buffer, { flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readFile(snapshotPath);
    if (!existing.equals(buffer)) {
      throw new Error(`Immutable raw snapshot collision detected: ${snapshotName}`);
    }
  }
  return snapshotPath;
}

function safeTimestamp(value) {
  return new Date(value).toISOString().replace(/[:.]/g, "-");
}

function optionInteger(value, name, { minimum, maximum }) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function nowDate(now) {
  const value = typeof now === "function" ? now() : new Date();
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("The ingestion clock returned an invalid date");
  return parsed;
}

async function resolveSnapshotWithinRoot(snapshotPath, snapshotRoot) {
  if (!snapshotRoot) {
    throw new Error("snapshotRoot is required when a manifest entry uses snapshotPath");
  }
  const [resolvedRoot, resolvedSnapshot] = await Promise.all([
    realpath(path.resolve(snapshotRoot)),
    realpath(path.resolve(snapshotPath))
  ]);
  const relative = path.relative(resolvedRoot, resolvedSnapshot);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("snapshotPath must stay inside the manifest snapshot root");
  }
  return resolvedSnapshot;
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
  if (!isPlainObject(value)) return ["Authorization file must contain a JSON object"];
  findForbiddenKeys(value, "authorization", errors);
  for (const key of Object.keys(value)) {
    if (!ALLOWED_AUTHORIZATION_KEYS.has(key)) errors.push(`Unexpected authorization field: ${key}`);
  }
  if (value.acknowledgement !== AUTOMATION_ACKNOWLEDGEMENT) {
    errors.push("The exact automated-access acknowledgement is missing");
  }
  if (typeof value.grantedBy !== "string" || !value.grantedBy.trim()) {
    errors.push("grantedBy is required");
  }
  if (
    typeof value.permissionReference !== "string" ||
    value.permissionReference.trim().length < 8 ||
    value.permissionReference.length > 500 ||
    !/^(?:email|file|https|document):[^\r\n]+$/i.test(value.permissionReference.trim())
  ) {
    errors.push("permissionReference must identify the retained written grant using email:, file:, https: or document:");
  }
  if (typeof value.reviewedBy !== "string" || !value.reviewedBy.trim()) {
    errors.push("reviewedBy is required to confirm a human reviewed the written grant");
  }
  const referenceTime = at instanceof Date ? at : new Date(at);
  if (!Number.isFinite(referenceTime.getTime())) return ["Authorization validation time is invalid"];
  if (!Array.isArray(value.allowedHosts) || value.allowedHosts.length !== 1 || value.allowedHosts[0] !== ECS_HOST) {
    errors.push(`allowedHosts must contain only ${ECS_HOST}`);
  }
  const isoDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  if (!isoDateTime.test(value.reviewedAt ?? "") || !Number.isFinite(Date.parse(value.reviewedAt)) || Date.parse(value.reviewedAt) > referenceTime.getTime() + MAX_FUTURE_CLOCK_SKEW_MS) {
    errors.push("reviewedAt must be a valid ISO timestamp that is not in the future");
  }
  if (!isoDateTime.test(value.validUntil ?? "") || !Number.isFinite(Date.parse(value.validUntil)) || Date.parse(value.validUntil) < referenceTime.getTime()) {
    errors.push("validUntil must be a future ISO timestamp");
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    errors.push("At least one authorized manifest entry is required");
  }
  for (const entry of Array.isArray(entries) ? entries : []) {
    try {
      canonicalizeProductUrl(entry.sourceUrl);
    } catch {
      errors.push(`Invalid authorized URL: ${entry.sourceUrl}`);
    }
  }
  return [...new Set(errors)];
}

class PermanentFetchError extends Error {
  constructor(message) {
    super(message);
    this.name = "PermanentFetchError";
    this.permanent = true;
  }
}

async function responseTextWithinLimit(response, maximumBytes) {
  const contentLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new PermanentFetchError(`Response exceeds the ${maximumBytes}-byte limit`);
  }
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maximumBytes) {
        await reader.cancel("Response too large").catch(() => {});
        throw new PermanentFetchError(`Response exceeds the ${maximumBytes}-byte limit`);
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, total).toString("utf8");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maximumBytes) {
    throw new PermanentFetchError(`Response exceeds the ${maximumBytes}-byte limit`);
  }
  return text;
}

export async function fetchWithRetry(url, options = {}) {
  const requestedUrl = canonicalizeProductUrl(url);
  const retries = optionInteger(options.retries ?? 3, "retries", { minimum: 0, maximum: 5 });
  const timeoutMs = optionInteger(options.timeoutMs ?? 30_000, "timeoutMs", { minimum: 1_000, maximum: 120_000 });
  const maximumBytes = optionInteger(options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES, "maxResponseBytes", {
    minimum: 1_024,
    maximum: 10 * 1024 * 1024
  });
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  if (typeof fetchImpl !== "function") throw new Error("fetchImpl must be a function");
  if (typeof sleep !== "function") throw new Error("sleep must be a function");
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(requestedUrl, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "ProjxRacingAuthorizedCatalogueIngest/1.0"
        },
        redirect: "follow",
        signal: controller.signal
      });
      if (response.ok) {
        try {
          canonicalizeProductUrl(response.url || requestedUrl);
        } catch (error) {
          throw new PermanentFetchError(`Final response URL is not an approved ECS product URL: ${error.message}`);
        }
        const contentType = String(response.headers?.get?.("content-type") ?? "").toLowerCase();
        if (!/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/.test(contentType)) {
          throw new PermanentFetchError(`Response content type is not HTML: ${contentType || "missing"}`);
        }
        return await responseTextWithinLimit(response, maximumBytes);
      }
      const message = `HTTP ${response.status} ${response.statusText}`.trim();
      if (response.status !== 408 && response.status !== 429 && response.status < 500) {
        throw new PermanentFetchError(message);
      }
      lastError = new Error(message);
    } catch (error) {
      if (error?.permanent) throw error;
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < retries) {
      const waitMs = Math.min(60_000, 1_000 * 2 ** attempt);
      await sleep(waitMs);
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
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  refresh = false,
  snapshotRoot = null,
  fetchImpl = globalThis.fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = () => new Date()
}) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("At least one manifest entry is required");
  const validatedRateLimitMs = optionInteger(rateLimitMs, "rateLimitMs", { minimum: 2_000, maximum: 300_000 });
  const validatedRetries = optionInteger(retries, "retries", { minimum: 0, maximum: 5 });
  const validatedTimeoutMs = optionInteger(timeoutMs, "timeoutMs", { minimum: 1_000, maximum: 120_000 });
  const validatedMaximumBytes = optionInteger(maxResponseBytes, "maxResponseBytes", {
    minimum: 1_024,
    maximum: 10 * 1024 * 1024
  });
  if (typeof sleep !== "function") throw new Error("sleep must be a function");
  if (typeof now !== "function") throw new Error("now must be a function");
  const runStartedAt = nowDate(now);
  const normalizedOutput = path.resolve(outputDir);
  const rawDir = path.join(normalizedOutput, "raw");
  const statePath = path.join(normalizedOutput, "checkpoint.json");
  const catalogPath = path.join(normalizedOutput, "catalog.json");
  const validationPath = path.join(normalizedOutput, "validation.json");
  await mkdir(rawDir, { recursive: true });

  if (fetchMode) {
    if (typeof fetchImpl !== "function") throw new Error("fetchImpl must be a function");
    const authErrors = validateAutomationAuthorization(authorization, entries, runStartedAt);
    if (authErrors.length) throw new Error(`Automated access is not authorized:\n- ${authErrors.join("\n- ")}`);
  }

  const state = await readJsonIfPresent(statePath, {
    schemaVersion: 1,
    startedAt: runStartedAt.toISOString(),
    updatedAt: null,
    items: {}
  });
  const existingCatalog = await readJsonIfPresent(catalogPath, { products: [] });
  const collected = Array.isArray(existingCatalog.products) ? [...existingCatalog.products] : [];
  const summary = { completed: 0, skipped: 0, failed: 0, deduplicated: 0 };
  let lastNetworkRequestAt = null;

  for (const [entryIndex, entry] of entries.entries()) {
    const rawSourceUrl = entry && typeof entry === "object" ? entry.sourceUrl : "";
    let key = sha256(`manifest-entry:${entryIndex}:${String(rawSourceUrl)}`);
    let canonicalUrl = String(rawSourceUrl || "");
    try {
      if (!isPlainObject(entry)) throw new Error("Manifest entry must be a JSON object");
      canonicalUrl = canonicalizeProductUrl(entry.sourceUrl);
      key = sha256(canonicalUrl);
      const checkedAt = parseCollectedAt(entry.collectedAt, {
        required: !fetchMode,
        at: nowDate(now)
      });
      const priorState = state.items[key];
      const durableMatch = priorState?.ecsSku
        ? collected.some(
            (record) =>
              validateProduct(record).length === 0 &&
              (record.ecsSku === priorState.ecsSku || record.sourceUrl === canonicalUrl)
          )
        : false;
      if (!refresh && priorState?.status === "completed" && durableMatch) {
        summary.skipped += 1;
        continue;
      }

      const processingAt = nowDate(now).toISOString();
      state.items[key] = {
        sourceUrl: canonicalUrl,
        status: "processing",
        attempts: Number(priorState?.attempts ?? 0) + 1,
        updatedAt: processingAt,
        error: null,
        rawSnapshot: priorState?.rawSnapshot ?? null,
        ecsSku: priorState?.ecsSku ?? null
      };
      state.updatedAt = processingAt;
      await writeJsonAtomic(statePath, state);

      let record;
      let rawPath;
      if (entry.record && typeof entry.record === "object") {
        const manualErrors = validateManualRecordInput(entry.record);
        if (manualErrors.length) throw new Error(`Manual record validation failed:\n- ${manualErrors.join("\n- ")}`);
        record = normalizeManualRecord(entry.record, { sourceUrl: canonicalUrl, checkedAt });
        const recordErrors = validateProduct(record);
        if (recordErrors.length) throw new Error(`Product validation failed:\n- ${recordErrors.join("\n- ")}`);
        rawPath = await writeImmutableSnapshot(rawDir, {
          checkedAt,
          urlKey: key,
          extension: "json",
          contents: `${JSON.stringify(entry.record, null, 2)}\n`
        });
      } else {
        let html;
        if (entry.snapshotPath) {
          const sourcePath = await resolveSnapshotWithinRoot(entry.snapshotPath, snapshotRoot);
          const snapshot = await readFile(sourcePath);
          html = snapshot.toString("utf8");
          rawPath = await writeImmutableSnapshot(rawDir, {
            checkedAt,
            urlKey: key,
            extension: "html",
            contents: snapshot
          });
        } else {
          if (!fetchMode) {
            throw new Error("Entry needs snapshotPath or record unless the separately authorized --fetch mode is enabled");
          }
          const requestAuthorizationErrors = validateAutomationAuthorization(
            authorization,
            [entry],
            nowDate(now)
          );
          if (requestAuthorizationErrors.length) {
            throw new Error(`Automated access is no longer authorized:\n- ${requestAuthorizationErrors.join("\n- ")}`);
          }
          const requestAt = nowDate(now).getTime();
          if (lastNetworkRequestAt !== null) {
            const elapsed = requestAt - lastNetworkRequestAt;
            if (elapsed < validatedRateLimitMs) await sleep(validatedRateLimitMs - elapsed);
          }
          html = await fetchWithRetry(canonicalUrl, {
            retries: validatedRetries,
            timeoutMs: validatedTimeoutMs,
            maxResponseBytes: validatedMaximumBytes,
            fetchImpl,
            sleep
          });
          lastNetworkRequestAt = nowDate(now).getTime();
          rawPath = await writeImmutableSnapshot(rawDir, {
            checkedAt,
            urlKey: key,
            extension: "html",
            contents: html
          });
        }
        record = parseProductHtml(html, { sourceUrl: canonicalUrl, checkedAt });
      }

      const errors = validateProduct(record);
      if (errors.length) throw new Error(`Product validation failed:\n- ${errors.join("\n- ")}`);
      collected.push(record);
      state.items[key] = {
        ...state.items[key],
        status: "completed",
        updatedAt: nowDate(now).toISOString(),
        rawSnapshot: path.relative(normalizedOutput, rawPath).replace(/\\/g, "/"),
        ecsSku: record.ecsSku
      };
      summary.completed += 1;
    } catch (error) {
      const failedWhileProcessing = state.items[key]?.status === "processing";
      const previousAttempts = Number(state.items[key]?.attempts ?? 0);
      state.items[key] = {
        ...state.items[key],
        sourceUrl: canonicalUrl,
        status: "failed",
        attempts: Math.max(1, failedWhileProcessing ? previousAttempts : previousAttempts + 1),
        updatedAt: nowDate(now).toISOString(),
        error: String(error?.message ?? error)
      };
      summary.failed += 1;
    }
    state.updatedAt = nowDate(now).toISOString();
    await writeJsonAtomic(statePath, state);
  }

  const products = dedupeRecords(collected);
  summary.deduplicated = collected.length - products.length;
  const validation = validateCatalog(products);
  const catalog = {
    schemaVersion: SCHEMA_VERSION,
    supplier: "ECS Tuning",
    generatedAt: nowDate(now).toISOString(),
    productCount: products.length,
    products
  };
  await writeJsonAtomic(catalogPath, catalog);
  await writeJsonAtomic(validationPath, validation);
  return { summary, catalog, validation, state };
}
