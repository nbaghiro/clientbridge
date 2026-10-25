import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { strings } from "@clientbridge/app-core/public";
import { demoPerson } from "@clientbridge/config/e2e/demo";
import { expect, type Page } from "@playwright/test";
import { bookingApi } from "./bookings";
import { requireLocalMail } from "./evidence";

const execute = promisify(execFile);
export interface RaceContact {
    name: string;
    email: string;
    pet: string;
}
export interface RaceFixture {
    itemId: string;
    itemName: string;
    staffId: string;
    staffName: string;
    url: string;
}
export interface RaceEvidence {
    deliveries: { id: string; state: string; recipient: string }[];
    slots: { id: string; item_id: string; staff_id: string; starts_at: string; capacity: number }[];
    bookings: {
        id: string;
        slot_id: string;
        client_id: string;
        subject_id: string;
        status: string;
        source: string;
        deposit_status: string;
        deposit_amount_cents: number;
    }[];
    clients: { id: string; name: string; email: string }[];
    subjects: { id: string; client_id: string; name: string }[];
    payments: { id: string }[];
}
export function raceContact(pet: string): RaceContact {
    const run = randomUUID();
    return { name: demoPerson(run), email: `booking-${run}@example.ca`, pet };
}
export async function raceEvidence(
    fixture: RaceFixture,
    contacts: readonly RaceContact[],
): Promise<RaceEvidence> {
    const { stdout } = await execute(
        "uv",
        [
            "run",
            "python",
            "-m",
            "scripts.e2e_scheduling",
            fixture.itemId,
            ...contacts.map((contact) => contact.email),
        ],
        {
            cwd: fileURLToPath(new URL("../../../../../backend", import.meta.url)),
            timeout: 30_000,
        },
    );
    return JSON.parse(stdout) as RaceEvidence;
}
export async function raceFixture(page: Page): Promise<RaceFixture> {
    await requireLocalMail();
    const api = bookingApi();
    const port = process.env.CONNECT_E2E_PORT;
    if (!port || !/^\d+$/.test(port))
        throw new Error("Race journey needs the local Connect server");
    const team = await page.request.get(`${api}/v1/staff/team`);
    expect(team.status()).toBe(200);
    const { members } = (await team.json()) as {
        members: { id: string; email: string; name: string }[];
    };
    const staff = members.find((member) => member.email === "hannah@birchbark.example");
    if (!staff) throw new Error("The Birch & Bark owner fixture is missing");
    const itemName = `Paw care with ${demoPerson(randomUUID())}`;
    const item = await page.request.post(`${api}/v1/items`, {
        headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
        data: {
            kind: "service",
            name: itemName,
            duration_min: 30,
            price_cents: 2500,
            deposit_type: "none",
            online_bookable: true,
        },
    });
    expect(item.status(), await item.text()).toBe(201);
    return {
        itemId: ((await item.json()) as { id: string }).id,
        itemName,
        staffId: staff.id,
        staffName: staff.name,
        url: `http://book.localhost:${port}/birchbark`,
    };
}
// a service with add-ons offers them in its own step before the time
export async function pastExtras(page: Page): Promise<void> {
    const b = strings.publicBooking;
    const days = page.getByRole("radiogroup", { name: b.date, exact: true });
    const extras = page.getByText(b.oftenAdded, { exact: true });
    await expect(days.or(extras)).toBeVisible();
    if (await days.isVisible()) return;
    await page.getByRole("button", { name: b.continue, exact: true }).first().click();
    await expect(days).toBeVisible();
}

export async function raceTimePicker(
    page: Page,
    fixture: RaceFixture,
    weeksAhead = 3,
): Promise<number> {
    const b = strings.publicBooking;
    await page.goto(fixture.url);
    await page
        .getByRole("button")
        .filter({ has: page.getByText(fixture.itemName, { exact: true }) })
        .click();
    await pastExtras(page);
    const staffDays = page.waitForResponse(
        (response) =>
            response.url().includes("/book/birchbark/days?") &&
            new URL(response.url()).searchParams.get("staff_id") === fixture.staffId &&
            response.ok(),
    );
    await page
        .getByRole("group", { name: b.with, exact: true })
        .getByRole("button", { name: fixture.staffName, exact: true })
        .click();
    await staffDays;
    let days: { date: string; count: number; closed: boolean }[] = [];
    for (let week = 0; week < weeksAhead; week++) {
        const loaded = page.waitForResponse(
            (response) =>
                response.url().includes("/book/birchbark/days?") &&
                new URL(response.url()).searchParams.get("staff_id") === fixture.staffId &&
                response.ok(),
        );
        await page.getByRole("button", { name: b.nextWeek, exact: true }).first().click();
        days = ((await (await loaded).json()) as { days: typeof days }).days;
    }
    const index = days.findIndex((day) => day.count > 0 && !day.closed);
    expect(index).toBeGreaterThanOrEqual(0);
    return index;
}
export async function raceDetails(page: Page, contact: RaceContact): Promise<void> {
    const b = strings.publicBooking;
    await page.getByRole("button", { name: b.continue, exact: true }).first().click();
    const details = page.getByRole("textbox", { name: b.name, exact: true });
    const extras = page.getByRole("heading", { name: b.oftenAdded, exact: true });
    await expect(details.or(extras)).toBeVisible();
    if (await extras.isVisible())
        await page.getByRole("button", { name: b.continue, exact: true }).first().click();
    await expect(details).toBeVisible();
    await details.fill(contact.name);
    await page.getByRole("textbox", { name: b.subject("pet"), exact: true }).fill(contact.pet);
    await page.getByRole("textbox", { name: new RegExp(`^${b.email}`) }).fill(contact.email);
}

export async function acceptedRaceEvidence(
    fixture: RaceFixture,
    contacts: readonly RaceContact[],
    recipient: string,
): Promise<RaceEvidence> {
    await expect
        .poll(async () => (await raceEvidence(fixture, contacts)).deliveries, {
            timeout: 30_000,
        })
        .toEqual([{ id: expect.any(String), state: "accepted", recipient }]);
    return raceEvidence(fixture, contacts);
}
