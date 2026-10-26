import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { strings } from "@clientbridge/app-core/public";
import { demoPerson } from "@clientbridge/config/e2e/demo";
import { expect, type Locator, type Page, type Response } from "@playwright/test";

import { bookingApi } from "./bookings";
import { pastExtras } from "./scheduling";
import { runEmail, runPort, runUrl } from "@clientbridge/config/e2e/run";

const execute = promisify(execFile);
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
    const { stdout } = await execute(
        "uv",
        [
            "run",
            "python",
            "-m",
            "scripts.e2e_visits_evidence",
            ...keys,
            ...(resource === undefined ? [] : ["--resource", resource]),
        ],
        {
            cwd: fileURLToPath(new URL("../../../../../backend", import.meta.url)),
            timeout: 30_000,
        },
    );
    return JSON.parse(stdout) as VisitEvidence;
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
