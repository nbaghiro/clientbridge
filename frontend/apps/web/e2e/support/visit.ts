import { randomUUID } from "node:crypto";
import { strings } from "@clientbridge/app-core/public";
import { demoPerson } from "@clientbridge/config/e2e/demo";
import { expect, type Locator, type Page, type Response } from "@playwright/test";
import { bookingApi } from "./bookings";
import { select } from "./db";
import { runEmail, runPort, runUrl, demoSlug } from "@clientbridge/config/e2e/run";
import { requireLocalMail } from "./evidence";

const b = strings.publicBooking;

export interface VisitEvidence {
    clients: { id: string; name: string; email: string }[];
    subjects: {
        id: string;
        client_id: string;
        name: string;
        attributes: Record<string, unknown>;
    }[];
    bookings: {
        id: string;
        client_id: string;
        subject_id: string | null;
        status: string;
        source: string;
        staff_id: string | null;
        price_cents: number;
        deposit_amount_cents: number;
        deposit_status: string;
        invoice_id: string | null;
        package_id: string | null;
        slot_id: string;
        starts_at: string;
        ends_at: string;
        item_id: string;
        resource_id: string | null;
        recurrence_id: string | null;
        capacity: number;
        slot_status: string;
    }[];
    addons: {
        booking_id: string;
        item_id: string;
        description: string;
        quantity: number;
        unit_amount_cents: number;
    }[];
    packages: {
        id: string;
        item_id: string;
        subject_id: string | null;
        sessions_total: number;
        status: string;
        payment_id: string | null;
    }[];
    payments: {
        id: string;
        kind: string;
        method: string;
        status: string;
        amount_cents: number;
        invoice_id: string | null;
        booking_id: string | null;
    }[];
    invoices: {
        id: string;
        client_id: string;
        status: string;
        number: number | null;
        subtotal_cents: number;
        tax_total_cents: number;
        total_cents: number;
        due_at: string | null;
    }[];
    lines: {
        invoice_id: string;
        position: number;
        description: string;
        quantity: number;
        unit_amount_cents: number;
        amount_cents: number;
        tax_amount_cents: number;
        item_id: string | null;
        booking_id: string | null;
    }[];
    entries: {
        journal_id: string;
        event: string;
        amount_cents: number;
        category: string;
        subject_type: string | null;
        subject_id: string | null;
        source_id: string | null;
    }[];
    holds?: {
        id: string;
        item_id: string;
        staff_id: string;
        starts_at: string;
        ends_at: string;
        status: string;
    }[];
}

/** Clients are named by id or email, so a Connect booker is found before the app knows its id. */
export async function visitEvidence(
    keys: readonly string[],
    resource?: string,
): Promise<VisitEvidence> {
    type Evidence = VisitEvidence;
    const owned = await select<{ id: string }>`
        SELECT id FROM clients WHERE id = ANY(${keys}::text[]) OR email = ANY(${keys}::text[])`;
    const clients = owned.map((row) => row.id);
    const bookings = (
        await select<{ id: string }>`
            SELECT id FROM bookings WHERE client_id = ANY(${clients}::text[])`
    ).map((row) => row.id);
    const invoices = (
        await select<{ id: string }>`
            SELECT id FROM invoices WHERE client_id = ANY(${clients}::text[])
            UNION SELECT invoice_id FROM bookings
            WHERE id = ANY(${bookings}::text[]) AND invoice_id IS NOT NULL`
    ).map((row) => row.id);
    const result: VisitEvidence = {
        clients: await select<Evidence["clients"][number]>`
            SELECT id, name, email FROM clients WHERE id = ANY(${clients}::text[])
            ORDER BY email`,
        subjects: await select<Evidence["subjects"][number]>`
            SELECT id, client_id, name, attributes FROM subjects
            WHERE client_id = ANY(${clients}::text[]) ORDER BY name`,
        bookings: await select<Evidence["bookings"][number]>`
            SELECT b.id, b.client_id, b.subject_id, b.status, b.source, b.staff_id,
                b.price_cents, b.deposit_amount_cents, b.deposit_status, b.invoice_id,
                b.package_id, b.slot_id, to_jsonb(s.starts_at) AS starts_at,
                to_jsonb(s.ends_at) AS ends_at, s.item_id, s.resource_id, s.recurrence_id,
                s.capacity, s.status AS slot_status
            FROM bookings b JOIN slots s ON s.id = b.slot_id
            WHERE b.id = ANY(${bookings}::text[]) ORDER BY s.starts_at, b.id`,
        addons: await select<Evidence["addons"][number]>`
            SELECT booking_id, item_id, description, quantity, unit_amount_cents FROM addons
            WHERE booking_id = ANY(${bookings}::text[]) ORDER BY booking_id, id`,
        packages: await select<Evidence["packages"][number]>`
            SELECT id, item_id, subject_id, sessions_total, status, payment_id FROM packages
            WHERE client_id = ANY(${clients}::text[]) ORDER BY id`,
        payments: await select<Evidence["payments"][number]>`
            SELECT id, kind, method, status, amount_cents, invoice_id, booking_id
            FROM payments WHERE client_id = ANY(${clients}::text[]) ORDER BY id`,
        invoices: await select<Evidence["invoices"][number]>`
            SELECT id, client_id, status, number, subtotal_cents, tax_total_cents,
                total_cents, to_jsonb(due_at) AS due_at
            FROM invoices WHERE id = ANY(${invoices}::text[]) ORDER BY id`,
        lines: await select<Evidence["lines"][number]>`
            SELECT invoice_id, position, description, quantity::float AS quantity,
                unit_amount_cents, amount_cents, tax_amount_cents, item_id, booking_id
            FROM lines WHERE invoice_id = ANY(${invoices}::text[])
            ORDER BY invoice_id, position`,
        entries: await select<Evidence["entries"][number]>`
            SELECT e.journal_id, e.event, e.amount_cents, a.category, e.subject_type,
                e.subject_id, e.source_id
            FROM entries e JOIN accounts a ON a.id = e.account_id
            WHERE e.subject_id IN (
                SELECT id FROM packages WHERE client_id = ANY(${clients}::text[]))
                OR e.subject_id = ANY(${invoices}::text[])
                OR e.subject_id = ANY(${bookings}::text[])
            ORDER BY e.journal_id, e.leg`,
    };
    if (resource !== undefined)
        result.holds = await select<NonNullable<Evidence["holds"]>[number]>`
            SELECT id, item_id, staff_id, to_jsonb(starts_at) AS starts_at,
                to_jsonb(ends_at) AS ends_at, status
            FROM slots WHERE resource_id = ${resource} ORDER BY starts_at, id`;
    return result;
}

export const at = (iso: string): number => new Date(iso).getTime();

export async function apiCall<T>(
    page: Page,
    method: "POST" | "PATCH",
    path: string,
    data: Record<string, unknown>,
    status: number,
): Promise<T> {
    const response = await page.request.fetch(`${bookingApi()}${path}`, {
        method,
        data,
        headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
    });
    expect(response.status(), `${method} ${path}: ${await response.text()}`).toBe(status);
    return (await response.json()) as T;
}

export async function teamMember(page: Page, email: string): Promise<{ id: string; name: string }> {
    const team = await page.request.get(`${bookingApi()}/v1/staff/team`);
    expect(team.status()).toBe(200);
    const { members } = (await team.json()) as {
        members: { id: string; email: string; name: string; status: string }[];
    };
    const member = members.find((m) => m.email === email && m.status === "active");
    if (!member) throw new Error(`The seeded team member ${email} is missing`);
    return { id: member.id, name: member.name };
}

export function connectUrl(slug: string, query = ""): string {
    return `http://book.localhost:${String(runPort("CONNECT_E2E_PORT"))}/${slug}${query}`;
}

/** A stack-provided base URL, such as `PAY_BASE_URL`, with no local fallback. */
export function stackUrl(name: string): URL {
    return new URL(runUrl(name));
}

export function shopUrl(slug: string): string {
    return `${stackUrl("SHOP_BASE_URL").origin}/${slug}`;
}

export function onlineBooker(subject: string): { name: string; email: string; subject: string } {
    const run = randomUUID();
    return { name: demoPerson(run), email: runEmail(`visit-${run}@example.ca`), subject };
}

export interface Openings {
    days: Response[];
    slots: Response[];
}

/** Collects every week of openings and every day of times a Connect page loads. */
export function watchOpenings(page: Page, slug: string): Openings {
    const openings: Openings = { days: [], slots: [] };
    page.on("response", (response) => {
        if (!response.ok()) return;
        if (response.url().includes(`/book/${slug}/days?`)) openings.days.push(response);
        if (response.url().includes(`/book/${slug}/slots?`)) openings.slots.push(response);
    });
    return openings;
}

/** Opens a service on Connect, past any Extras, watching the openings it loads. */
export async function openConnectService(
    page: Page,
    slug: string,
    itemName: string,
): Promise<Openings> {
    const openings = watchOpenings(page, slug);
    await page.goto(connectUrl(slug));
    await expect(page.getByRole("heading", { name: b.stepService })).toBeVisible();
    await page
        .getByRole("button")
        .filter({ has: page.getByText(itemName, { exact: true }) })
        .click();
    await pastExtras(page);
    return openings;
}

export interface OpenTime {
    starts_at: string;
    ends_at: string;
    staff_id: string | null;
}

/** Steps the week strip forward to one date and returns the open times Connect shows for it. */
export async function openConnectDay(
    page: Page,
    openings: Openings,
    date: string,
): Promise<OpenTime[]> {
    const strip = async (): Promise<{ date: string }[]> => {
        await expect.poll(() => openings.days.length).toBeGreaterThan(0);
        const last = openings.days[openings.days.length - 1];
        if (last === undefined) throw new Error("No openings loaded");
        return ((await last.json()) as { days: { date: string }[] }).days;
    };
    const forDate = (): Response[] =>
        openings.slots.filter(
            (response) => new URL(response.url()).searchParams.get("date") === date,
        );
    for (let week = 0; week < 8; week++) {
        const shown = await strip();
        const index = shown.findIndex((day) => day.date === date);
        if (index >= 0) {
            const loaded = forDate().length;
            const radio = page
                .getByRole("radiogroup", { name: b.date, exact: true })
                .getByRole("radio")
                .nth(index);
            const already = (await radio.getAttribute("aria-checked")) === "true";
            await radio.click();
            await expect(radio).toHaveAttribute("aria-checked", "true");
            await expect
                .poll(() => forDate().length)
                .toBeGreaterThan(already ? Math.max(loaded - 1, 0) : loaded);
            const latest = forDate().at(-1);
            if (latest === undefined) throw new Error(`No times loaded for ${date}`);
            return ((await latest.json()) as { slots: OpenTime[] }).slots;
        }
        const count = openings.days.length;
        await page.getByRole("button", { name: b.nextWeek, exact: true }).first().click();
        await expect.poll(() => openings.days.length).toBeGreaterThan(count);
    }
    throw new Error(`Connect never showed ${date}`);
}

export async function fillConnectDetails(
    page: Page,
    booker: { name: string; email: string; subject: string },
    kind: "pet" | "site" | "vehicle",
    address?: string,
): Promise<void> {
    await page.getByRole("button", { name: b.continue, exact: true }).first().click();
    const name = page.getByRole("textbox", { name: b.name, exact: true });
    await expect(name).toBeVisible();
    await name.fill(booker.name);
    await page.getByRole("textbox", { name: b.subject(kind), exact: true }).fill(booker.subject);
    if (address !== undefined)
        await page.getByRole("textbox", { name: b.address, exact: true }).fill(address);
    await page.getByRole("textbox", { name: new RegExp(`^${b.email}`) }).fill(booker.email);
}

export async function choiceKeys(group: Locator): Promise<string[]> {
    await expect(group.locator("button[data-value]").first()).toBeVisible({ timeout: 60_000 });
    const keys = await group
        .locator("button[data-value]")
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("data-value") ?? ""));
    return keys.sort();
}

export async function connectStaff(
    page: Page,
    slug: string,
    itemId: string,
): Promise<string[] | undefined> {
    const response = await page.request.get(`${bookingApi()}/book/${slug}/services`);
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { services: { id: string; staff_ids: string[] }[] };
    return body.services
        .find((service) => service.id === itemId)
        ?.staff_ids.slice()
        .sort();
}

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
    return { name: demoPerson(run), email: runEmail(`booking-${run}@example.ca`), pet };
}
export async function raceEvidence(
    fixture: RaceFixture,
    contacts: readonly RaceContact[],
): Promise<RaceEvidence> {
    const item = fixture.itemId;
    const first = contacts[0]?.email;
    if (first === undefined) throw new Error("race evidence needs at least one contact");
    const second = contacts[1]?.email ?? first;
    return {
        deliveries: await select<RaceEvidence["deliveries"][number]>`
            SELECT id, state, payload->'message'->>'to' AS recipient FROM deliveries
            WHERE payload->>'channel' = 'email'
                AND payload->'message'->>'to' IN (${first}, ${second})
            ORDER BY id`,
        slots: await select<RaceEvidence["slots"][number]>`
            SELECT id, item_id, staff_id, starts_at::text, capacity FROM slots
            WHERE item_id = ${item} ORDER BY id`,
        bookings: await select<RaceEvidence["bookings"][number]>`
            SELECT b.id, b.slot_id, b.client_id, b.subject_id, b.status, b.source,
                b.deposit_status, b.deposit_amount_cents
            FROM bookings b JOIN slots s ON s.id = b.slot_id
            WHERE s.item_id = ${item} ORDER BY b.id`,
        clients: await select<RaceEvidence["clients"][number]>`
            SELECT id, name, email FROM clients WHERE email IN (${first}, ${second}) ORDER BY id`,
        subjects: await select<RaceEvidence["subjects"][number]>`
            SELECT s.id, s.client_id, s.name FROM subjects s
            JOIN clients c ON c.id = s.client_id
            WHERE c.email IN (${first}, ${second}) ORDER BY s.id`,
        payments: await select<RaceEvidence["payments"][number]>`
            SELECT p.id FROM payments p
            LEFT JOIN clients c ON c.id = p.client_id
            LEFT JOIN bookings b ON b.id = p.booking_id
            LEFT JOIN slots s ON s.id = b.slot_id
            WHERE c.email IN (${first}, ${second}) OR s.item_id = ${item} ORDER BY p.id`,
    };
}
export async function raceFixture(page: Page): Promise<RaceFixture> {
    requireLocalMail();
    const api = bookingApi();
    const port = process.env.CONNECT_E2E_PORT;
    if (!port || !/^\d+$/.test(port))
        throw new Error("Race journey needs the local Connect server");
    const team = await page.request.get(`${api}/v1/staff/team`);
    expect(team.status()).toBe(200);
    const { members } = (await team.json()) as {
        members: { id: string; email: string; name: string }[];
    };
    const staff = members.find((member) => member.email === runEmail("hannah@birchbark.example"));
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
        url: `http://book.localhost:${port}/${demoSlug("birchbark")}`,
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
            response.url().includes(`/book/${demoSlug("birchbark")}/days?`) &&
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
                response.url().includes(`/book/${demoSlug("birchbark")}/days?`) &&
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
