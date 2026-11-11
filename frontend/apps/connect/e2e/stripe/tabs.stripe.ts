import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import { documentApi } from "../support/documents";
import { on } from "../support/hosts";
import {
    enterStripeCard,
    openRegisteredStripeInvoice,
    settledStripeInvoice,
    stripeEvidence,
    stripeInvoice,
    submitStripeCard,
} from "./support/provider";
import { controlStripeRelay } from "./support/bridge";
import { expectOneSettlement } from "./support/tabs";

test("STR-E06 one invoice in two tabs: a decline in the first, then both pay, and only one charge goes through", async ({
    context,
    request,
}, info) => {
    const invoice = await stripeInvoice(request);
    const url = on("pay", `/i/${invoice.pay_token}`);
    const first = await context.newPage();
    const second = await context.newPage();
    const { payment: firstCard } = await openRegisteredStripeInvoice(first, invoice, url);
    await enterStripeCard(firstCard, "4000000000000002");
    await submitStripeCard(first, info);
    await expect(first.getByRole("alert")).toContainText(/declined/i);
    let declined = await stripeEvidence(invoice.id);
    await expect(async () => {
        declined = await stripeEvidence(invoice.id);
        expect(declined.payments).toEqual([expect.objectContaining({ status: "failed" })]);
        expect(declined.stripe[0]).toMatchObject({
            status: "requires_payment_method",
            decline_code: "generic_decline",
        });
    }).toPass({ timeout: 60_000 });
    const firstIntent = declined.stripe[0]?.id;

    const { payment: secondCard } = await openRegisteredStripeInvoice(second, invoice, url);
    let superseded = declined;
    await expect(async () => {
        superseded = await stripeEvidence(invoice.id);
        expect(superseded.payments.map((row) => row.status)).toEqual(["canceled", "pending"]);
    }).toPass({ timeout: 30_000 });
    expect(superseded.stripe.map((row) => [row.id, row.status])).toEqual([
        [firstIntent, "canceled"],
        [superseded.payments[1]?.provider_ref, "requires_payment_method"],
    ]);

    await enterStripeCard(firstCard, "4242424242424242");
    await submitStripeCard(first, info);
    // the second tab replaced this attempt, so the first says so and offers a fresh one
    await expect(first.getByText(strings.publicPay.cardCanceled, { exact: true })).toBeVisible();
    await expect(
        first.getByRole("button", { name: strings.publicPay.continueToPay, exact: true }),
    ).toBeVisible();
    await expect(first.getByRole("heading", { name: strings.publicPay.paidTitle })).toHaveCount(0);
    const refused = await stripeEvidence(invoice.id);
    expect(refused.stripe[0]).toMatchObject({ id: firstIntent, status: "canceled" });
    expect(refused.stripe[0]?.charge_paid ?? false).toBe(false);
    expect(refused.entries).toEqual([]);

    await enterStripeCard(secondCard, "4242424242424242");
    await submitStripeCard(second, info);
    await expect(second.getByRole("heading", { name: strings.publicPay.paidTitle })).toBeVisible();
    const settled = await expectOneSettlement(request, invoice, firstIntent ?? "");
    await first.reload();
    await expect(first.getByRole("heading", { name: strings.publicPay.paidTitle })).toBeVisible();
    await expect(first.getByRole("button", { name: strings.publicPay.continueToPay })).toHaveCount(
        0,
    );
    const state = await request.get(`${documentApi}/pay/${invoice.pay_token}`);
    expect(await state.json()).toMatchObject({ status: "paid", balance_cents: 0 });
    await info.attach("two-tab-settlement", {
        body: JSON.stringify(settled, null, 2),
        contentType: "application/json",
    });
});

test("STR-E33 while Stripe's payment event is held the invoice stays unpaid in the books and a second tab can't charge it again, then the event settles it once however often it comes", async ({
    context,
    request,
}, info) => {
    test.setTimeout(240_000);
    const pp = strings.publicPay;
    const invoice = await stripeInvoice(request);
    const url = on("pay", `/i/${invoice.pay_token}`);
    const first = await context.newPage();
    const { payment } = await openRegisteredStripeInvoice(first, invoice, url);
    const intent = (await stripeEvidence(invoice.id)).stripe[0]?.id;
    if (intent === undefined) throw new Error("the pay link opened no Stripe intent");
    await controlStripeRelay(first, "arm", { invoice: invoice.id, intent });
    await enterStripeCard(payment, "4242424242424242");
    await submitStripeCard(first, info);
    await expect(first.getByRole("heading", { name: pp.paidTitle })).toBeVisible();
    await expect.poll(async () => (await controlStripeRelay(first, "status")).held).toBe(true);
    const held = await stripeEvidence(invoice.id);
    expect(held.payments).toEqual([
        expect.objectContaining({ status: "pending", provider_ref: intent, amount_cents: 2000 }),
    ]);
    expect(held.stripe).toEqual([
        expect.objectContaining({
            id: intent,
            status: "succeeded",
            charge_paid: true,
            amount_captured: 2000,
        }),
    ]);
    expect(held.entries).toEqual([]);
    expect(held.webhooks).toEqual([]);
    const shown = await request.get(`${documentApi}/pay/${invoice.pay_token}`);
    expect(await shown.json()).toMatchObject({ status: "sent", balance_cents: 2000, paying: true });

    // Stripe took the card, so a second tab reads as paid and offers nothing to pay
    const second = await context.newPage();
    await second.goto(url);
    await expect(second.getByRole("heading", { name: pp.paidTitle })).toBeVisible();
    await expect(second.getByRole("button", { name: pp.continueToPay })).toHaveCount(0);
    await expect(second.getByRole("alert")).toHaveCount(0);
    const refused = await request.post(`${documentApi}/pay/${invoice.pay_token}/card`, {
        data: { balance_cents: 2000, tip_cents: 0 },
    });
    expect(refused.status()).toBe(409);
    expect(await refused.json()).toMatchObject({ error: "payment_in_progress" });
    const stillHeld = await stripeEvidence(invoice.id);
    expect(stillHeld.provider_intent_ids).toEqual([intent]);
    expect(stillHeld.payments).toEqual(held.payments);
    expect(stillHeld.entries).toEqual([]);

    await expect(async () => {
        expect((await controlStripeRelay(first, "release")).upstream_status).toBe(200);
    }).toPass({ timeout: 60_000, intervals: [1000, 3000, 5000] });
    await first.reload();
    const settled = await settledStripeInvoice(first, request, invoice, info);
    expect(settled.payments[0]?.id).toBe(held.payments[0]?.id);
    expect(settled.stripe[0]?.charge).toBe(held.stripe[0]?.charge);
    expect((await controlStripeRelay(first, "redeliver")).upstream_status).toBe(200);
    expect(await stripeEvidence(invoice.id)).toEqual(settled);
    await second.reload();
    await expect(second.getByRole("heading", { name: pp.paidTitle })).toBeVisible();
    await expect(second.getByRole("button", { name: pp.continueToPay })).toHaveCount(0);
    const relay = await controlStripeRelay(first, "status");
    expect(relay.held).toBe(false);
    const event = relay.records?.find((r) => r.status === "held" && r.intent === intent)?.event;
    expect(event).toBe(settled.webhooks[0]?.id);
    expect(
        relay.records?.filter((r) => r.intent === intent || r.event === event).map((r) => r.status),
    ).toEqual(["armed", "held", "released", "redelivered"]);
    await info.attach("held-invoice-event", {
        body: JSON.stringify({ held, settled, relay }, null, 2),
        contentType: "application/json",
    });
});
