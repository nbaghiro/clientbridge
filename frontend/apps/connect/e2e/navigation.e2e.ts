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
        items: {
            id: string;
            name: string;
            in_stock: boolean;
            variant_parent_id?: string | null;
        }[];
    };
    const product = data.items.find((item) => item.in_stock && !item.variant_parent_id);
    expect(product).toBeDefined();
    await page.goto(`${home}/shop?product=${product?.id ?? ""}`);
    await expect(page).toHaveURL(`${home}/shop`);
    const card = page.locator(`#product-${product?.id ?? ""}`);
    await expect(card.getByRole("button", { name: /./ }).first()).toBeFocused();
    await card
        .getByRole("button", { name: strings.publicShop.addNamed(product?.name ?? "") })
        .click();
    const summary = page.locator("aside");
    await summary.getByRole("button", { name: strings.publicShop.checkout, exact: true }).click();
    await expect(page).toHaveURL(`${home}/shop/checkout`);
    await summary.getByRole("button", { name: strings.publicShop.continue, exact: true }).click();
    await page.getByLabel(strings.publicShop.name, { exact: true }).fill("Navigation Test");
    await page
        .getByLabel(strings.publicShop.email, { exact: false })
        .fill("navigation@example.test");
    const nav = page.getByRole("navigation", { name: strings.publicLanding.navigation });
    await nav.locator("summary").click();
    await nav.getByRole("link", { name: strings.publicLanding.home, exact: true }).click();
    await page.getByRole("button", { name: strings.publicBooking.shopLink, exact: true }).click();
    await nav
        .getByRole("link", { name: strings.common.withCount(strings.publicLanding.cart, 1) })
        .click();
    await expect(page).toHaveURL(`${home}/shop`);
    await expect(page.getByRole("heading", { name: strings.publicShop.cart })).toBeFocused();
    await summary.getByRole("button", { name: strings.publicShop.checkout, exact: true }).click();
    await summary.getByRole("button", { name: strings.publicShop.continue, exact: true }).click();
    await expect(page.getByLabel(strings.publicShop.name, { exact: true })).toHaveValue(
        "Navigation Test",
    );
    await page.reload();
    await summary.getByRole("button", { name: strings.publicShop.continue, exact: true }).click();
    await expect(page.getByLabel(strings.publicShop.email, { exact: false })).toHaveValue(
        "navigation@example.test",
    );
});

test("the shop adds from the grid, changes quantities and checks out in steps", async ({
    page,
}) => {
    const shop = strings.publicShop;
    await page.route(`${api}/book/${slug}/shop`, (route) =>
        rewrite(route, (body) => ({ ...body, stripe_account_id: "acct_e2e" })),
    );
    let placed: Json | null = null;
    await page.route(`${api}/book/${slug}/shop/orders`, async (route) => {
        placed = route.request().postDataJSON() as Json;
        await route.fulfill({
            json: {
                order_id: "ord_01E2ESTUBORDER",
                order_token: null,
                subtotal_cents: 5000,
                tax_total_cents: 250,
                total_cents: 5250,
                currency: "CAD",
                client_secret: "pi_e2e_secret_stub",
                stripe_account_id: "acct_e2e",
            },
        });
    });
    await page.goto(`${home}/shop`);
    const summary = page.locator("aside");
    await expect(summary.getByText(shop.cartEmpty)).toBeVisible();
    await expect(summary.getByRole("button", { name: shop.checkout })).toBeDisabled();
    const card = page.getByRole("group", { name: "Oatmeal Soothe Shampoo (500ml)", exact: true });
    await card
        .getByRole("button", { name: shop.addNamed("Oatmeal Soothe Shampoo (500ml)") })
        .click();
    await card
        .getByRole("button", { name: strings.common.increase("Oatmeal Soothe Shampoo (500ml)") })
        .click();
    await expect(page.getByText(shop.orderUpdated(shop.items(2), "$48.00"))).toBeAttached();
    await expect(summary.getByText("$48.00").first()).toBeVisible();
    await summary
        .getByRole("button", { name: strings.common.decrease("Oatmeal Soothe Shampoo (500ml)") })
        .click();
    await expect(card.getByText("1", { exact: true }).last()).toBeVisible();
    await summary.getByRole("button", { name: shop.checkout, exact: true }).click();
    await expect(page.getByRole("heading", { name: shop.sectionPickup })).toBeVisible();
    await summary.getByRole("button", { name: shop.continue, exact: true }).click();
    await expect(page.getByRole("heading", { name: shop.sectionDetails })).toBeFocused();
    await expect(page.getByText(shop.pickupAsap).first()).toBeVisible();
    await summary.getByRole("button", { name: shop.continuePay, exact: true }).click();
    await expect(page.getByText(shop.incomplete)).toBeVisible();
    await page.getByLabel(shop.name, { exact: true }).fill("Stepper Test");
    await page.getByLabel(shop.email, { exact: false }).fill("stepper@example.test");
    await summary.getByRole("button", { name: shop.continuePay, exact: true }).click();
    await expect(page.getByRole("heading", { name: shop.sectionPay })).toBeFocused();
    await expect(page.getByText(shop.payBody("$52.50"))).toBeVisible();
    await expect(summary.getByRole("button", { name: shop.remove })).toHaveCount(0);
    expect(placed).toMatchObject({
        client: { name: "Stepper Test", email: "stepper@example.test", phone: null },
        lines: [{ item_id: "it_shampoo", quantity: 1 }],
    });
});

test("the shop's order panel folds into a bottom bar on a phone", async ({ page }) => {
    const shop = strings.publicShop;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${home}/shop`);
    await expect(page.locator("aside")).toBeHidden();
    await page
        .getByRole("group", { name: "Rope Tug Toy", exact: true })
        .getByRole("button", { name: shop.addNamed("Rope Tug Toy") })
        .click();
    const bar = page.locator("details").filter({ hasText: shop.items(1) });
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("button", { name: shop.remove })).toBeHidden();
    await bar.locator("summary").click();
    await expect(bar.getByRole("button", { name: shop.remove })).toBeVisible();
    await bar.locator("summary").click();
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.goto(`${home}/shop?cart=1`);
    await expect(bar.getByRole("button", { name: shop.remove })).toBeVisible();
    await page.getByRole("button", { name: shop.checkout, exact: true }).click();
    await expect(page.getByRole("heading", { name: shop.sectionPickup })).toBeVisible();
    await page.getByRole("button", { name: shop.continue, exact: true }).click();
    await expect(page.getByLabel(shop.name, { exact: true })).toBeVisible();
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
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
    await expect(page.getByRole("button", { name: /^Dog Walk/ })).toBeVisible();
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

test("a business with nothing bookable online says so", async ({ page }) => {
    await page.route(`${api}/book/${slug}/services`, (route) =>
        rewrite(route, (body) => ({ ...body, services: [] })),
    );
    await page.goto(`${home}/book`);
    await expect(page.getByText(strings.publicBooking.nothingBookable)).toBeVisible();
    await expect(
        page.getByRole("heading", { name: strings.publicBooking.stepService }),
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

test("bank setup rejects a missing link and removes provider secrets from the URL", async ({
    page,
}) => {
    await page.goto(
        "/payment-method?setup_intent_client_secret=secret&setup_intent=seti_test&redirect_status=succeeded",
    );
    await expect(
        page.getByRole("heading", { name: strings.checkout.bankSetupTitle }),
    ).toBeVisible();
    await expect(page.getByText(strings.checkout.bankSetupUnavailable)).toBeVisible();
    await expect(page).toHaveURL(/\/payment-method$/);
});
