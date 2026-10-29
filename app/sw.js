const SHELL = ['./', './app.js', './style.css', './manifest.webmanifest', './icon.svg',
  './accounts.js', './sources.js', './flow.js', './src/pdf-reader.js', './src/sources/s1.js',
  './src/sources/s2.js', './src/sources/s5.js', './src/store.js', './src/contracts.js',
  './src/import-flow.js', './src/transfers.js', './vendor/pdfjs/pdf.min.mjs',
  './settings.js', './rates-flow.js', './src/rates.js', './src/access-secret.js',
  './month-data.js', './month-screen.js', './src/months.js', './src/categories.js',
  './src/merchant.js',
  './vendor/pdfjs/pdf.worker.min.mjs'];
self.addEventListener('install', (event) => event.waitUntil(
  caches.open('fsa-shell-v3').then((cache) => cache.addAll(SHELL))));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys
  .filter((key) => key.startsWith('fsa-shell-') && key !== 'fsa-shell-v3').map((key) => caches.delete(key))))
  .then(() => self.clients.claim())));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
