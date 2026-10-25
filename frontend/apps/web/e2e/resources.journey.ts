import { randomUUID } from "node:crypto";
import {
    addDays,
    combineDayAndTime,
    dateKey,
    formatTime,
    strings,
} from "@clientbridge/app-core/public";
import { expect, test, type Page } from "@playwright/test";

import {
    bookingApi,
    cancelOwnedBooking,
    createBookingFixture,
    fillBookingComposer,
    pickBookingDay,
    pickBookingTime,
    type BookingFixture,
    type BookingRecord,
} from "./support/bookings";
import { createClient } from "./support/crm";
import { signIn } from "./support/session";
import {
    apiCall,
    at,
    fillConnectDetails,
    onlineBooker,
    openConnectDay,
    openConnectService,
    teamMember,
    visitEvidence,
} from "./support/visits";

const s = strings.bookings;
const MIN = 60_000;

async function composerChip(page: Page, staffId: string): Promise<void> {
    await page
        .getByRole("form", { name: s.composerTitle })
        .getByRole("group", { name: s.composerWith, exact: true })
        .locator(`button[data-value="${staffId}"]`)
        .click();
}

const hourAfter = (time: string): string =>
    `${String(Number(time.slice(0, 2)) + 1).padStart(2, "0")}:00`;

/** A day and time both groomers are free, with Diego free an hour later, so only the table decides. */
async function sharedFreeTime(
    page: Page,
    fixture: BookingFixture,
    otherId: string,
): Promise<{ day: Date; time: string }> {
    const submit = page.getByRole("button", { name: s.composerBook, exact: true });
    const free = async (day: Date, time: string, staffId: string): Promise<boolean> => {
        await pickBookingTime(page, day, time, fixture.zone);
        await composerChip(page, staffId);
        return submit.isEnabled();
    };
    for (let offset = 14; offset < 28; offset++) {
        const day = addDays(new Date(), offset, fixture.zone);
        // the groomers work Tuesday to Saturday, the only days Connect offers
        const weekday = new Date(`${dateKey(day, fixture.zone)}T12:00:00Z`).getUTCDay();
        if (weekday < 2) continue;
        await pickBookingDay(page, day, fixture.zone);
        for (const time of ["10:00", "11:00", "13:00", "14:00"]) {
            if (!(await free(day, time, fixture.staffId))) continue;
            if (!(await free(day, time, otherId))) continue;
            if (!(await free(day, hourAfter(time), otherId))) continue;
            if (await free(day, time, fixture.staffId)) return { day, time };
        }
    }
    throw new Error("No time found when both groomers are free");
}

async function book(page: Page): Promise<BookingRecord & { resource_id: string | null }> {
    const created = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === "/v1/bookings" &&
            response.request().method() === "POST",
    );
    await page.getByRole("button", { name: s.composerBook, exact: true }).click();
    const response = await created;
    expect(response.status(), await response.text()).toBe(201);
    const booking = (await response.json()) as BookingRecord & { resource_id: string | null };
    await expect(page.getByRole("form", { name: s.composerTitle })).toBeHidden();
    return booking;
}

test("SCH-E2E-05 a visit holds its shared table, so an overlapping visit is refused in the calendar and hidden on Connect", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(240_000);
    await signIn(page);
    const run = randomUUID().slice(0, 8);
    const table = await apiCall<{ id: string; name: string }>(
        page,
        "POST",
        "/v1/resources",
        { name: `Grooming table ${run}` },
        201,
    );
    const first = await createBookingFixture(page, {
        online_bookable: true,
        resource_ids: [table.id],
    });
    const control = await apiCall<{ id: string }>(
        page,
        "POST",
        "/v1/items",
        {
            kind: "service",
            name: `Nail tidy for ${first.clientName}`,
            duration_min: 30,
            price_cents: 1000,
            deposit_type: "none",
            online_bookable: true,
        },
        201,
    );
    const diego = await teamMember(page, "diego@birchbark.example");
    const second = await createClient(page);
    const booker = onlineBooker("Biscuit");
    const owned: string[] = [];
    const context = await browser.newContext({
        extraHTTPHeaders: {
            "X-Forwarded-For": `2001:db8:${randomUUID().replaceAll("-", "").slice(0, 16).match(/.{4}/g)?.join(":")}::1`,
        },
    });
    try {
        await fillBookingComposer(page, first);
        const { day, time } = await sharedFreeTime(page, first, diego.id);
        const held = await book(page);
        owned.push(held.id);
        const start = combineDayAndTime(day, time, first.zone);
        expect(held).toMatchObject({ staff_id: first.staffId, resource_id: table.id });
        expect(at(held.starts_at)).toBe(start.getTime());

        const other: BookingFixture = {
            ...first,
            clientId: second.id,
            clientName: second.name,
            clientEmail: second.email,
            staffId: diego.id,
            staffName: diego.name,
        };
        await fillBookingComposer(page, other);
        await pickBookingDay(page, day, first.zone);
        await pickBookingTime(page, day, time, first.zone);
        const form = page.getByRole("form", { name: s.composerTitle });
        await expect(form.getByText(s.problemResource, { exact: true })).toBeVisible({
            timeout: 60_000,
        });
        await expect(
            form.getByRole("button", { name: s.composerBook, exact: true }),
        ).toBeDisabled();
        const later = new Date(start.getTime() + 60 * MIN);
        await pickBookingTime(page, day, hourAfter(time), first.zone);
        await expect(form.getByText(s.problemResource, { exact: true })).toHaveCount(0);
        const moved = await book(page);
        owned.push(moved.id);
        expect(moved).toMatchObject({ staff_id: diego.id, resource_id: table.id });
        expect(at(moved.starts_at)).toBe(later.getTime());

        const window = (from: Date) => ({
            starts_at: from.getTime(),
            ends_at: from.getTime() + 30 * MIN,
        });
        const holds = async () =>
            ((await visitEvidence([first.clientId], table.id)).holds ?? []).map((h) => ({
                staff_id: h.staff_id,
                item_id: h.item_id,
                status: h.status,
                starts_at: at(h.starts_at),
                ends_at: at(h.ends_at),
            }));
        const staffHolds = [
            {
                staff_id: first.staffId,
                item_id: first.itemId,
                status: "scheduled",
                ...window(start),
            },
            { staff_id: diego.id, item_id: first.itemId, status: "scheduled", ...window(later) },
        ];
        expect(await holds()).toEqual(staffHolds);
        const refused = await page.request.post(`${bookingApi()}/v1/bookings`, {
            headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
            data: {
                client_id: second.id,
                item_id: first.itemId,
                staff_id: diego.id,
                starts_at: start.toISOString(),
                notify: false,
            },
        });
        expect(refused.status(), await refused.text()).toBe(409);
        expect(((await refused.json()) as { error: string }).error).toBe("no_resource");
        expect(await holds()).toEqual(staffHolds);
        expect((await visitEvidence([second.id])).bookings.map((booking) => booking.id)).toEqual([
            moved.id,
        ]);

        const date = dateKey(start, first.zone);
        const controlSlots = await context.request.get(`${bookingApi()}/book/birchbark/slots`, {
            params: { item_id: control.id, staff_id: "any", date },
        });
        expect(controlSlots.status()).toBe(200);
        // without the table the same time is open with Diego, so only the table hides it
        expect(
            ((await controlSlots.json()) as { slots: { starts_at: string }[] }).slots.map((x) =>
                at(x.starts_at),
            ),
        ).toContain(start.getTime());
        const client = await context.newPage();
        const days = await openConnectService(client, "birchbark", first.itemName);
        await client
            .getByRole("group", { name: strings.publicBooking.with, exact: true })
            .getByRole("button", { name: strings.publicBooking.anyone, exact: true })
            .click();
        const offered = await openConnectDay(client, days, date);
        expect(offered.length).toBeGreaterThan(0);
        for (const slot of offered) {
            const from = at(slot.starts_at);
            const to = at(slot.ends_at);
            for (const hold of staffHolds)
                expect(from < hold.ends_at && to > hold.starts_at, slot.starts_at).toBe(false);
        }
        const times = client.getByRole("radiogroup", {
            name: strings.publicBooking.openTimes,
            exact: true,
        });
        await expect(times.getByRole("radio").first()).toBeVisible();
        await expect(
            times.getByRole("radio", { name: formatTime(start, first.zone), exact: true }),
        ).toHaveCount(0);
        const chosen = offered[0];
        if (chosen === undefined) throw new Error("No open time on Connect");
        await times.getByRole("radio").first().click();
        await fillConnectDetails(client, booker, "pet");
        const posted = client.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === "/book/birchbark" &&
                response.request().method() === "POST",
        );
        await client
            .getByRole("button", { name: strings.publicBooking.confirm, exact: true })
            .click();
        const online = await posted;
        expect(online.status(), await online.text()).toBe(200);
        const onlineId = ((await online.json()) as { booking_id: string }).booking_id;
        owned.push(onlineId);
        await expect(
            client.getByRole("heading", { name: strings.publicBooking.pendingTitle, exact: true }),
        ).toBeVisible();
        const booked = await visitEvidence([booker.email]);
        expect(booked.bookings).toEqual([
            expect.objectContaining({
                id: onlineId,
                status: "pending",
                source: "online",
                item_id: first.itemId,
                resource_id: table.id,
            }),
        ]);
        expect(at(booked.bookings[0]?.starts_at ?? "")).toBe(at(chosen.starts_at));
        expect((await holds()).length).toBe(3);

        const latecomer = onlineBooker("Juniper");
        const taken = await context.request.post(`${bookingApi()}/book/birchbark`, {
            headers: { "Idempotency-Key": randomUUID() },
            data: {
                item_id: first.itemId,
                staff_id: "any",
                starts_at: start.toISOString(),
                client: { name: latecomer.name, email: latecomer.email },
                subject_name: latecomer.subject,
            },
        });
        expect(taken.status(), await taken.text()).toBe(409);
        expect(((await taken.json()) as { error: string }).error).toBe("slot_unavailable");
        expect(await visitEvidence([latecomer.email])).toMatchObject({
            clients: [],
            subjects: [],
            bookings: [],
            payments: [],
        });
        expect((await holds()).length).toBe(3);
        await testInfo.attach("table-holds", {
            body: JSON.stringify(
                await visitEvidence([first.clientId, second.id, booker.email], table.id),
            ),
            contentType: "application/json",
        });
    } finally {
        for (const id of owned) await cancelOwnedBooking(page, id);
        await context.close();
    }
});
