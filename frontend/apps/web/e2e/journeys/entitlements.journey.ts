import { randomUUID } from "node:crypto";
import {
    combineDayAndTime,
    dateKey,
    formatMoney,
    formatTime,
    strings,
    addDays,
} from "@clientbridge/app-core/public";
import { expect, test, type Page, type Request, type Route } from "@playwright/test";
import { bookingApi } from "../support/bookings";
import { createClient, type ClientFixture } from "../support/clients";
import {
    entitlementEvidence,
    expectEntitlementLedger,
    openEntitlement,
    sellEntitlement,
} from "../support/entitlements";
import { requireLocalMail } from "../support/evidence";
import { joinHoursStaff } from "../support/hours";
import { navigate, signIn } from "../support/session";
import {
    apiCall,
    visitEvidence,
    at,
    connectUrl,
    fillConnectDetails,
    onlineBooker,
    teamMember,
} from "../support/visit";
import {
    addClassClient,
    classEvidence,
    classFixture,
    classManageUrl,
    cleanupClass,
    expectClassState,
    expectWorkerSentSeatNotice,
    openClass,
} from "../support/classes";
import { openInvoice } from "../support/billing";
import { demoSlug, runEmail } from "@clientbridge/config/e2e/run";

const w = strings.entitlements;
const r = strings.refunds;
const zone = "America/Vancouver";

async function packageFor(page: Page, client: ClientFixture, coversItemId?: string) {
    requireLocalMail();
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

test("CLS-E2E-01 enrollment, full-class waitlist and cancellation auto-promotion persist", async ({
    page,
    browser,
}, testInfo) => {
    await signIn(page);
    // The API creates the class and its initial session; subsequent enrollment and cancellation use UI.
    const fixture = await classFixture(page);
    try {
        const first = { client: fixture.first, id: fixture.bookingId, status: "confirmed" };
        await expectClassState(fixture, [first]);
        const secondId = await addClassClient(page, fixture, fixture.second, "confirmed");
        const second = { client: fixture.second, id: secondId, status: "confirmed" };
        await expectClassState(fixture, [first, second]);
        const waitingId = await addClassClient(page, fixture, fixture.waiting, "waitlisted");
        const waiting = { client: fixture.waiting, id: waitingId, status: "waitlisted" };
        const full = await expectClassState(fixture, [first, second, waiting]);
        const panel = await openClass(page, fixture);
        const waitingRow = panel.getByRole("listitem").filter({ hasText: fixture.waiting.name });
        await waitingRow
            .getByRole("button", { name: strings.classes.promote, exact: true })
            .click();
        await expect(panel.getByText(strings.classes.promoteFull, { exact: true })).toBeVisible();
        expect(await classEvidence(fixture.itemId)).toEqual(full);
        const rejected = await page.request.patch(
            `${bookingApi()}/v1/classes/${fixture.slotId}/roster/${waitingId}`,
            {
                headers: { Origin: new URL(page.url()).origin },
                data: { action: "promote" },
            },
        );
        expect(rejected.status(), await rejected.text()).toBe(409);
        expect(await rejected.json()).toMatchObject({ error: "class_full" });
        expect(await classEvidence(fixture.itemId)).toEqual(full);
        const clientContext = await browser.newContext();
        try {
            const client = await clientContext.newPage();
            const manageUrl = await classManageUrl(fixture);
            const token = new URL(manageUrl).pathname.split("/").at(-1);
            await client.goto(manageUrl);
            await expect(
                client.getByText(strings.publicManage.title, { exact: true }),
            ).toBeVisible();
            await expect(client.getByText(fixture.itemName, { exact: true })).toBeVisible();
            await client
                .getByRole("button", { name: strings.publicManage.cancel, exact: true })
                .click();
            await client
                .getByRole("button", { name: strings.publicManage.keep, exact: true })
                .click();
            expect(await classEvidence(fixture.itemId)).toEqual(full);
            await client
                .getByRole("button", { name: strings.publicManage.cancel, exact: true })
                .click();
            const canceled = client.waitForResponse(
                (response) =>
                    new URL(response.url()).pathname === `/manage/${token}/cancel` &&
                    response.request().method() === "POST",
            );
            await client
                .getByRole("button", { name: strings.publicManage.cancelConfirm, exact: true })
                .click();
            const response = await canceled;
            expect(response.status(), await response.text()).toBe(200);
            expect(await response.json()).toEqual({ deposit: "none", refund_cents: 0 });
            await expect(
                client.getByRole("heading", {
                    name: strings.publicManage.canceledTitle,
                    exact: true,
                }),
            ).toBeVisible();
            const refreshed = client.waitForResponse(
                (response) =>
                    new URL(response.url()).pathname === `/manage/${token}` &&
                    response.request().method() === "GET",
            );
            await client.reload();
            const loaded = await refreshed;
            expect(loaded.status()).toBe(200);
            expect(await loaded.json()).toMatchObject({
                booking_id: fixture.bookingId,
                status: "canceled",
                can_cancel: false,
                can_move: false,
            });
            await expect(
                client.getByText(strings.publicManage.canceledTitle, { exact: true }),
            ).toBeVisible();
            await expect(
                client.getByRole("button", { name: strings.publicManage.cancel, exact: true }),
            ).toHaveCount(0);
        } finally {
            await clientContext.close();
        }
        const final = await expectClassState(fixture, [
            { ...first, status: "canceled" },
            second,
            { ...waiting, status: "confirmed" },
        ]);
        const observer = await browser.newContext({
            baseURL: new URL(page.url()).origin,
            viewport: { width: 1440, height: 900 },
        });
        try {
            const other = await observer.newPage();
            await signIn(other);
            for (const replica of [page, other]) {
                for (let pass = 0; pass < 2; pass++) {
                    if (pass === 1) await replica.reload();
                    const roster = await openClass(replica, fixture);
                    await expect(roster.getByRole("listitem")).toHaveCount(2);
                    await expect(
                        roster.getByRole("listitem").filter({ hasText: fixture.second.name }),
                    ).toBeVisible();
                    await expect(
                        roster.getByRole("listitem").filter({ hasText: fixture.waiting.name }),
                    ).toBeVisible();
                    await expect(
                        roster.getByRole("listitem").filter({ hasText: fixture.first.name }),
                    ).toHaveCount(0);
                    await expect(
                        roster.getByText(strings.classes.emptyWaitlist, { exact: true }),
                    ).toBeVisible();
                    await expect(
                        replica
                            .getByRole("navigation", { name: strings.classes.upcoming })
                            .getByRole("button")
                            .filter({ hasText: fixture.itemName }),
                    ).toContainText(strings.classes.full);
                }
            }
            expect(await classEvidence(fixture.itemId)).toEqual(final);
            await testInfo.attach("class-capacity-and-auto-promotion", {
                body: JSON.stringify({ fixture, full, final }),
                contentType: "application/json",
            });
        } finally {
            await observer.close();
        }
        const notice = await test.step("the background worker sends the seat notice", () =>
            expectWorkerSentSeatNotice(page, fixture, waitingId, fixture.waiting.email));
        await testInfo.attach("worker-sent-seat-notice", {
            body: JSON.stringify(notice),
            contentType: "application/json",
        });
    } finally {
        await cleanupClass(page, fixture);
    }
});

const b = strings.publicBooking;
const ZONE = "America/Vancouver";
const CEDAR = { email: runEmail("owner@cedarcoast.example"), password: "demo1234" };

interface ScheduledProgram {
    id: string;
    sessions: { slot_id: string; starts_at: string }[];
}

interface Program {
    starts_at: string;
    staff_id: string;
    days: { starts_at: string; ends_at: string }[];
    seats_left: number;
}

test("CLS-E2E-02 a client enrols in a three-day camp on Connect and every day, with one invoice for the whole camp", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(240_000);
    await signIn(page, CEDAR);
    const owner = await teamMember(page, runEmail("owner@cedarcoast.example"));
    const run = randomUUID().slice(0, 6).toUpperCase();
    const camp = await apiCall<{ id: string; name: string }>(
        page,
        "POST",
        "/v1/items",
        {
            kind: "class",
            name: `Puppy confidence camp ${run}`,
            duration_min: 60,
            price_cents: 12000,
            capacity: 2,
            session_count: 3,
            deposit_type: "none",
            online_bookable: true,
        },
        201,
    );
    // Monday to Wednesday at four, in the first week Rowan's afternoons are free
    const schedule = async (): Promise<ScheduledProgram> => {
        for (let week = 3; week < 9; week++) {
            const ahead = addDays(new Date(), week * 7, ZONE);
            const weekday = new Date(`${dateKey(ahead, ZONE)}T12:00:00Z`).getUTCDay();
            const monday = dateKey(addDays(ahead, -((weekday + 6) % 7), ZONE), ZONE);
            const response = await page.request.post(`${bookingApi()}/v1/programs`, {
                headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
                data: {
                    item_id: camp.id,
                    staff_id: owner.id,
                    starts_at: combineDayAndTime(monday, "16:00", ZONE).toISOString(),
                    byday: ["MO", "TU", "WE"],
                    count: 3,
                },
            });
            if (response.status() === 409) continue;
            expect(response.status(), await response.text()).toBe(201);
            return (await response.json()) as ScheduledProgram;
        }
        throw new Error("No free week for the camp");
    };
    const program = await schedule();
    const sessions = program.sessions.map((session) => at(session.starts_at));
    expect(sessions).toHaveLength(3);
    const context = await browser.newContext({
        extraHTTPHeaders: {
            "X-Forwarded-For": `2001:db8:${randomUUID().replaceAll("-", "").slice(0, 16).match(/.{4}/g)?.join(":")}::1`,
        },
    });
    const runs = async (): Promise<Program[]> => {
        const response = await context.request.get(
            `${bookingApi()}/book/${demoSlug("cedarcoast")}/programs`,
            {
                params: { item_id: camp.id, staff_id: "any" },
            },
        );
        expect(response.status(), await response.text()).toBe(200);
        return ((await response.json()) as { programs: Program[] }).programs;
    };
    try {
        const before = await runs();
        expect(before.map((p) => ({ ...p, starts_at: at(p.starts_at) }))).toEqual([
            {
                starts_at: sessions[0],
                staff_id: owner.id,
                days: expect.any(Array),
                seats_left: 2,
            },
        ]);
        expect(before[0]?.days.map((day) => at(day.starts_at))).toEqual(sessions);

        const client = await context.newPage();
        const listed = client.waitForResponse(
            (response) =>
                response.url().includes(`/book/${demoSlug("cedarcoast")}/programs?`) &&
                response.ok(),
        );
        await client.goto(connectUrl(demoSlug("cedarcoast")));
        await client
            .getByRole("button")
            .filter({ has: client.getByText(camp.name, { exact: true }) })
            .click();
        await listed;
        await expect(client.getByText(b.programNote, { exact: true })).toBeVisible();
        const cards = client.getByRole("group", { name: b.programPick, exact: true });
        await expect(cards.getByRole("button")).toHaveCount(1);
        await cards.getByRole("button").first().click();
        const booker = onlineBooker("Maple");
        await fillConnectDetails(client, booker, "pet");
        const posted = client.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === `/book/${demoSlug("cedarcoast")}` &&
                response.request().method() === "POST",
        );
        await client.getByRole("button", { name: b.confirm, exact: true }).click();
        const online = await posted;
        expect(online.status(), await online.text()).toBe(200);
        expect(online.request().postDataJSON()).toMatchObject({ item_id: camp.id });
        expect(at((online.request().postDataJSON() as { starts_at: string }).starts_at)).toBe(
            sessions[0],
        );
        const enrolled = (await online.json()) as {
            booking_id: string;
            booking_ids: string[];
            status: string;
            deposit_cents: number;
            deposit_client_secret: string | null;
        };
        expect(enrolled).toMatchObject({
            status: "confirmed",
            deposit_cents: 0,
            deposit_client_secret: null,
        });
        expect(enrolled.booking_ids).toHaveLength(3);
        await expect(client.getByRole("heading", { name: b.doneTitle, exact: true })).toBeVisible();

        const evidence = await visitEvidence([booker.email]);
        const slotIds = program.sessions.map((session) => session.slot_id);
        expect(evidence.bookings.map((booking) => booking.slot_id)).toEqual(slotIds);
        expect(new Set(evidence.bookings.map((booking) => booking.recurrence_id))).toEqual(
            new Set([program.id]),
        );
        expect(evidence.bookings.map((booking) => at(booking.starts_at))).toEqual(sessions);
        const invoiceId = evidence.bookings[0]?.invoice_id ?? null;
        expect(invoiceId).not.toBeNull();
        expect(
            evidence.bookings.map(
                ({
                    status,
                    source,
                    price_cents,
                    deposit_amount_cents,
                    deposit_status,
                    invoice_id,
                }) => ({
                    status,
                    source,
                    price_cents,
                    deposit_amount_cents,
                    deposit_status,
                    invoice_id,
                }),
            ),
        ).toEqual([
            {
                status: "confirmed",
                source: "online",
                price_cents: 12000,
                deposit_amount_cents: 0,
                deposit_status: "none",
                invoice_id: invoiceId,
            },
            ...[1, 2].map(() => ({
                status: "confirmed",
                source: "online",
                price_cents: 0,
                deposit_amount_cents: 0,
                deposit_status: "none",
                invoice_id: null,
            })),
        ]);
        expect(new Set(evidence.bookings.map((booking) => booking.subject_id)).size).toBe(1);
        expect(evidence.subjects.map((subject) => subject.name)).toEqual(["Maple"]);
        // one price for the camp, with 5% GST and 7% PST, due on its first day
        expect(evidence.invoices).toEqual([
            {
                id: invoiceId,
                client_id: evidence.clients[0]?.id,
                status: "sent",
                number: expect.any(Number),
                subtotal_cents: 12000,
                tax_total_cents: 1440,
                total_cents: 13440,
                due_at: expect.any(String),
            },
        ]);
        expect(at(evidence.invoices[0]?.due_at ?? "")).toBe(sessions[0]);
        expect(evidence.lines).toEqual([
            expect.objectContaining({
                invoice_id: invoiceId,
                description: `${camp.name} · 3 days`,
                quantity: 1,
                unit_amount_cents: 12000,
                amount_cents: 12000,
                item_id: camp.id,
                booking_id: evidence.bookings[0]?.id,
            }),
        ]);
        expect(evidence.payments).toEqual([]);
        const receivable = evidence.entries.filter((entry) => entry.category === "receivable");
        expect(receivable.reduce((sum, entry) => sum + entry.amount_cents, 0)).toBe(13440);
        expect(evidence.entries.reduce((sum, entry) => sum + entry.amount_cents, 0)).toBe(0);
        expect(evidence.entries.filter((entry) => entry.category === "cash")).toEqual([]);

        const after = await runs();
        expect(after.map((p) => p.seats_left)).toEqual([1]);
        const again = await context.request.post(`${bookingApi()}/book/${demoSlug("cedarcoast")}`, {
            headers: { "Idempotency-Key": randomUUID() },
            data: {
                item_id: camp.id,
                staff_id: "any",
                starts_at: program.sessions[0]?.starts_at,
                client: { name: booker.name, email: booker.email },
                subject_name: booker.subject,
            },
        });
        expect(again.status(), await again.text()).toBe(409);
        expect(((await again.json()) as { error: string }).error).toBe("already_enrolled");
        const midway = onlineBooker("Hazel");
        const second = await context.request.post(
            `${bookingApi()}/book/${demoSlug("cedarcoast")}`,
            {
                headers: { "Idempotency-Key": randomUUID() },
                data: {
                    item_id: camp.id,
                    staff_id: "any",
                    starts_at: program.sessions[1]?.starts_at,
                    client: { name: midway.name, email: midway.email },
                    subject_name: midway.subject,
                },
            },
        );
        expect(second.status(), await second.text()).toBe(409);
        expect(((await second.json()) as { error: string }).error).toBe("slot_unavailable");
        expect(await visitEvidence([midway.email])).toMatchObject({ clients: [], bookings: [] });
        expect(await visitEvidence([booker.email])).toEqual(evidence);

        const clientRow = evidence.clients[0];
        if (clientRow === undefined || invoiceId === null) throw new Error("Enrolment is missing");
        await openInvoice(page, { id: invoiceId, name: clientRow.name, email: clientRow.email });
        const drawer = page.getByRole("dialog");
        await expect(
            drawer.getByText(strings.billing.statusLabel.sent, { exact: true }).first(),
        ).toBeVisible();
        await expect(
            drawer.getByText(formatMoney(13440, "CAD"), { exact: true }).first(),
        ).toBeVisible();
        await expect(
            drawer
                .getByText(`${camp.name} · 3 days`, { exact: true })
                .filter({ visible: true })
                .first(),
        ).toBeVisible();
        await testInfo.attach("camp-enrolment", {
            body: JSON.stringify(evidence),
            contentType: "application/json",
        });
    } finally {
        await context.close();
    }
});
