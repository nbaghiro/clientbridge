import { strings } from "@clientbridge/app-core/public";
import { unreadableHover } from "@clientbridge/config/e2e/accessibility";
import { expect, test } from "@playwright/test";
import { on } from "./hosts";
import { links } from "./links";
import { ownAddress, rewrite, type Json } from "./network";
import { demoSlug, runUrl } from "@clientbridge/config/e2e/run";

const slug = demoSlug("birchbark");
const home = on(slug, "/");
const api = runUrl("VITE_API_URL");

test.beforeEach(async ({ context }, info) => {
    await ownAddress(context, info);
});

test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("the business cover photo keeps its hovered actions readable", async ({ page }) => {
    const cover = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600"><rect width="1600" height="600" fill="#f4efe4"/></svg>`;
    await page.route("**/e2e-cover.svg", (route) =>
        route.fulfill({ contentType: "image/svg+xml", body: cover }),
    );
    await page.route(`**/book/${links.slug}/profile`, async (route) => {
        const response = await route.fetch();
        const profile = (await response.json()) as { brand: Record<string, unknown> };
        profile.brand.cover_url = new URL("/e2e-cover.svg", page.url()).href;
        await route.fulfill({ response, json: profile });
    });
    await page.goto(on(links.slug, "/"));
    const header = page.locator("header", { has: page.locator('img[src$="/e2e-cover.svg"]') });
    await expect(header.getByRole("button", { name: strings.publicLanding.book })).toBeVisible();
    expect(await unreadableHover(page, "header")).toEqual([]);
    // a profile refetch still in flight at teardown would read a disposed response
    await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("empty businesses do not advertise unavailable services or products", async ({ page }) => {
    await page.route(`${api}/book/${slug}/profile`, (route) =>
        rewrite(route, (profile) => ({
            ...profile,
            services: [],
            staff: [],
            policy: null,
        })),
    );
    await page.route(`${api}/book/${slug}/shop`, (route) =>
        rewrite(route, (shop) => ({ ...shop, items: [] })),
    );
    await page.goto(home);
    const nav = page.getByRole("navigation", { name: strings.publicLanding.navigation });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(nav).toHaveCount(0);
    await expect(
        page.getByRole("button", { name: strings.publicBooking.shopLink, exact: true }),
    ).toHaveCount(0);
    await expect(
        page
            .locator("header")
            .getByRole("button", { name: strings.publicLanding.book, exact: true }),
    ).toHaveCount(0);
});

test("business favicon follows the homepage and booking branding", async ({ page }) => {
    await page.goto(home);
    const icon = page.locator('link[rel="icon"]').first();
    await expect(icon).toHaveAttribute("href", /^data:image\/png;base64,/);
    await page
        .locator("header")
        .getByRole("button", { name: strings.publicLanding.book, exact: true })
        .click();
    await expect(
        page.getByRole("heading", { name: strings.publicBooking.stepService }),
    ).toBeVisible();
    await expect(icon).toHaveAttribute("href", /^data:image\/png;base64,/);
    await page
        .getByRole("navigation", { name: strings.publicLanding.navigation })
        .getByRole("link", { name: strings.publicLanding.home, exact: true })
        .click();
    await expect(icon).toHaveAttribute("href", /^data:image\/png;base64,/);
});

test("unavailable business icons retain the default favicon", async ({ page }) => {
    await page.route(`${api}/book/${slug}/profile`, (route) =>
        rewrite(route, (profile) => ({
            ...profile,
            brand: {
                ...(profile.brand as Json),
                logo_url: `${api}/missing-logo`,
            },
        })),
    );
    await page.route(`${api}/missing-*`, (route) => route.fulfill({ status: 404 }));
    const failedLogo = page.waitForResponse(`${api}/missing-logo`);
    await page.goto(home);
    await failedLogo;
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute("href", "/favicon.ico");
});
