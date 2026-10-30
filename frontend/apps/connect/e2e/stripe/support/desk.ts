import { strings } from "@clientbridge/app-core/public";
import { expect, type Locator, type Page } from "@playwright/test";
import { select } from "../../../../web/e2e/support/db";
import { navigate } from "../../../../web/e2e/support/session";
import {
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
