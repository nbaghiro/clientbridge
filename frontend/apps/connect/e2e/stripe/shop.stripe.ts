import { randomUUID } from "node:crypto";
import { formatMoney, saleNumber, strings } from "@clientbridge/app-core/public";
import { devices, expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { demoSlug } from "@clientbridge/config/e2e/run";
import { textsTo } from "../../../web/e2e/support/auth";
import { bookingApi } from "../../../web/e2e/support/bookings";
import { patchBusiness } from "../../../web/e2e/support/business";
import { select } from "../../../web/e2e/support/db";
import { pickupEvidence } from "../../../web/e2e/support/pos";
import { navigate, signIn } from "../../../web/e2e/support/session";
import { apiCall, onlineBooker } from "../../../web/e2e/support/visit";
import { on } from "../support/hosts";
import { ownAddress } from "../support/network";
import { deskPayments, stripeIntent } from "./support/desk";
import { webBaseUrl } from "./support/program";
import { cardFrame, enterStripeCard, stripeReady } from "./support/provider";

const shop = strings.publicShop;
const SHAMPOO = { name: "Oatmeal Soothe Shampoo (500ml)", cents: 2400, price: "$24.00" };
const shopPage = (): string => on("shop", `/${demoSlug("birchbark")}`);

interface Product {
    id: string;
    name: string;
}

// $25 a unit, taxed like the rest of the shelf
async function stockedProduct(owner: Page, name: string, units: number): Promise<Product> {
    const item = await apiCall<{ id: string }>(
        owner,
        "POST",
        "/v1/items",
        {
            kind: "product",
            name,
            sku: `BB-${randomUUID().slice(0, 6).toUpperCase()}`,
            price_cents: 2500,
            tax_class: "standard",
            track_stock: true,
            sell_online: true,
            active: true,
        },
        201,
    );
    await apiCall(owner, "POST", `/v1/items/${item.id}/restock`, { quantity: units }, 200);
    return { id: item.id, name };
}

async function stockOf(id: string): Promise<{ stock: number; sales: number }> {
    const [row] = await select<{ stock: number; sales: number }>`
        SELECT i.stock_on_hand AS stock,
            (SELECT COUNT(*)::int FROM inventory m WHERE m.item_id = i.id AND m.reason = 'sale') AS sales
        FROM items i WHERE i.id = ${id}`;
    if (row === undefined) throw new Error(`item ${id} is missing`);
    return row;
}

/** A shopper on a phone, with the run's own address for our API only. */
async function shopperOnPhone(browser: Browser, info: TestInfo): Promise<Page> {
    const context = await browser.newContext({ ...devices["iPhone 13"], locale: "en-CA" });
    await ownAddress(context, info);
    return context.newPage();
}

async function fillCart(page: Page, products: Product[]): Promise<void> {
    await page.goto(shopPage());
    for (const product of products)
        await page
            .getByRole("group", { name: product.name, exact: true })
            .getByRole("button", { name: shop.addNamed(product.name) })
            .click();
    await page.getByRole("button", { name: shop.checkout, exact: true }).first().click();
    await page.getByRole("button", { name: shop.continue, exact: true }).first().click();
}

function placing(page: Page) {
    return page.waitForResponse(
        (r) =>
            new URL(r.url()).pathname === `/book/${demoSlug("birchbark")}/shop/orders` &&
            r.request().method() === "POST",
    );
}

async function payOnPage(page: Page, amount: string): Promise<void> {
    await enterStripeCard(await cardFrame(page), "4242424242424242");
    // a click outside the card form closes its country list, which would take the Pay click
    await page.getByRole("heading", { name: shop.sectionPay, exact: true }).click();
    const pay = page.getByRole("button", { name: shop.pay(amount), exact: true });
    await pay.scrollIntoViewIfNeeded();
    await pay.click();
    await expect(page.getByRole("heading", { name: shop.doneTitle, exact: true })).toBeVisible({
        timeout: 60_000,
    });
}

async function settled(orderId: string): Promise<void> {
    await expect
        .poll(async () => (await deskPayments(orderId)).map((p) => p.status), { timeout: 120_000 })
        .toEqual(["succeeded"]);
}

test("STRIPE-BROWSER-07 with tax registration off, a shop order paid by card charges no tax", async ({
    browser,
}, info) => {
    test.setTimeout(300_000);
    await stripeReady();
    const ownerContext = await browser.newContext({ baseURL: webBaseUrl() });
    const owner = await ownerContext.newPage();
    await signIn(owner);
    expect((await patchBusiness(owner, { tax_registered: false })).status()).toBe(200);
    const clientContext = await browser.newContext();
    // only our API gets the run's own address; Stripe's captcha refuses the header
    await ownAddress(clientContext, info);
    try {
        const page = await clientContext.newPage();
        await page.goto(on("shop", `/${demoSlug("birchbark")}`));
        await expect(page.getByText(shop.taxNote)).toHaveCount(0);
        await page
            .getByRole("group", { name: SHAMPOO.name, exact: true })
            .getByRole("button", { name: shop.addNamed(SHAMPOO.name) })
            .click();
        const summary = page.locator("aside");
        await summary.getByRole("button", { name: shop.checkout, exact: true }).click();
        await summary.getByRole("button", { name: shop.continue, exact: true }).click();
        const buyer = onlineBooker("");
        await page.getByLabel(shop.name, { exact: true }).fill(buyer.name);
        await page.getByLabel(shop.phone, { exact: false }).fill(buyer.phone);
        const placing = page.waitForResponse(
            (r) =>
                new URL(r.url()).pathname === `/book/${demoSlug("birchbark")}/shop/orders` &&
                r.request().method() === "POST",
        );
        await summary.getByRole("button", { name: shop.continuePay, exact: true }).click();
        const placed = await placing;
        expect(placed.status(), await placed.text()).toBe(200);
        const order = (await placed.json()) as {
            order_id: string;
            subtotal_cents: number;
            tax_total_cents: number;
            total_cents: number;
        };
        expect(order).toMatchObject({
            subtotal_cents: SHAMPOO.cents,
            tax_total_cents: 0,
            total_cents: SHAMPOO.cents,
        });
        await expect(page.getByText(shop.payBodyNoTax(SHAMPOO.price))).toBeVisible();
        await enterStripeCard(await cardFrame(page), "4242424242424242");
        // a click outside the card form closes its country list, which would take the Pay click
        await page.getByRole("heading", { name: shop.sectionPay, exact: true }).click();
        const pay = page.getByRole("button", { name: shop.pay(SHAMPOO.price), exact: true });
        await pay.scrollIntoViewIfNeeded();
        await expect(pay).toBeInViewport({ ratio: 1 });
        await pay.click();
        await expect(page.getByRole("heading", { name: shop.doneTitle, exact: true })).toBeVisible({
            timeout: 60_000,
        });

        await expect
            .poll(async () => (await deskPayments(order.order_id)).map((p) => p.status), {
                timeout: 90_000,
            })
            .toEqual(["succeeded"]);
        const [payment] = await deskPayments(order.order_id);
        expect(payment).toMatchObject({
            method: "card",
            provider: "stripe",
            amount_cents: SHAMPOO.cents,
        });
        const intent = await stripeIntent(payment?.provider_ref ?? "");
        expect(intent).toMatchObject({
            status: "succeeded",
            amount: SHAMPOO.cents,
            currency: "cad",
        });
        const stored = await select<{ tax_total_cents: number; total_cents: number }>`
            SELECT tax_total_cents, total_cents FROM orders WHERE id = ${order.order_id}`;
        expect(stored).toEqual([{ tax_total_cents: 0, total_cents: SHAMPOO.cents }]);
        const legs = await select<{ category: string }>`
            SELECT DISTINCT a.category FROM entries e JOIN accounts a ON a.id = e.account_id
            WHERE (e.source_type = 'order' AND e.source_id = ${order.order_id})
                OR (e.subject_type = 'order' AND e.subject_id = ${order.order_id})`;
        const categories = legs.map((leg) => leg.category);
        expect(categories).toContain("revenue");
        expect(categories).not.toContain("tax");
    } finally {
        await patchBusiness(owner, { tax_registered: true });
        await clientContext.close();
        await ownerContext.close();
    }
});

test("STR-E22 a shop order paid on a phone with a real card is packed, made ready and picked up once", async ({
    browser,
}, info) => {
    test.setTimeout(420_000);
    await stripeReady();
    const d = strings.pos.desk;
    const p = strings.publicOrder;
    const ownerContext = await browser.newContext({ baseURL: webBaseUrl() });
    const owner = await ownerContext.newPage();
    await signIn(owner);
    const run = randomUUID().slice(0, 4).toUpperCase();
    const products = [
        await stockedProduct(owner, `Oat Shampoo ${run}`, 3),
        await stockedProduct(owner, `Slicker Brush ${run}`, 3),
    ];
    const buyer = onlineBooker("");
    const phone = await shopperOnPhone(browser, info);
    try {
        await fillCart(phone, products);
        await phone.getByLabel(shop.name, { exact: true }).fill(buyer.name);
        await phone.getByLabel(shop.phone, { exact: false }).fill(buyer.phone);
        const placed = placing(phone);
        await phone.getByRole("button", { name: shop.continuePay, exact: true }).first().click();
        const response = await placed;
        expect(response.status(), await response.text()).toBe(200);
        const order = (await response.json()) as {
            order_id: string;
            order_token: string;
            number: number;
            total_cents: number;
        };
        expect(order.total_cents).toBe(5600);
        await payOnPage(phone, formatMoney(order.total_cents, "CAD"));
        const done = phone.getByText(shop.doneBody(saleNumber(order.number)), { exact: true });
        await expect(done).toBeVisible();
        await phone.reload();
        await expect(done).toBeVisible();

        await settled(order.order_id);
        for (const product of products)
            expect(await stockOf(product.id)).toEqual({ stock: 2, sales: 1 });
        const [payment] = await deskPayments(order.order_id);
        expect(await stripeIntent(payment?.provider_ref ?? "")).toMatchObject({
            status: "succeeded",
            amount: 5600,
            currency: "cad",
        });
        const paid = await pickupEvidence(order.order_id);
        expect(paid.order[0]).toMatchObject({ source: "online", pickup_status: "unfulfilled" });

        const [mailed] = await select<{ n: number }>`
            SELECT COUNT(*)::int AS n FROM deliveries
            WHERE key LIKE ${`stripe:payment:${payment?.id ?? ""}:%`}
                AND payload->>'channel' = 'email'`;
        expect(mailed?.n).toBe(1);
        // the owner opens the app once the order is paid, as the alert asks
        await owner.reload();
        await owner
            .getByRole("button", { name: new RegExp(`^${strings.navigation.notifications}`) })
            .first()
            .click();
        const bell = owner.getByRole("dialog", { name: strings.navigation.notifications });
        await expect(
            bell.getByText(strings.notifications.kinds.orderNewBody(buyer.name, order.number), {
                exact: true,
            }),
        ).toBeVisible({ timeout: 60_000 });
        await owner.keyboard.press("Escape");

        await navigate(owner, "/payments/sales?view=board");
        const prepare = owner.getByRole("region", { name: d.toPrepare });
        const card = owner.locator("article").filter({ hasText: buyer.name });
        await expect(prepare.locator("article").filter({ hasText: buyer.name })).toBeVisible({
            timeout: 60_000,
        });
        await card.getByRole("button", { name: p.startPreparing, exact: true }).click();
        await expect(owner.getByText(p.preparingStarted, { exact: true })).toBeVisible();
        await card.getByRole("button", { name: d.markReady, exact: true }).click();
        await expect(owner.getByText(d.markedReady(buyer.name), { exact: true })).toBeVisible();
        await expect
            .poll(
                async () =>
                    (await textsTo(owner.request, buyer.phone)).filter(
                        ({ Snippet }) =>
                            Snippet.includes("is ready to pick up") &&
                            Snippet.includes(order.order_token),
                    ).length,
                { timeout: 60_000 },
            )
            .toBe(1);
        const status = await phone.context().newPage();
        await status.goto(on("shop", `/order/${order.order_token}`));
        await expect(status.getByRole("heading", { name: p.ready, level: 1 })).toBeVisible();

        await owner
            .getByRole("region", { name: d.readyForPickup })
            .locator("article")
            .filter({ hasText: buyer.name })
            .getByRole("button", { name: d.markPickedUp, exact: true })
            .click();
        await expect(owner.getByText(d.markedPickedUp(buyer.name), { exact: true })).toBeVisible();
        await status.reload();
        await expect(status.getByRole("heading", { name: p.collected, level: 1 })).toBeVisible();
        for (const back of ["preparing", "ready", "picked_up"]) {
            const refused = await owner.request.post(
                `${bookingApi()}/v1/orders/${order.order_id}/pickup`,
                { headers: { Origin: new URL(owner.url()).origin }, data: { status: back } },
            );
            expect(refused.status(), back).toBe(409);
        }
        const after = await pickupEvidence(order.order_id);
        expect(after.order[0]).toMatchObject({ pickup_status: "picked_up", picked_up: true });
        expect(after.payments).toEqual(paid.payments);
        for (const product of products)
            expect(await stockOf(product.id)).toEqual({ stock: 2, sales: 1 });
    } finally {
        await phone.context().close();
        await ownerContext.close();
    }
});

test("SALE-E2E-17 two shoppers checking out the last unit: one pays, the other is told and their cart trimmed", async ({
    browser,
}, info) => {
    test.setTimeout(300_000);
    await stripeReady();
    const ownerContext = await browser.newContext({ baseURL: webBaseUrl() });
    const owner = await ownerContext.newPage();
    await signIn(owner);
    const product = await stockedProduct(owner, `Last Balm ${randomUUID().slice(0, 4)}`, 1);
    const first = await shopperOnPhone(browser, info);
    const second = await shopperOnPhone(browser, info);
    const winner = onlineBooker("");
    const loser = onlineBooker("");
    try {
        for (const [page, who] of [
            [first, winner],
            [second, loser],
        ] as const) {
            await fillCart(page, [product]);
            await page.getByLabel(shop.name, { exact: true }).fill(who.name);
            await page.getByLabel(shop.phone, { exact: false }).fill(who.phone);
        }
        const won = placing(first);
        await first.getByRole("button", { name: shop.continuePay, exact: true }).first().click();
        const winning = await won;
        expect(winning.status(), await winning.text()).toBe(200);
        const order = (await winning.json()) as { order_id: string; total_cents: number };

        const lost = placing(second);
        await second.getByRole("button", { name: shop.continuePay, exact: true }).first().click();
        const losing = await lost;
        expect(losing.status(), await losing.text()).toBe(409);
        expect(await losing.json()).toMatchObject({ error: "out_of_stock" });
        const told = second.getByRole("alert").getByText(shop.stockChanged(product.name), {
            exact: true,
        });
        await expect(told).toBeInViewport();
        await expect(second.getByRole("heading", { name: shop.cartEmpty })).toBeVisible();
        await second.goto(shopPage());
        await expect(
            second
                .getByRole("group", { name: product.name, exact: true })
                .getByText(shop.soldOut, { exact: true }),
        ).toBeVisible();

        await payOnPage(first, formatMoney(order.total_cents, "CAD"));
        await settled(order.order_id);
        expect(await stockOf(product.id)).toEqual({ stock: 0, sales: 1 });
        const orders = await select<{ id: string }>`
            SELECT o.id FROM orders o JOIN lines l ON l.order_id = o.id
            WHERE l.item_id = ${product.id}`;
        expect(orders).toEqual([{ id: order.order_id }]);
    } finally {
        await first.context().close();
        await second.context().close();
        await ownerContext.close();
    }
});
