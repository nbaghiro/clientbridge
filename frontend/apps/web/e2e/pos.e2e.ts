import { randomUUID } from "node:crypto";
import {
    MEMBER_DISCOUNT_REASON,
    formatMoney,
    saleNumber,
    strings,
} from "@clientbridge/app-core/public";
import { expect, test, type Page } from "@playwright/test";
import { bookingApi, createBookingFixture } from "./support/bookings";
import { createClient, type ClientFixture } from "./support/clients";
import { select } from "./support/db";
import { joinHoursStaff } from "./support/hours";
import { openRefund } from "./support/refunds";
import {
    choosePaymentMethod,
    createSaleFixture,
    expectSaleCommitted,
    expectSaleReplica,
    payCash,
    paymentPanel,
    prepareCashSale,
    ringCash,
    saleEvidence,
    saleTicket,
    stockProduct,
} from "./support/pos";
import { navigate, signIn } from "./support/session";
import { demoId } from "@clientbridge/config/e2e/run";

const d = strings.pos.desk;
const r = strings.refunds;

async function openSale(page: Page, client: ClientFixture, number: number) {
    await navigate(page, "/payments/sales?view=history");
    await page.getByRole("searchbox", { name: d.historySearch, exact: true }).fill(client.name);
    await page
        .getByRole("button", {
            name: strings.common.labelValue(saleNumber(number), client.name),
            exact: true,
        })
        .click({ timeout: 60_000 });
    return page.getByRole("dialog");
}

function apiHeaders(page: Page, key: string = randomUUID()): Record<string, string> {
    return { Origin: new URL(page.url()).origin, "Idempotency-Key": key };
}

/** Puts a catalog item on the desk's ticket, searching every kind for it. */
async function addToTicket(page: Page, name: string): Promise<void> {
    const main = page.getByRole("main");
    await main
        .getByRole("group", { name: d.addExtras, exact: true })
        .getByRole("button", { name: new RegExp(`^${d.catAll}`) })
        .click({ timeout: 60_000 });
    await main.getByRole("searchbox", { name: d.searchShort, exact: true }).fill(name);
    await main.getByRole("button", { name, exact: true }).click({ timeout: 60_000 });
}

async function discountSale(page: Page, kind: string, value: string, reason: string) {
    await saleTicket(page).getByRole("button", { name: d.addDiscount, exact: true }).click();
    const sheet = page.getByRole("dialog", { name: d.discountTitle, exact: true });
    await sheet.getByRole("button", { name: kind, exact: true }).click();
    await sheet
        .getByRole("textbox", {
            name: kind === d.percent ? d.percentOff : d.amountOff,
            exact: true,
        })
        .fill(value);
    await sheet.getByRole("button", { name: reason, exact: true }).click();
    await sheet.getByRole("button", { name: d.applyDiscount, exact: true }).click();
    await expect(sheet).toBeHidden();
}

async function payExactCash(page: Page, charge: string) {
    const payment = paymentPanel(page);
    await choosePaymentMethod(payment, d.methodCash);
    await payment.getByRole("button", { name: d.exactCash, exact: true }).click();
    return payCash(page, payment, charge);
}

function soldWith(itemId: string) {
    return select<{
        id: string;
        staff_id: string;
        subtotal_cents: number;
        tax_total_cents: number;
        total_cents: number;
        discount_kind: string | null;
        discount_value: number | null;
    }>`
        SELECT id, staff_id, subtotal_cents, tax_total_cents, total_cents, discount_kind,
            discount_value
        FROM orders WHERE id IN (SELECT order_id FROM lines WHERE item_id = ${itemId})`;
}

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
    await expect(payment.getByText(d.chargeError, { exact: true })).toBeVisible();
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

test("SALE-E2E-10 a part refund keeps a desk sale's stock out and the remainder returns it once", async ({
    page,
}, testInfo) => {
    test.setTimeout(240_000);
    await signIn(page);
    const client = await createClient(page);
    const product = await stockProduct(page, {
        name: "Lavender paw soak",
        prefix: "BB-PS",
        priceCents: 1500,
        taxClass: "exempt",
        stock: 5,
    });
    const payment = await ringCash(page, {
        product,
        stock: 5,
        taps: 2,
        client,
        charge: "$30.00",
        given: "30.00",
    });
    const paid = await payCash(page, payment, "$30.00");
    expect(paid).toMatchObject({ amount_cents: 3000, change_cents: 0 });
    const sold = await saleEvidence(product.id);
    expect(sold.item.stock_on_hand).toBe(3);
    const order = sold.orders[0];
    const line = sold.lines[0];
    if (order === undefined || line === undefined) throw new Error("The sale was not committed");

    const path = `/v1/payments/${paid.payment_id}/refund`;
    const refundPath = (response: { url: () => string; request: () => { method: () => string } }) =>
        new URL(response.url()).pathname === path && response.request().method() === "POST";
    const sale = await openSale(page, client, order.number);
    await sale.getByRole("button", { name: d.refund, exact: true }).click();
    await expect(
        page.getByRole("dialog", { name: d.saleNumber(saleNumber(order.number)), exact: true }),
    ).toBeHidden();
    let panel = page.getByRole("complementary", { name: client.name, exact: true });
    await expect(panel.getByRole("heading", { name: client.name, exact: true })).toBeVisible({
        timeout: 60_000,
    });
    await panel.getByRole("button", { name: r.part, exact: true }).click();
    await panel.getByRole("textbox", { name: r.amount, exact: true }).fill("15.00");
    await panel.getByRole("switch", { name: r.notify, exact: true }).uncheck();
    const partLabel = r.refundButton(formatMoney(1500, "CAD"));
    await panel.getByRole("button", { name: partLabel, exact: true }).click();
    const confirm = page.getByRole("dialog", {
        name: r.confirmTitle(formatMoney(1500, "CAD")),
        exact: true,
    });
    const partRequest = page.waitForResponse(refundPath);
    await confirm.getByRole("button", { name: partLabel, exact: true }).click();
    const part = await partRequest;
    expect(part.status(), await part.text()).toBe(200);
    const partBody = (await part.json()) as { refund_id: string; status: string };
    expect(partBody.status).toBe("succeeded");
    const partly = await saleEvidence(product.id);
    expect(partly.item.stock_on_hand).toBe(3);
    expect(partly.movements).toEqual(sold.movements);
    expect(partly.orders).toEqual([{ ...order, paid: true }]);
    expect(partly.refunds).toEqual([
        {
            id: partBody.refund_id,
            parent_payment_id: paid.payment_id,
            status: "succeeded",
            method: "cash",
            provider: "manual",
            amount_cents: 1500,
            credit_note: expect.any(String),
        },
    ]);
    const partLegs = partly.entries.filter((entry) => entry.source_id === partBody.refund_id);
    expect(
        partLegs
            .map(({ category, amount_cents }) => ({ category, amount_cents }))
            .sort((x, y) => x.category.localeCompare(y.category)),
    ).toEqual([
        { category: "cash", amount_cents: -1500 },
        { category: "revenue", amount_cents: 1500 },
    ]);
    const partReplay = await page.request.post(`${bookingApi()}${path}`, {
        headers: apiHeaders(page, part.request().headers()["idempotency-key"]),
        data: part.request().postDataJSON() as Record<string, unknown>,
    });
    expect(partReplay.status(), await partReplay.text()).toBe(200);
    expect(await partReplay.json()).toMatchObject({ refund_id: partBody.refund_id });
    expect(await saleEvidence(product.id)).toEqual(partly);
    await panel.getByRole("button", { name: strings.common.close, exact: true }).first().click();
    const detail = await openSale(page, client, order.number);
    await expect(detail.getByText(d.status.partly_refunded, { exact: true })).toBeVisible();

    await page.reload();
    panel = await openRefund(page, { client, paymentId: paid.payment_id });
    await panel
        .getByRole("button", { name: r.full(formatMoney(1500, "CAD")), exact: true })
        .click();
    await panel.getByRole("switch", { name: r.notify, exact: true }).uncheck();
    await panel.getByRole("button", { name: partLabel, exact: true }).click();
    const restRequest = page.waitForResponse(refundPath);
    await confirm.getByRole("button", { name: partLabel, exact: true }).click();
    const rest = await restRequest;
    expect(rest.status(), await rest.text()).toBe(200);
    const restBody = (await rest.json()) as { refund_id: string };
    const refunded = await saleEvidence(product.id);
    expect(refunded.item.stock_on_hand).toBe(5);
    expect(refunded.movements).toEqual([
        ...sold.movements,
        { id: expect.any(String), line_id: line.id, reason: "refund", quantity: 2 },
    ]);
    expect(refunded.refunds.map((refund) => [refund.id, refund.amount_cents])).toEqual([
        [partBody.refund_id, 1500],
        [restBody.refund_id, 1500],
    ]);
    for (const category of ["cash", "revenue"])
        expect(
            refunded.entries
                .filter((entry) => entry.category === category)
                .reduce((sum, entry) => sum + entry.amount_cents, 0),
        ).toBe(0);
    const restReplay = await page.request.post(`${bookingApi()}${path}`, {
        headers: apiHeaders(page, rest.request().headers()["idempotency-key"]),
        data: rest.request().postDataJSON() as Record<string, unknown>,
    });
    expect(restReplay.status(), await restReplay.text()).toBe(200);
    expect(await restReplay.json()).toMatchObject({ refund_id: restBody.refund_id });
    const more = await page.request.post(`${bookingApi()}${path}`, {
        headers: apiHeaders(page),
        data: { amount_cents: 100, notify: false },
    });
    expect(more.status()).toBe(409);
    expect(await saleEvidence(product.id)).toEqual(refunded);
    const final = await openSale(page, client, order.number);
    await expect(final.getByText(d.status.refunded, { exact: true })).toBeVisible();
    await testInfo.attach("desk-refunds", {
        body: JSON.stringify(refunded),
        contentType: "application/json",
    });
});

test("SALE-E2E-11 front-desk staff may sell past zero stock but cannot refund, void or restock", async ({
    page,
    browser,
    request,
    baseURL,
}, testInfo) => {
    test.setTimeout(240_000);
    await signIn(page);
    const client = await createClient(page);
    const product = await stockProduct(page, {
        name: "Bully stick, large",
        prefix: "BB-BS",
        priceCents: 1200,
        taxClass: "exempt",
        stock: 1,
    });
    const desk = await browser.newContext({ baseURL: baseURL ?? "" });
    const staffPage = await desk.newPage();
    const staff = await joinHoursStaff(staffPage, request);
    try {
        const payment = await ringCash(staffPage, {
            product,
            stock: 1,
            taps: 3,
            client,
            charge: "$36.00",
            given: "40.00",
        });
        const paid = await payCash(staffPage, payment, "$36.00");
        expect(paid).toMatchObject({ amount_cents: 3600, change_cents: 400 });
        const sold = await saleEvidence(product.id);
        expect(sold.item).toEqual({ id: product.id, stock_on_hand: -2, track_stock: true });
        expect(sold.movements).toEqual([
            { id: expect.any(String), line_id: null, reason: "restock", quantity: 1 },
            { id: expect.any(String), line_id: sold.lines[0]?.id, reason: "sale", quantity: -3 },
        ]);
        const order = sold.orders[0];
        if (order === undefined) throw new Error("The staff sale was not committed");
        expect(order).toMatchObject({ client_id: client.id, total_cents: 3600, paid: true });

        const done = saleTicket(staffPage);
        await expect(done.getByRole("heading", { name: d.paidTitle, exact: true })).toBeVisible();
        await expect(done.getByRole("button", { name: d.refund, exact: true })).toHaveCount(0);
        await navigate(staffPage, "/payments/sales?view=history");
        const views = staffPage.getByRole("group", { name: d.title, exact: true });
        await expect(views.getByRole("button")).toHaveCount(2);
        await expect(views.getByRole("button", { name: d.history, exact: true })).toHaveCount(0);
        await expect(
            views.getByRole("button", { name: d.newSaleTitle, exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
        await expect(
            staffPage.getByRole("searchbox", { name: d.historySearch, exact: true }),
        ).toHaveCount(0);

        const api = bookingApi();
        const refund = await staffPage.request.post(
            `${api}/v1/payments/${paid.payment_id}/refund`,
            {
                headers: apiHeaders(staffPage),
                data: { amount_cents: 1200, notify: false },
            },
        );
        expect(refund.status()).toBe(403);
        const restock = await staffPage.request.post(`${api}/v1/items/${product.id}/restock`, {
            headers: apiHeaders(staffPage),
            data: { quantity: 10, note: "Counted the back shelf" },
        });
        expect(restock.status()).toBe(403);
        const held = await staffPage.request.post(`${api}/v1/orders`, {
            headers: apiHeaders(staffPage),
            data: {
                client_id: client.id,
                note: "Back after lunch",
                lines: [
                    {
                        description: product.name,
                        quantity: 1,
                        unit_amount_cents: 1200,
                        item_id: product.id,
                    },
                ],
            },
        });
        expect(held.status(), await held.text()).toBe(201);
        const ticket = (await held.json()) as { id: string; number: number };
        const staffVoid = await staffPage.request.post(`${api}/v1/orders/${ticket.id}/void`, {
            headers: apiHeaders(staffPage),
        });
        expect(staffVoid.status()).toBe(403);
        const afterRefused = await saleEvidence(product.id);
        expect(afterRefused.item.stock_on_hand).toBe(-2);
        expect(afterRefused.movements).toEqual(sold.movements);
        expect(afterRefused.payments).toEqual(sold.payments);
        expect(afterRefused.orders.find((row) => row.id === ticket.id)).toMatchObject({
            status: "open",
            paid: false,
        });

        const ownerTicket = await openSale(page, client, ticket.number);
        await ownerTicket.getByRole("button", { name: d.voidSale, exact: true }).click();
        const confirmVoid = page.getByRole("dialog", {
            name: d.voidTitle(saleNumber(ticket.number)),
            exact: true,
        });
        const voiding = page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === `/v1/orders/${ticket.id}/void` &&
                response.request().method() === "POST",
        );
        await confirmVoid.getByRole("button", { name: d.voidSale, exact: true }).click();
        expect((await voiding).status()).toBe(200);
        const final = await saleEvidence(product.id);
        expect(final.orders.find((row) => row.id === ticket.id)).toMatchObject({ status: "void" });
        expect(final.item.stock_on_hand).toBe(-2);
        expect(final.movements).toEqual(sold.movements);
        await testInfo.attach("staff-desk-boundaries", {
            body: JSON.stringify({ staff: staff.id, final }),
            contentType: "application/json",
        });
    } finally {
        await staff.cleanup();
        await desk.close();
    }
});

test("SALE-E2E-16 line and sale discounts with a percent tip charge exact cents and tax", async ({
    page,
}, testInfo) => {
    test.setTimeout(180_000);
    await signIn(page);
    const groom = await createBookingFixture(page, {
        price_cents: 10000,
        tax_class: "federal_only",
    });
    const shampoo = await stockProduct(page, {
        name: `Oatmeal shampoo for ${groom.clientName}`,
        prefix: "BB-OS",
        priceCents: 2400,
        taxClass: "standard",
        stock: 5,
    });
    await navigate(page, "/payments/sales");
    await addToTicket(page, groom.itemName);
    await addToTicket(page, shampoo.name);
    const ticket = saleTicket(page);
    await ticket.getByRole("button", { name: d.discountLine(groom.itemName), exact: true }).click();
    const line = ticket.getByRole("region", { name: d.discountLine(groom.itemName), exact: true });
    await line.getByRole("textbox", { name: d.percentOff, exact: true }).fill("10");
    await line.getByRole("button", { name: d.reasons[1], exact: true }).click();
    await line.getByRole("button", { name: d.applyDiscount, exact: true }).click();
    await discountSale(page, d.amount, "5", d.reasons[1]);
    // $90 and $24 less a $5 sale discount shared by value, GST on both lines and PST on the shampoo
    await ticket.getByRole("button", { name: d.charge("$116.06"), exact: true }).click();
    const payment = paymentPanel(page);
    await payment
        .getByRole("group", { name: d.tip, exact: true })
        .getByRole("button", { name: "15%", exact: true })
        .click();
    await expect(payment.getByText(d.tipOn("$109.00"), { exact: true })).toBeVisible();
    const paid = await payExactCash(page, "$132.41");
    expect(paid).toMatchObject({ amount_cents: 13241, tip_cents: 1635, change_cents: 0 });

    const [order, ...others] = await soldWith(shampoo.id);
    expect(others).toEqual([]);
    expect(order).toMatchObject({
        subtotal_cents: 10900,
        tax_total_cents: 706,
        total_cents: 11606,
        discount_kind: "amount",
        discount_value: 500,
    });
    const lines = await select<Record<string, unknown>>`
        SELECT amount_cents, tax_amount_cents, discount_cents, sale_discount_cents
        FROM lines WHERE order_id = ${order?.id ?? ""} ORDER BY position`;
    expect(lines).toEqual([
        {
            amount_cents: 8605,
            tax_amount_cents: 430,
            discount_cents: 1000,
            sale_discount_cents: 395,
        },
        { amount_cents: 2295, tax_amount_cents: 276, discount_cents: 0, sale_discount_cents: 105 },
    ]);
    // no one is set on the lines, so the untaxed tip goes to whoever rang the sale up
    const tips = await select<{ owner_id: string; amount_cents: number }>`
        SELECT a.owner_id, e.amount_cents FROM entries e JOIN accounts a ON a.id = e.account_id
        WHERE e.event = 'tip' AND e.source_id = ${paid.payment_id} AND a.category = 'payable'`;
    expect(tips).toEqual([{ owner_id: order?.staff_id, amount_cents: -1635 }]);
    await testInfo.attach("discounted-tipped-sale", {
        body: JSON.stringify({ order, lines, tips }),
        contentType: "application/json",
    });
});

test("SALE-E2E-18 front-desk staff take half off a sale with no approval", async ({
    page,
    browser,
    request,
    baseURL,
}) => {
    test.setTimeout(180_000);
    await signIn(page);
    const product = await stockProduct(page, {
        name: "Detangling spray, large",
        prefix: "BB-DS",
        priceCents: 4000,
        taxClass: "exempt",
        stock: 3,
    });
    const desk = await browser.newContext({ baseURL: baseURL ?? "" });
    const staffPage = await desk.newPage();
    const staff = await joinHoursStaff(staffPage, request);
    try {
        await navigate(staffPage, "/payments/sales");
        await addToTicket(staffPage, product.name);
        await discountSale(staffPage, d.percent, "50", d.reasons[3]);
        await saleTicket(staffPage)
            .getByRole("button", { name: d.charge("$20.00"), exact: true })
            .click();
        await expect(staffPage.getByRole("dialog")).toHaveCount(0);
        expect(await payExactCash(staffPage, "$20.00")).toMatchObject({ amount_cents: 2000 });
        expect(await soldWith(product.id)).toEqual([
            expect.objectContaining({
                staff_id: staff.id,
                total_cents: 2000,
                discount_kind: "percent",
                discount_value: 50,
            }),
        ]);
    } finally {
        await staff.cleanup();
        await desk.close();
    }
});

test("SALE-E2E-19 a member's perk takes a whole percent and comes off their product at the desk", async ({
    page,
}) => {
    test.setTimeout(180_000);
    const c = strings.catalog;
    await signIn(page);
    // the seed's one active member is David; no other case sells him anything, and the perk resets
    const membership = demoId("it_daycare");
    try {
        await navigate(page, "/setup/services");
        await page.getByRole("tab", { name: c.views.plans, exact: true }).click();
        await page
            .getByRole("main")
            .getByRole("button")
            .filter({ hasText: "Monthly Daycare" })
            .click({ timeout: 60_000 });
        const editor = page.getByRole("dialog", { name: "Monthly Daycare", exact: true });
        const perk = editor.getByRole("textbox", { name: c.memberPerk, exact: true });
        await perk.fill("12.5");
        await editor.getByRole("button", { name: c.save, exact: true }).click();
        await expect(editor.getByText(c.perkInvalid, { exact: true })).toBeVisible();
        await perk.fill("10");
        await editor.getByRole("button", { name: c.save, exact: true }).click();
        await expect(editor).toBeHidden();
        expect(
            await select`SELECT member_discount_bps FROM items WHERE id = ${membership}`,
        ).toEqual([{ member_discount_bps: 1000 }]);

        const balm = await stockProduct(page, {
            name: "Paw balm, member size",
            prefix: "BB-MB",
            priceCents: 2400,
            taxClass: "standard",
            stock: 2,
        });
        await navigate(page, "/payments/sales");
        await addToTicket(page, balm.name);
        const ticket = saleTicket(page);
        await ticket.getByRole("button").filter({ hasText: d.chooseClient }).click();
        await ticket.getByRole("searchbox", { name: d.clientSearch, exact: true }).fill("David");
        await ticket.getByRole("button").filter({ hasText: "David Okafor" }).click();
        await expect(
            ticket.getByRole("button", { name: d.discountLine(balm.name), exact: true }),
        ).toContainText(MEMBER_DISCOUNT_REASON);
        // $24 less 10% is $21.60, with GST $1.08 and PST $1.51
        await ticket.getByRole("button", { name: d.charge("$24.19"), exact: true }).click();
        await paymentPanel(page)
            .getByRole("group", { name: d.tip, exact: true })
            .getByRole("button", { name: d.tipNone, exact: true })
            .click();
        await payExactCash(page, "$24.19");
        expect(
            await select`
                SELECT amount_cents, discount_kind, discount_value, discount_reason
                FROM lines WHERE item_id = ${balm.id}`,
        ).toEqual([
            {
                amount_cents: 2160,
                discount_kind: "percent",
                discount_value: 10,
                discount_reason: MEMBER_DISCOUNT_REASON,
            },
        ]);
    } finally {
        const reset = await page.request.patch(`${bookingApi()}/v1/items/${membership}`, {
            headers: apiHeaders(page),
            data: { member_discount_bps: null },
        });
        expect(reset.status(), await reset.text()).toBe(200);
    }
});
