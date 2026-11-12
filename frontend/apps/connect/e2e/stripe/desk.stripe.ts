import { randomUUID } from "node:crypto";
import { strings } from "@clientbridge/app-core/public";
import { expect, test, type Page } from "@playwright/test";
import { runPort } from "@clientbridge/config/e2e/run";
import { bookingApi } from "../../../web/e2e/support/bookings";
import { createClient } from "../../../web/e2e/support/clients";
import {
    choosePaymentMethod,
    paymentPanel,
    saleEvidence,
    saleTicket,
    stockProduct,
} from "../../../web/e2e/support/pos";
import { signIn } from "../../../web/e2e/support/session";
import {
    chargeDesk,
    deskPayments,
    ringUpForClient,
    ringUpWalkIn,
    stripeIntent,
    submitDeskCard,
    type DeskCheckout,
} from "./support/desk";
import {
    categoryTotals,
    clientMoney,
    expectLedgerMatchesStripe,
    registerPurchaser,
} from "./support/disputes";
import { saveCardUi } from "./support/memberships";
import { cardFrame, enterStripeCard, stripeReady } from "./support/provider";
import { savedMethods, walletEvidence } from "./support/wallet";

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
        await choosePaymentMethod(payment, d.methodCard);
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
        await paymentPanel(page)
            .getByRole("button", { name: strings.common.cancel, exact: true })
            .click();
        expect((await canceled).status()).toBe(200);
        expect(await stripeIntent(intentId)).toMatchObject({ status: "canceled" });
        expect((await deskPayments(checkout.order_id))[0]?.status).toBe("canceled");

        const sheet = paymentPanel(page);
        await choosePaymentMethod(sheet, d.methodCash);
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

/** The sale settled through one Stripe charge, and the books hold that charge's net and fee. */
async function expectDeskSettled(clientId: string, checkout: DeskCheckout, productId: string) {
    await expect
        .poll(
            async () =>
                (await deskPayments(checkout.order_id)).map((p) => [
                    p.id,
                    p.status,
                    p.amount_cents,
                ]),
            { timeout: 120_000 },
        )
        .toEqual([[checkout.payment_id, "succeeded", 2000]]);
    const [paid] = await deskPayments(checkout.order_id);
    const stripe = await walletEvidence(clientId);
    expect(stripe.intents.map((i) => [i.id, i.status, i.amount])).toEqual([
        [paid?.provider_ref, "succeeded", 2000],
    ]);
    const charge = stripe.intents[0]?.charge;
    if (!charge) throw new Error("the desk charge has no Stripe evidence");
    expect(charge.charge).toMatchObject({ amount: 2000, amount_refunded: 0, disputed: false });
    await expect
        .poll(async () => categoryTotals((await clientMoney(clientId)).entries).revenue ?? 0, {
            timeout: 120_000,
        })
        .toBe(-2000);
    const money = await clientMoney(clientId);
    expectLedgerMatchesStripe(money.entries, charge);
    expect(new Set(money.entries.map((e) => e.ref))).toEqual(
        new Set([`payment:${checkout.payment_id}`, `fee:${checkout.payment_id}`]),
    );
    const sale = await saleEvidence(productId);
    expect(sale.orders.find((o) => o.id === checkout.order_id)).toMatchObject({
        total_cents: 2000,
        paid: true,
    });
    return { stripe, money };
}

async function newSale(page: Page): Promise<void> {
    await saleTicket(page).getByRole("button", { name: d.newSale, exact: true }).click();
}

function payAgain(page: Page, orderId: string, data: Record<string, unknown>) {
    return page.request.post(`${bookingApi()}/v1/orders/${orderId}/pay`, {
        headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
        data: { tip_cents: 0, ...data },
    });
}

test("STR-E19 desk card sales settle once with Stripe's fee: a new card, a client's saved card, and a declined card that then pays", async ({
    browser,
}, info) => {
    test.setTimeout(600_000);
    await stripeReady();
    const context = await browser.newContext({
        baseURL: `http://localhost:${String(runPort("WEB_E2E_PORT"))}`,
    });
    try {
        const page = await context.newPage();
        await signIn(page);
        const product = await stockProduct(page, {
            name: "Detangling Mist",
            prefix: "BB-DM",
            priceCents: 2000,
            taxClass: "exempt",
            stock: 3,
        });
        const evidence: Record<string, unknown> = {};

        await test.step("a new card pays the sale once, and a paid sale can't be charged again", async () => {
            const client = await createClient(page);
            await registerPurchaser(client.id);
            const payment = await ringUpForClient(page, {
                product,
                stock: 3,
                client,
                charge: "$20.00",
            });
            const checkout = await chargeDesk(page, payment, d.methodCard, "$20.00");
            await enterStripeCard(await cardFrame(page), "4242424242424242");
            await submitDeskCard(page, "$20.00");
            await expect(
                page.getByRole("heading", { name: d.paidTitle, exact: true }),
            ).toBeVisible();
            evidence.card = await expectDeskSettled(client.id, checkout, product.id);
            const again = await payAgain(page, checkout.order_id, {});
            expect(again.status(), await again.text()).toBe(409);
            expect((await walletEvidence(client.id)).intents).toHaveLength(1);
            await newSale(page);
        });

        const saved = await createClient(page);
        await registerPurchaser(saved.id);
        await saveCardUi(page, saved);
        const [card] = await savedMethods(saved.id);
        if (!card?.provider_ref) throw new Error("the saved card has no Stripe method");

        await test.step("a client's saved card is charged at the desk without the card form", async () => {
            const payment = await ringUpForClient(page, {
                product,
                stock: 2,
                client: saved,
                charge: "$20.00",
            });
            const checkout = await chargeDesk(page, payment, "4242", "$20.00");
            expect(checkout.body).toMatchObject({ payment_method_id: card.id });
            await expect(
                page.getByRole("heading", { name: d.paidTitle, exact: true }),
            ).toBeVisible();
            const settled = await expectDeskSettled(saved.id, checkout, product.id);
            expect(settled.stripe.intents[0]?.payment_method).toBe(card.provider_ref);
            evidence.saved = settled;
            await newSale(page);
        });

        await test.step("a declined card leaves the sale unpaid, and the same sale then pays", async () => {
            const client = await createClient(page);
            await registerPurchaser(client.id);
            const payment = await ringUpForClient(page, {
                product,
                stock: 1,
                client,
                charge: "$20.00",
            });
            const checkout = await chargeDesk(page, payment, d.methodCard, "$20.00");
            await enterStripeCard(await cardFrame(page), "4000000000000002");
            await submitDeskCard(page, "$20.00");
            await expect(paymentPanel(page).getByRole("alert")).toContainText(/declined/i);
            await expect(page.getByRole("heading", { name: d.paidTitle, exact: true })).toHaveCount(
                0,
            );
            const [pending] = await deskPayments(checkout.order_id);
            const intentId = pending?.provider_ref ?? "";
            await expect
                .poll(async () => (await stripeIntent(intentId)).status)
                .toBe("requires_payment_method");
            await expect
                .poll(async () => (await deskPayments(checkout.order_id)).map((p) => p.status), {
                    timeout: 60_000,
                })
                .toEqual(["failed"]);
            expect((await clientMoney(client.id)).entries).toEqual([]);
            const sale = await saleEvidence(product.id);
            expect(sale.orders.find((o) => o.id === checkout.order_id)?.paid).toBe(false);

            // another client's card, or a default the client doesn't have, is refused
            const borrowed = await payAgain(page, checkout.order_id, {
                payment_method_id: card.id,
            });
            expect(borrowed.status(), await borrowed.text()).toBe(404);
            const none = await payAgain(page, checkout.order_id, { payment_method_id: "default" });
            expect(none.status(), await none.text()).toBe(404);
            expect((await walletEvidence(client.id)).intents.map((i) => i.id)).toEqual([intentId]);

            await enterStripeCard(await cardFrame(page), "4242424242424242");
            await submitDeskCard(page, "$20.00");
            await expect(
                page.getByRole("heading", { name: d.paidTitle, exact: true }),
            ).toBeVisible();
            const settled = await expectDeskSettled(client.id, checkout, product.id);
            expect(settled.stripe.intents[0]?.id).toBe(intentId);
            evidence.declined = settled;
        });

        await info.attach("str-e19", {
            body: JSON.stringify(evidence, null, 2),
            contentType: "application/json",
        });
    } finally {
        await context.close();
    }
});
