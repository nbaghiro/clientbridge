import { strings } from "@clientbridge/app-core/public";
import { type Browser, type Page, expect } from "@playwright/test";
import { runUrl } from "@clientbridge/config/e2e/run";
import { bookingApi } from "./bookings";

export const ADMIN = runUrl("VITE_ADMIN_URL");

export function operator(role: "console" | "lapse"): { email: string; password: string } {
    const email = process.env[`E2E_OPERATOR_${role.toUpperCase()}_EMAIL`];
    const password = process.env[`E2E_OPERATOR_${role.toUpperCase()}_PASSWORD`];
    if (!email || !password) throw new Error("the stack grants no platform operator");
    return { email, password };
}

/** Signs in through the web app's admin login, as the console's cross-host redirect sends you. */
export async function operatorConsole(browser: Browser, role: "console" | "lapse"): Promise<Page> {
    const { email, password } = operator(role);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(ADMIN);
    await expect(page).toHaveURL(/\/admin-login\?session=1$/, { timeout: 60_000 });
    await page.getByRole("textbox", { name: strings.auth.email, exact: true }).fill(email);
    await page.getByLabel(strings.auth.password, { exact: true }).fill(password);
    await page.getByRole("button", { name: strings.auth.signIn, exact: true }).click();
    await expect(page).toHaveURL(`${ADMIN}/overview`, { timeout: 60_000 });
    await expect(
        page.getByRole("heading", { name: strings.admin.overview, exact: true }),
    ).toBeVisible();
    return page;
}

export async function setEdition(page: Page, businessId: string, subject: string | null) {
    return page.request.post(`${bookingApi()}/admin/v1/businesses/${businessId}/edition`, {
        headers: { Origin: ADMIN },
        data: { subject },
    });
}
