const CACHE_NAME = "family-counter-cache-v180";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./sync.js",
  "./sync-merge.js",
  "./sync-telegram.js",
  "./sync-firebase.js",
  "./firebase-config.js",
  "./server-config.js",
  "./telegram-config.js",
  "./telegram-crypto.js",
  "./manifest.webmanifest",
  "./icon.svg",
];

function shouldUseNetworkFirst(request) {
  if (request.mode === "navigate") return true;
  const url = request.url;
  return [".html", ".js", ".css"].some((ext) => url.includes(ext));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const url = event.request.url;
  if (url.includes("/tg-proxy/") || url.includes("api.telegram.org")) return;
  if (event.request.method !== "GET") return;

  // Кэш ищем без учёта ?v=… (в precache файлы лежат без query).
  const matchCached = () =>
    caches.match(event.request, { ignoreSearch: true });

  if (shouldUseNetworkFirst(event.request)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
            return response;
          }
          // 404/500 и т.п. — пробуем отдать из кэша, чтобы не падал запуск.
          return matchCached().then((cached) => cached || response);
        })
        .catch(() => matchCached())
    );
    return;
  }

  event.respondWith(
    matchCached().then((cached) => {
      return cached || fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
    })
  );
});
