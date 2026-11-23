import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { funnel, loadRecords, summarize, stepKey, top } from '../report/lib.mjs';

const rec = (e, extra = {}) => ({ e, p: '/', paid: 0, dev: 'd', day: '2026-11-20', ...extra });

test('funnel conversion between ordered steps', () => {
  const rows = [
    ...Array.from({ length: 200 }, () => rec('view')),
    ...Array.from({ length: 50 }, () => rec('signup_started')),
    ...Array.from({ length: 10 }, () => rec('signup_done')),
  ];
  assert.deepEqual(funnel(rows, ['view', 'signup_started', 'signup_done']), [
    { step: 'view', count: 200, fromPrevious: null, fromFirst: 100 },
    { step: 'signup_started', count: 50, fromPrevious: 25, fromFirst: 25 },
    { step: 'signup_done', count: 10, fromPrevious: 20, fromFirst: 5 },
  ]);
});

test('funnel handles zero counts and numbered steps', () => {
  const rows = [rec('checkout', { step: 1 }), rec('checkout', { step: 1 }), rec('checkout', { step: 2 }), rec('checkout', { step: 3 })];
  const f = funnel(rows, ['view', 'checkout#1', 'checkout#2']);
  assert.deepEqual(f.map((r) => [r.count, r.fromPrevious, r.fromFirst]), [[0, null, null], [2, null, null], [1, 50, null]]);
  // a bare name matches every step of that event
  assert.equal(funnel(rows, ['checkout'])[0].count, 4);
  assert.equal(stepKey(rows[2]), 'checkout#2');
  // rounding to one decimal
  assert.equal(funnel([rec('a1'), rec('a1'), rec('a1'), rec('b1')], ['a1', 'b1'])[1].fromPrevious, 33.3);
});

test('summary splits paid and organic and ranks top lists', () => {
  const rows = [
    rec('view', { p: '/a', paid: 1, src: 'google-ads', country: 'DE', dev: 'm' }),
    rec('view', { p: '/a', ref: 'news.example.org' }),
    rec('view', { p: '/b', ref: 'news.example.org', day: '2026-11-21' }),
    rec('buy', { paid: 1 }),
    rec('buy'),
    rec('buy'),
  ];
  const s = summarize(rows, { steps: ['view', 'buy'] });
  assert.equal(s.total, 6);
  assert.equal(s.days, 2);
  assert.deepEqual(s.events.paid, { view: 1, buy: 1 });
  assert.deepEqual(s.events.organic, { view: 2, buy: 2 });
  assert.equal(s.funnel.paid[1].fromPrevious, 100);
  assert.equal(s.funnel.organic[1].fromPrevious, 100);
  assert.equal(s.funnel.all[1].fromFirst, 100);
  assert.deepEqual(s.top.pages, [['/a', 2], ['/b', 1]]);
  assert.deepEqual(s.top.referrers, [['news.example.org', 2], ['(none)', 1]]);
  assert.deepEqual(s.top.paidLandings, [['/a', 1]]);
  assert.deepEqual(s.top.devices, [['d', 2], ['m', 1]]);
  assert.deepEqual(top(rows, 'country', { filter: (r) => r.e === 'view' }), [['(none)', 2], ['DE', 1]]);
});

test('loadRecords reads daily files, filters by date and skips broken lines', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cf-report-'));
  try {
    await writeFile(path.join(dir, '2026-11-19.jsonl'), '{"e":"view","p":"/"}\n');
    await writeFile(path.join(dir, '2026-11-20.jsonl'), '{"e":"view","p":"/"}\nbroken\n\n{"e":"buy","p":"/"}\n');
    await writeFile(path.join(dir, 'notes.txt'), 'ignored');
    assert.equal(loadRecords(dir).length, 3);
    const day = loadRecords(dir, { from: '2026-11-20', to: '2026-11-20' });
    assert.deepEqual(day.map((r) => [r.e, r.day]), [['view', '2026-11-20'], ['buy', '2026-11-20']]);
    assert.deepEqual(loadRecords(path.join(dir, 'missing')), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
