import { renderToString } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { SiteRoute } from "./routes";

const pages = new Map<string, string>();
let routes: readonly SiteRoute[] = [];
let resolve: (path: string) => SiteRoute;
let notFound: SiteRoute;

beforeAll(async () => {
    vi.stubEnv("VITE_WAITLIST", "1");
    vi.resetModules();
    const site = await import("./routes");
    const { App } = await import("./App");
    routes = site.ROUTES;
    resolve = site.routeFor;
    notFound = site.NOT_FOUND;
    for (const r of routes) pages.set(r.path, renderToString(<App route={r} />));
});

describe("the waitlist site", () => {
    it("links to the waitlist and never to the app, sign-in or the demo", () => {
        for (const [path, page] of pages) {
            expect(page, path).not.toMatch(/href="http:\/\/localhost:(8700|8709)/);
            expect(page, path).not.toContain('class="signin"');
            expect(page, path).not.toMatch(/See the demo business|Open the demo/);
            expect(page, path).toContain('href="/waitlist"');
        }
    });

    it("posts the form to the server and keeps the follow-up pages out of search", () => {
        const form = pages.get("/waitlist")?.match(/<form[^>]*>/)?.[0];
        expect(form).toContain('action="/waitlist"');
        expect(form).toContain('method="post"');
        expect(pages.get("/waitlist/retry")).toContain('role="alert"');
        const hidden = routes.filter((r) => r.hidden === true).map((r) => r.path);
        expect(hidden).toEqual(expect.arrayContaining(["/waitlist/retry", "/waitlist/thanks"]));
    });

    it("links only to pages that exist", () => {
        for (const [path, page] of pages) {
            for (const [, href] of page.matchAll(/href="(\/[^"#]*)/g)) {
                if (href === undefined || /\.[a-z0-9]+$/i.test(href)) continue;
                expect(resolve(href), `${path} → ${href}`).not.toBe(notFound);
            }
        }
    });
});
