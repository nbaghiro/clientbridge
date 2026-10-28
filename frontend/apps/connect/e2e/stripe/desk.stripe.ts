import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import { runPort } from "@clientbridge/config/e2e/run";
import { saleEvidence, stockProduct } from "../../../web/e2e/support/pos";
import { signIn } from "../../../web/e2e/support/session";
import {
    cardFrame,
    choose,
    deskPayments,
    paySheet,
    ringUpWalkIn,
    stripeIntent,
} from "./support/desk";
import { stripeReady } from "./support/provider";

test.use({ actionTimeout: 60_000 });
const d = strings.pos.desk;

test("STR-E05 a canceled desk card checkout is canceled in Stripe and the sale is paid in cash", async ({
    browser,
}, info) => {
    await stripeReady();
    const context = await browser.newContext({
        baseURL: `http://localhost:${String(runPort("WEB_E2E_PORT"))}`,
    });
    const calls: string[] = [];
    try {
        const page = await context.newPage();
        page.on("response", (result) => {
            if (new URL(result.url()).pathname.startsWith("/v1/orders"))
                calls.push(
                    `${result.request().method()} ${result.url()} ${String(result.status())}`,
                );
        });
        await signIn(page);
        const product = await stockProduct(page, {
            name: "Calming Coat Spray",
            prefix: "BB-CS",
            priceCents: 2000,
            taxClass: "exempt",
            stock: 3,
        });
        const payment = await ringUpWalkIn(page, product, "$20.00");
        await choose(payment, d.methodCard);
        const opened = page.waitForResponse(
            (response) =>
                /\/v1\/orders\/[^/]+\/pay$/.test(response.url()) &&
                response.request().method() === "POST",
        );
        await payment.getByRole("button", { name: d.charge("$20.00"), exact: true }).click();
        const response = await opened;
        expect(response.status(), await response.text()).toBe(200);
        const checkout = (await response.json()) as { order_id: string; payment_id: string };
        await cardFrame(page);
        const [card] = await deskPayments(checkout.order_id);
        const intentId = card?.provider_ref ?? "";
        expect(card).toMatchObject({
            id: checkout.payment_id,
            method: "card",
            provider: "stripe",
            status: "pending",
            amount_cents: 2000,
        });
        expect(await stripeIntent(intentId)).toMatchObject({
            status: "requires_payment_method",
            amount: 2000,
            currency: "cad",
            metadata: { order_id: checkout.order_id },
        });

        const canceled = page.waitForResponse(
            (result) =>
                result.url().endsWith(`/v1/orders/${checkout.order_id}/checkout/cancel`) &&
                result.request().method() === "POST",
        );
        await page
            .getByRole("dialog")
            .getByRole("button", { name: strings.common.cancel, exact: true })
            .click();
        expect((await canceled).status()).toBe(200);
        expect(await stripeIntent(intentId)).toMatchObject({ status: "canceled" });
        expect((await deskPayments(checkout.order_id))[0]?.status).toBe("canceled");

        const sheet = paySheet(page);
        await choose(sheet, d.methodCash);
        await sheet.getByRole("textbox", { name: d.cashGiven, exact: true }).fill("20.00");
        const cash = page.waitForResponse(
            (result) =>
                result.url().endsWith(`/v1/orders/${checkout.order_id}/cash`) &&
                result.request().method() === "POST",
        );
        await sheet.getByRole("button", { name: d.charge("$20.00"), exact: true }).click();
        expect((await cash).status()).toBe(200);
        await expect(page.getByRole("heading", { name: d.paidTitle, exact: true })).toBeVisible();

        const payments = await deskPayments(checkout.order_id);
        expect(payments).toEqual([
            { ...card, status: "canceled" },
            {
                id: expect.any(String),
                order_id: checkout.order_id,
                method: "cash",
                provider: "manual",
                provider_ref: null,
                status: "succeeded",
                amount_cents: 2000,
                tendered_cents: 2000,
            },
        ]);
        const sale = await saleEvidence(product.id);
        expect(sale.orders).toEqual([
            expect.objectContaining({ id: checkout.order_id, total_cents: 2000, paid: true }),
        ]);
        expect(
            sale.entries
                .map(({ category, amount_cents, source_id }) => ({
                    category,
                    amount_cents,
                    source_id,
                }))
                .sort((a, b) => a.category.localeCompare(b.category)),
        ).toEqual([
            { category: "cash", amount_cents: 2000, source_id: payments[1]?.id },
            { category: "revenue", amount_cents: -2000, source_id: payments[1]?.id },
        ]);
        expect(await stripeIntent(intentId)).toMatchObject({ status: "canceled", charge: null });
        await info.attach("desk-cancel-then-cash", {
            body: JSON.stringify({ payments, intent: await stripeIntent(intentId) }),
            contentType: "application/json",
        });
    } finally {
        await info.attach("order-calls", { body: calls.join("\n"), contentType: "text/plain" });
        await context.close();
    }
});
