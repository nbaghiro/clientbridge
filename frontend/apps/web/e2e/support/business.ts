import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { strings } from "@clientbridge/app-core/public";
import { type APIRequestContext, type Locator, type Page, expect } from "@playwright/test";
import { runPort, runUrl } from "@clientbridge/config/e2e/run";
import { freshPhone, mailedCode, newAccount } from "./auth";
import { select } from "./db";

export interface BusinessEvidence {
    business: {
        id: string;
        name: string;
        slug: string;
        province: string | null;
        timezone: string;
        subject: string | null;
        status: string;
        plan: string | null;
        plan_status: string;
        tax_registered: boolean;
        trial_seconds: number;
    }[];
    staff: {
        id: string;
        role: string;
        status: string;
        payee: boolean;
        email: string;
        linked: boolean;
    }[];
    audits: {
        action: string;
        entity_type: string;
        entity_id: string;
        changes: Record<string, unknown>;
    }[];
}

export async function businessEvidence(businessId: string): Promise<BusinessEvidence> {
    return {
        business: await select<BusinessEvidence["business"][number]>`
            SELECT id, name, slug, province, timezone, subject, status, plan, plan_status,
                tax_registered,
                round(extract(epoch FROM trial_ends_at - created_at))::int AS trial_seconds
            FROM businesses WHERE id = ${businessId}`,
        staff: await select<BusinessEvidence["staff"][number]>`
            SELECT s.id, s.role, s.status, s.payee, u.email, u.identity_id IS NOT NULL AS linked
            FROM staff s JOIN users u ON u.id = s.user_id
            WHERE s.business_id = ${businessId} ORDER BY s.created_at, s.id`,
        audits: await select<BusinessEvidence["audits"][number]>`
            SELECT action, entity_type, entity_id, changes FROM audits
            WHERE business_id = ${businessId} AND action LIKE 'business.%'
            ORDER BY created_at, id`,
    };
}

const a = strings.auth;

export async function signUp(
    page: Page,
    request: APIRequestContext,
    account: { email: string; password: string; name: string },
): Promise<void> {
    if (!page.url().includes("/signup")) await page.goto("/signup");
    await page.getByLabel(a.name, { exact: true }).fill(account.name);
    await page.getByRole("textbox", { name: a.email, exact: true }).fill(account.email);
    await page.getByLabel(a.newPassword, { exact: true }).fill(account.password);
    await page.getByRole("button", { name: a.createAccount, exact: true }).click();
    await expect(page.getByRole("heading", { name: a.verifyTitle })).toBeVisible();
    await page
        .getByLabel(a.code, { exact: true })
        .fill(await mailedCode(request, account.email, "verification"));
    await page.getByRole("button", { name: a.verify, exact: true }).click();
}

export async function openBusiness(
    page: Page,
    name: string,
    industry: Parameters<typeof strings.business.onboarding.industry>[0] = "beauty",
    province = strings.business.onboarding.provinceBC,
): Promise<void> {
    const o = strings.business.onboarding;
    await expect(page.getByRole("heading", { name: o.title })).toBeVisible();
    await page.getByLabel(o.businessName, { exact: true }).fill(name);
    await page.getByRole("combobox", { name: o.province }).click();
    await page
        .getByRole("listbox", { name: o.province })
        .getByRole("option", { name: province, exact: true })
        .click();
    await page.getByRole("combobox", { name: o.industryLabel }).click();
    await page
        .getByRole("listbox", { name: o.industryLabel })
        .getByRole("option", { name: o.industry(industry), exact: true })
        .click();
    await page.getByRole("button", { name: o.createBusiness, exact: true }).click();
    await expect(
        page
            .locator("aside")
            .getByRole("link", { name: strings.navigation.businessMenu, exact: true }),
    ).toBeVisible({ timeout: 60_000 });
}

const g = strings.business.getSetUp;

export interface NewBusiness {
    id: string;
    slug: string;
    name: string;
    email: string;
    password: string;
}

/** A brand-new owner and business, signed in on `page`. */
export async function newBusiness(
    page: Page,
    request: APIRequestContext,
    prefix: string,
    industry: Parameters<typeof strings.business.onboarding.industry>[0] = "beauty",
    province = strings.business.onboarding.provinceBC,
): Promise<NewBusiness> {
    const account = newAccount(prefix);
    const name = `${account.name} Co`;
    await signUp(page, request, account);
    await openBusiness(page, name, industry, province);
    const [row] = await select<{ id: string; slug: string }>`
        SELECT b.id, b.slug FROM businesses b
        JOIN staff s ON s.business_id = b.id JOIN users u ON u.id = s.user_id
        WHERE u.email = ${account.email}`;
    if (row === undefined) throw new Error("the new business has no row");
    return { ...row, name, email: account.email, password: account.password };
}

function apiRequest(page: Page, method: "PATCH" | "POST", path: string, data: unknown) {
    return page.request.fetch(`${runUrl("VITE_API_URL")}${path}`, {
        method,
        headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
        data,
    });
}

/** A change made straight through the API, as another device would. */
export async function patchBusiness(page: Page, data: unknown) {
    return apiRequest(page, "PATCH", "/v1/business", data);
}

export async function storedBrand(id: string): Promise<Record<string, unknown>> {
    const [row] = await select<{ brand: Record<string, unknown> }>`
        SELECT brand FROM businesses WHERE id = ${id}`;
    return row?.brand ?? {};
}

export function connectUrl(host: string, path = ""): string {
    return `http://${host}.localhost:${String(runPort("CONNECT_E2E_PORT"))}/${path}`;
}

export interface BrandControls {
    logo: Locator;
    cover: Locator;
    tagline: Locator;
    colour: (name: string) => Locator;
    save: Locator;
    upload: (input: Locator, file: Parameters<Locator["setInputFiles"]>[0]) => Promise<void>;
}

/** The brand panel, once its form has the business row and can take a file. */
export async function brandControls(page: Page, name: string): Promise<BrandControls> {
    await expect(page.getByRole("figure", { name: g.preview }).getByText(name)).toBeVisible({
        timeout: 60_000,
    });
    return {
        logo: page.locator('input[type="file"][accept*="svg"]'),
        cover: page.locator('input[type="file"]:not([accept*="svg"])'),
        tagline: page.getByLabel(new RegExp(`^${g.tagline}`)),
        colour: (colour) =>
            page.getByRole("radiogroup", { name: g.colour }).getByRole("radio", { name: colour }),
        save: page.getByRole("button", { name: g.save, exact: true }),
        upload: async (input, file) => {
            const done = page.waitForResponse((r) =>
                /\/v1\/files\/[^/]+\/complete$/.test(new URL(r.url()).pathname),
            );
            await input.setInputFiles(file);
            expect((await done).status()).toBe(200);
        },
    };
}

export async function brandAsset(name: string): Promise<Buffer> {
    return readFile(new URL(`../../../../../backend/scripts/demo_assets/${name}`, import.meta.url));
}

/** The page shows the business rather than Clientbridge: its colour, logo, tab title and icon. */
export async function expectBranded(
    page: Page,
    url: string,
    brand: { name: string; colour: string },
): Promise<void> {
    await page.goto(url);
    await expect(page).toHaveTitle(brand.name);
    await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute(
        "href",
        /^data:image\/png;base64,/,
    );
    const accent = await page
        .locator('[style*="--accent"]')
        .first()
        .evaluate((el) => getComputedStyle(el).getPropertyValue("--accent").trim());
    expect(accent.toLowerCase()).toBe(brand.colour.toLowerCase());
    const logo = page.locator('img[src*="/media/"]').first();
    await expect
        .poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth))
        .toBeGreaterThan(0);
}

/** A sent invoice's public pay link, on a client of the signed-in business. */
export async function payLink(page: Page): Promise<string> {
    const client = await apiRequest(page, "POST", "/v1/clients", {
        name: "Pay Link Client",
        phone: freshPhone(),
    });
    expect(client.status(), await client.text()).toBe(201);
    const invoice = await apiRequest(page, "POST", "/v1/invoices", {
        client_id: ((await client.json()) as { id: string }).id,
        lines: [
            { description: "Visit", quantity: 1, unit_amount_cents: 5000, tax_class: "exempt" },
        ],
        send: true,
    });
    expect(invoice.status(), await invoice.text()).toBe(201);
    const id = ((await invoice.json()) as { id: string }).id;
    const [row] = await select<{ pay_token: string }>`
        SELECT pay_token FROM invoices WHERE id = ${id}`;
    if (row === undefined) throw new Error("the invoice has no pay token");
    return connectUrl("pay", `i/${row.pay_token}`);
}
