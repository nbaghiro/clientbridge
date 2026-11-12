import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
    formatCredit,
    formatMoney,
    formatMoneyWithCurrency,
    formatParts,
    strings,
} from "@clientbridge/app-core/public";
import { runPort } from "@clientbridge/config/e2e/run";
import { createClient } from "../../../web/e2e/support/clients";
import { select } from "../../../web/e2e/support/db";
import { openRefund } from "../../../web/e2e/support/refunds";
import { navigate, signIn } from "../../../web/e2e/support/session";
import { issueStripeInvoice } from "./support/bridge";
import {
    categoryTotals,
    clientMoney,
    expectLedgerMatchesStripe,
    refundPartUi,
    registerPurchaser,
    stripeHarness,
    webhookRows,
} from "./support/disputes";
import { merchant } from "./support/payouts";
import { on } from "../support/hosts";
import { sentInvoice } from "./support/wallet";
import {
    cardFrame,
    enterStripeCard,
    payToken,
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

/** Rereads Stripe and the books until every refund event is handled and the two agree. */
async function settledBooks(clientId: string, intentId: string) {
    let stripe = await stripeRefund("show", intentId);
    let money = await clientMoney(clientId);
    await expect
        .poll(
            async () => {
                stripe = await stripeRefund("show", intentId);
                money = await clientMoney(clientId);
                const rows = await webhookRows(stripe.events.map((e) => e.id));
                return {
                    unhandled:
                        stripe.events.length - rows.filter((r) => r.status === "processed").length,
                    unmatched: (categoryTotals(money.entries).stripe ?? 0) - stripe.net_cents,
                };
            },
            { timeout: 120_000 },
        )
        .toEqual({ unhandled: 0, unmatched: 0 });
    expectLedgerMatchesStripe(money.entries, stripe);
    return { stripe, money };
}

// Klarna's sandbox approves this Canadian shopper; any six digits pass its code check
const KLARNA_SHOPPER = { phone: "5197438620", code: "123456" };

/** Every frame's accessibility tree and a screenshot, so a run that stops in Klarna shows where. */
async function klarnaSnapshot(page: Page, info: TestInfo, name: string): Promise<void> {
    if (page.isClosed()) return;
    const frames: { url: string; tree: string }[] = [];
    for (const frame of page.frames()) {
        if (frame.isDetached()) continue;
        const tree = await frame
            .locator("body")
            .ariaSnapshot({ timeout: 5_000 })
            .catch(() => "");
        if (tree !== "") frames.push({ url: frame.url().split("?")[0] ?? "", tree });
    }
    await writeFile(info.outputPath(`${name}.json`), JSON.stringify(frames, null, 2));
    await page
        .screenshot({ path: info.outputPath(`${name}.png`), fullPage: true })
        .catch(() => undefined);
}

/** Picks Klarna in the Payment Element, after the card it lists first, and fills what it asks. */
async function chooseKlarna(page: Page): Promise<void> {
    const payment = await cardFrame(page);
    const methods = payment
        .getByRole("tab")
        .or(payment.getByRole("button", { name: /^(Card|Klarna)$/ }));
    await expect(methods.first()).toHaveAccessibleName("Card", { timeout: 30_000 });
    // the express buttons above keep Link but no longer carry Klarna
    for (const frame of page.frames()) {
        if (frame === payment || frame.isDetached()) continue;
        await expect(frame.getByRole("button", { name: /Klarna/ })).toHaveCount(0);
    }
    await methods.filter({ hasText: "Klarna" }).first().click();
    const email = payment.getByRole("textbox", { name: "Email", exact: true });
    if (await email.isVisible()) await email.fill(`klarna-${randomUUID().slice(0, 8)}@example.ca`);
    const country = payment.getByRole("combobox", { name: "Country", exact: true });
    if (await country.isVisible()) await country.selectOption({ label: "Canada" });
}

// bounded, so a step Klarna never offers fails with its snapshot instead of using up the test
const STEP = { timeout: 60_000 };

/** Signs in to Klarna's sandbox as the approved Canadian shopper and pays, until it hands back. */
async function authorizeKlarna(popup: Page, info: TestInfo, back: () => Promise<unknown>) {
    try {
        const phone = popup.getByRole("textbox", { name: "Phone number", exact: true });
        await phone.fill(KLARNA_SHOPPER.phone, { timeout: 60_000 });
        await popup.getByRole("button", { name: "Continue", exact: true }).click(STEP);
        await popup
            .getByRole("textbox", { name: "Enter code", exact: true })
            .pressSequentially(KLARNA_SHOPPER.code, { timeout: 60_000 });
        const confirm = popup.getByRole("heading", { name: "Confirm and pay", exact: true });
        const plans = popup.getByRole("dialog", { name: /^Choose how to pay/ });
        await expect(confirm.or(plans)).toBeVisible({ timeout: 60_000 });
        // Klarna sometimes asks for a plan first; paying in full needs no credit check
        if (await plans.isVisible()) {
            // the option's radio is a hidden input, so click the visible card by its title
            await plans.getByText("Pay in full", { exact: true }).first().click(STEP);
            await plans.getByRole("button", { name: "Continue", exact: true }).click(STEP);
        }
        await expect(confirm).toBeVisible({ timeout: 60_000 });
        const consent = popup.getByRole("checkbox", { name: /I consent to Klarna/ });
        if (await consent.isVisible()) await consent.check(STEP);
        await popup.getByRole("button", { name: /^Pay with/ }).click(STEP);
        await back();
    } catch (error) {
        await klarnaSnapshot(popup, info, "klarna-stuck");
        throw error;
    }
}

test("STR-E32 an invoice paid with Klarna from the pay link's method list settles once when Klarna sends the client back, and a staff refund of part of it matches Stripe", async ({
    browser,
}, info) => {
    test.setTimeout(480_000);
    const ownerContext = await browser.newContext({
        baseURL: `http://localhost:${String(runPort("WEB_E2E_PORT"))}`,
    });
    const customerContext = await browser.newContext();
    try {
        const owner = await ownerContext.newPage();
        const customer = await customerContext.newPage();
        await signIn(owner);
        const client = await createClient(owner);
        await registerPurchaser(client.id);
        const invoiceId = await sentInvoice(owner, client, 2000);
        const url = on("pay", `/i/${await payToken(invoiceId)}`);
        const proceed = customer.getByRole("button", {
            name: strings.publicPay.continueToPay,
            exact: true,
        });
        await customer.goto(url);
        await proceed.click();
        let opened = "";
        await expect
            .poll(async () => {
                opened = (await clientMoney(client.id)).payments[0]?.provider_ref ?? "";
                return opened;
            })
            .toMatch(/^pi_/);
        // Stripe offers Klarna by the client's country, read from the intent before the browser's
        await stripeHarness(["intents", "canada", opened]);
        await customer.reload();
        await proceed.click();
        await chooseKlarna(customer);
        await customer
            .getByRole("button", {
                name: strings.checkout.pay(formatMoneyWithCurrency(2000, "CAD")),
                exact: true,
            })
            .click();
        await customer.waitForURL((u) => !u.href.startsWith(url), { timeout: 60_000 });
        await authorizeKlarna(customer, info, () =>
            customer.waitForURL((u) => u.href.startsWith(url), { timeout: 60_000 }),
        );
        await expect(
            customer.getByRole("heading", { name: strings.publicPay.paidTitle }),
        ).toBeVisible({ timeout: 60_000 });

        let paymentId = "";
        let intentId = "";
        await expect
            .poll(
                async () => {
                    const money = await clientMoney(client.id);
                    paymentId = money.payments[0]?.id ?? "";
                    intentId = money.payments[0]?.provider_ref ?? "";
                    return {
                        payments: money.payments.map((p) => [p.kind, p.status, p.amount_cents]),
                        receivable: categoryTotals(money.entries).receivable ?? 0,
                    };
                },
                { timeout: 120_000 },
            )
            .toEqual({ payments: [["payment", "succeeded", 2000]], receivable: 0 });
        const paid = await settledBooks(client.id, intentId);
        expect(paid.stripe.charge).toMatchObject({ amount: 2000, amount_refunded: 0 });
        const charge = await merchant<{ method: string }>("charge", paid.stripe.charge.id);
        expect(charge.method).toBe("klarna");
        const settled = paid.money.entries.filter((e) => e.ref === `payment:${paymentId}`);
        expect(new Set(settled.map((e) => e.journal_id)).size).toBe(1);
        await customer.reload();
        await expect(
            customer.getByRole("heading", { name: strings.publicPay.paidTitle }),
        ).toBeVisible();
        await expect(
            customer.getByRole("button", { name: strings.publicPay.continueToPay }),
        ).toHaveCount(0);

        await refundPartUi(owner, { client, paymentId }, 800);
        await expect
            .poll(
                async () =>
                    (await clientMoney(client.id)).payments.map((p) => [
                        p.kind,
                        p.status,
                        p.amount_cents,
                    ]),
                { timeout: 180_000 },
            )
            .toEqual([
                ["payment", "succeeded", 2000],
                ["refund", "succeeded", 800],
            ]);
        const refunded = await settledBooks(client.id, intentId);
        expect(refunded.stripe.refunds).toEqual([
            expect.objectContaining({ amount: 800, status: "succeeded" }),
        ]);
        expect(refunded.stripe.charge.amount_refunded).toBe(800);
        expect(categoryTotals(refunded.money.entries).revenue).toBe(-1200);
        await info.attach("str-e32", {
            body: JSON.stringify({ paid, refunded }, null, 2),
            contentType: "application/json",
        });
    } finally {
        await customerContext.close();
        await ownerContext.close();
    }
});
