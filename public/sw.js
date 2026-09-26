const CACHE = 'aegis-shell-v3';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('aegis-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
    if (event.request.mode === 'navigate') {
        event.respondWith(fetch(event.request).then(response => {
            if (response.ok) { const copy = response.clone(); void caches.open(CACHE).then(cache => cache.put('/index.html', copy)); }
            return response;
        }).catch(() => caches.match('/index.html')));
        return;
    }
    if (!url.pathname.startsWith('/assets/') && !['/manifest.webmanifest', '/az-air-travels-logo.png'].includes(url.pathname)) return;
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
        if (response.ok) { const copy = response.clone(); void caches.open(CACHE).then(cache => cache.put(event.request, copy)); }
        return response;
    })));
});
