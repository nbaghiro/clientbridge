import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
    formatParts,
    strings,
    addDays,
    combineDayAndTime,
    dateKey,
    formatTime,
    durationLabel,
    formatMoney,
} from "@clientbridge/app-core/public";
import {
    expect,
    test,
    type Response,
    type Route,
    type Page,
    type APIRequestContext,
} from "@playwright/test";
import {
    cancelOwnedBooking,
    bookingApi,
    createBookingFixture,
    fillBookingComposer,
    pickBookingDay,
    pickBookingTime,
    type BookingFixture,
    type BookingRecord,
    openBooking,
} from "../support/bookings";
import {
    acceptedRaceEvidence,
    raceContact,
    raceDetails,
    raceEvidence,
    raceFixture,
    raceTimePicker,
    apiCall,
    at,
    fillConnectDetails,
    onlineBooker,
    openConnectDay,
    openConnectService,
    teamMember,
    visitEvidence,
    choiceKeys,
    connectStaff,
    connectUrl,
    watchOpenings,
    manageUrl,
    moveFromManageLink,
} from "../support/visit";
import { textInbox, textsTo } from "../support/auth";
import { customerContext, navigate, signIn } from "../support/session";
import { demoId, demoSlug, runUrl, runEmail } from "@clientbridge/config/e2e/run";
import { createClient } from "../support/clients";
import { select } from "../support/db";
import { joinHoursStaff } from "../support/hours";
import { messageEvidence } from "../support/messaging";

// how the text acknowledging a booking request begins (booking_requested.body_link)
const ACKNOWLEDGMENT = "Request sent for ";

test("SCH-E2E-03 two real clients race for one time without loser side effects", async ({
    page,
    browser,
}, testInfo) => {
    await signIn(page);
    const fixture = await raceFixture(page);
    const contacts = [raceContact("Maple"), raceContact("Clover")];
    const contexts = await Promise.all(
        contacts.map(() =>
            browser.newContext({
                extraHTTPHeaders: {
                    "X-Forwarded-For": `2001:db8:${randomUUID().replaceAll("-", "").slice(0, 16).match(/.{4}/g)?.join(":")}::1`,
                },
            }),
        ),
    );
    let release: (proceed: boolean) => void = () => undefined;
    const barrier = new Promise<boolean>((resolve) => {
        release = resolve;
    });
    const attempts: {
        index: number;
        body: { item_id: string; staff_id: string; starts_at: string; client: { phone: string } };
        key: string | undefined;
    }[] = [];
    const pendingResponses: Promise<Response>[] = [];
    const refreshedSlots: Response[][] = contacts.map(() => []);
    try {
        expect(await raceEvidence(fixture, contacts)).toEqual({
            slots: [],
            bookings: [],
            clients: [],
            subjects: [],
            payments: [],
            deliveries: [],
        });
        for (const contact of contacts)
            expect(await textsTo(page.request, contact.phone)).toEqual([]);
        const clients = await Promise.all(contexts.map((context) => context.newPage()));
        const dayIndexes = await Promise.all(
            clients.map((client) => raceTimePicker(client, fixture)),
        );
        expect(new Set(dayIndexes).size).toBe(1);
        await Promise.all(
            clients.map(async (client, index) => {
                await client
                    .getByRole("radiogroup", { name: strings.publicBooking.date, exact: true })
                    .getByRole("radio")
                    .nth(dayIndexes[index] ?? -1)
                    .click();
                await client
                    .getByRole("radiogroup", { name: strings.publicBooking.openTimes, exact: true })
                    .getByRole("radio")
                    .first()
                    .click();
                const contact = contacts[index];
                if (!contact) throw new Error("Race contact is missing");
                await raceDetails(client, contact);
                await client.route(`**/book/${demoSlug("birchbark")}`, async (route: Route) => {
                    if (route.request().method() !== "POST") return route.continue();
                    attempts.push({
                        index,
                        body: route.request().postDataJSON() as (typeof attempts)[number]["body"],
                        key: route.request().headers()["idempotency-key"],
                    });
                    if (await barrier) await route.continue();
                    else await route.abort("aborted");
                });
            }),
        );
        clients.forEach((client, index) => {
            client.on("response", (response) => {
                if (
                    response.url().includes(`/book/${demoSlug("birchbark")}/slots?`) &&
                    response.ok()
                )
                    refreshedSlots[index]?.push(response);
            });
        });
        const responses = clients.map((client) =>
            client.waitForResponse(
                (response) =>
                    new URL(response.url()).pathname === `/book/${demoSlug("birchbark")}` &&
                    response.request().method() === "POST",
            ),
        );
        pendingResponses.push(...responses);
        await Promise.all(
            clients.map((client) =>
                client
                    .getByRole("button", { name: strings.publicBooking.confirm, exact: true })
                    .click(),
            ),
        );
        await expect.poll(() => attempts.length).toBe(2);
        expect(new Set(attempts.map((attempt) => attempt.body.starts_at)).size).toBe(1);
        expect(new Set(attempts.map((attempt) => attempt.key)).size).toBe(2);
        for (const attempt of attempts) {
            expect(attempt.key).toBeTruthy();
            expect(attempt.body).toMatchObject({
                item_id: fixture.itemId,
                staff_id: fixture.staffId,
                client: { phone: contacts[attempt.index]?.phone },
            });
        }
        release(true);
        const completed = await Promise.all(responses);
        expect(completed.map((response) => response.status()).sort()).toEqual([200, 409]);
        const winnerIndex = completed.findIndex((response) => response.status() === 200);
        const loserIndex = 1 - winnerIndex;
        const winner = contacts[winnerIndex];
        const winnerPage = clients[winnerIndex];
        const loser = clients[loserIndex];
        const winnerResponse = completed[winnerIndex];
        const loserResponse = completed[loserIndex];
        if (!winner || !winnerPage || !loser || !winnerResponse || !loserResponse)
            throw new Error("Race results are incomplete");
        const won = (await winnerResponse.json()) as { booking_id: string; status: string };
        expect(won).toMatchObject({
            status: "pending",
            deposit_cents: 0,
            deposit_client_secret: null,
        });
        expect(["conflict", "slot_unavailable"]).toContain(
            ((await loserResponse.json()) as { error: string }).error,
        );
        await expect(
            winnerPage.getByRole("heading", {
                name: strings.publicBooking.pendingTitle,
                exact: true,
            }),
        ).toBeVisible();
        await expect(
            loser.getByText(strings.publicBooking.slotTaken, { exact: true }),
        ).toBeVisible();
        await expect(
            loser.getByRole("heading", { name: strings.publicBooking.stepTime, exact: true }),
        ).toBeVisible();
        await expect(
            loser
                .getByRole("radiogroup", { name: strings.publicBooking.openTimes })
                .getByRole("radio", { checked: true }),
        ).toHaveCount(0);
        await expect.poll(() => refreshedSlots[loserIndex]?.length ?? 0).toBeGreaterThan(0);
        const refreshed = refreshedSlots[loserIndex]?.at(-1);
        if (!refreshed) throw new Error("Loser did not refresh real availability");
        const refreshedBody = (await refreshed.json()) as { slots: { starts_at: string }[] };
        expect(
            refreshedBody.slots.some(
                (slot) =>
                    new Date(slot.starts_at).getTime() ===
                    new Date(attempts[0]?.body.starts_at ?? "").getTime(),
            ),
        ).toBe(false);
        const committed = await acceptedRaceEvidence(fixture, contacts, winner.phone);
        expect(committed.slots).toHaveLength(1);
        const slot = committed.slots[0];
        expect(slot).toMatchObject({
            item_id: fixture.itemId,
            staff_id: fixture.staffId,
            capacity: 1,
        });
        expect(new Date(slot?.starts_at ?? "").getTime()).toBe(
            new Date(attempts[0]?.body.starts_at ?? "").getTime(),
        );
        expect(committed.clients).toEqual([
            { id: expect.any(String), name: winner.name, phone: winner.phone },
        ]);
        expect(committed.subjects).toEqual([
            { id: expect.any(String), client_id: committed.clients[0]?.id, name: winner.pet },
        ]);
        expect(committed.bookings).toEqual([
            {
                id: won.booking_id,
                slot_id: slot?.id,
                client_id: committed.clients[0]?.id,
                subject_id: committed.subjects[0]?.id,
                status: "pending",
                source: "online",
                deposit_status: "none",
                deposit_amount_cents: 0,
            },
        ]);
        expect(committed.payments).toEqual([]);
        expect(committed.deliveries).toEqual([
            { id: expect.any(String), state: "accepted", recipient: winner.phone },
        ]);
        // the intake form cron may also text the new client while this runs
        const acknowledgments = async () =>
            (await textsTo(page.request, winner.phone)).filter(({ Snippet }) =>
                Snippet.startsWith(ACKNOWLEDGMENT),
            );
        await expect.poll(async () => (await acknowledgments()).length).toBe(1);
        const winnerText = await acknowledgments();
        const message = await page.request.get(
            `${runUrl("MAILPIT_URL")}/api/v1/message/${winnerText[0]?.ID}`,
        );
        expect(message.status()).toBe(200);
        expect(
            ((await message.json()) as { To: { Address: string }[] }).To.map((to) => to.Address),
        ).toEqual([textInbox(winner.phone)]);
        const losingContact = contacts[loserIndex];
        if (!losingContact) throw new Error("Losing contact is missing");
        expect(await textsTo(page.request, losingContact.phone)).toEqual([]);
        const observer = await browser.newContext({ baseURL: new URL(page.url()).origin });
        try {
            const other = await observer.newPage();
            await signIn(other);
            for (const provider of [page, other]) {
                for (let pass = 0; pass < 2; pass++) {
                    if (pass === 1) await provider.reload();
                    await navigate(provider, `/schedule?open=${won.booking_id}`);
                    await expect(
                        provider.getByRole("heading", {
                            name: formatParts([winner.pet, winner.name]),
                            exact: true,
                        }),
                    ).toBeVisible({ timeout: 60_000 });
                    await expect(
                        provider.getByText(fixture.itemName, { exact: true }).first(),
                    ).toBeVisible();
                }
            }
            expect(await raceEvidence(fixture, contacts)).toEqual(committed);
            expect((await acknowledgments()).map(({ ID }) => ID)).toEqual(
                winnerText.map(({ ID }) => ID),
            );
            expect(await textsTo(page.request, losingContact.phone)).toEqual([]);
            await testInfo.attach("real-last-slot-race", {
                body: JSON.stringify({
                    attempts,
                    statuses: completed.map((response) => response.status()),
                    committed,
                }),
                contentType: "application/json",
            });
        } finally {
            await observer.close();
        }
    } finally {
        release(false);
        await Promise.allSettled(pendingResponses);
        try {
            const owned = await raceEvidence(fixture, contacts);
            for (const booking of owned.bookings)
                if (booking.status !== "canceled") await cancelOwnedBooking(page, booking.id);
        } finally {
            await Promise.all(contexts.map((context) => context.close()));
        }
    }
});

test("SCH-E2E-04 lost committed booking response retries once without another acknowledgment", async ({
    page,
    browser,
}, testInfo) => {
    await signIn(page);
    const fixture = await raceFixture(page);
    const contact = raceContact("Juniper");
    const clientContext = await browser.newContext({
        extraHTTPHeaders: {
            "X-Forwarded-For": `2001:db8:${randomUUID().replaceAll("-", "").slice(0, 16).match(/.{4}/g)?.join(":")}::1`,
        },
    });
    try {
        expect(await raceEvidence(fixture, [contact])).toEqual({
            slots: [],
            bookings: [],
            clients: [],
            subjects: [],
            payments: [],
            deliveries: [],
        });
        expect(await textsTo(page.request, contact.phone)).toEqual([]);
        const client = await clientContext.newPage();
        const day = await raceTimePicker(client, fixture, 4);
        await client
            .getByRole("radiogroup", { name: strings.publicBooking.date, exact: true })
            .getByRole("radio")
            .nth(day)
            .click();
        await client
            .getByRole("radiogroup", { name: strings.publicBooking.openTimes, exact: true })
            .getByRole("radio")
            .first()
            .click();
        await raceDetails(client, contact);
        const attempts: {
            body: string | null;
            key: string | undefined;
            response: { booking_id: string; status: string };
        }[] = [];
        await client.route(`**/book/${demoSlug("birchbark")}`, async (route) => {
            if (route.request().method() !== "POST") return route.continue();
            const response = await route.fetch();
            expect(response.status(), await response.text()).toBe(200);
            attempts.push({
                body: route.request().postData(),
                key: route.request().headers()["idempotency-key"],
                response: (await response.json()) as { booking_id: string; status: string },
            });
            if (attempts.length === 1) await route.abort("connectionreset");
            else await route.fulfill({ response });
        });
        const confirm = client.getByRole("button", {
            name: strings.publicBooking.confirm,
            exact: true,
        });
        await confirm.click();
        await expect(
            client.getByText(strings.publicBooking.connectionError, { exact: true }),
        ).toBeVisible();
        await expect(
            client.getByRole("heading", { name: strings.publicBooking.stepDetails, exact: true }),
        ).toBeVisible();
        const initial = await acceptedRaceEvidence(fixture, [contact], contact.phone);
        expect(initial.bookings).toHaveLength(1);
        // the intake form cron may also text the new client while this runs
        const acknowledgments = async () =>
            (await textsTo(page.request, contact.phone)).filter(({ Snippet }) =>
                Snippet.startsWith(ACKNOWLEDGMENT),
            );
        await expect.poll(async () => (await acknowledgments()).length).toBe(1);
        const firstText = await acknowledgments();
        await confirm.click();
        await expect(
            client.getByRole("heading", { name: strings.publicBooking.pendingTitle, exact: true }),
        ).toBeVisible();
        expect(attempts).toHaveLength(2);
        expect(attempts[0]?.key).toBeTruthy();
        expect(attempts[1]).toEqual(attempts[0]);
        expect(attempts[0]?.response).toMatchObject({
            status: "pending",
            deposit_cents: 0,
            deposit_client_secret: null,
        });
        const committed = await raceEvidence(fixture, [contact]);
        expect(committed).toEqual(initial);
        expect(committed.slots).toHaveLength(1);
        const slot = committed.slots[0];
        expect(slot).toMatchObject({
            item_id: fixture.itemId,
            staff_id: fixture.staffId,
            capacity: 1,
        });
        expect(committed.clients).toEqual([
            { id: expect.any(String), name: contact.name, phone: contact.phone },
        ]);
        expect(committed.subjects).toEqual([
            { id: expect.any(String), name: contact.pet, client_id: committed.clients[0]?.id },
        ]);
        expect(committed.bookings).toEqual([
            {
                id: attempts[0]?.response.booking_id,
                slot_id: slot?.id,
                client_id: committed.clients[0]?.id,
                subject_id: committed.subjects[0]?.id,
                status: "pending",
                source: "online",
                deposit_status: "none",
                deposit_amount_cents: 0,
            },
        ]);
        expect(committed.payments).toEqual([]);
        expect(committed.deliveries).toEqual([
            { id: expect.any(String), state: "accepted", recipient: contact.phone },
        ]);
        const observer = await browser.newContext({ baseURL: new URL(page.url()).origin });
        try {
            const other = await observer.newPage();
            await signIn(other);
            for (const provider of [page, other]) {
                await navigate(provider, `/schedule?open=${attempts[0]?.response.booking_id}`);
                await expect(
                    provider.getByRole("heading", {
                        name: formatParts([contact.pet, contact.name]),
                        exact: true,
                    }),
                ).toBeVisible({ timeout: 60_000 });
                await provider.reload();
                await navigate(provider, `/schedule?open=${attempts[0]?.response.booking_id}`);
                await expect(
                    provider.getByRole("heading", {
                        name: formatParts([contact.pet, contact.name]),
                        exact: true,
                    }),
                ).toBeVisible();
            }
            const finalText = await acknowledgments();
            await testInfo.attach("booking-retry-acknowledgment", {
                body: JSON.stringify({ attempts, committed, firstText, finalText }),
                contentType: "application/json",
            });
            expect(finalText.map(({ ID }) => ID)).toEqual(firstText.map(({ ID }) => ID));
            expect(finalText).toHaveLength(1);
            expect(await raceEvidence(fixture, [contact])).toEqual(committed);
        } finally {
            await observer.close();
        }
    } finally {
        try {
            const evidence = await raceEvidence(fixture, [contact]);
            for (const booking of evidence.bookings)
                if (booking.status !== "canceled") await cancelOwnedBooking(page, booking.id);
        } finally {
            await clientContext.close();
        }
    }
});

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
    const diego = await teamMember(page, runEmail("diego@birchbark.example"));
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
            clientPhone: second.phone,
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
        const controlSlots = await context.request.get(
            `${bookingApi()}/book/${demoSlug("birchbark")}/slots`,
            {
                params: { item_id: control.id, staff_id: "any", date },
            },
        );
        expect(controlSlots.status()).toBe(200);
        // without the table the same time is open with Diego, so only the table hides it
        expect(
            ((await controlSlots.json()) as { slots: { starts_at: string }[] }).slots.map((x) =>
                at(x.starts_at),
            ),
        ).toContain(start.getTime());
        const client = await context.newPage();
        const days = await openConnectService(client, demoSlug("birchbark"), first.itemName);
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
                new URL(response.url()).pathname === `/book/${demoSlug("birchbark")}` &&
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
        const booked = await visitEvidence([booker.phone]);
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
        const taken = await context.request.post(`${bookingApi()}/book/${demoSlug("birchbark")}`, {
            headers: { "Idempotency-Key": randomUUID() },
            data: {
                item_id: first.itemId,
                staff_id: "any",
                starts_at: start.toISOString(),
                client: { name: latecomer.name, phone: latecomer.phone },
                subject_name: latecomer.subject,
            },
        });
        expect(taken.status(), await taken.text()).toBe(409);
        expect(((await taken.json()) as { error: string }).error).toBe("slot_unavailable");
        expect(await visitEvidence([latecomer.phone])).toMatchObject({
            clients: [],
            subjects: [],
            bookings: [],
            payments: [],
        });
        expect((await holds()).length).toBe(3);
        await testInfo.attach("table-holds", {
            body: JSON.stringify(
                await visitEvidence([first.clientId, second.id, booker.phone], table.id),
            ),
            contentType: "application/json",
        });
    } finally {
        for (const id of owned) await cancelOwnedBooking(page, id);
        await context.close();
    }
});

/** A day and time every member is free for the service, read from the calendar's own checks. */
async function freeForAll(
    page: Page,
    fixture: BookingFixture,
    staffIds: string[],
): Promise<{ day: Date; time: string }> {
    const submit = page.getByRole("button", { name: s.composerBook, exact: true });
    for (let offset = 14; offset < 28; offset++) {
        const day = addDays(new Date(), offset, fixture.zone);
        const weekday = new Date(`${dateKey(day, fixture.zone)}T12:00:00Z`).getUTCDay();
        if (weekday < 2) continue;
        await pickBookingDay(page, day, fixture.zone);
        for (const time of ["10:00", "11:00", "13:00", "14:00"]) {
            await pickBookingTime(page, day, time, fixture.zone);
            let free = true;
            for (const staffId of staffIds) {
                await composerChip(page, staffId);
                if (!(await submit.isEnabled())) {
                    free = false;
                    break;
                }
            }
            if (free) return { day, time };
        }
    }
    throw new Error("No time found when every member is free");
}

test("SCH-E2E-23 a service with a pool of two rooms books both at one time, then refuses a third visit in the calendar and hides it on Connect", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(240_000);
    await signIn(page);
    const run = randomUUID().slice(0, 8);
    const rooms: { id: string; name: string }[] = [];
    await navigate(page, "/setup/rooms-and-equipment");
    for (const name of [`Tub A ${run}`, `Tub B ${run}`]) {
        await page.getByRole("button", { name: strings.resources.add }).first().click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("textbox", { name: strings.resources.name, exact: true }).fill(name);
        const added = page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === "/v1/resources" &&
                response.request().method() === "POST",
        );
        await dialog.getByRole("button", { name: strings.resources.save, exact: true }).click();
        const response = await added;
        expect(response.status(), await response.text()).toBe(201);
        rooms.push((await response.json()) as { id: string; name: string });
        await expect(dialog).toBeHidden();
    }
    const pool = rooms.map((room) => room.id).sort();
    const first = await createBookingFixture(page, { online_bookable: true });
    await page.goto("/setup/services");
    await page.locator(`button[data-row-key="${first.itemId}"]`).click({ timeout: 60_000 });
    const editor = page.getByRole("dialog");
    const needs = editor.getByRole("group", { name: strings.catalog.needs, exact: true });
    for (const room of rooms) await needs.locator(`button[data-value="${room.id}"]`).click();
    const pooled = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === `/v1/items/${first.itemId}` &&
            response.request().method() === "PATCH",
    );
    await editor.getByRole("button", { name: strings.catalog.save, exact: true }).click();
    const pooledResponse = await pooled;
    expect(pooledResponse.status(), await pooledResponse.text()).toBe(200);
    expect(((await pooledResponse.json()) as { resource_ids: string[] }).resource_ids).toEqual(
        pool,
    );
    await navigate(page, "/setup/rooms-and-equipment");
    for (const room of rooms)
        await expect(page.locator(`[data-row-key="${room.id}"]`)).toContainText(first.itemName, {
            timeout: 60_000,
        });
    const diego = await teamMember(page, runEmail("diego@birchbark.example"));
    const priya = await teamMember(page, runEmail("priya@birchbark.example"));
    const clients = [await createClient(page), await createClient(page)];
    const owned: string[] = [];
    const context = await customerContext(browser);
    try {
        await fillBookingComposer(page, first);
        const { day, time } = await freeForAll(page, first, [first.staffId, diego.id, priya.id]);
        const start = combineDayAndTime(day, time, first.zone);
        await composerChip(page, first.staffId);
        const held = [await book(page)];
        owned.push(held[0]?.id ?? "");
        const asDiego: BookingFixture = {
            ...first,
            clientId: clients[0]?.id ?? "",
            clientName: clients[0]?.name ?? "",
            staffId: diego.id,
            staffName: diego.name,
        };
        await fillBookingComposer(page, asDiego);
        await pickBookingDay(page, day, first.zone);
        await pickBookingTime(page, day, time, first.zone);
        held.push(await book(page));
        owned.push(held[1]?.id ?? "");
        expect(held.map((visit) => at(visit.starts_at))).toEqual([
            start.getTime(),
            start.getTime(),
        ]);
        expect(held.map((visit) => visit.resource_id).sort()).toEqual(pool);

        const asPriya: BookingFixture = {
            ...asDiego,
            clientId: clients[1]?.id ?? "",
            clientName: clients[1]?.name ?? "",
            staffId: priya.id,
            staffName: priya.name,
        };
        await fillBookingComposer(page, asPriya);
        await pickBookingDay(page, day, first.zone);
        await pickBookingTime(page, day, time, first.zone);
        const form = page.getByRole("form", { name: s.composerTitle });
        await expect(form.getByText(s.problemResource, { exact: true })).toBeVisible({
            timeout: 60_000,
        });
        await expect(
            form.getByRole("button", { name: s.composerBook, exact: true }),
        ).toBeDisabled();
        await page.getByRole("button", { name: s.composerCancel, exact: true }).click();
        const refused = await page.request.post(`${bookingApi()}/v1/bookings`, {
            headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
            data: {
                client_id: asPriya.clientId,
                item_id: first.itemId,
                staff_id: priya.id,
                starts_at: start.toISOString(),
                notify: false,
            },
        });
        expect(refused.status(), await refused.text()).toBe(409);
        expect(((await refused.json()) as { error: string }).error).toBe("no_resource");
        expect((await visitEvidence([asPriya.clientId])).bookings).toEqual([]);

        const date = dateKey(start, first.zone);
        const offered: Record<string, number[]> = {};
        for (const staffId of [priya.id, "any"]) {
            const slots = await context.request.get(
                `${bookingApi()}/book/${demoSlug("birchbark")}/slots`,
                { params: { item_id: first.itemId, staff_id: staffId, date } },
            );
            expect(slots.status(), await slots.text()).toBe(200);
            offered[staffId] = (
                (await slots.json()) as { slots: { starts_at: string }[] }
            ).slots.map((x) => at(x.starts_at));
            expect(offered[staffId]).not.toContain(start.getTime());
        }
        // Priya was free at the start before the rooms filled, so only the rooms hide it
        expect(offered[priya.id]?.length).toBeGreaterThan(0);
        const client = await context.newPage();
        const days = await openConnectService(client, demoSlug("birchbark"), first.itemName);
        // choosing Priya reloads the strip on her first open day, so the date is picked after that
        const priyaDays = client.waitForResponse(
            (response) =>
                response.url().includes(`/book/${demoSlug("birchbark")}/days?`) &&
                new URL(response.url()).searchParams.get("staff_id") === priya.id,
        );
        await client
            .getByRole("group", { name: strings.publicBooking.with, exact: true })
            .locator(`button[data-value="${priya.id}"]`)
            .click();
        await priyaDays;
        const shown = await openConnectDay(client, days, date);
        expect(shown.map((x) => at(x.starts_at))).not.toContain(start.getTime());
        const times = client.getByRole("radiogroup", {
            name: strings.publicBooking.openTimes,
            exact: true,
        });
        await expect(times.getByRole("radio").first()).toBeVisible();
        await expect(
            times.getByRole("radio", { name: formatTime(start, first.zone), exact: true }),
        ).toHaveCount(0);
        await testInfo.attach("pool-holds", {
            body: JSON.stringify({ pool, held, offered }),
            contentType: "application/json",
        });
    } finally {
        for (const id of owned) if (id !== "") await cancelOwnedBooking(page, id);
        await context.close();
    }
});

const b = strings.publicBooking;

async function composerStaff(page: Page, fixture: BookingFixture): Promise<string[]> {
    await fillBookingComposer(page, fixture);
    const keys = await choiceKeys(
        page
            .getByRole("form", { name: strings.bookings.composerTitle })
            .getByRole("group", { name: strings.bookings.composerWith, exact: true }),
    );
    await page.getByRole("button", { name: strings.bookings.composerCancel, exact: true }).click();
    return keys;
}

async function connectChoices(page: Page, itemName: string): Promise<string[]> {
    await openConnectService(page, demoSlug("birchbark"), itemName);
    return choiceKeys(page.getByRole("group", { name: b.with, exact: true }));
}

test("SCH-E2E-06 only the staff chosen for a service are offered on Connect and in the calendar, and a removed member stops being offered", async ({
    page,
    browser,
    request,
    baseURL,
}, testInfo) => {
    test.setTimeout(300_000);
    const joining = await browser.newContext({ baseURL: baseURL ?? "" });
    const member = await joinHoursStaff(await joining.newPage(), request);
    let removed = false;
    const anonymous = await browser.newContext({
        extraHTTPHeaders: {
            "X-Forwarded-For": `2001:db8:${randomUUID().replaceAll("-", "").slice(0, 16).match(/.{4}/g)?.join(":")}::1`,
        },
    });
    const owned: string[] = [];
    try {
        await signIn(page);
        const fixture = await createBookingFixture(page, { online_bookable: true });
        const diego = await teamMember(page, runEmail("diego@birchbark.example"));
        const everyone = (await connectStaff(page, demoSlug("birchbark"), fixture.itemId)) ?? [];
        expect(everyone).toEqual(expect.arrayContaining([fixture.staffId, diego.id, member.id]));

        await page.goto("/setup/services");
        await page.locator(`button[data-row-key="${fixture.itemId}"]`).click({ timeout: 60_000 });
        const editor = page.getByRole("dialog");
        const offeredBy = editor.getByRole("group", {
            name: strings.catalog.offeredBy,
            exact: true,
        });
        await expect(offeredBy.locator('button[data-value="all"]')).toHaveAttribute(
            "aria-pressed",
            "true",
            { timeout: 60_000 },
        );
        await offeredBy.locator(`button[data-value="${diego.id}"]`).click();
        await offeredBy.locator(`button[data-value="${member.id}"]`).click();
        await expect(offeredBy.locator('button[data-value="all"]')).toHaveAttribute(
            "aria-pressed",
            "false",
        );
        const saved = page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === `/v1/items/${fixture.itemId}` &&
                response.request().method() === "PATCH",
        );
        await editor.getByRole("button", { name: strings.catalog.save, exact: true }).click();
        const savedResponse = await saved;
        expect(savedResponse.status(), await savedResponse.text()).toBe(200);
        expect(((await savedResponse.json()) as { staff_ids: string[] }).staff_ids).toEqual(
            [diego.id, member.id].sort(),
        );

        const asDiego = { ...fixture, staffId: diego.id, staffName: diego.name };
        await expect
            .poll(() => composerStaff(page, asDiego), { timeout: 60_000 })
            .toEqual([diego.id, member.id].sort());
        expect(await connectStaff(page, demoSlug("birchbark"), fixture.itemId)).toEqual(
            [diego.id, member.id].sort(),
        );
        expect(await connectChoices(await anonymous.newPage(), fixture.itemName)).toEqual(
            ["any", diego.id, member.id].sort(),
        );

        const date = dateKey(addDays(new Date(), 14, fixture.zone), fixture.zone);
        const unoffered = await anonymous.request.get(
            `${bookingApi()}/book/${demoSlug("birchbark")}/slots`,
            {
                params: { item_id: fixture.itemId, staff_id: fixture.staffId, date },
            },
        );
        expect(unoffered.status(), await unoffered.text()).toBe(422);
        expect(((await unoffered.json()) as { error: string }).error).toBe("service_not_offered");
        const outsider = onlineBooker("Clover");
        const refused = await anonymous.request.post(
            `${bookingApi()}/book/${demoSlug("birchbark")}`,
            {
                headers: { "Idempotency-Key": randomUUID() },
                data: {
                    item_id: fixture.itemId,
                    staff_id: fixture.staffId,
                    starts_at: new Date(`${date}T18:00:00Z`).toISOString(),
                    client: { name: outsider.name, phone: outsider.phone },
                    subject_name: outsider.subject,
                },
            },
        );
        expect(refused.status(), await refused.text()).toBe(422);
        expect(((await refused.json()) as { error: string }).error).toBe("service_not_offered");
        expect(await visitEvidence([outsider.phone])).toMatchObject({ clients: [], bookings: [] });

        const removal = await page.request.post(`${bookingApi()}/v1/staff/${member.id}/remove`, {
            headers: { Origin: new URL(page.url()).origin },
            data: {},
        });
        expect(removal.status(), await removal.text()).toBe(200);
        removed = true;
        expect(await connectStaff(page, demoSlug("birchbark"), fixture.itemId)).toEqual([diego.id]);
        expect(await connectChoices(await anonymous.newPage(), fixture.itemName)).toEqual(
            ["any", diego.id].sort(),
        );
        await page.reload();
        await expect
            .poll(() => composerStaff(page, asDiego), { timeout: 60_000 })
            .toEqual([diego.id]);

        const client = await anonymous.newPage();
        const days = await openConnectService(client, demoSlug("birchbark"), fixture.itemName);
        await client
            .getByRole("group", { name: b.with, exact: true })
            .getByRole("button", { name: b.anyone, exact: true })
            .click();
        await expect.poll(() => days.days.length).toBeGreaterThan(0);
        const firstWeek = (
            (await days.days.at(-1)?.json()) as { days: { date: string; count: number }[] }
        ).days;
        const open = firstWeek.find((day) => day.count > 0);
        if (open === undefined) throw new Error("No open day for Diego this week");
        const slots = await openConnectDay(client, days, open.date);
        expect(new Set(slots.map((slot) => slot.staff_id))).toEqual(new Set([diego.id]));
        await client
            .getByRole("radiogroup", { name: b.openTimes, exact: true })
            .getByRole("radio")
            .first()
            .click();
        const booker = onlineBooker("Pepper");
        await fillConnectDetails(client, booker, "pet");
        const posted = client.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === `/book/${demoSlug("birchbark")}` &&
                response.request().method() === "POST",
        );
        await client.getByRole("button", { name: b.confirm, exact: true }).click();
        const online = await posted;
        expect(online.status(), await online.text()).toBe(200);
        const onlineId = ((await online.json()) as { booking_id: string }).booking_id;
        owned.push(onlineId);
        await expect(
            client.getByRole("heading", { name: b.pendingTitle, exact: true }),
        ).toBeVisible();
        const booked = await visitEvidence([booker.phone]);
        expect(booked.bookings).toEqual([
            expect.objectContaining({
                id: onlineId,
                staff_id: diego.id,
                item_id: fixture.itemId,
                status: "pending",
                source: "online",
            }),
        ]);
        await testInfo.attach("offered-staff", {
            body: JSON.stringify({ diego: diego.id, removed: member.id, booked }),
            contentType: "application/json",
        });
    } finally {
        for (const id of owned) await cancelOwnedBooking(page, id);
        if (!removed) await member.cleanup();
        await anonymous.close();
        await joining.close();
    }
});

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

        const booked = await visitEvidence([booker.phone]);
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
                    client: { name: tooLate.name, phone: tooLate.phone },
                    subject_name: tooLate.subject,
                    subject_address: "455 Granville Street, Vancouver",
                    addons: [{ item_id: mount.id, quantity: 1 }],
                },
            },
        );
        expect(refused.status(), await refused.text()).toBe(409);
        expect(((await refused.json()) as { error: string }).error).toBe("slot_unavailable");
        expect(await visitEvidence([tooLate.phone])).toMatchObject({
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
                clientPhone: clientRow.phone,
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
        // the draft opens over the visit, and the visit links back to it once closed
        const draft = page.getByRole("dialog").filter({
            has: page.getByRole("heading", { name: strings.billing.draftInvoice, exact: true }),
        });
        await expect(draft).toBeVisible();
        await draft.getByRole("button", { name: strings.common.close, exact: true }).click();
        await expect(draft).toBeHidden();
        await page.getByRole("button", { name: strings.bookings.openInvoice, exact: true }).click();
        await expect(draft).toBeVisible();
        await draft.getByRole("button", { name: strings.common.close, exact: true }).click();
        const invoiced = await visitEvidence([booker.phone]);
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

test("SCH-E2E-18 the owner approves one new client's request from Today and declines another on the schedule, and each client hears once", async ({
    page,
    browser,
}) => {
    const b = strings.publicBooking;
    const s = strings.bookings;
    await signIn(page);
    const fixture = await raceFixture(page);
    const approved = raceContact("Hazel");
    const declined = raceContact("Moss");
    const ids: Record<string, string> = {};
    for (const [contact, weeks] of [
        [approved, 4],
        [declined, 5],
    ] as const) {
        const context = await customerContext(browser);
        const client = await context.newPage();
        const day = await raceTimePicker(client, fixture, weeks);
        await client
            .getByRole("radiogroup", { name: b.date, exact: true })
            .getByRole("radio")
            .nth(day)
            .click();
        await client
            .getByRole("radiogroup", { name: b.openTimes, exact: true })
            .getByRole("radio")
            .first()
            .click();
        await raceDetails(client, contact);
        const booked = client.waitForResponse(
            (response) =>
                response.request().method() === "POST" &&
                new URL(response.url()).pathname.endsWith(`/book/${demoSlug("birchbark")}`),
        );
        await client.getByRole("button", { name: b.confirm, exact: true }).click();
        ids[contact.phone] = ((await (await booked).json()) as { booking_id: string }).booking_id;
        await expect(
            client.getByRole("heading", { name: b.pendingTitle, exact: true }),
        ).toBeVisible();
        await context.close();
    }
    const requested = await raceEvidence(fixture, [approved, declined]);
    expect(requested.bookings.map((x) => x.status)).toEqual(["pending", "pending"]);

    await navigate(page, "/today");
    const request = page.getByRole("button", {
        name: new RegExp(`${approved.name} asked for ${fixture.itemName}`),
    });
    await expect(request).toBeVisible({ timeout: 60_000 });
    await request.click();
    await expect(page.getByText(s.statusLabel("pending")).first()).toBeVisible();
    await page.getByRole("button", { name: s.approve, exact: true }).click();
    await expect(page.getByRole("button", { name: s.markNoShow, exact: true })).toBeVisible({
        timeout: 60_000,
    });

    await navigate(page, `/schedule?open=${ids[declined.phone] ?? ""}`);
    await page.getByRole("button", { name: s.decline, exact: true }).click();
    await expect(page.getByText(s.declineNotify, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: s.confirmDecline, exact: true }).click();
    await expect(page.getByText(s.declinedDone, { exact: true }).first()).toBeVisible({
        timeout: 60_000,
    });

    const answered = await raceEvidence(fixture, [approved, declined]);
    const status = (phone: string): string | undefined =>
        answered.bookings.find((x) => x.id === ids[phone])?.status;
    expect([status(approved.phone), status(declined.phone)]).toEqual(["confirmed", "canceled"]);
    const said = async (phone: string, start: string): Promise<number> =>
        (await textsTo(page.request, phone)).filter(({ Snippet }) => Snippet.startsWith(start))
            .length;
    await expect.poll(() => said(approved.phone, "You're booked for")).toBe(1);
    await expect.poll(() => said(declined.phone, "Your request with Birchbark Pet Studio")).toBe(1);
    expect(await said(declined.phone, "You're booked for")).toBe(0);
    const freed = answered.slots.filter((slot) =>
        answered.bookings.some((x) => x.id === ids[declined.phone] && x.slot_id === slot.id),
    );
    expect(freed).toHaveLength(1);
    expect(
        await select<{ status: string }>`SELECT status FROM slots WHERE id = ${freed[0]?.id ?? ""}`,
    ).toEqual([{ status: "canceled" }]);
});

test("SCH-E2E-19 the lead time, horizon and start step set in Setup bound the times Connect offers", async ({
    page,
    browser,
}) => {
    const b = strings.publicBooking;
    const o = strings.onlineBooking;
    await signIn(page);
    const policy = await page.request.get(`${bookingApi()}/v1/online-booking`);
    expect(policy.status()).toBe(200);
    const before = ((await policy.json()) as { policy: Record<string, unknown> }).policy;
    try {
        await navigate(page, "/setup/online-booking");
        for (const [label, option] of [
            [o.leadTime, o.leadOptions["48"]],
            [o.advance, o.advanceOptions["14"]],
            [o.step, o.stepOptions["60"]],
        ] as const) {
            await page.getByRole("combobox", { name: label, exact: true }).click();
            await page.getByRole("option", { name: option, exact: true }).click();
        }
        await page.getByRole("button", { name: o.save, exact: true }).click();
        await expect(page.getByText(o.saved, { exact: true }).first()).toBeVisible();
        const savedAt = Date.now();

        const context = await customerContext(browser);
        const client = await context.newPage();
        const openings = await openConnectService(client, demoSlug("birchbark"), "Bath & Tidy");
        await expect.poll(() => openings.days.length).toBeGreaterThan(0);
        const firstWeek = (
            (await openings.days[0]?.json()) as {
                days: { date: string; count: number }[];
            }
        ).days;
        const firstOpen = firstWeek.find((day) => day.count > 0);
        if (firstOpen === undefined) throw new Error("no day in the first week is open");
        const times = await openConnectDay(client, openings, firstOpen.date);
        expect(times.length).toBeGreaterThan(0);
        for (const time of times) {
            expect(at(time.starts_at)).toBeGreaterThanOrEqual(savedAt + 48 * 3_600_000 - 60_000);
            expect(new Date(time.starts_at).getUTCMinutes()).toBe(0);
        }
        const lastDay = new Date(savedAt + 15 * 86_400_000).toISOString().slice(0, 10);
        for (let week = 0; week < 3; week++) {
            const count = openings.days.length;
            const next = client.getByRole("button", { name: b.nextWeek, exact: true }).first();
            if (await next.isDisabled()) break;
            await next.click();
            await expect.poll(() => openings.days.length).toBeGreaterThan(count);
        }
        const offered = await Promise.all(
            openings.days.map(
                async (response) =>
                    ((await response.json()) as { days: { date: string; count: number }[] }).days,
            ),
        );
        const beyond = offered.flat().filter((day) => day.date > lastDay);
        expect(beyond.every((day) => day.count === 0)).toBe(true);
        await context.close();
    } finally {
        // a null step in the patch means "unchanged", so the service-length default goes back as 0
        await apiCall(
            page,
            "PATCH",
            "/v1/online-booking",
            { policy: { ...before, step_min: before.step_min ?? 0 } },
            200,
        );
    }
});

test("SCH-E2E-21 a client moves a visit from its manage link until the limit while the owner sees each new time, a cancel inside the cut-off is refused with its reason, and one outside it frees the time", async ({
    page,
    browser,
}) => {
    const b = strings.publicBooking;
    const m = strings.publicManage;
    const s = strings.bookings;
    await signIn(page);
    const fixture = await raceFixture(page);
    const contact = raceContact("Juniper");
    const context = await customerContext(browser);
    const client = await context.newPage();
    const day = await raceTimePicker(client, fixture, 0);
    await client
        .getByRole("radiogroup", { name: b.date, exact: true })
        .getByRole("radio")
        .nth(day)
        .click();
    await client
        .getByRole("radiogroup", { name: b.openTimes, exact: true })
        .getByRole("radio")
        .first()
        .click();
    await raceDetails(client, contact);
    const posted = client.waitForResponse(
        (response) =>
            response.request().method() === "POST" &&
            new URL(response.url()).pathname.endsWith(`/book/${demoSlug("birchbark")}`),
    );
    await client.getByRole("button", { name: b.confirm, exact: true }).click();
    const booked = (await (await posted).json()) as { booking_id: string; manage_token: string };
    await expect(client.getByRole("heading", { name: b.pendingTitle, exact: true })).toBeVisible();
    const texts = async (): Promise<string[]> =>
        (
            await select<{ body: string }>`
                SELECT payload->'message'->>'body' AS body FROM deliveries
                WHERE payload->>'channel' = 'sms' AND payload->'message'->>'to' = ${contact.phone}
                ORDER BY id`
        ).map((row) => row.body);
    const link = manageUrl(booked.manage_token);
    await expect
        .poll(async () => (await texts()).filter((t) => t.startsWith(ACKNOWLEDGMENT)))
        .toEqual([expect.stringContaining(`/m/${booked.manage_token}`)]);

    await client.getByRole("button", { name: b.manage, exact: true }).click();
    await expect(client).toHaveURL(link);
    await expect(client.getByText(m.requestLabel, { exact: true })).toBeVisible();
    await expect(client.getByText(m.movesLeft(2), { exact: true })).toBeVisible();
    // phones for the visit's member (the owner, a manager) and a staff member it isn't theirs
    const phones = { owner: `e2e-owner-${randomUUID()}`, diego: `e2e-diego-${randomUUID()}` };
    const staff = await browser.newContext({ baseURL: new URL(page.url()).origin });
    const diego = await staff.newPage();
    await signIn(diego, { email: runEmail("diego@birchbark.example"), password: "demo1234" });
    const devices = [
        { owner: page, token: phones.owner },
        { owner: diego, token: phones.diego },
    ];
    for (const device of devices)
        await apiCall(
            device.owner,
            "POST",
            "/v1/devices/register",
            { token: device.token, platform: "ios" },
            200,
        );
    const first = await moveFromManageLink(client, booked.manage_token);
    await expect(client.getByText(m.movesLeft(1), { exact: true })).toBeVisible();
    const slotOf = async (): Promise<{ id: string; starts_at: string; status: string }> => {
        const [row] = await select<{ id: string; starts_at: string; status: string }>`
            SELECT s.id, s.starts_at::text, s.status FROM slots s
            JOIN bookings b ON b.slot_id = s.id WHERE b.id = ${booked.booking_id}`;
        if (row === undefined) throw new Error("the booked visit has no slot");
        return row;
    };
    expect(at((await slotOf()).starts_at)).toBe(at(first));
    await navigate(page, `/schedule?open=${booked.booking_id}`);
    await expect(page.getByText(s.historyMovedOnline(1), { exact: true })).toBeVisible({
        timeout: 60_000,
    });

    const second = await moveFromManageLink(client, booked.manage_token);
    expect(at((await slotOf()).starts_at)).toBe(at(second));
    await expect(client.getByText(m.blocked.reschedule_limit, { exact: true })).toBeVisible();
    await expect(client.getByRole("button", { name: m.reschedule, exact: true })).toBeDisabled();
    const third = await client.request.post(
        `${bookingApi()}/manage/${booked.manage_token}/reschedule`,
        { data: { starts_at: first }, headers: { "Idempotency-Key": randomUUID() } },
    );
    expect(third.status()).toBe(409);
    expect(await third.json()).toMatchObject({ error: "change_blocked" });
    await navigate(page, `/schedule?open=${booked.booking_id}`);
    await expect(page.getByText(s.historyMovedOnline(2), { exact: true })).toBeVisible({
        timeout: 60_000,
    });
    // the bell's feed is read once per page load
    await page.reload();
    await page.locator("aside").getByRole("button", { name: strings.notifications.title }).click();
    const bell = page.getByRole("dialog", { name: strings.notifications.title });
    await expect(
        bell
            .getByRole("button")
            .filter({ hasText: strings.notifications.kinds.bookingMoved })
            .filter({ hasText: contact.name }),
    ).toHaveCount(1, { timeout: 60_000 });
    await page.keyboard.press("Escape");
    const pushes = async (): Promise<string[][]> =>
        (
            await select<{ tokens: string[]; body: string }>`
                SELECT payload->'message'->'tokens' AS tokens, payload->'message'->>'body' AS body
                FROM deliveries WHERE payload->>'channel' = 'push'
                    AND payload->'message'->'data'->>'booking_id' = ${booked.booking_id}
                ORDER BY id`
        )
            .filter((push) => push.body.startsWith(`Visit moved by ${contact.name}: `))
            .map((push) =>
                push.tokens.filter((token) => token === phones.owner || token === phones.diego),
            );
    await expect.poll(pushes).toEqual([[phones.owner], [phones.owner]]);
    for (const device of devices)
        await apiCall(device.owner, "POST", "/v1/devices/unregister", { token: device.token }, 200);
    await staff.close();
    await expect
        .poll(async () => (await texts()).filter((t) => t.startsWith("Your visit moved to ")))
        .toEqual([
            expect.stringContaining(`/m/${booked.manage_token}`),
            expect.stringContaining(`/m/${booked.manage_token}`),
        ]);

    // widened with the dialog open; other journeys' link cancels are classes 14+ days out
    const hours = Math.ceil((at(second) - Date.now()) / 3_600_000) + 1;
    expect(hours).toBeLessThanOrEqual(168);
    const policy = await page.request.get(`${bookingApi()}/v1/online-booking`);
    expect(policy.status()).toBe(200);
    const before = ((await policy.json()) as { policy: Record<string, unknown> }).policy;
    const restore = { policy: { ...before, step_min: before.step_min ?? 0 } };
    try {
        await client.getByRole("button", { name: m.cancel, exact: true }).click();
        await apiCall(
            page,
            "PATCH",
            "/v1/online-booking",
            { policy: { ...restore.policy, cancel_cutoff_hours: hours } },
            200,
        );
        await client.getByRole("button", { name: m.cancelConfirm, exact: true }).click();
        await expect(
            client.getByRole("dialog").getByText(m.blocked.cutoff(hours), { exact: true }),
        ).toBeVisible();
        await client.getByRole("button", { name: m.keep, exact: true }).click();
        await expect(client.getByRole("button", { name: m.cancel, exact: true })).toBeDisabled();
        // the refusal's alert stays beside the reason the reloaded visit gives
        await expect(client.getByText(m.blocked.cutoff(hours), { exact: true })).toHaveCount(2);
        await client.reload();
        await expect(client.getByText(m.blocked.cutoff(hours), { exact: true })).toBeVisible();
        const refused = await client.request.post(
            `${bookingApi()}/manage/${booked.manage_token}/cancel`,
            { data: {}, headers: { "Idempotency-Key": randomUUID() } },
        );
        expect(refused.status()).toBe(409);
        expect(await refused.json()).toMatchObject({ error: "change_blocked" });
        expect(
            await select<{ status: string }>`
                SELECT status FROM bookings WHERE id = ${booked.booking_id}`,
        ).toEqual([{ status: "pending" }]);
    } finally {
        await apiCall(page, "PATCH", "/v1/online-booking", restore, 200);
    }

    await client.reload();
    await client.getByRole("button", { name: m.cancel, exact: true }).click();
    await client.getByRole("button", { name: m.cancelConfirm, exact: true }).click();
    await expect(
        client.getByRole("heading", { name: m.canceledTitle, exact: true }).first(),
    ).toBeVisible();
    await expect(client.getByText(m.canceledNoDeposit, { exact: true })).toBeVisible();
    const freed = await slotOf();
    expect(freed.status).toBe("canceled");
    const reopened = await client.request.get(
        `${bookingApi()}/book/${demoSlug("birchbark")}/slots`,
        {
            params: {
                date: dateKey(new Date(second), "America/Vancouver"),
                item_id: fixture.itemId,
                staff_id: fixture.staffId,
            },
        },
    );
    expect(reopened.status()).toBe(200);
    const open = ((await reopened.json()) as { slots: { starts_at: string }[] }).slots;
    expect(open.map((slot) => at(slot.starts_at))).toContain(at(second));
    await context.close();
});

test("SCH-E2E-22 the owner shares a photo of a past visit, the client opens it and the visit's receipt from the manage link, and the client's message lands in their Inbox thread", async ({
    page,
    browser,
}) => {
    const m = strings.publicManage;
    const s = strings.bookings;
    await signIn(page);
    const candidates = await select<{ id: string; token: string; client_id: string; name: string }>`
        SELECT b.id, b.manage_token AS token, c.id AS client_id, c.name FROM bookings b
        JOIN clients c ON c.id = b.client_id
        WHERE b.business_id = ${demoId("bz_birchbark")} AND b.status = 'completed'
            AND b.manage_token IS NOT NULL AND b.invoice_id IS NOT NULL AND b.deleted_at IS NULL
        ORDER BY b.id LIMIT 20`;
    let visit: (typeof candidates)[number] | undefined;
    for (const candidate of candidates) {
        const view = await page.request.get(`${bookingApi()}/manage/${candidate.token}`);
        if (((await view.json()) as { has_receipt?: boolean }).has_receipt === true) {
            visit = candidate;
            break;
        }
    }
    if (visit === undefined) throw new Error("no past visit with a receipt and a manage link");

    await navigate(page, `/schedule?open=${visit.id}`);
    const photo = await readFile(
        new URL("../../../../../backend/scripts/demo_assets/it_groom_lg.jpg", import.meta.url),
    );
    const completed = page.waitForResponse(
        (response) =>
            /^\/v1\/files\/[^/]+\/complete$/.test(new URL(response.url()).pathname) &&
            response.request().method() === "POST",
    );
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: s.photoAdd, exact: true }).click({ timeout: 60_000 });
    await (await chooser).setFiles({ name: "After.jpg", mimeType: "image/jpeg", buffer: photo });
    const uploaded = await completed;
    expect(uploaded.status(), await uploaded.text()).toBe(200);
    const fileId = ((await uploaded.json()) as { id: string }).id;
    await page.getByRole("button", { name: s.photoShare, exact: true }).last().click();
    await expect
        .poll(
            async () =>
                await select<{ shared: boolean }>`
                    SELECT shared_at IS NOT NULL AS shared FROM files WHERE id = ${fileId}`,
        )
        .toEqual([{ shared: true }]);

    const context = await customerContext(browser);
    const client = await context.newPage();
    await client.goto(manageUrl(visit.token));
    await expect(client.getByText(m.pastLabel, { exact: true })).toBeVisible();
    const shared = client.locator(`a[href*="/photos/${fileId}"] img`);
    await expect(shared).toBeVisible();
    await expect
        .poll(() =>
            shared.evaluate(
                (element: HTMLImageElement) => element.complete && element.naturalWidth > 0,
            ),
        )
        .toBe(true);
    await client.getByRole("button", { name: m.receipt, exact: true }).click();
    await expect(client.getByRole("dialog").getByText(visit.name).first()).toBeVisible();
    await client.keyboard.press("Escape");

    const body = `Thanks for the photo ${randomUUID().slice(0, 8)}`;
    await client.getByRole("textbox", { name: m.messageLabel, exact: true }).fill(body);
    await client.getByRole("button", { name: m.messageSend, exact: true }).click();
    await expect(client.getByText(m.messageSent, { exact: true })).toBeVisible();
    await context.close();
    await expect
        .poll(async () =>
            (await messageEvidence(visit.client_id)).messages
                .filter((message) => message.body === body)
                .map((message) => message.direction),
        )
        .toEqual(["in"]);
    await navigate(page, "/inbox");
    await page.getByRole("searchbox").fill(visit.name);
    await page
        .getByRole("button")
        .filter({ has: page.getByText(visit.name, { exact: true }) })
        .first()
        .click({ timeout: 60_000 });
    // the thread list's preview comes first, then the message in the open thread
    await expect(page.getByText(body, { exact: true }).last()).toBeVisible({ timeout: 60_000 });
});
