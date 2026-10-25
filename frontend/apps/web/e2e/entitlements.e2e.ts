import { randomUUID } from "node:crypto";
import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import {
    entitlementEvidence,
    entitlementFixture,
    expectEntitlementLedger,
    openEntitlement,
    redeemGift,
    sellEntitlement,
} from "./support/entitlements";
import { signIn } from "./support/session";
const w = strings.entitlements;

test("ENT-E2E-01 cash gift card partial redemption rejects overspend and exhausts exactly", async ({
    page,
    browser,
}, testInfo) => {
    await signIn(page);
    const fixture = await entitlementFixture(page, "gift_card");
    await sellEntitlement(page, fixture.client, "gift_card", fixture.itemId);
    const issued = await entitlementEvidence(fixture.client.id);
    expect(issued.packages).toEqual([]);
    expect(issued.gifts).toEqual([
        {
            id: expect.any(String),
            code: expect.any(String),
            initial_cents: 5000,
            status: "active",
            payment_id: issued.payments[0]?.id,
        },
    ]);
    expectEntitlementLedger(issued, 5000, "gift_card", []);
    const gift = issued.gifts[0];
    if (gift === undefined) throw new Error("Issued gift missing");
    await redeemGift(page, gift.code, "20");
    const partial = await entitlementEvidence(fixture.client.id);
    expectEntitlementLedger(partial, 5000, "gift_card", [2000]);
    await redeemGift(page, gift.code, "30.01", 409);
    expect(await entitlementEvidence(fixture.client.id)).toEqual(partial);
    const observer = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        viewport: { width: 1440, height: 900 },
    });
    try {
        const other = await observer.newPage();
        await signIn(other);
        await openEntitlement(other, fixture.client.name, gift.id);
        await expect(other.getByRole("dialog")).toContainText("$30.00", { timeout: 60_000 });
        await expect(other.getByRole("dialog")).toContainText(gift.code);
        await other.reload();
        await openEntitlement(other, fixture.client.name, gift.id);
        await expect(other.getByRole("dialog")).toContainText("$30.00", { timeout: 60_000 });
        await redeemGift(page, gift.code, "30");
        await expect(other.getByRole("dialog")).toContainText(w.statusLabel.redeemed, {
            timeout: 60_000,
        });
        const exhausted = await entitlementEvidence(fixture.client.id);
        // Stored status remains active; zero liability projects as redeemed.
        expect(exhausted.gifts).toEqual(issued.gifts);
        expectEntitlementLedger(exhausted, 5000, "gift_card", [2000, 3000]);
        await redeemGift(page, gift.code, "0.01", 409);
        expect(await entitlementEvidence(fixture.client.id)).toEqual(exhausted);
        await page.reload();
        await openEntitlement(page, fixture.client.name, gift.id);
        await expect(page.getByRole("dialog")).toContainText(w.statusLabel.redeemed, {
            timeout: 60_000,
        });
        await testInfo.attach("gift-card-ledger", {
            body: JSON.stringify(exhausted),
            contentType: "application/json",
        });
    } finally {
        await observer.close();
    }
});

test("ENT-E2E-02 cash package confirmation cancellation preserves sessions and final use recognizes rounding remainder", async ({
    page,
    browser,
}, testInfo) => {
    await signIn(page);
    const fixture = await entitlementFixture(page, "package");
    await sellEntitlement(page, fixture.client, "package", fixture.itemId);
    const issued = await entitlementEvidence(fixture.client.id);
    expect(issued.gifts).toEqual([]);
    expect(issued.packages).toEqual([
        {
            id: expect.any(String),
            item_id: fixture.itemId,
            sessions_total: 3,
            status: "active",
            payment_id: issued.payments[0]?.id,
        },
    ]);
    expectEntitlementLedger(issued, 6001, "deferred", []);
    const pack = issued.packages[0];
    if (pack === undefined) throw new Error("Purchased package missing");
    await openEntitlement(page, fixture.client.name, pack.id);
    await page.getByRole("button", { name: w.action.use, exact: true }).click();
    const review = page.getByRole("dialog").last();
    await expect(
        review.getByRole("heading", { name: w.review.useTitle, exact: true }),
    ).toBeVisible();
    await review.getByRole("button", { name: strings.common.cancel, exact: true }).click();
    expect(await entitlementEvidence(fixture.client.id)).toEqual(issued);
    const observer = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        viewport: { width: 1440, height: 900 },
    });
    try {
        const other = await observer.newPage();
        await signIn(other);
        await openEntitlement(other, fixture.client.name, pack.id);
        const shares: number[] = [];
        for (const [index, share] of [2000, 2000, 2001].entries()) {
            await page.getByRole("button", { name: w.action.use, exact: true }).click();
            const pending = page.waitForResponse(
                (r) =>
                    r.url().endsWith(`/v1/packages/${pack.id}/consume`) &&
                    r.request().method() === "POST",
            );
            await page
                .getByRole("dialog")
                .last()
                .getByRole("button", { name: w.action.use, exact: true })
                .click();
            const response = await pending;
            expect(response.status(), await response.text()).toBe(200);
            expect(await response.json()).toMatchObject({
                sessions_total: 3,
                sessions_used: index + 1,
                status: index === 2 ? "used" : "active",
            });
            shares.push(share);
            expectEntitlementLedger(
                await entitlementEvidence(fixture.client.id),
                6001,
                "deferred",
                shares,
            );
            await expect(other.getByRole("dialog")).toContainText(w.sessionsLeft(2 - index, 3), {
                timeout: 60_000,
            });
            if (index < 2)
                await expect(page.getByRole("dialog")).toContainText(w.sessionsLeft(2 - index, 3), {
                    timeout: 60_000,
                });
        }
        await expect(page.getByRole("button", { name: w.action.use, exact: true })).toHaveCount(0);
        await expect(other.getByRole("dialog")).toContainText(w.statusLabel.used);
        const exhausted = await entitlementEvidence(fixture.client.id);
        expect(exhausted.packages[0]?.status).toBe("used");
        // API edge supplements the absent UI action after three real UI uses.
        const rejected = await page.request.post(
            `${process.env.VITE_API_URL ?? "http://localhost:8701"}/v1/packages/${pack.id}/consume`,
            {
                headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
            },
        );
        expect(rejected.status(), await rejected.text()).toBe(409);
        expect(await entitlementEvidence(fixture.client.id)).toEqual(exhausted);
        await other.reload();
        await openEntitlement(other, fixture.client.name, pack.id);
        await expect(other.getByRole("dialog")).toContainText(w.statusLabel.used, {
            timeout: 60_000,
        });
        await expect(other.getByRole("button", { name: w.action.use, exact: true })).toHaveCount(0);
        await page.reload();
        await openEntitlement(page, fixture.client.name, pack.id);
        await expect(page.getByRole("dialog")).toContainText(w.statusLabel.used, {
            timeout: 60_000,
        });
        await testInfo.attach("package-ledger", {
            body: JSON.stringify(exhausted),
            contentType: "application/json",
        });
    } finally {
        await observer.close();
    }
});
