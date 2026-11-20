import { expect, test, type Page } from "@playwright/test";
import {
    combineDayAndTime,
    dateKey,
    formatDate,
    formatMoney,
    formatTime,
    strings,
} from "@clientbridge/app-core/public";
import { runPort } from "@clientbridge/config/e2e/run";
import { createClient, openWallet, type ClientFixture } from "../../../web/e2e/support/clients";
import { patchBusiness } from "../../../web/e2e/support/business";
import { select } from "../../../web/e2e/support/db";
import { joinHoursStaff } from "../../../web/e2e/support/hours";
import { lapsedNotice } from "../../../web/e2e/support/plans";
import { navigate, signIn } from "../../../web/e2e/support/session";
import { apiCall } from "../../../web/e2e/support/visit";
import { categoryTotals, clientMoney, press, registerPurchaser } from "./support/disputes";
import {
    DAY,
    advanceClock,
    dailyMembership,
    declineRenewals,
    membershipEvidence,
    membershipLine,
    membershipRows,
    pastDueNotices,
    refusedMembershipUi,
    saveCardUi,
    setPlan,
    startMembershipUi,
    type MembershipEvidence,
} from "./support/memberships";

const ZONE = "America/Vancouver";

function paid(evidence: MembershipEvidence) {
    return evidence.invoices.filter((invoice) => invoice.status === "paid");
}

function failed(evidence: MembershipEvidence) {
    return evidence.invoices.filter((invoice) => invoice.status === "open");
}

test("STR-E07 a daily membership renews on a test clock, sends one notice per failed renewal and can be canceled while the plan is lapsed", async ({
    browser,
}, info) => {
    test.setTimeout(900_000);
    const owner = await (
        await browser.newContext({
            baseURL: `http://localhost:${String(runPort("WEB_E2E_PORT"))}`,
        })
    ).newPage();
    let restore: string | null = null;
    try {
        await signIn(owner);
        const client = await createClient(owner);
        await registerPurchaser(client.id, true);
        const item = await dailyMembership(owner, client);
        await saveCardUi(owner, client);
        await startMembershipUi(owner, client, item);
        await expect
            .poll(async () => (await clientMoney(client.id)).payments.length, { timeout: 120_000 })
            .toBe(1);
        const [membership] = await membershipRows(client.id);
        if (!membership?.provider_ref) throw new Error("the membership was not recorded");
        expect(membership.status).toBe("active");
        const started = await membershipEvidence(client.id);
        expect(started.subscriptions).toEqual([{ id: membership.provider_ref, status: "active" }]);
        expect(paid(started)).toHaveLength(1);

        await advanceClock(client.id, DAY + 2 * 3600);
        await expect
            .poll(async () => paid(await membershipEvidence(client.id)).length, {
                timeout: 120_000,
            })
            .toBe(2);
        await expect
            .poll(async () => (await clientMoney(client.id)).payments.length, { timeout: 120_000 })
            .toBe(2);
        const renewed = await membershipEvidence(client.id);
        const charges = paid(renewed).flatMap((invoice) =>
            invoice.payments.flatMap((p) => (p.charge ? [p.charge] : [])),
        );
        expect(charges).toHaveLength(2);
        const money = await clientMoney(client.id);
        expect(money.payments.map((p) => [p.kind, p.status, p.amount_cents]).sort()).toEqual([
            ["payment", "succeeded", 2000],
            ["payment", "succeeded", 2000],
        ]);
        expect(new Set(money.payments.map((p) => p.provider_ref))).toEqual(
            new Set(paid(renewed).flatMap((invoice) => invoice.payments.map((p) => p.intent))),
        );
        const totals = categoryTotals(money.entries);
        // each renewal books the fee Stripe actually took, including the platform's share
        expect(totals.stripe).toBe(charges.reduce((sum, c) => sum + c.net_cents, 0));
        expect(totals.platform_fee).toBe(
            charges.reduce((sum, c) => sum + (c.charge.application_fee_amount ?? 0), 0),
        );
        expect(totals.platform_fee).toBeGreaterThan(0);
        expect(totals.revenue).toBe(-4000);
        expect(totals.receivable ?? 0).toBe(0);

        await declineRenewals(client.id);
        await advanceClock(client.id, DAY);
        await expect
            .poll(async () => (await membershipRows(client.id))[0]?.status, { timeout: 120_000 })
            .toBe("past_due");
        await expect
            .poll(async () => (await pastDueNotices(membership.id)).length, { timeout: 60_000 })
            .toBe(1);
        // the wallet says the card was declined instead of promising the next charge
        const pastDue = membershipLine(await openWallet(owner, client), item);
        await expect(
            pastDue.getByText(strings.entitlements.pastDueNote, { exact: true }),
        ).toBeVisible({ timeout: 60_000 });
        await expect(pastDue.getByText(strings.clients.nextCharge("").trim())).toHaveCount(0);
        await advanceClock(client.id, DAY);
        await expect
            .poll(async () => failed(await membershipEvidence(client.id)).length, {
                timeout: 120_000,
            })
            .toBe(2);
        await expect
            .poll(async () => (await pastDueNotices(membership.id)).length, { timeout: 90_000 })
            .toBe(2);
        const declined = await membershipEvidence(client.id);
        const notices = await pastDueNotices(membership.id);
        // one notice for each failed renewal, keyed by the invoice that failed
        expect(new Set(notices.map((n) => n.key.split(":")[3]))).toEqual(
            new Set(failed(declined).map((invoice) => invoice.id)),
        );
        expect((await clientMoney(client.id)).payments).toHaveLength(2);

        restore = await setPlan("lapsed");
        await owner.reload();
        await expect(lapsedNotice(owner)).toBeVisible({ timeout: 60_000 });
        const wallet = await openWallet(owner, client);
        const cancel = owner.getByRole("button", { name: strings.common.cancel, exact: true });
        // the saved card's row also names the plan it pays for; only the plan's row cancels
        const line = wallet
            .getByRole("listitem")
            .filter({ hasText: item.name })
            .filter({ has: cancel });
        await expect(line).toBeVisible({ timeout: 60_000 });
        const canceled = owner.waitForResponse(
            (r) =>
                new URL(r.url()).pathname === `/v1/subscriptions/${membership.id}/cancel` &&
                r.request().method() === "POST",
            { timeout: 60_000 },
        );
        await press(line.getByRole("button", { name: strings.common.cancel, exact: true }));
        await press(
            owner.getByRole("dialog").getByRole("button", {
                name: strings.clients.cancelSubscriptionTitle,
                exact: true,
            }),
        );
        expect((await canceled).status()).toBe(200);
        await expect
            .poll(async () => (await membershipEvidence(client.id)).subscriptions)
            .toEqual([{ id: membership.provider_ref, status: "canceled" }]);
        await expect
            .poll(async () => (await membershipRows(client.id))[0]?.status)
            .toBe("canceled");
        await info.attach("str-e07", {
            body: JSON.stringify(
                { renewed, declined, notices, ledger: await clientMoney(client.id) },
                null,
                2,
            ),
            contentType: "application/json",
        });
    } finally {
        if (restore !== null) await setPlan(restore);
        await owner.context().close();
    }
});

/** Cancels the membership from the wallet, committing the cancel but dropping its response. */
async function cancelLosingResponse(
    page: Page,
    client: ClientFixture,
    item: { name: string },
    subscriptionId: string,
): Promise<number[]> {
    const statuses: number[] = [];
    const path = `**/v1/subscriptions/${subscriptionId}/cancel`;
    await page.route(path, async (route) => {
        statuses.push((await route.fetch()).status());
        await route.abort("connectionreset");
    });
    try {
        const wallet = await openWallet(page, client);
        const cancel = page.getByRole("button", { name: strings.common.cancel, exact: true });
        const line = wallet
            .getByRole("listitem")
            .filter({ hasText: item.name })
            .filter({ has: cancel });
        await press(line.getByRole("button", { name: strings.common.cancel, exact: true }));
        const dialog = page.getByRole("dialog");
        await expect(
            dialog.getByText(strings.clients.cancelSubscriptionConfirm(item.name), { exact: true }),
        ).toBeVisible();
        const confirm = dialog.getByRole("button", {
            name: strings.clients.cancelSubscriptionTitle,
            exact: true,
        });
        await press(confirm);
        await expect.poll(() => statuses.length).toBe(1);
        // the canceled membership reaches the wallet through sync, so there is nothing to retry
        const row = wallet.getByRole("listitem").filter({ hasText: item.name });
        await expect(
            row.getByText(strings.entitlements.statusLabel.canceled, { exact: true }),
        ).toBeVisible({ timeout: 60_000 });
        await expect(row.getByRole("button", { name: strings.common.cancel })).toHaveCount(0);
        await expect(page.getByText(strings.clients.cancelSubscriptionError)).toHaveCount(0);
        // it ended today, not at the end of the month it had paid for
        await expect(
            row.getByText(strings.clients.subscriptionEnded(formatDate(new Date(), ZONE)), {
                exact: true,
            }),
        ).toBeVisible();
    } finally {
        await page.unroute(path);
    }
    return statuses;
}

test("ENT-E2E-08 a membership covers a visit at the desk, its cancel survives a lost response, and selling it again leaves one active subscription", async ({
    browser,
    request,
}, info) => {
    test.setTimeout(600_000);
    const zone = ZONE;
    const baseURL = `http://localhost:${String(runPort("WEB_E2E_PORT"))}`;
    const ownerContext = await browser.newContext({ baseURL });
    const joining = await browser.newContext({ baseURL });
    let member: Awaited<ReturnType<typeof joinHoursStaff>> | null = null;
    try {
        const owner = await ownerContext.newPage();
        await signIn(owner);
        // a member with no hours set can take a visit at any time, so the visit starts today
        member = await joinHoursStaff(await joining.newPage(), request);
        const client = await createClient(owner);
        await registerPurchaser(client.id);
        const service = await apiCall<{ id: string; name: string }>(
            owner,
            "POST",
            "/v1/items",
            {
                kind: "service",
                name: `Nail trim for ${client.name}`,
                duration_min: 5,
                price_cents: 2500,
                deposit_type: "none",
                online_bookable: false,
            },
            201,
        );
        const item = await apiCall<{ id: string; name: string }>(
            owner,
            "POST",
            "/v1/items",
            {
                kind: "subscription",
                name: `${client.name} — Monthly nail care`,
                price_cents: 2000,
                tax_class: "exempt",
                interval: 1,
                frequency: "month",
                visits_per_period: 1,
                covers_item_id: service.id,
                active: true,
            },
            201,
        );
        await saveCardUi(owner, client);
        await startMembershipUi(owner, client, item);
        await expect
            .poll(async () => (await clientMoney(client.id)).payments.length, { timeout: 120_000 })
            .toBe(1);
        const [first] = await membershipRows(client.id);
        if (!first?.provider_ref) throw new Error("the membership was not recorded");
        expect(first.status).toBe("active");
        const started = await membershipEvidence(client.id);
        expect(started.subscriptions).toEqual([{ id: first.provider_ref, status: "active" }]);
        expect(paid(started)).toHaveLength(1);
        await refusedMembershipUi(owner, client, item);
        expect((await membershipEvidence(client.id)).subscriptions).toHaveLength(1);

        const midnight = combineDayAndTime(dateKey(new Date(), zone), "00:00", zone).getTime();
        const wait = midnight + 13 * 60_000 - Date.now();
        if (wait > 0) await owner.waitForTimeout(wait);
        const starts = new Date(Math.floor((Date.now() - 10 * 60_000) / 60_000) * 60_000);
        const visit = await apiCall<{ id: string; status: string }>(
            owner,
            "POST",
            "/v1/bookings",
            {
                client_id: client.id,
                item_id: service.id,
                staff_id: member.id,
                starts_at: starts.toISOString(),
                notify: false,
            },
            201,
        );
        expect(visit.status).toBe("confirmed");
        await navigate(owner, "/payments/sales");
        const row = owner
            .getByRole("main")
            .locator("div")
            .filter({ hasText: service.name })
            .filter({ hasText: formatTime(starts, zone) })
            .filter({
                has: owner.getByRole("button", {
                    name: strings.pos.desk.useMembership,
                    exact: true,
                }),
            })
            .last();
        await expect(row).toBeVisible({ timeout: 60_000 });
        const covering = owner.waitForResponse(
            (r) =>
                new URL(r.url()).pathname === `/v1/subscriptions/${first.id}/cover` &&
                r.request().method() === "POST",
        );
        await row
            .getByRole("button", { name: strings.pos.desk.useMembership, exact: true })
            .click();
        const covered = await covering;
        expect(covered.status(), await covered.text()).toBe(200);
        expect(covered.request().postDataJSON()).toEqual({ booking_id: visit.id });
        await expect(row).toHaveCount(0, { timeout: 60_000 });
        expect(
            await select<{
                status: string;
                subscription_id: string | null;
                order_id: string | null;
            }>`
                SELECT status, subscription_id, order_id FROM bookings WHERE id = ${visit.id}`,
        ).toEqual([{ status: "completed", subscription_id: first.id, order_id: null }]);
        const afterVisit = await clientMoney(client.id);
        expect(afterVisit.payments).toHaveLength(1);
        expect(categoryTotals(afterVisit.entries).receivable ?? 0).toBe(0);

        const lost = await cancelLosingResponse(owner, client, item, first.id);
        expect(lost).toEqual([200]);
        await expect
            .poll(async () => (await membershipEvidence(client.id)).subscriptions)
            .toEqual([{ id: first.provider_ref, status: "canceled" }]);
        expect((await membershipRows(client.id)).map((r) => r.status)).toEqual(["canceled"]);

        await startMembershipUi(owner, client, item);
        await expect
            .poll(async () => (await clientMoney(client.id)).payments.length, { timeout: 120_000 })
            .toBe(2);
        const rows = await membershipRows(client.id);
        expect(rows.map((r) => r.status)).toEqual(["canceled", "active"]);
        const second = rows[1];
        if (!second?.provider_ref || second.provider_ref === first.provider_ref)
            throw new Error("the membership was not sold again");
        const resold = await membershipEvidence(client.id);
        expect(resold.subscriptions.filter((s) => s.status === "active").map((s) => s.id)).toEqual([
            second.provider_ref,
        ]);
        expect(new Set(resold.subscriptions.map((s) => s.id))).toEqual(
            new Set([first.provider_ref, second.provider_ref]),
        );
        const charges = paid(resold).flatMap((invoice) =>
            invoice.payments.flatMap((p) => (p.charge ? [p.charge] : [])),
        );
        expect(charges).toHaveLength(2);
        const money = await clientMoney(client.id);
        expect(money.payments.map((p) => [p.kind, p.status, p.amount_cents])).toEqual([
            ["payment", "succeeded", 2000],
            ["payment", "succeeded", 2000],
        ]);
        const totals = categoryTotals(money.entries);
        expect(totals.stripe).toBe(charges.reduce((sum, c) => sum + c.net_cents, 0));
        for (const charge of charges) expect(charge.charge.amount).toBe(2000);
        expect(totals.revenue).toBe(-4000);
        await info.attach("ent-e2e-08", {
            body: JSON.stringify({ started, lost, resold, ledger: money }, null, 2),
            contentType: "application/json",
        });
    } finally {
        await member?.cleanup();
        await joining.close();
        await ownerContext.close();
    }
});

test("ENT-E2E-11 a monthly membership renews a month on taxed at the registration then in force, goes by its plan, and archiving its client ends it with the period paid", async ({
    browser,
}, info) => {
    test.setTimeout(900_000);
    const owner = await (
        await browser.newContext({
            baseURL: `http://localhost:${String(runPort("WEB_E2E_PORT"))}`,
        })
    ).newPage();
    try {
        await signIn(owner);
        const client = await createClient(owner);
        await registerPurchaser(client.id, true);
        const item = await apiCall<{ id: string; name: string }>(
            owner,
            "POST",
            "/v1/items",
            {
                kind: "subscription",
                name: `${client.name} — Monthly coat club`,
                price_cents: 2500,
                tax_class: "federal_only",
                interval: 1,
                frequency: "month",
                active: true,
            },
            201,
        );
        // the business isn't registered yet, so the plan starts at its price with no GST
        expect((await patchBusiness(owner, { tax_registered: false })).status()).toBe(200);
        await saveCardUi(owner, client);
        await startMembershipUi(owner, client, item, 2500);
        await expect
            .poll(async () => (await clientMoney(client.id)).payments.length, { timeout: 120_000 })
            .toBe(1);
        const [membership] = await membershipRows(client.id);
        if (!membership?.provider_ref || !membership.current_period_end)
            throw new Error("the membership was not recorded");
        expect(membership.status).toBe("active");
        // members keep the price they joined at, so the plan's panel must say $25.00, not $30.00
        await apiCall(owner, "PATCH", `/v1/items/${item.id}`, { price_cents: 3000 }, 200);

        expect((await patchBusiness(owner, { tax_registered: true })).status()).toBe(200);
        // a month is 28 to 31 days, so 32 days on is past one renewal and short of a second
        await advanceClock(client.id, 32 * DAY);
        await expect
            .poll(async () => paid(await membershipEvidence(client.id)).length, {
                timeout: 120_000,
            })
            .toBe(2);
        await expect
            .poll(async () => (await clientMoney(client.id)).payments.length, { timeout: 120_000 })
            .toBe(2);
        const invoices = await select<{
            id: string;
            number: number | null;
            total_cents: number;
            tax_total_cents: number;
        }>`
            SELECT id, number, total_cents, tax_total_cents FROM invoices
            WHERE client_id = ${client.id} ORDER BY issued_at`;
        // the same $25.00 each month; the renewal carries the GST the new registration owes on it
        expect(invoices.map((i) => [i.number, i.total_cents, i.tax_total_cents])).toEqual([
            [null, 2500, 0],
            [null, 2500, 119],
        ]);
        const renewal = invoices[1];
        if (!renewal) throw new Error("the renewal was not invoiced");
        await navigate(owner, `/payments/invoices?open=${renewal.id}`);
        const invoice = owner.getByRole("dialog");
        await expect(invoice.getByRole("heading", { name: item.name, exact: true })).toBeVisible({
            timeout: 60_000,
        });
        // its history says it was issued; a renewal is charged to the card, never sent
        const history = invoice
            .getByRole("list")
            .filter({ hasText: strings.billing.event.created });
        await expect(
            history.getByText(strings.billing.event.issued, { exact: true }),
        ).toBeVisible();
        await expect(history.getByText(strings.billing.event.sent, { exact: true })).toHaveCount(0);
        await expect(invoice.getByText(strings.billing.draftInvoice, { exact: true })).toHaveCount(
            0,
        );

        const [renewed] = await membershipRows(client.id);
        if (!renewed?.current_period_end) throw new Error("the renewal moved no period");
        const nextCharge = strings.clients.nextCharge(formatDate(renewed.current_period_end, ZONE));
        await expect(
            membershipLine(await openWallet(owner, client), item).getByText(nextCharge, {
                exact: true,
            }),
        ).toBeVisible({ timeout: 60_000 });
        // the plan's own panel names what the card is charged next, tax and all
        await navigate(owner, "/payments/gift-cards");
        await owner.getByRole("main").getByText(client.name, { exact: true }).first().click();
        await expect(
            owner.getByText(
                `${formatDate(renewed.current_period_end, ZONE)}${strings.common.separator}${formatMoney(2500, "CAD")}`,
                { exact: true },
            ),
        ).toBeVisible({ timeout: 60_000 });
        await owner.keyboard.press("Escape");

        await apiCall(owner, "POST", `/v1/clients/${client.id}/archive`, {}, 200);
        await expect
            .poll(async () => (await membershipRows(client.id))[0]?.ends_at?.getTime(), {
                timeout: 60_000,
            })
            .toBe(renewed.current_period_end.getTime());
        const ends = strings.clients.subscriptionEnds(formatDate(renewed.current_period_end, ZONE));
        await expect(
            membershipLine(await openWallet(owner, client, { archived: true }), item).getByText(
                ends,
                { exact: true },
            ),
        ).toBeVisible({ timeout: 60_000 });

        await advanceClock(client.id, 32 * DAY);
        await expect
            .poll(async () => (await membershipRows(client.id))[0]?.status, { timeout: 120_000 })
            .toBe("canceled");
        const ended = await membershipEvidence(client.id);
        expect(ended.subscriptions.map((s) => s.status)).toEqual(["canceled"]);
        // the period already paid ran out and nothing more was charged
        expect(paid(ended)).toHaveLength(2);
        expect((await clientMoney(client.id)).payments).toHaveLength(2);
        const [closed] = await membershipRows(client.id);
        if (!closed?.ends_at) throw new Error("the ended membership has no end date");
        await expect(
            membershipLine(await openWallet(owner, client, { archived: true }), item).getByText(
                strings.clients.subscriptionEnded(formatDate(closed.ends_at, ZONE)),
                { exact: true },
            ),
        ).toBeVisible({ timeout: 60_000 });
        await info.attach("ent-e2e-11", {
            body: JSON.stringify(
                { invoices, ended, ledger: await clientMoney(client.id) },
                null,
                2,
            ),
            contentType: "application/json",
        });
    } finally {
        await patchBusiness(owner, { tax_registered: true });
        await owner.context().close();
    }
});
