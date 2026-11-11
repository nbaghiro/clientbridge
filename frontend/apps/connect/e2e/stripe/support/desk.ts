import { strings } from "@clientbridge/app-core/public";
import { expect, type Locator, type Page } from "@playwright/test";
import type { ClientFixture } from "../../../../web/e2e/support/clients";
import { select } from "../../../../web/e2e/support/db";
import { navigate } from "../../../../web/e2e/support/session";
import {
    choosePaymentMethod,
    paymentPanel,
    saleTicket,
    skipTip,
    type StockedProduct,
} from "../../../../web/e2e/support/pos";
import { merchant } from "./payouts";

const d = strings.pos.desk;

export interface StripeIntent {
    id: string;
    status: string;
    amount: number;
    currency: string;
    metadata: Record<string, string>;
    charge: string | null;
    cancellation_reason: string | null;
}

export function stripeIntent(id: string): Promise<StripeIntent> {
    return merchant<StripeIntent>("intent", id);
}

export interface DeskPayment {
    id: string;
    order_id: string;
    method: string;
    provider: string;
    provider_ref: string | null;
    status: string;
    amount_cents: number;
    tendered_cents: number | null;
}

export async function deskPayments(orderId: string): Promise<DeskPayment[]> {
    return select<DeskPayment>`
        SELECT id, order_id, method, provider, provider_ref, status, amount_cents, tendered_cents
        FROM payments WHERE order_id = ${orderId} AND kind = 'payment' ORDER BY created_at, id`;
}

/** Rings one unit up for a walk-in and opens payment with no tip, ready to choose a method. */
export async function ringUpWalkIn(
    page: Page,
    product: StockedProduct,
    charge: string,
): Promise<Locator> {
    await navigate(page, "/payments/sales");
    await page.getByRole("searchbox", { name: d.searchShort, exact: true }).fill(product.sku);
    const tile = page.getByRole("button", { name: product.name, exact: true });
    await expect(tile).toContainText(d.inStock(3), { timeout: 60_000 });
    await tile.click();
    const ticket = saleTicket(page);
    await ticket.getByRole("button", { name: d.charge(charge), exact: true }).click();
    const payment = paymentPanel(page);
    await skipTip(payment);
    return payment;
}

/** Rings one unit up for the client and opens payment with no tip, ready to choose a method. */
export async function ringUpForClient(
    page: Page,
    sale: { product: StockedProduct; stock: number; client: ClientFixture; charge: string },
): Promise<Locator> {
    await navigate(page, "/payments/sales");
    await page.getByRole("searchbox", { name: d.searchShort, exact: true }).fill(sale.product.sku);
    const tile = page.getByRole("button", { name: sale.product.name, exact: true });
    await expect(tile).toContainText(d.inStock(sale.stock), { timeout: 60_000 });
    await tile.click();
    const ticket = saleTicket(page);
    await ticket.getByRole("button").filter({ hasText: d.chooseClient }).click();
    await ticket
        .getByRole("searchbox", { name: d.clientSearch, exact: true })
        .fill(sale.client.name);
    await ticket.getByRole("button").filter({ hasText: sale.client.name }).click();
    await expect(ticket).toContainText(sale.client.name);
    await ticket.getByRole("button", { name: d.charge(sale.charge), exact: true }).click();
    const payment = paymentPanel(page);
    await skipTip(payment);
    return payment;
}

export interface DeskCheckout {
    order_id: string;
    payment_id: string;
    body: unknown;
}

/** Charges the sale by the chosen method; a new card then opens Stripe's card form. */
export async function chargeDesk(
    page: Page,
    payment: Locator,
    method: string,
    charge: string,
): Promise<DeskCheckout> {
    await choosePaymentMethod(payment, method);
    const opened = page.waitForResponse(
        (response) =>
            /\/v1\/orders\/[^/]+\/pay$/.test(response.url()) &&
            response.request().method() === "POST",
    );
    await payment.getByRole("button", { name: d.charge(charge), exact: true }).click();
    const response = await opened;
    expect(response.status(), await response.text()).toBe(200);
    const checkout = (await response.json()) as { order_id: string; payment_id: string };
    return {
        ...checkout,
        body: response.request().postDataJSON(),
    };
}

/** Submits the card typed into the desk's Stripe form. */
export async function submitDeskCard(page: Page, charge: string): Promise<void> {
    await paymentPanel(page)
        .getByRole("button", { name: strings.checkout.charge(charge), exact: true })
        .click();
}
