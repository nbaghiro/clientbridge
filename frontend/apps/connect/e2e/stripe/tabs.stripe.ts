import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import { documentApi } from "../support/documents";
import { on } from "../support/hosts";
import {
    enterStripeCard,
    openRegisteredStripeInvoice,
    stripeEvidence,
    stripeInvoice,
    submitStripeCard,
} from "./support/provider";
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
    await expect(first.getByRole("alert")).toBeVisible();
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
    await expect(first.getByRole("button", { name: strings.publicPay.payByCard })).toHaveCount(0);
    const state = await request.get(`${documentApi}/pay/${invoice.pay_token}`);
    expect(await state.json()).toMatchObject({ status: "paid", balance_cents: 0 });
    await info.attach("two-tab-settlement", {
        body: JSON.stringify(settled, null, 2),
        contentType: "application/json",
    });
});
