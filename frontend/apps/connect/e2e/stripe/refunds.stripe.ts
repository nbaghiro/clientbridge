import { expect, test } from "@playwright/test";
import { formatCredit, formatMoney, formatParts, strings } from "@clientbridge/app-core/public";
import { runPort } from "@clientbridge/config/e2e/run";
import { select } from "../../../web/e2e/support/db";
import { openRefund } from "../../../web/e2e/support/refunds";
import { navigate, signIn } from "../../../web/e2e/support/session";
import { issueStripeInvoice } from "./support/bridge";
import {
    categoryTotals,
    clientMoney,
    expectLedgerMatchesStripe,
    refundPartUi,
} from "./support/disputes";
import {
    enterStripeCard,
    openRegisteredStripeInvoice,
    settledStripeInvoice,
    submitStripeCard,
} from "./support/provider";
import { REFUND_FAILS_CARD, refundRecords, stripeRefund } from "./support/refunds";

const web = (): string => `http://localhost:${String(runPort("WEB_E2E_PORT"))}`;
const s = strings.refunds;

test("STR-E23 a refund made in Stripe is recorded as a credit note, and refunds Stripe fails later are reversed and flagged", async ({
    browser,
}, info) => {
    test.setTimeout(720_000);
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
        await enterStripeCard(payment, REFUND_FAILS_CARD);
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
        const [doc] = await select<{ number: number }>`
            SELECT number FROM invoices WHERE id = ${fixture.invoice.id}`;
        if (doc === undefined) throw new Error("the invoice is missing");
        const note = (n: number): string => `CN-${String(doc.number)}-${String(n)}`;
        const before = categoryTotals((await clientMoney(fixture.client.id)).entries);

        // a refund made in Stripe's dashboard arrives by webhook and gets the next credit note
        const dashboard = await stripeRefund("create", intentId, 500);
        const stripeSide = dashboard.refunds[0]?.id;
        expect(stripeSide).toMatch(/^re_/);
        await expect
            .poll(async () => (await refundRecords(paymentId))[0] ?? null, { timeout: 90_000 })
            .toMatchObject({ amount_cents: 500, credit_note: note(1), provider_ref: stripeSide });
        await refundPartUi(owner, paid, 1000);
        await expect
            .poll(async () => (await refundRecords(paymentId)).map((r) => r.credit_note))
            .toEqual([note(1), note(2)]);

        // the card's bank turns both refunds down later: the money and the credit come back
        await expect
            .poll(async () => (await refundRecords(paymentId)).map((r) => r.status), {
                timeout: 420_000,
                intervals: [5_000],
            })
            .toEqual(["failed", "failed"]);
        let evidence = await stripeRefund("show", intentId);
        let money = await clientMoney(fixture.client.id);
        await expect
            .poll(
                async () => {
                    evidence = await stripeRefund("show", intentId);
                    money = await clientMoney(fixture.client.id);
                    return (categoryTotals(money.entries).stripe ?? 0) - evidence.net_cents;
                },
                { timeout: 90_000 },
            )
            .toBe(0);
        expect(evidence.refunds.map((r) => r.status).sort()).toEqual(["failed", "failed"]);
        expectLedgerMatchesStripe(money.entries, evidence);
        const after = categoryTotals(money.entries);
        expect([after.revenue, after.receivable ?? 0]).toEqual([before.revenue, 0]);

        const panel = await openRefund(owner, paid);
        await expect(panel).toContainText(s.statusLabel.paid);
        for (const cents of [500, 1000])
            await expect(
                panel.getByText(formatParts([s.failedEvent, formatMoney(cents, "CAD")]), {
                    exact: true,
                }),
            ).toBeVisible();
        await expect(
            panel.getByText(formatParts([s.refundEvent(note(1)), formatCredit(500, "CAD")]), {
                exact: true,
            }),
        ).toHaveCount(0);
        // Stripe takes no other refund on a charge whose bank turned one down
        await expect(panel).toContainText(s.blocked.refund_refused);
        await expect(
            panel.getByRole("button", { name: s.refundButton(formatMoney(2000, "CAD")) }),
        ).toHaveCount(0);

        const n = strings.notifications.kinds;
        await navigate(owner, "/today");
        await owner
            .locator("aside")
            .getByRole("button", { name: strings.notifications.title })
            .click();
        const bell = owner.getByRole("dialog", { name: strings.notifications.title });
        // other cases in the run share the business, so only this client's alerts count
        const failed = bell
            .getByRole("button")
            .filter({ hasText: n.refundFailed })
            .filter({ hasText: fixture.client.name });
        await expect(failed).toHaveCount(2, { timeout: 60_000 });
        const inApp = failed.filter({
            hasText: n.refundFailedBody(fixture.client.name, formatMoney(1000, "CAD")),
        });
        await expect(inApp).toHaveCount(1);
        await inApp.click();
        await expect(
            owner.getByRole("complementary", { name: fixture.client.name, exact: true }),
        ).toContainText(s.failedEvent, { timeout: 60_000 });
        await info.attach("str-e23", {
            body: JSON.stringify({ evidence, ledger: money }, null, 2),
            contentType: "application/json",
        });
    } finally {
        await customerContext.close();
        await ownerContext.close();
    }
});
