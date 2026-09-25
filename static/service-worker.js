const CACHE_NAME = "enlace-shell-v4";
const SHELL_FILES = [
  "/manifest.json",
  "/static/style.css",
  "/static/transfer.js",
  "/static/notifications.js",
  "/static/pc.js",
  "/static/remote.js",
  "/static/socket.io.min.js",
  "/static/jszip.min.js",
  "/static/icons/icon-192.png",
  "/static/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
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

// Estrategia Network-First para asegurar código y plantillas siempre actualizadas
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  // Ignorar llamadas de API, WebSocket y autenticación
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/socket.io/") ||
    url.pathname === "/login" ||
    url.pathname === "/logout"
  ) {
    return;
  }

  // Navegación (HTML): ir siempre a la red primero
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        return new Response("<html><body><h2>Sin conexión</h2><p>No se pudo conectar con Enlace.</p></body></html>", {
          status: 503,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      })
    );
    return;
  }

  // Recursos estáticos: Network-first con fallback a cache
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
        }
        return networkResponse;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        return new Response("", { status: 503, statusText: "Offline" });
      })
  );
});

// Al tocar una notificación nativa, enfocar la ventana existente
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
