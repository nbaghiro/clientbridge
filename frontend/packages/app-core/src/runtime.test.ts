import { afterEach, describe, expect, it } from "vitest";

import {
    bareUrl,
    bookingPageUrl,
    businessPageUrl,
    connectSite,
    pageDomain,
    runtimeConfig,
    shopPageUrl,
} from "./runtime";

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
            adminUrl: `https://admin.${base}`,
            webUrl: `https://app.${base}`,
            apiUrl: `https://api.${base}`,
            authUrl: `https://api.${base}/auth`,
            powersyncUrl: `https://sync.${base}`,
            pageUrl: `https://{slug}.${base}`,
            bookUrl: `https://book.${base}`,
            shopUrl: `https://shop.${base}`,
            payUrl: `https://pay.${base}`,
            stripePublishableKey: "pk_test_1",
        });
    });

    it("takes the URLs the served config names, as the local app profile does", () => {
        served.__CLIENTBRIDGE_CONFIG__ = {
            baseDomain: "localhost",
            adminUrl: "http://admin.localhost:8751",
            webUrl: "http://app.localhost:8751",
            apiUrl: "http://localhost:8750",
            authUrl: "http://localhost:8713",
            syncUrl: "http://localhost:8704",
            pageUrl: "http://{slug}.localhost:8751",
            bookUrl: "http://book.localhost:8751",
            shopUrl: "http://shop.localhost:8751",
            payUrl: "http://pay.localhost:8751",
            stripePublishableKey: "",
        };
        expect(runtimeConfig()).toEqual({
            adminUrl: "http://admin.localhost:8751",
            webUrl: "http://app.localhost:8751",
            apiUrl: "http://localhost:8750",
            authUrl: "http://localhost:8713",
            powersyncUrl: "http://localhost:8704",
            pageUrl: "http://{slug}.localhost:8751",
            bookUrl: "http://book.localhost:8751",
            shopUrl: "http://shop.localhost:8751",
            payUrl: "http://pay.localhost:8751",
            stripePublishableKey: undefined,
        });
    });

    it("derives what the served config leaves empty, with auth under the API host", () => {
        served.__CLIENTBRIDGE_CONFIG__ = {
            baseDomain: "clientbridge.ca",
            adminUrl: "https://admin.clientbridge.ca",
            webUrl: "https://app.clientbridge.ca",
            apiUrl: "http://api.internal:8080",
            authUrl: "",
            syncUrl: "",
            pageUrl: "",
            bookUrl: "",
            shopUrl: "",
            payUrl: "",
        };
        expect(runtimeConfig()).toEqual({
            adminUrl: "https://admin.clientbridge.ca",
            webUrl: "https://app.clientbridge.ca",
            apiUrl: "http://api.internal:8080",
            authUrl: "http://api.internal:8080/auth",
            powersyncUrl: "https://sync.clientbridge.ca",
            pageUrl: "https://{slug}.clientbridge.ca",
            bookUrl: "https://book.clientbridge.ca",
            shopUrl: "https://shop.clientbridge.ca",
            payUrl: "https://pay.clientbridge.ca",
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

const urls = {
    pageUrl: "https://{slug}.clientbridge.ca",
    bookUrl: "https://book.clientbridge.ca",
    shopUrl: "https://shop.clientbridge.ca/",
    payUrl: "https://pay.clientbridge.ca",
};
const local = {
    pageUrl: "http://{slug}.localhost:8709",
    bookUrl: "http://book.localhost:8709",
    shopUrl: "http://shop.localhost:8709",
    payUrl: "http://pay.localhost:8709",
};

describe("links", () => {
    it("puts the slug in the page subdomain and at the root of book and shop", () => {
        expect(businessPageUrl(urls.pageUrl, "birch")).toBe("https://birch.clientbridge.ca");
        expect(bookingPageUrl(urls.bookUrl, "birch")).toBe("https://book.clientbridge.ca/birch");
        expect(shopPageUrl(urls.shopUrl, "birch")).toBe("https://shop.clientbridge.ca/birch");
    });

    it("prints links without the scheme and names the page domain", () => {
        expect(bareUrl("https://birch.clientbridge.ca")).toBe("birch.clientbridge.ca");
        expect(pageDomain(urls.pageUrl)).toBe("clientbridge.ca");
        expect(pageDomain(local.pageUrl)).toBe("localhost:8709");
    });
});

describe("connectSite", () => {
    it.each([
        ["https://book.clientbridge.ca", { kind: "book" }],
        ["https://shop.clientbridge.ca", { kind: "shop" }],
        ["https://pay.clientbridge.ca", { kind: "pay" }],
        ["https://birch-bark.clientbridge.ca", { kind: "page", slug: "birch-bark" }],
    ])("serves %s", (origin, site) => {
        expect(connectSite(origin, urls)).toEqual(site);
    });

    it.each([
        "https://clientbridge.ca",
        "https://a.b.clientbridge.ca",
        "http://birch.clientbridge.ca",
        "https://birch.clientbridge.ca.evil.example",
        "https://birch.staging.clientbridge.ca",
    ])("serves nothing on %s", (origin) => {
        expect(connectSite(origin, urls)).toBeNull();
    });

    it("tells the local hosts apart by subdomain on one port", () => {
        expect(connectSite("http://shop.localhost:8709", local)).toEqual({ kind: "shop" });
        expect(connectSite("http://birch.localhost:8709", local)).toEqual({
            kind: "page",
            slug: "birch",
        });
        expect(connectSite("http://birch.localhost:8723", local)).toBeNull();
    });
});
