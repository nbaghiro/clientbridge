import { expect, test, type Page } from "@playwright/test";
import { formatMoney, formatPhone, strings } from "@clientbridge/app-core/public";
import { runPort } from "@clientbridge/config/e2e/run";
import { openInvoice } from "../../../web/e2e/support/billing";
import { openBooking } from "../../../web/e2e/support/bookings";
import { createClient } from "../../../web/e2e/support/clients";
import { redeemGift } from "../../../web/e2e/support/entitlements";
import { signIn } from "../../../web/e2e/support/session";
import { issueStripeInvoice } from "./support/bridge";
import { depositEvidence, linkStripeDepositInvoice } from "./support/depositContract";
import { collectDepositUi, invoiceVisitUi } from "./support/deposit";
import {
    DISPUTE_CARD,
    INQUIRY_CARD,
    categoryTotals,
    clientMoney,
    expectDisputeListed,
    expectLedgerMatchesStripe,
    expectRefundBlocked,
    giftCard,
    manageLink,
    payLabel,
    press,
    refundPartUi,
    registerPurchaser,
    sellGiftCardByCard,
    startedDepositVisit,
    stripeDispute,
} from "./support/disputes";
import {
    cardFrame,
    enterStripeCard,
    openRegisteredStripeInvoice,
    settledStripeInvoice,
    submitStripeCard,
} from "./support/provider";

const web = (): string => `http://localhost:${String(runPort("WEB_E2E_PORT"))}`;

async function sendVisitInvoice(page: Page, invoice: { id: string; name: string; phone: string }) {
    await openInvoice(page, invoice);
    await page.getByRole("button", { name: strings.billing.sendInvoice, exact: true }).click();
    const review = page
        .getByRole("dialog")
        .filter({ has: page.getByRole("heading", { name: strings.previews.title, exact: true }) });
    await expect(
        review.getByText(formatPhone(invoice.phone), { exact: false }).first(),
    ).toBeVisible();
    const pending = page.waitForResponse(
        (r) =>
            new URL(r.url()).pathname === `/v1/invoices/${invoice.id}/send` &&
            r.request().method() === "POST",
    );
    await review.getByRole("button", { name: strings.billing.sendInvoice, exact: true }).click();
    const response = await pending;
    expect(response.status(), await response.text()).toBe(200);
    expect(await response.json()).toMatchObject({ status: "sent", balance_cents: 11200 });
}

test("STR-E02 a part refund made during an inquiry fails when it escalates, and losing the dispute unwinds the invoice once", async ({
    browser,
}, info) => {
    test.setTimeout(420_000);
    const ownerContext = await browser.newContext({ baseURL: web() });
    const customerContext = await browser.newContext();
    try {
        const owner = await ownerContext.newPage();
        const customer = await customerContext.newPage();
        await signIn(owner);
        const fixture = await issueStripeInvoice(owner);
        const { payment } = await openRegisteredStripeInvoice(
            customer,
            fixture.invoice,
            fixture.url,
        );
        await enterStripeCard(payment, INQUIRY_CARD);
        await submitStripeCard(customer, info);
        const settled = await settledStripeInvoice(
            customer,
            customer.request,
            fixture.invoice,
            info,
        );
        const paymentId = settled.payments[0]?.id;
        const intentId = settled.stripe[0]?.id;
        if (!paymentId || !intentId) throw new Error("the settled card payment is missing");
        const paid = { client: fixture.client, paymentId };

        // an inquiry moves no money, so the payment can still be refunded in part
        const inquiry = await stripeDispute("show", intentId);
        expect(inquiry.disputes).toEqual([
            expect.objectContaining({ status: "warning_needs_response", amount: 2000 }),
        ]);
        expect((await clientMoney(fixture.client.id)).payments[0]?.dispute_status).toBeNull();
        await refundPartUi(owner, paid, 500);
        await expect
            .poll(async () => {
                const money = await clientMoney(fixture.client.id);
                return money.payments.map((p) => [p.kind, p.status, p.amount_cents]);
            })
            .toEqual([
                ["payment", "succeeded", 2000],
                ["refund", "succeeded", 500],
            ]);
        const refunded = await clientMoney(fixture.client.id);
        expect(categoryTotals(refunded.entries)).toMatchObject({
            revenue: -1500,
            stripe: inquiry.net_cents - 500,
        });

        // Stripe fails a refund still pending at the network when its inquiry escalates
        expect((await stripeDispute("escalate", intentId)).disputes).toEqual([
            expect.objectContaining({ status: "needs_response", amount: 2000 }),
        ]);
        await expect
            .poll(async () => (await stripeDispute("show", intentId)).refunds[0]?.status, {
                timeout: 60_000,
            })
            .toBe("failed");
        const escalated = await stripeDispute("show", intentId);
        expect(escalated.refunds).toEqual([
            expect.objectContaining({
                amount: 500,
                status: "failed",
                failure_reason: "charge_for_pending_refund_disputed",
            }),
        ]);
        await expect
            .poll(
                async () => {
                    const money = await clientMoney(fixture.client.id);
                    return {
                        payments: money.payments.map((p) => [p.kind, p.status, p.dispute_status]),
                        stripe: categoryTotals(money.entries).stripe,
                    };
                },
                { timeout: 90_000 },
            )
            .toEqual({
                payments: [
                    ["payment", "succeeded", "needs_response"],
                    ["refund", "failed", null],
                ],
                stripe: escalated.net_cents,
            });
        const disputed = await clientMoney(fixture.client.id);
        expectLedgerMatchesStripe(disputed.entries, escalated);
        await expectRefundBlocked(owner, paid);
        await expectDisputeListed(owner, fixture.client, "needs_response");

        const lost = await stripeDispute("lose", intentId);
        expect(lost.disputes).toEqual([expect.objectContaining({ status: "lost", amount: 2000 })]);
        await expect
            .poll(async () => (await clientMoney(fixture.client.id)).payments[0]?.dispute_status, {
                timeout: 90_000,
            })
            .toBe("lost");
        await expect
            .poll(
                async () => categoryTotals((await clientMoney(fixture.client.id)).entries).revenue,
            )
            .toBe(0);
        const final = await clientMoney(fixture.client.id);
        expectLedgerMatchesStripe(final.entries, lost);
        const totals = categoryTotals(final.entries);
        // the failed refund came back, so the dispute takes the whole sale and nothing is lost twice
        expect(totals.receivable ?? 0).toBe(0);
        expect(totals.loss ?? 0).toBe(0);
        expect(final.entries.filter((e) => e.ref.endsWith(":reinstated"))).toEqual([]);
        expect(
            lost.transactions.filter((row) => row.amount > 0 && row.type === "adjustment"),
        ).toEqual([]);
        await expectRefundBlocked(owner, paid);
        await expectDisputeListed(owner, fixture.client, "lost");
        await info.attach("str-e02", {
            body: JSON.stringify({ inquiry, escalated, lost, ledger: final }, null, 2),
            contentType: "application/json",
        });
    } finally {
        await customerContext.close();
        await ownerContext.close();
    }
});

test("STR-E03 a lost dispute on a part-used gift card gives back only what it still holds and books the rest as a loss", async ({
    browser,
}, info) => {
    test.setTimeout(360_000);
    const ownerContext = await browser.newContext({ baseURL: web() });
    try {
        const owner = await ownerContext.newPage();
        await signIn(owner);
        const client = await createClient(owner);
        await registerPurchaser(client.id);
        await sellGiftCardByCard(owner, client, 2000, DISPUTE_CARD);
        await expect
            .poll(
                async () => {
                    const money = await clientMoney(client.id);
                    return money.payments.map((p) => [p.kind, p.status, p.dispute_status]);
                },
                { timeout: 90_000 },
            )
            .toEqual([["payment", "succeeded", "needs_response"]]);
        const sold = await clientMoney(client.id);
        const intentId = sold.payments[0]?.provider_ref;
        if (!intentId) throw new Error("the gift card payment has no intent");
        const card = await giftCard(client.id);
        expect(card).toMatchObject({ status: "active", balance_cents: 2000 });
        const opened = await stripeDispute("show", intentId);
        expect(opened.disputes).toEqual([
            expect.objectContaining({
                status: "needs_response",
                amount: 2000,
                reason: "fraudulent",
            }),
        ]);
        expectLedgerMatchesStripe(sold.entries, opened);

        await redeemGift(owner, card.code, "8.00");
        await expect.poll(async () => (await giftCard(client.id)).balance_cents).toBe(1200);

        const lost = await stripeDispute("lose", intentId);
        expect(lost.disputes).toEqual([expect.objectContaining({ status: "lost" })]);
        await expect
            .poll(async () => (await giftCard(client.id)).status, { timeout: 90_000 })
            .toBe("void");
        const final = await clientMoney(client.id);
        expect(final.payments[0]?.dispute_status).toBe("lost");
        expect(await giftCard(client.id)).toMatchObject({ status: "void", balance_cents: 0 });
        expectLedgerMatchesStripe(final.entries, lost);
        const totals = categoryTotals(final.entries);
        expect(totals.gift_card ?? 0).toBe(0);
        expect(totals.receivable ?? 0).toBe(0);
        // the $8 already spent stays earned; the dispute took it back, so it is a loss
        expect(totals.revenue).toBe(-800);
        expect(totals.loss).toBe(800);
        await expectDisputeListed(owner, client, "lost");
        await info.attach("str-e03", {
            body: JSON.stringify({ opened, lost, ledger: final }, null, 2),
            contentType: "application/json",
        });
    } finally {
        await ownerContext.close();
    }
});

test("STR-E04 a lost dispute takes back a forfeited deposit, and a deposit paid after its visit was settled is refunded", async ({
    browser,
}, info) => {
    test.setTimeout(480_000);
    const ownerContext = await browser.newContext({ baseURL: web() });
    const customerContext = await browser.newContext();
    try {
        const owner = await ownerContext.newPage();
        const customer = await customerContext.newPage();
        await signIn(owner);

        const kept = await startedDepositVisit(owner, false);
        await collectDepositUi(owner, kept, DISPUTE_CARD);
        await expect
            .poll(
                async () => {
                    const e = await depositEvidence(kept.fixture);
                    return [e.booking.deposit_status, e.provider.intents.map((p) => p.status)];
                },
                { timeout: 90_000 },
            )
            .toEqual(["collected", ["succeeded"]]);
        const deposit = (await depositEvidence(kept.fixture)).provider.intents[0];
        if (!deposit) throw new Error("the deposit intent is missing");
        const opened = await stripeDispute("show", deposit.id);
        expect(opened.disputes).toEqual([expect.objectContaining({ status: "needs_response" })]);

        await openBooking(owner, kept.booking, kept.visit.id);
        const s = strings.bookings;
        await press(owner.getByRole("button", { name: s.markNoShow, exact: true }));
        await expect(
            owner.getByText(s.noShowKeep(formatMoney(2000, "CAD")), { exact: true }),
        ).toBeVisible();
        await press(owner.getByRole("button", { name: s.confirmNoShow, exact: true }));
        await expect
            .poll(async () => (await depositEvidence(kept.fixture)).booking.deposit_status)
            .toBe("forfeited");
        const forfeited = await clientMoney(kept.booking.clientId);
        expect(categoryTotals(forfeited.entries).deposit ?? 0).toBe(0);

        const lost = await stripeDispute("lose", deposit.id);
        expect(lost.disputes).toEqual([expect.objectContaining({ status: "lost" })]);
        await expect
            .poll(async () => (await depositEvidence(kept.fixture)).booking.deposit_status, {
                timeout: 90_000,
            })
            .toBe("refunded");
        const final = await clientMoney(kept.booking.clientId);
        expect(final.payments[0]?.dispute_status).toBe("lost");
        expectLedgerMatchesStripe(final.entries, lost);
        const totals = categoryTotals(final.entries);
        // the forfeit is taken back, so the lost deposit leaves no sale, tax or held money behind
        for (const category of ["deposit", "revenue", "tax", "receivable", "loss"])
            expect([category, totals[category] ?? 0]).toEqual([category, 0]);

        const settled = await startedDepositVisit(owner, true);
        const link = await manageLink(settled.visit.id);
        await customer.goto(link);
        await customer
            .getByRole("button", { name: strings.publicManage.payDeposit, exact: true })
            .click();
        const frame = await cardFrame(customer);
        await expect
            .poll(async () => (await depositEvidence(settled.fixture)).provider.intents.length)
            .toBe(1);
        const invoice = await invoiceVisitUi(owner, settled);
        await linkStripeDepositInvoice(settled.fixture, invoice.id);
        await sendVisitInvoice(owner, invoice);
        await expect
            .poll(async () => (await depositEvidence(settled.fixture)).booking.deposit_status)
            .toBe("none");
        await enterStripeCard(frame, "4242424242424242");
        await press(customer.getByRole("button", { name: payLabel(2000), exact: true }));
        await expect
            .poll(
                async () => {
                    const e = await depositEvidence(settled.fixture);
                    return {
                        intents: e.provider.intents.map((p) => p.status),
                        refunds: e.provider.refunds.map((r) => [r.status, r.amount]),
                        payments: e.payments.map((p) => [p.kind, p.status, p.amount_cents]),
                    };
                },
                { timeout: 120_000 },
            )
            .toEqual({
                intents: ["succeeded"],
                refunds: [["succeeded", 2000]],
                payments: [
                    ["deposit", "succeeded", 2000],
                    ["refund", "succeeded", 2000],
                ],
            });
        const late = await depositEvidence(settled.fixture);
        // the late deposit never pays the settled visit's invoice
        expect(late.invoice).toMatchObject({ id: invoice.id, status: "sent", total_cents: 11200 });
        expect(late.entries.filter((e) => e.ref.startsWith("application:"))).toEqual([]);
        const held = late.entries
            .filter((e) => e.category === "deposit")
            .reduce((sum, e) => sum + e.amount_cents, 0);
        expect(held).toBe(0);
        await info.attach("str-e04", {
            body: JSON.stringify({ opened, lost, forfeitLedger: final, late }, null, 2),
            contentType: "application/json",
        });
    } finally {
        await customerContext.close();
        await ownerContext.close();
    }
});
