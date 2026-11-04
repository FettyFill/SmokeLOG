'use strict';
const CACHE_NAME = 'smokelog-shell-BUILD_HASH';
const APP_SHELL = ['./', './index.html', './assets/css/app.css', './app.js', './insights.js', './privacy.html', './terms.html', './supabase-config.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('smokelog-shell-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const url = new URL(request.url);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate' && url.pathname === new URL('./', self.location.href).pathname) return (await cache.match('./index.html')) || Response.error();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try { return await fetch(request, { signal: controller.signal }); }
    catch { return new Response('Risorsa non disponibile offline', { status: 503, headers: { 'Content-Type': 'text/plain' } }); }
    finally { clearTimeout(timeout); }
  })());
});
