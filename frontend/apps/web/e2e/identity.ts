import { createHmac, randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";

const API = process.env.VITE_API_URL ?? "http://localhost:8701";
const KRATOS = process.env.VITE_KRATOS_URL ?? "http://localhost:8713";
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8715";

export function newAccount(prefix: string): { email: string; password: string; name: string } {
    const id = randomUUID().slice(0, 8);
    return {
        email: `${prefix}-${id}@example.com`,
        password: `Plum-${randomUUID()}`,
        name: `E2E ${prefix}`,
    };
}

/** The newest code mailed to `email` whose subject mentions `subject`, other than `previous`. */
export async function mailedCode(
    request: APIRequestContext,
    email: string,
    subject: string,
    previous?: string,
): Promise<string> {
    for (let attempt = 0; attempt < 40; attempt++) {
        const search = await request.get(`${MAILPIT}/api/v1/search`, {
            params: { query: `to:"${email}" subject:"${subject}"` },
        });
        const found = (await search.json()) as { messages?: { ID: string }[] };
        const id = found.messages?.[0]?.ID;
        if (id) {
            const message = (await (
                await request.get(`${MAILPIT}/api/v1/message/${id}`)
            ).json()) as {
                Text: string;
            };
            const code = /\b(\d{6})\b/.exec(message.Text)?.[1];
            if (code && code !== previous) return code;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`no code mailed to ${email}`);
}

/** RFC 6238, as an authenticator app computes it from the base32 secret. */
export function totp(secret: string, at = Date.now()): string {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = "";
    for (const ch of secret.replace(/=+$/, "").toUpperCase())
        bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
    const key = Buffer.from(bits.match(/.{8}/g)?.map((b) => parseInt(b, 2)) ?? []);
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
    const hmac = createHmac("sha1", key).update(counter).digest();
    const offset = (hmac[hmac.length - 1] ?? 0) & 0xf;
    const value = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
    return value.toString().padStart(6, "0");
}

/** A session token from a native sign-in, as a second device (the mobile app) would hold. */
export async function nativeSession(
    request: APIRequestContext,
    email: string,
    password: string,
): Promise<string> {
    const flow = (await (await request.get(`${KRATOS}/self-service/login/api`)).json()) as {
        id: string;
    };
    const login = (await (
        await request.post(`${KRATOS}/self-service/login?flow=${flow.id}`, {
            data: { method: "password", identifier: email, password },
        })
    ).json()) as { session_token: string };
    return login.session_token;
}

export async function sessionActive(request: APIRequestContext, token: string): Promise<boolean> {
    const res = await request.get(`${KRATOS}/sessions/whoami`, {
        headers: { "X-Session-Token": token },
    });
    return res.ok();
}

async function asOwner(request: APIRequestContext): Promise<Record<string, string>> {
    const token = await nativeSession(request, "hannah@birchbarkpets.ca", "demo1234");
    return { "X-Session-Token": token, "X-Business-Id": "bz_birchbark" };
}

/** Invites `email` to the demo business; `cleanup` removes the member or revokes the invite. */
export async function ownerInvite(
    request: APIRequestContext,
    email: string,
): Promise<{ token: string; cleanup: () => Promise<void> }> {
    const headers = await asOwner(request);
    const invite = (await (
        await request.post(`${API}/v1/staff/invites`, { data: { email, role: "staff" }, headers })
    ).json()) as { id: string; invite_token: string };
    return {
        token: invite.invite_token,
        cleanup: async () => {
            const removed = await request.delete(`${API}/v1/staff/${invite.id}`, { headers });
            if (!removed.ok())
                await request.post(`${API}/v1/staff/invites/${invite.id}/revoke`, { headers });
        },
    };
}
