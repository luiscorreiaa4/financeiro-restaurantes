/*
 * Service worker do painel (DD-44). Ele existe só para mostrar a tela de aviso offline.
 *
 * Antiobjetivos:
 * - Nada de /api: nenhuma resposta da API passa por aqui nem é guardada.
 * - Nada de HTML de tela com dado de empresa: o cache guarda apenas o precache fixo abaixo,
 *   gravado no install a partir de URL fixa. Resposta da rede no fetch NUNCA é gravada.
 *
 * Mude VERSION sempre que o offline.html (ou o ícone) mudar, para trocar o cache.
 */
const VERSION = "1";
const CACHE_PREFIX = "fr-offline-";
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;
const PRECACHE = ["/offline.html", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      for (const url of PRECACHE) {
        const response = await fetch(url, { cache: "reload" });
        // Redirecionamento (ex.: login no lugar da tela) não pode ser guardado como aviso.
        if (!response.ok || response.redirected) {
          throw new Error("precache recusado");
        }
        await cache.put(url, response);
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.mode !== "navigate" || request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(request).catch(async () => {
      // Cache evictado ou install ainda não concluído: erro de rede, nunca `undefined`.
      const page = await caches.match("/offline.html");
      return page || Response.error();
    }),
  );
});
