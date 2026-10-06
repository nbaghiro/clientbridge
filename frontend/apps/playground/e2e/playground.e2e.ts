import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { type Page, expect, test } from "@playwright/test";

const storiesDir = fileURLToPath(new URL("../src/stories", import.meta.url));
const PAGES = readdirSync(storiesDir)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => f.replace(/\.tsx$/, ""))
    .sort();

function collect(page: Page): string[] {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
        if (m.type() === "error") errors.push(`console: ${m.text()}`);
    });
    return errors;
}

test("every story renders on web without console errors", async ({ page }) => {
    const errors = collect(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const name of PAGES) {
        await page.goto(`/#/${name}?platform=web`);
        await expect(page.locator(`[data-page="${name}"]`)).toBeVisible();
        await expect(page.locator("[data-example]").first()).toBeVisible();
        const openers = page.getByRole("button", { name: /^Open / });
        for (let i = 0; i < (await openers.count()); i += 1) {
            await openers.nth(i).click();
            await page.keyboard.press("Escape");
        }
    }
    expect(errors).toEqual([]);
});

for (const device of ["iphone", "android"] as const) {
    test(`every story renders on ${device} without console errors`, async ({ page }) => {
        const errors = collect(page);
        await page.setViewportSize({ width: device === "iphone" ? 393 : 412, height: 900 });
        for (const name of PAGES) {
            await page.goto(`/#/frame/${name}?device=${device}`);
            await page.reload();
            await expect(page.locator("#root")).not.toBeEmpty();
            await expect(page.locator("body")).not.toHaveText("");
        }
        expect(errors).toEqual([]);
    });
}
