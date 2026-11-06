import { randomUUID } from "node:crypto";
import {
    combineDayAndTime,
    dateKey,
    formatMoney,
    formatParts,
    formatTime,
    strings,
} from "@clientbridge/app-core/public";
import { expect, type Locator, test } from "@playwright/test";
import { addPet } from "./support/clients";
import { select } from "./support/db";
import {
    entitlementEvidence,
    entitlementFixture,
    expectEntitlementLedger,
    openEntitlement,
    openPlanEditor,
    redeemGift,
    sellEntitlement,
} from "./support/entitlements";
import { joinHoursStaff } from "./support/hours";
import { navigate, signIn } from "./support/session";
import { apiCall, visitEvidence } from "./support/visit";
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

test("ENT-E2E-04 a package, a membership and a gift card are set up in the item editor and sell only through their own checkouts", async ({
    page,
}, testInfo) => {
    const c = strings.catalog;
    const d = strings.pos.desk;
    await signIn(page);
    const tag = randomUUID().slice(0, 8);
    const service = await apiCall<{ id: string; name: string }>(
        page,
        "POST",
        "/v1/items",
        {
            kind: "service",
            name: `Plan groom ${tag}`,
            duration_min: 60,
            price_cents: 5000,
            deposit_type: "none",
            online_bookable: false,
        },
        201,
    );
    // archived afterwards, newest first, so later runs don't see this run's items
    const archive = [service.id];
    try {
        const names = {
            package: `Five grooms ${tag}`,
            subscription: `Groom club ${tag}`,
            gift: `Gift card ${tag}`,
        };
        const save = async (editor: Locator): Promise<string> => {
            const created = page.waitForResponse(
                (r) => new URL(r.url()).pathname === "/v1/items" && r.request().method() === "POST",
            );
            await editor.getByRole("button", { name: c.add, exact: true }).click();
            const response = await created;
            expect(response.status(), await response.text()).toBe(201);
            await expect(editor).toBeHidden();
            const { id } = (await response.json()) as { id: string };
            archive.unshift(id);
            return id;
        };
        const chooseService = async (editor: Locator, label: string): Promise<void> => {
            await editor.getByRole("combobox", { name: label, exact: true }).click();
            await page
                .locator(`[role="option"][data-value="${service.id}"]`)
                .click({ timeout: 60_000 });
        };
        const field = (editor: Locator, label: string): Locator =>
            editor.getByRole("textbox", { name: label, exact: true });

        await navigate(page, "/setup/services");
        await page.getByRole("tab", { name: c.views.plans, exact: true }).click();

        const pack = await openPlanEditor(page, "package");
        await expect(pack).toContainText(c.subjectRule("pet"));
        await field(pack, c.name).fill(names.package);
        await chooseService(pack, c.covers);
        await field(pack, c.visitsLabel).fill("5");
        await expect(
            pack.getByText(c.planSummaryPackage(5, service.name), { exact: true }),
        ).toBeVisible();
        // a package without a price shows as free
        await expect(pack).toContainText(c.planFree);
        await field(pack, c.price).fill("200");
        await field(pack, c.validForDays).fill("365");
        await expect(pack).toContainText(
            formatParts([
                c.perVisit(formatMoney(4000, "CAD")),
                c.saves(formatMoney(5000, "CAD"), 5, service.name),
            ]),
        );
        await expect(pack).not.toContainText(c.planFree);
        const packageId = await save(pack);

        const club = await openPlanEditor(page, "subscription");
        await field(club, c.name).fill(names.subscription);
        await field(club, c.price).fill("89");
        await chooseService(club, c.membershipCovers);
        await field(club, c.includes).fill("1");
        await field(club, c.memberPerk).fill("10");
        await expect(club).toContainText(c.memberPerkHint);
        // nobody holds a new membership yet, so there is no price to keep
        await expect(club).not.toContainText(c.membersKeepPrice);
        const membershipId = await save(club);
        await page.getByRole("main").getByText(names.subscription, { exact: true }).click();
        const reopened = page.getByRole("dialog", { name: names.subscription, exact: true });
        await expect(reopened).toContainText(c.membersKeepPrice);
        await expect(field(reopened, c.memberPerk)).toHaveValue("10");
        await page.keyboard.press("Escape");
        await expect(reopened).toBeHidden();

        const gift = await openPlanEditor(page, "gift");
        await field(gift, c.name).fill(names.gift);
        const amounts = gift.getByRole("group", { name: c.giftAmounts, exact: true });
        for (const cents of [15000, 20000])
            await amounts.locator(`button[data-value="${String(cents)}"]`).click();
        const giftId = await save(gift);

        const saved = await select<Record<string, unknown>>`
            SELECT kind, price_cents, session_count, validity_days, covers_item_id, frequency,
                   interval, visits_per_period, member_discount_bps, gift_amounts
            FROM items WHERE id IN (${packageId}, ${membershipId}, ${giftId}) ORDER BY kind`;
        expect(saved).toEqual([
            expect.objectContaining({ kind: "gift", gift_amounts: [15000, 20000] }),
            expect.objectContaining({
                kind: "package",
                price_cents: 20000,
                session_count: 5,
                validity_days: 365,
                covers_item_id: service.id,
            }),
            expect.objectContaining({
                kind: "subscription",
                price_cents: 8900,
                frequency: "month",
                interval: 1,
                covers_item_id: service.id,
                visits_per_period: 1,
                member_discount_bps: 1000,
            }),
        ]);

        await navigate(page, "/payments/sales");
        const main = page.getByRole("main");
        await main
            .getByRole("group", { name: d.addExtras, exact: true })
            .getByRole("button", { name: new RegExp(`^${d.catAll}`) })
            .click({ timeout: 60_000 });
        await main.getByRole("searchbox").fill(tag);
        // the run's service shows as a tile; none of its plans do
        await expect(main.getByRole("button", { name: new RegExp(service.name) })).toBeVisible({
            timeout: 60_000,
        });
        for (const name of Object.values(names)) await expect(main.getByText(name)).toHaveCount(0);
        for (const [label, id] of [
            [d.sellPackage, packageId],
            [d.sellMembership, membershipId],
        ] as const) {
            await main.getByRole("button", { name: label, exact: true }).click();
            const sheet = page.getByRole("dialog");
            await expect(
                sheet
                    .getByRole("group", { name: w.chooseItem, exact: true })
                    .locator(`button[data-value="${id}"]`),
            ).toBeVisible();
            await page.keyboard.press("Escape");
            await expect(sheet).toBeHidden();
        }
        await main.getByRole("button", { name: d.sellGiftCard, exact: true }).click();
        const giftSale = page.getByRole("dialog");
        await giftSale
            .getByRole("group", { name: w.chooseItem, exact: true })
            .locator(`button[data-value="${giftId}"]`)
            .click();
        const presets = giftSale.getByRole("group", { name: w.giftAmount, exact: true });
        for (const dollars of ["150", "200"])
            await expect(presets.locator(`button[data-value="${dollars}"]`)).toBeVisible();
        for (const dollars of ["25", "50"])
            await expect(presets.locator(`button[data-value="${dollars}"]`)).toHaveCount(0);
        // $50 isn't among the item's suggestions, so the sale starts at the first one
        await expect(
            giftSale.getByRole("textbox", { name: w.giftAmount, exact: true }),
        ).toHaveValue("150");
        await expect(presets.locator('button[data-value="150"]')).toHaveAttribute(
            "aria-pressed",
            "true",
        );
        await page.keyboard.press("Escape");

        // the API refuses each as a plain sale line too
        for (const id of [packageId, membershipId, giftId]) {
            const refused = await page.request.post(`${runUrl("VITE_API_URL")}/v1/orders`, {
                headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
                data: {
                    lines: [{ description: id, item_id: id, quantity: 1, unit_amount_cents: 5000 }],
                },
            });
            expect(refused.status(), await refused.text()).toBe(422);
            expect(((await refused.json()) as { error: string }).error).toBe("unprocessable");
        }
        await testInfo.attach("plan-items", {
            body: JSON.stringify(saved),
            contentType: "application/json",
        });
    } finally {
        for (const id of archive)
            await apiCall(page, "PATCH", `/v1/items/${id}`, { active: false }, 200);
    }
});
