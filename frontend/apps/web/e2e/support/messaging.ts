import { randomUUID, createHmac, randomInt } from "node:crypto";
import { strings } from "@clientbridge/app-core/public";
import { expect, type APIRequestContext, type Page, type APIResponse } from "@playwright/test";
import { createClient, type ClientFixture } from "./clients";
import { select } from "./db";
import { requireLocalMail } from "./evidence";
import { navigate } from "./session";
import { runUrl, demoPhone, runEmail, runSetting } from "@clientbridge/config/e2e/run";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { demoPerson } from "@clientbridge/config/e2e/demo";

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
    return {
        threads: await select<MessageEvidence["threads"][number]>`
            SELECT id, client_id, channel, status FROM threads
            WHERE client_id = ${clientId} ORDER BY id`,
        messages: await select<MessageEvidence["messages"][number]>`
            SELECT id, thread_id, direction, channel, body, status, provider_ref, sent_by
            FROM messages
            WHERE thread_id IN (SELECT id FROM threads WHERE client_id = ${clientId})
            ORDER BY id`,
        deliveries: await select<MessageEvidence["deliveries"][number]>`
            SELECT id, state FROM deliveries
            WHERE payload->'message'->'tags'->>'message' IN (
                SELECT id FROM messages
                WHERE thread_id IN (SELECT id FROM threads WHERE client_id = ${clientId}))
            ORDER BY id`,
        audits: await select<MessageEvidence["audits"][number]>`
            SELECT action, entity_id FROM audits
            WHERE entity_id IN (
                SELECT id FROM messages
                WHERE thread_id IN (SELECT id FROM threads WHERE client_id = ${clientId}))
            ORDER BY id`,
    };
}
export async function messageFixture(page: Page): Promise<ClientFixture> {
    requireLocalMail();
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
    const response = await request.get(`${runUrl("MAILPIT_URL")}/api/v1/search`, {
        params: { query: `to:"${email}"`, limit: 100 },
    });
    expect(response.status()).toBe(200);
    return ((await response.json()) as { messages: { ID: string; Subject: string }[] }).messages;
}
export interface DeliveredMail {
    id: string;
    subject: string;
    to: string[];
    text: string;
}
export async function deliveredMail(
    request: APIRequestContext,
    email: string,
): Promise<DeliveredMail[]> {
    const base = runUrl("MAILPIT_URL");
    const found = await inboxMail(request, email);
    return Promise.all(
        found.reverse().map(async ({ ID }) => {
            const response = await request.get(`${base}/api/v1/message/${ID}`);
            expect(response.status()).toBe(200);
            const mail = (await response.json()) as {
                Subject: string;
                Text: string;
                To: { Address: string }[];
            };
            return {
                id: ID,
                subject: mail.Subject,
                to: mail.To.map((to) => to.Address),
                // SMTP MIME normalizes line endings and adds a terminal newline only.
                text: mail.Text.replaceAll("\r\n", "\n").replace(/\n$/, ""),
            };
        }),
    );
}
export async function expectMail(request: APIRequestContext, email: string): Promise<string> {
    await expect
        .poll(async () => (await inboxMail(request, email)).length, { timeout: 30_000 })
        .toBe(1);
    const message = (await inboxMail(request, email))[0];
    if (message === undefined) throw new Error("SMTP message missing");
    expect(message.Subject).toBe("Birchbark Pet Studio");
    const response = await request.get(`${runUrl("MAILPIT_URL")}/api/v1/message/${message.ID}`);
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
    expect(evidence.deliveries).toEqual([{ id: expect.any(String), state: "accepted" }]);
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
    const api = runUrl("VITE_API_URL");
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
/** Every link mailed to `email` whose path starts with `path`, waiting until `count` arrive. */
export async function mailedLinks(
    request: APIRequestContext,
    email: string,
    path: string,
    count = 1,
): Promise<URL[]> {
    const find = async (): Promise<URL[]> => {
        const links = (await deliveredMail(request, email))
            .flatMap((mail) => mail.text.match(/https?:\/\/[^\s<>"')\]]+/g) ?? [])
            .filter((link) => new URL(link).pathname.startsWith(path));
        return [...new Set(links)].map((link) => new URL(link));
    };
    await expect.poll(async () => (await find()).length, { timeout: 30_000 }).toBe(count);
    return find();
}

const execute = promisify(execFile);
export const BIRCHBARK_SMS = demoPhone("+12365550190");
export const CEDAR_SMS = demoPhone("+16045550199");

export interface Contact {
    id: string;
    name: string;
    email: string;
    phone: string;
}
interface ThreadRow {
    id: string;
    business_id: string;
    client_id: string;
    channel: string;
    status: string;
}
interface MessageRow {
    id: string;
    business_id: string;
    client_id: string;
    direction: string;
    channel: string;
    body: string | null;
    status: string;
    provider_ref: string | null;
    sent_by: string | null;
    broadcast_id: string | null;
}
interface ConsentRow {
    business_id: string;
    client_id: string;
    channel: string;
    status: string;
    source: string;
    recorded_by: string | null;
}
export interface ClientOutreach {
    threads: ThreadRow[];
    messages: MessageRow[];
    consents: ConsentRow[];
    prefs?: Record<string, string>;
}
export interface WebhookRow {
    id: string;
    provider: string;
    event: string;
    status: string;
    payload: Record<string, unknown>;
}
export interface DeliveryRow {
    id: string;
    business_id: string | null;
    state: string;
    error: string | null;
    channel: string;
    recipient: string;
    subject: string | null;
    from_number: string | null;
    created_at: string;
}
export interface BroadcastEvidence {
    broadcasts: {
        id: string;
        business_id: string;
        name: string;
        channel: string;
        status: string;
        scheduled_at: string | null;
        recipient_count: number;
        excluded_count: number;
    }[];
    messages: { id: string; broadcast_id: string; status: string }[];
    audits: { action: string; entity_id: string; performed_by: string | null }[];
}
export interface PlanEvidence {
    business: {
        id: string;
        plan: string;
        plan_status: string;
        trial_ends_at: string;
        stripe_account_id: string | null;
        stripe_subscription_id: string | null;
    };
    staff: { id: string; role: string; status: string; invited: boolean; email: string | null }[];
    audits: { action: string; entity_type: string; performed_by: string | null }[];
}

async function observe<T>(...args: string[]): Promise<T> {
    const { stdout } = await execute(
        "uv",
        ["run", "python", "-m", "e2e.actions", "outreach", ...args],
        {
            cwd: fileURLToPath(new URL("../../../../../backend", import.meta.url)),
            timeout: 30_000,
        },
    );
    return JSON.parse(stdout) as T;
}
export const clientOutreach = (...ids: string[]) => observe<ClientOutreach>("clients", ...ids);
export const prefsLink = async (id: string): Promise<string> => {
    const found = await observe<ClientOutreach>("clients", id, "--prefs");
    const link = found.prefs?.[id];
    if (!link) throw new Error("The observer returned no preferences link");
    return link;
};
export const webhookRows = async (...ids: string[]) =>
    (await observe<{ webhooks: WebhookRow[] }>("webhooks", ...ids)).webhooks;
export const deliveryRows = async (prefix: string) =>
    (await observe<{ deliveries: DeliveryRow[] }>("deliveries", prefix)).deliveries;
export const broadcastEvidence = (...ids: string[]) =>
    observe<BroadcastEvidence>("broadcasts", ...ids);
export const planEvidence = (businessId: string) => observe<PlanEvidence>("plan", businessId);

export function apiBase(): string {
    return runUrl("VITE_API_URL");
}

export function mailpitBase(): string {
    return runUrl("MAILPIT_URL");
}

export function headers(page: Page): Record<string, string> {
    return { "Idempotency-Key": randomUUID(), Origin: new URL(page.url()).origin };
}

export function freshPhone(): string {
    // NANP exchanges 200 to 999 except 555, which the product reserves for fiction
    let exchange = randomInt(200, 1000);
    if (exchange === 555) exchange = 556;
    return `+1250${String(exchange)}${String(randomInt(0, 10_000)).padStart(4, "0")}`;
}

export async function createContact(
    page: Page,
    input: {
        name?: string;
        email?: string;
        phone?: string;
        consent?: boolean;
        tags?: string[];
    } = {},
): Promise<Contact> {
    const run = randomUUID();
    const contact = {
        name: input.name ?? demoPerson(run),
        email: input.email ?? runEmail(`outreach-${run}@example.ca`),
        phone: input.phone ?? freshPhone(),
    };
    const response = await page.request.post(`${apiBase()}/v1/clients`, {
        data: {
            ...contact,
            marketing_consent: input.consent ?? false,
            ...(input.tags ? { tags: input.tags } : {}),
        },
        headers: headers(page),
    });
    expect(response.status(), await response.text()).toBe(201);
    return { ...contact, id: ((await response.json()) as { id: string }).id };
}

function twilioSignature(token: string, url: string, form: Record<string, string>) {
    const payload =
        url +
        Object.keys(form)
            .sort()
            .map((name) => name + (form[name] ?? ""))
            .join("");
    return createHmac("sha1", token).update(payload).digest("base64");
}

export interface InboundSms {
    from: string;
    to: string;
    body: string;
    sid?: string | null;
}

export async function postInboundSms(
    request: APIRequestContext,
    sms: InboundSms,
    signing: "valid" | "wrong" | "missing" = "valid",
): Promise<{ response: APIResponse; sid: string | null }> {
    const token = runSetting("TWILIO_AUTH_TOKEN");
    const base = runUrl("API_BASE_URL");
    const sid = sms.sid === undefined ? `SM${randomUUID().replaceAll("-", "")}` : sms.sid;
    const form: Record<string, string> = { From: sms.from, To: sms.to, Body: sms.body };
    if (sid !== null) form.MessageSid = sid;
    const url = `${base.replace(/\/$/, "")}/webhooks/sms`;
    const signature =
        signing === "valid"
            ? twilioSignature(token, url, form)
            : twilioSignature(`${token}x`, url, form);
    const response = await request.post(`${apiBase()}/webhooks/sms`, {
        form,
        headers: signing === "missing" ? {} : { "X-Twilio-Signature": signature },
    });
    return { response, sid };
}

export interface EmailEvent {
    type: string;
    created_at?: string;
    data: {
        email_id?: string;
        to?: string[];
        tags?: Record<string, string>;
        bounce?: { type: string; subType: string; message: string };
    };
}

export async function postEmailEvent(
    request: APIRequestContext,
    event: EmailEvent,
    options: { id?: string; at?: Date; signing?: "valid" | "wrong" } = {},
): Promise<{ response: APIResponse; id: string }> {
    const secret = runSetting("RESEND_WEBHOOK_SECRET");
    const id = options.id ?? `msg_${randomUUID().replaceAll("-", "")}`;
    const timestamp = String(Math.floor((options.at ?? new Date()).getTime() / 1000));
    const body = JSON.stringify(event);
    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const signed = createHmac("sha256", options.signing === "wrong" ? Buffer.from("x") : key)
        .update(`${id}.${timestamp}.${body}`)
        .digest("base64");
    const response = await request.post(`${apiBase()}/webhooks/email`, {
        data: body,
        headers: {
            "Content-Type": "application/json",
            "svix-id": id,
            "svix-timestamp": timestamp,
            "svix-signature": `v1,${signed}`,
        },
    });
    return { response, id };
}

// The worker's send_deliveries cron fires at second 15 of every minute (tasks/worker.py).
export async function awayFromDeliveryTick(): Promise<void> {
    for (;;) {
        const second = new Date().getUTCSeconds();
        if (second >= 20 && second < 50) return;
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
}

export async function scheduleBroadcast(
    page: Page,
    input: { name: string; tag: string; body: string; recipients: number; matched: number },
) {
    const b = strings.broadcasts;
    await navigate(page, "/today");
    await navigate(page, "/inbox?segment=broadcasts");
    await page.getByRole("button", { name: b.newBroadcast, exact: true }).first().click();
    await page.getByRole("textbox", { name: b.nameLabel }).fill(input.name);
    await page
        .getByRole("group", { name: b.channelPick, exact: true })
        .getByRole("button", { name: b.channels.email, exact: true })
        .click();
    await page
        .getByRole("button", { name: b.tagChip(input.tag, input.matched), exact: true })
        .click({ timeout: 60_000 });
    await page.getByRole("textbox", { name: b.messageLabel }).fill(input.body);
    await page
        .getByRole("group", { name: b.whenLabel, exact: true })
        .getByRole("button", { name: b.sendLater, exact: true })
        .click();
    await page.getByRole("button", { name: strings.ui.dateTimeDay(b.sendAtLabel) }).click();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(page.getByText(b.matched(input.matched), { exact: false })).toBeVisible();
    const submitted = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/v1/broadcasts" && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: b.scheduleFor(input.recipients), exact: true }).click();
    const response = await submitted;
    expect(response.status(), await response.text()).toBe(200);
    await expect(page.getByRole("heading", { name: b.scheduledTitle, exact: true })).toBeVisible();
    await page.getByRole("button", { name: b.sentDone, exact: true }).click();
    return (await response.json()) as {
        id: string;
        status: string;
        scheduled_at: string | null;
        recipient_count: number;
        excluded_count: number;
    };
}

export async function cancelScheduledBroadcast(page: Page, name: string) {
    const b = strings.broadcasts;
    await page.getByRole("button").filter({ hasText: name }).first().click({ timeout: 60_000 });
    await page.getByRole("button", { name: b.cancelSchedule, exact: true }).first().click();
    const canceled = page.waitForResponse(
        (r) =>
            /^\/v1\/broadcasts\/[^/]+\/cancel$/.test(new URL(r.url()).pathname) &&
            r.request().method() === "POST",
    );
    await page
        .getByRole("dialog", { name: b.cancelScheduleTitle, exact: true })
        .getByRole("button", { name: b.cancelSchedule, exact: true })
        .click();
    return canceled;
}
