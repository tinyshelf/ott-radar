// Tiny static server for local preview: `npm run serve` then open http://localhost:8080
// (or http://localhost:8080/phone to see it in a phone-sized frame on a desktop).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8080);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const PHONE = `<!doctype html><meta charset="utf-8"><title>OTT Radar (phone)</title>
<body style="margin:0;background:#444;display:flex;justify-content:center;padding:12px">
<iframe src="/" style="width:390px;height:844px;border:0;border-radius:24px;background:#fff"></iframe></body>`;

http.createServer(async (req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel === '/phone') return res.writeHead(200, { 'content-type': 'text/html' }).end(PHONE);
  const file = path.join(ROOT, rel.endsWith('/') ? rel + 'index.html' : rel);
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
