import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { strings } from "@clientbridge/app-core/public";
import { type APIRequestContext, type Page, expect } from "@playwright/test";
import { mailedCode } from "../identity";

const execute = promisify(execFile);

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
    const { stdout } = await execute(
        "uv",
        ["run", "python", "-m", "scripts.e2e_business_evidence", businessId],
        {
            cwd: fileURLToPath(new URL("../../../../../backend", import.meta.url)),
            timeout: 30_000,
        },
    );
    return JSON.parse(stdout) as BusinessEvidence;
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
