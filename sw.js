const CACHE_NAME = "projx-racing-bilingual-v2";
const CORE_ASSETS = [
  "./",
  "./en/",
  "./ar/",
  "./assets/styles.css",
  "./assets/site-config.js",
  "./assets/data.js",
  "./assets/i18n/en.js",
  "./assets/i18n/ar.js",
  "./assets/app.js",
  "./assets/brand/projx-racing-logo-header.png",
  "./assets/brand/projx-racing-logo.png",
  "./assets/brand/icon-192.png",
  "./assets/brand/icon-512.png",
  "./assets/media/projx-thumbs.webp",
  "./assets/media/full/projx-35.webp"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
          return response;
        })
        .catch(async () => {
          const direct = await caches.match(event.request);
          if (direct) return direct;
          const isArabic = url.pathname.includes("/ar/");
          return caches.match(isArabic ? "./ar/" : "./en/");
        })
    );
    return;
  }

  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok && /\.(?:css|js|png|jpe?g|webp|svg|json|webmanifest)$/i.test(url.pathname)) {
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
    }
    return response;
  })));
});
