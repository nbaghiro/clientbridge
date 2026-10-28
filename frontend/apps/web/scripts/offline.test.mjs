import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const { Response } = globalThis;

const worker = readFileSync(new URL("./service-worker.js", import.meta.url), "utf8");

test("the offline shell caches the build manifest and the served config, and never intercepts API calls", async () => {
    const handlers = new Map();
    const stored = new Map();
    const cache = {
        addAll: (assets) => {
            for (const asset of assets) stored.set(asset, new Response(asset));
            return Promise.resolve();
        },
        match: (url) => Promise.resolve(stored.get(url)?.clone()),
        put: (url, response) => {
            stored.set(url, response);
            return Promise.resolve();
        },
    };
    let offline = false;
    let stalled = false;
    let fetched = 0;
    runInNewContext(
        worker
            .replace("const ASSETS = [];", 'const ASSETS = ["/index.html", "/assets/app.js"];')
            .replace("const NETWORK_MS = 3_000;", "const NETWORK_MS = 20;"),
        {
            URL,
            Response,
            self: {
                location: { origin: "https://app.test" },
                clients: { claim: () => Promise.resolve() },
                addEventListener: (name, handler) => handlers.set(name, handler),
            },
            caches: { open: () => Promise.resolve(cache), keys: () => Promise.resolve([]) },
            setTimeout,
            fetch: () =>
                stalled
                    ? new Promise(() => undefined)
                    : offline
                      ? Promise.reject(new Error("offline"))
                      : Promise.resolve(new Response(`online ${String(fetched++)}`)),
        },
    );
    let installed;
    handlers.get("install")({
        waitUntil: (work) => {
            installed = work;
        },
    });
    await installed;
    assert.deepEqual([...stored.keys()], ["/index.html", "/assets/app.js", "/config.js"]);
    const request = async (path, mode = "cors", method = "GET") => {
        let response;
        handlers.get("fetch")({
            request: { url: `https://app.test${path}`, mode, method },
            respondWith: (work) => {
                response = work;
            },
            waitUntil: () => undefined,
        });
        return response;
    };
    assert.equal(await (await request("/config.js")).text(), "online 0");
    offline = true;
    assert.equal(await (await request("/config.js")).text(), "online 0");
    assert.equal(await (await request("/schedule", "navigate")).text(), "/index.html");
    assert.equal(await (await request("/assets/app.js")).text(), "/assets/app.js");
    assert.equal(await request("/v1/me"), undefined);
    assert.equal(await request("/v1/bookings", "cors", "POST"), undefined);
    assert.equal(await request("/assets/app.js?token=secret"), undefined);
    offline = false;
    stalled = true;
    assert.equal(await (await request("/config.js")).text(), "online 0");
    assert.equal(await (await request("/schedule", "navigate")).text(), "/index.html");
});
