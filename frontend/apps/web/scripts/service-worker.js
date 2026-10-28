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
// a captive portal or a stalled network would hold the first paint, so a cached copy answers after this
const NETWORK_MS = 3_000;

async function networkFirst(event, cached, keep) {
    const network = fetch(event.request).then(async (response) => {
        if (keep && response.ok) await keep(response.clone());
        return response;
    });
    // a late answer still refreshes the cache
    event.waitUntil(network.catch(() => undefined));
    const answer = await Promise.race([
        network.catch(() => null),
        new Promise((resolve) => setTimeout(resolve, NETWORK_MS)),
    ]);
    if (answer) return answer;
    const fallback = await cached();
    if (fallback) return fallback;
    return answer === null ? Response.error() : network.catch(() => Response.error());
}

self.addEventListener("fetch", (event) => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== "GET" || url.origin !== self.location.origin) return;
    if (url.pathname === CONFIG) {
        event.respondWith(
            networkFirst(
                event,
                async () => (await caches.open(CACHE)).match(CONFIG),
                async (response) => (await caches.open(CACHE)).put(CONFIG, response),
            ),
        );
    } else if (request.mode === "navigate") {
        event.respondWith(
            networkFirst(event, async () => (await caches.open(CACHE)).match("/index.html")),
        );
    } else if (paths.has(url.pathname) && !url.search) {
        event.respondWith(
            caches
                .open(CACHE)
                .then(async (cache) => (await cache.match(url.pathname)) ?? fetch(request)),
        );
    }
});
