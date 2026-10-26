import { expect, test } from "@playwright/test";

import { on } from "./hosts";
import { demoSlug } from "@clientbridge/config/e2e/run";

test("presentation demo: catalog photos load in the shop and booking page", async ({
    page,
}, testInfo) => {
    test.skip(process.env.DEMO_E2E !== "1", "Requires the standard local demo catalog");
    for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(on("shop", `/${demoSlug("birchbark")}`));
        for (const name of [
            "Oatmeal Soothe Shampoo (500ml)",
            "Self-Cleaning Slicker Brush",
            "Travel Shampoo",
        ]) {
            const card = page.getByRole("group", { name, exact: true });
            await expect(card).toBeVisible();
            await expect(card.locator("img")).toHaveCount(1);
            await expect
                .poll(() =>
                    card.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth),
                )
                .toBeGreaterThan(0);
        }
        await expect(
            page.getByRole("group", { name: "Travel Shampoo", exact: true }),
        ).toContainText("$8.00");
        await page.screenshot({
            path: testInfo.outputPath(`shop-${String(width)}.png`),
            fullPage: true,
        });
        await page.goto(`/${demoSlug("birchbark")}`);
        await expect(page.locator('img[src*="fl_img_"]').first()).toBeVisible();
        await expect
            .poll(() =>
                page
                    .locator('img[src*="fl_img_"]')
                    .evaluateAll((images) =>
                        images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
                    ),
            )
            .toBe(true);
        await page.screenshot({
            path: testInfo.outputPath(`booking-${String(width)}.png`),
            fullPage: true,
        });
    }
});
