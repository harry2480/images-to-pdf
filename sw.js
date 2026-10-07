const CACHE_NAME = 'pdf-tools-v7';
// AI runtime + models, filled by js/enhance-worker.js on first use. Must survive app updates.
const ENHANCE_CACHE = 'enhance-models-v1';

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
  '/js/image-convert.js',
  '/js/compress-image.js',
  '/js/enhance-image.js',
  '/js/enhance-worker.js',
  '/js/compress-pdf.js',
  '/js/split-pdf.js',
  '/js/organize-pdf.js',
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
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== ENHANCE_CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Lazy-loaded on first HEIC use; too large (~1.3MB) to precache for everyone,
// so it is cached the first time it is fetched online and then works offline.
const RUNTIME_CACHED = ['/libs/heic2any.min.js'];

// Cache first, fall back to network
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const { pathname } = new URL(event.request.url);
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (res.ok && RUNTIME_CACHED.includes(pathname)) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return res;
      });
    })
  );
});
