import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { demoPerson } from "@clientbridge/config/e2e/demo";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { addDays, combineDayAndTime, strings } from "@clientbridge/app-core/public";
import { expect, type Page } from "@playwright/test";
import { bookingApi, cancelOwnedBooking, type BookingFixture } from "./bookings";
import { createClient, type ClientFixture } from "./crm";
import { requireLocalMail } from "./evidence";
import { navigate } from "./session";

const execute = promisify(execFile);
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
    const { stdout } = await execute("uv", ["run", "python", "-m", "scripts.e2e_classes", itemId], {
        cwd: fileURLToPath(new URL("../../../../../backend", import.meta.url)),
        timeout: 30_000,
    });
    return JSON.parse(stdout) as ClassEvidence;
}
export async function classFixture(page: Page): Promise<ClassFixture> {
    await requireLocalMail();
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
    const staff = team.members.find((row) => row.email === "hannah@birchbark.example");
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
            clientEmail: first.email,
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
    const { stdout } = await execute(
        "uv",
        [
            "run",
            "python",
            "-m",
            "scripts.e2e_classes",
            fixture.itemId,
            "--manage-booking",
            fixture.bookingId,
        ],
        {
            cwd: fileURLToPath(new URL("../../../../../backend", import.meta.url)),
            timeout: 30_000,
        },
    );
    const { manage_token: token } = JSON.parse(stdout) as { manage_token: string };
    return `http://book.localhost:${port}/m/${encodeURIComponent(token)}`;
}
