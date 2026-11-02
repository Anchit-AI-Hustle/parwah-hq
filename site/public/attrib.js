// WHERE A PERSON CAME FROM, WITHOUT A PIXEL.
//
// Every WhatsApp button on the public pages pre-fills a short source code in
// the message, like "Hi Parwah (LI1)", so the first message we receive says
// which post, ad or forward brought the person. No cookie, no tag, nothing
// sent to anyone: the code is in the words the person chooses to send.
//
// The code comes from the landing address, first touch, kept for this tab
// in sessionStorage so a person who lands on /story/ from LinkedIn and joins
// on /launch/ still says LI:
//   ?ref=LI1                               -> LI1 (a code we wrote, used as is)
//   ?utm_source=linkedin&utm_campaign=1    -> LI1 (source prefix + campaign)
//   no labels at all                       -> the landing page's own code
// The /launch/ form sends the same labels with the join (api/_waitlist.mjs).
(function () {
  'use strict';
  var KEY = 'parwah-src';
  var PAGE_CODE = {
    '/welcome/': 'WEL', '/story/': 'STO', '/story/aisle/': 'AIS', '/care/': 'CAR',
    '/launch/': 'LAU', '/get/': 'GET', '/press/': 'PRS', '/privacy/': 'PRV', '/terms/': 'TRM'
  };
  var SOURCE = {
    linkedin: 'LI', lnkd: 'LI', facebook: 'FB', fb: 'FB', instagram: 'IG', ig: 'IG', meta: 'MT',
    whatsapp: 'WA', wa: 'WA', email: 'EM', mail: 'EM', newsletter: 'EM', google: 'GO',
    youtube: 'YT', creator: 'CR', influencer: 'CR', press: 'PR', rwa: 'RW', hr: 'HR',
    twitter: 'XT', x: 'XT', sms: 'SM', qr: 'QR'
  };

  function code(v, n) { return String(v == null ? '' : v).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, n); }
  function label(v) { return String(v == null ? '' : v).trim().replace(/[^A-Za-z0-9._-]/g, '').slice(0, 60); }

  function pageCode(path) {
    var p = String(path || '/').replace(/index\.html$/, '');
    if (!/\/$/.test(p)) p += '/';
    return PAGE_CODE[p] || 'WEB';
  }

  function fromQuery(search) {
    var q;
    try { q = new URLSearchParams(search || ''); } catch (e) { return null; }
    var ref = code(q.get('ref'), 10);
    var src = String(q.get('utm_source') || '').toLowerCase().replace(/[^a-z]/g, '');
    var c = '';
    if (ref.length >= 2) c = ref;
    else if (src) {
      var pre = SOURCE[src] || code(src, 2);
      if (pre.length === 2) c = pre + code(q.get('utm_campaign'), 6);
    }
    if (!c) return null;
    return {
      code: c,
      utm_source: label(q.get('utm_source')) || null,
      utm_medium: label(q.get('utm_medium')) || null,
      utm_campaign: label(q.get('utm_campaign')) || null,
      ref: label(q.get('ref')) || null
    };
  }

  function read() { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function write(v) { try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }

  // First touch wins for the whole tab. Storage can be missing (a private
  // window, blocked site data); then the code is simply this page's.
  var first = read();
  if (!first || !first.code) {
    first = fromQuery(location.search) || { code: pageCode(location.pathname), utm_source: null, utm_medium: null, utm_campaign: null, ref: null };
    write(first);
  }

  // "Hi Parwah (CAR) - add me..." becomes "Hi Parwah (LI1) - add me...".
  // The code sits right after the greeting so it is the first thing we read.
  var GREETING = /^((?:Hi|Hello|Namaste)\s+Parwah!?)(\s*\([A-Z0-9]{2,12}\))?/i;
  function tagText(text, c) {
    var t = String(text || '');
    if (GREETING.test(t)) return t.replace(GREETING, '$1 (' + c + ')');
    return '(' + c + ') ' + t.replace(/^\([A-Z0-9]{2,12}\)\s*/, '');
  }
  function tag(href) {
    try {
      var u = new URL(href);
      if (u.hostname !== 'wa.me') return href;
      u.searchParams.set('text', tagText(u.searchParams.get('text') || 'Hi Parwah', first.code));
      // URLSearchParams writes spaces as "+", which WhatsApp shows as "+".
      return u.toString().replace(/\+/g, '%20');
    } catch (e) { return href; }
  }

  function apply() {
    var links = document.querySelectorAll('a[href^="https://wa.me/"]');
    for (var i = 0; i < links.length; i++) links[i].setAttribute('href', tag(links[i].getAttribute('href')));
  }

  window.parwahAttribution = {
    code: first.code,
    utm_source: first.utm_source,
    utm_medium: first.utm_medium,
    utm_campaign: first.utm_campaign,
    ref: first.ref,
    tag: tag
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
})();
