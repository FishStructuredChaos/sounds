// Bump CACHE on any deploy to evict old app shell / stale audio entries.
var CACHE = 'soundboard-v2';
var AUDIO_RE = /\.(mp3|wav|ogg|flac|m4a|aac|opus)$/i;

self.addEventListener('install', function (e) {
    self.skipWaiting();
});

self.addEventListener('activate', function (e) {
    e.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(
                keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })
            );
        }).then(function () {
            return self.clients.claim();
        })
    );
});

self.addEventListener('fetch', function (e) {
    var url = new URL(e.request.url);
    if (!AUDIO_RE.test(url.pathname)) return; // only cache audio; let HTML/JS through fresh

    e.respondWith(
        caches.open(CACHE).then(function (cache) {
            return cache.match(e.request).then(function (cached) {
                // Always revalidate in the background so replaced sounds propagate.
                var network = fetch(e.request).then(function (res) {
                    if (res.ok) cache.put(e.request, res.clone());
                    return res;
                }).catch(function () {
                    // Offline or fetch failed — fall back to cache if we have one.
                    return cached || Response.error();
                });
                // Stale-while-revalidate: serve cache instantly if present, else wait on network.
                return cached || network;
            });
        })
    );
});
