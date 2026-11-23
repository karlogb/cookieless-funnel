// HTTP handler for the cookieless collector (node:http, no dependencies).
// Appends one JSON line per accepted event to <dataDir>/<YYYY-MM-DD>.jsonl (UTC day).

import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { buildRecord, isBot } from './validate.mjs';

const readBody = (req, limit) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      // Over the limit: stop buffering, keep draining so the 204 can still be delivered.
      if (size > limit) reject(new Error('too large'));
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

/**
 * @param {object} opts
 * @param {string} opts.dataDir       directory for the daily JSONL files
 * @param {string} [opts.path]        endpoint path, default '/api/f'
 * @param {string[]} [opts.events]    allowed event names (empty = any well-formed name)
 * @param {string[]} [opts.pages]     allowed page values (empty = any path)
 * @param {string} [opts.countryHeader] header carrying an ISO country code, e.g. 'cf-ipcountry'
 * @param {string} [opts.allowOrigin] CORS origin for cross-site setups (omit for same origin)
 * @param {number} [opts.maxBody]     max request body in bytes, default 1024
 * @param {() => Date} [opts.now]     clock, for tests
 * @returns {(req, res) => Promise<boolean>} resolves true if the request was handled
 */
export function createCollector(opts) {
  const endpoint = opts.path ?? '/api/f';
  const maxBody = opts.maxBody ?? 1024;
  const countryHeader = opts.countryHeader ? opts.countryHeader.toLowerCase() : '';
  const now = opts.now ?? (() => new Date());
  const cors = opts.allowOrigin
    ? { 'Access-Control-Allow-Origin': opts.allowOrigin, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' }
    : {};

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== endpoint) return false;
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors).end();
      return true;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' }).end();
      return true;
    }
    // Always 204: the client learns nothing about what was kept.
    try {
      const ua = req.headers['user-agent'] ?? '';
      const raw = await readBody(req, maxBody);
      if (!isBot(ua)) {
        const at = now();
        const rec = buildRecord(JSON.parse(raw), {
          ua,
          country: countryHeader ? req.headers[countryHeader] : '',
          now: at,
          events: opts.events,
          pages: opts.pages,
        });
        if (rec) {
          await mkdir(opts.dataDir, { recursive: true });
          await appendFile(path.join(opts.dataDir, `${at.toISOString().slice(0, 10)}.jsonl`), JSON.stringify(rec) + '\n');
        }
      }
    } catch {
      /* malformed or oversized payloads are dropped silently */
    }
    if (!res.headersSent) res.writeHead(204, cors).end();
    return true;
  };
}
