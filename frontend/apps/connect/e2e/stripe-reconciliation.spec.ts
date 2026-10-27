import { expect, test } from "@playwright/test";
import { stripeHarness } from "./stripe-disputes";

interface Reconciliation {
    drifted: number;
    sources: string[];
    findings: { source: string; action: string; changes: Record<string, unknown> }[];
    other_findings: number;
    balance: { stripe_cents: number; ledger_cents: number };
}

test("STR-E12 reconciling the run's business after every other case leaves no finding on a source the run created", async () => {
    test.setTimeout(900_000);
    const result = await stripeHarness<Reconciliation>(["reconcile"]);
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.findings).toEqual([]);
    // the shared merchant's balance and other runs' sources carry money this run never booked
    await test.info().attach("str-e12", {
        body: JSON.stringify(result, null, 2),
        contentType: "application/json",
    });
});
