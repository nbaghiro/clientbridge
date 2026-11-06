import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { formatMoney, formatParts, strings } from "@clientbridge/app-core/public";
import {
    expectPaid,
    openInvoice,
    paymentDrawer,
    recordCash,
} from "../../../web/e2e/support/billing";
import { textsTo } from "../../../web/e2e/support/auth";
import { select } from "../../../web/e2e/support/db";
import { customerContext, navigate, signIn } from "../../../web/e2e/support/session";
import { controlStripeRelay } from "./support/bridge";
import {
    depositEvidence,
    linkStripeDepositInvoice,
    reapDeposit,
    type DepositEvidence,
} from "./support/depositContract";
import {
    prepareDepositBooking,
    collectDepositUi,
    invoiceVisitUi,
    payOnlineDeposit,
    prepareOnlineDeposit,
    requestWithDeposit,
    sendBookingInvoiceUi,
    refundUi,
} from "./support/deposit";
import { expectDepositStage } from "./support/depositOracle";
import { enrolWithCardDeposit, PROGRAM, prepareProgram, webBaseUrl } from "./support/program";
import { runPort } from "@clientbridge/config/e2e/run";

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
        const collected = await depositEvidence(f);
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
        expect(await said(paid.booker.phone, "received your request")).toBe(1);
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
