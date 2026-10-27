import { expect, type APIRequestContext } from "@playwright/test";
import { demoId } from "@clientbridge/config/e2e/run";
import { documentApi } from "./documents";
import { stripeEvidence } from "./stripe-provider";

/** The superseded attempt stays canceled and uncharged; the other one settles the invoice once. */
export async function expectOneSettlement(
    request: APIRequestContext,
    invoice: { id: string; pay_token: string; account: string },
    canceledIntent: string,
) {
    await expect(async () => {
        const response = await request.get(`${documentApi}/pay/${invoice.pay_token}`);
        expect(await response.json()).toMatchObject({ status: "paid", balance_cents: 0 });
        const evidence = await stripeEvidence(invoice.id);
        expect(evidence.payments.map((row) => row.status)).toEqual(["canceled", "succeeded"]);
        const settled = evidence.webhooks.filter((row) => row.event === "payment_intent.succeeded");
        expect(settled).toEqual([
            expect.objectContaining({ status: "processed", processed: true }),
        ]);
    }).toPass({ timeout: 90_000, intervals: [1000, 3000, 5000] });
    const evidence = await stripeEvidence(invoice.id);
    const [canceled, paid] = evidence.payments;
    const [first, second] = evidence.stripe;
    if (!canceled || !paid || !first || !second) throw new Error("missing both attempts");
    expect(first).toMatchObject({
        id: canceledIntent,
        status: "canceled",
        account: invoice.account,
    });
    expect(first.charge_paid ?? false).toBe(false);
    expect(second).toMatchObject({
        id: paid.provider_ref,
        status: "succeeded",
        amount: 2000,
        amount_captured: 2000,
        amount_refunded: 0,
        livemode: false,
    });
    expect(evidence.provider_intent_ids).toEqual([first.id, second.id].sort());
    expect(paid).toMatchObject({ amount_cents: 2000, tip_cents: 0, kind: "payment" });
    expect(canceled).toMatchObject({ amount_cents: 2000, provider_ref: canceledIntent });
    expect(evidence.webhooks.every((row) => row.processed)).toBe(true);
    expect(new Set(evidence.entries.map((entry) => entry.ref))).toEqual(
        new Set([`payment:${paid.id}`, `fee:${paid.id}`]),
    );
    const business = evidence.entries.filter(
        (entry) => entry.owner_type === "business" && entry.owner_id === demoId("bz_birchbark"),
    );
    const total = (category: string): number =>
        business
            .filter((entry) => entry.category === category)
            .reduce((sum, entry) => sum + entry.amount_cents, 0);
    expect(evidence.entries.reduce((sum, entry) => sum + entry.amount_cents, 0)).toBe(0);
    expect(total("stripe")).toBe(second.net);
    expect(total("processing_fee") + total("platform_fee")).toBe(second.fee);
    return evidence;
}
