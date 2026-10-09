import { expect, test } from "@playwright/test";

test("demo catalog photos load in the shop and booking page", async ({ page }, testInfo) => {
    test.skip(process.env.DEMO_E2E !== "1", "Requires the standard local demo catalog");
    await page.route("http://localhost:8701/**", (route) =>
        route.continue({ url: route.request().url().replace("localhost", "127.0.0.1") }),
    );
    for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/b/birchbark/shop");
        for (const name of [
            "Oatmeal Soothe Shampoo (500ml)",
            "Self-Cleaning Slicker Brush",
            "Travel Shampoo",
        ]) {
            const card = page.getByRole("button", { name, exact: true });
            await expect(card).toBeVisible();
            await expect(card.locator("img")).toHaveCount(1);
            await expect
                .poll(() =>
                    card.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth),
                )
                .toBeGreaterThan(0);
        }
        await expect(
            page.getByRole("button", { name: "Travel Shampoo", exact: true }),
        ).toContainText("$8.00");
        await page.screenshot({
            path: testInfo.outputPath(`shop-${String(width)}.png`),
            fullPage: true,
        });
        await page.goto("/b/birchbark/book");
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
