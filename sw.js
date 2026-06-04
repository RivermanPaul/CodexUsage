var cacheName = "codex-budget-v13";
var files = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png"
];

self.addEventListener("install", function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(cacheName).then(function (cache) {
      return cache.addAll(files);
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) {
        return key !== cacheName;
      }).map(function (key) {
        return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;

  var url = new URL(event.request.url);
  var isDataRequest = url.pathname.endsWith("/usage.json")
    || url.hostname === "api.github.com"
    || url.hostname === "raw.githubusercontent.com"
    || url.searchParams.has("cache");

  if (isDataRequest || event.request.cache === "no-store") {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      return cached || fetch(event.request);
    })
  );
});
