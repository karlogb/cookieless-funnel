// Cloudflare Worker variant: put it on the site's /api/f route.
// It drops bot traffic at the edge and forwards the raw payload to your Node collector,
// adding the visitor country that Cloudflare already knows. The visitor IP is not forwarded.
//
// Variables: COLLECTOR_URL (e.g. https://stats.example.com/api/f)
// On the collector set COUNTRY_HEADER=cf-ipcountry so the country is kept.

const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|preview|monitor|curl|wget|python|go-http|java\/|axios|node-fetch|selenium|puppeteer|playwright/i;

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    const ua = request.headers.get('User-Agent') ?? '';
    const body = await request.text();
    if (ua && !BOT_UA.test(ua) && body.length <= 1024 && env.COLLECTOR_URL) {
      ctx.waitUntil(
        fetch(env.COLLECTOR_URL, {
          method: 'POST',
          body,
          headers: {
            'Content-Type': 'text/plain',
            'User-Agent': ua, // used only for the bot check and mobile/desktop, never stored
            'CF-IPCountry': request.cf?.country ?? '',
          },
        }).catch(() => {}),
      );
    }
    return new Response(null, { status: 204 });
  },
};
