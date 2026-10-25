import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";

import {
    createSaleFixture,
    expectSaleCommitted,
    expectSaleReplica,
    prepareCashSale,
    saleEvidence,
} from "./support/sales";
import { signIn } from "./support/session";

const d = strings.pos.desk;

test("SALE-E2E-01 cash retail sale persists exact ledger and inventory across replicas", async ({
    page,
    browser,
}, testInfo) => {
    await signIn(page);
    const fixture = await createSaleFixture(page);
    const observer = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        viewport: { width: 1440, height: 900 },
    });
    try {
        const other = await observer.newPage();
        await signIn(other);
        const payment = await prepareCashSale(page, fixture);
        const paid = page.waitForResponse(
            (response) =>
                /\/v1\/orders\/[^/]+\/cash$/.test(response.url()) &&
                response.request().method() === "POST",
        );
        await payment.getByRole("button", { name: d.charge("$30.00"), exact: true }).click();
        const response = await paid;
        expect(response.status(), await response.text()).toBe(200);
        expect(await response.json()).toMatchObject({
            amount_cents: 3000,
            tip_cents: 0,
            change_cents: 1000,
        });
        await expect(page.getByRole("heading", { name: d.paidTitle, exact: true })).toBeVisible();
        await expect(page.getByText(d.changeToGive("$10.00"), { exact: true })).toBeVisible();
        const evidence = await expectSaleCommitted(fixture);
        const order = evidence.orders[0];
        expect(order).toBeDefined();
        if (order === undefined) throw new Error("Committed sale missing");
        await expectSaleReplica(other, fixture, order.number);
        await other.reload();
        await expectSaleReplica(other, fixture, order.number);
        await page.reload();
        await expectSaleReplica(page, fixture, order.number);
        await testInfo.attach("committed-sale-evidence", {
            body: JSON.stringify(evidence),
            contentType: "application/json",
        });
    } finally {
        await observer.close();
    }
});

test("SALE-E2E-02 retry after committed cash response loss cannot charge or reduce stock twice", async ({
    page,
    browser,
}, testInfo) => {
    await signIn(page);
    const fixture = await createSaleFixture(page);
    const payment = await prepareCashSale(page, fixture);
    const keys: (string | undefined)[] = [];
    const bodies: (string | null)[] = [];
    await page.route("**/v1/orders/*/cash", async (route) => {
        keys.push(route.request().headers()["idempotency-key"]);
        bodies.push(route.request().postData());
        const actual = await route.fetch();
        expect(actual.status(), await actual.text()).toBe(200);
        if (keys.length === 1) await route.abort("connectionreset");
        else await route.fulfill({ response: actual });
    });
    const submit = payment.getByRole("button", { name: d.charge("$30.00"), exact: true });
    await submit.click();
    await expect(payment.getByText(d.payError, { exact: true })).toBeVisible();
    const committed = await expectSaleCommitted(fixture);
    await submit.click();
    await expect(page.getByRole("heading", { name: d.paidTitle, exact: true })).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(bodies[1]).toBe(bodies[0]);
    expect(await saleEvidence(fixture.item.id)).toEqual(committed);
    const order = committed.orders[0];
    expect(order).toBeDefined();
    if (order === undefined) throw new Error("Committed sale missing");
    const observer = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        viewport: { width: 1440, height: 900 },
    });
    try {
        const other = await observer.newPage();
        await signIn(other);
        await expectSaleReplica(other, fixture, order.number);
        await page.reload();
        await expectSaleReplica(page, fixture, order.number);
        await testInfo.attach("unchanged-after-retry", {
            body: JSON.stringify(committed),
            contentType: "application/json",
        });
    } finally {
        await observer.close();
    }
});
