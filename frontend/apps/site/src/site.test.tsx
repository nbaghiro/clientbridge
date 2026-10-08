import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { LINE_ICON_NAMES } from "./art/LineIcon";
import { BRANDS } from "./content/brands";
import { calendar, invoices, tapToPay, today } from "./content/demo";
import { demoSnapshot } from "./content/demo-snapshot";
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
    const money = (cents: number) =>
        new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);

    it("uses a versioned snapshot with genuine payment amounts", () => {
        expect(demoSnapshot.version).toMatch(/^\d{4}-\d{2}-\d{2}/);
        expect(Number.isNaN(Date.parse(demoSnapshot.asOf))).toBe(false);
        expect(invoices.length).toBeGreaterThan(0);
        expect(new Set(invoices.map((invoice) => invoice.number)).size).toBe(invoices.length);
        expect(today.activity.length).toBeGreaterThan(0);
        for (const row of today.activity) {
            expect(row.paymentId).toMatch(/^pay_/);
            expect(row.amountCents).toBeGreaterThan(0);
            expect(row.amount).toBe(`${money(row.amountCents)} CAD`);
            expect(row.who.trim()).not.toBe("");
        }
    });

    it("places actual compatible bookings within the calendar viewport", () => {
        expect(calendar.days).toHaveLength(5);
        expect(calendar.hours).toHaveLength(6);
        expect(calendar.events.length).toBeGreaterThan(0);
        expect(new Set(calendar.events.map((event) => event.bookingId)).size).toBe(
            calendar.events.length,
        );
        for (const event of calendar.events) {
            expect(event.date).toBe(calendar.days.at(event.day)?.iso);
            expect(event.top).toBe(Math.round(((event.startMinute - 540) * 44) / 60) + 4);
            expect(event.height).toBe(Math.round((event.durationMinutes * 44) / 60) - 4);
            expect(event.top).toBeGreaterThanOrEqual(0);
            expect(event.top + event.height).toBeLessThanOrEqual(264);
            if (["it_cat"].includes(event.itemId)) expect(event.species).toBe("cat");
            if (["it_groom_sm", "it_groom_lg"].includes(event.itemId))
                expect(event.species).toBe("dog");
        }
        for (const day of calendar.days) {
            const weekday = new Date(`${day.iso}T12:00:00Z`)
                .toLocaleDateString("en-CA", { weekday: "short", timeZone: "UTC" })
                .toUpperCase();
            expect(day.label).toBe(weekday);
        }
        for (let day = 0; day < calendar.days.length; day += 1) {
            const events = calendar.events
                .filter((event) => event.day === day)
                .sort((a, b) => a.top - b.top);
            for (let index = 1; index < events.length; index += 1) {
                const previous = events[index - 1];
                const current = events[index];
                if (previous !== undefined && current !== undefined)
                    expect(previous.top + previous.height).toBeLessThanOrEqual(current.top);
            }
        }
    });

    it("derives the tap amount and tax from the selected catalog service", () => {
        expect(tapToPay.itemId).toBe("it_groom_sm");
        expect(tapToPay.totalCents).toBe(tapToPay.subtotalCents + tapToPay.taxCents);
        expect(tapToPay.amount).toBe(money(tapToPay.totalCents));
        expect(tapToPay.tax).toContain(money(tapToPay.taxCents));
        expect(tapToPay.tax).toContain("GST");
        expect(tapToPay.tax).not.toContain("PST");
    });
});
