import { formatPhone, strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import { runPort } from "@clientbridge/config/e2e/run";
import { freshPhone, textsSince, textsTo } from "../../../web/e2e/support/auth";
import { createClient } from "../../../web/e2e/support/clients";
import { select } from "../../../web/e2e/support/db";
import { signIn } from "../../../web/e2e/support/session";
import { stripeIntent } from "./support/desk";
import { openGiftCardCharge, press, registerPurchaser } from "./support/disputes";
import { cardFrame, enterStripeCard, stripeReady } from "./support/provider";

const DECLINED_CARD = "4000000000009995";
const GOOD_CARD = "4242424242424242";

interface GiftSale {
    id: string;
    code: string;
    status: string;
    payment_status: string;
    provider_ref: string;
    balance_cents: number;
}

async function giftSales(clientId: string): Promise<GiftSale[]> {
    return select<GiftSale>`
        SELECT g.id, g.code, g.status, p.status AS payment_status, p.provider_ref,
            COALESCE((SELECT -SUM(e.amount_cents) FROM entries e
                JOIN accounts a ON a.id = e.account_id
                WHERE a.owner_type = 'gift_card' AND a.owner_id = g.id
                AND a.category = 'gift_card'), 0)::int AS balance_cents
        FROM gift_cards g JOIN payments p ON p.id = g.payment_id
        WHERE g.purchaser_client_id = ${clientId} ORDER BY g.created_at`;
}

test("ENT-E2E-05 a gift card sold by card stays pending until Stripe settles it, a canceled card step voids it, and a declined card can be retried", async ({
    browser,
}, info) => {
    test.setTimeout(300_000);
    await stripeReady();
    const context = await browser.newContext({
        baseURL: `http://localhost:${String(runPort("WEB_E2E_PORT"))}`,
    });
    try {
        const owner = await context.newPage();
        await signIn(owner);
        const client = await createClient(owner);
        await registerPurchaser(client.id);
        const recipient = freshPhone();

        const walkedAway = await openGiftCardCharge(owner, client, 6000);
        await cardFrame(owner);
        const canceled = owner.waitForResponse(
            (r) =>
                /\/v1\/payments\/[^/]+\/cancel$/.test(r.url()) && r.request().method() === "POST",
        );
        await walkedAway.getByRole("button", { name: strings.common.cancel, exact: true }).click();
        expect((await canceled).status()).toBe(200);
        const [abandoned] = await giftSales(client.id);
        expect(abandoned).toMatchObject({ status: "void", payment_status: "canceled" });
        if (abandoned === undefined) throw new Error("the walked-away sale is missing");
        expect((await stripeIntent(abandoned.provider_ref)).status).toBe("canceled");
        await walkedAway.getByRole("button", { name: strings.common.cancel, exact: true }).click();

        const dialog = await openGiftCardCharge(owner, client, 6000, formatPhone(recipient));
        const form = await cardFrame(owner);
        const declinedAt = Date.now();
        await enterStripeCard(form, DECLINED_CARD);
        const charge = dialog.getByRole("button", {
            name: strings.checkout.charge("$60.00"),
            exact: true,
        });
        await press(charge);
        await expect(dialog.getByRole("alert")).toBeVisible({ timeout: 60_000 });
        await expect
            .poll(async () => (await giftSales(client.id))[1]?.payment_status, { timeout: 90_000 })
            .toBe("failed");
        expect((await giftSales(client.id))[1]?.status).toBe("pending");

        await enterStripeCard(form, GOOD_CARD);
        await press(charge);
        await expect(dialog.getByText(strings.entitlements.doneTitle, { exact: true })).toBeVisible(
            { timeout: 90_000 },
        );
        await expect
            .poll(async () => (await giftSales(client.id))[1]?.status, { timeout: 120_000 })
            .toBe("active");
        const [, sold] = await giftSales(client.id);
        expect(sold).toMatchObject({ payment_status: "succeeded", balance_cents: 6000 });
        if (sold === undefined) throw new Error("the sold gift card is missing");
        expect((await stripeIntent(sold.provider_ref)).status).toBe("succeeded");
        await expect
            .poll(async () => (await textsTo(owner.request, recipient)).map((t) => t.Snippet), {
                timeout: 60_000,
            })
            .toEqual([expect.stringContaining(sold.code)]);
        // the client was at the desk for the decline, so nobody texted them to try again
        expect(await textsSince(owner.request, client.phone, declinedAt)).toEqual([]);
        await info.attach("ent-e2e-05", {
            body: JSON.stringify(await giftSales(client.id), null, 2),
            contentType: "application/json",
        });
    } finally {
        await context.close();
    }
});
