import { randomUUID } from "node:crypto";
import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { formatMoney, formatParts, strings } from "@clientbridge/app-core/public";
import {
    expectPaid,
    openInvoice,
    paymentDrawer,
    recordCash,
} from "../../../web/e2e/support/billing";
import { textsTo } from "../../../web/e2e/support/auth";
import { patchBusiness } from "../../../web/e2e/support/business";
import { select } from "../../../web/e2e/support/db";
import { customerContext, navigate, signIn } from "../../../web/e2e/support/session";
import { apiCall, manageUrl } from "../../../web/e2e/support/visit";
import { bookingApi, openBooking } from "../../../web/e2e/support/bookings";
import { controlStripeRelay } from "./support/bridge";
import {
    depositEvidence,
    linkStripeDepositInvoice,
    reapDeposit,
    type DepositEvidence,
    type DepositFixture,
} from "./support/depositContract";
import {
    prepareDepositBooking,
    collectDepositUi,
    invoiceVisitUi,
    payManageDeposit,
    payOnlineDeposit,
    prepareOnlineDeposit,
    requestWithDeposit,
    sendBookingInvoiceUi,
    refundUi,
} from "./support/deposit";
import { expectDepositStage } from "./support/depositOracle";
import {
    categoryTotals,
    clientMoney,
    expectLedgerMatchesStripe,
    press,
    startedDepositVisit,
    stripeDispute,
} from "./support/disputes";
import { enrolWithCardDeposit, PROGRAM, prepareProgram, webBaseUrl } from "./support/program";
import { runPort } from "@clientbridge/config/e2e/run";

/** Waits until Stripe's payment event has settled the deposit with its fees, then reads it. */
async function collectedDeposit(f: DepositFixture): Promise<DepositEvidence> {
    await expect
        .poll(
            async () => {
                const e = await depositEvidence(f);
                return {
                    local: e.payments.map((p) => [p.kind, p.status]),
                    remote: e.provider.intents.map((p) => p.status),
                    booking: e.booking.deposit_status,
                    feesReady: e.provider.fees !== null,
                };
            },
            { timeout: 90_000 },
        )
        .toEqual({
            local: [["deposit", "succeeded"]],
            remote: ["succeeded"],
            booking: "collected",
            feesReady: true,
        });
    return depositEvidence(f);
}

async function outstanding(
    page: Page,
    invoice: { id: string; name: string; phone: string },
    cents: number,
): Promise<void> {
    await openInvoice(page, invoice);
    await expect(
        page
            .getByRole("dialog")
            .getByText(strings.billing.statusLabel.partial, { exact: true })
            .first(),
    ).toBeVisible();
    await page.getByRole("button", { name: strings.billing.recordPayment, exact: true }).click();
    const payment = paymentDrawer(page);
    await expect(
        payment.getByRole("button", {
            name: strings.billing.rec.record(formatMoney(cents, "CAD")),
            exact: true,
        }),
    ).toBeVisible();
    await payment.getByRole("button", { name: strings.billing.backToInvoice, exact: true }).click();
}

test("FIN-DEPOSIT-04 real deposit refund reopens invoice debt while ordinary cash refund credits tax", async ({
    browser,
}, info) => {
    test.setTimeout(300_000);
    const baseURL = `http://localhost:${String(runPort("WEB_E2E_PORT"))}`;
    const ownedContexts: BrowserContext[] = [];
    const failures: unknown[] = [];
    const checkpoints: Record<string, DepositEvidence> = {};
    try {
        const ownerContext = await browser.newContext({ baseURL });
        ownedContexts.push(ownerContext);
        const observerContext = await browser.newContext({ baseURL });
        ownedContexts.push(observerContext);
        const owner = await ownerContext.newPage();
        await signIn(owner);
        const setup = await prepareDepositBooking(owner);
        const f = setup.fixture;
        const before = await depositEvidence(f);
        expect(before.payments).toEqual([]);
        expect(before.entries).toEqual([]);
        expect(before.provider.intents).toEqual([]);
        const depositPaymentId = await collectDepositUi(owner, setup);
        await expect
            .poll(
                async () => {
                    const e = await depositEvidence(f);
                    return {
                        local: e.payments.find((p) => p.id === depositPaymentId)?.status,
                        remote: e.provider.intents.map((p) => p.status),
                        booking: e.booking.deposit_status,
                        feesReady: e.provider.fees !== null,
                    };
                },
                { timeout: 90_000 },
            )
            .toEqual({
                local: "succeeded",
                remote: ["succeeded"],
                booking: "collected",
                feesReady: true,
            });
        const collected = await depositEvidence(f);
        const providerFees = collected.provider.fees;
        if (providerFees === null) throw new Error("genuine provider fee details missing");
        const depositRefs = { depositPaymentId, fees: providerFees };
        expectDepositStage(collected, f, "collected", depositRefs);
        expect(collected.provider.intents).toEqual([
            expect.objectContaining({
                amount: 2000,
                currency: "cad",
                livemode: false,
                metadata: expect.objectContaining({
                    booking_id: f.bookingId,
                    business_id: collected.businessId,
                }),
            }),
        ]);
        const intent = collected.provider.intents[0];
        if (!intent) throw new Error("owned genuine deposit intent missing");
        checkpoints.collected = collected;
        const fees = collected.entries.filter((entry) => entry.event === "fee");
        const invoice = await invoiceVisitUi(owner, setup);
        await linkStripeDepositInvoice(f, invoice.id);
        const draft = await depositEvidence(f);
        expectDepositStage(draft, f, "draft", { ...depositRefs, invoiceId: invoice.id });
        checkpoints.draft = draft;
        const number = await sendBookingInvoiceUi(owner, invoice);
        const applied = await depositEvidence(f);
        expectDepositStage(applied, f, "applied", { ...depositRefs, invoiceId: invoice.id });
        checkpoints.applied = applied;
        await outstanding(owner, invoice, 9200);
        const cashResponse = owner.waitForResponse(
            (r) =>
                new URL(r.url()).pathname === `/v1/invoices/${invoice.id}/payments` &&
                r.request().method() === "POST",
        );
        await recordCash(owner, formatMoney(9200, "CAD"));
        const cash = await cashResponse;
        expect(cash.status(), await cash.text()).toBe(201);
        const { payment_id: cashPaymentId } = (await cash.json()) as { payment_id: string };
        const refs = { ...depositRefs, invoiceId: invoice.id, cashPaymentId };
        const paid = await depositEvidence(f);
        expectDepositStage(paid, f, "paid", refs);
        checkpoints.paid = paid;
        await openInvoice(owner, invoice);
        await expectPaid(owner);
        const observer = await observerContext.newPage();
        await signIn(observer);
        await openInvoice(observer, invoice);
        await expectPaid(observer);
        await observer.reload();
        await openInvoice(observer, invoice);
        await expectPaid(observer);
        const refundFixture = {
            client: { id: f.clientId, name: invoice.name, phone: invoice.phone },
            invoiceId: invoice.id,
            number,
            paymentId: depositPaymentId,
        };
        await refundUi(owner, refundFixture, 2000, { wholeOnly: true, cancelFirst: true });
        expect(await depositEvidence(f)).toEqual(paid);
        await refundUi(owner, refundFixture, 2000, { wholeOnly: true, cancelFirst: false });
        await expect
            .poll(
                async () => {
                    const e = await depositEvidence(f);
                    return {
                        local: e.payments
                            .filter(
                                (p) =>
                                    p.kind === "refund" && p.parent_payment_id === depositPaymentId,
                            )
                            .map((p) => p.status),
                        remote: e.provider.refunds.map((r) => ({
                            status: r.status,
                            amount: r.amount,
                            payment_intent: r.payment_intent,
                        })),
                        booking: e.booking.deposit_status,
                    };
                },
                { timeout: 90_000 },
            )
            .toEqual({
                local: ["succeeded"],
                remote: [{ status: "succeeded", amount: 2000, payment_intent: intent.id }],
                booking: "refunded",
            });
        const depositBack = await depositEvidence(f);
        expectDepositStage(depositBack, f, "deposit_refunded", refs);
        expect(depositBack.entries.filter((entry) => entry.event === "fee")).toEqual(fees);
        checkpoints.deposit_refunded = depositBack;
        await outstanding(owner, invoice, 2000);
        await observer.reload();
        await outstanding(observer, invoice, 2000);
        await refundUi(owner, { ...refundFixture, paymentId: cashPaymentId }, 5600, {
            wholeOnly: false,
            cancelFirst: false,
        });
        const final = await depositEvidence(f);
        expectDepositStage(final, f, "cash_refunded", refs);
        expect(final.provider.refunds).toEqual(depositBack.provider.refunds);
        expect(final.entries.filter((entry) => entry.event === "fee")).toEqual(fees);
        checkpoints.cash_refunded = final;
        for (const page of [owner, observer]) {
            await page.reload();
            await outstanding(page, invoice, 2000);
        }
        expect(await depositEvidence(f)).toEqual(final);
        await info.attach("owned-deposit-application-refunds", {
            body: JSON.stringify(checkpoints),
            contentType: "application/json",
        });
    } catch (error) {
        failures.push(error);
    } finally {
        const closed = await Promise.allSettled(ownedContexts.map((context) => context.close()));
        failures.push(
            ...closed.flatMap((result) =>
                result.status === "rejected" ? [result.reason as unknown] : [],
            ),
        );
    }
    if (failures.length > 0)
        throw new AggregateError(failures, "deposit accounting journey or browser teardown failed");
});

test("FIN-DEPOSIT-10 a card deposit paid while enrolling in a camp on Connect part-pays the enrolment invoice", async ({
    browser,
}, info) => {
    test.setTimeout(300_000);
    const ownerContext = await browser.newContext({ baseURL: webBaseUrl() });
    try {
        const owner = await ownerContext.newPage();
        await signIn(owner);
        const setup = await prepareProgram(owner);
        const { fixture, bookingIds } = await enrolWithCardDeposit(browser, setup);
        await expect
            .poll(
                async () => {
                    const e = await depositEvidence(fixture);
                    return {
                        local: e.payments.map((p) => [p.kind, p.status]),
                        remote: e.provider.intents.map((p) => p.status),
                        booking: e.booking.deposit_status,
                        feesReady: e.provider.fees !== null,
                    };
                },
                { timeout: 90_000 },
            )
            .toEqual({
                local: [["deposit", "succeeded"]],
                remote: ["succeeded"],
                booking: "applied",
                feesReady: true,
            });
        const paid = await depositEvidence(fixture);
        const invoiceId = paid.booking.invoice_id;
        if (invoiceId === null) throw new Error("the enrolment has no invoice");
        await linkStripeDepositInvoice(fixture, invoiceId);
        const e = await depositEvidence(fixture);
        // the camp's price and the BC tax on it: GST 5% and PST 7% of $120.00
        const tax = { gst: 600, pst: 840 };
        const total = PROGRAM.price + tax.gst + tax.pst;
        expect(e.invoice).toMatchObject({
            id: invoiceId,
            status: "sent",
            subtotal_cents: PROGRAM.price,
            tax_total_cents: tax.gst + tax.pst,
            total_cents: total,
        });
        expect(e.documents).toEqual([{ id: invoiceId }]);
        expect(e.owned_bookings.map((row) => row.id).sort()).toEqual([...bookingIds].sort());
        const [deposit] = e.payments;
        expect(deposit).toMatchObject({
            kind: "deposit",
            method: "card",
            provider: "stripe",
            booking_id: fixture.bookingId,
            invoice_id: null,
            amount_cents: PROGRAM.deposit,
            client_id: fixture.clientId,
        });
        expect(e.provider.intents).toEqual([
            expect.objectContaining({
                id: deposit?.provider_ref,
                amount: PROGRAM.deposit,
                currency: "cad",
                livemode: false,
                metadata: expect.objectContaining({
                    booking_id: fixture.bookingId,
                    business_id: e.businessId,
                }),
            }),
        ]);
        const legs = (ref: string) =>
            e.entries
                .filter((x) => x.ref === ref)
                .map((x) => [x.category, x.code, x.amount_cents, x.subject_type, x.subject_id])
                .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        const sorted = (rows: (string | number | null)[][]) =>
            rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        const book = fixture.bookingId;
        expect(legs(`payment:${deposit?.id ?? ""}`)).toEqual(
            sorted([
                ["stripe", "", PROGRAM.deposit, "booking", book],
                ["deposit", "", -PROGRAM.deposit, "booking", book],
            ]),
        );
        expect(legs(`invoice:${invoiceId}`)).toEqual(
            sorted([
                ["receivable", "", total, "invoice", invoiceId],
                ["revenue", "", -PROGRAM.price, "invoice", invoiceId],
                ["tax", "GST", -tax.gst, "invoice", invoiceId],
                ["tax", "PST", -tax.pst, "invoice", invoiceId],
            ]),
        );
        expect(legs(`application:${book}:${invoiceId}`)).toEqual(
            sorted([
                ["deposit", "", PROGRAM.deposit, "booking", book],
                ["receivable", "", -PROGRAM.deposit, "invoice", invoiceId],
            ]),
        );
        const balance = (category: string, subject: string) =>
            e.entries
                .filter((x) => x.category === category && x.subject_id === subject)
                .reduce((sum, x) => sum + x.amount_cents, 0);
        expect(balance("deposit", book)).toBe(0);
        expect(balance("receivable", invoiceId)).toBe(total - PROGRAM.deposit);
        await outstanding(
            owner,
            { id: invoiceId, name: setup.booker.name, phone: setup.booker.phone },
            total - PROGRAM.deposit,
        );
        await owner.reload();
        await outstanding(
            owner,
            { id: invoiceId, name: setup.booker.name, phone: setup.booker.phone },
            total - PROGRAM.deposit,
        );
        await info.attach("owned-program-deposit", {
            body: JSON.stringify(e),
            contentType: "application/json",
        });
    } finally {
        await ownerContext.close();
    }
});

test("STR-E17 a new client pays an online booking's deposit by card, the owner approves the request, and the visit's invoice applies the deposit", async ({
    browser,
}, info) => {
    test.setTimeout(300_000);
    const b = strings.publicBooking;
    const s = strings.bookings;
    const ownerContext = await browser.newContext({ baseURL: webBaseUrl() });
    const customer = await customerContext(browser);
    try {
        const owner = await ownerContext.newPage();
        await signIn(owner);
        const setup = await prepareOnlineDeposit(owner, "Pepper");
        const client = await customer.newPage();
        const f = await requestWithDeposit(client, setup, 3);
        await client.reload();
        await expect(client.getByRole("heading", { name: b.payTitle, exact: true })).toBeVisible();
        await payOnlineDeposit(client);
        const collected = await collectedDeposit(f);
        const fees = collected.provider.fees;
        const depositPaymentId = collected.payments[0]?.id;
        if (fees === null || depositPaymentId === undefined)
            throw new Error("the settled deposit is missing");
        const refs = { depositPaymentId, fees };
        expectDepositStage(collected, f, "collected", refs);

        await navigate(owner, "/today");
        const request = owner.getByRole("button", {
            name: new RegExp(`${setup.booker.name} asked for ${setup.visit.itemName}`),
        });
        await expect(request).toBeVisible({ timeout: 60_000 });
        await request.click();
        await expect(owner.getByText(s.statusLabel("pending")).first()).toBeVisible();
        await owner.getByRole("button", { name: s.approve, exact: true }).click();
        await expect(owner.getByRole("button", { name: s.markNoShow, exact: true })).toBeVisible({
            timeout: 60_000,
        });
        expect(
            await select<{ status: string }>`SELECT status FROM bookings WHERE id = ${f.bookingId}`,
        ).toEqual([{ status: "confirmed" }]);
        const booked = async (): Promise<number> =>
            (await textsTo(owner.request, setup.booker.phone)).filter(({ Snippet }) =>
                Snippet.startsWith("You're booked for"),
            ).length;
        await expect.poll(booked).toBe(1);
        expectDepositStage(await depositEvidence(f), f, "collected", refs);

        const invoice = await invoiceVisitUi(
            owner,
            { booking: setup.visit, visit: { id: f.bookingId } },
            formatParts([setup.booker.subject, setup.booker.name]),
        );
        await linkStripeDepositInvoice(f, invoice.id);
        expectDepositStage(await depositEvidence(f), f, "draft", {
            ...refs,
            invoiceId: invoice.id,
        });
        await sendBookingInvoiceUi(owner, invoice);
        const applied = await depositEvidence(f);
        expectDepositStage(applied, f, "applied", { ...refs, invoiceId: invoice.id });
        await outstanding(owner, invoice, 9200);
        expect(await booked()).toBe(1);
        await info.attach("online-deposit-approved-and-applied", {
            body: JSON.stringify(applied),
            contentType: "application/json",
        });
    } finally {
        await customer.close();
        await ownerContext.close();
    }
});

test("STR-E31 a client cancels from the manage link a visit whose paid deposit is already on its bill, and the deposit stays with the business with no refund at Stripe", async ({
    browser,
}, info) => {
    test.setTimeout(300_000);
    const m = strings.publicManage;
    const amount = formatMoney(2000, "CAD");
    const ownerContext = await browser.newContext({ baseURL: webBaseUrl() });
    const customer = await customerContext(browser);
    try {
        const owner = await ownerContext.newPage();
        await signIn(owner);
        const setup = await prepareOnlineDeposit(owner, "Maple");
        const client = await customer.newPage();
        const f = await requestWithDeposit(client, setup, 5);
        await payOnlineDeposit(client);
        const deposit = (await collectedDeposit(f)).payments[0];
        if (deposit === undefined) throw new Error("the settled deposit is missing");
        await apiCall(owner, "PATCH", `/v1/bookings/${f.bookingId}`, { status: "confirmed" }, 200);
        const invoice = await invoiceVisitUi(
            owner,
            { booking: setup.visit, visit: { id: f.bookingId } },
            formatParts([setup.booker.subject, setup.booker.name]),
        );
        await linkStripeDepositInvoice(f, invoice.id);
        await sendBookingInvoiceUi(owner, invoice);
        const applied = await depositEvidence(f);
        expect(applied.booking.deposit_status).toBe("applied");
        const [row] = await select<{ manage_token: string; business: string }>`
            SELECT b.manage_token, z.name AS business FROM bookings b
            JOIN businesses z ON z.id = b.business_id WHERE b.id = ${f.bookingId}`;
        if (row === undefined) throw new Error("the visit has no manage link");
        const kept = m.cancelApplied(amount, row.business);

        await client.goto(manageUrl(row.manage_token));
        await expect(
            client.getByText(m.depositPaid(amount), { exact: true }).first(),
        ).toBeVisible();
        await client.getByRole("button", { name: m.cancel, exact: true }).click();
        await expect(client.getByText(kept, { exact: true })).toBeVisible();
        await expect(client.getByText(m.cancelRefund(amount), { exact: true })).toHaveCount(0);
        await client.getByRole("button", { name: m.cancelConfirm, exact: true }).click();
        await expect(
            client.getByRole("heading", { name: m.canceledTitle, exact: true }).first(),
        ).toBeInViewport();
        await expect(client.getByText(kept, { exact: true }).first()).toBeVisible();
        await client.reload();
        await expect(client.getByText(kept, { exact: true }).first()).toBeVisible();
        await expect(client.getByText(m.depositRefunded(amount), { exact: true })).toHaveCount(0);

        const e = await depositEvidence(f);
        expect(e.booking.deposit_status).toBe("applied");
        expect(e.payments.filter((p) => p.parent_payment_id === deposit.id)).toEqual([]);
        expect(e.provider.refunds).toEqual([]);
        expect(
            await select<{ status: string }>`SELECT status FROM bookings WHERE id = ${f.bookingId}`,
        ).toEqual([{ status: "canceled" }]);
        await info.attach("manage-link-cancel-keeps-the-applied-deposit", {
            body: JSON.stringify(e),
            contentType: "application/json",
        });
    } finally {
        await customer.close();
        await ownerContext.close();
    }
});

test("STR-E28 a new client pays an online booking's deposit by card, the owner declines the request, and Stripe refunds the deposit once", async ({
    browser,
}, info) => {
    test.setTimeout(300_000);
    const s = strings.bookings;
    const ownerContext = await browser.newContext({ baseURL: webBaseUrl() });
    const customer = await customerContext(browser);
    try {
        const owner = await ownerContext.newPage();
        await signIn(owner);
        const setup = await prepareOnlineDeposit(owner, "Juniper");
        const client = await customer.newPage();
        const f = await requestWithDeposit(client, setup, 6);
        await payOnlineDeposit(client);
        const deposit = (await collectedDeposit(f)).payments[0];
        if (deposit?.provider_ref == null) throw new Error("the settled deposit is missing");

        await navigate(owner, "/today");
        await owner
            .getByRole("button", {
                name: new RegExp(`${setup.booker.name} asked for ${setup.visit.itemName}`),
            })
            .click({ timeout: 60_000 });
        await owner.getByRole("button", { name: s.decline, exact: true }).click();
        await expect(
            owner.getByText(s.declineRefund(formatMoney(2000, "CAD")), { exact: true }),
        ).toBeVisible();
        await owner.getByRole("button", { name: s.confirmDecline, exact: true }).click();
        await expect(owner.getByText(s.declinedDone, { exact: true }).first()).toBeVisible({
            timeout: 60_000,
        });

        await expect
            .poll(async () => (await depositEvidence(f)).booking.deposit_status, {
                timeout: 90_000,
            })
            .toBe("refunded");
        const e = await depositEvidence(f);
        const refunds = e.payments.filter((p) => p.parent_payment_id === deposit.id);
        expect(refunds).toEqual([
            expect.objectContaining({ kind: "refund", status: "succeeded", amount_cents: 2000 }),
        ]);
        expect(e.provider.refunds).toEqual([
            {
                id: refunds[0]?.provider_ref,
                payment_intent: deposit.provider_ref,
                status: "succeeded",
                amount: 2000,
                currency: "cad",
            },
        ]);
        const held = e.entries
            .filter((x) => x.category === "deposit" && x.subject_id === f.bookingId)
            .reduce((sum, x) => sum + x.amount_cents, 0);
        expect(held).toBe(0);
        expect(
            await select<{ status: string }>`SELECT status FROM bookings WHERE id = ${f.bookingId}`,
        ).toEqual([{ status: "canceled" }]);
        const told = async (): Promise<number> =>
            (await textsTo(owner.request, setup.booker.phone)).filter(({ Snippet }) =>
                Snippet.endsWith("deposit is being refunded to your card."),
            ).length;
        await expect.poll(told).toBe(1);
        await info.attach("online-deposit-declined-and-refunded", {
            body: JSON.stringify(e),
            contentType: "application/json",
        });
    } finally {
        await customer.close();
        await ownerContext.close();
    }
});

test("STR-E18 a deposit left unpaid is paid by card from the manage link with two tabs open, collected once, and refunded by Stripe when the client cancels outside the cut-off", async ({
    browser,
}, info) => {
    test.setTimeout(300_000);
    const m = strings.publicManage;
    const amount = formatMoney(2000, "CAD");
    const ownerContext = await browser.newContext({ baseURL: webBaseUrl() });
    const customer = await customerContext(browser);
    try {
        const owner = await ownerContext.newPage();
        await signIn(owner);
        const setup = await prepareOnlineDeposit(owner, "Hazel");
        // left at the card step, the request keeps its deposit due
        const f = await requestWithDeposit(await customer.newPage(), setup, 6);
        const [row] = await select<{ manage_token: string }>`
            SELECT manage_token FROM bookings WHERE id = ${f.bookingId}`;
        if (row === undefined) throw new Error("the requested visit has no manage link");
        const tabs = [await customer.newPage(), await customer.newPage()];
        for (const tab of tabs) {
            await tab.goto(manageUrl(row.manage_token));
            await expect(tab.getByText(m.depositDueBody(amount), { exact: true })).toBeVisible();
            await tab.getByRole("button", { name: m.payDeposit, exact: true }).click();
        }
        const [first, second] = tabs;
        if (first === undefined || second === undefined) throw new Error("two tabs are open");
        await payManageDeposit(first, 2000);
        // the second tab holds the same payment, which Stripe already took
        await payManageDeposit(second, 2000);
        const collected = await collectedDeposit(f);
        expect(collected.provider.intents).toHaveLength(1);
        const deposit = collected.payments[0];
        if (deposit?.provider_ref == null) throw new Error("the settled deposit is missing");
        await second.reload();
        await expect(
            second.getByText(m.depositPaid(amount), { exact: true }).first(),
        ).toBeVisible();
        await expect(second.getByRole("button", { name: m.payDeposit, exact: true })).toHaveCount(
            0,
        );

        await second.getByRole("button", { name: m.cancel, exact: true }).click();
        await expect(second.getByText(m.cancelRefund(amount), { exact: true })).toBeVisible();
        await second.getByRole("button", { name: m.cancelConfirm, exact: true }).click();
        await expect(
            second.getByRole("heading", { name: m.canceledTitle, exact: true }).first(),
        ).toBeInViewport();
        await expect(second.getByText(m.depositRefunded(amount), { exact: true })).toBeVisible();
        await expect
            .poll(async () => (await depositEvidence(f)).booking.deposit_status, {
                timeout: 90_000,
            })
            .toBe("refunded");
        await second.reload();
        await expect(second.getByText(m.depositRefunded(amount), { exact: true })).toBeVisible();
        await expect(second.getByText(m.depositPaid(amount), { exact: true })).toHaveCount(0);
        const e = await depositEvidence(f);
        const refunds = e.payments.filter((p) => p.parent_payment_id === deposit.id);
        expect(refunds).toEqual([
            expect.objectContaining({ kind: "refund", status: "succeeded", amount_cents: 2000 }),
        ]);
        expect(e.provider.refunds).toEqual([
            {
                id: refunds[0]?.provider_ref,
                payment_intent: deposit.provider_ref,
                status: "succeeded",
                amount: 2000,
                currency: "cad",
            },
        ]);
        expect(
            await select<{ status: string }>`SELECT status FROM bookings WHERE id = ${f.bookingId}`,
        ).toEqual([{ status: "canceled" }]);
        await info.attach("manage-link-deposit-paid-once-and-refunded", {
            body: JSON.stringify(e),
            contentType: "application/json",
        });
    } finally {
        await customer.close();
        await ownerContext.close();
    }
});

test("SCH-E2E-17 the reaper releases an abandoned deposit but keeps one Stripe took while its event was held, and that event settles it once however often it comes", async ({
    browser,
}, info) => {
    test.setTimeout(300_000);
    const ownerContext = await browser.newContext({ baseURL: webBaseUrl() });
    const customers: BrowserContext[] = [];
    try {
        const owner = await ownerContext.newPage();
        await signIn(owner);
        const visit = (bookingId: string) => select<{ status: string; slot: string }>`
            SELECT b.status, s.status AS slot FROM bookings b JOIN slots s ON s.id = b.slot_id
            WHERE b.id = ${bookingId}`;
        const said = async (phone: string, words: string): Promise<number> =>
            (await textsTo(owner.request, phone)).filter(({ Snippet }) => Snippet.includes(words))
                .length;
        const releasedText = "was released because its deposit wasn't paid";

        const abandoned = await prepareOnlineDeposit(owner, "Rook");
        const leaving = await customerContext(browser);
        customers.push(leaving);
        const left = await requestWithDeposit(await leaving.newPage(), abandoned, 4);
        await leaving.close();
        await reapDeposit(left);
        const released = await depositEvidence(left);
        expect(released.booking.deposit_status).toBe("none");
        expect(released.payments.map((p) => p.status)).toEqual(["canceled"]);
        expect(released.provider.intents.map((p) => p.status)).toEqual(["canceled"]);
        expect(released.entries).toEqual([]);
        expect(await visit(left.bookingId)).toEqual([{ status: "canceled", slot: "canceled" }]);
        await expect.poll(() => said(abandoned.booker.phone, releasedText)).toBe(1);

        const paid = await prepareOnlineDeposit(owner, "Wren");
        const customer = await customerContext(browser);
        customers.push(customer);
        const client = await customer.newPage();
        const f = await requestWithDeposit(client, paid, 5);
        const intent = (await depositEvidence(f)).provider.intents[0]?.id;
        if (intent === undefined) throw new Error("the deposit has no Stripe intent");
        await controlStripeRelay(owner, "arm", { booking: f.bookingId, intent });
        await payOnlineDeposit(client);
        await expect.poll(async () => (await controlStripeRelay(owner, "status")).held).toBe(true);
        const held = await depositEvidence(f);
        expect(held.payments.map((p) => p.status)).toEqual(["pending"]);
        expect(held.provider.intents.map((p) => p.status)).toEqual(["succeeded"]);
        expect(held.entries).toEqual([]);
        await reapDeposit(f);
        const kept = await depositEvidence(f);
        expect([kept.booking, kept.payments, kept.entries]).toEqual([
            held.booking,
            held.payments,
            held.entries,
        ]);
        expect(kept.provider.intents.map((p) => p.status)).toEqual(["succeeded"]);
        expect(kept.provider.refunds).toEqual([]);
        expect(await visit(f.bookingId)).toEqual([{ status: "pending", slot: "scheduled" }]);

        await expect(async () => {
            expect((await controlStripeRelay(owner, "release")).upstream_status).toBe(200);
        }).toPass({ timeout: 60_000, intervals: [1000, 3000, 5000] });
        const settled = await depositEvidence(f);
        const fees = settled.provider.fees;
        const depositPaymentId = settled.payments[0]?.id;
        if (fees === null || depositPaymentId === undefined)
            throw new Error("the released deposit did not settle");
        expectDepositStage(settled, f, "collected", { depositPaymentId, fees });
        expect((await controlStripeRelay(owner, "redeliver")).upstream_status).toBe(200);
        expect(await depositEvidence(f)).toEqual(settled);
        expect(await visit(f.bookingId)).toEqual([{ status: "pending", slot: "scheduled" }]);
        expect(await said(paid.booker.phone, releasedText)).toBe(0);
        expect(await said(paid.booker.phone, "Request sent for ")).toBe(1);
        await info.attach("reaper-versus-held-deposit", {
            body: JSON.stringify({
                released,
                held,
                settled,
                relay: await controlStripeRelay(owner, "status"),
            }),
            contentType: "application/json",
        });
    } finally {
        await Promise.allSettled(customers.map((context) => context.close()));
        await ownerContext.close();
    }
});

test("FIN-DEPOSIT-11 with tax registration off, a card deposit paid on Connect leaves an untaxed enrolment invoice", async ({
    browser,
}) => {
    test.setTimeout(300_000);
    const ownerContext = await browser.newContext({ baseURL: webBaseUrl() });
    const owner = await ownerContext.newPage();
    try {
        await signIn(owner);
        expect((await patchBusiness(owner, { tax_registered: false })).status()).toBe(200);
        const setup = await prepareProgram(owner);
        const { fixture } = await enrolWithCardDeposit(browser, setup);
        await expect
            .poll(
                async () => {
                    const e = await depositEvidence(fixture);
                    return {
                        local: e.payments.map((p) => [p.kind, p.status]),
                        remote: e.provider.intents.map((p) => [p.status, p.amount]),
                        booking: e.booking.deposit_status,
                    };
                },
                { timeout: 90_000 },
            )
            .toEqual({
                local: [["deposit", "succeeded"]],
                remote: [["succeeded", PROGRAM.deposit]],
                booking: "applied",
            });
        const paid = await depositEvidence(fixture);
        const invoiceId = paid.booking.invoice_id;
        if (invoiceId === null) throw new Error("the enrolment has no invoice");
        await linkStripeDepositInvoice(fixture, invoiceId);
        const e = await depositEvidence(fixture);
        expect(e.invoice).toMatchObject({
            id: invoiceId,
            subtotal_cents: PROGRAM.price,
            tax_total_cents: 0,
            total_cents: PROGRAM.price,
        });
        expect(e.entries.filter((x) => x.category === "tax")).toEqual([]);
        await outstanding(
            owner,
            { id: invoiceId, name: setup.booker.name, phone: setup.booker.phone },
            PROGRAM.price - PROGRAM.deposit,
        );
    } finally {
        await patchBusiness(owner, { tax_registered: true });
        await ownerContext.close();
    }
});

test("FIN-DEPOSIT-14 a card deposit paid before the invoice is issued and one paid after both come off the bill, and a no-show keeps the deposit as revenue", async ({
    browser,
}, info) => {
    test.setTimeout(480_000);
    const context = await browser.newContext({ baseURL: webBaseUrl() });
    const books = async (clientId: string, intentId: string) => {
        const provider = await stripeDispute("show", intentId);
        const money = await clientMoney(clientId);
        expectLedgerMatchesStripe(money.entries, provider);
        return { provider, money };
    };
    try {
        const owner = await context.newPage();
        await signIn(owner);

        const early = await test.step("a deposit paid before the invoice is issued", async () => {
            const visit = await prepareDepositBooking(owner);
            await collectDepositUi(owner, visit);
            const collected = await collectedDeposit(visit.fixture);
            const invoice = await invoiceVisitUi(owner, visit);
            await linkStripeDepositInvoice(visit.fixture, invoice.id);
            await sendBookingInvoiceUi(owner, invoice);
            const applied = await depositEvidence(visit.fixture);
            expect(applied.booking.deposit_status).toBe("applied");
            await outstanding(owner, invoice, 9200);
            return books(visit.booking.clientId, collected.provider.intents[0]?.id ?? "");
        });

        const late = await test.step("a deposit paid after the invoice is issued", async () => {
            const visit = await prepareDepositBooking(owner);
            const invoice = await invoiceVisitUi(owner, visit);
            await linkStripeDepositInvoice(visit.fixture, invoice.id);
            await sendBookingInvoiceUi(owner, invoice, { balance_cents: 11200, status: "sent" });
            expect((await depositEvidence(visit.fixture)).booking.deposit_status).toBe("pending");
            await collectDepositUi(owner, visit);
            await expect
                .poll(
                    async () => {
                        const e = await depositEvidence(visit.fixture);
                        return {
                            booking: e.booking.deposit_status,
                            remote: e.provider.intents.map((p) => p.status),
                            feesReady: e.provider.fees !== null,
                        };
                    },
                    { timeout: 90_000 },
                )
                .toEqual({
                    booking: "applied",
                    remote: ["succeeded"],
                    feesReady: true,
                });
            const applied = await depositEvidence(visit.fixture);
            expect(applied.entries.filter((e) => e.event === "application")).not.toEqual([]);
            await outstanding(owner, invoice, 9200);
            return books(visit.booking.clientId, applied.provider.intents[0]?.id ?? "");
        });

        const kept = await test.step("a no-show keeps the deposit as revenue", async () => {
            const visit = await startedDepositVisit(owner, false);
            await collectDepositUi(owner, visit);
            const collected = await collectedDeposit(visit.fixture);
            await openBooking(owner, visit.booking, visit.visit.id);
            const s = strings.bookings;
            await press(owner.getByRole("button", { name: s.markNoShow, exact: true }));
            await expect(
                owner.getByText(s.noShowKeep(formatMoney(2000, "CAD")), { exact: true }),
            ).toBeVisible();
            await press(owner.getByRole("button", { name: s.confirmNoShow, exact: true }));
            await expect
                .poll(async () => (await depositEvidence(visit.fixture)).booking.deposit_status)
                .toBe("forfeited");
            const result = await books(
                visit.booking.clientId,
                collected.provider.intents[0]?.id ?? "",
            );
            const totals = categoryTotals(result.money.entries);
            expect(totals.deposit ?? 0).toBe(0);
            expect(totals.revenue).toBe(-2000);
            expect(result.provider.refunds).toEqual([]);
            return result;
        });

        await info.attach("fin-deposit-14", {
            body: JSON.stringify({ early, late, kept }, null, 2),
            contentType: "application/json",
        });
    } finally {
        await context.close();
    }
});

test("FIN-DEPOSIT-15 staff cancelling a camp enrolment paid on Connect cancels its days, voids its invoice and refunds the card deposit once", async ({
    browser,
}, info) => {
    test.setTimeout(300_000);
    const p = strings.programs;
    const context = await browser.newContext({ baseURL: webBaseUrl() });
    try {
        const owner = await context.newPage();
        await signIn(owner);
        const setup = await prepareProgram(owner);
        const { fixture, bookingIds } = await enrolWithCardDeposit(browser, setup);
        await expect
            .poll(
                async () => {
                    const e = await depositEvidence(fixture);
                    return {
                        booking: e.booking.deposit_status,
                        remote: e.provider.intents.map((i) => i.status),
                        feesReady: e.provider.fees !== null,
                    };
                },
                { timeout: 90_000 },
            )
            .toEqual({ booking: "applied", remote: ["succeeded"], feesReady: true });
        const invoiceId = (await depositEvidence(fixture)).booking.invoice_id;
        if (invoiceId === null) throw new Error("the enrolment has no invoice");
        await linkStripeDepositInvoice(fixture, invoiceId);
        const paid = await depositEvidence(fixture);
        const [deposit] = paid.payments;
        const intentId = paid.provider.intents[0]?.id;
        if (deposit === undefined || intentId === undefined) throw new Error("no card deposit");

        await navigate(owner, "/schedule/classes");
        await owner.getByRole("tab", { name: p.tab, exact: true }).click();
        await owner
            .getByRole("navigation", { name: p.tab, exact: true })
            .getByRole("button")
            .filter({ hasText: setup.camp.name })
            .click({ timeout: 60_000 });
        const row = owner.getByRole("listitem").filter({ hasText: setup.booker.subject });
        await row.getByRole("button", { name: p.cancelEnrolment, exact: true }).click({
            timeout: 60_000,
        });
        const confirm = owner.getByRole("dialog", {
            name: p.cancelEnrolmentTitle(setup.booker.subject),
            exact: true,
        });
        await expect(confirm.getByText(p.cancelEnrolmentBody, { exact: true })).toBeVisible();
        const cancelling = owner.waitForResponse(
            (r) =>
                new URL(r.url()).pathname ===
                    `/v1/programs/${setup.program.id}/enrolments/cancel` &&
                r.request().method() === "POST",
        );
        await confirm.getByRole("button", { name: p.cancelEnrolment, exact: true }).click();
        const cancelled = await cancelling;
        expect(cancelled.status(), await cancelled.text()).toBe(200);
        const outcome = (await cancelled.json()) as {
            program_id: string;
            canceled: string[];
            refunded_cents: number;
        };
        expect(outcome).toMatchObject({
            program_id: setup.program.id,
            refunded_cents: PROGRAM.deposit,
        });
        expect([...outcome.canceled].sort()).toEqual([...bookingIds].sort());
        await expect(
            owner.getByText(p.canceledEnrolment(setup.booker.subject), { exact: true }),
        ).toBeVisible();
        await expect(row).toHaveCount(0, { timeout: 60_000 });

        await expect
            .poll(
                async () => {
                    const e = await depositEvidence(fixture);
                    return {
                        booking: e.booking.deposit_status,
                        refunds: e.provider.refunds.map((r) => [r.status, r.amount]),
                    };
                },
                { timeout: 90_000 },
            )
            .toEqual({ booking: "refunded", refunds: [["succeeded", PROGRAM.deposit]] });
        const after = await depositEvidence(fixture);
        expect(after.invoice).toMatchObject({ id: invoiceId, status: "void" });
        const refunds = after.payments.filter((x) => x.parent_payment_id === deposit.id);
        expect(refunds).toEqual([
            expect.objectContaining({
                kind: "refund",
                status: "succeeded",
                amount_cents: PROGRAM.deposit,
            }),
        ]);
        expect(after.provider.refunds).toEqual([
            {
                id: refunds[0]?.provider_ref,
                payment_intent: intentId,
                status: "succeeded",
                amount: PROGRAM.deposit,
                currency: "cad",
            },
        ]);
        const days = await select<{ id: string; status: string; subject_id: string | null }>`
            SELECT id, status, subject_id FROM bookings
            WHERE id = ANY(${bookingIds}::text[]) ORDER BY id`;
        expect(days.map((d) => [d.id, d.status])).toEqual(
            [...bookingIds].sort().map((id) => [id, "canceled"]),
        );
        const balance = (category: string, subject: string) =>
            after.entries
                .filter((x) => x.category === category && x.subject_id === subject)
                .reduce((sum, x) => sum + x.amount_cents, 0);
        expect(balance("deposit", fixture.bookingId)).toBe(0);
        expect(balance("receivable", invoiceId)).toBe(0);

        const provider = await stripeDispute("show", intentId);
        expect(provider.charge).toMatchObject({
            amount: PROGRAM.deposit,
            amount_refunded: PROGRAM.deposit,
        });
        expect(provider.refunds.map((r) => [r.id, r.amount, r.status])).toEqual([
            [refunds[0]?.provider_ref, PROGRAM.deposit, "succeeded"],
        ]);
        const money = await clientMoney(fixture.clientId);
        expectLedgerMatchesStripe(money.entries, provider);
        const totals = categoryTotals(money.entries);
        expect(totals.deposit ?? 0).toBe(0);
        expect(totals.receivable ?? 0).toBe(0);
        expect(totals.revenue ?? 0).toBe(0);

        const again = await owner.request.post(
            `${bookingApi()}/v1/programs/${setup.program.id}/enrolments/cancel`,
            {
                headers: { Origin: new URL(owner.url()).origin, "Idempotency-Key": randomUUID() },
                data: {
                    client_id: fixture.clientId,
                    subject_id: days[0]?.subject_id,
                    notify: false,
                },
            },
        );
        expect(again.status(), await again.text()).toBe(404);
        expect(await depositEvidence(fixture)).toEqual(after);
        expect((await stripeDispute("show", intentId)).refunds).toEqual(provider.refunds);
        expect(await clientMoney(fixture.clientId)).toEqual(money);
        await info.attach("fin-deposit-15", {
            body: JSON.stringify({ outcome, after, provider }, null, 2),
            contentType: "application/json",
        });
    } finally {
        await context.close();
    }
});
