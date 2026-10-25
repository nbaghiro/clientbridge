import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { demoPerson } from "@clientbridge/config/e2e/demo";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, type APIRequestContext } from "@playwright/test";

const execute = promisify(execFile);
export const documentApi = process.env.VITE_API_URL ?? "http://localhost:8701";
const auth = process.env.VITE_AUTH_URL ?? "http://localhost:8713";

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

async function committed(kind: string, id?: string): Promise<string> {
    const { stdout } = await execute(
        "uv",
        ["run", "python", "-m", "scripts.e2e_documents", kind, ...(id ? [id] : [])],
        { cwd: fileURLToPath(new URL("../../../../backend", import.meta.url)), timeout: 30_000 },
    );
    return stdout;
}

export async function formEvidence(id: string): Promise<FormEvidence> {
    const rows = JSON.parse(await committed("form", id)) as FormEvidence[];
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (!row) throw new Error("committed form response is missing");
    return row;
}

export async function contractEvidence(id: string): Promise<ContractEvidence> {
    const rows = JSON.parse(await committed("contract", id)) as ContractEvidence[];
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (!row) throw new Error("committed signature is missing");
    return row;
}

export async function documentProvider(request: APIRequestContext) {
    for (const url of [documentApi, auth]) {
        if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
            throw new Error("document e2e requires local API, authentication and SMTP");
        }
    }
    await committed("check");
    const flowResponse = await request.get(`${auth}/self-service/login/api`);
    expect(flowResponse.status()).toBe(200);
    const flow = (await flowResponse.json()) as { id: string };
    const login = await request.post(`${auth}/self-service/login?flow=${flow.id}`, {
        data: {
            method: "password",
            identifier: "hannah@birchbark.example",
            password: "demo1234",
        },
    });
    expect(login.status()).toBe(200);
    const session = (await login.json()) as { session_token: string };
    const headers = {
        "X-Session-Token": session.session_token,
        "X-Business-Id": "bz_birchbark",
    };
    const name = demoPerson(randomUUID());
    const clientResponse = await request.post(`${documentApi}/v1/clients`, {
        headers: { ...headers, "Idempotency-Key": randomUUID() },
        data: { name, email: `document-${randomUUID()}@example.ca`, preferred_channel: "email" },
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
