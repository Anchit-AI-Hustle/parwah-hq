// PARWAH ANALYTICS - the marketing pages only, and only after a yes.
//
// Two rules this file exists to keep.
//
// It is not loaded inside /app/. The app is where a family keeps health
// facts, documents, addresses and who checked in on whom. This brand's
// promise on its own home page is "Reassurance, never surveillance", and
// sending that behaviour to Google would make the promise false. Measure the
// funnel; leave the family alone.
//
// Nothing reaches Google before consent. India's DPDP Act wants a real
// choice, so the tag is fetched on Allow and not a moment sooner. With no
// measurement ID set, no bar is shown and no request is ever made, which
// means this file is safe to ship before the GA4 property exists.
(function () {
  'use strict';

  // Paste the GA4 measurement ID here (G-XXXXXXXXXX) and tracking begins.
  var GA4 = '';

  var KEY = 'parwah-consent';
  var loaded = false;

  function answer(v) { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function remember(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }

  function load() {
    if (loaded || !GA4) return;
    loaded = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    // No advertising signals, and the IP truncated: this is here to count
    // people, not to follow them.
    window.gtag('config', GA4, { anonymize_ip: true, allow_google_signals: false });
    flush();
  }

  // Events raised before consent are held, not dropped, so a person who
  // clicks the WhatsApp button and then says Allow is still counted once.
  var queue = [];
  function flush() {
    while (queue.length) { var e = queue.shift(); try { window.gtag('event', e[0], e[1]); } catch (err) {} }
  }
  function track(name, params) {
    if (loaded && window.gtag) { try { window.gtag('event', name, params || {}); } catch (e) {} return; }
    if (queue.length < 20) queue.push([name, params || {}]);
  }
  window.parwahTrack = track;

  // ---- what counts as a conversion here -------------------------------
  // Joining the launch list is the only thing these pages exist to cause.
  // It happens on WhatsApp or by email, so both are the same event with the
  // route recorded, and the funnel reads as one number.
  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (href.indexOf('https://wa.me/') === 0) {
      track('join_waitlist', { method: 'whatsapp', page: location.pathname });
    } else if (href.indexOf('mailto:') === 0) {
      track('join_waitlist', { method: 'email', page: location.pathname });
    } else if (/(^|\/)app\/?($|[?#])/.test(href)) {
      track('open_app', { page: location.pathname });
    } else if (/(^|\/)demo\/?($|[?#])/.test(href)) {
      track('open_demo', { page: location.pathname });
    } else if (/(^|\/)get\/?($|[?#])/.test(href)) {
      track('open_install', { page: location.pathname });
    }
  }, true);

  // ---- the choice ------------------------------------------------------
  function bar() {
    var el = document.createElement('div');
    el.className = 'pw-consent';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Cookie choice');
    el.innerHTML =
      '<p>We would like to count visits with Google Analytics, so we know which pages actually help. '
      + 'No advertising cookies, and nothing from inside the app. You can change your mind any time.</p>'
      + '<button type="button" class="pw-yes">Allow</button>'
      + '<button type="button" class="pw-no">No thanks</button>';
    var css = document.createElement('style');
    css.textContent =
      '.pw-consent{position:fixed;left:0;right:0;bottom:0;z-index:60;display:flex;gap:12px;align-items:center;'
      + 'flex-wrap:wrap;padding:14px 20px calc(14px + env(safe-area-inset-bottom));background:#182622;color:#EFE8D8;'
      + 'font:500 .88rem/1.5 system-ui,sans-serif;box-shadow:0 -6px 24px rgba(0,0,0,.25)}'
      + '.pw-consent p{flex:1;min-width:240px;margin:0;color:#CFC6B8}'
      + '.pw-consent button{border:0;border-radius:999px;padding:11px 20px;font:inherit;font-weight:700;'
      + 'cursor:pointer;min-height:44px}'
      + '.pw-yes{background:#E8A23D;color:#182622}'
      + '.pw-no{background:transparent;color:#EFE8D8;border:1px solid rgba(239,232,216,.45)}'
      + '@media(prefers-reduced-motion:no-preference){.pw-consent{animation:pwup .28s ease-out}'
      + '@keyframes pwup{from{transform:translateY(100%)}to{transform:none}}}';
    document.head.appendChild(css);
    document.body.appendChild(el);
    el.querySelector('.pw-yes').addEventListener('click', function () { remember('yes'); el.remove(); load(); });
    el.querySelector('.pw-no').addEventListener('click', function () { remember('no'); el.remove(); queue.length = 0; });
  }

  function start() {
    if (!GA4) return;                      // nothing to ask about, nothing to load
    var said = answer();
    if (said === 'yes') { load(); return; }
    if (said === 'no') return;
    // Someone who has asked not to be tracked has already answered.
    if (navigator.doNotTrack === '1' || window.doNotTrack === '1') { remember('no'); return; }
    bar();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
