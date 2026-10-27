const ASSETS = [];
const CACHE = "clientbridge-shell";
const paths = new Set(ASSETS.map((path) => new URL(path, self.location.origin).pathname));

// the served runtime config, kept for offline starts and refreshed whenever the network answers
const CONFIG = "/config.js";

self.addEventListener("install", (event) => {
    event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([...ASSETS, CONFIG])));
});
self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then(async (keys) => {
            await Promise.all(
                keys
                    .filter((key) => key.startsWith("clientbridge-shell-") && key !== CACHE)
                    .map((key) => caches.delete(key)),
            );
            await self.clients.claim();
        }),
    );
});
self.addEventListener("fetch", (event) => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== "GET" || url.origin !== self.location.origin) return;
    if (url.pathname === CONFIG) {
        event.respondWith(
            fetch(request)
                .then(async (response) => {
                    if (response.ok) await (await caches.open(CACHE)).put(CONFIG, response.clone());
                    return response;
                })
                .catch(async () => {
                    const response = await (await caches.open(CACHE)).match(CONFIG);
                    return response ?? Response.error();
                }),
        );
    } else if (request.mode === "navigate") {
        event.respondWith(
            fetch(request).catch(async () => {
                const response = await (await caches.open(CACHE)).match("/index.html");
                return response ?? Response.error();
            }),
        );
    } else if (paths.has(url.pathname) && !url.search) {
        event.respondWith(
            caches
                .open(CACHE)
                .then(async (cache) => (await cache.match(url.pathname)) ?? fetch(request)),
        );
    }
});
