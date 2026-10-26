import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, type APIRequestContext } from "@playwright/test";
import { runUrl } from "@clientbridge/config/e2e/run";

const execute = promisify(execFile);

export interface PaymentEvidence {
    deliveries: { id: string; state: string }[];
    payments: {
        id: string;
        amount_cents: number;
        status: string;
        method: string;
        provider: string;
    }[];
    entries: {
        journal_id: string;
        event: string;
        amount_cents: number;
        category: string;
        source_id: string;
    }[];
}

export async function paymentEvidence(invoiceId: string): Promise<PaymentEvidence> {
    const { stdout } = await execute(
        "uv",
        ["run", "python", "-m", "scripts.e2e_evidence", invoiceId],
        {
            cwd: fileURLToPath(new URL("../../../../../backend", import.meta.url)),
            timeout: 30_000,
        },
    );
    return JSON.parse(stdout) as PaymentEvidence;
}

export async function receiptMessages(
    request: APIRequestContext,
    email: string,
): Promise<{ ID: string; Subject: string; Snippet: string }[]> {
    const base = runUrl("MAILPIT_URL");
    const response = await request.get(`${base}/api/v1/search`, {
        params: { query: `to:${email} subject:receipt`, limit: 100 },
    });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
        messages: { ID: string; Subject: string; Snippet: string }[];
    };
    return body.messages;
}

export async function requireLocalMail(): Promise<void> {
    await execute("uv", ["run", "python", "-m", "scripts.e2e_evidence", "--check-local-mail"], {
        cwd: fileURLToPath(new URL("../../../../../backend", import.meta.url)),
        timeout: 30_000,
    });
}
