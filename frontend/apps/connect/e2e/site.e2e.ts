import { randomUUID } from "node:crypto";
import { demoPerson } from "@clientbridge/config/e2e/demo";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { demoSlug, runEmail, runUrl } from "@clientbridge/config/e2e/run";

const SITE = runUrl("VITE_SITE_URL");
const MAILPIT = runUrl("MAILPIT_URL");
const PAGE = runUrl("BUSINESS_PAGE_URL");
const TEAM = "hello@clientbridge.ca";

interface Mailed {
    ID: string;
    Subject: string;
}

async function mailedAbout(request: APIRequestContext, name: string): Promise<Mailed[]> {
    const search = await request.get(`${MAILPIT}/api/v1/search`, {
        params: { query: `to:"${TEAM}" subject:"${name}"` },
    });
    expect(search.status()).toBe(200);
    return ((await search.json()) as { messages?: Mailed[] }).messages ?? [];
}

function form(fields: [string, string][]): string {
    return fields.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

test("OPS-E2E-04 the marketing site's contact form mails the team once and drops invalid or bot posts", async ({
    page,
    request,
}) => {
    const run = randomUUID().slice(0, 8);
    const name = `${demoPerson(run)} ${run}`;
    const email = runEmail(`contact-${run}@example.com`);
    const message = "We run two grooming vans in Halifax. Can we book both from one calendar?";
    await page.goto(`${SITE}/contact`);
    await page.locator("#contact-name").fill(name);
    await page.locator("#contact-email").fill(email);
    await page.locator("#contact-message").fill(message);
    const posted = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/contact" && r.request().method() === "POST",
    );
    await page.locator('form[action="/contact"] button[type="submit"]').click();
    const response = await posted;
    expect(response.status()).toBe(303);
    expect(response.headers().location).toBe("/contact/thanks");
    await expect(page).toHaveURL(`${SITE}/contact/thanks`);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);

    await expect.poll(async () => (await mailedAbout(request, name)).length).toBe(1);
    const [found] = await mailedAbout(request, name);
    if (found === undefined) throw new Error("The contact message never arrived");
    const mail = (await (await request.get(`${MAILPIT}/api/v1/message/${found.ID}`)).json()) as {
        To: { Address: string }[];
        ReplyTo: { Address: string }[];
        Text: string;
    };
    expect(mail.To.map((to) => to.Address)).toEqual([TEAM]);
    expect(mail.ReplyTo.map((to) => to.Address)).toEqual([email]);
    expect(mail.Text).toContain(`${name} <${email}>`);
    expect(mail.Text).toContain(message);

    const refused: [string, string, string | undefined][] = [];
    const variants: { label: string; body: string; type?: string; to: string }[] = [
        {
            label: "honeypot",
            body: form([
                ["name", `${name} honeypot`],
                ["email", email],
                ["message", message],
                ["website", "https://cheap-leads.example"],
            ]),
            to: "/contact/thanks",
        },
        {
            label: "bad email",
            body: form([
                ["name", `${name} bad email`],
                ["email", "not-an-address"],
                ["message", message],
            ]),
            to: "/contact/retry",
        },
        {
            label: "repeated field",
            body: form([
                ["name", `${name} repeated field`],
                ["name", "Someone else"],
                ["email", email],
                ["message", message],
            ]),
            to: "/contact/retry",
        },
        {
            label: "empty message",
            body: form([
                ["name", `${name} empty message`],
                ["email", email],
                ["message", ""],
            ]),
            to: "/contact/retry",
        },
        {
            label: "oversized",
            body: form([
                ["name", `${name} oversized`],
                ["email", email],
                ["message", "x".repeat(40_000)],
            ]),
            to: "/contact/retry",
        },
        {
            label: "json",
            body: JSON.stringify({ name: `${name} json`, email, message }),
            type: "application/json",
            to: "/contact/retry",
        },
    ];
    for (const variant of variants) {
        const sent = await request.post(`${SITE}/contact`, {
            headers: { "Content-Type": variant.type ?? "application/x-www-form-urlencoded" },
            data: variant.body,
            maxRedirects: 0,
        });
        refused.push([variant.label, String(sent.status()), sent.headers().location]);
    }
    expect(refused).toEqual(variants.map((v) => [v.label, "303", v.to]));
    await page.goto(`${SITE}/contact/retry`);
    await expect(page.getByRole("alert")).toBeVisible();
    await page.waitForTimeout(1000);
    for (const variant of variants)
        expect(await mailedAbout(request, `${name} ${variant.label}`), variant.label).toEqual([]);
    expect(await mailedAbout(request, name)).toHaveLength(1);
});

test("OPS-E2E-05 the marketing site's demo links open the seeded demo businesses' pages", async ({
    page,
}) => {
    const pages: [string, string, string][] = [
        ["/", demoSlug("birchbark"), "Birchbark Pet Studio"],
        ["/solutions/trades", demoSlug("northlight"), "Northlight Security"],
    ];
    for (const [path, slug, business] of pages) {
        await page.goto(`${SITE}${path}`);
        const target = PAGE.replace("{slug}", slug);
        const link = page.locator(`a[href="${target}"]`).first();
        await expect(link).toBeVisible();
        expect(await page.locator('a[href*=".invalid"]').count()).toBe(0);
        await link.click();
        await expect(page).toHaveURL(`${target}/`);
        await expect(page.getByRole("heading", { name: business, level: 1 })).toBeVisible({
            timeout: 30_000,
        });
    }
});
