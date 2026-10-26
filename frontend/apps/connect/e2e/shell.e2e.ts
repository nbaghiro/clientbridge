import { strings } from "@clientbridge/app-core/public";
import { axeIssues, unmarkedFocus, unreadableHover } from "@clientbridge/config/e2e/accessibility";
import { expect, test } from "@playwright/test";
import { on } from "./hosts";
import { links } from "./links";
import { ownAddress } from "./network";
import { demoSlug, runUrl } from "@clientbridge/config/e2e/run";
import { watchErrors } from "./errors";

const PUBLIC_PAGES = [
    { name: "business", path: on(links.slug, "/"), landmark: "Birchbark Pet Studio" },
    { name: "booking", path: `/${links.slug}`, landmark: strings.publicBooking.title },
    { name: "manage", path: `/m/${links.manage}`, landmark: strings.publicManage.title },
    {
        name: "invoice",
        path: on("pay", `/i/${links.invoice}`),
        landmark: strings.publicPay.balanceDue,
    },
    {
        name: "estimate",
        path: on("pay", `/e/${links.estimate}`),
        landmark: strings.publicEstimate.estimateTotal,
    },
    {
        name: "receipt",
        path: on("pay", `/r/${links.receipt}`),
        landmark: strings.publicReceipt.print,
    },
    { name: "form", path: `/form/${links.form}`, landmark: strings.publicForm.sendAnswers },
    {
        name: "contract",
        path: `/contract/${links.contract}`,
        landmark: strings.publicContract.sign,
    },
    {
        name: "preferences",
        path: `/prefs/${links.prefs}`,
        landmark: strings.publicPreferences.title,
    },
    {
        name: "order",
        path: on("shop", `/order/${links.order}`),
        landmark: strings.publicOrder.title,
    },
    { name: "shop", path: on("shop", `/${links.slug}`), landmark: strings.publicShop.subtitle },
];

const MISSING_PAGES = [
    [on("missing-business", "/"), strings.publicLanding.notFoundTitle],
    ["/missing-business", strings.publicBooking.notFoundTitle],
    [on("shop", "/missing-business"), strings.publicShop.notFoundTitle],
    ["/m/missing-token", strings.publicManage.notFoundTitle],
    [on("pay", "/i/missing-token"), strings.publicPay.notFoundTitle],
    [on("pay", "/e/missing-token"), strings.publicEstimate.notFoundTitle],
    [on("pay", "/r/missing-token"), strings.publicReceipt.notFoundTitle],
    ["/b/missing-business/book", strings.publicLanding.pageNotFoundTitle],
    [on("pay", "/m/missing-token"), strings.publicLanding.pageNotFoundTitle],
    ["/form/missing-token", strings.publicForm.notFoundTitle],
    ["/contract/missing-token", strings.publicContract.notFoundTitle],
    ["/prefs/missing-token", strings.publicPreferences.notFoundTitle],
] as const;

const slug = demoSlug("birchbark");
const home = on(slug, "/");
const booking = `/${slug}`;
const shopPage = on("shop", `/${slug}`);

test.beforeEach(async ({ context }, info) => {
    await ownAddress(context, info);
});

test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
});

for (const surface of PUBLIC_PAGES) {
    test(`the ${surface.name} page renders without overflow at phone width`, async ({ page }) => {
        const errors = watchErrors(page);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(surface.path);
        await expect(page.getByText(surface.landmark, { exact: true }).first()).toBeVisible();
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        ).toBeLessThanOrEqual(0);
        if (process.env.E2E_CAPTURE_SURFACES === "1") {
            await test.info().attach(surface.name, {
                body: await page.screenshot({ fullPage: true }),
                contentType: "image/png",
            });
        }
        expect(errors).toEqual([]);
    });
}

for (const surface of PUBLIC_PAGES) {
    test(`the ${surface.name} page passes axe, shows keyboard focus and keeps hovered text readable`, async ({
        page,
    }) => {
        await page.goto(surface.path);
        await expect(page.getByText(surface.landmark, { exact: true }).first()).toBeVisible();
        await page.getByRole("heading", { level: 1 }).first().click();
        expect(await axeIssues(page)).toEqual([]);
        expect(await unmarkedFocus(page, "body")).toEqual([]);
        expect(await unreadableHover(page, "body")).toEqual([]);
    });
}

test("every client page explains an invalid link without offering a transaction", async ({
    page,
}) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    const writes: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
        if (
            new URL(request.url()).origin === new URL(runUrl("VITE_API_URL")).origin &&
            ["POST", "PUT", "PATCH", "DELETE"].includes(request.method())
        ) {
            writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
        }
    });
    for (const [path, title] of MISSING_PAGES) {
        await test.step(path, async () => {
            await page.goto(path);
            await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
            await expect(page.getByRole("button")).toHaveCount(0);
        });
    }
    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
});

test(
    "business navigation connects the shop, booking, and homepage sections on mobile",
    { tag: "@browsers" },
    async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(shopPage);
        const nav = page.getByRole("navigation", { name: strings.publicLanding.navigation });
        await expect(nav).toHaveCSS("height", "64px");
        await nav.locator("summary").click();
        await page.keyboard.press("Escape");
        await expect(nav.locator("details")).not.toHaveAttribute("open", "");
        await nav.locator("summary").click();
        await nav.getByRole("link", { name: strings.publicLanding.home, exact: true }).click();
        await page
            .getByRole("navigation", { name: strings.publicLanding.jumpTo })
            .getByRole("link", { name: strings.publicLanding.team, exact: true })
            .click();
        await expect(page).toHaveURL(`${home}#team`);
        await expect(page.locator("#team")).toBeInViewport();
        await expect(nav).toHaveCount(0);
        const mobileBooking = page
            .getByRole("button", { name: strings.publicLanding.book, exact: true })
            .last();
        await expect(mobileBooking).toBeInViewport();
        await mobileBooking.click();
        await expect(page).toHaveURL(on("book", booking));
        await expect(
            page.getByRole("heading", { name: strings.publicBooking.stepService }),
        ).toBeVisible();
        await page.goBack();
        await expect(page).toHaveURL(`${home}#team`);
        await expect(page.locator("#team")).toBeInViewport();
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
    },
);

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
