import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { strings } from "@clientbridge/app-core/public";
import {
    test as base,
    expect,
    type Browser,
    type BrowserContext,
    type Page,
} from "@playwright/test";
import { runEmail } from "@clientbridge/config/e2e/run";

// Playwright's WebKit contexts browse privately, where OPFS refuses the replica, so WebKit gets a profile
export const test = base.extend({
    context: async (
        { browserName, context, playwright, baseURL, viewport, serviceWorkers },
        use,
    ) => {
        if (browserName !== "webkit") {
            await use(context);
            return;
        }
        const profile = await mkdtemp(join(tmpdir(), "webkit-profile-"));
        const persistent = await playwright.webkit.launchPersistentContext(profile, {
            ...(baseURL === undefined ? {} : { baseURL }),
            viewport,
            serviceWorkers,
        });
        try {
            await use(persistent);
        } finally {
            await persistent.close();
            await rm(profile, { recursive: true, force: true });
        }
    },
});

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
