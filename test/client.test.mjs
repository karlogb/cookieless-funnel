import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../client/funnel.js', import.meta.url), 'utf8');

/** Run the client in a minimal fake browser and capture what it would send. */
function run({ url = 'https://shop.example.com/pricing', referrer = '', lang = 'de-AT', config, attrs = {}, beacon = true } = {}) {
  const u = new URL(url);
  const sent = [];
  const listeners = {};
  const readBlob = (b) => b.text().then((t) => JSON.parse(t));
  const window = {
    cookielessFunnel: config,
  };
  const document = {
    referrer,
    documentElement: { lang },
    currentScript: { getAttribute: (n) => (n.slice(5) in attrs ? attrs[n.slice(5)] : null) },
    addEventListener: (type, fn) => (listeners[type] = fn),
    createElement: () => ({}),
  };
  const ctx = {
    window,
    document,
    location: { search: u.search, pathname: u.pathname, hostname: u.hostname },
    navigator: { sendBeacon: beacon ? (ep, blob) => (sent.push(readBlob(blob).then((b) => ({ ep, b, via: 'beacon' }))), true) : undefined },
    fetch: (ep, o) => (sent.push(Promise.resolve({ ep, b: JSON.parse(o.body), via: 'fetch', keepalive: o.keepalive })), Promise.resolve()),
    URL,
    URLSearchParams,
    Blob,
    JSON,
    Date,
    Math,
    Number,
    String,
  };
  vm.runInNewContext(SRC, ctx);
  return { window, listeners, sent: () => Promise.all(sent) };
}

test('sends a view on load with path, referrer host and source only', async () => {
  const c = run({ url: 'https://shop.example.com/pricing?utm_source=Newsletter&email=x%40y.z', referrer: 'https://news.example.org/some/article?id=5' });
  const [s] = await c.sent();
  assert.equal(s.ep, '/api/f');
  assert.deepEqual(s.b, { e: 'view', p: '/pricing', ref: 'news.example.org', src: 'newsletter' });
});

test('gclid marks the visit as paid google-ads; same-site referrer is dropped', async () => {
  const c = run({ url: 'https://shop.example.com/?gclid=abc', referrer: 'https://shop.example.com/x' });
  const [s] = await c.sent();
  assert.deepEqual(s.b, { e: 'view', p: '/', src: 'google-ads', paid: 1 });
});

test('utm_medium=cpc is paid; JS API sends steps; page() config and lang', async () => {
  const c = run({
    url: 'https://shop.example.com/de/checkout?utm_source=bing&utm_medium=cpc',
    config: { endpoint: '/collect', page: (p) => (p.includes('checkout') ? 'checkout' : 'other') },
    attrs: { lang: '' },
  });
  c.window.funnel('checkout_step', 2);
  c.window.funnel('checkout_step', 500);
  const s = await c.sent();
  assert.deepEqual(s.map((x) => x.ep), ['/collect', '/collect', '/collect']);
  assert.deepEqual(s[0].b, { e: 'view', p: 'checkout', src: 'bing', paid: 1, lang: 'de' });
  assert.equal(s[1].b.step, 2);
  assert.equal(s[2].b.step, undefined);
});

test('auto view can be disabled; fetch keepalive fallback without sendBeacon', async () => {
  const c = run({ attrs: { auto: 'off' }, beacon: false });
  assert.equal((await c.sent()).length, 0);
  c.window.funnel('signup_done');
  const [s] = await c.sent();
  assert.equal(s.via, 'fetch');
  assert.equal(s.keepalive, true);
  assert.equal(s.b.e, 'signup_done');
});

test('data-funnel clicks are counted', async () => {
  const c = run({ attrs: { auto: 'off' } });
  const el = { tagName: 'A', getAttribute: (n) => ({ 'data-funnel': 'cta_click', 'data-funnel-step': '1' })[n] ?? null };
  c.listeners.click({ target: { closest: () => el } });
  c.listeners.click({ target: { closest: () => null } });
  const s = await c.sent();
  assert.equal(s.length, 1);
  assert.deepEqual(s[0].b, { e: 'cta_click', p: '/pricing', step: 1 });
});

test('guarded form gets fe and fi fields on submit', async () => {
  const c = run({ attrs: { auto: 'off' } });
  const added = [];
  const form = {
    getAttribute: (n) => (n === 'data-funnel' ? 'contact_sent' : null),
    hasAttribute: (n) => n === 'data-guard',
    querySelector: () => null,
    appendChild: (i) => added.push(i),
  };
  c.listeners.focusin({ target: { closest: () => form } });
  c.listeners.submit({ target: form });
  assert.deepEqual(added.map((i) => [i.name, i.type]), [['fe', 'hidden'], ['fi', 'hidden']]);
  assert.ok(Number(added[0].value) >= 0);
  assert.equal(added[1].value, '1');
  const [s] = await c.sent();
  assert.equal(s.b.e, 'contact_sent');
});

test('client stays small', () => {
  const stripped = SRC.replace(/^\s*\/\/.*$/gm, '').replace(/\s+/g, ' ');
  assert.ok(stripped.length < 3000, `client is ${stripped.length} bytes without comments`);
});
