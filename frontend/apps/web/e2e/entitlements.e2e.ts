import { randomUUID } from "node:crypto";
import { combineDayAndTime, dateKey, formatTime, strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import { addPet } from "./support/crm";
import {
    entitlementEvidence,
    entitlementFixture,
    expectEntitlementLedger,
    openEntitlement,
    redeemGift,
    sellEntitlement,
} from "./support/entitlements";
import { joinHoursStaff } from "./support/offline";
import { navigate, signIn } from "./support/session";
import { apiCall, visitEvidence } from "./support/visits";
import { runUrl } from "@clientbridge/config/e2e/run";
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
            `${runUrl("VITE_API_URL")}/v1/packages/${pack.id}/consume`,
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

test("ENT-E2E-03 a package for one pet covers that pet's visit at the desk and is refused for its sibling", async ({
    page,
    browser,
    request,
    baseURL,
}, testInfo) => {
    test.setTimeout(240_000);
    const zone = "America/Vancouver";
    const joining = await browser.newContext({ baseURL: baseURL ?? "" });
    // a member with no hours set can take a visit at any time, so both visits start today
    const member = await joinHoursStaff(await joining.newPage(), request);
    try {
        await signIn(page);
        const fixture = await entitlementFixture(page, "package");
        const biscuit = await addPet(page, fixture.client, "Biscuit");
        const juniper = await addPet(page, fixture.client, "Juniper");
        await sellEntitlement(page, fixture.client, "package", fixture.itemId, biscuit);
        const sold = await visitEvidence([fixture.client.id]);
        expect(sold.packages).toEqual([
            {
                id: expect.any(String),
                item_id: fixture.itemId,
                subject_id: biscuit,
                sessions_total: 3,
                status: "active",
                payment_id: sold.payments[0]?.id,
            },
        ]);
        const pack = sold.packages[0];
        if (pack === undefined) throw new Error("The package is missing");
        expectEntitlementLedger(await entitlementEvidence(fixture.client.id), 6001, "deferred", []);
        const service = await apiCall<{ id: string; name: string }>(
            page,
            "POST",
            "/v1/items",
            {
                kind: "service",
                name: `Ear cleaning for ${fixture.client.name}`,
                duration_min: 5,
                price_cents: 2000,
                deposit_type: "none",
                online_bookable: false,
            },
            201,
        );
        const midnight = combineDayAndTime(dateKey(new Date(), zone), "00:00", zone).getTime();
        const wait = midnight + 13 * 60_000 - Date.now();
        if (wait > 0) await page.waitForTimeout(wait);
        const now = Date.now();
        const visits: Record<string, { id: string; starts: Date }> = {};
        for (const [subject, minutesAgo] of [
            [biscuit, 12],
            [juniper, 6],
        ] as const) {
            const starts = new Date(Math.floor((now - minutesAgo * 60_000) / 60_000) * 60_000);
            const booked = await apiCall<{ id: string; status: string }>(
                page,
                "POST",
                "/v1/bookings",
                {
                    client_id: fixture.client.id,
                    subject_id: subject,
                    item_id: service.id,
                    staff_id: member.id,
                    starts_at: starts.toISOString(),
                    notify: false,
                },
                201,
            );
            expect(booked.status).toBe("confirmed");
            visits[subject] = { id: booked.id, starts };
        }
        const mine = visits[biscuit];
        const sibling = visits[juniper];
        if (mine === undefined || sibling === undefined) throw new Error("Visits are missing");

        await navigate(page, "/payments/sales");
        const row = (visit: { starts: Date }) =>
            page
                .getByRole("main")
                .locator("div")
                .filter({ hasText: service.name })
                .filter({ hasText: formatTime(visit.starts, zone) })
                .filter({
                    has: page.getByText(
                        strings.pos.desk.endsAt(
                            formatTime(new Date(visit.starts.getTime() + 5 * 60_000), zone),
                        ),
                        { exact: true },
                    ),
                })
                .last();
        await expect(row(mine)).toBeVisible({ timeout: 60_000 });
        await expect(row(sibling)).toBeVisible();
        await expect(
            row(sibling).getByRole("button", { name: strings.pos.desk.usePackage, exact: true }),
        ).toHaveCount(0);
        const covering = page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === `/v1/packages/${pack.id}/cover` &&
                response.request().method() === "POST",
        );
        await row(mine)
            .getByRole("button", { name: strings.pos.desk.usePackage, exact: true })
            .click();
        const covered = await covering;
        expect(covered.status(), await covered.text()).toBe(200);
        expect(covered.request().postDataJSON()).toEqual({ booking_id: mine.id });
        // a covered visit leaves the queue; its sibling still waits to be rung up
        await expect(row(mine)).toHaveCount(0, { timeout: 60_000 });
        await expect(row(sibling)).toBeVisible();
        await expect(
            page.getByRole("button", { name: strings.pos.desk.usePackage, exact: true }),
        ).toHaveCount(0);
        const used = await visitEvidence([fixture.client.id]);
        const byId = (id: string) => used.bookings.find((booking) => booking.id === id);
        expect(byId(mine.id)).toMatchObject({
            subject_id: biscuit,
            package_id: pack.id,
            status: "completed",
        });
        expect(byId(sibling.id)).toMatchObject({
            subject_id: juniper,
            package_id: null,
            status: "confirmed",
        });
        // a third of CAD60.01, recognized from the deferred balance
        expectEntitlementLedger(
            await entitlementEvidence(fixture.client.id),
            6001,
            "deferred",
            [2000],
        );

        const refused = await page.request.post(
            `${runUrl("VITE_API_URL")}/v1/packages/${pack.id}/cover`,
            {
                headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
                data: { booking_id: sibling.id },
            },
        );
        expect(refused.status(), await refused.text()).toBe(422);
        expect(((await refused.json()) as { error: string }).error).toBe("package_other_subject");
        expect(await visitEvidence([fixture.client.id])).toEqual(used);
        await testInfo.attach("subject-package", {
            body: JSON.stringify(used),
            contentType: "application/json",
        });
    } finally {
        await member.cleanup();
        await joining.close();
    }
});
