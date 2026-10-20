// THE PROOF ON THE HOME PAGE - one file, so the owner swaps it in one place.
//
// Two numbers and a few words from families. The numbers are COUNTED: this
// asks the server for the launch list and the app's accounts, straight from
// the database, and shows those. Only when that answer cannot be had (no
// database, a network failure, an old browser) does it fall back to SAMPLE,
// and then the page says so in words beside them.
//
// The quotes are examples until real families have said something we may
// print. Set QUOTES_ARE_EXAMPLES to false only when every quote below is a
// real person's words, used with their permission. Never present a sample as
// a verified figure or a real person's words.
(function () {
  'use strict';

  // Plausible, modest, and never shown without the note that says so.
  var SAMPLE = { waitlist: 214, users: 63 };

  var QUOTES_ARE_EXAMPLES = true;
  var QUOTES = [
    { text: 'My parents are in Lucknow and I am in Bengaluru. Papa\'s medicines and his doctor\'s number are in one place now, and my sister sees them too.',
      who: 'A daughter in Bengaluru' },
    { text: 'Mummy set it up herself with the big buttons. She checks in every morning, and I stop worrying by nine.',
      who: 'A son in Pune' },
    { text: 'When Dadaji\'s insurance was due, the reminder reached all three of us. Nobody had to ask who would pay it.',
      who: 'A grandson in Delhi' }
  ];

  var NOTE = {
    sample: 'Example figures, to be replaced with live numbers.',
    live: 'Live counts from our database, updated every few minutes.',
    quotes: 'The quotes are examples, to be replaced with words from real families.'
  };

  var root = document.getElementById('proof');
  if (!root) return;

  function fmt(n) {
    try { return Number(n).toLocaleString('en-IN'); } catch (e) { return String(n); }
  }

  function quotes() {
    var box = root.querySelector('[data-proof="quotes"]');
    if (!box) return;
    box.textContent = '';
    QUOTES.forEach(function (q) {
      var fig = document.createElement('figure');
      fig.className = 'pf-quote';
      var bq = document.createElement('blockquote');
      bq.textContent = '"' + q.text + '"';
      var cap = document.createElement('figcaption');
      cap.appendChild(document.createTextNode(q.who));
      if (QUOTES_ARE_EXAMPLES) {
        var tag = document.createElement('span');
        tag.className = 'pf-tag';
        tag.textContent = 'Example';
        cap.appendChild(tag);
      }
      fig.appendChild(bq);
      fig.appendChild(cap);
      box.appendChild(fig);
    });
  }

  var settled = false;
  function show(counts, live) {
    if (settled) return;
    settled = true;
    ['waitlist', 'users'].forEach(function (k) {
      var el = root.querySelector('[data-proof="' + k + '"]');
      if (el) el.textContent = fmt(counts[k]);
    });
    var note = root.querySelector('[data-proof="note"]');
    if (note) note.textContent = (live ? NOTE.live : NOTE.sample) + (QUOTES_ARE_EXAMPLES ? ' ' + NOTE.quotes : '');
    root.setAttribute('data-proof-source', live ? 'live' : 'sample');
    root.removeAttribute('aria-busy');
  }

  function isCount(v) { return typeof v === 'number' && v >= 0 && Math.floor(v) === v; }

  quotes();
  // Never leave the numbers blank: a slow answer is no answer.
  var timer = setTimeout(function () { show(SAMPLE, false); }, 3000);
  if (!window.fetch) { clearTimeout(timer); show(SAMPLE, false); return; }
  fetch('/api/auth/?stats=proof', { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      clearTimeout(timer);
      if (d && d.ok && isCount(d.waitlist) && isCount(d.users)) show(d, true);
      else show(SAMPLE, false);
    })
    .catch(function () { clearTimeout(timer); show(SAMPLE, false); });
})();
