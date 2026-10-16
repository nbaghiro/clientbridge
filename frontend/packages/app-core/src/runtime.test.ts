import { afterEach, describe, expect, it } from "vitest";

import { runtimeConfig } from "./runtime";

const served = globalThis as { __CLIENTBRIDGE_CONFIG__?: unknown };

describe("runtimeConfig", () => {
    afterEach(() => {
        delete served.__CLIENTBRIDGE_CONFIG__;
    });

    it("is absent without a served config, so dev keeps its Vite values", () => {
        expect(runtimeConfig()).toBeNull();
        served.__CLIENTBRIDGE_CONFIG__ = {};
        expect(runtimeConfig()).toBeNull();
    });

    it.each(["clientbridge.ca", "staging.clientbridge.ca"])("derives every URL from %s", (base) => {
        served.__CLIENTBRIDGE_CONFIG__ = { baseDomain: base, stripePublishableKey: "pk_test_1" };
        expect(runtimeConfig()).toEqual({
            apiUrl: `https://api.${base}`,
            authUrl: `https://api.${base}/auth`,
            powersyncUrl: `https://sync.${base}`,
            payUrl: `https://pay.${base}`,
            bookUrl: `https://book.${base}`,
            stripePublishableKey: "pk_test_1",
        });
    });

    it("takes the URLs the served config names, as the local app profile does", () => {
        served.__CLIENTBRIDGE_CONFIG__ = {
            baseDomain: "localhost",
            apiUrl: "http://localhost:8750",
            authUrl: "http://localhost:8713",
            syncUrl: "http://localhost:8704",
            payUrl: "http://pay.localhost:8751",
            bookUrl: "http://book.localhost:8751",
            stripePublishableKey: "",
        };
        expect(runtimeConfig()).toEqual({
            apiUrl: "http://localhost:8750",
            authUrl: "http://localhost:8713",
            powersyncUrl: "http://localhost:8704",
            payUrl: "http://pay.localhost:8751",
            bookUrl: "http://book.localhost:8751",
            stripePublishableKey: undefined,
        });
    });

    it("derives what the served config leaves empty, with auth under the API host", () => {
        served.__CLIENTBRIDGE_CONFIG__ = {
            baseDomain: "clientbridge.ca",
            apiUrl: "http://api.internal:8080",
            authUrl: "",
            syncUrl: "",
            payUrl: "",
            bookUrl: "",
        };
        expect(runtimeConfig()).toEqual({
            apiUrl: "http://api.internal:8080",
            authUrl: "http://api.internal:8080/auth",
            powersyncUrl: "https://sync.clientbridge.ca",
            payUrl: "https://pay.clientbridge.ca",
            bookUrl: "https://book.clientbridge.ca",
            stripePublishableKey: undefined,
        });
    });

    it("ignores URLs without a base domain, so dev keeps its Vite values", () => {
        served.__CLIENTBRIDGE_CONFIG__ = { apiUrl: "http://localhost:8750" };
        expect(runtimeConfig()).toBeNull();
    });

    it("leaves the publishable key unset when the deploy has none", () => {
        served.__CLIENTBRIDGE_CONFIG__ = {
            baseDomain: "clientbridge.ca",
            stripePublishableKey: "",
        };
        expect(runtimeConfig()?.stripePublishableKey).toBeUndefined();
    });
});
