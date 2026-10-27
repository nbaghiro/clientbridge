import { randomUUID } from "node:crypto";
import { demoPerson } from "@clientbridge/config/e2e/demo";
import { addDays, combineDayAndTime, strings } from "@clientbridge/app-core/public";
import { expect, type Page } from "@playwright/test";
import { bookingApi, cancelOwnedBooking, type BookingFixture } from "./bookings";
import { createClient, type ClientFixture } from "./clients";
import { select } from "./db";
import { requireLocalMail } from "./evidence";
import { navigate } from "./session";
import { runEmail } from "@clientbridge/config/e2e/run";
import { textsTo } from "./auth";

export interface ClassEvidence {
    slots: { id: string; item_id: string; staff_id: string; capacity: number; status: string }[];
    bookings: {
        id: string;
        slot_id: string;
        client_id: string;
        status: string;
        deposit_status: string;
        deposit_amount_cents: number;
    }[];
}
export interface ClassFixture extends BookingFixture {
    first: ClientFixture;
    second: ClientFixture;
    waiting: ClientFixture;
    slotId: string;
    bookingId: string;
}
export async function classEvidence(itemId: string): Promise<ClassEvidence> {
    return {
        slots: await select<ClassEvidence["slots"][number]>`
            SELECT id, item_id, staff_id, capacity, status FROM slots
            WHERE item_id = ${itemId} ORDER BY id`,
        bookings: await select<ClassEvidence["bookings"][number]>`
            SELECT b.id, b.slot_id, b.client_id, b.status, b.deposit_status,
                b.deposit_amount_cents
            FROM bookings b JOIN slots s ON s.id = b.slot_id
            WHERE s.item_id = ${itemId} AND b.deleted_at IS NULL ORDER BY b.id`,
    };
}
export async function classFixture(page: Page): Promise<ClassFixture> {
    requireLocalMail();
    const api = bookingApi();
    const run = randomUUID();
    const names = new Set<string>();
    for (let attempt = 0; names.size < 3 && attempt < 32; attempt++) {
        names.add(demoPerson(`${run}:${String(attempt)}`));
    }
    const [firstName, secondName, waitingName] = [...names];
    if (!firstName || !secondName || !waitingName)
        throw new Error("Could not prepare three distinct natural client names");
    const first = await createClient(page, firstName);
    const second = await createClient(page, secondName);
    const waiting = await createClient(page, waitingName);
    expect(new Set([first.name, second.name, waiting.name]).size).toBe(3);
    const response = await page.request.get(`${api}/v1/staff/team`);
    expect(response.status()).toBe(200);
    const team = (await response.json()) as {
        members: { id: string; name: string; email: string }[];
    };
    const staff = team.members.find((row) => row.email === runEmail("hannah@birchbark.example"));
    if (!staff) throw new Error("The Birch & Bark owner fixture is missing");
    const headers = { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() };
    const itemName = `Puppy care for ${first.name}`;
    const item = await page.request.post(`${api}/v1/items`, {
        headers,
        data: {
            kind: "class",
            name: itemName,
            duration_min: 30,
            capacity: 2,
            price_cents: 2500,
            deposit_type: "none",
            online_bookable: false,
        },
    });
    expect(item.status(), await item.text()).toBe(201);
    const itemId = ((await item.json()) as { id: string }).id;
    const zone = "America/Vancouver";
    for (let offset = 14; offset < 21; offset++) {
        const starts = combineDayAndTime(addDays(new Date(), offset, zone), "10:00", zone);
        const booking = await page.request.post(`${api}/v1/bookings`, {
            headers: { ...headers, "Idempotency-Key": randomUUID() },
            data: {
                client_id: first.id,
                item_id: itemId,
                staff_id: staff.id,
                starts_at: starts.toISOString(),
                notify: false,
            },
        });
        if (booking.status() === 409) continue;
        expect(booking.status(), await booking.text()).toBe(201);
        const saved = (await booking.json()) as { id: string; slot_id: string };
        return {
            first,
            second,
            waiting,
            slotId: saved.slot_id,
            bookingId: saved.id,
            clientId: first.id,
            clientName: first.name,
            clientPhone: first.phone,
            itemId,
            itemName,
            staffId: staff.id,
            staffName: staff.name,
            zone,
        };
    }
    throw new Error("No available owner session in the upcoming class window");
}
export async function openClass(page: Page, fixture: ClassFixture) {
    await navigate(page, "/schedule/classes");
    await page
        .getByRole("navigation", { name: strings.classes.upcoming })
        .getByRole("button")
        .filter({ has: page.getByText(fixture.itemName, { exact: true }) })
        .click({ timeout: 60_000 });
    const panel = page.locator("section").filter({
        has: page.getByRole("heading", {
            name: fixture.itemName,
            exact: true,
        }),
    });
    await expect(panel).toHaveCount(1);
    return panel;
}
export async function addClassClient(
    page: Page,
    fixture: ClassFixture,
    client: ClientFixture,
    status: "confirmed" | "waitlisted",
): Promise<string> {
    const panel = await openClass(page, fixture);
    await panel.getByRole("searchbox").fill(client.name);
    const selected = panel.locator(`[data-client-id="${client.id}"]`).getByRole("button");
    await expect(selected).toHaveCount(1);
    const saved = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === `/v1/classes/${fixture.slotId}/roster` &&
            response.request().method() === "POST",
    );
    await selected.click();
    const response = await saved;
    expect(response.status(), await response.text()).toBe(201);
    const result = (await response.json()) as { booking_id: string };
    expect(await response.json()).toMatchObject({
        client_id: client.id,
        slot_id: fixture.slotId,
        status,
    });
    await expect(panel.getByRole("listitem").filter({ hasText: client.name })).toHaveCount(1);
    return result.booking_id;
}
export async function expectClassState(
    fixture: ClassFixture,
    expected: { client: ClientFixture; id: string; status: string }[],
) {
    const evidence = await classEvidence(fixture.itemId);
    expect(evidence.slots).toEqual([
        {
            id: fixture.slotId,
            item_id: fixture.itemId,
            staff_id: fixture.staffId,
            capacity: 2,
            status: "scheduled",
        },
    ]);
    expect(evidence.bookings).toEqual(
        expected
            .map(({ client, id, status }) => ({
                id,
                slot_id: fixture.slotId,
                client_id: client.id,
                status,
                deposit_status: "none",
                deposit_amount_cents: 0,
            }))
            .sort((a, b) => a.id.localeCompare(b.id)),
    );
    return evidence;
}
export async function cleanupClass(page: Page, fixture: ClassFixture): Promise<void> {
    const evidence = await classEvidence(fixture.itemId);
    const active = evidence.bookings
        .filter((row) => row.status !== "canceled")
        .sort((a, b) => Number(b.status === "waitlisted") - Number(a.status === "waitlisted"));
    for (const booking of active) await cancelOwnedBooking(page, booking.id);
}

export async function classManageUrl(fixture: ClassFixture): Promise<string> {
    const port = process.env.CONNECT_E2E_PORT;
    if (!port || !/^\d+$/.test(port))
        throw new Error("Class journey needs the local Connect server");
    const [row] = await select<{ manage_token: string | null }>`
        SELECT b.manage_token FROM bookings b JOIN slots s ON s.id = b.slot_id
        WHERE s.item_id = ${fixture.itemId} AND b.id = ${fixture.bookingId}
            AND b.deleted_at IS NULL`;
    const token = row?.manage_token;
    if (!token) throw new Error("owned enrollment has no manage token");
    return `http://book.localhost:${port}/m/${encodeURIComponent(token)}`;
}

interface SeatDelivery {
    id: string;
    state: string;
    error: string | null;
    channel: string;
    recipient: string;
    body: string;
    created_at: string;
}

function seatDeliveries(fixture: ClassFixture, bookingId: string): Promise<SeatDelivery[]> {
    return select<SeatDelivery>`
        SELECT d.id, d.state, d.error, d.payload->>'channel' AS channel,
            d.payload->'message'->>'to' AS recipient,
            d.payload->'message'->>'body' AS body, to_jsonb(d.created_at) AS created_at
        FROM deliveries d JOIN bookings b ON b.id = ${bookingId}
        JOIN slots s ON s.id = b.slot_id AND s.item_id = ${fixture.itemId}
        WHERE starts_with(d.key, 'seat:' || s.id || ':' || b.id || ':') ORDER BY d.id`;
}

// The worker's send_deliveries cron fires at second 15 of every minute (tasks/worker.py).
const DELIVERY_TICK = { second: 15, window: 10 };

export async function expectWorkerSentSeatNotice(
    page: Page,
    fixture: ClassFixture,
    bookingId: string,
    phone: string,
) {
    await expect
        .poll(async () => (await seatDeliveries(fixture, bookingId)).map((row) => row.state), {
            timeout: 100_000,
            intervals: [2_000],
        })
        .toEqual(["accepted"]);
    const [delivery] = await seatDeliveries(fixture, bookingId);
    if (!delivery) throw new Error("The seat notice delivery disappeared");
    expect(delivery).toMatchObject({ channel: "sms", error: null, recipient: phone });
    const received = async () =>
        (await textsTo(page.request, phone)).filter((text) =>
            delivery.body.startsWith(text.Snippet.slice(0, 60)),
        );
    await expect.poll(async () => (await received()).length).toBe(1);
    const [message] = await received();
    if (!message) throw new Error("the dev inbox lost the seat notice");
    const queued = new Date(delivery.created_at).getTime();
    const arrived = new Date(message.Created);
    expect(arrived.getTime()).toBeGreaterThanOrEqual(queued - 1_000);
    expect(arrived.getTime() - queued).toBeLessThanOrEqual(75_000);
    expect(arrived.getUTCSeconds()).toBeGreaterThanOrEqual(DELIVERY_TICK.second);
    expect(arrived.getUTCSeconds()).toBeLessThan(DELIVERY_TICK.second + DELIVERY_TICK.window);
    return { delivery, message };
}
