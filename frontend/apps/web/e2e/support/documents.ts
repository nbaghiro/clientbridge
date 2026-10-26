import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { strings } from "@clientbridge/app-core/public";
import { expect, type Page } from "@playwright/test";

import { type DocumentClient } from "./invoices";

const execute = promisify(execFile);

export interface FormEvidence {
    id: string;
    status: string;
    answers: Record<string, unknown>;
    signature: { name: string; ip: string } | null;
    definition: {
        name: string;
        require_signature: boolean;
        fields: { name: string; label: string; input: string; required: boolean }[];
    };
    submitted_at: string | null;
}

export interface SignatureEvidence {
    id: string;
    status: string;
    signed_body: string | null;
    contract_version: number | null;
    signer_name: string | null;
    method: string | null;
    signed_at: string | null;
}

async function committed<T>(kind: "form" | "contract", id: string): Promise<T> {
    const { stdout } = await execute(
        "uv",
        ["run", "python", "-m", "scripts.e2e_documents", kind, id],
        {
            cwd: fileURLToPath(new URL("../../../../../backend", import.meta.url)),
            timeout: 30_000,
        },
    );
    const rows = JSON.parse(stdout) as T[];
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (row === undefined) throw new Error(`committed ${kind} is missing`);
    return row;
}

export function formEvidence(id: string): Promise<FormEvidence> {
    return committed<FormEvidence>("form", id);
}

export function signatureEvidence(id: string): Promise<SignatureEvidence> {
    return committed<SignatureEvidence>("contract", id);
}

/** Sends the open form or contract to one client from the send dialog, returning the request. */
export async function sendToClient(
    page: Page,
    action: string,
    path: "/v1/forms/send" | "/v1/contracts/send",
    client: DocumentClient,
): Promise<{ id: string; token: string }> {
    const f = strings.forms;
    await page.getByRole("button", { name: action, exact: true }).click();
    const dialog = page.getByRole("dialog").filter({ hasText: f.sendBody });
    await dialog.getByRole("combobox", { name: f.client, exact: true }).fill(client.email);
    await page
        .getByRole("option")
        .filter({ has: page.getByText(client.name, { exact: true }) })
        .click();
    const sending = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === path && response.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: f.sendLink, exact: true }).click();
    const sent = await sending;
    expect(sent.status(), await sent.text()).toBe(201);
    await expect(dialog.getByText(f.sent(client.name), { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: f.done, exact: true }).click();
    return (await sent.json()) as { id: string; token: string };
}
