import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { LINE_ICON_NAMES } from "./art/LineIcon";
import { BRANDS } from "./content/brands";
import { invoices, today } from "./content/demo";
import { PHOTOS } from "./content/photos";
import { TRADES } from "./content/trades";
import { NOT_FOUND, ROUTES, routeFor } from "./routes";

const html = new Map(ROUTES.map((r) => [r.path, renderToString(<App route={r} />)]));

describe("trades", () => {
    it("are complete and unique", () => {
        expect(TRADES.length).toBeGreaterThanOrEqual(8);
        expect(new Set(TRADES.map((t) => t.slug)).size).toBe(TRADES.length);
        for (const t of TRADES) {
            for (const text of [t.name, t.who, t.oneLine, t.h1, t.lede, t.photo.alt]) {
                expect(text.trim(), t.slug).not.toBe("");
            }
            expect(BRANDS[t.slug], t.slug).toBeDefined();
            expect(PHOTOS[t.photo.name], t.slug).toBeDefined();
            if (t.photo2) expect(PHOTOS[t.photo2.name], t.slug).toBeDefined();
            expect(t.capabilities.length, t.slug).toBeGreaterThanOrEqual(6);
            expect(t.bill ?? t.record, t.slug).toBeDefined();
        }
    });

    it("only use line icons that exist", () => {
        for (const t of TRADES) {
            for (const c of t.capabilities) expect(LINE_ICON_NAMES, t.slug).toContain(c.icon);
        }
    });
});

describe("pages", () => {
    it("have a title and a description of a useful length", () => {
        for (const r of [...ROUTES, NOT_FOUND]) {
            expect(r.meta.title.length, r.path).toBeLessThanOrEqual(90);
            expect(r.meta.description.length, r.path).toBeGreaterThanOrEqual(40);
            expect(r.meta.description.length, r.path).toBeLessThanOrEqual(260);
        }
    });

    it("render one h1 each", () => {
        for (const [path, page] of html) expect(page.match(/<h1[\s>]/g)?.length, path).toBe(1);
    });

    it("link only to pages and anchors that exist", () => {
        let checked = 0;
        for (const [path, page] of html) {
            for (const [, href] of page.matchAll(/href="(\/[^"]*)"/g)) {
                if (href === undefined || /\.[a-z0-9]+(#|$)/i.test(href)) continue;
                const [target = "/", anchor] = href.split("#");
                const route = routeFor(target);
                checked += 1;
                expect(route, `${path} → ${href}`).not.toBe(NOT_FOUND);
                if (anchor)
                    expect(html.get(route.path), `${path} → ${href}`).toContain(`id="${anchor}"`);
            }
        }
        expect(checked).toBeGreaterThan(100);
    });
});

describe("demo figures", () => {
    it("agree between the activity list and the invoice list", () => {
        const totals = new Map<string, string[]>();
        for (const inv of invoices)
            totals.set(inv.client, [...(totals.get(inv.client) ?? []), inv.total]);
        for (const row of today.activity) {
            const mine = totals.get(row.who);
            if (mine === undefined || row.what === "Deposit received") continue;
            expect(mine, row.who).toContain(row.amount.replace(" CAD", ""));
        }
    });
});
