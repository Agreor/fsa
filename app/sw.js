const CACHE = 'fsa-shell-dev';
const SHELL = ['./', './app.js', './tokens.css', './style.css', './manifest.webmanifest', './icon.svg',
  './accounts.js', './sources.js', './flow.js', './src/pdf-reader.js', './src/sources/s1.js',
  './src/sources/s2.js', './src/sources/s3.js', './src/sources/s5.js', './src/sources/s6.js', './src/trips.js', './src/store.js', './src/contracts.js',
  './src/import-flow.js', './src/transfers.js', './vendor/pdfjs/pdf.min.mjs',
  './settings.js', './rates-flow.js', './src/rates.js', './src/access-secret.js',
  './month-data.js', './month-screen.js', './src/months.js', './src/categories.js',
  './backup-screen.js', './src/backup.js', './classify-data.js', './classify-screen.js',
  './src/classifier.js',
  './home-data.js', './home-screen.js', './banks-data.js', './banks-screen.js',
  './cards-data.js', './cards-screen.js', './src/entries.js', './entries-screen.js', './src/safety.js', './src/approvals.js',
  './flags-data.js', './review-screen.js',
  './dashboard-data.js', './dashboard-screen.js', './series-data.js', './series-screen.js',
  './checks-data.js', './checks-screen.js', './src/balances.js',
  './src/merchant.js',
  './vendor/pdfjs/pdf.worker.min.mjs'];
self.addEventListener('install', (event) => event.waitUntil(
  caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys
  .filter((key) => key.startsWith('fsa-shell-') && key !== CACHE).map((key) => caches.delete(key))))
  .then(() => self.clients.claim())));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
