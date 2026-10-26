import { randomUUID } from "node:crypto";
import { strings } from "@clientbridge/app-core/public";
import { expect, type Page } from "@playwright/test";

import { createClient, type ClientFixture } from "./crm";
import { select } from "./db";
import { requireLocalMail } from "./evidence";
import { navigate } from "./session";
import { runUrl } from "@clientbridge/config/e2e/run";

const w = strings.entitlements;
export interface EntitlementEvidence {
    gifts: {
        id: string;
        code: string;
        initial_cents: number;
        status: string;
        payment_id: string;
    }[];
    packages: {
        id: string;
        item_id: string;
        sessions_total: number;
        status: string;
        payment_id: string;
    }[];
    payments: {
        id: string;
        kind: string;
        method: string;
        provider: string;
        status: string;
        amount_cents: number;
    }[];
    entries: {
        journal_id: string;
        event: string;
        amount_cents: number;
        category: string;
        subject_id: string;
    }[];
}
export async function entitlementEvidence(clientId: string): Promise<EntitlementEvidence> {
    type Evidence = EntitlementEvidence;
    return {
        gifts: await select<Evidence["gifts"][number]>`
            SELECT id, code, initial_cents, status, payment_id FROM gift_cards
            WHERE purchaser_client_id = ${clientId} ORDER BY id`,
        packages: await select<Evidence["packages"][number]>`
            SELECT id, item_id, sessions_total, status, payment_id FROM packages
            WHERE client_id = ${clientId} ORDER BY id`,
        payments: await select<Evidence["payments"][number]>`
            SELECT id, kind, method, provider, status, amount_cents FROM payments
            WHERE id IN (
                SELECT payment_id FROM gift_cards WHERE purchaser_client_id = ${clientId}
                UNION SELECT payment_id FROM packages WHERE client_id = ${clientId})
            ORDER BY id`,
        entries: await select<Evidence["entries"][number]>`
            SELECT e.journal_id, e.event, e.amount_cents, a.category, e.subject_id
            FROM entries e JOIN accounts a ON a.id = e.account_id
            WHERE e.subject_id IN (
                SELECT id FROM gift_cards WHERE purchaser_client_id = ${clientId}
                UNION SELECT id FROM packages WHERE client_id = ${clientId})
            ORDER BY e.journal_id, e.leg`,
    };
}
export async function entitlementFixture(page: Page, kind: "gift_card" | "package") {
    requireLocalMail();
    const client = await createClient(page);
    let itemId: string | null = null;
    const itemName = `${client.name} — Three Gentle Grooming Visits`;
    if (kind === "package") {
        const response = await page.request.post(`${runUrl("VITE_API_URL")}/v1/items`, {
            headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
            data: {
                kind: "package",
                name: itemName,
                sku: `BB-GROOM-${randomUUID().slice(0, 8).toUpperCase()}`,
                price_cents: 6001,
                tax_class: "exempt",
                session_count: 3,
                validity_days: 365,
                active: true,
            },
        });
        expect(response.status(), await response.text()).toBe(201);
        itemId = ((await response.json()) as { id: string }).id;
    }
    expect(await entitlementEvidence(client.id)).toEqual({
        gifts: [],
        packages: [],
        payments: [],
        entries: [],
    });
    return { client, itemId, itemName };
}
export async function sellEntitlement(
    page: Page,
    client: ClientFixture,
    kind: "gift_card" | "package",
    itemId: string | null,
    subjectId?: string,
): Promise<void> {
    await navigate(page, "/payments/gift-cards");
    await page.getByRole("button", { name: w.sellNew, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog
        .getByRole("group", { name: w.chooseKind, exact: true })
        .getByRole("button", { name: w.kindNoun[kind], exact: true })
        .click();
    if (kind === "gift_card")
        await dialog.getByRole("textbox", { name: w.giftAmount, exact: true }).fill("50");
    else
        await dialog
            .getByRole("group", { name: w.chooseItem, exact: true })
            .locator(`button[data-value="${itemId ?? ""}"]`)
            .click();
    await dialog.getByRole("combobox", { name: w.client, exact: true }).fill(client.name);
    await page.locator(`[role="option"][data-value="${client.id}"]`).click({ timeout: 60_000 });
    if (subjectId !== undefined) {
        const subjects = dialog.getByRole("group", {
            name: strings.subjects.one("pet"),
            exact: true,
        });
        await expect(subjects.locator('button[data-value="shared"]')).toHaveAttribute(
            "aria-pressed",
            "true",
            { timeout: 60_000 },
        );
        await subjects.locator(`button[data-value="${subjectId}"]`).click();
    }
    const responsePromise = page.waitForResponse(
        (r) =>
            r.url().endsWith(kind === "gift_card" ? "/v1/gift-cards" : "/v1/packages") &&
            r.request().method() === "POST",
    );
    await dialog
        .getByRole("button", {
            name: w.record(kind === "gift_card" ? "$50.00" : "$60.01"),
            exact: true,
        })
        .click();
    const response = await responsePromise;
    expect(response.status(), await response.text()).toBe(201);
    await expect(dialog.getByText(w.doneTitle, { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: strings.common.close, exact: true }).click();
}
export async function openEntitlement(
    page: Page,
    clientName: string,
    entitlementId: string,
): Promise<void> {
    await page.goto("/payments/gift-cards");
    await page.getByRole("searchbox", { name: w.search, exact: true }).fill(clientName);
    await page.locator(`button[data-row-key="${entitlementId}"]`).click({ timeout: 60_000 });
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 60_000 });
}
export async function redeemGift(
    page: Page,
    code: string,
    amount: string,
    status = 200,
): Promise<void> {
    await navigate(page, "/payments/gift-cards");
    await page.getByRole("button", { name: w.redeemGift, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: w.giftCards.code, exact: true }).fill(code);
    await dialog.getByRole("textbox", { name: w.giftCards.balance, exact: true }).fill(amount);
    const pending = page.waitForResponse(
        (r) => r.url().endsWith("/v1/gift-cards/redeem") && r.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: w.giftCards.redeem, exact: true }).click();
    const response = await pending;
    expect(response.status(), await response.text()).toBe(status);
    if (status !== 200) {
        await expect(dialog.getByText(w.giftCards.redeemError, { exact: true })).toBeVisible();
        await dialog.getByRole("button", { name: strings.common.cancel, exact: true }).click();
    }
    await expect(dialog).toBeHidden();
}
export function expectEntitlementLedger(
    evidence: EntitlementEvidence,
    amount: number,
    liability: "gift_card" | "deferred",
    recognized: number[],
): void {
    expect(evidence.payments).toEqual([
        {
            id: expect.any(String),
            kind: "payment",
            method: "cash",
            provider: "manual",
            status: "succeeded",
            amount_cents: amount,
        },
    ]);
    const expected = [
        { event: "payment", category: "cash", amount_cents: amount },
        { event: "payment", category: liability, amount_cents: -amount },
        ...recognized.flatMap((value) => [
            {
                event: liability === "gift_card" ? "redemption" : "consumption",
                category: liability,
                amount_cents: value,
            },
            {
                event: liability === "gift_card" ? "redemption" : "consumption",
                category: "revenue",
                amount_cents: -value,
            },
        ]),
    ];
    const sorted = (rows: typeof expected) =>
        rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    expect(
        sorted(
            evidence.entries.map(({ event, category, amount_cents }) => ({
                event,
                category,
                amount_cents,
            })),
        ),
    ).toEqual(sorted(expected));
    const journals = new Set(evidence.entries.map((e) => e.journal_id));
    expect(journals.size).toBe(1 + recognized.length);
    const subject = liability === "gift_card" ? evidence.gifts[0]?.id : evidence.packages[0]?.id;
    expect(new Set(evidence.entries.map((e) => e.subject_id))).toEqual(new Set([subject]));
    for (const journal of journals) {
        const legs = evidence.entries.filter((e) => e.journal_id === journal);
        expect(legs).toHaveLength(2);
        expect(legs.reduce((sum, leg) => sum + leg.amount_cents, 0)).toBe(0);
    }
}
