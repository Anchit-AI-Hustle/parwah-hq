/* The launch-list form. Ships only because there is a real backend behind it
   now (POST /api/settings?area=join → the waitlist table on Neon) — a form
   that throws an address away is worse than no form.

   Progressive: the WhatsApp link beside it works with JavaScript off, and this
   file only ever enhances a form that is already in the page. */
(function () {
  var f = document.getElementById('joinform');
  if (!f) return;
  var say = document.getElementById('jf-say');
  var go = document.getElementById('jf-go');
  var source = f.getAttribute('data-source') || (location.pathname.replace(/\/+$/, '') || 'home').replace(/^\//, '');

  function tell(msg, kind) {
    say.textContent = msg;
    say.className = 'say' + (kind ? ' ' + kind : '');
  }

  f.addEventListener('submit', function (e) {
    e.preventDefault();
    var name = f.querySelector('#jf-name').value.trim();
    var email = f.querySelector('#jf-email').value.trim();
    var consent = f.querySelector('#jf-consent').checked;

    // Said here as well as on the server, so the answer is instant and the
    // person is never bounced off a round trip for a missing tick.
    if (!name) { tell('Please tell us your name.', 'bad'); f.querySelector('#jf-name').focus(); return; }
    if (!email) { tell('We need an email address to write to.', 'bad'); f.querySelector('#jf-email').focus(); return; }
    if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) { tell('That does not look like an email address.', 'bad'); f.querySelector('#jf-email').focus(); return; }
    if (!consent) { tell('Please tick the box so we know it is alright to write to you.', 'bad'); f.querySelector('#jf-consent').focus(); return; }

    go.disabled = true;
    tell('Adding you…');
    fetch('/api/settings?area=join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, email: email, consent: true, source: source })
    }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
      .then(function (j) {
        go.disabled = false;
        if (!j.ok) { tell(j.error || 'That did not go through — please try again, or message us on WhatsApp.', 'bad'); return; }
        if (window.parwahTrack) window.parwahTrack('join_waitlist', { label: 'form:' + source });
        // The form is replaced by the answer: leaving the fields filled in
        // invites a second submission and reads as if nothing happened.
        f.innerHTML = '<p class="say good" role="status">' +
          (j.already
            ? 'You are already on the list \u2014 we have your place. \ud83e\udde1'
            : 'Done \u2014 your family is on the list. We will write once, when Parwah opens. \ud83e\udde1') +
          '</p>';
      })
      .catch(function () {
        go.disabled = false;
        tell('No connection just now — please try again, or message us on WhatsApp.', 'bad');
      });
  });
})();
