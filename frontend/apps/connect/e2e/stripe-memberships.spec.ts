import { expect, test } from "@playwright/test";
import { strings } from "@clientbridge/app-core/public";
import { runPort } from "@clientbridge/config/e2e/run";
import { createClient } from "../../web/e2e/support/clients";
import { lapsedNotice } from "../../web/e2e/support/plans";
import { signIn } from "../../web/e2e/support/session";
import { categoryTotals, clientMoney, press, registerPurchaser } from "./stripe-disputes";
import {
    DAY,
    advanceClock,
    dailyMembership,
    declineRenewals,
    membershipEvidence,
    membershipRows,
    openWallet,
    pastDueNotices,
    saveCardUi,
    setPlan,
    startMembershipUi,
    type MembershipEvidence,
} from "./stripe-memberships";

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
