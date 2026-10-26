import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { saleNumber, strings } from "@clientbridge/app-core/public";
import { expect, type Locator, type Page } from "@playwright/test";

import { bookingApi } from "./bookings";
import { createClient, type ClientFixture } from "./crm";
import { requireLocalMail } from "./evidence";
import { navigate } from "./session";

const execute = promisify(execFile);
const d = strings.pos.desk;

export interface SaleFixture {
    client: ClientFixture;
    item: { id: string; name: string; sku: string };
}

export interface SaleEvidence {
    item: { id: string; stock_on_hand: number; track_stock: boolean };
    orders: {
        id: string;
        client_id: string;
        number: number;
        status: string;
        source: string;
        subtotal_cents: number;
        tax_total_cents: number;
        total_cents: number;
        paid: boolean;
    }[];
    lines: {
        id: string;
        order_id: string;
        item_id: string;
        quantity: number;
        unit_amount_cents: number;
        amount_cents: number;
        tax_class: string;
    }[];
    payments: {
        id: string;
        order_id: string;
        kind: string;
        method: string;
        provider: string;
        status: string;
        amount_cents: number;
        tendered_cents: number;
        tip_cents: number;
    }[];
    refunds: {
        id: string;
        parent_payment_id: string;
        status: string;
        method: string;
        provider: string;
        amount_cents: number;
        credit_note: string | null;
    }[];
    entries: {
        journal_id: string;
        event: string;
        amount_cents: number;
        category: string;
        source_id: string;
    }[];
    movements: { id: string; line_id: string | null; reason: string; quantity: number }[];
}

export async function saleEvidence(itemId: string): Promise<SaleEvidence> {
    const { stdout } = await execute(
        "uv",
        ["run", "python", "-m", "scripts.e2e_sales_evidence", itemId],
        {
            cwd: fileURLToPath(new URL("../../../../../backend", import.meta.url)),
            timeout: 30_000,
        },
    );
    return JSON.parse(stdout) as SaleEvidence;
}

export async function createSaleFixture(page: Page): Promise<SaleFixture> {
    await requireLocalMail();
    const client = await createClient(page);
    const api = process.env.VITE_API_URL ?? "http://localhost:8701";
    const sku = `BB-PB-${randomUUID().slice(0, 8).toUpperCase()}`;
    const name = "Oatmeal Paw Balm";
    const headers = { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() };
    const created = await page.request.post(`${api}/v1/items`, {
        headers,
        data: {
            kind: "product",
            name,
            sku,
            price_cents: 1500,
            tax_class: "exempt",
            track_stock: true,
            active: true,
        },
    });
    expect(created.status(), await created.text()).toBe(201);
    const item = (await created.json()) as { id: string };
    const stocked = await page.request.post(`${api}/v1/items/${item.id}/restock`, {
        headers,
        data: { quantity: 5, note: "Opening shelf count" },
    });
    expect(stocked.status(), await stocked.text()).toBe(200);
    expect(await stocked.json()).toMatchObject({ id: item.id, stock_on_hand: 5 });
    const baseline = await saleEvidence(item.id);
    expect(baseline.orders).toEqual([]);
    expect(baseline.payments).toEqual([]);
    expect(baseline.movements).toEqual([
        { id: expect.any(String), line_id: null, reason: "restock", quantity: 5 },
    ]);
    return { client, item: { ...item, name, sku } };
}

export async function prepareCashSale(page: Page, fixture: SaleFixture): Promise<Locator> {
    await navigate(page, "/payments/sales");
    await page.getByRole("searchbox", { name: d.searchShort, exact: true }).fill(fixture.item.sku);
    const tile = page.getByRole("button", { name: fixture.item.name, exact: true });
    await expect(tile).toContainText(d.inStock(5), { timeout: 60_000 });
    await tile.click();
    await page
        .getByRole("button", { name: strings.ui.onTicket(fixture.item.name, 1), exact: true })
        .click();
    const ticket = page.getByRole("complementary", { name: d.ticket, exact: true });
    await ticket.getByRole("button").filter({ hasText: d.chooseClient }).click();
    await ticket
        .getByRole("searchbox", { name: d.clientSearch, exact: true })
        .fill(fixture.client.email);
    await ticket.getByRole("button").filter({ hasText: fixture.client.name }).click();
    await expect(ticket).toContainText(fixture.client.name);
    await ticket.getByRole("button", { name: d.charge("$30.00"), exact: true }).click();
    const payment = page.getByRole("dialog", { name: d.payTitle, exact: true });
    await payment
        .getByRole("group", { name: d.tip, exact: true })
        .getByRole("button", { name: d.tipNone, exact: true })
        .click();
    await payment
        .getByRole("group", { name: d.howPaying, exact: true })
        .getByRole("button")
        .filter({ hasText: d.methodCash })
        .click();
    await payment.getByRole("textbox", { name: d.cashGiven, exact: true }).fill("40.00");
    return payment;
}

export async function expectSaleCommitted(fixture: SaleFixture): Promise<SaleEvidence> {
    const evidence = await saleEvidence(fixture.item.id);
    expect(evidence.item).toEqual({ id: fixture.item.id, stock_on_hand: 3, track_stock: true });
    expect(evidence.orders).toHaveLength(1);
    const order = evidence.orders[0];
    expect(order).toMatchObject({
        client_id: fixture.client.id,
        status: "open",
        source: "pos",
        subtotal_cents: 3000,
        tax_total_cents: 0,
        total_cents: 3000,
        paid: true,
    });
    expect(evidence.lines).toEqual([
        {
            id: expect.any(String),
            order_id: order?.id,
            item_id: fixture.item.id,
            quantity: 2,
            unit_amount_cents: 1500,
            amount_cents: 3000,
            tax_class: "exempt",
        },
    ]);
    expect(evidence.payments).toEqual([
        {
            id: expect.any(String),
            order_id: order?.id,
            kind: "payment",
            method: "cash",
            provider: "manual",
            status: "succeeded",
            amount_cents: 3000,
            tendered_cents: 4000,
            tip_cents: 0,
        },
    ]);
    expect(
        evidence.entries
            .map(({ category, amount_cents, event, source_id }) => ({
                category,
                amount_cents,
                event,
                source_id,
            }))
            .sort((a, b) => a.category.localeCompare(b.category)),
    ).toEqual([
        {
            category: "cash",
            amount_cents: 3000,
            event: "payment",
            source_id: evidence.payments[0]?.id,
        },
        {
            category: "revenue",
            amount_cents: -3000,
            event: "payment",
            source_id: evidence.payments[0]?.id,
        },
    ]);
    expect(new Set(evidence.entries.map((entry) => entry.journal_id)).size).toBe(1);
    expect(evidence.movements).toEqual([
        { id: expect.any(String), line_id: null, reason: "restock", quantity: 5 },
        { id: expect.any(String), line_id: evidence.lines[0]?.id, reason: "sale", quantity: -2 },
    ]);
    return evidence;
}

export async function expectSaleReplica(
    page: Page,
    fixture: SaleFixture,
    number: number,
): Promise<void> {
    await navigate(page, "/payments/sales");
    await page.getByRole("searchbox", { name: d.searchShort, exact: true }).fill(fixture.item.sku);
    await expect(page.getByRole("button", { name: fixture.item.name, exact: true })).toContainText(
        d.inStock(3),
        { timeout: 60_000 },
    );
    await navigate(page, "/payments/sales?view=history");
    await page
        .getByRole("searchbox", { name: d.historySearch, exact: true })
        .fill(fixture.client.name);
    await page
        .getByRole("button", {
            name: strings.common.labelValue(saleNumber(number), fixture.client.name),
            exact: true,
        })
        .click({ timeout: 60_000 });
    const detail = page.getByRole("dialog");
    await expect(detail.getByText(fixture.item.name, { exact: true })).toBeVisible();
    await expect(detail.getByText(d.status.paid, { exact: true })).toBeVisible();
    await expect(detail).toContainText("$30.00");
}

export interface StockedProduct {
    id: string;
    name: string;
    sku: string;
}

export async function stockProduct(
    page: Page,
    product: { name: string; prefix: string; priceCents: number; taxClass: string; stock: number },
): Promise<StockedProduct> {
    const api = bookingApi();
    const sku = `${product.prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const headers = (): Record<string, string> => ({
        Origin: new URL(page.url()).origin,
        "Idempotency-Key": randomUUID(),
    });
    const created = await page.request.post(`${api}/v1/items`, {
        headers: headers(),
        data: {
            kind: "product",
            name: product.name,
            sku,
            price_cents: product.priceCents,
            tax_class: product.taxClass,
            track_stock: true,
            active: true,
        },
    });
    expect(created.status(), await created.text()).toBe(201);
    const item = (await created.json()) as { id: string };
    const stocked = await page.request.post(`${api}/v1/items/${item.id}/restock`, {
        headers: headers(),
        data: { quantity: product.stock, note: "Opening shelf count" },
    });
    expect(stocked.status(), await stocked.text()).toBe(200);
    return { id: item.id, name: product.name, sku };
}

/** Rings `taps` of the product for the client and opens cash payment with `given` received. */
export async function ringCash(
    page: Page,
    sale: {
        product: StockedProduct;
        stock: number;
        taps: number;
        client: ClientFixture;
        charge: string;
        given: string;
    },
): Promise<Locator> {
    await navigate(page, "/payments/sales");
    await page.getByRole("searchbox", { name: d.searchShort, exact: true }).fill(sale.product.sku);
    const tile = page.getByRole("button", { name: sale.product.name, exact: true });
    await expect(tile).toContainText(d.inStock(sale.stock), { timeout: 60_000 });
    await tile.click();
    for (let count = 1; count < sale.taps; count++)
        await page
            .getByRole("button", {
                name: strings.ui.onTicket(sale.product.name, count),
                exact: true,
            })
            .click();
    await expect(
        page.getByRole("button", {
            name: strings.ui.onTicket(sale.product.name, sale.taps),
            exact: true,
        }),
    ).toBeVisible();
    const ticket = page.getByRole("complementary", { name: d.ticket, exact: true });
    await ticket.getByRole("button").filter({ hasText: d.chooseClient }).click();
    await ticket
        .getByRole("searchbox", { name: d.clientSearch, exact: true })
        .fill(sale.client.email);
    await ticket.getByRole("button").filter({ hasText: sale.client.name }).click();
    await expect(ticket).toContainText(sale.client.name);
    await ticket.getByRole("button", { name: d.charge(sale.charge), exact: true }).click();
    const payment = page.getByRole("dialog", { name: d.payTitle, exact: true });
    await payment
        .getByRole("group", { name: d.tip, exact: true })
        .getByRole("button", { name: d.tipNone, exact: true })
        .click();
    await payment
        .getByRole("group", { name: d.howPaying, exact: true })
        .getByRole("button")
        .filter({ hasText: d.methodCash })
        .click();
    await payment.getByRole("textbox", { name: d.cashGiven, exact: true }).fill(sale.given);
    return payment;
}

export async function payCash(
    page: Page,
    payment: Locator,
    charge: string,
): Promise<{ payment_id: string; amount_cents: number; change_cents: number }> {
    const paid = page.waitForResponse(
        (response) =>
            /\/v1\/orders\/[^/]+\/cash$/.test(response.url()) &&
            response.request().method() === "POST",
    );
    await payment.getByRole("button", { name: d.charge(charge), exact: true }).click();
    const response = await paid;
    expect(response.status(), await response.text()).toBe(200);
    await expect(page.getByRole("heading", { name: d.paidTitle, exact: true })).toBeVisible();
    return (await response.json()) as {
        payment_id: string;
        amount_cents: number;
        change_cents: number;
    };
}
