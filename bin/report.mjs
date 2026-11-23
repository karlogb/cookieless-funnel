#!/usr/bin/env node
// Report over the collector's daily JSONL files.
//
// usage: report.mjs [--dir ./data] [--day YYYY-MM-DD | --yesterday | --from YYYY-MM-DD --to YYYY-MM-DD]
//                   [--steps view,signup_started,signup_done] [--limit 10] [--json]

import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadRecords, summarize } from '../report/lib.mjs';

const { values: a } = parseArgs({
  options: {
    dir: { type: 'string', default: './data' },
    day: { type: 'string' },
    yesterday: { type: 'boolean', default: false },
    from: { type: 'string' },
    to: { type: 'string' },
    steps: { type: 'string', default: '' },
    limit: { type: 'string', default: '10' },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (a.help) {
  console.log('usage: report.mjs [--dir ./data] [--day D | --yesterday | --from D --to D] [--steps a,b,c] [--limit N] [--json]');
  process.exit(0);
}

let { from, to } = a;
if (a.yesterday) a.day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
if (a.day) from = to = a.day;
const steps = a.steps.split(',').map((s) => s.trim()).filter(Boolean);
const s = summarize(loadRecords(path.resolve(a.dir), { from, to }), { steps, limit: Number(a.limit) || 10 });

if (a.json) {
  console.log(JSON.stringify(s, null, 1));
  process.exit(0);
}

const out = [];
const pad = (v, n) => String(v).padEnd(n);
const lpad = (v, n) => String(v).padStart(n);
const pct = (v) => (v === null ? '' : `${v}%`);

out.push(`cookieless-funnel report  ${s.from ?? '-'} .. ${s.to ?? '-'}  (${s.days} day(s), ${s.total} events)`);
if (!s.total) {
  console.log(out[0] + '\nno data');
  process.exit(0);
}

out.push('', `${pad('Events', 28)}   all   paid  organic`);
const keys = Object.keys(s.events.all).sort((x, y) => s.events.all[y] - s.events.all[x] || x.localeCompare(y));
for (const k of keys) out.push(`  ${pad(k, 26)} ${lpad(s.events.all[k], 6)} ${lpad(s.events.paid[k] ?? 0, 6)} ${lpad(s.events.organic[k] ?? 0, 8)}`);

if (s.funnel) {
  for (const seg of ['all', 'paid', 'organic']) {
    out.push('', `${pad(`Funnel (${seg})`, 28)}  count  from prev  from first`);
    for (const r of s.funnel[seg]) out.push(`  ${pad(r.step, 26)} ${lpad(r.count, 6)} ${lpad(pct(r.fromPrevious), 10)} ${lpad(pct(r.fromFirst), 11)}`);
  }
}

if (s.days > 1) {
  out.push('', 'Per day');
  for (const [d, n] of Object.entries(s.perDay)) out.push(`  ${d}  ${lpad(n, 6)}`);
}

const titles = { pages: 'Top pages (views)', referrers: 'Top referrers (views)', sources: 'Top sources (views)', devices: 'Devices (views)', countries: 'Countries (views)', paidLandings: 'Paid landing pages (views)' };
for (const [k, title] of Object.entries(titles)) {
  if (!s.top[k].length) continue;
  out.push('', title);
  const label = (v) => (k === 'devices' ? ({ m: 'mobile', d: 'desktop' })[v] ?? v : v);
  for (const [name, n] of s.top[k]) out.push(`  ${pad(label(name), 32)} ${lpad(n, 6)}`);
}
console.log(out.join('\n'));
