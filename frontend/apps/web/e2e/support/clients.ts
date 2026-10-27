import { randomUUID } from "node:crypto";
import { demoPerson } from "@clientbridge/config/e2e/demo";
import { strings } from "@clientbridge/app-core/public";
import { expect, type Locator, type Page, type Response } from "@playwright/test";
import { navigate } from "./session";
import { runEmail, runUrl, demoSlug } from "@clientbridge/config/e2e/run";
import { mailedCode } from "./auth";
import { bookingApi, createBookingFixture, type BookingFixture } from "./bookings";
import { select } from "./db";
import { pastExtras } from "./visit";

export interface ClientFixture {
    id: string;
    name: string;
    email: string;
}

export function clientCommand(page: Page, path: string, method: string): Promise<Response> {
    return page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === `/v1/clients${path}` &&
            response.request().method() === method,
    );
}

export async function clientTags(id: string): Promise<string[]> {
    const rows = await select<{ tags: string[] }>`SELECT tags FROM clients WHERE id = ${id}`;
    return rows.map((row) => row.tags).flat();
}

export async function openClient(page: Page, client: ClientFixture): Promise<Locator> {
    await navigate(page, `/clients?open=${client.id}`);
    const record = page.getByRole("complementary", { name: client.name, exact: true });
    await expect(record.getByRole("heading", { name: client.name, exact: true })).toBeVisible({
        timeout: 60_000,
    });
    await expect(record).toContainText(client.email);
    return record;
}

export async function editClient(page: Page, client: ClientFixture): Promise<Locator> {
    const record = await openClient(page, client);
    // a note's menu button is also named Edit; the record's own button shows the word
    await record
        .getByRole("button", { name: strings.clients.record.editShort, exact: true })
        .filter({ hasText: strings.clients.record.editShort })
        .click();
    const editor = page.getByRole("dialog", { name: strings.clients.edit.editTitle, exact: true });
    await expect(editor.getByRole("textbox", { name: strings.clients.edit.nameLabel })).toHaveValue(
        client.name,
    );
    await expect(
        editor.getByRole("textbox", { name: strings.clients.edit.emailLabel, exact: true }),
    ).toHaveValue(client.email);
    return editor;
}

export async function expectClientSegment(
    page: Page,
    client: ClientFixture,
    archived: boolean,
): Promise<void> {
    await navigate(page, "/today");
    await navigate(page, "/clients");
    const label = archived
        ? strings.clients.edit.segmentArchived(0)
        : strings.clients.edit.segmentActive(0);
    const pattern = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("0", "[\\d,]+");
    await page.getByRole("button", { name: new RegExp(`^${pattern}$`) }).click();
    await page.getByRole("searchbox").fill(client.email);
    const row = page.getByRole("button").filter({ hasText: client.name });
    await expect(row).toHaveCount(1);
    const opposite = archived
        ? strings.clients.edit.segmentActive(0)
        : strings.clients.edit.segmentArchived(0);
    const oppositePattern = opposite.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("0", "[\\d,]+");
    await page.getByRole("button", { name: new RegExp(`^${oppositePattern}$`) }).click();
    await expect(row).toHaveCount(0);
}

export async function createClient(
    page: Page,
    name = demoPerson(randomUUID()),
    emailRun = randomUUID(),
): Promise<ClientFixture> {
    const run = randomUUID();
    const api = runUrl("VITE_API_URL");
    const input = { name, email: runEmail(`crm-${emailRun}-${run}@example.ca`) };
    const response = await page.request.post(`${api}/v1/clients`, {
        data: { ...input, preferred_channel: "email" },
        headers: { "Idempotency-Key": randomUUID(), Origin: new URL(page.url()).origin },
    });
    expect(response.status(), await response.text()).toBe(201);
    const body = (await response.json()) as { id: string };
    return { ...input, id: body.id };
}

export function crmCommand(page: Page, path: string, method: string): Promise<Response> {
    return page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === `/v1/${path}` &&
            response.request().method() === method,
    );
}

export async function addPet(page: Page, client: ClientFixture, name: string): Promise<string> {
    const record = await openClient(page, client);
    await record.getByRole("button", { name: strings.subjects.add("pet"), exact: true }).click();
    const form = page.getByRole("dialog", { name: strings.subjects.add("pet"), exact: true });
    await form.getByRole("textbox", { name: strings.subjects.nameLabel }).fill(name);
    await form
        .getByRole("textbox", { name: strings.subjects.fields.pet.breed, exact: false })
        .fill("Poodle");
    const saving = crmCommand(page, "subjects", "POST");
    await form.getByRole("button", { name: strings.subjects.save("pet"), exact: true }).click();
    const response = await saving;
    expect(response.status(), await response.text()).toBe(201);
    const body = (await response.json()) as { id: string };
    await expect(
        record.getByRole("button", { name: strings.subjects.editNamed(name), exact: true }),
    ).toBeVisible();
    return body.id;
}

export async function addClientNote(
    page: Page,
    client: ClientFixture,
    body: string,
    subject?: string,
): Promise<string> {
    const record = await openClient(page, client);
    await record.getByRole("button", { name: strings.clients.record.addNote, exact: true }).click();
    const form = page.getByRole("dialog", {
        name: strings.clients.record.addNoteTitle,
        exact: true,
    });
    const save = form.getByRole("button", { name: strings.clients.history.saveNote, exact: true });
    await expect(save).toBeDisabled();
    await form.getByRole("textbox").fill("   ");
    await expect(save).toBeDisabled();
    await form.getByRole("textbox").fill(body);
    if (subject !== undefined) {
        await form
            .getByRole("group", { name: strings.clients.history.about, exact: true })
            .getByRole("button", { name: subject, exact: true })
            .click();
    }
    const saving = crmCommand(page, "notes", "POST");
    await save.click();
    const response = await saving;
    expect(response.status(), await response.text()).toBe(201);
    const result = (await response.json()) as { id: string };
    await expect(record.getByText(body, { exact: true })).toBeVisible();
    return result.id;
}

export interface ReturningFixture extends BookingFixture {
    client: ClientFixture;
    petId: string;
}
interface ReturningEvidence {
    clients: { id: string; name: string; email: string; phone: string | null; status: string }[];
    subjects: { id: string; client_id: string; name: string; deleted_at: string | null }[];
    bookings: { id: string; client_id: string; subject_id: string; status: string }[];
    slots: { id: string; item_id: string; staff_id: string }[];
    challenges: { id: string; client_id: string; attempts: number; verified: boolean }[];
}
export async function returningEvidence(f: ReturningFixture): Promise<ReturningEvidence> {
    type Evidence = ReturningEvidence;
    return {
        clients: await select<Evidence["clients"][number]>`
            SELECT id, name, email, phone, status, preferred_channel FROM clients
            WHERE id = ${f.clientId} OR email = ${f.clientEmail} ORDER BY id`,
        subjects: await select<Evidence["subjects"][number]>`
            SELECT id, client_id, name, to_jsonb(deleted_at) AS deleted_at FROM subjects
            WHERE client_id = ${f.clientId} ORDER BY id`,
        bookings: await select<Evidence["bookings"][number]>`
            SELECT b.id, b.client_id, b.subject_id, b.status, b.source, b.price_cents,
                b.deposit_amount_cents, b.deposit_status
            FROM bookings b JOIN slots s ON s.id = b.slot_id
            WHERE s.item_id = ${f.itemId} ORDER BY b.id`,
        slots: await select<Evidence["slots"][number]>`
            SELECT id, item_id, staff_id, to_jsonb(starts_at) AS starts_at,
                to_jsonb(ends_at) AS ends_at
            FROM slots WHERE item_id = ${f.itemId} ORDER BY id`,
        challenges: await select<Evidence["challenges"][number]>`
            SELECT id, client_id, attempts, verified_at IS NOT NULL AS verified
            FROM returning_challenges WHERE client_id = ${f.clientId} ORDER BY id`,
    };
}

export interface ContactEvidence {
    clients: {
        id: string;
        name: string;
        email: string | null;
        phone: string | null;
        status: string;
    }[];
    subjects: { id: string; client_id: string; name: string; deleted_at: string | null }[];
    bookings: { id: string; client_id: string; subject_id: string | null }[];
    slots: { id: string; item_id: string }[];
}

/** Every client either address or the phone matches, and what a booking of `item` left behind. */
export async function contactEvidence(
    emails: readonly [string, string],
    phone: string,
    item: string,
): Promise<ContactEvidence> {
    const [first, second] = emails;
    return {
        clients: await select<ContactEvidence["clients"][number]>`
            SELECT id, name, email, phone, status FROM clients
            WHERE id IN (
                SELECT id FROM clients
                WHERE email IN (${first}, ${second}) OR phone = ${phone})
            ORDER BY id`,
        subjects: await select<ContactEvidence["subjects"][number]>`
            SELECT id, client_id, name, to_jsonb(deleted_at) AS deleted_at FROM subjects
            WHERE client_id IN (
                SELECT id FROM clients
                WHERE email IN (${first}, ${second}) OR phone = ${phone})
            ORDER BY id`,
        bookings: await select<ContactEvidence["bookings"][number]>`
            SELECT b.id, b.client_id, b.subject_id FROM bookings b
            JOIN slots s ON b.slot_id = s.id WHERE s.item_id = ${item} ORDER BY b.id`,
        slots: await select<ContactEvidence["slots"][number]>`
            SELECT id, item_id FROM slots WHERE item_id = ${item} ORDER BY id`,
    };
}
export async function returningFixture(page: Page): Promise<ReturningFixture> {
    const f = await createBookingFixture(page);
    const response = await page.request.patch(`${bookingApi()}/v1/items/${f.itemId}`, {
        headers: { Origin: new URL(page.url()).origin },
        data: { online_bookable: true },
    });
    expect(response.status(), await response.text()).toBe(200);
    const client = { id: f.clientId, name: f.clientName, email: f.clientEmail };
    await addPet(page, client, "Maple");
    const petId = await addPet(page, client, "Clover");
    return { ...f, client, petId };
}
export async function verifyReturning(
    page: Page,
    f: ReturningFixture,
    week: number,
): Promise<void> {
    const b = strings.publicBooking;
    const t = strings.publicReturning;
    const port = process.env.CONNECT_E2E_PORT;
    if (!port) throw new Error("Returning journeys require CONNECT_E2E_PORT");
    const availableDays = () =>
        page.waitForResponse(
            (r) =>
                new URL(r.url()).pathname === `/book/${demoSlug("birchbark")}/days` &&
                r.status() === 200,
        );
    let loaded = availableDays();
    await page.goto(
        `http://book.localhost:${port}/${demoSlug("birchbark")}?service=${f.itemId}&staff=${f.staffId}`,
    );
    await pastExtras(page);
    let response = await loaded;
    const days = page.getByRole("radiogroup", { name: b.date, exact: true });
    for (let index = 0; index < week; index++) {
        loaded = availableDays();
        await page.getByRole("button", { name: b.nextWeek, exact: true }).first().click();
        response = await loaded;
    }
    const availability = (await response.json()) as { days: { date: string; count: number }[] };
    const index = availability.days.findIndex((day, index) => index >= 2 && day.count > 0);
    expect(index, "A real available time exists in the isolated week").toBeGreaterThanOrEqual(2);
    const day = days.getByRole("radio").nth(index);
    await expect(day).toBeEnabled();
    await day.click();
    const time = page
        .getByRole("radiogroup", { name: b.openTimes, exact: true })
        .getByRole("radio")
        .first();
    await expect(time).toBeVisible();
    await time.click();
    await page.getByRole("button", { name: b.continue, exact: true }).first().click();
    const intro = page.getByText(t.intro("pet"), { exact: true });
    if (!(await intro.isVisible()))
        await page.getByRole("button", { name: b.continue, exact: true }).first().click();
    await intro.click();
    const panel = page
        .locator("section")
        .filter({ has: page.getByRole("heading", { name: t.title, exact: true }) });
    await panel.getByRole("textbox", { name: t.email, exact: true }).fill(f.clientEmail);
    await panel.getByRole("button", { name: t.sendCode, exact: true }).click();
    await page
        .getByRole("textbox", { name: t.code, exact: true })
        .fill(await mailedCode(page.request, f.clientEmail, "booking verification"));
    const verified = page.waitForResponse(
        (r) => new URL(r.url()).pathname === `/book/${demoSlug("birchbark")}/returning/verify`,
    );
    await page.getByRole("button", { name: t.verify, exact: true }).click();
    const result = await verified;
    expect(result.status(), await result.text()).toBe(200);
    const body = (await result.json()) as { profile: Record<string, unknown> };
    expect(Object.keys(body.profile).sort()).toEqual([
        "email",
        "last_visit",
        "name",
        "phone",
        "subjects",
    ]);
    expect(body.profile.last_visit).toBeNull();
    await expect(
        page.getByRole("heading", { name: t.welcome(f.clientName), exact: true }),
    ).toBeVisible();
    await page
        .getByRole("group", { name: t.choose("pet"), exact: true })
        .getByRole("button", { name: "Clover", exact: true })
        .click();
    await expect(page.getByRole("textbox", { name: b.name, exact: true })).toHaveValue(
        f.clientName,
    );
}
