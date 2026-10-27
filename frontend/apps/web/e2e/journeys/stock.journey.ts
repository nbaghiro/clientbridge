import { randomUUID } from "node:crypto";
import { formatMoney, strings, saleNumber } from "@clientbridge/app-core/public";
import { demoPerson } from "@clientbridge/config/e2e/demo";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { freshPhone } from "../support/auth";
import { createClient, type ClientFixture } from "../support/clients";
import { requireLocalMail } from "../support/evidence";
import { openRefund } from "../support/refunds";
import { ringUpCash, saleEvidence, type SaleEvidence, pickupEvidence } from "../support/pos";
import { customerContext, signIn, navigate } from "../support/session";
import { apiCall, shopUrl, visitEvidence } from "../support/visit";
import { demoSlug, demoId, runUrl } from "@clientbridge/config/e2e/run";
import { bookingApi } from "../support/bookings";

test.describe(() => {
    test.use({ actionTimeout: 15_000 });

    const shop = strings.publicShop;
    const money = (cents: number): string => formatMoney(cents, "CAD");

    interface Product {
        id: string;
        name: string;
        sku: string;
    }

    // $25 a unit with 5% GST and 7% PST, so one unit is $28 at the desk
    async function stockedProduct(page: Page, name: string, units: number): Promise<Product> {
        requireLocalMail();
        const sku = `BB-${randomUUID().slice(0, 6).toUpperCase()}`;
        const item = await apiCall<{ id: string }>(
            page,
            "POST",
            "/v1/items",
            {
                kind: "product",
                name,
                sku,
                price_cents: 2500,
                tax_class: "standard",
                track_stock: true,
                sell_online: true,
                active: true,
            },
            201,
        );
        expect(
            await apiCall(
                page,
                "POST",
                `/v1/items/${item.id}/restock`,
                { quantity: units, note: "Shelf count" },
                200,
            ),
        ).toMatchObject({ id: item.id, stock_on_hand: units });
        return { id: item.id, name, sku };
    }

    async function sellAtDesk(
        page: Page,
        client: ClientFixture,
        product: Product,
        stock: number,
        units: number,
    ): Promise<string> {
        const total = money(2800 * units);
        const payment = await ringUpCash(page, client, {
            ...product,
            stock,
            units,
            charge: total,
            given: (28 * units).toFixed(2),
        });
        const paying = page.waitForResponse(
            (response) =>
                /\/v1\/orders\/[^/]+\/cash$/.test(response.url()) &&
                response.request().method() === "POST",
        );
        await payment
            .getByRole("button", { name: strings.pos.desk.charge(total), exact: true })
            .click();
        const paid = await paying;
        expect(paid.status(), await paid.text()).toBe(200);
        const body = (await paid.json()) as { payment_id: string; amount_cents: number };
        expect(body.amount_cents).toBe(2800 * units);
        await expect(
            page.getByRole("heading", { name: strings.pos.desk.paidTitle, exact: true }),
        ).toBeVisible();
        return body.payment_id;
    }

    async function refundAtDesk(
        page: Page,
        client: ClientFixture,
        paymentId: string,
        cents: number,
        part: boolean,
    ): Promise<void> {
        const s = strings.refunds;
        const panel = await openRefund(page, { client, paymentId });
        if (part) {
            await panel.getByRole("button", { name: s.part, exact: true }).click();
            await panel
                .getByRole("textbox", { name: s.amount, exact: true })
                .fill((cents / 100).toFixed(2));
        }
        await panel.getByRole("switch", { name: s.notify, exact: true }).uncheck();
        const label = s.refundButton(money(cents));
        await panel.getByRole("button", { name: label, exact: true }).click();
        const refunding = page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === `/v1/payments/${paymentId}/refund` &&
                response.request().method() === "POST",
        );
        await page
            .getByRole("dialog", { name: s.confirmTitle(money(cents)), exact: true })
            .getByRole("button", { name: label, exact: true })
            .click();
        const refund = await refunding;
        expect(refund.status(), await refund.text()).toBe(200);
        expect(await refund.json()).toMatchObject({ status: "succeeded" });
    }

    function card(page: Page, product: Product): Locator {
        return page.getByRole("group", { name: product.name, exact: true });
    }

    function sums(evidence: SaleEvidence): Record<string, number> {
        const totals: Record<string, number> = {};
        for (const entry of evidence.entries) {
            const key = entry.code === "" ? entry.category : `${entry.category}:${entry.code}`;
            totals[key] = (totals[key] ?? 0) + entry.amount_cents;
        }
        return totals;
    }

    function legsOf(evidence: SaleEvidence, sourceId: string | undefined) {
        return evidence.entries
            .filter((entry) => entry.source_id === sourceId)
            .map((entry) => [entry.category, entry.code, entry.amount_cents])
            .sort(
                (a, b) =>
                    String(a[0]).localeCompare(String(b[0])) ||
                    String(a[1]).localeCompare(String(b[1])),
            );
    }

    // an account without a sub-code holds "", the column's non-null default
    const oneUnit = [
        ["cash", "", 2800],
        ["revenue", "", -2500],
        ["tax", "GST", -125],
        ["tax", "PST", -175],
    ];

    test("FLOW-03-A an online shopper loses the last unit to a desk sale and sees it again once the sale is refunded", async ({
        page,
        browser,
    }, testInfo) => {
        test.setTimeout(240_000);
        await signIn(page);
        const product = await stockedProduct(page, "Cedar Paw Balm", 1);
        const walkIn = await createClient(page);
        const online = {
            name: demoPerson(randomUUID()),
            phone: freshPhone(),
        };
        const context = await customerContext(browser);
        try {
            const shopper = await context.newPage();
            await shopper.goto(shopUrl(demoSlug("birchbark")));
            const offered = card(shopper, product);
            await expect(offered.getByText(shop.lowStock(1), { exact: true })).toBeVisible();
            await offered.getByRole("button", { name: shop.addNamed(product.name) }).click();
            const summary = shopper.locator("aside");
            await expect(summary.getByText(money(2500)).first()).toBeVisible();
            await summary.getByRole("button", { name: shop.checkout, exact: true }).click();
            await expect(shopper.getByRole("heading", { name: shop.sectionPickup })).toBeVisible();
            await summary.getByRole("button", { name: shop.continue, exact: true }).click();
            await shopper.getByLabel(shop.name, { exact: true }).fill(online.name);
            await shopper.getByLabel(shop.phone, { exact: false }).fill(online.phone);

            const paymentId = await sellAtDesk(page, walkIn, product, 1, 1);
            const sold = await saleEvidence(product.id);
            expect(sold.item).toEqual({ id: product.id, stock_on_hand: 0, track_stock: true });
            expect(sold.orders).toEqual([
                expect.objectContaining({
                    client_id: walkIn.id,
                    source: "pos",
                    total_cents: 2800,
                    paid: true,
                }),
            ]);
            expect(legsOf(sold, paymentId)).toEqual(oneUnit);

            const placing = shopper.waitForResponse(
                (response) =>
                    new URL(response.url()).pathname ===
                        `/book/${demoSlug("birchbark")}/shop/orders` &&
                    response.request().method() === "POST",
            );
            await summary.getByRole("button", { name: shop.continuePay, exact: true }).click();
            const refused = await placing;
            expect(refused.status(), await refused.text()).toBe(409);
            expect(await refused.json()).toMatchObject({ error: "out_of_stock" });
            expect(refused.request().postDataJSON()).toMatchObject({
                lines: [{ item_id: product.id, quantity: 1 }],
            });
            await expect(
                shopper.getByRole("alert").getByText(strings.api.outOfStock, { exact: true }),
            ).toBeVisible();
            await expect(shopper.getByText(shop.payBody(money(2800)), { exact: true })).toHaveCount(
                0,
            );
            expect(await saleEvidence(product.id)).toEqual(sold);
            expect((await visitEvidence([online.phone])).clients).toEqual([]);

            // the session keeps the cart, so the refused line stays in it while the unit is gone
            await shopper.goto(shopUrl(demoSlug("birchbark")));
            const kept = card(shopper, product);
            await expect(kept.getByText(shop.soldOut, { exact: true })).toBeVisible();
            await expect(
                kept.getByRole("button", { name: strings.common.increase(product.name) }),
            ).toBeDisabled();
            await expect(
                kept.getByRole("button", { name: shop.addNamed(product.name) }),
            ).toHaveCount(0);

            await refundAtDesk(page, walkIn, paymentId, 2800, false);
            const restored = await saleEvidence(product.id);
            expect(restored.item).toEqual({ id: product.id, stock_on_hand: 1, track_stock: true });
            expect(restored.movements.map((m) => [m.reason, m.quantity])).toEqual([
                ["restock", 1],
                ["sale", -1],
                ["refund", 1],
            ]);
            const refund = restored.payments.find((row) => row.kind === "refund");
            expect(refund).toMatchObject({
                amount_cents: 2800,
                method: "cash",
                status: "succeeded",
            });
            expect(legsOf(restored, refund?.id)).toEqual(
                oneUnit.map(([category, code, cents]) => [category, code, -Number(cents)]),
            );
            expect(sums(restored)).toEqual({ cash: 0, revenue: 0, "tax:GST": 0, "tax:PST": 0 });

            await shopper.reload();
            const back = card(shopper, product);
            await expect(back.getByText(shop.lowStock(1), { exact: true })).toBeVisible();
            await expect(back.getByText(shop.soldOut, { exact: true })).toHaveCount(0);
            await expect(
                back.getByRole("button", { name: strings.common.decrease(product.name) }),
            ).toBeEnabled();
            await expect(summary.getByText(money(2500)).first()).toBeVisible();
            await testInfo.attach("last-unit", {
                body: JSON.stringify(restored),
                contentType: "application/json",
            });
        } finally {
            await context.close();
        }
    });

    test("FLOW-03-B a part refund leaves the units sold, and refunding the rest returns both to the shop", async ({
        page,
        browser,
    }, testInfo) => {
        test.setTimeout(240_000);
        await signIn(page);
        const product = await stockedProduct(page, "Lavender Coat Spray", 2);
        const client = await createClient(page);
        const paymentId = await sellAtDesk(page, client, product, 2, 2);
        const sold = await saleEvidence(product.id);
        expect(sold.item.stock_on_hand).toBe(0);
        expect(sold.lines).toEqual([
            expect.objectContaining({ quantity: 2, unit_amount_cents: 2500, amount_cents: 5000 }),
        ]);
        expect(legsOf(sold, paymentId)).toEqual(
            oneUnit.map(([category, code, cents]) => [category, code, 2 * Number(cents)]),
        );
        const context = await customerContext(browser);
        try {
            const shopper = await context.newPage();
            await shopper.goto(shopUrl(demoSlug("birchbark")));
            await expect(
                card(shopper, product).getByText(shop.soldOut, { exact: true }),
            ).toBeVisible();

            await refundAtDesk(page, client, paymentId, 2800, true);
            const part = await saleEvidence(product.id);
            expect(part.item.stock_on_hand).toBe(0);
            expect(part.movements.map((m) => [m.reason, m.quantity])).toEqual([
                ["restock", 2],
                ["sale", -2],
            ]);
            const first = part.payments.filter((row) => row.kind === "refund");
            expect(first).toEqual([
                expect.objectContaining({ amount_cents: 2800, status: "succeeded" }),
            ]);
            // half of the $56 sale comes back as one unit's price and taxes
            expect(legsOf(part, first[0]?.id)).toEqual(
                oneUnit.map(([category, code, cents]) => [category, code, -Number(cents)]),
            );
            await expect(
                (await openRefund(page, { client, paymentId }))
                    .getByText(strings.refunds.statusLabel.partly_refunded, { exact: true })
                    .first(),
            ).toBeVisible();
            await shopper.reload();
            await expect(
                card(shopper, product).getByText(shop.soldOut, { exact: true }),
            ).toBeVisible();

            await refundAtDesk(page, client, paymentId, 2800, false);
            const whole = await saleEvidence(product.id);
            expect(whole.item.stock_on_hand).toBe(2);
            expect(whole.movements.map((m) => [m.reason, m.quantity])).toEqual([
                ["restock", 2],
                ["sale", -2],
                ["refund", 2],
            ]);
            expect(whole.payments.filter((row) => row.kind === "refund")).toHaveLength(2);
            expect(sums(whole)).toEqual({ cash: 0, revenue: 0, "tax:GST": 0, "tax:PST": 0 });
            for (const journal of new Set(whole.entries.map((entry) => entry.journal_id)))
                expect(
                    whole.entries
                        .filter((entry) => entry.journal_id === journal)
                        .reduce((sum, entry) => sum + entry.amount_cents, 0),
                ).toBe(0);
            await shopper.reload();
            await expect(
                card(shopper, product).getByText(shop.lowStock(2), { exact: true }),
            ).toBeVisible();
            await testInfo.attach("partial-then-full-refund", {
                body: JSON.stringify(whole),
                contentType: "application/json",
            });
        } finally {
            await context.close();
        }
    });
});

test.describe(() => {
    const d = strings.pos.desk;
    const p = strings.publicOrder;
    const ORDER = demoId("ord_demo_ready");

    function shopUrl(): string {
        return runUrl("SHOP_BASE_URL");
    }

    test("SALE-E2E-12 a ready online order marked picked up reaches the customer's open page and cannot move back", async ({
        page,
        browser,
    }, testInfo) => {
        test.setTimeout(180_000);
        const before = await pickupEvidence(ORDER);
        const order = before.order[0];
        if (order === undefined) throw new Error("the seeded ready pickup order is missing");
        expect(order).toMatchObject({
            source: "online",
            pickup_status: "ready",
            preparing: true,
            ready: true,
            picked_up: false,
        });
        const customer = await browser.newContext();
        try {
            const status = await customer.newPage();
            await status.goto(`${shopUrl()}/order/${order.status_token}`);
            // the page draws the steps once per screen size and hides the other with CSS
            const current = status.locator('[aria-current="step"]').filter({ visible: true });
            await expect(current).toContainText(p.ready, { timeout: 30_000 });

            await signIn(page);
            await navigate(page, "/payments/sales?view=history");
            await page
                .getByRole("searchbox", { name: d.historySearch, exact: true })
                .fill(order.client_name);
            await page
                .getByRole("button", {
                    name: strings.common.labelValue(saleNumber(order.number), order.client_name),
                    exact: true,
                })
                .click({ timeout: 60_000 });
            const detail = page.getByRole("dialog");
            await expect(
                detail.getByRole("button", { name: d.markReady, exact: true }),
            ).toHaveCount(0);
            const marking = page.waitForResponse(
                (r) =>
                    new URL(r.url()).pathname === `/v1/orders/${ORDER}/pickup` &&
                    r.request().method() === "POST",
            );
            await detail.getByRole("button", { name: d.markPickedUp, exact: true }).click();
            const marked = await marking;
            expect(marked.status(), await marked.text()).toBe(200);
            expect(marked.request().postDataJSON()).toEqual({ status: "picked_up" });
            await expect(
                page.getByText(d.markedPickedUp(order.client_name), { exact: true }),
            ).toBeVisible();
            const after = await pickupEvidence(ORDER);
            expect(after.order[0]).toEqual({
                ...order,
                pickup_status: "picked_up",
                picked_up: true,
            });
            expect(after.payments).toEqual(before.payments);
            expect(after.movements).toEqual(before.movements);
            expect(after.audits).toEqual([...before.audits, "order.pickup"]);

            await expect(current).toContainText(p.collected, { timeout: 20_000 });
            for (const back of ["preparing", "ready", "picked_up"]) {
                const refused = await page.request.post(
                    `${bookingApi()}/v1/orders/${ORDER}/pickup`,
                    {
                        headers: { Origin: new URL(page.url()).origin },
                        data: { status: back },
                    },
                );
                expect(refused.status(), back).toBe(409);
            }
            expect(await pickupEvidence(ORDER)).toEqual(after);
            await status.reload();
            await expect(current).toContainText(p.collected);
            await page.reload();
            await page
                .getByRole("searchbox", { name: d.historySearch, exact: true })
                .fill(order.client_name);
            await page
                .getByRole("button", {
                    name: strings.common.labelValue(saleNumber(order.number), order.client_name),
                    exact: true,
                })
                .click({ timeout: 60_000 });
            await expect(
                page.getByRole("dialog").getByRole("button", { name: d.markPickedUp, exact: true }),
            ).toHaveCount(0);
            await testInfo.attach("picked-up-order", {
                body: JSON.stringify(after),
                contentType: "application/json",
            });
        } finally {
            await customer.close();
        }
    });
});
