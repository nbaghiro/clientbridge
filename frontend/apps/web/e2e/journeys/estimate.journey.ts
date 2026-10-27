import { randomUUID } from "node:crypto";
import { formatMoney, strings } from "@clientbridge/app-core/public";
import { expect, test, type Page } from "@playwright/test";
import {
    recordPayment,
    createDocumentClient,
    documentEvidence,
    openDocument,
    saveDocument,
    type DocumentClient,
    type DocumentEvidence,
    type DocumentRecord,
} from "../support/billing";
import { bookingApi } from "../support/bookings";
import { paymentEvidence } from "../support/evidence";
import { mailedLinks } from "../support/messaging";
import { openRefund, refundEvidence } from "../support/refunds";
import { customerContext, signIn } from "../support/session";
import { apiCall, stackUrl } from "../support/visit";

test.use({ actionTimeout: 15_000 });

const pe = strings.publicEstimate;
const money = (cents: number): string => formatMoney(cents, "CAD");
const note = "Thanks for choosing the de-shedding add-on. Brush twice a week until the next visit.";

interface Estimate {
    id: string;
    number: number;
    view_token: string;
    total_cents: number;
}

// a required $100 groom and an optional $100 add-on, both GST only, with 10% off the estimate
async function sendEstimate(page: Page, client: DocumentClient): Promise<Estimate> {
    const line = (description: string, optional: boolean) => ({
        description,
        quantity: 1,
        unit_amount_cents: 10000,
        tax_class: "federal_only",
        optional,
    });
    return apiCall<Estimate>(
        page,
        "POST",
        "/v1/estimates",
        {
            client_id: client.id,
            lines: [line("Full groom", false), line("De-shedding treatment", true)],
            discount: { kind: "percent", value: 10, reason: "Returning client" },
            send: true,
        },
        201,
    );
}

function lineFacts(evidence: DocumentEvidence) {
    return evidence.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unit_amount_cents: line.unit_amount_cents,
        amount_cents: line.amount_cents,
        tax_amount_cents: line.tax_amount_cents,
        discount_cents: line.discount_cents,
        sale_discount_cents: line.sale_discount_cents,
        tax_class: line.tax_class,
        booking_id: line.booking_id,
        staff_id: line.staff_id,
    }));
}

// both $100 lines less 10%, each carrying $4.50 GST
const converted = ["Full groom", "De-shedding treatment"].map((description) => ({
    description,
    quantity: 1,
    unit_amount_cents: 10000,
    amount_cents: 9000,
    tax_amount_cents: 450,
    discount_cents: 0,
    sale_discount_cents: 1000,
    tax_class: "federal_only",
    booking_id: null,
    staff_id: null,
}));

const HOLE = "\u0000";

/** A catalog sentence with its invoice label left open, since the label's format is the app's. */
function sentence(text: string): RegExp {
    return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(HOLE, ".+"));
}

function totals(evidence: { entries: { category: string; amount_cents: number }[] }) {
    const sums: Record<string, number> = {};
    for (const entry of evidence.entries)
        sums[entry.category] = (sums[entry.category] ?? 0) + entry.amount_cents;
    return sums;
}

test("FLOW-02-A the customer ticks an add-on on the emailed estimate, and the owner converts, edits and issues the exact accepted work", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(240_000);
    await signIn(page);
    const client = await createDocumentClient(page);
    const estimate = await sendEstimate(page, client);
    // $100 less 10% plus 5% GST, before the add-on is ticked
    expect(estimate.total_cents).toBe(9450);
    const [link] = await mailedLinks(page.request, client.email, "/e/");
    expect(link?.pathname).toBe(`/e/${estimate.view_token}`);
    expect(link?.host).toBe(stackUrl("PAY_BASE_URL").host);

    const context = await customerContext(browser);
    try {
        const customer = await context.newPage();
        await customer.goto(link?.href ?? "");
        await expect(
            customer.getByRole("button", { name: pe.acceptFor(money(9450)), exact: true }),
        ).toBeVisible();
        const quoted = customer.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === `/estimate/${estimate.view_token}` &&
                new URL(response.url()).searchParams.size > 0,
        );
        await customer.getByRole("checkbox", { name: "De-shedding treatment" }).check();
        expect((await quoted).status()).toBe(200);
        // $200 less 10% is $180, plus $9 GST
        const accept = customer.getByRole("button", {
            name: pe.acceptFor(money(18900)),
            exact: true,
        });
        await expect(accept).toBeVisible();
        await expect(customer.getByText(money(18000), { exact: true })).toBeVisible();
        expect((await documentEvidence("estimate", estimate.id)).document).toMatchObject({
            status: "sent",
            total_cents: 9450,
            converted_invoice_id: null,
        });
        const accepting = customer.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === `/estimate/${estimate.view_token}/accept`,
        );
        await accept.click();
        const accepted = await accepting;
        expect(accepted.status(), await accepted.text()).toBe(200);
        expect(accepted.request().postDataJSON()).toMatchObject({ total_cents: 18900 });
        await expect(customer.getByRole("heading", { name: pe.acceptedTitle })).toBeVisible();
    } finally {
        await context.close();
    }
    const acceptedEstimate = await documentEvidence("estimate", estimate.id);
    expect(acceptedEstimate.document).toMatchObject({
        status: "accepted",
        subtotal_cents: 18000,
        tax_total_cents: 900,
        total_cents: 18900,
        converted_invoice_id: null,
    });
    expect(
        acceptedEstimate.lines.filter((line) => line.optional).map((line) => line.selected),
    ).toEqual([true]);

    const detail = await openDocument(page, client, "estimate", estimate.id);
    await expect(
        detail.getByText(strings.billing.estimateStatus.accepted, { exact: true }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: strings.billing.convert, exact: true }).click();
    const converting = page.waitForResponse(
        (response) =>
            response.url().endsWith(`/estimates/${estimate.id}/convert`) &&
            response.request().method() === "POST",
    );
    await page
        .getByRole("dialog")
        .last()
        .getByRole("button", { name: strings.billing.convert, exact: true })
        .click();
    const conversion = await converting;
    expect(conversion.status(), await conversion.text()).toBe(201);
    const invoice = (await conversion.json()) as DocumentRecord;
    expect(invoice).toMatchObject({
        status: "draft",
        client_id: client.id,
        subtotal_cents: 18000,
        tax_total_cents: 900,
        total_cents: 18900,
        number: null,
    });
    const draft = await documentEvidence("invoice", invoice.id);
    expect(lineFacts(draft)).toEqual(converted);
    expect(draft.siblings).toEqual([{ id: invoice.id, status: "draft" }]);
    expect((await documentEvidence("estimate", estimate.id)).document).toMatchObject({
        status: "accepted",
        converted_invoice_id: invoice.id,
    });
    expect((await paymentEvidence(invoice.id)).entries).toEqual([]);

    const record = await openDocument(page, client, "invoice", invoice.id);
    await record.getByRole("button", { name: strings.billing.edit, exact: true }).click();
    const editor = page.getByRole("dialog").filter({
        has: page.getByRole("button", { name: strings.billing.saveDraft, exact: true }),
    });
    await editor.getByRole("textbox", { name: strings.billing.messageToClient }).fill(note);
    const saved = await saveDocument(page, editor, "invoice", invoice.id);
    expect(saved).toMatchObject({ notes: note, total_cents: 18900, status: "draft" });
    const edited = await documentEvidence("invoice", invoice.id);
    expect(lineFacts(edited)).toEqual(converted);
    expect(edited.document).toMatchObject({ notes: note, total_cents: 18900 });
    await editor.getByRole("button", { name: strings.common.close, exact: true }).click();

    await openDocument(page, client, "invoice", invoice.id);
    await page.getByRole("button", { name: strings.billing.sendInvoice, exact: true }).click();
    const sending = page.waitForResponse(
        (response) =>
            response.url().endsWith(`/invoices/${invoice.id}/send`) &&
            response.request().method() === "POST",
    );
    await page
        .getByRole("dialog")
        .filter({ has: page.getByRole("heading", { name: strings.previews.title, exact: true }) })
        .getByRole("button", { name: strings.billing.sendInvoice, exact: true })
        .click();
    const sent = await sending;
    expect(sent.status(), await sent.text()).toBe(200);
    const issued = (await sent.json()) as DocumentRecord & { balance_cents: number };
    expect(issued).toMatchObject({ status: "sent", total_cents: 18900, balance_cents: 18900 });
    expect(issued.number).toEqual(expect.any(Number));
    const final = await documentEvidence("invoice", invoice.id);
    expect(lineFacts(final)).toEqual(converted);
    expect(final.document).toMatchObject({ notes: note, status: "sent" });
    expect((await documentEvidence("estimate", estimate.id)).document).toMatchObject({
        status: "accepted",
        converted_invoice_id: invoice.id,
        total_cents: 18900,
    });
    const journal = await paymentEvidence(invoice.id);
    expect(new Set(journal.entries.map((entry) => entry.journal_id)).size).toBe(1);
    expect(totals(journal)).toEqual({ receivable: 18900, revenue: -18000, tax: -900 });
    expect(journal.payments).toEqual([]);

    const [payLink] = await mailedLinks(page.request, client.email, "/i/");
    const reader = await customerContext(browser);
    try {
        const customer = await reader.newPage();
        await customer.goto(payLink?.href ?? "");
        await expect(customer.getByText(note, { exact: true })).toBeVisible();
        for (const description of ["Full groom", "De-shedding treatment"])
            await expect(customer.getByText(description, { exact: true })).toBeVisible();
        await expect(customer.getByText(money(18900), { exact: true }).first()).toBeVisible();
    } finally {
        await reader.close();
    }
    await testInfo.attach("estimate-to-invoice", {
        body: JSON.stringify({ estimate: acceptedEstimate, invoice: final, journal }),
        contentType: "application/json",
    });
});

test("FLOW-02-B a converted invoice takes a part payment, a part refund and the rest, and every amount reconciles", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(240_000);
    await signIn(page);
    const client = await createDocumentClient(page);
    const estimate = await sendEstimate(page, client);
    const quote = await page.request.get(`${bookingApi()}/estimate/${estimate.view_token}`);
    expect(quote.status()).toBe(200);
    const addon = (
        (await quote.json()) as { lines: { id: string; optional: boolean }[] }
    ).lines.find((line) => line.optional);
    if (addon === undefined) throw new Error("The estimate has no optional line");
    const accepted = await page.request.post(
        `${bookingApi()}/estimate/${estimate.view_token}/accept`,
        { data: { line_ids: [addon.id], total_cents: 18900 } },
    );
    expect(accepted.status(), await accepted.text()).toBe(200);
    const invoice = await apiCall<DocumentRecord>(
        page,
        "POST",
        `/v1/estimates/${estimate.id}/convert`,
        {},
        201,
    );
    const issued = await apiCall<DocumentRecord & { balance_cents: number }>(
        page,
        "POST",
        `/v1/invoices/${invoice.id}/send`,
        {},
        200,
    );
    expect(issued).toMatchObject({ status: "sent", total_cents: 18900, balance_cents: 18900 });
    const number = issued.number;
    if (number === null) throw new Error("The issued invoice has no number");
    const [payLink] = await mailedLinks(page.request, client.email, "/i/");

    await openDocument(page, client, "invoice", invoice.id);
    const paying = page.waitForResponse(
        (response) =>
            response.url().endsWith(`/invoices/${invoice.id}/payments`) &&
            response.request().method() === "POST",
    );
    const partial = await recordPayment(page, "cash", money(10000), "100.00");
    const cash = await paying;
    expect(cash.status(), await cash.text()).toBe(201);
    expect(cash.request().postDataJSON()).toMatchObject({ method: "cash", amount_cents: 10000 });
    const payment = (await cash.json()) as { payment_id: string; balance_cents: number };
    expect(payment.balance_cents).toBe(8900);
    expect(partial).toMatch(sentence(strings.billing.rec.donePartial(HOLE, money(8900))));
    await expect(
        page
            .getByRole("dialog")
            .getByText(strings.billing.statusLabel.partial, { exact: true })
            .first(),
    ).toBeVisible();
    const paid = await refundEvidence(invoice.id);
    expect(paid.payments).toEqual([
        expect.objectContaining({ id: payment.payment_id, kind: "payment", amount_cents: 10000 }),
    ]);
    expect(totals(paid)).toEqual({ receivable: 8900, revenue: -18000, tax: -900, cash: 10000 });

    const reader = await customerContext(browser);
    try {
        const customer = await reader.newPage();
        await customer.goto(payLink?.href ?? "");
        const balance = customer
            .getByText(strings.publicPay.balanceDue, { exact: true })
            .locator("..");
        await expect(balance.getByText(money(8900), { exact: true }).first()).toBeVisible();

        const fixture = { client, invoiceId: invoice.id, number, paymentId: payment.payment_id };
        const s = strings.refunds;
        const panel = await openRefund(page, fixture);
        await panel.getByRole("button", { name: s.part, exact: true }).click();
        await panel.getByRole("textbox", { name: s.amount, exact: true }).fill("21.00");
        // $21 back is $20 of the groom and $1 of its GST
        for (const cents of [2000, 100])
            await expect(panel.getByText(money(cents), { exact: true }).first()).toBeVisible();
        await panel.getByRole("switch", { name: s.notify, exact: true }).uncheck();
        const refundLabel = s.refundButton(money(2100));
        await panel.getByRole("button", { name: refundLabel, exact: true }).click();
        const confirm = page.getByRole("dialog", {
            name: s.confirmTitle(money(2100)),
            exact: true,
        });
        await expect(confirm).toContainText(`CN-${String(number)}-1`);
        const refunding = page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === `/v1/payments/${payment.payment_id}/refund` &&
                response.request().method() === "POST",
        );
        await confirm.getByRole("button", { name: refundLabel, exact: true }).click();
        const refund = await refunding;
        expect(refund.status(), await refund.text()).toBe(200);
        expect(await refund.json()).toMatchObject({
            status: "succeeded",
            credit_note: `CN-${String(number)}-1`,
        });
        const credited = await refundEvidence(invoice.id);
        const back = credited.payments.find((row) => row.kind === "refund");
        expect(back).toMatchObject({
            parent_payment_id: payment.payment_id,
            amount_cents: 2100,
            method: "cash",
        });
        const legs = credited.entries.filter((entry) => entry.source_id === back?.id);
        expect(legs.reduce((sum, entry) => sum + entry.amount_cents, 0)).toBe(0);
        expect(legs.map((entry) => [entry.category, entry.code, entry.amount_cents])).toEqual(
            expect.arrayContaining([
                ["cash", "", -2100],
                ["revenue", "", 2000],
                ["tax", "GST", 100],
            ]),
        );
        expect(legs).toHaveLength(3);
        // the refund credits the sale, so the $89 still owed is unchanged
        expect(totals(credited)).toEqual({
            receivable: 8900,
            revenue: -16000,
            tax: -800,
            cash: 7900,
        });
        await customer.reload();
        await expect(balance.getByText(money(8900), { exact: true }).first()).toBeVisible();

        await openDocument(page, client, "invoice", invoice.id);
        const rest = page.waitForResponse(
            (response) =>
                response.url().endsWith(`/invoices/${invoice.id}/payments`) &&
                response.request().method() === "POST",
        );
        const settled = await recordPayment(page, "etransfer", money(8900));
        const transfer = await rest;
        expect(transfer.status(), await transfer.text()).toBe(201);
        expect(transfer.request().postDataJSON()).toMatchObject({
            method: "etransfer",
            amount_cents: 8900,
        });
        expect(settled).toMatch(sentence(strings.billing.rec.donePaid(HOLE)));
        await expect(
            page
                .getByRole("dialog")
                .getByText(strings.billing.statusLabel.paid, { exact: true })
                .first(),
        ).toBeVisible();
        const final = await refundEvidence(invoice.id);
        expect(final.payments.map((row) => [row.kind, row.method, row.amount_cents])).toEqual([
            ["payment", "cash", 10000],
            ["refund", "cash", 2100],
            ["payment", "etransfer", 8900],
        ]);
        // $189 billed, $100 and $89 collected, $21 handed back: $168 kept
        expect(totals(final)).toEqual({
            receivable: 0,
            revenue: -16000,
            tax: -800,
            cash: 7900,
            bank: 8900,
        });
        for (const journal of new Set(final.entries.map((entry) => entry.journal_id)))
            expect(
                final.entries
                    .filter((entry) => entry.journal_id === journal)
                    .reduce((sum, entry) => sum + entry.amount_cents, 0),
            ).toBe(0);
        await customer.reload();
        await expect(
            customer.getByRole("heading", { name: strings.publicPay.paidTitle, exact: true }),
        ).toBeVisible();
        const extra = await page.request.post(
            `${bookingApi()}/v1/invoices/${invoice.id}/payments`,
            {
                headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
                data: { method: "cash", amount_cents: 100, tendered_cents: 100 },
            },
        );
        expect(extra.status(), await extra.text()).toBe(409);
        expect(await refundEvidence(invoice.id)).toEqual(final);
        await testInfo.attach("collection-ledger", {
            body: JSON.stringify(final),
            contentType: "application/json",
        });
    } finally {
        await reader.close();
    }
});
