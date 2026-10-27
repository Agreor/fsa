const SHELL = ['./', './index.html', './app.js', './style.css', './manifest.webmanifest', './icon.svg', './accounts.js', './src/pdf-reader.js', './src/sources/s1.js', './src/store.js', './src/contracts.js', './src/import-flow.js', './vendor/pdfjs/pdf.min.mjs', './vendor/pdfjs/pdf.worker.min.mjs'];
self.addEventListener('install', (event) => event.waitUntil(caches.open('fsa-shell-v1').then((cache) => cache.addAll(SHELL))));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
