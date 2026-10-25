import { randomUUID } from "node:crypto";
import { formatMoney, strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";

import { openInvoice } from "./support/billing";
import { bookingApi } from "./support/bookings";
import {
    createCashRefundFixture,
    expectCashRefunds,
    expectCreditNotes,
    openRefund,
    refundEvidence,
} from "./support/refunds";
import { signIn } from "./support/session";

const s = strings.refunds;

test("REF-E2E-01 cash partial refund and remainder issue exact tax credit notes", async ({
    page,
    browser,
}, testInfo) => {
    await signIn(page);
    const fixture = await createCashRefundFixture(page);
    const before = await refundEvidence(fixture.invoiceId);
    expectCashRefunds(before, fixture, 0);
    let panel = await openRefund(page, fixture);
    await expect(panel).toContainText(s.byHandNote);
    await panel.getByRole("button", { name: s.part, exact: true }).click();
    await panel.getByRole("textbox", { name: s.amount, exact: true }).fill("112.01");
    await expect(
        panel.getByRole("button", { name: s.refundButton(formatMoney(11200, "CAD")), exact: true }),
    ).toBeDisabled();
    expect(await refundEvidence(fixture.invoiceId)).toEqual(before);
    await panel.getByRole("textbox", { name: s.amount, exact: true }).fill("56.00");
    for (const amount of [5000, 250, 350])
        await expect(panel.getByText(formatMoney(amount, "CAD"), { exact: true })).toBeVisible();
    await expect(panel.getByText("GST", { exact: true })).toBeVisible();
    await expect(panel.getByText("PST", { exact: true })).toBeVisible();
    await panel.getByRole("switch", { name: s.notify, exact: true }).uncheck();
    const refundLabel = s.refundButton(formatMoney(5600, "CAD"));
    await panel.getByRole("button", { name: refundLabel, exact: true }).click();
    const confirm = page.getByRole("dialog", {
        name: s.confirmTitle(formatMoney(5600, "CAD")),
        exact: true,
    });
    await expect(confirm).toContainText(`CN-${String(fixture.number)}-1`);
    await confirm.getByRole("button", { name: strings.common.cancel, exact: true }).click();
    expect(await refundEvidence(fixture.invoiceId)).toEqual(before);

    const path = `/v1/payments/${fixture.paymentId}/refund`;
    const firstResponse = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === path && response.request().method() === "POST",
    );
    await panel.getByRole("button", { name: refundLabel, exact: true }).click();
    await confirm.getByRole("button", { name: refundLabel, exact: true }).click();
    const first = await firstResponse;
    expect(first.status(), await first.text()).toBe(200);
    expect(await first.json()).toMatchObject({
        status: "succeeded",
        credit_note: `CN-${String(fixture.number)}-1`,
    });
    const partial = await refundEvidence(fixture.invoiceId);
    expectCashRefunds(partial, fixture, 1);
    await openInvoice(page, {
        id: fixture.invoiceId,
        name: fixture.client.name,
        email: fixture.client.email,
    });
    await expect(
        page
            .getByRole("dialog")
            .getByText(strings.billing.statusLabel.paid, { exact: true })
            .first(),
    ).toBeVisible();
    await page.reload();
    panel = await openRefund(page, fixture);
    await expect(panel).toContainText(s.statusLabel.partly_refunded);
    await panel.getByRole("button", { name: s.part, exact: true }).click();
    await panel.getByRole("textbox", { name: s.amount, exact: true }).fill("56.01");
    await expect(panel.getByRole("button", { name: refundLabel, exact: true })).toBeDisabled();
    const rejected = await page.request.post(`${bookingApi()}${path}`, {
        headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
        data: { amount_cents: 5601, notify: false },
    });
    expect(rejected.status()).toBe(409);
    expect(await refundEvidence(fixture.invoiceId)).toEqual(partial);
    await panel
        .getByRole("button", { name: s.full(formatMoney(5600, "CAD")), exact: true })
        .click();
    await panel.getByRole("switch", { name: s.notify, exact: true }).uncheck();
    const remainderResponse = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === path && response.request().method() === "POST",
    );
    await panel.getByRole("button", { name: refundLabel, exact: true }).click();
    await expect(confirm).toContainText(`CN-${String(fixture.number)}-2`);
    await confirm.getByRole("button", { name: refundLabel, exact: true }).click();
    const remainder = await remainderResponse;
    expect(remainder.status(), await remainder.text()).toBe(200);
    expect(await remainder.json()).toMatchObject({
        status: "succeeded",
        credit_note: `CN-${String(fixture.number)}-2`,
    });
    const final = await refundEvidence(fixture.invoiceId);
    expectCashRefunds(final, fixture, 2);
    await openInvoice(page, {
        id: fixture.invoiceId,
        name: fixture.client.name,
        email: fixture.client.email,
    });
    await expect(
        page
            .getByRole("dialog")
            .getByText(strings.billing.statusLabel.refunded, { exact: true })
            .first(),
    ).toBeVisible();
    await page.reload();
    panel = await openRefund(page, fixture);
    await expect(panel).toContainText(s.statusLabel.refunded);
    await expect(
        panel.getByRole("button", { name: s.refundButton(formatMoney(0, "CAD")), exact: true }),
    ).toHaveCount(0);
    await expectCreditNotes(page, fixture);
    const observer = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
        const other = await observer.newPage();
        await signIn(other);
        await expectCreditNotes(other, fixture);
        await other.reload();
        await expectCreditNotes(other, fixture);
        await expect(await openRefund(other, fixture)).toContainText(s.statusLabel.refunded);
        expect(await refundEvidence(fixture.invoiceId)).toEqual(final);
        await testInfo.attach("cash-refund-credit-notes", {
            body: JSON.stringify(final),
            contentType: "application/json",
        });
    } finally {
        await observer.close();
    }
});
