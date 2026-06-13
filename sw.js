var CACHE = 'soundboard-v1';

self.addEventListener('install', function (e) {
    self.skipWaiting();
});

self.addEventListener('activate', function (e) {
    e.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(
                keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })
            );
        })
    );
});

self.addEventListener('fetch', function (e) {
    var url = new URL(e.request.url);
    if (url.pathname.match(/\.(mp3|wav|ogg|flac|m4a|aac|opus)$/i)) {
        e.respondWith(
            caches.match(e.request).then(function (hit) {
                if (hit) return hit;
                return fetch(e.request).then(function (res) {
                    if (res.ok) {
                        var copy = res.clone();
                        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
                    }
                    return res;
                });
            })
        );
    }
});
