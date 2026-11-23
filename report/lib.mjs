// Report helpers: load daily JSONL files and summarise them. No dependencies.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DAY = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

/** Read all records from <dir>/<YYYY-MM-DD>.jsonl, optionally limited to [from, to] (inclusive). */
export function loadRecords(dir, { from, to } = {}) {
  const rows = [];
  let files;
  try {
    files = readdirSync(dir).filter((f) => DAY.test(f)).sort();
  } catch {
    return rows;
  }
  for (const f of files) {
    const day = f.slice(0, 10);
    if ((from && day < from) || (to && day > to)) continue;
    for (const line of readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (r && typeof r.e === 'string') rows.push({ ...r, day });
      } catch {
        /* skip broken lines */
      }
    }
  }
  return rows;
}

/** Funnel key of a record: 'checkout' or 'checkout#2' when a step number is present. */
export const stepKey = (r) => (r.step ? `${r.e}#${r.step}` : r.e);

const matches = (r, step) => (step.includes('#') ? stepKey(r) === step : r.e === step);

const ratio = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

/**
 * Funnel over ordered steps. Counts are event counts (there are no sessions by design),
 * so conversion is "events of step N / events of step N-1", not a per-visitor rate.
 * A step is an event name ('signup') or event#step ('checkout#2').
 */
export function funnel(records, steps) {
  const first = steps.length ? records.filter((r) => matches(r, steps[0])).length : 0;
  let prev = null;
  return steps.map((step) => {
    const count = records.filter((r) => matches(r, step)).length;
    const row = { step, count, fromPrevious: prev === null ? null : ratio(count, prev), fromFirst: ratio(count, first) };
    prev = count;
    return row;
  });
}

/** Counter -> array of [key, n] sorted by n desc then key, limited. */
export function top(records, field, { limit = 10, filter = () => true, empty = '(none)' } = {}) {
  const c = new Map();
  for (const r of records) {
    if (!filter(r)) continue;
    const k = r[field] === undefined || r[field] === '' ? empty : String(r[field]);
    c.set(k, (c.get(k) ?? 0) + 1);
  }
  return [...c].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
}

export function countBy(records, keyFn) {
  const out = {};
  for (const r of records) {
    const k = keyFn(r);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** Full summary as plain data (used by the CLI for both text and --json output). */
export function summarize(records, { steps = [], limit = 10 } = {}) {
  const paid = records.filter((r) => r.paid === 1);
  const organic = records.filter((r) => r.paid !== 1);
  const views = (r) => r.e === 'view';
  const days = [...new Set(records.map((r) => r.day))].sort();
  return {
    from: days[0] ?? null,
    to: days.at(-1) ?? null,
    days: days.length,
    total: records.length,
    perDay: countBy(records, (r) => r.day),
    events: {
      all: countBy(records, stepKey),
      paid: countBy(paid, stepKey),
      organic: countBy(organic, stepKey),
    },
    funnel: steps.length
      ? { all: funnel(records, steps), paid: funnel(paid, steps), organic: funnel(organic, steps) }
      : null,
    top: {
      pages: top(records, 'p', { limit, filter: views }),
      referrers: top(records, 'ref', { limit, filter: views }),
      sources: top(records, 'src', { limit, filter: views }),
      devices: top(records, 'dev', { limit, filter: views }),
      countries: top(records, 'country', { limit, filter: views }),
      paidLandings: top(paid, 'p', { limit, filter: views }),
    },
  };
}
