import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { strings } from "@clientbridge/app-core/public";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { createClient, type ClientFixture } from "./crm";
import { requireLocalMail } from "./evidence";
import { navigate } from "./session";

const execute = promisify(execFile);
const s = strings.messaging;
export const careMessage =
    "Maple did well with the quieter dryer today.\nPlease brush gently behind her ears this evening.";
export interface MessageEvidence {
    threads: { id: string; client_id: string; channel: string; status: string }[];
    messages: {
        id: string;
        thread_id: string;
        direction: string;
        channel: string;
        body: string;
        status: string;
        provider_ref: string | null;
        sent_by: string;
    }[];
    deliveries: { id: string; state: string }[];
    audits: { action: string; entity_id: string }[];
}
export async function messageEvidence(clientId: string): Promise<MessageEvidence> {
    const { stdout } = await execute(
        "uv",
        ["run", "python", "-m", "scripts.e2e_messaging_evidence", clientId],
        {
            cwd: fileURLToPath(new URL("../../../../../backend", import.meta.url)),
            timeout: 30_000,
        },
    );
    return JSON.parse(stdout) as MessageEvidence;
}
export async function messageFixture(page: Page): Promise<ClientFixture> {
    await requireLocalMail();
    const client = await createClient(page);
    expect(await messageEvidence(client.id)).toEqual({
        threads: [],
        messages: [],
        deliveries: [],
        audits: [],
    });
    expect(await inboxMail(page.request, client.email)).toEqual([]);
    return client;
}
export async function composeMessage(page: Page, client: ClientFixture) {
    await navigate(page, "/inbox");
    await page.getByRole("button", { name: s.newShort, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: s.clientLabel, exact: true }).fill(client.name);
    const option = page.locator(`[role="option"][data-value="${client.id}"]`);
    await expect(option.getByText(client.name, { exact: true })).toBeVisible({ timeout: 60_000 });
    await option.click();
    await dialog
        .getByRole("group", { name: s.channelLabel, exact: true })
        .getByRole("button", { name: s.channels.email, exact: true })
        .click();
    return dialog;
}
export async function inboxMail(
    request: APIRequestContext,
    email: string,
): Promise<{ ID: string; Subject: string }[]> {
    const response = await request.get(
        `${process.env.MAILPIT_URL ?? "http://localhost:8715"}/api/v1/search`,
        { params: { query: `to:"${email}"`, limit: 100 } },
    );
    expect(response.status()).toBe(200);
    return ((await response.json()) as { messages: { ID: string; Subject: string }[] }).messages;
}
export async function expectMail(request: APIRequestContext, email: string): Promise<string> {
    await expect
        .poll(async () => (await inboxMail(request, email)).length, { timeout: 30_000 })
        .toBe(1);
    const message = (await inboxMail(request, email))[0];
    if (message === undefined) throw new Error("SMTP message missing");
    expect(message.Subject).toBe("Birchbark Pet Studio");
    const response = await request.get(
        `${process.env.MAILPIT_URL ?? "http://localhost:8715"}/api/v1/message/${message.ID}`,
    );
    expect(response.status()).toBe(200);
    const mail = (await response.json()) as { Text: string; To: { Address: string }[] };
    expect(mail.To.map((to) => to.Address)).toEqual([email]);
    // SMTP MIME normalizes line endings and adds a terminal newline only.
    expect(mail.Text.replaceAll("\r\n", "\n").replace(/\n$/, "")).toBe(careMessage);
    return message.ID;
}
export async function expectMessageCommitted(client: ClientFixture): Promise<MessageEvidence> {
    const evidence = await messageEvidence(client.id);
    expect(evidence.threads).toEqual([
        { id: expect.any(String), client_id: client.id, channel: "email", status: "open" },
    ]);
    expect(evidence.messages).toEqual([
        {
            id: expect.any(String),
            thread_id: evidence.threads[0]?.id,
            direction: "out",
            channel: "email",
            body: careMessage,
            status: "sent",
            provider_ref: null,
            sent_by: expect.any(String),
        },
    ]);
    expect(evidence.audits).toEqual([
        { action: "message.send", entity_id: evidence.messages[0]?.id },
    ]);
    // Inbox sends directly through SMTP; queued notification deliveries are a different path.
    expect(evidence.deliveries).toEqual([]);
    return evidence;
}
export async function expectMessageReplica(page: Page, client: ClientFixture): Promise<void> {
    await page.goto("/inbox");
    await page.getByRole("searchbox").fill(client.name);
    await page
        .getByRole("button")
        .filter({ has: page.getByText(client.name, { exact: true }) })
        .click({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: client.name, exact: true })).toBeVisible();
    await expect(
        page.locator('[aria-live="polite"]').getByText(careMessage, { exact: true }),
    ).toHaveCount(1);
    await expect(page.locator('[aria-live="polite"]')).toContainText(s.thread.status.sent);
    await expect(
        page.getByRole("textbox", { name: s.replyPlaceholder("email"), exact: true }),
    ).toHaveValue("");
}
export async function readdress(page: Page, client: ClientFixture, email: string): Promise<void> {
    const api = process.env.VITE_API_URL ?? "http://localhost:8701";
    const response = await page.request.patch(`${api}/v1/clients/${client.id}`, {
        data: { email },
        headers: { "Idempotency-Key": randomUUID(), Origin: new URL(page.url()).origin },
    });
    expect(response.status(), await response.text()).toBe(200);
}
export async function expectConversation(
    page: Page,
    client: ClientFixture,
    statuses: string[],
): Promise<void> {
    await page.goto("/inbox");
    await page.getByRole("searchbox").fill(client.name);
    await page
        .getByRole("button")
        .filter({ has: page.getByText(client.name, { exact: true }) })
        .click({ timeout: 60_000 });
    const log = page.locator('[aria-live="polite"]');
    await expect(log.getByText(careMessage, { exact: true })).toHaveCount(statuses.length);
    for (const status of statuses) await expect(log).toContainText(status);
}
