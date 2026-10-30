// THE PROOF ON THE HOME PAGE - one file, so the owner swaps it in one place.
//
// Two numbers and a few words from families. The numbers are COUNTED: this
// asks the server for everyone on the launch list (both halves) and every
// account made in the app, straight from
// the database, and shows those. Only when that answer cannot be had (no
// database, a network failure, an old browser) does it fall back to SAMPLE,
// and then the page says so in words beside them.
//
// The quotes are examples until real families have said something we may
// print. Set QUOTES_ARE_EXAMPLES to false only when every quote below is a
// real person's words, used with their permission. Never present a sample as
// a verified figure or a real person's words.
//
// The section starts hidden and is shown only when it has a number to show
// (a live count worth showing, or the marked sample when there is no answer).
// With no number and only example quotes, it would be three made-up voices
// under "Who is joining Parwah", which reads as fake proof, so it stays out.
(function () {
  'use strict';

  // Plausible, modest, and never shown without the note that says so.
  var SAMPLE = { waitlist: 214, users: 63 };

  // A live count below this is not shown at all: "1 person on the launch
  // list" reads as an empty room, not as proof. Nothing is put in its place;
  // the tile simply waits until the real number is worth showing. Set to 0
  // to always show the live count.
  var MIN_LIVE = 25;

  // What each number is, in the singular and the plural.
  var LABEL = {
    waitlist: ['person on the Parwah launch list', 'people on the Parwah launch list'],
    users: ['Parwah app account made', 'Parwah app accounts made']
  };

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
    var shown = 0;
    ['waitlist', 'users'].forEach(function (k) {
      var el = root.querySelector('[data-proof="' + k + '"]');
      if (!el) return;
      var tile = el.parentNode;
      if (live && counts[k] < MIN_LIVE) { tile.hidden = true; return; }
      tile.hidden = false;
      shown++;
      el.textContent = fmt(counts[k]);
      var lbl = tile.querySelector('.pf-lbl');
      if (lbl) lbl.textContent = LABEL[k][counts[k] === 1 ? 0 : 1];
    });
    var stats = root.querySelector('.pf-stats');
    if (stats) stats.hidden = shown === 0;
    root.hidden = shown === 0 && QUOTES_ARE_EXAMPLES;
    var note = root.querySelector('[data-proof="note"]');
    if (note) note.textContent = (shown === 0 ? '' : (live ? NOTE.live : NOTE.sample) + ' ') + (QUOTES_ARE_EXAMPLES ? NOTE.quotes : '');
    root.setAttribute('data-proof-source', live ? 'live' : 'sample');
    root.removeAttribute('aria-busy');
  }

  function isCount(v) { return typeof v === 'number' && v >= 0 && Math.floor(v) === v; }

  quotes();
  // Never leave the numbers blank: a slow answer is no answer.
  var timer = setTimeout(function () { show(SAMPLE, false); }, 4000);
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
