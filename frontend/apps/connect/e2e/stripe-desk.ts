import { strings } from "@clientbridge/app-core/public";
import { expect, type Frame, type Locator, type Page } from "@playwright/test";
import { select } from "../../web/e2e/support/db";
import { navigate } from "../../web/e2e/support/session";
import type { StockedProduct } from "../../web/e2e/support/pos";
import { merchant } from "./stripe-payouts";

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
    const ticket = page.getByRole("complementary", { name: d.ticket, exact: true });
    await ticket.getByRole("button", { name: d.charge(charge), exact: true }).click();
    const payment = paySheet(page);
    await payment
        .getByRole("group", { name: d.tip, exact: true })
        .getByRole("button", { name: d.tipNone, exact: true })
        .click();
    return payment;
}

export function paySheet(page: Page): Locator {
    return page
        .getByRole("dialog")
        .filter({ has: page.getByRole("heading", { name: d.payTitle, exact: true }) });
}

export function choose(payment: Locator, method: string): Promise<void> {
    return payment
        .getByRole("group", { name: d.howPaying, exact: true })
        .getByRole("button")
        .filter({ hasText: method })
        .click();
}

export async function cardFrame(page: Page): Promise<Frame> {
    let found: Frame | undefined;
    await expect
        .poll(
            async () => {
                for (const frame of page.frames()) {
                    if (
                        await frame
                            .getByRole("textbox", { name: "Card number", exact: true })
                            .isVisible()
                    ) {
                        found = frame;
                        return true;
                    }
                }
                return false;
            },
            { timeout: 60_000 },
        )
        .toBe(true);
    if (!found) throw new Error("Stripe card input frame did not become ready");
    return found;
}
