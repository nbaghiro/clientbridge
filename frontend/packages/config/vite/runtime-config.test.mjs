import assert from "node:assert/strict";
import test from "node:test";

import { configScript } from "./runtime-config.ts";

const served = (script) =>
    JSON.parse(script.replace("window.__CLIENTBRIDGE_CONFIG__ = ", "").replace(/;\n$/, ""));

test("config.js names each URL the app needs from the same variables Caddy reads", () => {
    const script = configScript(
        { API_URL: "http://localhost:8750", APP_URL: "http://localhost:8751", PATH: "/bin" },
        ["apiUrl", "webUrl"],
    );
    assert.deepEqual(served(script), {
        baseDomain: "",
        webUrl: "http://localhost:8751",
        adminUrl: "",
        apiUrl: "http://localhost:8750",
        authUrl: "",
        syncUrl: "",
        pageUrl: "",
        bookUrl: "",
        shopUrl: "",
        payUrl: "",
        stripePublishableKey: "",
    });
});

test("config.js fails on a missing URL unless a base domain derives it", () => {
    assert.throws(
        () => configScript({ API_URL: "http://localhost:8750" }, ["apiUrl", "webUrl", "payUrl"]),
        /set APP_URL, PAY_URL or BASE_DOMAIN/,
    );
    const script = configScript({ BASE_DOMAIN: "clientbridge.ca" }, ["apiUrl", "webUrl"]);
    assert.equal(served(script).baseDomain, "clientbridge.ca");
});
