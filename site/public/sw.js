// Parwah app service worker - makes the app installable and keeps the shell
// available offline and on a slow network. API calls always go to the network.
var CACHE = 'parwah-app-v42';
var SHELL = ['/', '/manifest.webmanifest', '/icon-192.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

// Before v42 the page could not reliably see a newer version for itself (a
// short-lived v41 worker shipped without this step). A window still running
// one of those copies is moved onto the new page once, here, since its own
// code never will. Later pages watch for updates themselves (and wait while
// someone has typed something), so they are left alone.
var SELF_UPDATING = 42;
function preSelfUpdating(k) {
  var m = /^parwah-app-v(\d+)$/.exec(k);
  return !!m && +m[1] < SELF_UPDATING;
}

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    var old = keys.some(preSelfUpdating);
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }))
      .then(function () { return self.clients.claim(); })
      .then(function () {
        if (!old) return;
        // The windows are found inside activation, so the worker lives
        // until every move has been started. The moves themselves are not
        // awaited: each window's request for the page waits for this worker
        // to finish activating, so waiting on them would leave both waiting.
        return self.clients.matchAll({ type: 'window' }).then(function (list) {
          list.forEach(function (c) { if ('navigate' in c) c.navigate(c.url).catch(function () {}); });
        });
      });
  }));
});

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data.json(); } catch (err) {}
  // An SOS stays on the screen until someone deals with it, buzzes in the
  // long pattern a phone uses for an emergency, and replaces (rather than
  // stacks under) an earlier SOS alert.
  // A phone being rung to find it buzzes long too, under its own tag so it
  // never replaces an SOS.
  var urgent = !!d.urgent, ring = !urgent && !!d.ring;
  e.waitUntil(self.registration.showNotification(d.title || 'Parwah', {
    body: d.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: d.url || '/', family: d.family || null },
    tag: urgent ? 'parwah-sos' : ring ? 'parwah-ring' : undefined,
    renotify: urgent || ring,
    requireInteraction: urgent || ring,
    silent: false,
    vibrate: urgent || ring ? [800, 300, 800, 300, 800, 300, 1500, 500, 800, 300, 800, 300, 800] : [200]
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  // Someone in two families: the alert says which family it is from, and
  // the open window is told, so it can show that family.
  var fam = e.notification.data && e.notification.data.family;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if ('focus' in list[i]) {
        if (fam) { try { list[i].postMessage({ parwah: 'open-family', family: fam }); } catch (err) {} }
        return list[i].focus();
      }
    }
    return self.clients.openWindow((e.notification.data && e.notification.data.url) || '/');
  }));
});

// A POOR NETWORK MUST NOT MEAN A BLANK SCREEN. The page is more than a
// megabyte, and it used to be fetched in full on every open, with the saved
// copy used only once the network had failed outright; on one bar of signal
// that is a white screen for a minute. Now the network is still asked first,
// but if it has not answered within three seconds the saved copy is shown.
// The fresh one keeps coming in the background, replaces the saved one, and
// if it is different the open window is told: "Updated. Tap to refresh".
// Nothing under /api/ ever comes from here: a saved answer about a family is
// an old answer.
var SLOW_MS = 3000;
function tellWindows(msg) {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    list.forEach(function (c) { try { c.postMessage(msg); } catch (err) {} });
  });
}
function page(e, url) {
  var shownSaved = false;
  var saved = caches.match(e.request, { ignoreSearch: true });
  // The page itself always comes from Parwah, never from the browser's own
  // cache: a phone must not keep showing last week's app.
  // redirect: 'manual' hands a redirect (an old /app link) back to the
  // browser to follow, so the address bar and the worker's scope stay right.
  var net = fetch(url.href, { cache: 'no-store', credentials: 'same-origin', redirect: 'manual' });
  var kept = net.then(function (res) {
    if (!res.ok) return null;
    var copy = res.clone();
    return caches.open(CACHE).then(function (c) {
      if (!shownSaved) return c.put(e.request, copy);
      return saved.then(function (old) {
        return Promise.all([old ? old.clone().text() : null, copy.clone().text()]).then(function (t) {
          return c.put(e.request, copy).then(function () {
            if (t[0] !== null && t[0] !== t[1]) return tellWindows({ parwah: 'updated' });
          });
        });
      });
    });
  }).catch(function () {});
  // The worker stays alive until the fresh copy is in, however slow.
  e.waitUntil(kept);
  var slow = new Promise(function (resolve) {
    setTimeout(function () {
      saved.then(function (old) { if (old) { shownSaved = true; resolve(old.clone()); } });
    }, SLOW_MS);
  });
  return Promise.race([net, slow]).catch(function () {
    return saved.then(function (old) { return old ? old.clone() : Response.error(); });
  });
}

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.indexOf('/api/') === 0) return; // network only
  // Other sites (the font stylesheet) are the browser's to fetch: nothing of
  // theirs is kept here, and a slow one held by this worker would hold up
  // the next version of Parwah until it finished.
  if (url.origin !== location.origin) return;
  if (e.request.mode === 'navigate') { e.respondWith(page(e, url)); return; }
  var req = fetch(e.request);
  e.respondWith(
    req.then(function (res) {
      if (res.ok && url.origin === location.origin) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(e.request, { ignoreSearch: true });
    })
  );
});
