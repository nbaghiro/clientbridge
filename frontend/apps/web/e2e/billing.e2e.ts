import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";

import { createInvoice, expectPaid, openInvoice, recordCash } from "./support/billing";
import { paymentEvidence, receiptMessages } from "./support/evidence";
import { signIn } from "./support/session";

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

test("BILL-PILOT-02 retry after a lost response does not collect cash twice", async ({
    page,
}, testInfo) => {
    await signIn(page);
    const invoice = await createInvoice(page);
    await testInfo.attach("fixture", {
        body: JSON.stringify(invoice),
        contentType: "application/json",
    });
    await openInvoice(page, invoice);
    await page.getByRole("button", { name: strings.billing.recordPayment, exact: true }).click();
    await page.getByRole("button", { name: strings.billing.rec.partial, exact: true }).click();
    await page.getByRole("textbox", { name: strings.billing.rec.amount, exact: true }).fill("4.00");
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
    await expect(page.getByText(strings.billing.rec.doneTitle, { exact: true })).toBeVisible();
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
    expect((await receiptMessages(page.request, invoice.email))[0]?.Snippet).toContain("$4.00");
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
});
