// Payload validation for the cookieless collector. Pure functions, no I/O.
// The output record never contains an IP address, user agent or any identifier.

export const BOT_UA =
  /bot|crawl|spider|slurp|headless|lighthouse|preview|monitor|curl|wget|python|httpclient|http-client|go-http|java\/|okhttp|axios|node-fetch|undici|phantom|selenium|puppeteer|playwright|scrapy/i;

/** True for crawlers, scripts and requests without a user agent. */
export const isBot = (ua) => !ua || BOT_UA.test(ua);

/** Coarse device class from the user agent: 'm' (mobile) or 'd' (desktop). The UA itself is not stored. */
export const device = (ua) => (/Mobi|Android|iPhone|iPod/i.test(ua ?? '') ? 'm' : 'd');

const EVENT = /^[a-z][a-z0-9_]{1,39}$/;
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
const SOURCE = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const COUNTRY = /^[A-Z]{2}$/;

const str = (v) => (typeof v === 'string' ? v : '');

/** Page: a path (query and fragment removed) or a short page-kind label. */
export function cleanPage(v) {
  let p = str(v).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  p = p.split(/[?#]/)[0];
  return p.slice(0, 120);
}

/**
 * Build a stored record from a client payload, or return null to drop it.
 * @param {unknown} data parsed JSON payload
 * @param {object} ctx { ua, country, now, events?: Set|string[], pages?: Set|string[] }
 */
export function buildRecord(data, ctx = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const e = str(data.e);
  if (!EVENT.test(e)) return null;
  const events = ctx.events ? new Set(ctx.events) : null;
  if (events && events.size && !events.has(e)) return null;

  const p = cleanPage(data.p);
  if (!p) return null;
  const pages = ctx.pages ? new Set(ctx.pages) : null;
  if (pages && pages.size && !pages.has(p)) return null;

  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const rec = { t: now.toISOString().slice(0, 19) + 'Z', e, p };

  const ref = str(data.ref).toLowerCase();
  if (ref && ref.length <= 100 && HOST.test(ref)) rec.ref = ref;
  const src = str(data.src).toLowerCase();
  if (SOURCE.test(src)) rec.src = src;
  rec.paid = data.paid === 1 || data.paid === true ? 1 : 0;
  if (Number.isInteger(data.step) && data.step >= 1 && data.step <= 99) rec.step = data.step;
  const lang = str(data.lang);
  if (/^[a-z]{2}$/.test(lang)) rec.lang = lang;
  rec.dev = device(ctx.ua);
  const cc = str(ctx.country).toUpperCase();
  if (COUNTRY.test(cc) && cc !== 'XX') rec.country = cc;
  return rec;
}
