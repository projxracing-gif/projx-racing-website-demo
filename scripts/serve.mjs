import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(repo, process.argv[2] || 'dist');
const port = Number(process.argv[3] || 4173);
const host = process.env.HOST || '127.0.0.1';
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.webp':'image/webp', '.png':'image/png', '.jpg':'image/jpeg', '.xml':'application/xml; charset=utf-8', '.txt':'text/plain; charset=utf-8', '.webmanifest':'application/manifest+json' };

http.createServer((req, res) => {
  const raw = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  let file = path.join(root, raw.replace(/^\/+/, ''));
  if (raw.endsWith('/')) file = path.join(file, 'index.html');
  if (!path.extname(file) && fs.existsSync(path.join(file, 'index.html'))) file = path.join(file, 'index.html');
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, '404.html');
  const body = fs.readFileSync(file);
  res.writeHead(file.endsWith('404.html') && raw !== '/404.html' ? 404 : 200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(body);
}).listen(port, host, () => console.log(`Projx Racing preview: http://${host}:${port}`));
