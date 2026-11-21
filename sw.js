// Service worker simples: guarda a "casca" da app para abrir mesmo sem rede.
const CACHE = 'falta1-v4';
const SHELL = [
  './', './index.html', './css/styles.css', './js/config.js', './js/data.js', './js/matchmaking.js', './js/rating.js', './js/scorer.js', './js/backend.js', './js/app.js',
  './manifest.webmanifest', './icons/icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Ficheiros da app: rede primeiro, cache se falhar. Mapas e fontes vão sempre à rede.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
