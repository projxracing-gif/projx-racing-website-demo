const ASSET_VERSION = "__ASSET_VERSION__";
const CACHE_NAME = `projx-racing-bilingual-v5-${ASSET_VERSION}`;
const CORE_ASSETS = [
  "./",
  "./en/",
  "./ar/",
  `./assets/styles.css?v=${ASSET_VERSION}`,
  `./assets/site-config.js?v=${ASSET_VERSION}`,
  `./assets/data.js?v=${ASSET_VERSION}`,
  `./assets/tegiwa-vehicle-directory.js?v=${ASSET_VERSION}`,
  `./assets/app.js?v=${ASSET_VERSION}`,
  "./assets/brand/projx-racing-logo-header.png",
  "./assets/brand/icon-192.png",
  "./assets/brand/icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all([
    ...keys.filter(key => key.startsWith("projx-racing-bilingual-") && key !== CACHE_NAME).map(key => caches.delete(key)),
    self.clients.claim()
  ])));
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request, { cache: "no-cache" })
        .then(async response => {
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(event.request, response.clone());
          }
          return response;
        })
        .catch(async () => {
          const direct = await caches.match(event.request);
          if (direct) return direct;
          const isArabic = url.pathname.includes("/ar/");
          const preferredLocale = isArabic ? "ar" : "en";
          const alternateLocale = isArabic ? "en" : "ar";
          const preferredBundle = new URL(`./assets/i18n/${preferredLocale}.js?v=${ASSET_VERSION}`, self.registration.scope).href;
          const alternateBundle = new URL(`./assets/i18n/${alternateLocale}.js?v=${ASSET_VERSION}`, self.registration.scope).href;
          const fallbackLocale = await caches.match(preferredBundle) || !await caches.match(alternateBundle) ? preferredLocale : alternateLocale;
          const fallbackPath = `./${fallbackLocale}/`;
          const fallback = await caches.match(fallbackPath);
          if (!fallback) return Response.error();
          return Response.redirect(new URL(fallbackPath, self.registration.scope).href, 302);
        })
    );
    return;
  }

  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(async response => {
    if (response.ok && /\.(?:css|js|png|jpe?g|webp|svg|json|webmanifest)$/i.test(url.pathname)) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(event.request, response.clone());
    }
    return response;
  })));
});
