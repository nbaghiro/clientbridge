import { createHmac, randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { demoPhone, runSetting, runUrl } from "@clientbridge/config/e2e/run";
import { select } from "./db";

const api = () => runUrl("VITE_API_URL");

const BIRCHBARK_NUMBER = demoPhone("+12365550190");

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
    type Evidence = CommunicationEvidence;
    return {
        threads: await select<Evidence["threads"][number]>`
            SELECT id, channel FROM threads WHERE client_id = ${clientId} ORDER BY id`,
        messages: await select<Evidence["messages"][number]>`
            SELECT m.id, m.thread_id, m.direction, m.channel, m.body, m.status, m.provider_ref
            FROM messages m JOIN threads t ON t.id = m.thread_id
            WHERE t.client_id = ${clientId} ORDER BY m.created_at, m.id`,
        consents: await select<Evidence["consents"][number]>`
            SELECT channel, status, source FROM consents WHERE client_id = ${clientId}
            ORDER BY created_at, id`,
        deliveries: await select<Evidence["deliveries"][number]>`
            SELECT d.id, d.payload->>'channel' AS channel, d.state, d.error, d.provider_ref,
                regexp_replace(d.key, ':[0-9a-f]{64}$', '') AS scope,
                d.payload->'message'->>'to' AS recipient
            FROM deliveries d JOIN clients c ON c.id = ${clientId}
                AND d.business_id = c.business_id
                AND d.payload->'message'->>'to' IN (c.email, c.phone)
            ORDER BY d.created_at, d.id`,
        webhooks: await select<Evidence["webhooks"][number]>`
            SELECT id, provider, event, status, payload FROM webhooks
            WHERE id = ANY(${webhooks}::text[]) ORDER BY id`,
    };
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
        // a Buffer goes out byte for byte; Playwright would quote a string that isn't JSON
        data: Buffer.from(body),
    });
    return { id, status: response.status() };
}
