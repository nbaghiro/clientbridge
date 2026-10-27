import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { addDays, combineDayAndTime, formatMoney, strings } from "@clientbridge/app-core/public";
import { expect, type Frame, type Locator, type Page } from "@playwright/test";
import { runUrl } from "@clientbridge/config/e2e/run";
import {
    bookingApi,
    createBookingFixture,
    type BookingRecord,
} from "../../web/e2e/support/bookings";
import type { ClientFixture } from "../../web/e2e/support/clients";
import { select } from "../../web/e2e/support/db";
import { openRefund } from "../../web/e2e/support/refunds";
import { navigate } from "../../web/e2e/support/session";
import { registerStripeDeposit } from "./stripe-deposit-contract";
import { enterStripeCard } from "./stripe-provider";

const execute = promisify(execFile);

// Stripe's sandbox cards: one opens an inquiry, the other a fraud dispute as the charge succeeds
export const INQUIRY_CARD = "4000000000001976";
export const DISPUTE_CARD = "4000000000000259";

export async function stripeHarness<T>(args: string[]): Promise<T> {
    const { stdout } = await execute("uv", ["run", "python", "-m", "e2e.stripe", ...args], {
        cwd: fileURLToPath(new URL("../../../../backend", import.meta.url)),
        timeout: 360_000,
    });
    return JSON.parse(stdout) as T;
}

interface BalanceRow {
    id: string;
    type: string;
    reporting_category: string;
    source: string;
    amount: number;
    fee: number;
    net: number;
    fee_details: { type: string; amount: number }[];
}

export interface ChargeEvidence {
    charge: {
        id: string;
        amount: number;
        amount_refunded: number;
        disputed: boolean;
        application_fee_amount: number | null;
    };
    refunds: { id: string; amount: number; status: string; failure_reason: string | null }[];
    disputes: { id: string; status: string; amount: number; reason: string }[];
    transactions: BalanceRow[];
    net_cents: number;
}

export function stripeDispute(
    action: "show" | "escalate" | "lose",
    intentId: string,
): Promise<ChargeEvidence> {
    return stripeHarness<ChargeEvidence>(["disputes", action, intentId]);
}

export async function registerPurchaser(clientId: string, clocked = false): Promise<string> {
    const fixture = await stripeHarness<{ client: string; customer: string; clock: string | null }>(
        ["clients", clocked ? "register-clock" : "register", clientId],
    );
    expect(fixture.client).toBe(clientId);
    expect(fixture.customer).toMatch(/^cus_/);
    expect(fixture.clock === null).toBe(!clocked);
    return fixture.customer;
}

export interface MoneyEntry {
    journal_id: string;
    ref: string;
    event: string;
    amount_cents: number;
    source_id: string | null;
    subject_type: string | null;
    subject_id: string | null;
    category: string;
    code: string;
    owner_type: string;
}

export interface MoneyPayment {
    id: string;
    kind: string;
    status: string;
    amount_cents: number;
    provider_ref: string | null;
    parent_payment_id: string | null;
    invoice_id: string | null;
    booking_id: string | null;
    dispute_status: string | null;
}

/** Every payment and journal that touches one client's money, read outside the app. */
export async function clientMoney(clientId: string): Promise<{
    payments: MoneyPayment[];
    entries: MoneyEntry[];
}> {
    return {
        payments: await select<MoneyPayment>`
            SELECT id, kind, status, amount_cents, provider_ref, parent_payment_id, invoice_id,
                booking_id, dispute_status
            FROM payments WHERE client_id = ${clientId} ORDER BY created_at, id`,
        entries: await select<MoneyEntry>`
            SELECT e.journal_id, e.ref, e.event, e.amount_cents, e.source_id, e.subject_type,
                e.subject_id, a.category, a.code, a.owner_type
            FROM entries e JOIN accounts a ON a.id = e.account_id
            WHERE e.journal_id IN (
                SELECT journal_id FROM entries WHERE
                    (source_type = 'payment' AND source_id IN (
                        SELECT id FROM payments WHERE client_id = ${clientId}))
                    OR (subject_type = 'invoice' AND subject_id IN (
                        SELECT id FROM invoices WHERE client_id = ${clientId}))
                    OR (subject_type = 'booking' AND subject_id IN (
                        SELECT id FROM bookings WHERE client_id = ${clientId}))
                    OR (subject_type = 'gift_card' AND subject_id IN (
                        SELECT id FROM gift_cards WHERE purchaser_client_id = ${clientId}))
                    OR (owner_type = 'client' AND owner_id = ${clientId}))
            ORDER BY e.ref, e.leg`,
    };
}

/** What the business holds in each ledger category across the client's journals. */
export function categoryTotals(entries: MoneyEntry[]): Record<string, number> {
    const totals: Record<string, number> = {};
    for (const entry of entries) {
        if (entry.owner_type === "platform") continue;
        totals[entry.category] = (totals[entry.category] ?? 0) + entry.amount_cents;
    }
    return totals;
}

/** Each journal balances, and the business's Stripe balance matches Stripe's own transactions. */
export function expectLedgerMatchesStripe(entries: MoneyEntry[], provider: ChargeEvidence): void {
    const journals = new Map<string, number>();
    for (const entry of entries)
        journals.set(entry.journal_id, (journals.get(entry.journal_id) ?? 0) + entry.amount_cents);
    for (const total of journals.values()) expect(total).toBe(0);
    const totals = categoryTotals(entries);
    const fees = provider.transactions.reduce((sum, row) => sum + row.fee, 0);
    expect(totals.stripe).toBe(provider.net_cents);
    expect((totals.processing_fee ?? 0) + (totals.platform_fee ?? 0)).toBe(fees);
}

export async function refundPartUi(
    page: Page,
    fixture: { client: ClientFixture; paymentId: string },
    cents: number,
): Promise<void> {
    const s = strings.refunds;
    const panel = await openRefund(page, fixture);
    await panel.getByRole("button", { name: s.part, exact: true }).click();
    await panel
        .getByRole("textbox", { name: s.amount, exact: true })
        .fill((cents / 100).toFixed(2));
    await panel.getByRole("switch", { name: s.notify, exact: true }).uncheck();
    const label = s.refundButton(formatMoney(cents, "CAD"));
    await panel.getByRole("button", { name: label, exact: true }).click();
    const confirm = page.getByRole("dialog", {
        name: s.confirmTitle(formatMoney(cents, "CAD")),
        exact: true,
    });
    const pending = page.waitForResponse(
        (r) =>
            new URL(r.url()).pathname === `/v1/payments/${fixture.paymentId}/refund` &&
            r.request().method() === "POST",
    );
    await confirm.getByRole("button", { name: label, exact: true }).click();
    const response = await pending;
    expect(response.status(), await response.text()).toBe(200);
}

export async function expectRefundBlocked(
    page: Page,
    fixture: { client: ClientFixture; paymentId: string },
): Promise<void> {
    const panel = await openRefund(page, fixture);
    await expect(
        panel.getByText(strings.refunds.blocked.payment_disputed, { exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(
        panel.getByRole("button", { name: strings.refunds.part, exact: true }),
    ).toHaveCount(0);
}

export async function expectDisputeListed(
    page: Page,
    client: ClientFixture,
    status: "lost" | "needs_response",
): Promise<void> {
    await navigate(page, "/payments/refunds");
    // the tab's name carries the open count after the word, as in "Disputes · 2 open"
    await press(page.getByRole("tab", { name: new RegExp(`^${strings.refunds.tabs.disputes}`) }));
    const row = page.getByRole("button").filter({ hasText: client.name });
    await expect(row).toHaveCount(1, { timeout: 60_000 });
    await expect(
        row.getByText(strings.refunds.disputeStatus[status], { exact: true }),
    ).toBeVisible();
}

export async function cardFrame(page: Page): Promise<Frame> {
    let found: Frame | undefined;
    await expect
        .poll(
            async () => {
                for (const frame of page.frames())
                    if (
                        await frame
                            .getByRole("textbox", { name: "Card number", exact: true })
                            .isVisible()
                    ) {
                        found = frame;
                        return true;
                    }
                return false;
            },
            { timeout: 60_000 },
        )
        .toBe(true);
    if (!found) throw new Error("the Stripe card form did not load");
    return found;
}

export async function sellGiftCardByCard(
    page: Page,
    client: ClientFixture,
    cents: number,
    card: string,
): Promise<void> {
    const w = strings.entitlements;
    await navigate(page, "/payments/gift-cards");
    await page.getByRole("button", { name: w.sellNew, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog
        .getByRole("group", { name: w.chooseKind, exact: true })
        .getByRole("button", { name: w.kindNoun.gift_card, exact: true })
        .click();
    await dialog
        .getByRole("textbox", { name: w.giftAmount, exact: true })
        .fill(String(cents / 100));
    await dialog.getByRole("combobox", { name: w.client, exact: true }).fill(client.name);
    await page.locator(`[role="option"][data-value="${client.id}"]`).click({ timeout: 60_000 });
    await dialog.getByRole("combobox", { name: strings.checkout.payment, exact: true }).click();
    await page.getByRole("option", { name: strings.checkout.newCard, exact: true }).click();
    const amount = formatMoney(cents, "CAD");
    const opened = page.waitForResponse(
        (r) => r.url().endsWith("/v1/gift-cards") && r.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: w.charge(amount), exact: true }).click();
    const response = await opened;
    expect(response.status(), await response.text()).toBe(201);
    await enterStripeCard(await cardFrame(page), card);
    const submit = dialog.getByRole("button", {
        name: strings.checkout.charge(amount),
        exact: true,
    });
    await press(submit);
    await expect(dialog.getByText(w.doneTitle, { exact: true })).toBeVisible({ timeout: 90_000 });
    await dialog.getByRole("button", { name: strings.common.close, exact: true }).click();
}

/** Stripe's test-mode tools frame can sit over a control, so activate it from the keyboard. */
export async function press(control: Locator): Promise<void> {
    await control.focus({ timeout: 60_000 });
    await control.press("Enter", { timeout: 30_000 });
}

export async function giftCard(clientId: string) {
    const rows = await select<{ id: string; code: string; status: string; balance_cents: number }>`
        SELECT g.id, g.code, g.status,
            COALESCE((SELECT -SUM(e.amount_cents) FROM entries e
                JOIN accounts a ON a.id = e.account_id
                WHERE a.owner_type = 'gift_card' AND a.owner_id = g.id
                AND a.category = 'gift_card'), 0)::int AS balance_cents
        FROM gift_cards g WHERE g.purchaser_client_id = ${clientId}`;
    expect(rows).toHaveLength(1);
    const [row] = rows;
    if (!row) throw new Error("the gift card is missing");
    return row;
}

/** A visit that has already started, with a $20 deposit due; the money then moves through the UI. */
export async function startedDepositVisit(page: Page, notify: boolean) {
    const api = bookingApi();
    const origin = new URL(page.url()).origin;
    const booking = await createBookingFixture(page);
    const changed = await page.request.patch(`${api}/v1/items/${booking.itemId}`, {
        headers: { Origin: origin, "Idempotency-Key": randomUUID() },
        data: {
            price_cents: 10000,
            tax_class: "standard",
            deposit_type: "fixed",
            deposit_value: 2000,
        },
    });
    expect(changed.status(), await changed.text()).toBe(200);
    // the visit must have started before it can be marked a no-show or settled by its invoice
    for (let back = 1; back <= 7; back++) {
        const day = addDays(new Date(), -back, booking.zone);
        for (const time of ["10:00", "11:00", "13:00", "14:00", "15:00"]) {
            const created = await page.request.post(`${api}/v1/bookings`, {
                headers: { Origin: origin, "Idempotency-Key": randomUUID() },
                data: {
                    client_id: booking.clientId,
                    item_id: booking.itemId,
                    staff_id: booking.staffId,
                    starts_at: combineDayAndTime(day, time, booking.zone).toISOString(),
                    notify,
                },
            });
            if (created.status() === 409) continue;
            expect(created.status(), await created.text()).toBe(201);
            const visit = (await created.json()) as BookingRecord;
            const fixture = await registerStripeDeposit({
                bookingId: visit.id,
                clientId: booking.clientId,
                amountCents: 2000,
                currency: "CAD",
            });
            return { booking, visit, fixture };
        }
    }
    throw new Error("no free past time in the owner's hours for a started visit");
}

export async function manageLink(page: Page, email: string): Promise<string> {
    const base = runUrl("MAILPIT_URL");
    let link: string | undefined;
    await expect(async () => {
        const search = await page.request.get(`${base}/api/v1/search`, {
            params: { query: `to:${email}`, limit: 20 },
        });
        expect(search.status()).toBe(200);
        const { messages } = (await search.json()) as { messages: { ID: string }[] };
        for (const message of messages) {
            const detail = await page.request.get(`${base}/api/v1/message/${message.ID}`);
            const text = ((await detail.json()) as { Text: string }).Text;
            link = (text.match(/https?:\/\/[^\s<>"']+/g) ?? []).find((url) =>
                new URL(url).pathname.startsWith("/m/"),
            );
            if (link) return;
        }
        throw new Error("the booking confirmation with its manage link has not arrived");
    }).toPass({ timeout: 60_000 });
    if (!link) throw new Error("manage link missing");
    return link;
}

export function payLabel(cents: number): string {
    return strings.publicBooking.pay(formatMoney(cents, "CAD"));
}
