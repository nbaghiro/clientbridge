import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import { demoSlug } from "@clientbridge/config/e2e/run";
import { patchBusiness } from "../../../web/e2e/support/business";
import { select } from "../../../web/e2e/support/db";
import { signIn } from "../../../web/e2e/support/session";
import { onlineBooker } from "../../../web/e2e/support/visit";
import { on } from "../support/hosts";
import { ownAddress } from "../support/network";
import { deskPayments, stripeIntent } from "./support/desk";
import { webBaseUrl } from "./support/program";
import { cardFrame, enterStripeCard, stripeReady } from "./support/provider";

const shop = strings.publicShop;
const SHAMPOO = { name: "Oatmeal Soothe Shampoo (500ml)", cents: 2400, price: "$24.00" };

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
        await page.getByRole("button", { name: shop.pay(SHAMPOO.price), exact: true }).click();
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
