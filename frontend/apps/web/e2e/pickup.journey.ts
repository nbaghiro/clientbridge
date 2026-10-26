import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { saleNumber, strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";

import { bookingApi } from "./support/bookings";
import { navigate, signIn } from "./support/session";

const execute = promisify(execFile);
const d = strings.pos.desk;
const p = strings.publicOrder;
const ORDER = "ord_demo_ready";

interface PickupEvidence {
    order: {
        id: string;
        number: number;
        status: string;
        source: string;
        pickup_status: string | null;
        status_token: string;
        preparing: boolean;
        ready: boolean;
        picked_up: boolean;
        client_name: string;
    }[];
    payments: { id: string; kind: string; status: string; amount_cents: number }[];
    movements: { id: string; reason: string; quantity: number }[];
    audits: string[];
}

async function pickupEvidence(orderId: string): Promise<PickupEvidence> {
    const { stdout } = await execute(
        "uv",
        ["run", "python", "-m", "scripts.e2e_pickup_evidence", orderId],
        {
            cwd: fileURLToPath(new URL("../../../../backend", import.meta.url)),
            timeout: 30_000,
        },
    );
    return JSON.parse(stdout) as PickupEvidence;
}

function shopUrl(): string {
    const value = process.env.SHOP_BASE_URL;
    if (!value) throw new Error("SHOP_BASE_URL is unset: run through make test-functional");
    return value;
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
        const current = status.locator('[aria-current="step"]');
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
        await expect(detail.getByRole("button", { name: d.markReady, exact: true })).toHaveCount(0);
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
        expect(after.order[0]).toEqual({ ...order, pickup_status: "picked_up", picked_up: true });
        expect(after.payments).toEqual(before.payments);
        expect(after.movements).toEqual(before.movements);
        expect(after.audits).toEqual([...before.audits, "order.pickup"]);

        await expect(current).toContainText(p.collected, { timeout: 20_000 });
        for (const back of ["preparing", "ready", "picked_up"]) {
            const refused = await page.request.post(`${bookingApi()}/v1/orders/${ORDER}/pickup`, {
                headers: { Origin: new URL(page.url()).origin },
                data: { status: back },
            });
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
