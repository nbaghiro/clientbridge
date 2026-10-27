import { strings } from "@clientbridge/app-core/public";
import { freshPhone } from "../../web/e2e/support/auth";
import { expect, test } from "@playwright/test";
import { on } from "./hosts";
import { links } from "./links";
import { ownAddress, rewrite, type Json } from "./network";
import { demoSlug, runUrl, demoId } from "@clientbridge/config/e2e/run";
import { watchErrors } from "./errors";

const slug = demoSlug("birchbark");
const shopPage = on("shop", `/${slug}`);
const api = runUrl("VITE_API_URL");

test.beforeEach(async ({ context }, info) => {
    await ownAddress(context, info);
});

test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("a client finds the shop from the landing page and fills a cart", async ({ page }) => {
    const errors = watchErrors(page);
    const shop = strings.publicShop;
    await page.goto(on(links.slug, "/"));
    await expect(
        page.getByRole("button", { name: strings.publicLanding.book }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: strings.publicBooking.shopLink }).click();
    await expect(page).toHaveURL(on("shop", `/${links.slug}`));
    await expect(page.getByRole("heading", { name: shop.title, level: 1 })).toBeVisible();
    await page
        .getByRole("group", { name: "Self-Cleaning Slicker Brush", exact: true })
        .getByRole("button", { name: shop.addNamed("Self-Cleaning Slicker Brush") })
        .click();
    const summary = page.locator("aside");
    await expect(summary.getByRole("button", { name: shop.remove })).toBeVisible();
    await summary.getByRole("button", { name: shop.checkout }).click();
    await expect(page).toHaveURL(/\/checkout$/);
    await expect(page.getByRole("heading", { name: shop.checkout, level: 1 })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: shop.remove })).toBeVisible();
    expect(errors).toEqual([]);
});

test(
    "product deep links, cart, and checkout contact details survive navigation and reload",
    { tag: "@browsers" },
    async ({ page, request }) => {
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
        await page.goto(`${shopPage}?product=${product?.id ?? ""}`);
        await expect(page).toHaveURL(shopPage);
        const card = page.locator(`#product-${product?.id ?? ""}`);
        await expect(card.getByRole("button", { name: /./ }).first()).toBeFocused();
        await card
            .getByRole("button", { name: strings.publicShop.addNamed(product?.name ?? "") })
            .click();
        const summary = page.locator("aside");
        await summary
            .getByRole("button", { name: strings.publicShop.checkout, exact: true })
            .click();
        await expect(page).toHaveURL(`${shopPage}/checkout`);
        await summary
            .getByRole("button", { name: strings.publicShop.continue, exact: true })
            .click();
        await page.getByLabel(strings.publicShop.name, { exact: true }).fill("Morgan Ellis");
        await page.getByLabel(strings.publicShop.phone, { exact: false }).fill("+16045550223");
        const nav = page.getByRole("navigation", { name: strings.publicLanding.navigation });
        await nav.locator("summary").click();
        await nav.getByRole("link", { name: strings.publicLanding.home, exact: true }).click();
        await page
            .getByRole("button", { name: strings.publicBooking.shopLink, exact: true })
            .click();
        await nav
            .getByRole("link", { name: strings.common.withCount(strings.publicLanding.cart, 1) })
            .click();
        await expect(page).toHaveURL(shopPage);
        await expect(page.getByRole("heading", { name: strings.publicShop.cart })).toBeFocused();
        await summary
            .getByRole("button", { name: strings.publicShop.checkout, exact: true })
            .click();
        await summary
            .getByRole("button", { name: strings.publicShop.continue, exact: true })
            .click();
        await expect(page.getByLabel(strings.publicShop.name, { exact: true })).toHaveValue(
            "Morgan Ellis",
        );
        await page.reload();
        await summary
            .getByRole("button", { name: strings.publicShop.continue, exact: true })
            .click();
        await expect(page.getByLabel(strings.publicShop.phone, { exact: false })).toHaveValue(
            "+16045550223",
        );
    },
);

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
    await page.goto(shopPage);
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
    await page.getByLabel(shop.name, { exact: true }).fill("Avery Laurent");
    await page.getByLabel(shop.phone, { exact: false }).fill("+16045550224");
    await summary.getByRole("button", { name: shop.continuePay, exact: true }).click();
    await expect(page.getByRole("heading", { name: shop.sectionPay })).toBeFocused();
    await expect(page.getByText(shop.payBody("$52.50"))).toBeVisible();
    await expect(summary.getByRole("button", { name: shop.remove })).toHaveCount(0);
    expect(placed).toMatchObject({
        client: { name: "Avery Laurent", phone: "+16045550224" },
        lines: [{ item_id: demoId("it_shampoo"), quantity: 1 }],
    });
});

test(
    "SALE-E2E-03 a shop order whose response was lost resumes after reload with one key",
    { tag: "@browsers" },
    async ({ page }) => {
        const shop = strings.publicShop;
        await page.route(`${api}/book/${slug}/shop`, (route) =>
            rewrite(route, (body) => ({ ...body, stripe_account_id: "acct_e2e" })),
        );
        const keys: (string | undefined)[] = [];
        await page.route(`${api}/book/${slug}/shop/orders`, async (route) => {
            keys.push(route.request().headers()["idempotency-key"]);
            if (keys.length === 1) {
                await route.abort("connectionreset");
                return;
            }
            await route.fulfill({
                json: {
                    order_id: "ord_01E2ERESUMEDORDER",
                    order_token: null,
                    subtotal_cents: 2400,
                    tax_total_cents: 120,
                    total_cents: 2520,
                    currency: "CAD",
                    client_secret: "pi_e2e_resumed_secret",
                    stripe_account_id: "acct_e2e",
                },
            });
        });
        const summary = page.locator("aside");
        const toPay = async (): Promise<void> => {
            await expect(page.getByRole("heading", { name: shop.sectionPickup })).toBeVisible();
            await summary.getByRole("button", { name: shop.continue, exact: true }).click();
            await expect(page.getByRole("heading", { name: shop.sectionDetails })).toBeFocused();
            await summary.getByRole("button", { name: shop.continuePay, exact: true }).click();
        };
        await page.goto(shopPage);
        const card = page.getByRole("group", {
            name: "Oatmeal Soothe Shampoo (500ml)",
            exact: true,
        });
        await card
            .getByRole("button", { name: shop.addNamed("Oatmeal Soothe Shampoo (500ml)") })
            .click();
        await summary.getByRole("button", { name: shop.checkout, exact: true }).click();
        await expect(page.getByRole("heading", { name: shop.sectionPickup })).toBeVisible();
        await summary.getByRole("button", { name: shop.continue, exact: true }).click();
        await page.getByLabel(shop.name, { exact: true }).fill("Avery Laurent");
        await page.getByLabel(shop.phone, { exact: false }).fill(freshPhone());
        await summary.getByRole("button", { name: shop.continuePay, exact: true }).click();
        await expect.poll(() => keys.length).toBe(1);
        await expect(page.getByRole("alert").getByText(shop.orderError)).toBeVisible();
        await expect(page.getByText(shop.payBody("$25.20"))).toHaveCount(0);

        await page.reload();
        await toPay();
        await expect(page.getByRole("heading", { name: shop.sectionPay })).toBeFocused();
        await expect(page.getByText(shop.payBody("$25.20"))).toBeVisible();
        expect(keys).toHaveLength(2);
        expect(keys[0]).toBeTruthy();
        expect(keys[1]).toBe(keys[0]);

        await page.reload();
        await expect(page.getByText(shop.payBody("$25.20"))).toBeVisible();
        await expect(page.getByRole("button", { name: shop.continuePay })).toHaveCount(0);
        expect(keys).toHaveLength(2);
    },
);

test("the shop's order panel folds into a bottom bar on a phone", async ({ page }) => {
    const shop = strings.publicShop;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(shopPage);
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
    await page.goto(`${shopPage}?cart=1`);
    await expect(bar.getByRole("button", { name: shop.remove })).toBeVisible();
    await page.getByRole("button", { name: shop.checkout, exact: true }).click();
    await expect(page.getByRole("heading", { name: shop.sectionPickup })).toBeVisible();
    await page.getByRole("button", { name: shop.continue, exact: true }).click();
    await expect(page.getByLabel(shop.name, { exact: true })).toBeVisible();
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
});
