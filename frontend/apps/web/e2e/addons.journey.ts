import { randomUUID } from "node:crypto";
import {
    addDays,
    combineDayAndTime,
    dateKey,
    durationLabel,
    formatMoney,
    formatParts,
    formatTime,
    strings,
} from "@clientbridge/app-core/public";
import { expect, test, type APIRequestContext } from "@playwright/test";

import { bookingApi, cancelOwnedBooking, openBooking } from "./support/bookings";
import { signIn } from "./support/session";
import {
    apiCall,
    at,
    connectUrl,
    fillConnectDetails,
    onlineBooker,
    openConnectDay,
    teamMember,
    visitEvidence,
    watchOpenings,
} from "./support/visits";
import { demoSlug, runEmail } from "@clientbridge/config/e2e/run";

const b = strings.publicBooking;
const MIN = 60_000;
const ZONE = "America/Vancouver";
const NORTHLIGHT = { email: runEmail("owner@northlight.example"), password: "demo1234" };

interface Slot {
    starts_at: string;
    ends_at: string;
}

async function slots(
    request: APIRequestContext,
    itemId: string,
    staffId: string,
    date: string,
    extra: number,
): Promise<Slot[]> {
    const response = await request.get(`${bookingApi()}/book/${demoSlug("northlight")}/slots`, {
        params: { item_id: itemId, staff_id: staffId, date, extra_min: extra },
    });
    expect(response.status(), await response.text()).toBe(200);
    return ((await response.json()) as { slots: Slot[] }).slots;
}

test("SCH-E2E-07 an add-on that lengthens the visit narrows the times Connect offers and stays on the booking and invoice", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(240_000);
    await signIn(page, NORTHLIGHT);
    const owner = await teamMember(page, runEmail("owner@northlight.example"));
    const run = randomUUID().slice(0, 6).toUpperCase();
    const service = await apiCall<{ id: string; name: string }>(
        page,
        "POST",
        "/v1/items",
        {
            kind: "service",
            name: `Camera health check ${run}`,
            duration_min: 60,
            price_cents: 13500,
            deposit_type: "none",
            online_bookable: true,
        },
        201,
    );
    const mount = await apiCall<{ id: string; name: string }>(
        page,
        "POST",
        "/v1/items",
        { kind: "product", name: `Extra camera mount ${run}`, price_cents: 8900, duration_min: 30 },
        201,
    );
    expect(
        await apiCall(
            page,
            "PATCH",
            "/v1/online-booking/addons",
            { offers: [{ id: mount.id, addon: true, addon_for: [service.id] }] },
            200,
        ),
    ).toEqual({ offers: [{ id: mount.id, addon: true, addon_for: [service.id] }] });
    const context = await browser.newContext({
        extraHTTPHeaders: {
            "X-Forwarded-For": `2001:db8:${randomUUID().replaceAll("-", "").slice(0, 16).match(/.{4}/g)?.join(":")}::1`,
        },
    });
    const owned: string[] = [];
    try {
        // a weekday with Erik's afternoon open, so the hour before closing fits only the plain visit
        let date = "";
        let last = new Date(0);
        for (let offset = 7; offset < 35 && date === ""; offset++) {
            const day = dateKey(addDays(new Date(), offset, ZONE), ZONE);
            const plain = await slots(context.request, service.id, owner.id, day, 0);
            const close = combineDayAndTime(day, "16:00", ZONE).getTime();
            if (plain.some((slot) => at(slot.starts_at) === close)) {
                date = day;
                last = new Date(close);
            }
        }
        expect(date).not.toBe("");
        const plain = await slots(context.request, service.id, owner.id, date, 0);
        for (const slot of plain) expect(at(slot.ends_at) - at(slot.starts_at)).toBe(60 * MIN);

        const client = await context.newPage();
        const days = watchOpenings(client, demoSlug("northlight"));
        await client.goto(connectUrl(demoSlug("northlight")));
        await client
            .getByRole("button")
            .filter({ has: client.getByText(service.name, { exact: true }) })
            .click();
        await expect(client.getByRole("heading", { name: b.stepExtras, level: 2 })).toBeVisible();
        await expect(
            client.getByText(b.addsTime(durationLabel(30)), { exact: false }),
        ).toBeVisible();
        const offered = client.getByRole("button", { name: b.addNamed(mount.name), exact: true });
        await expect(offered).toHaveAttribute("aria-pressed", "false");
        await offered.click();
        await expect(offered).toHaveAttribute("aria-pressed", "true");
        await client.getByRole("button", { name: b.continue, exact: true }).first().click();
        await client
            .getByRole("group", { name: b.with, exact: true })
            .locator(`button[data-value="${owner.id}"]`)
            .click();
        await expect
            .poll(() =>
                days.days.some(
                    (response) =>
                        new URL(response.url()).searchParams.get("extra_min") === "30" &&
                        new URL(response.url()).searchParams.get("staff_id") === owner.id,
                ),
            )
            .toBe(true);
        const longer = await openConnectDay(client, days, date);
        expect(longer).toEqual(await slots(context.request, service.id, owner.id, date, 30));
        expect(longer.length).toBeGreaterThan(0);
        for (const slot of longer) expect(at(slot.ends_at) - at(slot.starts_at)).toBe(90 * MIN);
        expect(longer.map((slot) => at(slot.starts_at))).not.toContain(last.getTime());
        const times = client.getByRole("radiogroup", { name: b.openTimes, exact: true });
        await expect(
            times.getByRole("radio", { name: formatTime(last, ZONE), exact: true }),
        ).toHaveCount(0);
        const chosen = longer[0];
        if (chosen === undefined) throw new Error("No longer visit fits that day");
        await times
            .getByRole("radio", { name: formatTime(new Date(chosen.starts_at), ZONE), exact: true })
            .click();
        const booker = onlineBooker("Garage cameras");
        await fillConnectDetails(client, booker, "site", "2860 Quadra Street, Victoria");
        await expect(
            client
                .getByText(formatMoney(22400, "CAD"), { exact: true })
                .filter({ visible: true })
                .first(),
        ).toBeVisible();
        const posted = client.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === `/book/${demoSlug("northlight")}` &&
                response.request().method() === "POST",
        );
        await client.getByRole("button", { name: b.confirm, exact: true }).click();
        const online = await posted;
        expect(online.status(), await online.text()).toBe(200);
        expect(online.request().postDataJSON()).toMatchObject({
            item_id: service.id,
            staff_id: owner.id,
            addons: [{ item_id: mount.id, quantity: 1 }],
        });
        const bookingId = ((await online.json()) as { booking_id: string }).booking_id;
        owned.push(bookingId);
        await expect(
            client.getByRole("heading", { name: b.pendingTitle, exact: true }),
        ).toBeVisible();

        const booked = await visitEvidence([booker.email]);
        expect(booked.bookings).toEqual([
            expect.objectContaining({
                id: bookingId,
                status: "pending",
                source: "online",
                item_id: service.id,
                staff_id: owner.id,
                price_cents: 13500,
                invoice_id: null,
            }),
        ]);
        const visit = booked.bookings[0];
        expect(at(visit?.starts_at ?? "")).toBe(at(chosen.starts_at));
        expect(at(visit?.ends_at ?? "") - at(visit?.starts_at ?? "")).toBe(90 * MIN);
        expect(booked.addons).toEqual([
            {
                booking_id: bookingId,
                item_id: mount.id,
                description: mount.name,
                quantity: 1,
                unit_amount_cents: 8900,
            },
        ]);

        const tooLate = onlineBooker("Shop cameras");
        const refused = await context.request.post(
            `${bookingApi()}/book/${demoSlug("northlight")}`,
            {
                headers: { "Idempotency-Key": randomUUID() },
                data: {
                    item_id: service.id,
                    staff_id: owner.id,
                    starts_at: last.toISOString(),
                    client: { name: tooLate.name, email: tooLate.email },
                    subject_name: tooLate.subject,
                    subject_address: "455 Granville Street, Vancouver",
                    addons: [{ item_id: mount.id, quantity: 1 }],
                },
            },
        );
        expect(refused.status(), await refused.text()).toBe(409);
        expect(((await refused.json()) as { error: string }).error).toBe("slot_unavailable");
        expect(await visitEvidence([tooLate.email])).toMatchObject({
            clients: [],
            bookings: [],
            addons: [],
        });

        const clientRow = booked.clients[0];
        if (clientRow === undefined) throw new Error("The online booker is missing");
        await openBooking(
            page,
            {
                clientId: clientRow.id,
                clientName: clientRow.name,
                clientEmail: clientRow.email,
                itemId: service.id,
                itemName: service.name,
                staffId: owner.id,
                staffName: owner.name,
                zone: ZONE,
            },
            bookingId,
            formatParts([booker.subject, clientRow.name]),
        );
        await expect(
            page.getByText(mount.name, { exact: false }).filter({ visible: true }).first(),
        ).toBeVisible();
        const invoicing = page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === `/v1/invoices/from-booking/${bookingId}` &&
                response.request().method() === "POST",
        );
        await page
            .getByRole("button", { name: strings.bookings.invoiceVisit, exact: true })
            .click();
        const invoiceResponse = await invoicing;
        expect(invoiceResponse.status(), await invoiceResponse.text()).toBe(201);
        // CAD135 visit plus the CAD89 mount, with 5% GST and 7% PST on each
        expect(await invoiceResponse.json()).toMatchObject({
            status: "draft",
            subtotal_cents: 22400,
            tax_total_cents: 2688,
            total_cents: 25088,
        });
        const invoiced = await visitEvidence([booker.email]);
        const invoiceId = invoiced.bookings[0]?.invoice_id;
        expect(invoiceId).toBeTruthy();
        expect(invoiced.lines).toEqual([
            expect.objectContaining({
                invoice_id: invoiceId,
                description: service.name,
                quantity: 1,
                unit_amount_cents: 13500,
                amount_cents: 13500,
                item_id: service.id,
                booking_id: bookingId,
            }),
            expect.objectContaining({
                invoice_id: invoiceId,
                description: mount.name,
                quantity: 1,
                unit_amount_cents: 8900,
                amount_cents: 8900,
                item_id: mount.id,
                booking_id: bookingId,
            }),
        ]);
        expect(invoiced.addons).toEqual(booked.addons);
        await testInfo.attach("addon-visit", {
            body: JSON.stringify(invoiced),
            contentType: "application/json",
        });
    } finally {
        for (const id of owned) await cancelOwnedBooking(page, id);
        await context.close();
    }
});
