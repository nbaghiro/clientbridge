import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import { runPort } from "@clientbridge/config/e2e/run";
import { signIn } from "../../../web/e2e/support/session";
import { documentApi } from "../support/documents";
import { controlStripeRelay, issueStripeInvoice } from "./support/bridge";
import {
    clientMoney,
    expectLedgerMatchesStripe,
    refundPartUi,
    stripeDispute,
    stripeHarness,
} from "./support/disputes";
import {
    enterStripeCard,
    openRegisteredStripeInvoice,
    stripeEvidence,
    submitStripeCard,
} from "./support/provider";

interface Reconciliation {
    drifted: number;
    sources: string[];
    findings: { source: string; action: string; changes: Record<string, unknown> }[];
    other_findings: number;
    balance: { stripe_cents: number; ledger_cents: number };
}

type Evidence = Awaited<ReturnType<typeof stripeEvidence>>;

/** One payment, journals that balance, and a Stripe balance and fees equal to Stripe's own. */
async function expectBookedOnce(
    evidence: Evidence,
    clientId: string,
    intent: string,
    refunded: number,
): Promise<void> {
    const paid = evidence.payments.filter((p) => p.kind === "payment");
    expect(paid).toEqual([
        expect.objectContaining({ status: "succeeded", amount_cents: 2000, provider_ref: intent }),
    ]);
    expect(evidence.provider_intent_ids).toEqual([intent]);
    expect(evidence.stripe[0]).toMatchObject({ status: "succeeded", amount_refunded: refunded });
    const settlement = evidence.entries.filter((e) => e.ref === `payment:${paid[0]?.id ?? ""}`);
    expect(new Set(settlement.map((e) => e.journal_id)).size).toBe(1);
    const provider = await stripeDispute("show", intent);
    expect(provider.charge.amount_refunded).toBe(refunded);
    expectLedgerMatchesStripe((await clientMoney(clientId)).entries, provider);
}

async function forwarded(page: Parameters<typeof controlStripeRelay>[0], event: string) {
    const records = (await controlStripeRelay(page, "status")).records ?? [];
    return records
        .filter((r) => r.status === "forwarded" && r.event === event)
        .map((r) => r.upstream_status);
}

test("STR-E25 a payment whose event never arrives is booked once by reconciliation, and the event coming late, twice and after a refund changes nothing", async ({
    browser,
}, info) => {
    test.setTimeout(900_000);
    const ownerContext = await browser.newContext({
        baseURL: `http://localhost:${String(runPort("WEB_E2E_PORT"))}`,
    });
    const customerContext = await browser.newContext();
    try {
        const owner = await ownerContext.newPage();
        const customer = await customerContext.newPage();
        await signIn(owner);
        const { invoice, client, url } = await issueStripeInvoice(owner);
        const { payment } = await openRegisteredStripeInvoice(customer, invoice, url);
        const intent = (await stripeEvidence(invoice.id)).stripe[0]?.id;
        if (intent === undefined) throw new Error("the pay link opened no Stripe intent");
        await controlStripeRelay(owner, "arm", { invoice: invoice.id, intent });
        await enterStripeCard(payment, "4242424242424242");
        await submitStripeCard(customer, info);
        await expect(
            customer.getByRole("heading", { name: strings.publicPay.paidTitle }),
        ).toBeVisible();
        await expect.poll(async () => (await controlStripeRelay(owner, "status")).held).toBe(true);
        const held = await stripeEvidence(invoice.id);
        expect(held.payments.map((p) => [p.provider_ref, p.status])).toEqual([[intent, "pending"]]);
        expect(held.entries).toEqual([]);
        expect(held.webhooks).toEqual([]);
        const charge = held.stripe[0]?.charge;
        if (charge === undefined) throw new Error("Stripe has no charge for the payment");

        // the job rereads the pair's transactions since the run began; STR-E12 runs it again after
        const reconciled = await stripeHarness<Reconciliation>(["reconcile"], 840_000);
        expect(reconciled.sources).toContain(charge);
        expect(reconciled.findings).toEqual([]);
        const booked = await stripeEvidence(invoice.id);
        await expectBookedOnce(booked, client.id, intent, 0);
        expect(booked.webhooks).toEqual([]);
        const shown = await owner.request.get(`${documentApi}/pay/${invoice.pay_token}`);
        expect(await shown.json()).toMatchObject({ status: "paid", balance_cents: 0 });
        const paymentId = booked.payments[0]?.id ?? "";

        await refundPartUi(owner, { client, paymentId }, 500);
        await expect
            .poll(
                async () =>
                    (await stripeEvidence(invoice.id)).payments
                        .filter((p) => p.kind === "refund")
                        .map((p) => p.status),
                { timeout: 90_000 },
            )
            .toEqual(["succeeded"]);
        const refunded = await stripeEvidence(invoice.id);
        await expectBookedOnce(refunded, client.id, intent, 500);

        const event = (await controlStripeRelay(owner, "resend")).event ?? "";
        expect(event).toMatch(/^evt_/);
        await expect.poll(() => forwarded(owner, event), { timeout: 90_000 }).toEqual([200]);
        const late = await stripeEvidence(invoice.id);
        expect(late.webhooks).toEqual([
            { id: event, event: "payment_intent.succeeded", status: "processed", processed: true },
        ]);
        expect({ ...late, webhooks: [] }).toEqual(refunded);
        expect((await controlStripeRelay(owner, "resend")).event).toBe(event);
        await expect.poll(() => forwarded(owner, event), { timeout: 90_000 }).toEqual([200, 200]);
        expect(await stripeEvidence(invoice.id)).toEqual(late);

        await info.attach("str-e25", {
            body: JSON.stringify({ held, reconciled, booked, refunded, late }, null, 2),
            contentType: "application/json",
        });
    } finally {
        await customerContext.close();
        await ownerContext.close();
    }
});

test("STR-E12 reconciling the run's business after every other case leaves no finding on a source the run created", async () => {
    test.setTimeout(900_000);
    // the job rereads a day of the shared pair's transactions, so it gets most of the test's time
    const result = await stripeHarness<Reconciliation>(["reconcile"], 840_000);
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.findings).toEqual([]);
    // the shared merchant's balance and other runs' sources carry money this run never booked
    await test.info().attach("str-e12", {
        body: JSON.stringify(result, null, 2),
        contentType: "application/json",
    });
});
