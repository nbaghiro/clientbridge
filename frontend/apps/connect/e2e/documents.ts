import { randomUUID } from "node:crypto";
import { demoPerson } from "@clientbridge/config/e2e/demo";
import { expect, type APIRequestContext } from "@playwright/test";
import { demoId, runEmail, runUrl } from "@clientbridge/config/e2e/run";
import { committed } from "../../web/e2e/support/documents";
import { freshPhone } from "../../web/e2e/support/auth";
import { requireLocalMail } from "../../web/e2e/support/evidence";

export const documentApi = runUrl("VITE_API_URL");
const auth = runUrl("VITE_AUTH_URL");

export interface FormEvidence {
    id: string;
    status: string;
    answers: Record<string, unknown>;
    signature: { name: string; ip: string } | null;
    definition: { name: string; require_signature: boolean };
    submitted_at: string | null;
}

export interface ContractEvidence {
    id: string;
    status: string;
    signed_body: string | null;
    contract_version: number | null;
    signer_name: string | null;
    method: string | null;
    strokes: number[][][] | null;
    signed_at: string | null;
}

export interface EstimateEvidence {
    id: string;
    status: string;
    subtotal_cents: number;
    tax_total_cents: number;
    total_cents: number;
    accepted_at: string | null;
    lines: {
        description: string;
        optional: boolean;
        selected: boolean;
        amount_cents: number;
        sale_discount_cents: number;
        tax_amount_cents: number;
    }[];
}

export function formEvidence(id: string): Promise<FormEvidence> {
    return committed<FormEvidence>("form", id);
}

export function contractEvidence(id: string): Promise<ContractEvidence> {
    return committed<ContractEvidence>("contract", id);
}

export function estimateEvidence(id: string): Promise<EstimateEvidence> {
    return committed<EstimateEvidence>("estimate", id);
}

export async function documentProvider(request: APIRequestContext) {
    for (const url of [documentApi, auth]) {
        if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
            throw new Error("document e2e requires local API, authentication and SMTP");
        }
    }
    requireLocalMail();
    const flowResponse = await request.get(`${auth}/self-service/login/api`);
    expect(flowResponse.status()).toBe(200);
    const flow = (await flowResponse.json()) as { id: string };
    const login = await request.post(`${auth}/self-service/login?flow=${flow.id}`, {
        data: {
            method: "password",
            identifier: runEmail("hannah@birchbark.example"),
            password: "demo1234",
        },
    });
    expect(login.status()).toBe(200);
    const session = (await login.json()) as { session_token: string };
    const headers = {
        "X-Session-Token": session.session_token,
        "X-Business-Id": demoId("bz_birchbark"),
    };
    const name = demoPerson(randomUUID());
    const clientResponse = await request.post(`${documentApi}/v1/clients`, {
        headers: { ...headers, "Idempotency-Key": randomUUID() },
        data: {
            name,
            phone: freshPhone(),
        },
    });
    expect(clientResponse.status(), await clientResponse.text()).toBe(201);
    const client = (await clientResponse.json()) as { id: string };
    return { headers, name, clientId: client.id };
}

export async function issueForm(request: APIRequestContext) {
    const provider = await documentProvider(request);
    const name = `Pet care intake — ${provider.name}`;
    const definition = {
        name,
        require_signature: true,
        fields: [{ input: "text", label: "Care instructions", required: true }],
    };
    const created = await request.post(`${documentApi}/v1/forms`, {
        headers: { ...provider.headers, "Idempotency-Key": randomUUID() },
        data: definition,
    });
    expect(created.status(), await created.text()).toBe(201);
    const form = (await created.json()) as { id: string; fields: { name: string }[] };
    const sent = await request.post(`${documentApi}/v1/forms/send`, {
        headers: { ...provider.headers, "Idempotency-Key": randomUUID() },
        data: { form_id: form.id, client_id: provider.clientId },
    });
    expect(sent.status(), await sent.text()).toBe(201);
    const response = (await sent.json()) as { id: string; token: string };
    const field = form.fields[0];
    if (!field) throw new Error("issued form has no answer field");
    return { ...provider, ...response, formId: form.id, field: field.name, definition };
}

export async function issueContract(request: APIRequestContext) {
    const provider = await documentProvider(request);
    const name = `Grooming agreement — ${provider.name}`;
    const body =
        "Grooming care agreement\nWe use gentle handling and fragrance-free products when requested.";
    const created = await request.post(`${documentApi}/v1/contracts`, {
        headers: { ...provider.headers, "Idempotency-Key": randomUUID() },
        data: { name, body },
    });
    expect(created.status(), await created.text()).toBe(201);
    const contract = (await created.json()) as { id: string; version: number };
    const sent = await request.post(`${documentApi}/v1/contracts/send`, {
        headers: { ...provider.headers, "Idempotency-Key": randomUUID() },
        data: { contract_id: contract.id, client_id: provider.clientId },
    });
    expect(sent.status(), await sent.text()).toBe(201);
    const signature = (await sent.json()) as { id: string; token: string };
    return { ...provider, ...signature, contractId: contract.id, version: contract.version, body };
}

// two $100 GST-only lines, the second an optional add-on, with 10% off the whole estimate
export async function issueEstimate(request: APIRequestContext) {
    const provider = await documentProvider(request);
    const line = (description: string, optional: boolean) => ({
        description,
        quantity: 1,
        unit_amount_cents: 10000,
        tax_class: "federal_only",
        optional,
    });
    const created = await request.post(`${documentApi}/v1/estimates`, {
        headers: { ...provider.headers, "Idempotency-Key": randomUUID() },
        data: {
            client_id: provider.clientId,
            lines: [line("Full groom", false), line("De-shedding treatment", true)],
            discount: { kind: "percent", value: 10, reason: "Returning client" },
            send: true,
        },
    });
    expect(created.status(), await created.text()).toBe(201);
    const estimate = (await created.json()) as { id: string; view_token: string };
    return { ...provider, id: estimate.id, token: estimate.view_token };
}
