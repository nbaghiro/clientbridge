import { randomUUID } from "node:crypto";
import { demoPerson } from "@clientbridge/config/e2e/demo";
import { strings } from "@clientbridge/app-core/public";
import { expect, type Locator, type Page, type Response } from "@playwright/test";

import { navigate } from "./session";

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
    await record
        .getByRole("button", { name: strings.clients.record.editShort, exact: true })
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
    const api = process.env.VITE_API_URL ?? "http://localhost:8701";
    const input = { name, email: `crm-${emailRun}-${run}@example.ca` };
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
