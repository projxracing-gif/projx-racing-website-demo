import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(repo, process.argv[2] || 'dist');
const port = Number(process.argv[3] || 4173);
const host = process.env.HOST || '127.0.0.1';
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.webp':'image/webp', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.xml':'application/xml; charset=utf-8', '.txt':'text/plain; charset=utf-8', '.webmanifest':'application/manifest+json' };
let catalogHandlerPromise;
let partsCatalogHandlerPromise;
const localApiHandlerPromises = new Map();
const localApiRoutes = new Map([
  ['/api/staging-order', { module: '../api/staging-order.js', limit: 24_000 }],
  ['/api/enquiry', { module: '../api/enquiry.js', limit: 32_000 }],
  ['/api/account', { module: '../api/account.js', limit: 128_000 }],
  ['/api/addresses', { module: '../api/addresses.js', limit: 128_000 }],
  ['/api/cart', { module: '../api/cart.js', limit: 128_000 }],
  ['/api/quotes', { module: '../api/quotes.js', limit: 192_000 }],
  ['/api/orders', { module: '../api/orders.js', limit: 8_000 }],
  ['/api/clerk-webhook', { module: '../api/clerk-webhook.js', limit: 256_000, raw: true }],
  ['/api/commerce-email-retry', { module: '../api/commerce-email-retry.js', limit: 8_000 }]
]);

function catalogHandler() {
  catalogHandlerPromise ||= import('../api/tegiwa-catalog.js').then(module => module.default);
  return catalogHandlerPromise;
}

function partsCatalogHandler() {
  partsCatalogHandlerPromise ||= import('../api/parts-catalog.js').then(module => module.default);
  return partsCatalogHandlerPromise;
}

function localApiHandler(definition) {
  if (!localApiHandlerPromises.has(definition.module)) {
    localApiHandlerPromises.set(definition.module, import(definition.module).then(module => module.default));
  }
  return localApiHandlerPromises.get(definition.module);
}

function readRawBody(req, limit = 24_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('payload_too_large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

async function readJsonBody(req, limit = 24_000) {
  const buffer = await readRawBody(req, limit);
  try { return JSON.parse(buffer.toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('invalid_json'), { statusCode: 400 }); }
}

http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const raw = decodeURIComponent(requestUrl.pathname);
  if (raw === '/api/tegiwa-catalog' || raw === '/api/tegiwa-catalog/') {
    req.query = Object.fromEntries(requestUrl.searchParams.entries());
    try {
      const handler = await catalogHandler();
      return handler(req, res);
    } catch (error) {
      console.error('Local catalogue preview failed', error instanceof Error ? error.message : 'unknown_error');
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ error: 'local_catalogue_unavailable' }));
    }
  }
  if (raw === '/api/parts-catalog' || raw === '/api/parts-catalog/') {
    req.query = Object.fromEntries(requestUrl.searchParams.entries());
    try {
      const handler = await partsCatalogHandler();
      return handler(req, res);
    } catch (error) {
      console.error('Local unified catalogue preview failed', error instanceof Error ? error.message : 'unknown_error');
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ error: 'local_parts_catalogue_unavailable' }));
    }
  }
  const normalizedApiPath = raw.endsWith('/') ? raw.slice(0, -1) : raw;
  const localApi = localApiRoutes.get(normalizedApiPath);
  if (localApi) {
    try {
      req.query = Object.fromEntries(requestUrl.searchParams.entries());
      if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
        req.body = localApi.raw ? await readRawBody(req, localApi.limit) : await readJsonBody(req, localApi.limit);
      }
      const handler = await localApiHandler(localApi);
      return handler(req, res);
    } catch (error) {
      if (res.headersSent) return;
      res.writeHead(error?.statusCode || 500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ error: error?.message || 'local_api_unavailable' }));
    }
  }
  let file = path.join(root, raw.replace(/^\/+/, ''));
  if (raw.endsWith('/')) file = path.join(file, 'index.html');
  if (!path.extname(file) && fs.existsSync(path.join(file, 'index.html'))) file = path.join(file, 'index.html');
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, '404.html');
  const body = fs.readFileSync(file);
  res.writeHead(file.endsWith('404.html') && raw !== '/404.html' ? 404 : 200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(body);
}).listen(port, host, () => console.log(`Projx Racing preview: http://${host}:${port}`));
