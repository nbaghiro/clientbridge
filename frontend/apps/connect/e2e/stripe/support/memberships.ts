import { randomUUID } from "node:crypto";
import { formatMoney, strings } from "@clientbridge/app-core/public";
import { expect, type Locator, type Page } from "@playwright/test";
import { bookingApi } from "../../../../web/e2e/support/bookings";
import { type ClientFixture, openWallet } from "../../../../web/e2e/support/clients";
import { select } from "../../../../web/e2e/support/db";
import { savedMethods } from "./wallet";
import { type ChargeEvidence, stripeHarness } from "./disputes";
import { cardFrame, enterStripeCard } from "./provider";

export const DAY = 86_400;

interface Renewal {
    id: string;
    status: string;
    billing_reason: string;
    amount_due: number;
    amount_paid: number;
    attempt_count: number;
    period_start: number;
    period_end: number;
    subscription: string;
    payments: { intent: string; status: string; charge: ChargeEvidence | null }[];
}

export interface MembershipEvidence {
    subscriptions: { id: string; status: string }[];
    invoices: Renewal[];
}

export function membershipEvidence(clientId: string): Promise<MembershipEvidence> {
    return stripeHarness<MembershipEvidence>(["clients", "evidence", clientId]);
}

export async function advanceClock(clientId: string, seconds: number): Promise<void> {
    const moved = await stripeHarness<{ frozen_time: number }>([
        "clients",
        "advance",
        clientId,
        "--seconds",
        String(seconds),
    ]);
    expect(moved.frozen_time).toBeGreaterThan(0);
}

export function declineRenewals(clientId: string): Promise<{ subscription: string }> {
    return stripeHarness<{ subscription: string }>(["clients", "decline", clientId]);
}

export async function setPlan(status: string): Promise<string> {
    const changed = await stripeHarness<{ before: string; plan_status: string }>(["plan", status]);
    expect(changed.plan_status).toBe(status);
    return changed.before;
}

export async function dailyMembership(page: Page, client: ClientFixture) {
    const name = `${client.name} — Daily coat care plan`;
    const response = await page.request.post(`${bookingApi()}/v1/items`, {
        headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
        data: {
            kind: "subscription",
            name,
            price_cents: 2000,
            tax_class: "exempt",
            interval: 1,
            frequency: "day",
            active: true,
        },
    });
    expect(response.status(), await response.text()).toBe(201);
    return { id: ((await response.json()) as { id: string }).id, name };
}

export async function saveCardUi(
    page: Page,
    client: ClientFixture,
    number = "4242424242424242",
): Promise<void> {
    const before = (await savedMethods(client.id)).length;
    const wallet = await openWallet(page, client);
    await wallet.getByRole("button", { name: strings.clients.addCard, exact: true }).click();
    await enterStripeCard(await cardFrame(page), number);
    await wallet
        .getByRole("button", {
            name: strings.clients.saveMethod(strings.clients.cardNoun),
            exact: true,
        })
        .click();
    await expect
        .poll(async () => (await savedMethods(client.id)).length, { timeout: 90_000 })
        .toBe(before + 1);
}

/** Picks the plan in the wallet's sale sheet and charges the saved card, returning the answer. */
async function chargeMembership(
    page: Page,
    client: ClientFixture,
    item: { id: string; name: string },
    chargedCents: number,
): Promise<{ sheet: Locator; status: number; body: string }> {
    const wallet = await openWallet(page, client);
    await wallet
        .getByRole("button", { name: strings.clients.startSubscriptionLink, exact: true })
        .click();
    const w = strings.entitlements;
    const sheet = page.getByRole("dialog");
    await sheet
        .getByRole("group", { name: w.chooseItem, exact: true })
        .locator(`button[data-value="${item.id}"]`)
        .click({ timeout: 60_000 });
    await sheet.getByRole("combobox", { name: strings.checkout.payment, exact: true }).click();
    await page.getByRole("option").filter({ hasText: "4242" }).click();
    const created = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/v1/subscriptions" && r.request().method() === "POST",
    );
    await sheet
        .getByRole("button", { name: w.charge(formatMoney(chargedCents, "CAD")), exact: true })
        .click();
    const response = await created;
    return { sheet, status: response.status(), body: await response.text() };
}

export async function startMembershipUi(
    page: Page,
    client: ClientFixture,
    item: { id: string; name: string },
    chargedCents = 2000,
): Promise<void> {
    const { sheet, status, body } = await chargeMembership(page, client, item, chargedCents);
    expect(status, body).toBe(201);
    await expect(sheet.getByText(strings.entitlements.doneTitle, { exact: true })).toBeVisible();
    await sheet.getByRole("button", { name: strings.common.close, exact: true }).click();
}

/** Starts the membership again while it is live, and checks the sheet refuses it in words. */
export async function refusedMembershipUi(
    page: Page,
    client: ClientFixture,
    item: { id: string; name: string },
    chargedCents = 2000,
): Promise<void> {
    const { sheet, status, body } = await chargeMembership(page, client, item, chargedCents);
    expect(status, body).toBe(409);
    await expect(sheet.getByText(strings.api.membershipExists, { exact: true })).toBeVisible();
    await sheet.getByRole("button", { name: strings.common.cancel, exact: true }).click();
    await expect(sheet).toBeHidden();
}

export async function membershipRows(clientId: string) {
    return select<{
        id: string;
        status: string;
        provider_ref: string | null;
        current_period_end: Date | null;
        ends_at: Date | null;
    }>`
        SELECT id, status, provider_ref, current_period_end, ends_at FROM subscriptions
        WHERE client_id = ${clientId} ORDER BY created_at`;
}

/** The plan's line in the client's wallet, which says when it next charges, ends or ended. */
export function membershipLine(wallet: Locator, item: { name: string }): Locator {
    return wallet.getByRole("listitem").filter({ hasText: item.name });
}

export async function pastDueNotices(subscriptionId: string) {
    return select<{ key: string; state: string }>`
        SELECT key, state FROM deliveries
        WHERE key LIKE ${`stripe:subscription_past_due:${subscriptionId}:%`}
        AND payload->>'channel' = 'sms' ORDER BY key`;
}
