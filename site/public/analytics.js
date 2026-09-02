/* Conversion measurement for the public site, and nothing more.
   Configured in config.js. Unconfigured, this file does nothing at all — no
   network request, no cookie, no third-party script. Verify by loading any
   page with the IDs blank and watching the network tab stay empty.

   What it measures: page views, and one conversion — joining the launch list,
   whether by the form or by WhatsApp. Both report as `join_waitlist`, because
   they are the same act and splitting them would hide which channel works.

   Never loaded inside /app/. */
(function () {
  var cfg = window.PARWAH_ANALYTICS || {};
  var ga4 = String(cfg.ga4 || '').trim();
  var pixel = String(cfg.metaPixel || '').trim();
  var on = !!(ga4 || pixel);

  // A tracked click is worth knowing about even when nothing is configured —
  // it is how the buttons are wired, so the wiring can be tested. `track`
  // simply has nowhere to send it.
  function track(name, params) {
    var p = params || {};
    if (window.gtag) window.gtag('event', name, p);
    if (window.fbq) window.fbq('track', name === 'join_waitlist' ? 'Lead' : name, p);
    if (window.PARWAH_TRACK_DEBUG) (window.PARWAH_TRACKED = window.PARWAH_TRACKED || []).push([name, p]);
  }
  window.parwahTrack = track;

  if (on) {
    if (ga4) {
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(ga4);
      document.head.appendChild(s);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag('js', new Date());
      // The IP is truncated before it is stored: we want to know which page
      // and which channel converted, not who was reading.
      window.gtag('config', ga4, { anonymize_ip: true });
    }
    if (pixel) {
      /* eslint-disable */
      (function (f, b, e, v, n, t, s) {
        if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
        if (!f._fbq) f._fbq = n; n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
        t = b.createElement(e); t.async = true; t.src = v; s = b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t, s);
      })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
      /* eslint-enable */
      window.fbq('init', pixel);
      window.fbq('track', 'PageView');
    }
  }

  // Anything with data-track reports when it is used. Declarative on purpose:
  // a new call to action is measured by adding an attribute, not by finding
  // and editing this file.
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest('[data-track]');
    if (!el) return;
    track(el.getAttribute('data-track'), { label: el.getAttribute('data-track-label') || el.textContent.trim().slice(0, 60) });
  });
})();
