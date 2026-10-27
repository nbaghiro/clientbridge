import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import {
    catalogEvidence,
    catalogFixture,
    expectCatalogCommitted,
    expectStockReplica,
    fillProduct,
    newProduct,
} from "./support/catalog";
import { signIn } from "./support/session";
const s = strings.catalog;

test("CFG-E2E-01 product validation and opening stock persist across replicas", async ({
    page,
    browser,
}) => {
    await signIn(page);
    const fixture = catalogFixture(page);
    const { name } = fixture;
    const editor = await newProduct(page);
    const submit = editor.getByRole("button", { name: s.add, exact: true });
    await submit.click();
    await expect(editor.getByText(s.nameRequired, { exact: true })).toBeVisible();
    await fillProduct(editor, name, "-1");
    await submit.click();
    await expect(editor.getByText(s.stockInvalid, { exact: true })).toBeVisible();
    expect(await catalogEvidence(fixture)).toEqual({
        items: [],
        movements: [],
        audits: [],
        receipts: [],
    });
    await editor.getByRole("textbox", { name: s.stockOnHand, exact: true }).fill("7");
    await submit.click();
    await expect(editor).toBeHidden();
    const evidence = await expectCatalogCommitted(fixture, 7, s.openingStockNote);
    const observer = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        viewport: { width: 1440, height: 900 },
    });
    try {
        const other = await observer.newPage();
        await signIn(other);
        await expectStockReplica(other, fixture, 7);
        await other.reload();
        await expectStockReplica(other, fixture, 7);
        await page.reload();
        await expectStockReplica(page, fixture, 7);
        expect(await catalogEvidence(fixture)).toEqual(evidence);
    } finally {
        await observer.close();
    }
});

test("CFG-E2E-02 retry after opening-stock transport failure cannot duplicate a SKU-less product", async ({
    page,
    browser,
}, testInfo) => {
    await signIn(page);
    const fixture = catalogFixture(page);
    const { name } = fixture;
    const editor = await newProduct(page);
    await fillProduct(editor, name);
    let restockAttempts = 0;
    await page.route("**/v1/items/*/restock", async (route) => {
        restockAttempts += 1;
        // First command never reaches API. Item creation was already committed by the real API.
        if (restockAttempts === 1) await route.abort("connectionreset");
        else await route.continue();
    });
    const submit = editor.getByRole("button", { name: s.add, exact: true });
    await submit.click();
    await expect(editor.getByText(s.addError, { exact: true })).toBeVisible();
    const partial = await expectCatalogCommitted(fixture, 0, s.openingStockNote);
    await submit.click();
    await expect(editor).toBeHidden();
    const observed = await catalogEvidence(fixture);
    await testInfo.attach("catalog-after-create-retry", {
        body: JSON.stringify({ partial, observed }),
        contentType: "application/json",
    });
    const committed = await expectCatalogCommitted(fixture, 7, s.openingStockNote);
    expect(committed.items[0]?.id).toBe(partial.items[0]?.id);
    expect(restockAttempts).toBe(2);
    const observer = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        viewport: { width: 1440, height: 900 },
    });
    try {
        const other = await observer.newPage();
        await signIn(other);
        await expectStockReplica(other, fixture, 7);
        await page.reload();
        await expectStockReplica(page, fixture, 7);
        expect(await catalogEvidence(fixture)).toEqual(committed);
    } finally {
        await observer.close();
    }
});

test("CFG-E2E-03 lost committed opening-stock response preserves edited quantity and description", async ({
    page,
    browser,
}, testInfo) => {
    await signIn(page);
    const fixture = catalogFixture(page);
    const { name } = fixture;
    const editor = await newProduct(page);
    await fillProduct(editor, name);
    const commands: { key: string | undefined; body: string | null; url: string }[] = [];
    await page.route("**/v1/items/*/restock", async (route) => {
        commands.push({
            key: route.request().headers()["idempotency-key"],
            body: route.request().postData(),
            url: route.request().url(),
        });
        // Real API commits the initial seven units; only its browser response is lost.
        const response = await route.fetch();
        expect(response.status(), await response.text()).toBe(200);
        if (commands.length === 1) await route.abort("connectionreset");
        else await route.fulfill({ response });
    });
    const submit = editor.getByRole("button", { name: s.add, exact: true });
    await submit.click();
    await expect(editor.getByText(s.addError, { exact: true })).toBeVisible();
    const initial = await expectCatalogCommitted(fixture, 7, s.openingStockNote);
    const description = "Unscented care for sensitive paws.";
    await editor.getByRole("textbox", { name: s.stockOnHand, exact: true }).fill("9");
    await editor.getByRole("textbox", { name: s.description, exact: true }).fill(description);
    await submit.click();
    await expect(editor).toBeHidden();
    expect(commands).toHaveLength(3);
    expect(commands[0]?.key).toBeTruthy();
    expect(commands[1]).toEqual(commands[0]);
    expect(commands[2]?.key).not.toBe(commands[0]?.key);
    expect(commands[2]?.url).toBe(commands[0]?.url);
    expect(JSON.parse(commands[2]?.body ?? "{}")).toEqual({
        quantity: 2,
        note: s.openingStockNote,
    });
    const committed = await expectCatalogCommitted(
        fixture,
        9,
        s.openingStockNote,
        description,
        [7, 2],
    );
    expect(committed.items[0]?.id).toBe(initial.items[0]?.id);
    const observer = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        viewport: { width: 1440, height: 900 },
    });
    try {
        const other = await observer.newPage();
        await signIn(other);
        await expectStockReplica(other, fixture, 9);
        await other.getByRole("tab", { name: s.views.products, exact: true }).click();
        await other.locator(`button[data-row-key="${committed.items[0]?.id ?? ""}"]`).click();
        await expect(
            other.getByRole("dialog").getByRole("textbox", { name: s.description, exact: true }),
        ).toHaveValue(description);
        await page.reload();
        await expectStockReplica(page, fixture, 9);
        expect(await catalogEvidence(fixture)).toEqual(committed);
        await testInfo.attach("recovered-edited-catalog", {
            body: JSON.stringify(committed),
            contentType: "application/json",
        });
    } finally {
        await observer.close();
    }
});

test("CFG-E2E-04 lost initial create response replays original command before saving edited product", async ({
    page,
    browser,
}, testInfo) => {
    await signIn(page);
    const fixture = catalogFixture(page);
    const { name } = fixture;
    const editor = await newProduct(page);
    await fillProduct(editor, name);
    const creates: { key: string | undefined; body: string | null; id: string }[] = [];
    await page.route("**/v1/items", async (route) => {
        if (route.request().method() !== "POST") {
            await route.continue();
            return;
        }
        const response = await route.fetch();
        expect(response.status(), await response.text()).toBe(201);
        creates.push({
            key: route.request().headers()["idempotency-key"],
            body: route.request().postData(),
            id: ((await response.json()) as { id: string }).id,
        });
        if (creates.length === 1) await route.abort("connectionreset");
        else await route.fulfill({ response });
    });
    const submit = editor.getByRole("button", { name: s.add, exact: true });
    await submit.click();
    await expect(editor.getByText(s.addError, { exact: true })).toBeVisible();
    const initial = await expectCatalogCommitted(fixture, 0, s.openingStockNote);
    const description = "Gentle fragrance-free care for winter walks.";
    await editor.getByRole("textbox", { name: s.stockOnHand, exact: true }).fill("9");
    await editor.getByRole("textbox", { name: s.description, exact: true }).fill(description);
    await editor.getByRole("textbox", { name: s.cost, exact: true }).fill("7");
    await submit.click();
    await expect(editor).toBeHidden();
    expect(creates).toHaveLength(2);
    expect(creates[0]?.key).toBeTruthy();
    expect(creates[1]).toEqual(creates[0]);
    const committed = await expectCatalogCommitted(
        fixture,
        9,
        s.openingStockNote,
        description,
        [9],
        700,
    );
    expect(committed.items[0]?.id).toBe(initial.items[0]?.id);
    expect(committed.receipts).toEqual(initial.receipts);
    expect(committed.audits).toEqual(initial.audits);
    const observer = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        viewport: { width: 1440, height: 900 },
    });
    try {
        const other = await observer.newPage();
        await signIn(other);
        await expectStockReplica(other, fixture, 9);
        await other.getByRole("tab", { name: s.views.products, exact: true }).click();
        await other.locator(`button[data-row-key="${committed.items[0]?.id ?? ""}"]`).click();
        const saved = other.getByRole("dialog");
        await expect(saved.getByRole("textbox", { name: s.description, exact: true })).toHaveValue(
            description,
        );
        await expect(saved.getByRole("textbox", { name: s.cost, exact: true })).toHaveValue("7.00");
        await page.reload();
        await expectStockReplica(page, fixture, 9);
        expect(await catalogEvidence(fixture)).toEqual(committed);
        await testInfo.attach("initial-create-recovery", {
            body: JSON.stringify(committed),
            contentType: "application/json",
        });
    } finally {
        await observer.close();
    }
});
