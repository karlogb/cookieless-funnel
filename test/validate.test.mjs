import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecord, isBot, device, cleanPage } from '../server/validate.mjs';

const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const now = new Date('2026-11-20T10:11:12.345Z');

test('bot user agents are detected, normal browsers are not', () => {
  for (const ua of ['Googlebot/2.1', 'Mozilla/5.0 (compatible; bingbot/2.0)', 'curl/8.5.0', 'python-requests/2.31', 'HeadlessChrome/120', 'Chrome-Lighthouse', 'Go-http-client/1.1', 'axios/1.6', '', undefined]) {
    assert.equal(isBot(ua), true, String(ua));
  }
  assert.equal(isBot(UA_DESKTOP), false);
  assert.equal(isBot(UA_MOBILE), false);
});

test('device class', () => {
  assert.equal(device(UA_MOBILE), 'm');
  assert.equal(device('Mozilla/5.0 (Linux; Android 14) Mobile'), 'm');
  assert.equal(device(UA_DESKTOP), 'd');
});

test('valid payload becomes a minimal record without identifiers', () => {
  const rec = buildRecord(
    { e: 'view', p: '/pricing?email=a@b.c#x', ref: 'News.Example.com', src: 'Newsletter', paid: 1, step: 2, lang: 'de', ip: '1.2.3.4', uid: 'abc' },
    { ua: UA_MOBILE, country: 'sk', now },
  );
  assert.deepEqual(rec, { t: '2026-11-20T10:11:12Z', e: 'view', p: '/pricing', ref: 'news.example.com', src: 'newsletter', paid: 1, step: 2, lang: 'de', dev: 'm', country: 'SK' });
});

test('malformed payloads are dropped', () => {
  for (const d of [null, 'view', [], {}, { e: 'View', p: '/' }, { e: 'a', p: '/' }, { e: 'x'.repeat(41), p: '/' }, { e: 'view' }, { e: 'view', p: 12 }, { e: 'drop table', p: '/' }]) {
    assert.equal(buildRecord(d, { ua: UA_DESKTOP, now }), null, JSON.stringify(d));
  }
});

test('event and page whitelists', () => {
  const ctx = { ua: UA_DESKTOP, now, events: ['view', 'signup_done'], pages: ['home', 'pricing'] };
  assert.ok(buildRecord({ e: 'view', p: 'home' }, ctx));
  assert.equal(buildRecord({ e: 'other_event', p: 'home' }, ctx), null);
  assert.equal(buildRecord({ e: 'view', p: '/secret' }, ctx), null);
  // empty whitelist means "allow any well-formed value"
  assert.ok(buildRecord({ e: 'anything_ok', p: '/x' }, { ua: UA_DESKTOP, now, events: [], pages: [] }));
});

test('optional fields are validated or omitted', () => {
  const rec = buildRecord({ e: 'click', p: '/', ref: 'evil host/../', src: '<script>', paid: '1', step: 500, lang: 'english' }, { ua: UA_DESKTOP, country: 'XX', now });
  assert.deepEqual(rec, { t: '2026-11-20T10:11:12Z', e: 'click', p: '/', paid: 0, dev: 'd' });
});

test('cleanPage strips control characters, query and fragment', () => {
  assert.equal(cleanPage('/a\u0000b?x=1#y'), '/ab');
  assert.equal(cleanPage('/'.repeat(300)).length, 120);
});
