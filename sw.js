const CACHE_NAME = "family-counter-cache-v151";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./sync.js",
  "./sync-merge.js",
  "./sync-telegram.js",
  "./server-config.js",
  "./telegram-config.js",
  "./telegram-crypto.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./assets/banks/cupis-icon.png",
  "./assets/banks/cupis-card-bg.png",
  "./assets/banks/yoomoney-icon.png",
  "./assets/banks/yoomoney-card-bg.png",
  "./assets/banks/yandex-icon.png",
  "./assets/banks/yandex-card-bg.png",
  "./assets/banks/otp-icon.png",
  "./assets/banks/otp-card-bg.png",
  "./assets/banks/raif-icon.png",
  "./assets/banks/raif-card-bg.png",
  "./assets/banks/tinkoff-icon.png",
  "./assets/banks/tinkoff-card-bg.png",
  "./assets/banks/alfa-icon.png",
  "./assets/banks/alfa-card-bg.png",
  "./assets/banks/sber-icon.png",
  "./assets/banks/sber-card-bg.png",
  "./assets/banks/ozon-icon.png",
  "./assets/banks/wildberries-icon.png",
  "./assets/banks/psb-icon.png",
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

  if (shouldUseNetworkFirst(event.request)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
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
