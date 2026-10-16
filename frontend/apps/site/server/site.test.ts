import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { type ContactMessage, createSite, type Joined } from "./site.ts";

const dist = mkdtempSync(join(tmpdir(), "site-dist-"));
mkdirSync(join(dist, "pricing"));
mkdirSync(join(dist, "assets"));
writeFileSync(join(dist, "index.html"), "home");
writeFileSync(join(dist, "pricing", "index.html"), "pricing");
writeFileSync(join(dist, "404.html"), "missing");
writeFileSync(join(dist, "assets", "site.css"), "body{}");
writeFileSync(join(tmpdir(), "outside.txt"), "secret");

const servers: { close: () => void }[] = [];
afterEach(() => {
    for (const s of servers.splice(0)) s.close();
});

async function start(options: { joined?: Joined; perAddress?: number } = {}) {
    const emails: string[] = [];
    const confirmed: string[] = [];
    const messages: ContactMessage[] = [];
    const server = createSite({
        dist,
        siteUrl: "https://clientbridge.ca",
        join: (email) => {
            emails.push(email);
            return Promise.resolve(options.joined ?? "added");
        },
        contact: (message) => {
            messages.push(message);
            return Promise.resolve();
        },
        confirm: (email, joined) => {
            confirmed.push(`${joined}:${email}`);
            return Promise.resolve();
        },
        ...(options.perAddress === undefined ? {} : { perAddress: options.perAddress }),
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    servers.push(server);
    const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    const signUp = (body: string, headers: Record<string, string> = {}) =>
        fetch(`${base}/waitlist`, {
            method: "POST",
            body,
            headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
            redirect: "manual",
        });
    const post = (path: string, body: string) =>
        fetch(`${base}${path}`, {
            method: "POST",
            body,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            redirect: "manual",
        });
    return { base, emails, confirmed, messages, post, signUp };
}

describe("pages", () => {
    it("serves clean URLs, files and the not-found page", async () => {
        const { base } = await start();
        const home = await fetch(`${base}/`);
        expect([home.status, await home.text()]).toEqual([200, "home"]);
        expect(home.headers.get("cache-control")).toBe("no-cache");
        expect(home.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
        for (const path of ["/pricing", "/pricing/"]) {
            expect(await (await fetch(`${base}${path}`)).text()).toBe("pricing");
        }
        const css = await fetch(`${base}/assets/site.css`);
        expect(css.headers.get("content-type")).toBe("text/css; charset=utf-8");
        expect(css.headers.get("cache-control")).toContain("immutable");
        const missing = await fetch(`${base}/nowhere`);
        expect([missing.status, await missing.text()]).toEqual([404, "missing"]);
        expect((await fetch(`${base}/health`)).status).toBe(200);
        expect(await (await fetch(`${base}/robots.txt`)).text()).toContain(
            "Sitemap: https://clientbridge.ca/sitemap.xml",
        );
    });

    it("never serves a file outside the build", async () => {
        const { base } = await start();
        for (const path of ["/../outside.txt", "/%2e%2e/outside.txt", "/..%2foutside.txt"]) {
            const res = await fetch(`${base}${path}`);
            expect(await res.text(), path).not.toBe("secret");
        }
    });

    it("refuses other methods", async () => {
        const { base } = await start();
        expect((await fetch(`${base}/pricing`, { method: "DELETE" })).status).toBe(405);
    });
});

describe("waitlist", () => {
    it("adds an address and thanks the visitor", async () => {
        const { emails, confirmed, signUp } = await start();
        const res = await signUp("email=+owner%40studio.ca+&website=");
        expect([res.status, res.headers.get("location")]).toEqual([303, "/waitlist/thanks"]);
        expect(emails).toEqual(["owner@studio.ca"]);
        expect(confirmed).toEqual(["added:owner@studio.ca"]);
    });

    it("tells an address already on the list that it is there, without adding it again", async () => {
        const { confirmed, signUp } = await start({ joined: "already" });
        const res = await signUp("email=owner%40studio.ca");
        expect(res.headers.get("location")).toBe("/waitlist/thanks");
        expect(confirmed).toEqual(["already:owner@studio.ca"]);
    });

    it("sends a malformed address, an oversized body or another type back to retry", async () => {
        const { emails, signUp } = await start();
        for (const [body, headers] of [
            ["email=not-an-address", {}],
            [`email=${"a".repeat(3000)}%40studio.ca`, {}],
            ["email=owner%40studio.ca", { "Content-Type": "text/plain" }],
        ] as const) {
            const res = await signUp(body, headers);
            expect(res.headers.get("location"), body.slice(0, 20)).toBe("/waitlist/retry");
        }
        expect(emails).toEqual([]);
    });

    it("thanks a bot that fills the hidden field without adding it", async () => {
        const { emails, signUp } = await start();
        const res = await signUp("email=bot%40spam.example&website=http%3A%2F%2Fspam");
        expect(res.headers.get("location")).toBe("/waitlist/thanks");
        expect(emails).toEqual([]);
    });

    it("limits sign-ups per address", async () => {
        const { emails, signUp } = await start({ perAddress: 2 });
        const from = { "X-Forwarded-For": "203.0.113.9, 10.0.0.1" };
        const locations = [];
        for (const n of [1, 2, 3]) {
            const res = await signUp(`email=owner${String(n)}%40studio.ca`, from);
            locations.push(res.headers.get("location"));
        }
        expect(locations).toEqual(["/waitlist/thanks", "/waitlist/thanks", "/waitlist/retry"]);
        const other = await signUp("email=other%40studio.ca", {
            "X-Forwarded-For": "203.0.113.10",
        });
        expect(other.headers.get("location")).toBe("/waitlist/thanks");
        expect(emails).toHaveLength(3);
    });

    it("sends the visitor to retry when Resend refuses the address", async () => {
        const { confirmed, signUp } = await start({ joined: "failed" });
        const res = await signUp("email=owner%40studio.ca");
        expect(res.headers.get("location")).toBe("/waitlist/retry");
        expect(confirmed).toEqual([]);
    });
});

describe("contact", () => {
    it("emails a message and thanks the sender", async () => {
        const { messages, post } = await start();
        const res = await post(
            "/contact",
            "name=Pat+Lee&email=pat%40studio.ca&message=Hello+there",
        );
        expect(res.headers.get("location")).toBe("/contact/thanks");
        expect(messages).toEqual([
            { name: "Pat Lee", email: "pat@studio.ca", message: "Hello there" },
        ]);
    });

    it("sends an incomplete message back to retry", async () => {
        const { messages, post } = await start();
        for (const body of [
            "name=Pat&email=nope&message=Hi",
            "name=&email=pat%40studio.ca&message=Hi",
            "name=Pat&email=pat%40studio.ca&message=",
        ]) {
            expect((await post("/contact", body)).headers.get("location"), body).toBe(
                "/contact/retry",
            );
        }
        expect(messages).toEqual([]);
    });

    it("drops a bot that fills the hidden field", async () => {
        const { messages, post } = await start();
        const res = await post(
            "/contact",
            "name=Bot&email=bot%40spam.example&message=Buy&website=x",
        );
        expect(res.headers.get("location")).toBe("/contact/thanks");
        expect(messages).toEqual([]);
    });
});
