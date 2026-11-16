import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { formatPhone, strings } from "@clientbridge/app-core/public";
import { runUrl } from "@clientbridge/config/e2e/run";
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
    await dialog.getByRole("combobox", { name: f.client, exact: true }).fill(client.name);
    await page
        .getByRole("option")
        .filter({ has: page.getByText(client.name, { exact: true }) })
        .click();
    await dialog.getByRole("button", { name: f.sendLink, exact: true }).click();
    // nothing leaves until the owner checks what the client will get
    const review = page.getByRole("dialog", { name: strings.previews.title, exact: true });
    await expect(review).toContainText(formatPhone(client.phone));
    const sending = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === path && response.request().method() === "POST",
    );
    await review.getByRole("button", { name: strings.previews.send, exact: true }).click();
    const sent = await sending;
    expect(sent.status(), await sent.text()).toBe(201);
    await expect(dialog.getByText(f.sent(client.name), { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: f.done, exact: true }).click();
    return (await sent.json()) as { id: string; token: string };
}

export interface SavedFormQuestion {
    input: string;
    label: string;
    required: boolean;
    options: string[];
}

/** Saves a form as the signed-in owner, with the body the phone's form editor sends. */
export async function saveForm(
    page: Page,
    name: string,
    questions: SavedFormQuestion[],
): Promise<{ id: string }> {
    const saved = await page.request.post(`${runUrl("VITE_API_URL")}/v1/forms`, {
        data: {
            name,
            require_signature: true,
            send_on: "booking",
            active: true,
            fields: questions.map((q) => ({ ...q, help: null })),
        },
        headers: { "Idempotency-Key": randomUUID(), Origin: new URL(page.url()).origin },
    });
    expect(saved.status(), await saved.text()).toBe(201);
    return (await saved.json()) as { id: string };
}

/** Runs the intake-form job as the run's worker would, for this case's form and client only. */
export async function runIntake(formId: string, clientId: string): Promise<number> {
    const { stdout } = await promisify(execFile)(
        "uv",
        ["run", "python", "-m", "e2e.actions", "intake", formId, clientId],
        {
            cwd: fileURLToPath(new URL("../../../../../backend", import.meta.url)),
            timeout: 60_000,
        },
    );
    return (JSON.parse(stdout) as { issued: number }).issued;
}

/** The responses a form has for one client: its id, link token and where it stands. */
export function formResponses(
    formId: string,
    clientId: string,
): Promise<{ id: string; token: string; status: string; parent_type: string | null }[]> {
    return select`
        SELECT id, token, status, parent_type FROM responses
        WHERE form_id = ${formId} AND client_id = ${clientId} ORDER BY created_at`;
}
