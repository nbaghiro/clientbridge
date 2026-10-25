import { strings } from "@clientbridge/app-core/public";
import { expect, type Page } from "@playwright/test";

export interface Credentials {
    email: string;
    password: string;
}

export async function signIn(
    page: Page,
    credentials: Credentials = { email: "hannah@birchbark.example", password: "demo1234" },
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
