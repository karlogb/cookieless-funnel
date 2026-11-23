#!/usr/bin/env node
// Standalone collector. Configuration through environment variables:
//   PORT=8787 HOST=127.0.0.1 DATA_DIR=./data ENDPOINT=/api/f
//   EVENTS=view,signup_started,signup_done   (optional whitelist)
//   PAGES=home,pricing,other                 (optional whitelist)
//   COUNTRY_HEADER=cf-ipcountry              (optional, only if a trusted proxy sets it)
//   ALLOW_ORIGIN=https://example.com         (optional, cross-origin setups)
//   STATIC_DIR=./example                     (optional, serve a static folder, handy for the demo)

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createCollector } from '../server/collector.mjs';

const env = process.env;
const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
const port = Number(env.PORT ?? 8787);
const host = env.HOST ?? '127.0.0.1';

const collect = createCollector({
  dataDir: path.resolve(env.DATA_DIR ?? './data'),
  path: env.ENDPOINT ?? '/api/f',
  events: list(env.EVENTS),
  pages: list(env.PAGES),
  countryHeader: env.COUNTRY_HEADER,
  allowOrigin: env.ALLOW_ORIGIN,
});

const root = env.STATIC_DIR ? path.resolve(env.STATIC_DIR) : null;
const clientFile = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../client/funnel.js');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/funnel.js') {
    res.writeHead(200, { 'Content-Type': TYPES['.js'] }).end(await readFile(clientFile));
    return;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(root, '.' + rel);
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  const info = await stat(file);
  if (!info.isFile()) throw new Error('not a file');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(await readFile(file));
}

createServer(async (req, res) => {
  try {
    if (await collect(req, res)) return;
    if (root && (req.method === 'GET' || req.method === 'HEAD')) return await serveStatic(req, res);
    res.writeHead(404).end();
  } catch {
    if (!res.headersSent) res.writeHead(404).end();
  }
}).listen(port, host, () => console.error(`cookieless-funnel collector on http://${host}:${port}`));
