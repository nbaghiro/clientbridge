import { execFile } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { APIRequestContext } from "@playwright/test";
import { demoPhone, runSetting, runUrl } from "@clientbridge/config/e2e/run";

const execute = promisify(execFile);
const api = () => runUrl("VITE_API_URL");

export const BIRCHBARK_NUMBER = demoPhone("+12365550190");

export interface CommunicationEvidence {
    threads: { id: string; channel: string }[];
    messages: {
        id: string;
        thread_id: string;
        direction: string;
        channel: string;
        body: string | null;
        status: string;
        provider_ref: string | null;
    }[];
    consents: { channel: string; status: string; source: string }[];
    deliveries: {
        id: string;
        channel: string;
        state: string;
        error: string | null;
        provider_ref: string | null;
        scope: string;
        recipient: string;
    }[];
    webhooks: {
        id: string;
        provider: string;
        event: string;
        status: string;
        payload: Record<string, unknown>;
    }[];
}

export async function communicationEvidence(
    clientId: string,
    webhooks: string[] = [],
): Promise<CommunicationEvidence> {
    const { stdout } = await execute(
        "uv",
        [
            "run",
            "python",
            "-m",
            "scripts.e2e_communication",
            clientId,
            ...webhooks.flatMap((id) => ["--webhook", id]),
        ],
        {
            cwd: fileURLToPath(new URL("../../../../../backend", import.meta.url)),
            timeout: 30_000,
        },
    );
    return JSON.parse(stdout) as CommunicationEvidence;
}

/** A North American number outside the 555-01xx range the app treats as fiction. */
export function clientPhone(): string {
    const digits = Array.from({ length: 7 }, () => Math.floor(Math.random() * 10)).join("");
    return `+1778${digits.startsWith("55501") ? `6${digits.slice(1)}` : digits}`;
}

/** Posts an inbound text the way Twilio signs it, for the run's own auth token. */
export async function inboundText(
    request: APIRequestContext,
    message: { from: string; body: string; to?: string; sid?: string; signature?: string },
): Promise<{ sid: string; status: number }> {
    const sid = message.sid ?? `SM${randomUUID().replaceAll("-", "")}`;
    const params: [string, string][] = [
        ["MessageSid", sid],
        ["From", message.from],
        ["To", message.to ?? BIRCHBARK_NUMBER],
        ["Body", message.body],
    ];
    const url = `${runUrl("API_BASE_URL")}/webhooks/sms`;
    const signed = [...params]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .reduce((text, [name, value]) => text + name + value, url);
    const signature =
        message.signature ??
        createHmac("sha1", runSetting("TWILIO_AUTH_TOKEN")).update(signed).digest("base64");
    const response = await request.post(`${api()}/webhooks/sms`, {
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Twilio-Signature": signature,
        },
        data: new URLSearchParams(params).toString(),
    });
    return { sid, status: response.status() };
}

export interface EmailEvent {
    type: "email.sent" | "email.delivered" | "email.bounced";
    emailId: string;
    to: string;
    tags: Record<string, string>;
}

/** Posts a Resend event with a Svix signature from the run's webhook secret. */
export async function emailEvent(
    request: APIRequestContext,
    event: EmailEvent,
    options: { id?: string; forged?: boolean; body?: string } = {},
): Promise<{ id: string; status: number }> {
    const id = options.id ?? `msg_${randomUUID().replaceAll("-", "")}`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body =
        options.body ??
        JSON.stringify({
            type: event.type,
            created_at: new Date().toISOString(),
            data: {
                email_id: event.emailId,
                to: [event.to],
                tags: event.tags,
                ...(event.type === "email.bounced"
                    ? { bounce: { type: "Permanent", subType: "General", message: "" } }
                    : {}),
            },
        });
    const key = Buffer.from(
        options.forged
            ? Buffer.from(randomUUID()).toString("base64")
            : runSetting("RESEND_WEBHOOK_SECRET").replace(/^whsec_/, ""),
        "base64",
    );
    const signature = createHmac("sha256", key)
        .update(`${id}.${timestamp}.${body}`)
        .digest("base64");
    const response = await request.post(`${api()}/webhooks/email`, {
        headers: {
            "Content-Type": "application/json",
            "svix-id": id,
            "svix-timestamp": timestamp,
            "svix-signature": `v1,${signature}`,
        },
        data: body,
    });
    return { id, status: response.status() };
}
