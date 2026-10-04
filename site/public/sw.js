// Parwah app service worker - makes the app installable and keeps the shell
// available offline. API calls always go to the network.
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
  e.waitUntil(self.registration.showNotification(d.title || 'Parwah', {
    body: d.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: d.url || '/' }
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) { if ('focus' in list[i]) return list[i].focus(); }
    return self.clients.openWindow((e.notification.data && e.notification.data.url) || '/');
  }));
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.indexOf('/api/') === 0) return; // network only
  // Other sites (the font stylesheet) are the browser's to fetch: nothing of
  // theirs is kept here, and a slow one held by this worker would hold up
  // the next version of Parwah until it finished.
  if (url.origin !== location.origin) return;
  // The page itself always comes from Parwah, never from the browser's own
  // cache: a phone must not keep showing last week's app.
  // redirect: 'manual' hands a redirect (an old /app link) back to the
  // browser to follow, so the address bar and the worker's scope stay right.
  var req = e.request.mode === 'navigate' ? fetch(url.href, { cache: 'no-store', credentials: 'same-origin', redirect: 'manual' }) : fetch(e.request);
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
