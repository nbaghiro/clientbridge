import { createHash } from "node:crypto";

import { strings } from "@clientbridge/app-core/public";
import { type Route, expect, test } from "@playwright/test";

const slug = "birchbark";
const home = `/b/${slug}`;
const api = process.env.VITE_API_URL ?? "http://127.0.0.1:8701";
const run = Date.now().toString();

type Json = Record<string, unknown>;

async function rewrite(route: Route, change: (body: Json) => Json): Promise<void> {
    const response = await route.fetch();
    const body = (await response.json().catch(() => null)) as Json | null;
    // null when the page dropped the request (a refetch), so there is nothing left to answer
    if (body !== null) await route.fulfill({ json: change(body) });
}

test.beforeEach(async ({ context }, info) => {
    const address = createHash("sha256").update(`${run}:${info.testId}`).digest("hex").slice(0, 16);
    await context.route(`${api}/**`, async (route) => {
        await route.continue({
            headers: {
                ...route.request().headers(),
                "X-Forwarded-For": `2001:db8:${address.match(/.{4}/g)?.join(":")}::1`,
            },
        });
    });
});

test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("existing links preserve booking selections and embed mode", async ({ page }) => {
    await page.goto(`/book/${slug}?service=it_unknown&embed=1#details`);
    await expect(page).toHaveURL(`${home}/book?service=it_unknown&embed=1#details`);
    await expect(
        page.getByRole("heading", { name: strings.publicBooking.stepService }),
    ).toBeVisible();
    await expect(
        page.getByRole("navigation", { name: strings.publicLanding.navigation }),
    ).toHaveCount(0);
    await page.goto(`/shop/${slug}/checkout?embed=1`);
    await expect(page).toHaveURL(`${home}/shop/checkout?embed=1`);
    await expect(page.getByText(strings.publicShop.cartEmpty).first()).toBeVisible();
});

test("business navigation connects the shop, booking, and homepage sections on mobile", async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${home}/shop`);
    const nav = page.getByRole("navigation", { name: strings.publicLanding.navigation });
    await expect(nav).toHaveCSS("height", "64px");
    await nav.locator("summary").click();
    await page.keyboard.press("Escape");
    await expect(nav.locator("details")).not.toHaveAttribute("open", "");
    await nav.locator("summary").click();
    await nav.getByRole("link", { name: strings.publicLanding.home, exact: true }).click();
    await page
        .getByRole("navigation", { name: strings.publicLanding.jumpTo })
        .getByRole("link", { name: strings.publicLanding.reviews, exact: true })
        .click();
    await expect(page).toHaveURL(`${home}#reviews`);
    await expect(page.locator("#reviews")).toBeInViewport();
    await expect(nav).toHaveCount(0);
    await page
        .locator("header")
        .getByRole("button", { name: strings.publicLanding.book, exact: true })
        .click();
    await expect(page).toHaveURL(`${home}/book`);
    await expect(
        page.getByRole("heading", { name: strings.publicBooking.stepService }),
    ).toBeVisible();
    await page.goBack();
    await expect(page.locator("#reviews")).toBeInViewport();
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
});

test("product deep links, cart, and checkout contact details survive navigation and reload", async ({
    page,
    request,
}) => {
    const response = await request.get(`${api}/book/${slug}/shop`);
    const data = (await response.json()) as {
        items: { id: string; in_stock: boolean; variant_parent_id?: string | null }[];
    };
    const product = data.items.find((item) => item.in_stock && !item.variant_parent_id);
    expect(product).toBeDefined();
    await page.goto(`${home}/shop?product=${product?.id ?? ""}`);
    await page.getByRole("button", { name: strings.publicShop.addToOrder, exact: true }).click();
    await expect(page).toHaveURL(`${home}/shop?cart=1`);
    await page.getByRole("button", { name: strings.publicShop.checkout, exact: true }).click();
    await expect(page).toHaveURL(`${home}/shop/checkout`);
    await page.getByLabel(strings.publicShop.name, { exact: true }).fill("Navigation Test");
    await page
        .getByLabel(strings.publicShop.email, { exact: false })
        .fill("navigation@example.test");
    const nav = page.getByRole("navigation", { name: strings.publicLanding.navigation });
    await nav.locator("summary").click();
    await nav.getByRole("link", { name: strings.publicLanding.home, exact: true }).click();
    await page.getByRole("button", { name: strings.publicBooking.shopLink, exact: true }).click();
    await nav.getByRole("link", { name: /^Cart/ }).click();
    await page.getByRole("button", { name: strings.publicShop.checkout, exact: true }).click();
    await expect(page.getByLabel(strings.publicShop.name, { exact: true })).toHaveValue(
        "Navigation Test",
    );
    await page.reload();
    await expect(page.getByLabel(strings.publicShop.email, { exact: false })).toHaveValue(
        "navigation@example.test",
    );
});

test("empty businesses do not advertise unavailable services or products", async ({ page }) => {
    await page.route(`${api}/book/${slug}/profile`, (route) =>
        rewrite(route, (profile) => ({
            ...profile,
            services: [],
            staff: [],
            review_count: 0,
            reviews: [],
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

test("booking drafts restore contact details and remain scoped to their business", async ({
    page,
}) => {
    await page.goto(home);
    await page.evaluate(() => {
        sessionStorage.setItem(
            "connect-booking:birchbark",
            JSON.stringify({
                name: "Booking Draft",
                email: "draft@example.test",
                itemId: "it_bath",
                note: "Saved note",
            }),
        );
        sessionStorage.setItem(
            "connect-booking:cedar-coast-demo",
            JSON.stringify({ name: "Other Client" }),
        );
    });
    await page.goto(`${home}/book`);
    await expect(page.getByRole("heading", { name: strings.publicBooking.stepTime })).toBeVisible();
    const nav = page.getByRole("navigation", { name: strings.publicLanding.navigation });
    await nav.getByRole("link", { name: strings.publicLanding.shop, exact: true }).click();
    await nav.getByRole("link", { name: strings.publicLanding.booking, exact: true }).click();
    await expect(page.getByRole("heading", { name: strings.publicBooking.stepTime })).toBeVisible();
    const draft = await page.evaluate(
        () =>
            JSON.parse(sessionStorage.getItem("connect-booking:birchbark") ?? "{}") as Record<
                string,
                string
            >,
    );
    expect(draft.name).toBe("Booking Draft");
    expect(draft.email).toBe("draft@example.test");
    expect(draft.returningToken).toBeUndefined();
    await page.reload();
    await expect(page.getByRole("heading", { name: strings.publicBooking.stepTime })).toBeVisible();
    await page.goto("/b/cedar-coast-demo/book");
    await expect(page.getByText(strings.publicBooking.nothingBookable)).toBeVisible();
    await expect(
        page
            .getByRole("navigation", { name: strings.publicLanding.navigation })
            .getByRole("link", { name: /Cedar Coast/ }),
    ).toBeVisible();
    const other = await page.evaluate(
        () =>
            JSON.parse(
                sessionStorage.getItem("connect-booking:cedar-coast-demo") ?? "{}",
            ) as Record<string, string>,
    );
    expect(other.name).toBe("Other Client");
    expect(other.email).toBeUndefined();
    expect(
        await page.evaluate(() => sessionStorage.getItem("connect-booking:cedar-coast-demo")),
    ).toContain("Other Client");
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
                avatar_url: `${api}/missing-avatar`,
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
