/* ============================================================
   MeetSync Service Worker
   Caches the app shell so it loads instantly and works offline
============================================================ */

const CACHE_NAME = 'meetsync-v1';

// Files to cache on install — the core app shell
const SHELL_FILES = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json'
];

// ── Install: cache the app shell ──────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(SHELL_FILES);
    })
  );
  // Take over immediately without waiting for old SW to die
  self.skipWaiting();
});

// ── Activate: delete old caches ───────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  // Control all open tabs immediately
  self.clients.claim();
});

// ── Fetch: network first, fall back to cache ──────────────────
// This strategy means users always get fresh data from Supabase
// but if they're offline the app shell still loads
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Always go to network for Supabase API calls — never cache auth/data
  if (url.hostname.includes('supabase.co') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('jsdelivr.net')) {
    event.respondWith(fetch(request));
    return;
  }

  // For everything else: try network first, fall back to cache
  event.respondWith(
    fetch(request)
      .then(response => {
        // If we got a valid response, clone it into the cache
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => {
        // Network failed — serve from cache
        return caches.match(request).then(cached => {
          if (cached) return cached;
          // If even the cache doesn't have it, serve index.html as fallback
          return caches.match('/index.html');
        });
      })
  );
});
