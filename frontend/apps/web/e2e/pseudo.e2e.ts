import { clippedText, englishCopy } from "@clientbridge/config/e2e/pseudo";
import { expect, test } from "@playwright/test";

import { clientMessageCopy } from "./support/pseudo";

const PAGES = [
    "/today",
    "/schedule",
    "/clients",
    "/clients/cl_amelie/history",
    "/setup/business",
    "/setup/plan",
    "/payments/invoices",
];

test("key pages read every text from the en-XA catalog", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en-XA");
    await page.fill('input[type="email"]', "hannah@birchbark.example");
    await page.fill('input[type="password"]', "demo1234");
    await page.locator('button[type="submit"]').first().click();
    await expect(page).toHaveURL(/\/today$/, { timeout: 60_000 });
    // The replica needs a moment to sync before the pages have rows.
    await page.waitForTimeout(6000);
    const historyMessageCopy = await clientMessageCopy("cl_amelie");
    const found: Record<string, string[]> = {};
    const record = async (where: string): Promise<void> => {
        const data =
            where === "/clients/cl_amelie/history" ? historyMessageCopy : new Set<string>();
        const english = await englishCopy(page, "body", data);
        const clipped = (await clippedText(page)).map((t) => `clipped: ${t}`);
        if (english.length + clipped.length > 0) found[where] = [...english, ...clipped];
    };
    for (const path of PAGES) {
        await page.evaluate((to) => {
            history.pushState({}, "", to);
            dispatchEvent(new PopStateEvent("popstate"));
        }, path);
        await expect(page.locator("main h1").first()).toBeVisible();
        await page.waitForTimeout(500);
        await record(path);
    }
    // The last page is the invoice list; its first row opens an invoice.
    await page.locator("main button.block").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await record("/payments/invoices, an invoice");
    expect(found).toEqual({});
});
