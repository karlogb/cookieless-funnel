# cookieless-funnel

Counts page views, clicks and funnel steps without cookies, local storage or identifiers. A small browser script, a dependency-free Node collector that appends one JSON line per event, and a report CLI that turns those lines into daily counts, funnel conversion and a paid vs organic split.

It is the counter running on [nulllogic.eu](https://nulllogic.eu) and [bagclaim.eu](https://bagclaim.eu), extracted into a generic package.

## Why

Most analytics tools recognise returning visitors with a cookie or a fingerprint. That is what makes them useful for audiences, and it is also what usually requires a consent banner. Often the question is simpler: how many people saw the pricing page, how many clicked "Start", how many finished, and did the paid traffic behave differently from the rest.

This project answers only that. The script does not set cookies, does not use `localStorage` or `sessionStorage`, and does not generate or send any identifier. The collector does not store IP addresses or user agents. Each event is an isolated, anonymous count.

Whether you need consent for this in your jurisdiction is your decision. This is not legal advice; check your own legal situation (ePrivacy rules differ between countries, and any change you make to the code changes the analysis).

## What it records

One JSON line per accepted event, in `<data dir>/<YYYY-MM-DD>.jsonl` (UTC day):

```json
{"t":"2026-11-20T10:11:12Z","e":"view","p":"/pricing","ref":"news.example.org","src":"newsletter","paid":0,"dev":"d","country":"DE"}
```

| Field | Meaning | Source |
|---|---|---|
| `t` | Time, UTC, second precision | Server clock |
| `e` | Event name, `[a-z][a-z0-9_]{1,39}`, optionally whitelisted | Client |
| `p` | Page path without query string or fragment, or a page kind such as `home` (configurable) | Client |
| `ref` | Referrer **host name** only, empty for same-site navigation | Client, `document.referrer` |
| `src` | `utm_source`, or `google-ads` / `microsoft-ads` for `gclid` / `gbraid` / `wbraid` / `msclkid` | Client, landing URL |
| `paid` | `1` if the landing URL had an ad click ID or a paid `utm_medium` (`cpc`, `ppc`, `paid`, `paid_search`, `paid_social`, `display`) | Client |
| `step` | Optional step number 1 to 99 (for multi-step forms) | Client |
| `lang` | Optional 2-letter page language from `<html lang>`, only if enabled | Client |
| `dev` | `m` (mobile) or `d` (desktop), derived from the user agent, which is then discarded | Server |
| `country` | Optional ISO country code, only if a trusted proxy header is configured (for example Cloudflare's `CF-IPCountry`) | Server |

Fields that fail validation are dropped; events that fail validation are not stored at all.

## What it never records

- IP addresses (not written, not hashed)
- User agent strings
- Cookies, client IDs, session IDs, fingerprints or hashes of any of these
- Query strings, URL fragments or full referrer URLs (these can carry emails, tokens or search terms)
- Click IDs themselves (`gclid` and friends only switch `paid` to 1)
- Form contents

## Limitations (by design)

- **No unique visitors and no sessions.** Ten views can be one person reloading or ten people. Funnel conversion is event count of step N divided by event count of step N-1, not a per-person rate. If one person submits twice, it counts twice.
- **Paid attribution is per page load.** `paid` and `src` come from the URL of the current page load. In a single-page app they stay for the lifetime of the page; after a full navigation to another page without the parameters, the next events count as organic.
- **Bot filtering is heuristic.** User agents matching common crawler, headless browser and HTTP library patterns are dropped, and empty user agents too. A bot that sends a normal browser user agent and runs JavaScript will be counted.
- **Ad blockers** may block the script or the endpoint, so counts are a lower bound.
- No dashboard. The data is plain JSONL; the CLI covers the common questions.

## Layout

```
client/funnel.js        browser script (no dependencies, ~1.9 KB minified, under 1 KB gzipped)
server/validate.mjs     payload validation, bot filter, device class (pure functions)
server/collector.mjs    node:http request handler that appends JSONL per day
server/bot-guard.mjs    optional contact-form bot guard check
bin/collector.mjs       standalone collector server (env configuration)
bin/report.mjs          report CLI
report/lib.mjs          report functions (load, funnel, summary)
worker/worker.js        optional Cloudflare Worker front for the collector
example/index.html      demo page
test/                   node:test suites
```

Requires Node.js 18.11 or newer. No npm dependencies.

## Quick start

```sh
git clone https://github.com/karlogb/cookieless-funnel.git
cd cookieless-funnel
npm test
npm run demo            # collector + example page on http://127.0.0.1:8787
# open the page, click around, then:
node bin/report.mjs --dir ./data --steps view,cta_click,signup_started,signup_done
```

## Client

Serve `client/funnel.js` from your own domain and include it on every page:

```html
<script src="/funnel.js" defer></script>
```

That sends one `view` per page load to `/api/f`. Options as `data-` attributes on the script tag:

| Attribute | Effect |
|---|---|
| `data-endpoint="/stats/f"` | Different collector path |
| `data-auto="off"` | No automatic `view` (call `funnel('view')` yourself, for example on SPA route changes) |
| `data-lang` | Also send the 2-letter `<html lang>` |

Or as a config object defined before the script, which also allows grouping URLs into page kinds:

```html
<script>
  window.cookielessFunnel = {
    endpoint: "/api/f",
    view: true,
    lang: false,
    page: function (path) {
      if (path === "/") return "home";
      if (path.indexOf("/blog/") === 0) return "blog";
      return "other";
    }
  };
</script>
<script src="/funnel.js" defer></script>
```

Grouping pages is useful when paths may contain IDs or personal data, and it keeps the page whitelist short.

**Events from HTML.** Any element with `data-funnel` sends that event when clicked; a `<form data-funnel>` sends it on submit. `data-funnel-step` adds a step number.

```html
<a href="/signup" data-funnel="cta_click">Start</a>
<form action="/signup" method="post" data-funnel="signup_done">...</form>
```

**Events from JavaScript.**

```js
funnel("signup_started");      // event
funnel("checkout_step", 2);    // event with step number
```

Delivery uses `navigator.sendBeacon` with a `text/plain` body, falling back to `fetch` with `keepalive`. Both survive page unload; neither triggers a CORS preflight. Errors are swallowed so counting never breaks the page.

## Collector

Standalone, configured through environment variables:

```sh
PORT=8787 HOST=127.0.0.1 DATA_DIR=./data \
EVENTS=view,cta_click,signup_started,signup_done \
COUNTRY_HEADER=cf-ipcountry \
node bin/collector.mjs
```

| Variable | Default | Meaning |
|---|---|---|
| `PORT`, `HOST` | `8787`, `127.0.0.1` | Listen address. Put it behind your reverse proxy on the same origin as the site. |
| `DATA_DIR` | `./data` | Where daily JSONL files go |
| `ENDPOINT` | `/api/f` | Path of the collector |
| `EVENTS` | (any) | Comma-separated event whitelist. Recommended: it stops random event names from filling your files. |
| `PAGES` | (any) | Comma-separated whitelist of `p` values, useful together with page kinds |
| `COUNTRY_HEADER` | (off) | Header with an ISO country code set by a proxy you trust. Never enable it if clients can set the header themselves. |
| `ALLOW_ORIGIN` | (off) | CORS origin, only if the collector runs on a different origin |
| `STATIC_DIR` | (off) | Also serve a static folder and `/funnel.js` (used by `npm run demo`) |

Or mount the handler in your own `node:http` server:

```js
import { createServer } from 'node:http';
import { createCollector } from './server/collector.mjs';

const collect = createCollector({ dataDir: './data', events: ['view', 'cta_click', 'signup_done'] });

createServer(async (req, res) => {
  if (await collect(req, res)) return;
  // ... the rest of your app
}).listen(8080);
```

The collector always answers `204`, whether it stored the event or not. Bodies over 1 KB, invalid JSON, unknown events and bot user agents are dropped silently. Rotate or delete old files with whatever you already use (cron, logrotate); nothing is aggregated in memory.

### Cloudflare Worker

If the site runs on Cloudflare, `worker/worker.js` can sit on the `/api/f` route: it drops bot traffic at the edge and forwards the payload to the Node collector with `CF-IPCountry` set from `request.cf.country`. The visitor IP is not forwarded. Set `COLLECTOR_URL` in the Worker and `COUNTRY_HEADER=cf-ipcountry` on the collector, and keep the collector reachable only from the Worker (for example behind a secret path or Cloudflare Access).

## Report

```sh
node bin/report.mjs --dir ./data                       # everything
node bin/report.mjs --dir ./data --yesterday           # one day (UTC)
node bin/report.mjs --dir ./data --day 2026-11-20
node bin/report.mjs --dir ./data --from 2026-11-01 --to 2026-11-30
node bin/report.mjs --dir ./data --steps view,cta_click,signup_started,signup_done
node bin/report.mjs --dir ./data --json                # machine-readable
```

It prints event counts split into all / paid / organic, the funnel for each of the three segments (count, conversion from the previous step, conversion from the first step), events per day, and top pages, referrers, sources, devices, countries and paid landing pages (all counted on `view` events). A funnel step can be an event name (`checkout`) or an event with a step number (`checkout#2`).

```
Funnel (all)                  count  from prev  from first
  view                            3                   100%
  cta_click                       1      33.3%       33.3%
  signup_started                  1       100%       33.3%
  signup_done                     1       100%       33.3%
```

The functions behind it (`loadRecords`, `funnel`, `summarize`) are exported from `report/lib.mjs` if you want to build your own output.

## Optional: contact-form bot guard

Forms marked with `data-guard` get two hidden fields when submitted: `fe` (milliseconds since page load) and `fi` (`1` if any field in the form was focused). Scripts that POST directly to your form endpoint usually send neither. Combine it with a honeypot field hidden by CSS:

```html
<form action="/contact" method="post" data-guard data-funnel="contact_sent">
  <input name="email" type="email" required>
  <textarea name="message" required></textarea>
  <input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px">
  <button>Send</button>
</form>
```

```js
import { checkForm } from './server/bot-guard.mjs';

const form = new URLSearchParams(body);
const { ok, reason } = checkForm(form, { minMs: 3000, honeypot: 'website' });
// reason: 'honeypot' | 'missing_guard_fields' | 'no_field_focus' | 'too_fast'
```

Answer failed checks the same way as successful ones (same redirect or thank-you page) and store them separately instead of notifying yourself, so bots get no signal and false positives can still be reviewed. Visitors without JavaScript fail the check; if that matters for your audience, treat a failure as "review later", not "delete".

## Privacy notes for operators

- Serve the script and the collector from your own domain. No third party receives the requests.
- Your reverse proxy or hosting provider may still log IP addresses for the `/api/f` requests. Exclude that path from access logs if you want the whole chain free of IPs.
- Keep page values free of personal data. Paths like `/user/jane@example.com` would be stored as sent; use the `page` function and a `PAGES` whitelist if your URLs can contain such data.
- Use the `EVENTS` whitelist so the data contains only events you defined.
- Mention the counter in your privacy policy: what is counted, that no cookies or identifiers are used, and how long you keep the files.

## Tests

```sh
npm test
```

Covers payload validation and whitelists, bot and device detection, the collector end to end over HTTP (including that no IP or user agent reaches the disk), the client in a simulated browser (payload, paid detection, `sendBeacon` and `fetch` fallback, `data-funnel` clicks, form guard fields), the bot guard, and the report funnel math.

## License

MIT, see [LICENSE](LICENSE). Copyright (c) 2026 Karol Bolgár, [nulllogic.eu](https://nulllogic.eu).
