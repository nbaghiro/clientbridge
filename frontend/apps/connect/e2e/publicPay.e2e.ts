import { randomUUID } from "node:crypto";
import { formatMoney, saleNumber, strings } from "@clientbridge/app-core/public";
import { expectPrinted, printToPdf, type Printed } from "@clientbridge/config/e2e/printed";
import { demoId } from "@clientbridge/config/e2e/run";
import { expect, test } from "@playwright/test";
import {
    longInvoiceLines,
    printedLetterhead,
    printedRecord,
    type PrintableRecord,
} from "../../web/e2e/support/billing";
import { select } from "../../web/e2e/support/db";
import { documentApi, documentProvider } from "./support/documents";
import { on } from "./support/hosts";
import { links } from "./support/links";
import { ownAddress } from "./support/network";
import { watchErrors } from "./support/errors";

test.beforeEach(async ({ context }, info) => {
    await ownAddress(context, info);
});

test("a client opens an invoice and sees how to pay it", async ({ page }) => {
    const errors = watchErrors(page);
    const pay = strings.publicPay;
    await page.goto(on("pay", `/i/${links.invoice}`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText("#");
    await expect(
        page.getByRole("heading", { name: new RegExp(`^(${pay.payTitle}|${pay.offlineTitle})$`) }),
    ).toBeVisible();
    expect(errors).toEqual([]);
});

test("a paid or voided invoice says so at the top and asks for nothing", async ({
    page,
    request,
}) => {
    const errors = watchErrors(page);
    const pay = strings.publicPay;
    const provider = await documentProvider(request);
    const write = (path: string, data: unknown) =>
        request.post(`${documentApi}${path}`, {
            headers: { ...provider.headers, "Idempotency-Key": randomUUID() },
            data,
        });
    const issue = async () => {
        const response = await write("/v1/invoices", {
            client_id: provider.clientId,
            send: true,
            lines: [
                {
                    description: "Nail trim",
                    quantity: 1,
                    unit_amount_cents: 1800,
                    tax_class: "exempt",
                },
            ],
        });
        expect(response.status(), await response.text()).toBe(201);
        return (await response.json()) as { id: string; pay_token: string };
    };
    const paid = await issue();
    const recorded = await write(`/v1/invoices/${paid.id}/payments`, {
        method: "cash",
        amount_cents: 1800,
        send_receipt: false,
    });
    expect(recorded.status(), await recorded.text()).toBe(201);
    const voided = await issue();
    expect((await write(`/v1/invoices/${voided.id}/void`, {})).status()).toBe(200);
    const dueLead = (pay.dueOn("~").split("~")[0] ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const due = new RegExp(`^${dueLead}`);
    for (const [invoice, status] of [
        [paid, pay.paidInFull],
        [voided, pay.closed],
    ] as const) {
        await page.goto(on("pay", `/i/${invoice.pay_token}`));
        await expect(page.getByText(status, { exact: true })).toBeVisible();
        await expect(page.getByText(due)).toHaveCount(0);
        await expect(
            page.getByRole("button", { name: pay.continueToPay, exact: true }),
        ).toHaveCount(0);
    }
    expect(errors).toEqual([]);
});

test("DOC-E2E-14 the invoice, estimate and receipt pages print to PDF with the record's logo, address, GST/HST number, lines, taxes and totals, and a long invoice carries on to a second page with nothing cut off and no blank page", async ({
    page,
    request,
}) => {
    test.setTimeout(180_000);
    const errors = watchErrors(page);
    const letterhead = await printedLetterhead();
    const provider = await documentProvider(request);
    const write = async <T>(path: string, data: unknown): Promise<T> => {
        const response = await request.post(`${documentApi}${path}`, {
            headers: { ...provider.headers, "Idempotency-Key": randomUUID() },
            data,
        });
        expect(response.status(), await response.text()).toBe(201);
        return (await response.json()) as T;
    };
    const record = async (path: string): Promise<PrintableRecord> => {
        const response = await request.get(`${documentApi}${path}`);
        expect(response.status(), await response.text()).toBe(200);
        return (await response.json()) as PrintableRecord;
    };
    // the invoice, estimate and visit pages open the copy first; the sale receipt prints itself
    const printFrom = async (url: string, button: string, preview: boolean): Promise<Printed> => {
        await page.goto(url);
        const open = page.getByRole("button", { name: button, exact: true }).first();
        if (!preview) return printToPdf(page, () => open.click());
        await open.click();
        const dialog = page.getByRole("dialog");
        return printToPdf(page, () =>
            dialog.getByRole("button", { name: button, exact: true }).click(),
        );
    };
    const expectCopy = (
        printed: Printed,
        kind: "invoice" | "estimate" | "receipt",
        number: string,
        copy: PrintableRecord,
        { content = [], once = [] }: { content?: string[]; once?: string[] } = {},
    ): void => {
        expect(printed.title).toMatch(new RegExp(`-${strings.printing.kinds[kind]}-${number}$`));
        const shown = printedRecord(copy);
        expectPrinted(printed, {
            content: [...letterhead.head, ...shown.content, ...content],
            footer: letterhead.footer,
            together: shown.together,
            once,
        });
    };
    // as on the web, the length where the footer is the first thing past the second page
    const lines = longInvoiceLines(38);
    const invoice = await write<{ pay_token: string }>("/v1/invoices", {
        client_id: provider.clientId,
        lines,
        send: true,
    });
    const estimate = await write<{ view_token: string }>("/v1/estimates", {
        client_id: provider.clientId,
        lines: lines.slice(0, 3),
        send: true,
    });

    const invoiceCopy = await printFrom(
        on("pay", `/i/${invoice.pay_token}`),
        strings.publicPay.downloadInvoice,
        true,
    );
    const invoiceRecord = await record(`/pay/${invoice.pay_token}`);
    expectCopy(invoiceCopy, "invoice", String(invoiceRecord.number), invoiceRecord, {
        once: invoiceRecord.lines.map((line) => line.description),
    });
    expect(invoiceCopy.pages.length).toBeGreaterThan(1);
    const later = invoiceCopy.pages
        .slice(1)
        .map((p) => p.text)
        .join(" ");
    expect(later).toContain(String(lines.at(-1)?.description));
    expect(later).toContain(formatMoney(invoiceRecord.total_cents, invoiceRecord.currency));

    const estimateUrl = on("pay", `/e/${estimate.view_token}`);
    const estimateCopy = await printFrom(estimateUrl, strings.publicEstimate.downloadPdf, true);
    const estimateRecord = await record(`/estimate/${estimate.view_token}`);
    expectCopy(estimateCopy, "estimate", String(estimateRecord.number), estimateRecord, {
        content: [strings.printing.acceptOnline(estimateUrl)],
    });
    expect(estimateCopy.pages).toHaveLength(1);

    const saleCopy = await printFrom(
        on("pay", `/r/${links.receipt}`),
        strings.publicReceipt.print,
        false,
    );
    const saleRecord = await record(`/receipt/${links.receipt}`);
    expectCopy(saleCopy, "receipt", saleNumber(saleRecord.number), saleRecord);
    expect(saleCopy.pages).toHaveLength(1);

    const visits = await select<{ token: string }>`
        SELECT manage_token AS token FROM bookings
        WHERE business_id = ${demoId("bz_birchbark")} AND status = 'completed'
            AND manage_token IS NOT NULL AND invoice_id IS NOT NULL AND deleted_at IS NULL
        ORDER BY id LIMIT 20`;
    let visit: { token: string } | undefined;
    for (const candidate of visits) {
        const response = await request.get(`${documentApi}/manage/${candidate.token}/receipt`);
        if (response.status() === 200) {
            visit = candidate;
            break;
        }
    }
    if (visit === undefined) throw new Error("no paid past visit with a manage link");
    const visitCopy = await printFrom(
        on("book", `/m/${visit.token}`),
        strings.publicManage.receipt,
        true,
    );
    const visitRecord = await record(`/manage/${visit.token}/receipt`);
    expectCopy(visitCopy, "receipt", String(visitRecord.number), visitRecord);
    expect(visitCopy.pages).toHaveLength(1);
    expect(errors).toEqual([]);
});
