import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCollector } from '../server/collector.mjs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15';
let dir, server, base;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'cf-test-'));
  const collect = createCollector({
    dataDir: dir,
    events: ['view', 'signup_done'],
    countryHeader: 'cf-ipcountry',
    now: () => new Date('2026-11-20T08:00:00Z'),
  });
  server = createServer(async (req, res) => {
    if (!(await collect(req, res))) res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await rm(dir, { recursive: true, force: true });
});

const post = (body, headers = {}) =>
  fetch(base + '/api/f', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'User-Agent': UA, 'Content-Type': 'text/plain', ...headers } });

test('collector stores valid events and drops everything else, always answering 204', async () => {
  const responses = await Promise.all([
    post({ e: 'view', p: '/', src: 'newsletter' }, { 'CF-IPCountry': 'DE', 'X-Forwarded-For': '203.0.113.9' }),
    post({ e: 'signup_done', p: '/signup', paid: 1 }),
    post({ e: 'not_allowed', p: '/' }),
    post({ e: 'view', p: '/' }, { 'User-Agent': 'Googlebot/2.1' }),
    post('not json'),
    post({ e: 'view', p: '/' + 'x'.repeat(2000) }),
  ]);
  assert.deepEqual(responses.map((r) => r.status), [204, 204, 204, 204, 204, 204]);

  assert.deepEqual(await readdir(dir), ['2026-11-20.jsonl']);
  const raw = await readFile(path.join(dir, '2026-11-20.jsonl'), 'utf8');
  const lines = raw.trim().split('\n').map((l) => JSON.parse(l)).sort((a, b) => a.e.localeCompare(b.e));
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], { t: '2026-11-20T08:00:00Z', e: 'signup_done', p: '/signup', paid: 1, dev: 'd' });
  assert.deepEqual(lines[1], { t: '2026-11-20T08:00:00Z', e: 'view', p: '/', src: 'newsletter', paid: 0, dev: 'd', country: 'DE' });
  assert.ok(!raw.includes('203.0.113.9') && !raw.includes('Macintosh'), 'no IP or user agent on disk');
});

test('wrong method and other paths', async () => {
  assert.equal((await fetch(base + '/api/f')).status, 405);
  assert.equal((await fetch(base + '/other', { method: 'POST', body: '{}' })).status, 404);
});
