import { strings } from "@clientbridge/app-core/public";
import { expect, type Page } from "@playwright/test";
import { select } from "./db";
import { type DocumentClient } from "./billing";

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

function rows<T extends object>(kind: "form" | "contract" | "estimate", id: string): Promise<T[]> {
    if (kind === "form")
        return select<T>`
            SELECT id, status, answers, signature, definition, submitted_at::text
            FROM responses WHERE id = ${id}`;
    if (kind === "contract")
        return select<T>`
            SELECT id, status, signed_body, contract_version, signer_name, method, strokes,
                signed_at::text
            FROM signatures WHERE id = ${id}`;
    return select<T>`
        SELECT e.id, e.status, e.subtotal_cents, e.tax_total_cents, e.total_cents,
            e.accepted_at::text,
            (SELECT json_agg(json_build_object('description', l.description,
                'optional', l.optional, 'selected', l.selected, 'amount_cents', l.amount_cents,
                'sale_discount_cents', l.sale_discount_cents,
                'tax_amount_cents', l.tax_amount_cents) ORDER BY l.position)
            FROM lines l WHERE l.estimate_id = e.id) AS lines
        FROM estimates e WHERE e.id = ${id}`;
}

/** The one committed form response, contract signature or estimate with this id. */
export async function committed<T extends object>(
    kind: "form" | "contract" | "estimate",
    id: string,
): Promise<T> {
    const found = await rows<T>(kind, id);
    expect(found).toHaveLength(1);
    const row = found[0];
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
