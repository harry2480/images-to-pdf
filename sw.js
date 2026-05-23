const CACHE_NAME = 'pdf-tools-v1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/manifest.json',
  '/libs/Sortable.min.js',
  '/libs/pdf-lib.min.js',
  '/libs/UTIF.min.js',
  '/libs/pdf.min.js',
  '/libs/pdf.worker.min.js',
  '/libs/fflate.min.js',
  '/libs/cropper.min.js',
  '/libs/cropper.min.css',
  '/js/shared.js',
  '/js/editor.js',
  '/js/jpg-to-pdf.js',
  '/js/merge-pdf.js',
  '/js/pdf-to-jpg.js',
  '/js/compress-pdf.js',
  '/js/split-pdf.js',
  '/js/ocr.js',
  '/js/watermark.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache first, fall back to network
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
