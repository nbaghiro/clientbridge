import { randomUUID } from "node:crypto";
import {
    combineDayAndTime,
    dateKey,
    formatMoney,
    formatTime,
    strings,
} from "@clientbridge/app-core/public";
import { expect, test, type Page, type Request, type Route } from "@playwright/test";

import { bookingApi } from "./support/bookings";
import { createClient, type ClientFixture } from "./support/crm";
import {
    entitlementEvidence,
    expectEntitlementLedger,
    openEntitlement,
    sellEntitlement,
} from "./support/entitlements";
import { requireLocalMail } from "./support/evidence";
import { joinHoursStaff } from "./support/offline";
import { navigate, signIn } from "./support/session";
import { apiCall, visitEvidence } from "./support/visits";

const w = strings.entitlements;
const r = strings.refunds;
const zone = "America/Vancouver";

async function packageFor(page: Page, client: ClientFixture, coversItemId?: string) {
    await requireLocalMail();
    const item = await apiCall<{ id: string }>(
        page,
        "POST",
        "/v1/items",
        {
            kind: "package",
            name: `${client.name} — Two Gentle Grooming Visits`,
            sku: `BB-PAIR-${randomUUID().slice(0, 8).toUpperCase()}`,
            price_cents: 6001,
            tax_class: "exempt",
            session_count: 2,
            validity_days: 365,
            active: true,
            ...(coversItemId === undefined ? {} : { covers_item_id: coversItemId }),
        },
        201,
    );
    await sellEntitlement(page, client, "package", item.id);
    const sold = await entitlementEvidence(client.id);
    expect(sold.packages).toEqual([
        {
            id: expect.any(String),
            item_id: item.id,
            sessions_total: 2,
            status: "active",
            payment_id: sold.payments[0]?.id,
        },
    ]);
    expectEntitlementLedger(sold, 6001, "deferred", []);
    const pack = sold.packages[0];
    const payment = sold.payments[0];
    if (pack === undefined || payment === undefined) throw new Error("The package is missing");
    return { itemId: item.id, packageId: pack.id, paymentId: payment.id, sold };
}

function deskRow(page: Page, service: string, starts: Date) {
    return page
        .getByRole("main")
        .locator("div")
        .filter({ hasText: service })
        .filter({ hasText: formatTime(starts, zone) })
        .filter({
            has: page.getByText(
                strings.pos.desk.endsAt(formatTime(new Date(starts.getTime() + 5 * 60_000), zone)),
                { exact: true },
            ),
        })
        .last();
}

/** Holds each request until both have arrived, then lets them through together. */
function pairBarrier() {
    const held: Request[] = [];
    let release: () => void = () => undefined;
    const open = new Promise<void>((resolve) => {
        release = resolve;
    });
    const hold = async (route: Route) => {
        if (route.request().method() !== "POST") return route.continue();
        held.push(route.request());
        if (held.length === 2) release();
        await open;
        await route.continue();
    };
    return { held, hold };
}

test("FLOW-07-A a package keeps the benefits it was sold with, covers only its service, settles a final-session race once and then refuses a refund in words", async ({
    page,
    browser,
    request,
    baseURL,
}, testInfo) => {
    test.setTimeout(300_000);
    const joining = await browser.newContext({ baseURL: baseURL ?? "" });
    // a member with no hours set can take a visit at any time, so every visit starts today
    const member = await joinHoursStaff(await joining.newPage(), request);
    const second = await browser.newContext({
        baseURL: baseURL ?? "",
        viewport: { width: 1440, height: 900 },
    });
    try {
        await signIn(page);
        const client = await createClient(page);
        const services: Record<"covered" | "other", { id: string; name: string }> = {
            covered: await apiCall(
                page,
                "POST",
                "/v1/items",
                {
                    kind: "service",
                    name: `Bath and brush for ${client.name}`,
                    duration_min: 5,
                    price_cents: 3000,
                    deposit_type: "none",
                    online_bookable: false,
                },
                201,
            ),
            other: await apiCall(
                page,
                "POST",
                "/v1/items",
                {
                    kind: "service",
                    name: `Nail trim for ${client.name}`,
                    duration_min: 5,
                    price_cents: 1500,
                    deposit_type: "none",
                    online_bookable: false,
                },
                201,
            ),
        };
        const fixture = await packageFor(page, client, services.covered.id);

        // the catalog changes after the sale; the sold package must not follow it
        await apiCall(
            page,
            "PATCH",
            `/v1/items/${fixture.itemId}`,
            { price_cents: 9000, session_count: 5 },
            200,
        );
        await openEntitlement(page, client.name, fixture.packageId);
        const detail = page.getByRole("dialog");
        await expect(detail).toContainText(w.sessionsLeft(2, 2), { timeout: 60_000 });
        await expect(detail).toContainText(w.factNextSession);
        await expect(detail).toContainText(formatMoney(3000, "CAD"));
        await expect(detail).not.toContainText(formatMoney(4500, "CAD"));
        expect((await entitlementEvidence(client.id)).packages[0]?.sessions_total).toBe(2);

        const midnight = combineDayAndTime(dateKey(new Date(), zone), "00:00", zone).getTime();
        const wait = midnight + 17 * 60_000 - Date.now();
        if (wait > 0) await page.waitForTimeout(wait);
        const now = Date.now();
        const visits: { id: string; starts: Date; service: { id: string; name: string } }[] = [];
        for (const [service, minutesAgo] of [
            [services.other, 16],
            [services.covered, 11],
            [services.covered, 6],
        ] as const) {
            const starts = new Date(Math.floor((now - minutesAgo * 60_000) / 60_000) * 60_000);
            const booked = await apiCall<{ id: string; status: string }>(
                page,
                "POST",
                "/v1/bookings",
                {
                    client_id: client.id,
                    item_id: service.id,
                    staff_id: member.id,
                    starts_at: starts.toISOString(),
                    notify: false,
                },
                201,
            );
            expect(booked.status).toBe("confirmed");
            visits.push({ id: booked.id, starts, service });
        }
        const [trim, first, last] = visits;
        if (trim === undefined || first === undefined || last === undefined)
            throw new Error("Visits are missing");

        await navigate(page, "/payments/sales");
        const use = { name: strings.pos.desk.usePackage, exact: true };
        await expect(deskRow(page, trim.service.name, trim.starts)).toBeVisible({
            timeout: 60_000,
        });
        await expect(
            deskRow(page, trim.service.name, trim.starts).getByRole("button", use),
        ).toHaveCount(0);
        const refused = await page.request.post(
            `${bookingApi()}/v1/packages/${fixture.packageId}/cover`,
            {
                headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
                data: { booking_id: trim.id },
            },
        );
        expect(refused.status(), await refused.text()).toBe(409);
        expectEntitlementLedger(await entitlementEvidence(client.id), 6001, "deferred", []);

        const covering = page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === `/v1/packages/${fixture.packageId}/cover` &&
                response.request().method() === "POST",
        );
        await deskRow(page, first.service.name, first.starts).getByRole("button", use).click();
        const covered = await covering;
        expect(covered.status(), await covered.text()).toBe(200);
        expect(await covered.json()).toMatchObject({ sessions_used: 1, status: "active" });
        expectEntitlementLedger(await entitlementEvidence(client.id), 6001, "deferred", [3000]);

        const other = await second.newPage();
        await signIn(other);
        await openEntitlement(other, client.name, fixture.packageId);
        const otherDetail = other.getByRole("dialog");
        await expect(otherDetail).toContainText(w.sessionsLeft(1, 2), { timeout: 60_000 });
        // the last session takes what is left of the paid value, not a share of today's price
        await expect(otherDetail).toContainText(formatMoney(3001, "CAD"));
        await expect(otherDetail).not.toContainText(formatMoney(4500, "CAD"));

        const barrier = pairBarrier();
        await page.route(`**/v1/packages/${fixture.packageId}/cover`, barrier.hold);
        await other.route(`**/v1/packages/${fixture.packageId}/consume`, barrier.hold);
        const responses = [
            page.waitForResponse(
                (response) =>
                    new URL(response.url()).pathname ===
                        `/v1/packages/${fixture.packageId}/cover` &&
                    response.request().method() === "POST",
            ),
            other.waitForResponse(
                (response) =>
                    new URL(response.url()).pathname ===
                        `/v1/packages/${fixture.packageId}/consume` &&
                    response.request().method() === "POST",
            ),
        ];
        await expect(deskRow(page, last.service.name, last.starts)).toBeVisible();
        await deskRow(page, last.service.name, last.starts).getByRole("button", use).click();
        await other.getByRole("button", { name: w.action.use, exact: true }).click();
        await other
            .getByRole("dialog")
            .last()
            .getByRole("button", { name: w.action.use, exact: true })
            .click();
        await expect.poll(() => barrier.held.length).toBe(2);
        const [cover, consume] = await Promise.all(responses);
        if (cover === undefined || consume === undefined) throw new Error("A race reply is gone");
        expect([cover.status(), consume.status()].sort()).toEqual([200, 409]);
        const coverWon = cover.status() === 200;
        const exhausted = await entitlementEvidence(client.id);
        expectEntitlementLedger(exhausted, 6001, "deferred", [3000, 3001]);
        expect(exhausted.packages[0]?.status).toBe("used");
        const booked = await visitEvidence([client.id]);
        const byId = (id: string) => booked.bookings.find((booking) => booking.id === id);
        expect(byId(trim.id)).toMatchObject({ status: "confirmed", package_id: null });
        expect(byId(first.id)).toMatchObject({
            status: "completed",
            package_id: fixture.packageId,
        });
        expect(byId(last.id)).toMatchObject(
            coverWon
                ? { status: "completed", package_id: fixture.packageId }
                : { status: "confirmed", package_id: null },
        );

        for (const device of [page, other]) {
            await device.unrouteAll({ behavior: "wait" });
            await openEntitlement(device, client.name, fixture.packageId);
            await expect(device.getByRole("dialog")).toContainText(w.statusLabel.used, {
                timeout: 60_000,
            });
            await expect(
                device.getByRole("button", { name: w.action.use, exact: true }),
            ).toHaveCount(0);
            await expect(
                device.getByRole("button", { name: w.action.refund, exact: true }),
            ).toHaveCount(0);
        }

        await navigate(page, `/payments/refunds?open=${fixture.paymentId}`);
        const panel = page.getByRole("complementary", { name: client.name, exact: true });
        await expect(panel.getByText(r.blocked.package_used, { exact: true })).toBeVisible({
            timeout: 60_000,
        });
        await expect(
            panel.getByRole("button", { name: r.refundButton(formatMoney(6001, "CAD")) }),
        ).toHaveCount(0);
        const refund = await page.request.post(
            `${bookingApi()}/v1/payments/${fixture.paymentId}/refund`,
            {
                headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
                data: { reason: "other", notify: false },
            },
        );
        expect(refund.status(), await refund.text()).toBe(409);
        expect(((await refund.json()) as { error: string }).error).toBe("package_used");
        expect(await entitlementEvidence(client.id)).toEqual(exhausted);
        await testInfo.attach("package-race", {
            body: JSON.stringify({ coverWon, exhausted, bookings: booked.bookings }),
            contentType: "application/json",
        });
    } finally {
        await second.close();
        await member.cleanup();
        await joining.close();
    }
});

test("FLOW-07-B an unused package refunded in full is voided on both devices and can no longer be used", async ({
    page,
    browser,
    baseURL,
}, testInfo) => {
    test.setTimeout(240_000);
    await signIn(page);
    const client = await createClient(page);
    const fixture = await packageFor(page, client);
    const second = await browser.newContext({
        baseURL: baseURL ?? "",
        viewport: { width: 1440, height: 900 },
    });
    try {
        const other = await second.newPage();
        await signIn(other);
        await openEntitlement(other, client.name, fixture.packageId);
        await expect(other.getByRole("dialog")).toContainText(w.statusLabel.active, {
            timeout: 60_000,
        });

        await openEntitlement(page, client.name, fixture.packageId);
        await page.getByRole("button", { name: w.action.refund, exact: true }).click();
        const panel = page.getByRole("complementary", { name: client.name, exact: true });
        await expect(panel.getByText(r.wholeOnly, { exact: true })).toBeVisible({
            timeout: 60_000,
        });
        await expect(panel.getByRole("button", { name: r.part, exact: true })).toBeDisabled();
        await panel.getByRole("switch", { name: r.notify, exact: true }).uncheck();
        const label = r.refundButton(formatMoney(6001, "CAD"));
        await panel.getByRole("button", { name: label, exact: true }).click();
        const confirm = page.getByRole("dialog", {
            name: r.confirmTitle(formatMoney(6001, "CAD")),
            exact: true,
        });
        const refunding = page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === `/v1/payments/${fixture.paymentId}/refund` &&
                response.request().method() === "POST",
        );
        await confirm.getByRole("button", { name: label, exact: true }).click();
        const refunded = await refunding;
        expect(refunded.status(), await refunded.text()).toBe(200);
        expect(await refunded.json()).toMatchObject({ status: "succeeded" });

        const after = await entitlementEvidence(client.id);
        expect(after.packages).toEqual([{ ...fixture.sold.packages[0], status: "void" }]);
        const deferred = after.entries.filter((entry) => entry.category === "deferred");
        expect(deferred.reduce((sum, entry) => sum + entry.amount_cents, 0)).toBe(0);
        expect(after.entries.filter((entry) => entry.event === "consumption")).toEqual([]);
        for (const journal of new Set(after.entries.map((entry) => entry.journal_id)))
            expect(
                after.entries
                    .filter((entry) => entry.journal_id === journal)
                    .reduce((sum, entry) => sum + entry.amount_cents, 0),
            ).toBe(0);

        for (const device of [other, page]) {
            await device.reload();
            await openEntitlement(device, client.name, fixture.packageId);
            await expect(device.getByRole("dialog")).toContainText(w.statusLabel.void, {
                timeout: 60_000,
            });
            await expect(
                device.getByRole("button", { name: w.action.use, exact: true }),
            ).toHaveCount(0);
            await expect(
                device.getByRole("button", { name: w.action.refund, exact: true }),
            ).toHaveCount(0);
        }
        const consumed = await page.request.post(
            `${bookingApi()}/v1/packages/${fixture.packageId}/consume`,
            { headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() } },
        );
        expect(consumed.status(), await consumed.text()).toBe(409);
        const again = await page.request.post(
            `${bookingApi()}/v1/payments/${fixture.paymentId}/refund`,
            {
                headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
                data: { reason: "other", notify: false },
            },
        );
        expect(again.status(), await again.text()).toBe(409);
        expect(await entitlementEvidence(client.id)).toEqual(after);
        await testInfo.attach("package-refund", {
            body: JSON.stringify(after),
            contentType: "application/json",
        });
    } finally {
        await second.close();
    }
});
