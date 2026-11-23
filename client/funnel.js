/*! cookieless-funnel client | MIT | https://github.com/karlogb/cookieless-funnel */
// Counts page views, clicks and funnel steps without cookies, storage or identifiers.
// Sends: event name, page, referrer host, traffic source, paid flag, optional step and language.
(function (w, d) {
  "use strict";
  var cfg = w.cookielessFunnel || {};
  var me = d.currentScript;
  var attr = function (n) { return me ? me.getAttribute("data-" + n) : null; };
  var endpoint = cfg.endpoint || attr("endpoint") || "/api/f";
  var withLang = cfg.lang || attr("lang") !== null;

  // Landing context, computed once per page load and kept in memory only.
  var q = new URLSearchParams(location.search);
  var google = q.has("gclid") || q.has("gbraid") || q.has("wbraid");
  var paid = google || q.has("msclkid") || /^(cpc|ppc|paid|paid_?search|paid_?social|display)$/i.test(q.get("utm_medium") || "");
  var src = (q.get("utm_source") || (google ? "google-ads" : q.has("msclkid") ? "microsoft-ads" : "")).toLowerCase().slice(0, 40);
  var ref = "";
  try { ref = d.referrer ? new URL(d.referrer).hostname : ""; } catch (_) {}
  if (ref === location.hostname) ref = "";

  function page() {
    return typeof cfg.page === "function" ? String(cfg.page(location.pathname)) : location.pathname;
  }

  function send(e, step) {
    try {
      var p = { e: String(e), p: page() };
      if (ref) p.ref = ref;
      if (src) p.src = src;
      if (paid) p.paid = 1;
      step = Number(step);
      if (step >= 1 && step <= 99) p.step = Math.floor(step);
      if (withLang && d.documentElement.lang) p.lang = d.documentElement.lang.slice(0, 2).toLowerCase();
      var body = JSON.stringify(p);
      // text/plain keeps the request "simple" (no CORS preflight); the collector parses it as JSON.
      if (!(navigator.sendBeacon && navigator.sendBeacon(endpoint, new Blob([body], { type: "text/plain" }))))
        fetch(endpoint, { method: "POST", body: body, keepalive: true, headers: { "Content-Type": "text/plain" } }).catch(function () {});
    } catch (_) { /* counting must never break the page */ }
  }

  w.funnel = send;
  if (cfg.view !== false && attr("auto") !== "off") send("view");

  // <a data-funnel="cta_click" data-funnel-step="1">
  d.addEventListener("click", function (ev) {
    var el = ev.target.closest && ev.target.closest("[data-funnel]");
    if (el && el.tagName !== "FORM") send(el.getAttribute("data-funnel"), el.getAttribute("data-funnel-step"));
  });

  // Optional form bot guard: forms with data-guard get fe (ms on page) and fi (1 if a field was focused).
  var t0 = Date.now(), touched = false;
  d.addEventListener("focusin", function (ev) { if (ev.target.closest && ev.target.closest("form[data-guard]")) touched = true; });
  d.addEventListener("submit", function (ev) {
    var f = ev.target;
    if (!f || !f.getAttribute) return;
    if (f.hasAttribute("data-guard")) {
      ["fe", "fi"].forEach(function (n) {
        var i = f.querySelector('input[name="' + n + '"]');
        if (!i) { i = d.createElement("input"); i.type = "hidden"; i.name = n; f.appendChild(i); }
        i.value = n === "fe" ? String(Date.now() - t0) : (touched ? "1" : "0");
      });
    }
    if (f.getAttribute("data-funnel")) send(f.getAttribute("data-funnel"), f.getAttribute("data-funnel-step"));
  });
})(window, document);
