import { createHmac, randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";

const API = process.env.VITE_API_URL ?? "http://localhost:8701";
const AUTH = process.env.VITE_AUTH_URL ?? "http://localhost:8713";
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8715";
const AUTH_ADMIN = process.env.AUTH_ADMIN_URL ?? "http://localhost:8714";

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
    return mailed(request, email, subject, (text) => {
        const code = /\b(\d{6})\b/.exec(text)?.[1];
        return code !== previous ? code : undefined;
    });
}

/** The code mailed for one verification flow, whichever other codes reached `email`. */
export async function mailedCodeForFlow(
    request: APIRequestContext,
    email: string,
    flowId: string,
): Promise<string> {
    return mailed(request, email, "verification", (text) =>
        text.includes(`flow=${flowId}`) ? /\b(\d{6})\b/.exec(text)?.[1] : undefined,
    );
}

/** The verification link in the newest verification email to `email`. */
export async function mailedVerificationLink(
    request: APIRequestContext,
    email: string,
): Promise<string> {
    return mailed(request, email, "verification", (text) => /https?:\/\/\S+/.exec(text)?.[0]);
}

async function mailed(
    request: APIRequestContext,
    email: string,
    subject: string,
    pick: (text: string) => string | undefined,
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
            const value = pick(message.Text);
            if (value) return value;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`nothing mailed to ${email}`);
}

/** Deletes the auth identity behind `email`, as an operator would; its sessions die with it. */
export async function deleteIdentity(request: APIRequestContext, email: string): Promise<void> {
    const found = (await (
        await request.get(`${AUTH_ADMIN}/admin/identities`, {
            params: { credentials_identifier: email },
        })
    ).json()) as { id: string }[];
    for (const identity of found)
        await request.delete(`${AUTH_ADMIN}/admin/identities/${identity.id}`);
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
    const flow = (await (await request.get(`${AUTH}/self-service/login/api`)).json()) as {
        id: string;
    };
    const login = (await (
        await request.post(`${AUTH}/self-service/login?flow=${flow.id}`, {
            data: { method: "password", identifier: email, password },
        })
    ).json()) as { session_token: string };
    return login.session_token;
}

export async function sessionActive(request: APIRequestContext, token: string): Promise<boolean> {
    const res = await request.get(`${AUTH}/sessions/whoami`, {
        headers: { "X-Session-Token": token },
    });
    return res.ok();
}

async function asOwner(request: APIRequestContext): Promise<Record<string, string>> {
    const token = await nativeSession(request, "hannah@birchbark.example", "demo1234");
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
            // a joined invitee is removed too, so later tests see only the seeded team
            const revoked = await request.post(`${API}/v1/staff/invites/${invite.id}/revoke`, {
                headers,
            });
            if (revoked.ok()) return;
            const removed = await request.post(`${API}/v1/staff/${invite.id}/remove`, {
                data: {},
                headers,
            });
            if (!removed.ok())
                throw new Error(`could not remove ${email}: ${await removed.text()}`);
        },
    };
}
