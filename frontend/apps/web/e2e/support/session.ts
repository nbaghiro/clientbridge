import { randomUUID } from "node:crypto";
import { strings } from "@clientbridge/app-core/public";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { runEmail } from "@clientbridge/config/e2e/run";

export interface Credentials {
    email: string;
    password: string;
}

export async function signIn(
    page: Page,
    credentials: Credentials = {
        email: runEmail("hannah@birchbark.example"),
        password: "demo1234",
    },
): Promise<void> {
    await page.goto("/");
    await page
        .getByRole("textbox", { name: strings.auth.email, exact: true })
        .fill(credentials.email);
    await page.getByLabel(strings.auth.password, { exact: true }).fill(credentials.password);
    await page.getByRole("button", { name: strings.auth.signIn, exact: true }).click();
    await expect(page).toHaveURL(/\/today$/, { timeout: 60_000 });
}

export async function navigate(page: Page, path: string): Promise<void> {
    await page.evaluate((to) => {
        history.pushState({}, "", to);
        dispatchEvent(new PopStateEvent("popstate"));
    }, path);
}

/** A signed-out customer's browser with its own address, so its public request budget is its own. */
export function customerContext(browser: Browser): Promise<BrowserContext> {
    const groups = randomUUID().replaceAll("-", "").slice(0, 16).match(/.{4}/g) ?? [];
    return browser.newContext({
        extraHTTPHeaders: { "X-Forwarded-For": `2001:db8:${groups.join(":")}::1` },
    });
}
