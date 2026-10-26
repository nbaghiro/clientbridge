import { execFile } from "node:child_process";
import { createHmac, randomInt, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { demoPerson } from "@clientbridge/config/e2e/demo";
import { strings } from "@clientbridge/app-core/public";
import { expect, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";
import { navigate } from "./session";
import { demoPhone, runEmail, runSetting, runUrl } from "@clientbridge/config/e2e/run";

const execute = promisify(execFile);
export const BIRCHBARK_SMS = demoPhone("+12365550190");
export const CEDAR_SMS = demoPhone("+16045550199");

export interface Contact {
    id: string;
    name: string;
    email: string;
    phone: string;
}
export interface ThreadRow {
    id: string;
    business_id: string;
    client_id: string;
    channel: string;
    status: string;
}
export interface MessageRow {
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
export interface ConsentRow {
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

export function twilioSignature(token: string, url: string, form: Record<string, string>) {
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
        .getByRole("alertdialog")
        .or(page.getByRole("dialog"))
        .getByRole("button", { name: b.cancelSchedule, exact: true })
        .click();
    return canceled;
}
