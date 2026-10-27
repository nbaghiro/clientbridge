import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import {
    createInvoice,
    expectPaid,
    openInvoice,
    recordCash,
    applyPercentDiscount,
    composeDocument,
    createDocumentClient,
    documentEvidence,
    documentMail,
    expectDocumentTotal,
    fillDocumentLine,
    openDocument,
    saveDocument,
    type DocumentRecord,
} from "./support/billing";
import { paymentEvidence, receiptMessages } from "./support/evidence";
import { signIn } from "./support/session";
import { randomUUID } from "node:crypto";
import { demoId, runEmail, runUrl } from "@clientbridge/config/e2e/run";

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
                .poll(async () => (await receiptMessages(page.request, invoice.email)).length)
                .toBe(1);
            expect((await receiptMessages(page.request, invoice.email))[0]?.Snippet).toContain(
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
                .poll(async () => (await receiptMessages(page.request, invoice.email)).length)
                .toBe(1);
            expect((await receiptMessages(page.request, invoice.email))[0]?.Snippet).toContain(
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
            await expect(review.getByText(client.email, { exact: false }).first()).toBeVisible();
            await review.getByRole("button", { name: strings.common.cancel, exact: true }).click();
            expect((await documentEvidence("invoice", draft.id)).document.status).toBe("draft");
            expect((await paymentEvidence(draft.id)).entries).toEqual([]);
            expect(await documentMail(page, client)).toEqual([]);
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
            await expect.poll(async () => (await documentMail(page, client)).length).toBe(1);
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
            email: runEmail("marcus.b@example.test"),
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
});
