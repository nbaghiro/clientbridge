import { randomUUID } from "node:crypto";
import { strings } from "@clientbridge/app-core/public";
import { demoPerson } from "@clientbridge/config/e2e/demo";
import { demoId } from "@clientbridge/config/e2e/run";
import { expect, type Locator, type Page } from "@playwright/test";
import { select } from "./db";
import { requireLocalMail } from "./evidence";
const s = strings.catalog;
export interface CatalogEvidence {
    audits: { entity_id: string; action: string }[];
    receipts: { key: string; scope: string; item_id: string }[];
    items: {
        id: string;
        name: string;
        description: string | null;
        kind: string;
        sku: string | null;
        price_cents: number;
        cost_cents: number;
        track_stock: boolean;
        stock_on_hand: number;
    }[];
    movements: {
        id: string;
        item_id: string;
        line_id: string | null;
        reason: string;
        quantity: number;
        note: string;
    }[];
}
export interface CatalogFixture {
    name: string;
    createKeys: string[];
}
export async function catalogEvidence(fixture: CatalogFixture): Promise<CatalogEvidence> {
    expect(fixture.createKeys.every((key) => key.length > 0)).toBe(true);
    const business = demoId("bz_birchbark");
    const owned = await select<{ id: string }>`
        SELECT response->>'id' AS id FROM commands
        WHERE business_id = ${business} AND scope = 'item.create'
            AND key = ANY(${fixture.createKeys}::text[])`;
    const ids = owned.map((row) => row.id);
    return {
        items: await select<CatalogEvidence["items"][number]>`
            SELECT id, name, description, kind, sku, price_cents, cost_cents, track_stock,
                stock_on_hand
            FROM items WHERE id = ANY(${ids}::text[]) ORDER BY id`,
        movements: await select<CatalogEvidence["movements"][number]>`
            SELECT id, item_id, line_id, reason, quantity, note FROM inventory
            WHERE item_id = ANY(${ids}::text[]) ORDER BY id`,
        audits: await select<CatalogEvidence["audits"][number]>`
            SELECT entity_id, action FROM audits WHERE action = 'item.create'
                AND entity_id = ANY(${ids}::text[]) ORDER BY id`,
        receipts: await select<CatalogEvidence["receipts"][number]>`
            SELECT key, scope, response->>'id' AS item_id FROM commands
            WHERE scope = 'item.create'
                AND response->>'id' = ANY(${ids}::text[])
            ORDER BY id`,
    };
}
export function catalogFixture(page: Page): CatalogFixture {
    requireLocalMail();
    const fixture = {
        name: `${demoPerson(randomUUID())}'s Gentle Paw Balm`,
        createKeys: [] as string[],
    };
    page.on("request", (request) => {
        if (request.method() !== "POST" || new URL(request.url()).pathname !== "/v1/items") return;
        const key = request.headers()["idempotency-key"] ?? "";
        if (!fixture.createKeys.includes(key)) fixture.createKeys.push(key);
    });
    return fixture;
}
export async function newProduct(page: Page): Promise<Locator> {
    await page.goto("/setup/services");
    await page.getByRole("tab", { name: s.views.products, exact: true }).click();
    await page.getByRole("button", { name: s.addProduct, exact: true }).click();
    return page.getByRole("dialog");
}
export async function fillProduct(editor: Locator, name: string, opening = "7"): Promise<void> {
    await editor.getByRole("textbox", { name: s.name, exact: true }).fill(name);
    await editor.getByRole("textbox", { name: s.price, exact: true }).fill("15");
    await editor.getByRole("textbox", { name: s.cost, exact: true }).fill("6");
    await editor.getByRole("switch", { name: s.trackStock, exact: false }).check();
    await editor.getByRole("textbox", { name: s.stockOnHand, exact: true }).fill(opening);
}
export async function expectCatalogCommitted(
    fixture: CatalogFixture,
    stock: number,
    note: string,
    description: string | null = null,
    movements: number[] = stock === 0 ? [] : [stock],
    cost = 600,
): Promise<CatalogEvidence> {
    const { name } = fixture;
    const evidence = await catalogEvidence(fixture);
    expect(evidence.items).toEqual([
        {
            id: expect.any(String),
            name,
            description,
            kind: "product",
            sku: null,
            price_cents: 1500,
            cost_cents: cost,
            track_stock: true,
            stock_on_hand: stock,
        },
    ]);
    expect(evidence.movements).toEqual(
        movements.map((quantity) => ({
            id: expect.any(String),
            item_id: evidence.items[0]?.id,
            line_id: null,
            reason: quantity < 0 ? "correction" : "restock",
            quantity,
            note,
        })),
    );
    expect(evidence.audits).toEqual([{ entity_id: evidence.items[0]?.id, action: "item.create" }]);
    expect(evidence.receipts).toEqual([
        { key: expect.any(String), scope: "item.create", item_id: evidence.items[0]?.id },
    ]);
    return evidence;
}
export async function expectStockReplica(
    page: Page,
    fixture: CatalogFixture,
    stock: number,
): Promise<void> {
    const observed = await catalogEvidence(fixture);
    expect(observed.items).toHaveLength(1);
    const id = observed.items[0]?.id;
    expect(id).toBeDefined();
    await page.goto("/setup/services");
    await page.getByRole("tab", { name: s.views.inventory, exact: true }).click();
    const row = page.locator(`[data-item-id="${id ?? ""}"]`);
    await expect(row.getByText(fixture.name, { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(row).toHaveCount(1, { timeout: 60_000 });
    await expect(row).toContainText(stock === 0 ? s.stockOut : s.stockIn(stock), {
        timeout: 60_000,
    });
}
export async function itemCurrency(id: string): Promise<string | undefined> {
    const rows = await select<{ currency: string }>`SELECT currency FROM items WHERE id = ${id}`;
    return rows[0]?.currency;
}
