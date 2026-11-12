import { formatCredit, formatMoney, formatPhone, strings } from "@clientbridge/app-core/public";
import { expect, type Locator, type Page } from "@playwright/test";
import {
    billingAction,
    createInvoice,
    expectPaid,
    paymentDrawer,
    recordPayment,
    openInvoice,
    recordCash,
    applyAmountDiscount,
    applyPercentDiscount,
    composeDocument,
    convertEstimate,
    createDocumentClient,
    documentEvidence,
    documentTexts,
    expectDocumentTotal,
    fillDocumentLine,
    openDocument,
    registerForTax,
    saveDocument,
    sendDocument,
    sendEstimate,
    taxLegs,
    type DocumentClient,
    type DocumentRecord,
} from "./support/billing";
import { businessEvidence, newBusiness, patchBusiness, type NewBusiness } from "./support/business";
import {
    cancelOwnedBooking,
    chooseFreeBookingTime,
    createBookingFixture,
} from "./support/bookings";
import { select } from "./support/db";
import { textedLinks } from "./support/messaging";
import { payCash, ringCash, stockProduct } from "./support/pos";
import { apiCall } from "./support/visit";
import { paymentEvidence, receiptMessages } from "./support/evidence";
import { textsTo } from "./support/auth";
import { deliveredTexts } from "./support/messaging";
import { reports } from "./support/reports";
import { customerContext, navigate, signIn, test } from "./support/session";
import { randomUUID } from "node:crypto";
import { demoId, runUrl } from "@clientbridge/config/e2e/run";

test("BILL-PILOT-01 cash payment persists and reaches an independent replica", async ({
    page,
    browser,
}, testInfo) => {
    await signIn(page);
    const invoice = await createInvoice(page);
    await testInfo.attach("fixture", {
        body: JSON.stringify(invoice),
        contentType: "application/json",
    });
    const observer = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
        const other = await observer.newPage();
        await signIn(other);
        await openInvoice(page, invoice);
        await openInvoice(other, invoice);
        const paid = page.waitForResponse(
            (response) =>
                response.url().endsWith(`/invoices/${invoice.id}/payments`) &&
                response.request().method() === "POST",
        );
        await test.step("record cash through the UI", () => recordCash(page, "$10.00"));
        const response = await paid;
        expect(response.status()).toBe(201);
        expect(await response.json()).toMatchObject({ status: "succeeded", balance_cents: 0 });
        await test.step("observe payment on both replicas", async () => {
            await expectPaid(page);
            await expectPaid(other);
        });
        await test.step("reload and read the persisted payment", async () => {
            await other.reload();
            await openInvoice(other, invoice);
            await expectPaid(other);
        });
        await test.step("verify committed accounting and delivered receipt", async () => {
            const evidence = await paymentEvidence(invoice.id);
            await testInfo.attach("committed-evidence", {
                body: JSON.stringify(evidence),
                contentType: "application/json",
            });
            expect(evidence.deliveries).toEqual([{ id: expect.any(String), state: "accepted" }]);
            expect(evidence.payments).toEqual([
                {
                    id: expect.any(String),
                    amount_cents: 1000,
                    method: "cash",
                    provider: "manual",
                    status: "succeeded",
                },
            ]);
            const payment = evidence.entries.filter((entry) => entry.event === "payment");
            expect(
                payment
                    .map((entry) => ({ category: entry.category, cents: entry.amount_cents }))
                    .sort((a, b) => a.category.localeCompare(b.category)),
            ).toEqual([
                { category: "cash", cents: 1000 },
                { category: "receivable", cents: -1000 },
            ]);
            expect(new Set(payment.map((entry) => entry.journal_id)).size).toBe(1);
            expect(
                evidence.entries
                    .filter((entry) => entry.category === "receivable")
                    .reduce((sum, entry) => sum + entry.amount_cents, 0),
            ).toBe(0);
            await expect
                .poll(async () => (await receiptMessages(page.request, invoice.phone)).length)
                .toBe(1);
            expect((await receiptMessages(page.request, invoice.phone))[0]?.Snippet).toContain(
                "$10.00",
            );
        });
    } finally {
        await observer.close();
    }
});

test.describe(() => {
    // WebKit does not route requests from a page its service worker controls
    test.use({ serviceWorkers: "block" });

    test(
        "BILL-PILOT-02 retry after a lost response does not collect cash twice",
        { tag: "@browsers" },
        async ({ page }, testInfo) => {
            await signIn(page);
            const invoice = await createInvoice(page);
            await testInfo.attach("fixture", {
                body: JSON.stringify(invoice),
                contentType: "application/json",
            });
            await openInvoice(page, invoice);
            await page
                .getByRole("button", { name: strings.billing.recordPayment, exact: true })
                .click();
            await page
                .getByRole("button", { name: strings.billing.rec.partial, exact: true })
                .click();
            await page
                .getByRole("textbox", { name: strings.billing.rec.amount, exact: true })
                .fill("4.00");
            const keys: (string | undefined)[] = [];
            await page.route(`**/v1/invoices/${invoice.id}/payments`, async (route) => {
                keys.push(route.request().headers()["idempotency-key"]);
                const committed = await route.fetch();
                expect(committed.status()).toBe(201);
                if (keys.length === 1) await route.abort("connectionreset");
                else await route.fulfill({ response: committed });
            });
            const submit = page.getByRole("button", {
                name: strings.billing.rec.record("$4.00"),
                exact: true,
            });
            await submit.click();
            await expect(page.getByText(strings.billing.rec.error, { exact: true })).toBeVisible();
            const before = await paymentEvidence(invoice.id);
            expect(before.deliveries).toEqual([{ id: expect.any(String), state: "accepted" }]);
            expect(before.payments).toHaveLength(1);
            expect(before.payments[0]?.amount_cents).toBe(400);
            await submit.click();
            await expect(
                page.getByText(strings.billing.rec.doneTitle, { exact: true }),
            ).toBeVisible();
            expect(keys).toHaveLength(2);
            expect(keys[0]).toBeTruthy();
            expect(keys[1]).toBe(keys[0]);
            const after = await paymentEvidence(invoice.id);
            expect(after).toEqual(before);
            expect(
                after.entries
                    .filter((entry) => entry.category === "receivable")
                    .reduce((sum, entry) => sum + entry.amount_cents, 0),
            ).toBe(600);
            await expect
                .poll(async () => (await receiptMessages(page.request, invoice.phone)).length)
                .toBe(1);
            expect((await receiptMessages(page.request, invoice.phone))[0]?.Snippet).toContain(
                "$4.00",
            );
            await testInfo.attach("committed-evidence", {
                body: JSON.stringify(after),
                contentType: "application/json",
            });
            await page.getByRole("button", { name: strings.common.done, exact: true }).click();
            await page.reload();
            await openInvoice(page, invoice);
            await expect(
                page
                    .getByRole("dialog")
                    .getByText(strings.billing.statusLabel.partial, { exact: true })
                    .first(),
            ).toBeVisible();
        },
    );
});

test.describe(() => {
    test.use({ actionTimeout: 15_000 });

    test("BILL-DOC-01 compose, edit, issue and void exact mixed-tax discounted invoice", async ({
        page,
        browser,
    }, testInfo) => {
        await signIn(page);
        const client = await createDocumentClient(page);
        const editor = await composeDocument(page, client, "invoice");
        await fillDocumentLine(page, editor, 0, "Conditioning shampoo", "0", "50.00", "standard");
        const creations: string[] = [];
        page.on("request", (request) => {
            if (request.method() === "POST" && request.url().endsWith("/v1/invoices"))
                creations.push(request.url());
        });
        await editor.getByRole("button", { name: strings.billing.saveDraft, exact: true }).click();
        await expect(
            editor.getByText(strings.billing.lineIncomplete, { exact: true }),
        ).toBeVisible();
        expect(creations).toEqual([]);
        await editor.getByRole("textbox", { name: strings.billing.qty, exact: true }).fill("2");
        await editor
            .getByRole("button", { name: strings.billing.addDiscount, exact: true })
            .first()
            .click();
        await applyPercentDiscount(
            page.getByRole("region", {
                name: strings.billing.lineDiscount("Conditioning shampoo"),
                exact: true,
            }),
            "20",
        );
        await editor
            .getByRole("button", { name: strings.billing.addCustomLine, exact: true })
            .click();
        await fillDocumentLine(page, editor, 1, "Nail trim", "1", "20.00", "federal_only");
        await editor
            .getByRole("button", { name: strings.billing.addCustomLine, exact: true })
            .click();
        await fillDocumentLine(page, editor, 2, "Rescue care contribution", "1", "10.00", "exempt");
        await editor
            .getByRole("button", { name: strings.billing.discountTitle, exact: true })
            .last()
            .click();
        await applyPercentDiscount(
            page.getByRole("region", { name: strings.billing.discountTitle, exact: true }),
            "10",
        );
        await expectDocumentTotal(editor, 10854);
        const draft = await saveDocument(page, editor, "invoice");
        expect(draft).toMatchObject({
            status: "draft",
            number: null,
            subtotal_cents: 9900,
            tax_total_cents: 954,
            total_cents: 10854,
        });
        expect(creations).toHaveLength(1);
        await editor.getByRole("button", { name: strings.common.close, exact: true }).click();
        const observer = await browser.newContext({ baseURL: new URL(page.url()).origin });
        try {
            const other = await observer.newPage();
            await signIn(other);
            const observed = await openDocument(other, client, "invoice", draft.id);
            await expectDocumentTotal(observed, 10854);
            const detail = await openDocument(page, client, "invoice", draft.id);
            await detail.getByRole("button", { name: strings.billing.edit, exact: true }).click();
            const editing = page.getByRole("dialog").filter({
                has: page.getByRole("button", { name: strings.billing.saveDraft, exact: true }),
            });
            await expectDocumentTotal(editing, 10854);
            await editing
                .getByRole("textbox", { name: strings.billing.qty, exact: true })
                .nth(1)
                .fill("2");
            await editing.getByRole("button", { name: /off$/ }).last().click();
            await applyPercentDiscount(
                page.getByRole("region", { name: strings.billing.discountTitle, exact: true }),
                "20",
            );
            const updated = await saveDocument(page, editing, "invoice", draft.id);
            expect(updated).toMatchObject({
                subtotal_cents: 10400,
                tax_total_cents: 928,
                total_cents: 11328,
            });
            await editing.getByRole("button", { name: strings.common.close, exact: true }).click();
            await expectDocumentTotal(observed, 11328);
            await other.reload();
            await expectDocumentTotal(
                await openDocument(other, client, "invoice", draft.id),
                11328,
            );
            const saved = await documentEvidence("invoice", draft.id);
            expect(saved.siblings).toEqual([{ id: draft.id, status: "draft" }]);
            expect(saved.lines).toEqual([
                expect.objectContaining({
                    description: "Conditioning shampoo",
                    quantity: 2,
                    unit_amount_cents: 5000,
                    discount_cents: 2000,
                    sale_discount_cents: 1600,
                    amount_cents: 6400,
                    tax_amount_cents: 768,
                }),
                expect.objectContaining({
                    description: "Nail trim",
                    quantity: 2,
                    unit_amount_cents: 2000,
                    discount_cents: 0,
                    sale_discount_cents: 800,
                    amount_cents: 3200,
                    tax_amount_cents: 160,
                }),
                expect.objectContaining({
                    description: "Rescue care contribution",
                    quantity: 1,
                    unit_amount_cents: 1000,
                    discount_cents: 0,
                    sale_discount_cents: 200,
                    amount_cents: 800,
                    tax_amount_cents: 0,
                }),
            ]);
            await openDocument(page, client, "invoice", draft.id);
            await page
                .getByRole("button", { name: strings.billing.sendInvoice, exact: true })
                .click();
            const review = page.getByRole("dialog").filter({
                has: page.getByRole("heading", { name: strings.previews.title, exact: true }),
            });
            await expect(
                review.getByText(formatPhone(client.phone), { exact: false }).first(),
            ).toBeVisible();
            await review.getByRole("button", { name: strings.common.cancel, exact: true }).click();
            expect((await documentEvidence("invoice", draft.id)).document.status).toBe("draft");
            expect((await paymentEvidence(draft.id)).entries).toEqual([]);
            expect(await documentTexts(page, client)).toEqual([]);
            await page
                .getByRole("button", { name: strings.billing.sendInvoice, exact: true })
                .click();
            const sent = page.waitForResponse(
                (response) =>
                    response.url().endsWith(`/invoices/${draft.id}/send`) &&
                    response.request().method() === "POST",
            );
            await review
                .getByRole("button", { name: strings.billing.sendInvoice, exact: true })
                .click();
            const sentResponse = await sent;
            expect(sentResponse.status(), await sentResponse.text()).toBe(200);
            expect(await sentResponse.json()).toMatchObject({
                status: "sent",
                total_cents: 11328,
                balance_cents: 11328,
            });
            await expect(
                other.getByRole("button", { name: strings.billing.edit, exact: true }),
            ).toHaveCount(0);
            await expect.poll(async () => (await documentTexts(page, client)).length).toBe(1);
            const issued = await paymentEvidence(draft.id);
            expect(
                issued.entries
                    .map((entry) => ({ category: entry.category, cents: entry.amount_cents }))
                    .sort((a, b) => a.category.localeCompare(b.category) || a.cents - b.cents),
            ).toEqual([
                { category: "receivable", cents: 11328 },
                { category: "revenue", cents: -10400 },
                { category: "tax", cents: -480 },
                { category: "tax", cents: -448 },
            ]);
            expect(
                issued.entries
                    .filter((entry) => entry.category === "receivable")
                    .reduce((total, entry) => total + entry.amount_cents, 0),
            ).toBe(11328);
            expect(issued.entries.reduce((total, entry) => total + entry.amount_cents, 0)).toBe(0);
            expect(new Set(issued.entries.map((entry) => entry.journal_id)).size).toBe(1);
            await page.getByRole("button", { name: strings.billing.void, exact: true }).click();
            await page
                .getByRole("dialog")
                .last()
                .getByRole("button", { name: strings.common.cancel, exact: true })
                .click();
            expect(await paymentEvidence(draft.id)).toEqual(issued);
            expect((await documentEvidence("invoice", draft.id)).document.status).toBe("sent");
            await page.getByRole("button", { name: strings.billing.void, exact: true }).click();
            const voided = page.waitForResponse(
                (response) =>
                    response.url().endsWith(`/invoices/${draft.id}/void`) &&
                    response.request().method() === "POST",
            );
            await page
                .getByRole("dialog")
                .last()
                .getByRole("button", { name: strings.billing.void, exact: true })
                .click();
            expect((await voided).status()).toBe(200);
            await expect(
                other.getByText(strings.billing.statusLabel.void, { exact: true }).first(),
            ).toBeVisible();
            await other.reload();
            await openDocument(other, client, "invoice", draft.id);
            await expect(
                other.getByText(strings.billing.statusLabel.void, { exact: true }).first(),
            ).toBeVisible();
            const final = await documentEvidence("invoice", draft.id);
            expect(final.document).toMatchObject({ status: "void", total_cents: 11328 });
            const reversed = await paymentEvidence(draft.id);
            expect(
                reversed.entries
                    .filter((entry) => entry.category === "receivable")
                    .reduce((total, entry) => total + entry.amount_cents, 0),
            ).toBe(0);
            expect(reversed.entries.reduce((total, entry) => total + entry.amount_cents, 0)).toBe(
                0,
            );
            await testInfo.attach("document-and-journal", {
                body: JSON.stringify({ final, reversed }),
                contentType: "application/json",
            });
        } finally {
            await observer.close();
        }
    });

    test("BILL-DOC-02 UI estimate approval converts selected required work into one draft invoice", async ({
        page,
        browser,
    }, testInfo) => {
        await signIn(page);
        const client = await createDocumentClient(page);
        const editor = await composeDocument(page, client, "estimate");
        await fillDocumentLine(page, editor, 0, "Rescue grooming visit", "1", "100.00", "exempt");
        await editor
            .getByRole("button", { name: strings.billing.addCustomLine, exact: true })
            .click();
        await fillDocumentLine(page, editor, 1, "Rescue coat treatment", "1", "50.00", "exempt");
        await editor
            .getByRole("checkbox", { name: strings.billing.optional, exact: true })
            .nth(1)
            .check();
        await editor
            .getByRole("button", { name: strings.billing.discountTitle, exact: true })
            .last()
            .click();
        await applyPercentDiscount(
            page.getByRole("region", { name: strings.billing.discountTitle, exact: true }),
            "10",
        );
        await expectDocumentTotal(editor, 9000);
        const estimate = await saveDocument(page, editor, "estimate");
        expect(estimate).toMatchObject({
            status: "draft",
            subtotal_cents: 9000,
            tax_total_cents: 0,
            total_cents: 9000,
        });
        await editor.getByRole("button", { name: strings.common.close, exact: true }).click();
        await openDocument(page, client, "estimate", estimate.id);
        await page.getByRole("button", { name: strings.billing.sendEstimate, exact: true }).click();
        const send = page.waitForResponse(
            (response) =>
                response.url().endsWith(`/estimates/${estimate.id}/send`) &&
                response.request().method() === "POST",
        );
        await page
            .getByRole("dialog")
            .last()
            .getByRole("button", { name: strings.billing.sendEstimate, exact: true })
            .click();
        expect((await send).status()).toBe(200);
        await page.getByRole("button", { name: strings.billing.markAccepted, exact: true }).click();
        const accept = page.waitForResponse(
            (response) =>
                response.url().endsWith(`/estimates/${estimate.id}/accept`) &&
                response.request().method() === "POST",
        );
        await page
            .getByRole("dialog")
            .last()
            .getByRole("button", { name: strings.billing.review.accept, exact: true })
            .click();
        expect((await accept).status()).toBe(200);
        await page.getByRole("button", { name: strings.billing.convert, exact: true }).click();
        await page
            .getByRole("dialog")
            .last()
            .getByRole("button", { name: strings.common.cancel, exact: true })
            .click();
        expect(
            (await documentEvidence("estimate", estimate.id)).document.converted_invoice_id,
        ).toBeNull();
        await page.getByRole("button", { name: strings.billing.convert, exact: true }).click();
        const convert = page.waitForResponse(
            (response) =>
                response.url().endsWith(`/estimates/${estimate.id}/convert`) &&
                response.request().method() === "POST",
        );
        await page
            .getByRole("dialog")
            .last()
            .getByRole("button", { name: strings.billing.convert, exact: true })
            .click();
        const convertedResponse = await convert;
        expect(convertedResponse.status(), await convertedResponse.text()).toBe(201);
        const invoice = (await convertedResponse.json()) as DocumentRecord;
        expect(invoice).toMatchObject({
            status: "draft",
            total_cents: 9000,
            tax_total_cents: 0,
            client_id: client.id,
        });
        const evidence = await documentEvidence("invoice", invoice.id);
        expect(evidence.siblings).toEqual([{ id: invoice.id, status: "draft" }]);
        expect(evidence.lines).toEqual([
            expect.objectContaining({
                description: "Rescue grooming visit",
                amount_cents: 9000,
                sale_discount_cents: 1000,
                tax_amount_cents: 0,
            }),
        ]);
        expect((await documentEvidence("estimate", estimate.id)).document).toMatchObject({
            status: "accepted",
            converted_invoice_id: invoice.id,
        });
        expect((await paymentEvidence(invoice.id)).entries).toEqual([]);
        const observer = await browser.newContext({ baseURL: new URL(page.url()).origin });
        try {
            const other = await observer.newPage();
            await signIn(other);
            const record = await openDocument(other, client, "invoice", invoice.id);
            await expectDocumentTotal(record, 9000);
            await expect(
                record.getByRole("cell", { name: "Rescue grooming visit", exact: true }),
            ).toBeVisible();
            await expect(record.getByText("Rescue coat treatment", { exact: true })).toHaveCount(0);
            await other.reload();
            await expectDocumentTotal(
                await openDocument(other, client, "invoice", invoice.id),
                9000,
            );
            await testInfo.attach("converted-document", {
                body: JSON.stringify(evidence),
                contentType: "application/json",
            });
        } finally {
            await observer.close();
        }
    });

    test("BILL-DOC-03 editing a visit's draft invoice keeps its visit, staff and deposit", async ({
        page,
    }) => {
        // a seeded upcoming large-dog groom (25% of $110 held as a deposit) no other case touches
        const visit = demoId("bk_rex_2");
        const deposit = 2750;
        await signIn(page);
        const api = runUrl("VITE_API_URL");
        const headers = { Origin: new URL(page.url()).origin };
        const addon = await page.request.post(`${api}/v1/bookings/${visit}/addons`, {
            headers,
            data: { item_id: demoId("it_brush"), quantity: 1 },
        });
        expect(addon.status(), await addon.text()).toBe(201);
        const created = await page.request.post(`${api}/v1/invoices/from-booking/${visit}`, {
            headers: { ...headers, "Idempotency-Key": randomUUID() },
        });
        expect(created.status(), await created.text()).toBe(201);
        const draft = (await created.json()) as DocumentRecord & {
            lines: { booking_id: string | null; staff_id: string | null }[];
        };
        const refs = draft.lines.map((l) => [l.booking_id, l.staff_id]);
        expect(refs).toEqual([
            [visit, null],
            [visit, demoId("st_diego")],
        ]);
        const client = {
            id: demoId("cl_marcus"),
            name: "Marcus Bennett",
            phone: "+12505550181",
        };
        expect(draft.client_id).toBe(client.id);

        const detail = await openDocument(page, client, "invoice", draft.id);
        await detail.getByRole("button", { name: strings.billing.edit, exact: true }).click();
        const editing = page.getByRole("dialog").filter({
            has: page.getByRole("button", { name: strings.billing.saveDraft, exact: true }),
        });
        await editing
            .getByRole("textbox", { name: strings.billing.messageToClient })
            .fill("Thanks for bringing Rex in. His next groom is due in six weeks.");
        const saved = await saveDocument(page, editing, "invoice", draft.id);
        expect(saved).toMatchObject({
            notes: "Thanks for bringing Rex in. His next groom is due in six weeks.",
            total_cents: draft.total_cents,
        });
        const edited = await documentEvidence("invoice", draft.id);
        expect(edited.lines.map((l) => [l.booking_id, l.staff_id])).toEqual(refs);
        await editing.getByRole("button", { name: strings.common.close, exact: true }).click();

        await openDocument(page, client, "invoice", draft.id);
        await page.getByRole("button", { name: strings.billing.sendInvoice, exact: true }).click();
        const sent = page.waitForResponse(
            (response) =>
                response.url().endsWith(`/invoices/${draft.id}/send`) &&
                response.request().method() === "POST",
        );
        await page
            .getByRole("dialog")
            .filter({
                has: page.getByRole("heading", { name: strings.previews.title, exact: true }),
            })
            .getByRole("button", { name: strings.billing.sendInvoice, exact: true })
            .click();
        const sentResponse = await sent;
        expect(sentResponse.status(), await sentResponse.text()).toBe(200);
        expect(await sentResponse.json()).toMatchObject({
            status: "partial",
            total_cents: draft.total_cents,
            balance_cents: draft.total_cents - deposit,
        });
        const issued = await documentEvidence("invoice", draft.id);
        expect(issued.lines.map((l) => [l.booking_id, l.staff_id])).toEqual(refs);
        expect(issued.bookings).toEqual([
            { id: visit, status: "confirmed", deposit_status: "applied", invoice_id: draft.id },
        ]);
        const journal = await paymentEvidence(draft.id);
        expect(
            journal.entries
                .filter((entry) => entry.event === "application")
                .map((entry) => [entry.category, entry.amount_cents]),
        ).toEqual([["receivable", -deposit]]);
    });

    test("BILL-DOC-22 a declined estimate can't be converted, and a client answering after conversion is refused", async ({
        page,
        browser,
    }, testInfo) => {
        const pe = strings.publicEstimate;
        const money = (cents: number): string => formatMoney(cents, "CAD");
        await signIn(page);
        const line = {
            description: "Spring de-shedding package",
            quantity: 1,
            unit_amount_cents: 8000,
        };
        const decliner = await createDocumentClient(page);
        const late = await createDocumentClient(page);
        const send = (client: DocumentClient) =>
            apiCall<DocumentRecord>(
                page,
                "POST",
                "/v1/estimates",
                { client_id: client.id, lines: [line], send: true },
                201,
            );
        const declined = await send(decliner);
        const unanswered = await send(late);
        const [declineLink] = await textedLinks(page.request, decliner.phone, "/e/");
        const [lateLink] = await textedLinks(page.request, late.phone, "/e/");
        const context = await customerContext(browser);
        try {
            const customer = await context.newPage();
            await customer.goto(declineLink?.href ?? "");
            await customer.getByRole("button", { name: pe.decline, exact: true }).click();
            await customer
                .getByRole("textbox", { name: pe.declineReason, exact: true })
                .fill("We'll wait until spring");
            await customer.getByRole("button", { name: pe.sendDecline, exact: true }).click();
            await expect(customer.getByRole("heading", { name: pe.declinedTitle })).toBeVisible();

            const record = await openDocument(page, decliner, "estimate", declined.id);
            await expect(record.getByText("We'll wait until spring").first()).toBeVisible();
            await expect(
                record.getByRole("button", { name: strings.billing.convert, exact: true }),
            ).toHaveCount(0);
            // the client may still phone to say yes, so staff can change the answer
            await expect(
                record.getByRole("button", { name: strings.billing.markAccepted, exact: true }),
            ).toBeVisible();
            await apiCall(page, "POST", `/v1/estimates/${declined.id}/convert`, {}, 409);

            // the client opened the link before the business converted the estimate
            const stale = await context.newPage();
            await stale.goto(lateLink?.href ?? "");
            const accept = stale.getByRole("button", { name: pe.acceptFor(money(8960)) });
            await expect(accept).toBeVisible();
            await openDocument(page, late, "estimate", unanswered.id);
            const invoice = await convertEstimate(page, unanswered.id);
            await accept.click();
            await expect(stale.getByRole("heading", { name: pe.convertedTitle })).toBeVisible();
            await expect(stale.getByText(strings.api.estimateAnswered)).toHaveCount(0);
            await expect(stale.getByRole("button", { name: pe.decline })).toHaveCount(0);
            await expect(
                stale.getByRole("button", { name: new RegExp(`^${pe.acceptFor("")}`) }),
            ).toHaveCount(0);

            expect((await documentEvidence("estimate", declined.id)).document).toMatchObject({
                status: "declined",
                converted_invoice_id: null,
            });
            const answered = await documentEvidence("estimate", unanswered.id);
            expect(answered.document).toMatchObject({
                status: "sent",
                converted_invoice_id: invoice.id,
                decline_reason: null,
            });
            expect((await documentEvidence("invoice", invoice.id)).document).toMatchObject({
                status: "draft",
                total_cents: 8960,
            });
            expect(
                await select<{
                    id: string;
                }>`SELECT id FROM invoices WHERE client_id = ${decliner.id}`,
            ).toEqual([]);
            await testInfo.attach("answers", {
                body: JSON.stringify({ declined, answered }),
                contentType: "application/json",
            });
        } finally {
            await context.close();
        }
    });

    test("BILL-DOC-25 an estimate with mixed tax classes and capped fixed discounts totals to the hand calculation, and its invoice keeps those totals", async ({
        page,
        browser,
    }, testInfo) => {
        const money = (cents: number): string => formatMoney(cents, "CAD");
        await signIn(page);
        const client = await createDocumentClient(page);
        const editor = await composeDocument(page, client, "estimate");
        await fillDocumentLine(page, editor, 0, "Camera install labour", "2", "65.00", "standard");
        await editor
            .getByRole("button", { name: strings.billing.addCustomLine, exact: true })
            .click();
        await fillDocumentLine(page, editor, 1, "Monitoring setup", "1", "50.00", "federal_only");
        await editor
            .getByRole("button", { name: strings.billing.addCustomLine, exact: true })
            .click();
        await fillDocumentLine(page, editor, 2, "Insurance paperwork", "1", "25.00", "exempt");
        await editor
            .getByRole("button", { name: strings.billing.addDiscount, exact: true })
            .nth(2)
            .click();
        // the line can't lose more than its $25, so $40 is refused and the whole $25 goes
        const lineDiscount = page.getByRole("region", {
            name: strings.billing.lineDiscount("Insurance paperwork"),
            exact: true,
        });
        await applyAmountDiscount(lineDiscount, "40.00", "Paperwork on the house");
        await expect(
            lineDiscount.getByText(strings.pos.desk.discountTooBig(money(2500)), { exact: true }),
        ).toBeVisible();
        await lineDiscount
            .getByRole("textbox", { name: strings.pos.desk.amountOff, exact: true })
            .fill("25.00");
        await lineDiscount
            .getByRole("button", { name: strings.pos.desk.applyDiscount, exact: true })
            .click();
        await editor
            .getByRole("button", { name: strings.billing.discountTitle, exact: true })
            .last()
            .click();
        await applyAmountDiscount(
            page.getByRole("region", { name: strings.billing.discountTitle, exact: true }),
            "30.00",
            "Matched a competitor's quote",
        );
        // $30 shared by value: labour $108.33 + GST $5.42 + PST $7.58, setup $41.67 + GST $2.08
        await expectDocumentTotal(editor, 16508);
        const draft = await saveDocument(page, editor, "estimate");
        expect(draft).toMatchObject({
            subtotal_cents: 15000,
            tax_total_cents: 1508,
            total_cents: 16508,
        });
        const figures = (evidence: {
            lines: {
                amount_cents: number;
                discount_cents: number;
                sale_discount_cents: number;
                tax_amount_cents: number;
            }[];
        }) =>
            evidence.lines.map((l) => [
                l.amount_cents,
                l.discount_cents,
                l.sale_discount_cents,
                l.tax_amount_cents,
            ]);
        const expected = [
            [10833, 0, 2167, 1300],
            [4167, 0, 833, 208],
            [0, 2500, 0, 0],
        ];
        expect(figures(await documentEvidence("estimate", draft.id))).toEqual(expected);
        await editor.getByRole("button", { name: strings.common.close, exact: true }).click();

        const record = await openDocument(page, client, "estimate", draft.id);
        const pane = record.getByRole("article");
        await expect(pane.getByText(strings.billing.lineDiscounts, { exact: true })).toBeVisible();
        await expect(pane.getByText(formatCredit(2500, "CAD"), { exact: true })).toBeVisible();
        await expect(pane.getByText("Matched a competitor's quote")).toBeVisible();
        await expect(pane.getByText(money(20500), { exact: true })).toBeVisible();
        // the lines read at their price, so they add up to the items before each discount
        await expect(
            pane.getByRole("row").filter({ hasText: "Camera install labour" }),
        ).toContainText(money(13000));
        const sent = await sendEstimate(page, draft.id);
        expect(sent.total_cents).toBe(16508);

        const context = await customerContext(browser);
        try {
            const customer = await context.newPage();
            const [link] = await textedLinks(page.request, client.phone, "/e/");
            await customer.goto(link?.href ?? "");
            const accept = customer.getByRole("button", {
                name: strings.publicEstimate.acceptFor(money(16508)),
                exact: true,
            });
            await expect(accept).toBeVisible();
            await accept.click();
            await expect(
                customer.getByRole("heading", { name: strings.publicEstimate.acceptedTitle }),
            ).toBeVisible();
        } finally {
            await context.close();
        }
        expect((await documentEvidence("estimate", draft.id)).document).toMatchObject({
            status: "accepted",
            subtotal_cents: 15000,
            tax_total_cents: 1508,
            total_cents: 16508,
        });

        await openDocument(page, client, "estimate", draft.id);
        const invoice = await convertEstimate(page, draft.id);
        expect(invoice).toMatchObject({
            status: "draft",
            subtotal_cents: 15000,
            tax_total_cents: 1508,
            total_cents: 16508,
        });
        const converted = await documentEvidence("invoice", invoice.id);
        expect(figures(converted)).toEqual(expected);
        const invoiceRecord = await openDocument(page, client, "invoice", invoice.id);
        await expectDocumentTotal(invoiceRecord, 16508);
        await expect(
            invoiceRecord.getByRole("article").getByText("Matched a competitor's quote"),
        ).toBeVisible();
        await testInfo.attach("estimate-and-invoice", {
            body: JSON.stringify({ draft, invoice, lines: converted.lines }),
            contentType: "application/json",
        });
    });

    test("BILL-DOC-26 the job is booked from an accepted estimate once, with its service and products", async ({
        page,
    }, testInfo) => {
        await signIn(page);
        const fixture = await createBookingFixture(page);
        const product = await stockProduct(page, {
            name: `Paw balm for ${fixture.clientName}`,
            prefix: "BALM",
            priceCents: 1800,
            taxClass: "standard",
            stock: 6,
        });
        const estimate = await apiCall<DocumentRecord>(
            page,
            "POST",
            "/v1/estimates",
            {
                client_id: fixture.clientId,
                lines: [
                    {
                        description: fixture.itemName,
                        quantity: 1,
                        unit_amount_cents: 1000,
                        item_id: fixture.itemId,
                    },
                    {
                        description: product.name,
                        quantity: 2,
                        unit_amount_cents: 1800,
                        item_id: product.id,
                    },
                ],
                send: true,
            },
            201,
        );
        await apiCall(page, "POST", `/v1/estimates/${estimate.id}/accept`, {}, 200);
        const client = {
            id: fixture.clientId,
            name: fixture.clientName,
            phone: fixture.clientPhone,
        };
        const record = await openDocument(page, client, "estimate", estimate.id);
        const book = record.getByRole("button", {
            name: strings.billing.bookVisit("pet"),
            exact: true,
        });
        await book.click();
        const form = page.getByRole("form", { name: strings.bookings.composerTitle });
        await expect(
            form.getByRole("combobox", { name: strings.bookings.composerService }),
        ).toHaveValue(fixture.itemName);
        await expect(
            form.getByText(strings.bookings.composerFromEstimate(estimate.number ?? 0)),
        ).toBeVisible();
        await expect(form.getByText(`2 × ${product.name}`)).toBeVisible();
        const staff = form.getByRole("group", { name: strings.bookings.composerWith, exact: true });
        const first = fixture.staffName.split(" ")[0] ?? fixture.staffName;
        await staff
            .getByRole("button", { name: first, exact: true })
            .or(
                staff.getByRole("button", {
                    name: `${first} ${strings.bookings.busy}`,
                    exact: true,
                }),
            )
            .click();
        await form.getByRole("switch", { name: strings.bookings.composerConfirm }).uncheck();
        await chooseFreeBookingTime(page, fixture);
        const created = page.waitForResponse(
            (r) => new URL(r.url()).pathname === "/v1/bookings" && r.request().method() === "POST",
        );
        await page
            .getByRole("button", { name: strings.bookings.composerBook, exact: true })
            .click();
        const response = await created;
        expect(response.status(), await response.text()).toBe(201);
        const booking = (await response.json()) as {
            id: string;
            estimate_id: string;
            starts_at: string;
        };
        expect(booking.estimate_id).toBe(estimate.id);
        expect(
            await select<{ item_id: string; quantity: number; unit_amount_cents: number }>`
                SELECT item_id, quantity::float AS quantity, unit_amount_cents FROM addons
                WHERE booking_id = ${booking.id}`,
        ).toEqual([{ item_id: product.id, quantity: 2, unit_amount_cents: 1800 }]);

        const booked = await openDocument(page, client, "estimate", estimate.id);
        await expect(booked.getByText(strings.billing.convertOnVisit, { exact: true })).toBeVisible(
            {
                timeout: 30_000,
            },
        );
        await expect(
            booked.getByRole("button", { name: strings.billing.bookVisit("pet"), exact: true }),
        ).toHaveCount(0);
        await expect(
            booked.getByRole("button", { name: strings.billing.convert, exact: true }),
        ).toHaveCount(0);
        const again = await page.request.post(`${runUrl("VITE_API_URL")}/v1/bookings`, {
            headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
            data: {
                client_id: fixture.clientId,
                item_id: fixture.itemId,
                staff_id: fixture.staffId,
                starts_at: new Date(Date.parse(booking.starts_at) + 86_400_000).toISOString(),
                estimate_id: estimate.id,
                notify: false,
            },
        });
        expect(again.status()).toBe(409);
        expect(((await again.json()) as { error: string }).error).toBe("estimate_booked");

        // a canceled visit frees the estimate to be booked again
        await cancelOwnedBooking(page, booking.id);
        await expect(
            booked.getByRole("button", { name: strings.billing.bookVisit("pet"), exact: true }),
        ).toBeVisible({ timeout: 30_000 });
        await testInfo.attach("booking", {
            body: JSON.stringify({ estimate, booking }),
            contentType: "application/json",
        });
    });
});

test("BILL-DOC-21 golden tax matrix for ON, BC, QC and NS with exempt and GST-only lines, plus tax off", async ({
    baseURL,
    browser,
    page,
    request,
}) => {
    test.setTimeout(420_000);
    const o = strings.business.onboarding;
    const matrix = [
        {
            province: o.provinceON,
            federal: "HST" as const,
            lineTax: [1300, 433, 0],
            taxes: { "HST 13%": "$17.33" },
            legs: { HST: 1733 },
            total: "$190.66",
            totalCents: 19066,
        },
        {
            province: o.provinceQC,
            federal: "GST" as const,
            lineTax: [1498, 167, 0],
            taxes: { "GST 5%": "$6.67", "QST 9.975%": "$9.98" },
            legs: { GST: 667, QST: 998 },
            total: "$189.98",
            totalCents: 18998,
        },
        {
            province: o.provinceNS,
            federal: "HST" as const,
            lineTax: [1400, 467, 0],
            taxes: { "HST 14%": "$18.67" },
            legs: { HST: 1867 },
            total: "$192.00",
            totalCents: 19200,
        },
        {
            province: o.provinceBC,
            federal: "GST" as const,
            lineTax: [1200, 167, 0],
            taxes: { "GST 5%": "$6.67", "PST 7%": "$7.00" },
            legs: { GST: 667, PST: 700 },
            total: "$187.00",
            totalCents: 18700,
        },
    ];
    const visible = (scope: Locator, text: string): Locator =>
        scope.getByText(text, { exact: true }).locator("visible=true").first();
    const issue = async (
        tab: Page,
        row: (typeof matrix)[number],
    ): Promise<{ id: string; client: DocumentClient; token: string }> => {
        const client = await createDocumentClient(tab);
        const editor = await composeDocument(tab, client, "invoice");
        await fillDocumentLine(tab, editor, 0, "Standard service", "1", "100.00", "standard");
        await fillDocumentLine(
            tab,
            editor,
            1,
            "Federal only service",
            "1",
            "33.33",
            "federal_only",
            row.federal,
        );
        await fillDocumentLine(tab, editor, 2, "Exempt fee", "1", "40.00", "exempt");
        const draft = await saveDocument(tab, editor, "invoice");
        await editor.getByRole("button", { name: strings.common.close, exact: true }).click();
        const dialog = await openDocument(tab, client, "invoice", draft.id);
        const sent = await sendDocument(tab, draft.id);
        expect(sent).toMatchObject({ subtotal_cents: 17333, total_cents: row.totalCents });
        for (const [label, amount] of Object.entries(row.taxes)) {
            await expect(visible(dialog, label)).toBeVisible();
            await expect(visible(dialog, amount)).toBeVisible();
        }
        const saved = await documentEvidence("invoice", draft.id);
        expect(saved.lines.map((line) => line.tax_amount_cents)).toEqual(row.lineTax);
        expect(await taxLegs(draft.id)).toEqual(row.legs);
        return { id: draft.id, client, token: sent.pay_token };
    };

    let last: Awaited<ReturnType<typeof issue>> | null = null;
    let opened: NewBusiness | null = null;
    for (const row of matrix) {
        const context =
            row.province === o.provinceBC
                ? null
                : await browser.newContext(baseURL === undefined ? {} : { baseURL });
        const tab = context === null ? page : await context.newPage();
        opened = await newBusiness(tab, request, "tax-matrix", "beauty", row.province);
        await registerForTax(tab, "123456789RT0001");
        last = await issue(tab, row);
        const payPage = await request.get(`${runUrl("VITE_API_URL")}/pay/${last.token}`);
        const taxes = ((await payPage.json()) as { taxes: { code: string; cents: number }[] })
            .taxes;
        expect(Object.fromEntries(taxes.map((tax) => [tax.code, tax.cents]))).toEqual(row.legs);
        await context?.close();
    }
    if (last === null || opened === null) throw new Error("the matrix issued nothing");
    const issued = last;
    const business = opened;
    const bc = matrix[3];
    if (bc === undefined) throw new Error("the matrix has no BC row");

    const api = runUrl("VITE_API_URL");
    const chargesTax = async (): Promise<boolean[]> =>
        Promise.all(
            ["shop", "services"].map(async (path) => {
                const response = await request.get(`${api}/book/${business.slug}/${path}`);
                return ((await response.json()) as { charges_tax: boolean }).charges_tax;
            }),
        );
    expect(await chargesTax()).toEqual([true, true]);

    const client = await createDocumentClient(page);
    const quoted = await page.request.post(`${api}/v1/estimates`, {
        headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
        data: {
            client_id: client.id,
            send: true,
            lines: [{ description: "Quoted groom", unit_amount_cents: 10000 }],
        },
    });
    expect(quoted.status(), await quoted.text()).toBe(201);
    const estimate = (await quoted.json()) as { id: string; total_cents: number };
    expect(estimate.total_cents).toBe(11200);
    const ticket = await page.request.post(`${api}/v1/orders`, {
        headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
        data: { lines: [{ description: "Held groom", unit_amount_cents: 10000 }] },
    });
    expect(ticket.status(), await ticket.text()).toBe(201);
    const held = (await ticket.json()) as { id: string; total_cents: number };
    expect(held.total_cents).toBe(11200);
    const editor = await composeDocument(page, client, "invoice");
    await fillDocumentLine(page, editor, 0, "Waiting draft", "1", "100.00", "standard");
    const waiting = await saveDocument(page, editor, "invoice");
    expect(waiting).toMatchObject({ tax_total_cents: 1200, total_cents: 11200 });
    await editor.getByRole("button", { name: strings.common.close, exact: true }).click();

    await navigate(page, "/setup/taxes");
    await page.getByText(strings.taxes.regSmall("$30,000"), { exact: true }).click();
    await page.getByRole("button", { name: strings.taxes.save, exact: true }).click();
    await expect(page.getByText(strings.taxes.saved, { exact: true })).toBeVisible();
    await expect(page.getByText(strings.taxes.offNotice, { exact: true })).toBeVisible();

    const kept = await openDocument(page, issued.client, "invoice", issued.id);
    for (const [label, amount] of Object.entries(bc.taxes)) {
        await expect(visible(kept, label)).toBeVisible();
        await expect(visible(kept, amount)).toBeVisible();
    }
    await expect(visible(kept, bc.total)).toBeVisible();
    expect((await documentEvidence("invoice", issued.id)).document).toMatchObject({
        total_cents: bc.totalCents,
    });
    expect(await taxLegs(issued.id)).toEqual(bc.legs);
    const province = await patchBusiness(page, { province: "ON" });
    expect(province.status()).toBe(409);
    expect((await businessEvidence(business.id)).business[0]?.province).toBe("BC");
    await kept.getByRole("button", { name: strings.common.close, exact: true }).click();

    const heldPaid = await page.request.post(`${api}/v1/orders/${held.id}/cash`, {
        headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
        data: { tendered_cents: 10000 },
    });
    expect(heldPaid.status(), await heldPaid.text()).toBe(200);
    expect(await heldPaid.json()).toMatchObject({ amount_cents: 10000 });

    const quote = await openDocument(page, client, "estimate", estimate.id);
    await expect(visible(quote, "$100.00")).toBeVisible();
    await expect(quote.getByText("$112.00", { exact: true })).toHaveCount(0);
    expect((await documentEvidence("estimate", estimate.id)).document).toMatchObject({
        total_cents: 10000,
    });
    await quote.getByRole("button", { name: strings.common.close, exact: true }).click();

    const repriced = await openDocument(page, client, "invoice", waiting.id);
    await expect(visible(repriced, "$100.00")).toBeVisible();
    await expect(repriced.getByText("$112.00", { exact: true })).toHaveCount(0);
    await expect(repriced.getByText("GST 5%", { exact: true })).toHaveCount(0);
    expect(await sendDocument(page, waiting.id)).toMatchObject({
        tax_total_cents: 0,
        total_cents: 10000,
    });
    await expect.poll(() => taxLegs(waiting.id)).toEqual({});
    await repriced.getByRole("button", { name: strings.common.close, exact: true }).click();

    const fresh = await composeDocument(page, client, "invoice");
    await fillDocumentLine(page, fresh, 0, "Untaxed groom", "1", "100.00", "standard");
    expect(await saveDocument(page, fresh, "invoice")).toMatchObject({
        tax_total_cents: 0,
        total_cents: 10000,
    });
    await fresh.getByRole("button", { name: strings.common.close, exact: true }).click();

    const product = await stockProduct(page, {
        name: "Untaxed Shampoo",
        prefix: "TAX-OFF",
        priceCents: 2000,
        taxClass: "standard",
        stock: 5,
    });
    const payment = await ringCash(page, {
        product,
        stock: 5,
        taps: 1,
        client,
        charge: "$20.00",
        given: "20.00",
    });
    expect((await payCash(page, payment, "$20.00")).amount_cents).toBe(2000);

    expect(await chargesTax()).toEqual([false, false]);
});

async function voidInvoice(page: Page, invoiceId: string): Promise<number> {
    await page.getByRole("button", { name: strings.billing.void, exact: true }).click();
    const voided = page.waitForResponse(
        (response) =>
            response.url().endsWith(`/invoices/${invoiceId}/void`) &&
            response.request().method() === "POST",
    );
    await page
        .getByRole("dialog")
        .last()
        .getByRole("button", { name: strings.billing.void, exact: true })
        .click();
    return (await voided).status();
}

async function issueInvoice(page: Page, clientId: string, cents: number, dueAt?: string) {
    const response = await page.request.post(`${runUrl("VITE_API_URL")}/v1/invoices`, {
        headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
        data: {
            client_id: clientId,
            send: true,
            ...(dueAt === undefined ? {} : { due_at: dueAt }),
            lines: [
                {
                    description: "Coat care",
                    quantity: 1,
                    unit_amount_cents: cents,
                    tax_class: "exempt",
                },
            ],
        },
    });
    expect(response.status(), await response.text()).toBe(201);
    return (await response.json()) as { id: string; number: number };
}

test("BILL-DOC-23 an overdue invoice reaches Today once the overdue sweep runs, which texts its reminder once, and isn't voided while a card payment goes through", async ({
    page,
}) => {
    await signIn(page);
    const client = await createDocumentClient(page);
    const invoice = await issueInvoice(
        page,
        client.id,
        4400,
        new Date(Date.now() - 2 * 86_400_000).toISOString(),
    );
    await expect
        .poll(async () => (await textsTo(page.request, client.phone)).length, { timeout: 90_000 })
        .toBe(1);
    const overdue = page.getByText(strings.today.attention.overdueTitle(invoice.number), {
        exact: true,
    });

    await test.step("past due, it waits for the sweep before Today calls it overdue", async () => {
        // the drawer opens once the replica has the invoice
        await openDocument(page, client, "invoice", invoice.id);
        await navigate(page, "/today");
        await expect(page.getByText(strings.today.collected, { exact: true })).toBeVisible();
        await expect(overdue).toHaveCount(0);
        // the books agree: past due is not overdue until the sweep has told the client
        expect((await documentEvidence("invoice", invoice.id)).document).toMatchObject({
            overdue_notified_at: null,
        });
    });

    await test.step("the sweep texts the reminder the owner previews, and only once", async () => {
        const preview = await page.request.get(
            `${runUrl("VITE_API_URL")}/v1/previews/invoices/${invoice.id}/remind`,
        );
        expect(preview.status(), await preview.text()).toBe(200);
        const reminder = ((await preview.json()) as { text: { body: string } }).text.body;
        expect(await billingAction("overdue-sweep", invoice.id)).toEqual({ swept: 1 });
        await expect(overdue).toBeVisible({ timeout: 60_000 });
        expect(await billingAction("overdue-sweep", invoice.id)).toEqual({ swept: 0 });
        const texts = await deliveredTexts(page.request, client.phone);
        expect(texts.map((text) => text.text)).toEqual([
            expect.stringMatching(new RegExp(`^Invoice #${String(invoice.number)} for `)),
            reminder,
        ]);
    });

    await test.step("a card payment going through blocks the void until it closes", async () => {
        await billingAction("card-open", invoice.id);
        await openDocument(page, client, "invoice", invoice.id);
        expect(await voidInvoice(page, invoice.id)).toBe(409);
        await expect(page.getByText(strings.api.paymentInProgress, { exact: true })).toBeVisible();
        expect((await documentEvidence("invoice", invoice.id)).document.status).toBe("sent");
        await billingAction("card-close", invoice.id);
        await openDocument(page, client, "invoice", invoice.id);
        expect(await voidInvoice(page, invoice.id)).toBe(200);
        expect((await documentEvidence("invoice", invoice.id)).document.status).toBe("void");
    });
});

test("BILL-DOC-24 an e-Transfer and a cheque are recorded once each, named on the receipt and counted once on Today and in the income report", async ({
    page,
    browser,
}) => {
    await signIn(page);
    const client = await createDocumentClient(page);
    const transfer = await issueInvoice(page, client.id, 4000);
    const cheque = await issueInvoice(page, client.id, 6000);
    const phone = formatPhone(client.phone);
    const r = strings.billing.rec;

    await test.step("an e-Transfer pays the first in full", async () => {
        await openDocument(page, client, "invoice", transfer.id);
        const done = await recordPayment(page, "etransfer", "$40.00", undefined, "CA1MRx7Q");
        expect(done).toContain(r.donePaid(strings.billing.invoiceNo(transfer.number)));
        expect(done).toContain(r.receiptSent(phone));
        await expect(
            page
                .getByRole("dialog")
                .getByText(strings.billing.statusLabel.paid, { exact: true })
                .first(),
        ).toBeVisible();
    });

    await test.step("a cheque pays part of the second", async () => {
        await openDocument(page, client, "invoice", cheque.id);
        await page
            .getByRole("button", { name: strings.billing.recordPayment, exact: true })
            .click();
        const drawer = paymentDrawer(page);
        await drawer
            .getByRole("group", { name: r.howPaid, exact: true })
            .getByRole("button")
            .filter({ hasText: r.cheque })
            .click();
        await drawer.getByRole("textbox", { name: r.chequeNo }).fill("000123");
        await drawer
            .getByRole("group", { name: r.amount, exact: true })
            .getByRole("button", { name: r.partial, exact: true })
            .click();
        await drawer.getByRole("textbox", { name: r.amount, exact: true }).fill("25");
        await drawer.getByRole("button", { name: r.record("$25.00"), exact: true }).click();
        await expect(drawer.getByText(r.doneTitle, { exact: true })).toBeVisible();
        await expect(drawer).toContainText(
            r.donePartial(strings.billing.invoiceNo(cheque.number), formatMoney(3500, "CAD")),
        );
        await expect(drawer).toContainText(r.receiptSent(phone));
        // the header shows the balance the server returned, not the one before the payment
        await expect(drawer.getByText(formatMoney(6000, "CAD"), { exact: true })).toHaveCount(0);
        await drawer.getByRole("button", { name: strings.common.done, exact: true }).click();
    });

    await test.step("each receipt names how it was paid, and the part payment what is left", async () => {
        await expect
            .poll(async () => (await receiptMessages(page.request, client.phone)).length, {
                timeout: 90_000,
            })
            .toBe(2);
        const receipts = (await deliveredTexts(page.request, client.phone))
            .map((text) => text.text)
            .filter((text) => text.includes("was received"));
        expect(receipts).toEqual([
            expect.stringMatching(/\nPaid by e-Transfer$/),
            expect.stringMatching(/\nPaid by cheque\nBalance due {2}\$35\.00$/),
        ]);
    });

    await test.step("Today and the income report count each once, in a business of their own", async () => {
        const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
        try {
            const owner = await context.newPage();
            await newBusiness(owner, owner.request, "methods");
            const payer = await createDocumentClient(owner);
            for (const [method, cents, reference] of [
                ["etransfer", 4000, "CA1MRx7Q"],
                ["cheque", 2500, "000123"],
            ] as const) {
                const invoice = await issueInvoice(owner, payer.id, 4000);
                const paid = await owner.request.post(
                    `${runUrl("VITE_API_URL")}/v1/invoices/${invoice.id}/payments`,
                    {
                        headers: {
                            Origin: new URL(owner.url()).origin,
                            "Idempotency-Key": randomUUID(),
                        },
                        data: { method, amount_cents: cents, reference, send_receipt: false },
                    },
                );
                expect(paid.status(), await paid.text()).toBe(201);
            }
            await navigate(owner, "/today");
            const collected = owner
                .getByText(strings.today.collected, { exact: true })
                .locator("..");
            await expect(collected).toContainText(formatMoney(6500, "CAD"), { timeout: 60_000 });
            await expect(collected).toContainText(strings.today.collectedHint(2));
            await reports(owner);
            await expect(
                owner.getByText(strings.reports.received(formatMoney(6500, "CAD")), {
                    exact: true,
                }),
            ).toBeVisible();
            for (const [method, cents] of [
                [strings.billing.method.etransfer, 4000],
                [strings.billing.method.cheque, 2500],
            ] as const)
                await expect(owner.locator("li").filter({ hasText: method })).toContainText(
                    formatMoney(cents, "CAD"),
                );
        } finally {
            await context.close();
        }
    });
});
