// The app moved from /app/ to the root of the domain, and its service worker
// moved with it to /sw.js. Phones that opened the app before the move still
// have a worker registered for /app/; the browser fetches this file to update
// it, and this version removes itself so the one at /sw.js takes over.
//
// It deletes no caches: the new worker shares this origin's cache storage and
// clears the old versions itself. Reminder subscriptions made through the old
// worker end with it; the app re-subscribes silently the next time it opens,
// and the server drops the dead subscription the first time a send is refused.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(self.registration.unregister());
});
