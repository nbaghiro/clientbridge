import { randomUUID } from "node:crypto";
import { expect, type Frame, type Page } from "@playwright/test";
import { formatMoney, formatPhone, strings } from "@clientbridge/app-core/public";
import {
    bookingApi,
    createBookingFixture,
    createBookingThroughUi,
    openBooking,
} from "../../../../web/e2e/support/bookings";
import { openInvoice } from "../../../../web/e2e/support/billing";
import { openRefund, type RefundFixture } from "../../../../web/e2e/support/refunds";
import { enterStripeCard, stripeReady } from "./provider";
import { registerStripeDeposit } from "./depositContract";

export async function prepareDepositBooking(page: Page) {
    await stripeReady();
    // API client/catalog prerequisites; booking and money actions below use real provider UI.
    const booking = await createBookingFixture(page);
    const changed = await page.request.patch(`${bookingApi()}/v1/items/${booking.itemId}`, {
        headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
        data: {
            price_cents: 10000,
            tax_class: "standard",
            deposit_type: "fixed",
            deposit_value: 2000,
        },
    });
    expect(changed.status(), await changed.text()).toBe(200);
    const visit = await createBookingThroughUi(page, booking);
    const fixture = await registerStripeDeposit({
        bookingId: visit.id,
        clientId: booking.clientId,
        amountCents: 2000,
        currency: "CAD",
    });
    return { booking, visit, fixture };
}

export async function collectDepositUi(
    page: Page,
    booking: Awaited<ReturnType<typeof prepareDepositBooking>>,
    card = "4242424242424242",
) {
    await openBooking(page, booking.booking, booking.visit.id);
    await page.getByRole("button", { name: strings.bookings.collectNow, exact: true }).click();
    await expect(
        page.getByRole("combobox", { name: strings.checkout.payment, exact: true }),
    ).toContainText(strings.checkout.newCard);
    const pending = page.waitForResponse(
        (r) =>
            new URL(r.url()).pathname === `/v1/bookings/${booking.visit.id}/deposit` &&
            r.request().method() === "POST",
    );
    await page
        .getByRole("button", {
            name: strings.bookings.collectAmount(formatMoney(2000, "CAD")),
            exact: true,
        })
        .click();
    const response = await pending;
    expect(response.status(), await response.text()).toBe(200);
    const body = (await response.json()) as { booking_id: string; payment_id: string };
    expect(body.booking_id).toBe(booking.visit.id);
    let cardFrame: Frame | undefined;
    await expect
        .poll(
            async () => {
                for (const frame of page.frames())
                    if (
                        await frame
                            .getByRole("textbox", { name: "Card number", exact: true })
                            .isVisible()
                    ) {
                        cardFrame = frame;
                        return true;
                    }
                return false;
            },
            { timeout: 60_000 },
        )
        .toBe(true);
    if (!cardFrame) throw new Error("real Stripe PaymentElement did not load");
    await enterStripeCard(cardFrame, card);
    const submit = page.getByRole("button", {
        name: strings.checkout.charge(formatMoney(2000, "CAD")),
        exact: true,
    });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport({ ratio: 1 });
    await submit.click();
    return body.payment_id;
}

export async function invoiceVisitUi(
    page: Page,
    booking: Awaited<ReturnType<typeof prepareDepositBooking>>,
) {
    await openBooking(page, booking.booking, booking.visit.id);
    const invoiceAction = page.getByRole("button", {
        name: strings.bookings.invoiceVisit,
        exact: true,
    });
    await expect(invoiceAction).toBeVisible();
    const pending = page.waitForResponse(
        (r) =>
            new URL(r.url()).pathname === `/v1/invoices/from-booking/${booking.visit.id}` &&
            r.request().method() === "POST",
    );
    await invoiceAction.click();
    const response = await pending;
    expect(response.status(), await response.text()).toBe(201);
    const invoice = (await response.json()) as {
        id: string;
        number: number | null;
        status: string;
        total_cents: number;
        tax_total_cents: number;
    };
    expect(invoice).toMatchObject({ status: "draft", total_cents: 11200, tax_total_cents: 1200 });
    return { id: invoice.id, name: booking.booking.clientName, phone: booking.booking.clientPhone };
}

export async function sendBookingInvoiceUi(
    page: Page,
    invoice: { id: string; name: string; phone: string },
): Promise<number> {
    await openInvoice(page, invoice);
    await page.getByRole("button", { name: strings.billing.sendInvoice, exact: true }).click();
    const review = page
        .getByRole("dialog")
        .filter({ has: page.getByRole("heading", { name: strings.previews.title, exact: true }) });
    await expect(
        review.getByText(formatPhone(invoice.phone), { exact: false }).first(),
    ).toBeVisible();
    const pending = page.waitForResponse(
        (r) =>
            new URL(r.url()).pathname === `/v1/invoices/${invoice.id}/send` &&
            r.request().method() === "POST",
    );
    await review.getByRole("button", { name: strings.billing.sendInvoice, exact: true }).click();
    const response = await pending;
    expect(response.status(), await response.text()).toBe(200);
    const body = (await response.json()) as {
        number: number;
        balance_cents: number;
        status: string;
    };
    expect(body).toMatchObject({ balance_cents: 9200, status: "partial" });
    return body.number;
}

export async function refundUi(
    page: Page,
    fixture: RefundFixture,
    cents: number,
    options: { wholeOnly: boolean; cancelFirst: boolean },
): Promise<void> {
    const s = strings.refunds;
    const panel = await openRefund(page, fixture);
    if (options.wholeOnly) {
        await expect(panel.getByText(s.wholeOnly, { exact: true })).toBeVisible();
        await expect(panel.getByRole("button", { name: s.part, exact: true })).toBeDisabled();
    } else {
        await panel.getByRole("button", { name: s.part, exact: true }).click();
        await panel.getByRole("textbox", { name: s.amount, exact: true }).fill("56.00");
        for (const amount of [5000, 250, 350])
            await expect(
                panel.getByText(formatMoney(amount, "CAD"), { exact: true }),
            ).toBeVisible();
    }
    await panel.getByRole("switch", { name: s.notify, exact: true }).uncheck();
    const label = s.refundButton(formatMoney(cents, "CAD"));
    await panel.getByRole("button", { name: label, exact: true }).click();
    const confirm = page.getByRole("dialog", {
        name: s.confirmTitle(formatMoney(cents, "CAD")),
        exact: true,
    });
    if (options.cancelFirst) {
        await confirm.getByRole("button", { name: strings.common.cancel, exact: true }).click();
        return;
    }
    const pending = page.waitForResponse(
        (r) =>
            new URL(r.url()).pathname === `/v1/payments/${fixture.paymentId}/refund` &&
            r.request().method() === "POST",
    );
    await confirm.getByRole("button", { name: label, exact: true }).click();
    const response = await pending;
    expect(response.status(), await response.text()).toBe(200);
    expect(response.request().postDataJSON()).toMatchObject({ amount_cents: cents, notify: false });
}
