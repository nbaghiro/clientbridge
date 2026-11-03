import { strings } from "@clientbridge/app-core/public";
import { type APIRequestContext, type Page, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { runUrl } from "@clientbridge/config/e2e/run";
import { mailedCode, newAccount } from "./auth";
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

export interface NewBusiness {
    id: string;
    slug: string;
}

/** A signed-up owner with a business of their own, for a case that changes its settings. */
export async function newBusiness(
    page: Page,
    request: APIRequestContext,
    prefix: string,
    province: string,
): Promise<NewBusiness> {
    const account = newAccount(prefix);
    await signUp(page, request, account);
    await openBusiness(page, `${account.name} Co`, "beauty", province);
    const [row] = await select<NewBusiness>`
        SELECT b.id, b.slug FROM businesses b
        JOIN staff s ON s.business_id = b.id JOIN users u ON u.id = s.user_id
        WHERE u.email = ${account.email}`;
    if (row === undefined) throw new Error("the new business has no row");
    return row;
}

/** A change made straight through the API, as another device would. */
export async function patchBusiness(page: Page, data: unknown) {
    return page.request.patch(`${runUrl("VITE_API_URL")}/v1/business`, {
        headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
        data,
    });
}
