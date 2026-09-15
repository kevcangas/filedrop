const CACHE_NAME = "enlace-shell-v2";
const SHELL_FILES = [
  "/mobile",
  "/desktop",
  "/manifest.json",
  "/static/style.css",
  "/static/transfer.js",
  "/static/notifications.js",
  "/static/remote.js",
  "/static/socket.io.min.js",
  "/static/jszip.min.js",
  "/static/icons/icon-192.png",
  "/static/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first para el "shell" de la app: permite abrir la app aunque no haya
// ninguna computadora encendida en ese momento (solo se necesita red para conectar).
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).catch(() => cached);
    })
  );
});

// Al tocar una notificacion nativa, enfoca la pestana/app de Enlace ya
// abierta (o abre una nueva si no hay ninguna).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});
