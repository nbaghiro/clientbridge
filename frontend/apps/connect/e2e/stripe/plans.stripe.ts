import { randomUUID } from "node:crypto";
import { strings } from "@clientbridge/app-core/public";
import { demoPerson } from "@clientbridge/config/e2e/demo";
import { runEmail, runPort } from "@clientbridge/config/e2e/run";
import { expect, test } from "@playwright/test";
import { lapsedNotice } from "../../../web/e2e/support/plans";
import { navigate } from "../../../web/e2e/support/session";
import {
    advancePlanClock,
    buyPremium,
    declinePlanCard,
    invite,
    planEvidence,
    planItemChanges,
    revokeInvite,
    trialBusiness,
    type PlanEvidence,
} from "./support/plans";

const p = strings.plans;
const web = () => `http://localhost:${String(runPort("WEB_E2E_PORT"))}`;

function charged(evidence: PlanEvidence) {
    return evidence.invoices.filter((invoice) => invoice.status === "paid" && invoice.total > 0);
}

test("PLN-E2E-04 Premium monthly bought in Checkout during the trial renews on a test clock, then a failed payment goes past due and the plan lapses", async ({
    browser,
}, info) => {
    test.setTimeout(900_000);
    const context = await browser.newContext({ baseURL: web() });
    try {
        const page = await context.newPage();
        const business = await trialBusiness(page, `${demoPerson(randomUUID())} Grooming`);
        await buyPremium(page, "month");
        // Checkout carries the rest of the trial into Stripe, and the app counts the plan as paid
        await expect
            .poll(async () => (await planEvidence(business.id)).business, { timeout: 90_000 })
            .toMatchObject({ plan: "premium", plan_status: "active" });
        const trial = await planEvidence(business.id);
        const [subscription] = trial.subscriptions;
        expect(trial.subscriptions).toEqual([
            {
                id: expect.stringMatching(/^sub_/),
                status: "trialing",
                cancel_at_period_end: false,
                items: [{ key: "premium_month", interval: "month", quantity: 1 }],
            },
        ]);
        expect(trial.business).toMatchObject({
            stripe_account_id: business.account,
            stripe_subscription_id: subscription?.id,
        });
        expect(charged(trial)).toEqual([]);

        await advancePlanClock(business.id, 15);
        await expect
            .poll(async () => charged(await planEvidence(business.id)).length, {
                timeout: 120_000,
            })
            .toBe(1);
        await expect
            .poll(async () => (await planEvidence(business.id)).business.plan_status, {
                timeout: 90_000,
            })
            .toBe("active");
        const first = charged(await planEvidence(business.id))[0];
        // the plan is taxed by the business's address, so the bill is the price plus its tax
        expect(first).toMatchObject({ subtotal: 4999, amount_paid: 4999 + (first?.tax ?? 0) });
        expect(first?.tax).toBeGreaterThan(0);
        await navigate(page, "/setup/security");
        await expect(page.getByText(p.status.active, { exact: true }).first()).toBeVisible({
            timeout: 60_000,
        });

        await advancePlanClock(business.id, 31);
        await expect
            .poll(async () => charged(await planEvidence(business.id)).length, {
                timeout: 120_000,
            })
            .toBe(2);
        const renewed = await planEvidence(business.id);
        expect(charged(renewed).map((invoice) => invoice.billing_reason)).toEqual([
            "subscription_cycle",
            "subscription_cycle",
        ]);
        expect(renewed.business.plan_status).toBe("active");

        await declinePlanCard(business.id);
        await advancePlanClock(business.id, 31);
        await expect
            .poll(async () => (await planEvidence(business.id)).subscriptions[0]?.status, {
                timeout: 120_000,
            })
            .toBe("past_due");
        await expect
            .poll(async () => (await planEvidence(business.id)).business.plan_status, {
                timeout: 90_000,
            })
            .toBe("past_due");
        const failed = await planEvidence(business.id);
        expect(failed.invoices.filter((invoice) => invoice.status === "open")).toHaveLength(1);
        expect(charged(failed)).toHaveLength(2);
        await page.reload();
        await expect(page.getByText(p.status.past_due, { exact: true }).first()).toBeVisible({
            timeout: 60_000,
        });

        // Stripe retries the renewal over the following weeks, then cancels the subscription
        await advancePlanClock(business.id, 30);
        await expect
            .poll(async () => (await planEvidence(business.id)).subscriptions[0]?.status, {
                timeout: 120_000,
            })
            .toBe("canceled");
        await expect
            .poll(async () => (await planEvidence(business.id)).business, { timeout: 90_000 })
            .toMatchObject({ plan_status: "lapsed", plan: null });
        const lapsed = await planEvidence(business.id);
        expect(charged(lapsed)).toHaveLength(2);
        await page.reload();
        await expect(lapsedNotice(page)).toBeVisible({ timeout: 60_000 });
        await info.attach("pln-e2e-04", {
            body: JSON.stringify({ trial, renewed, failed, lapsed }, null, 2),
            contentType: "application/json",
        });
    } finally {
        await context.close();
    }
});

test("PLN-E2E-05 a yearly Premium plan bills team members on a monthly seat item whose quantity follows invites", async ({
    browser,
}, info) => {
    test.setTimeout(600_000);
    const context = await browser.newContext({ baseURL: web() });
    try {
        const page = await context.newPage();
        const business = await trialBusiness(page, `${demoPerson(randomUUID())} Pet Spa`);
        await buyPremium(page, "year");
        await expect
            .poll(async () => (await planEvidence(business.id)).business, { timeout: 90_000 })
            .toMatchObject({ plan: "premium", plan_status: "active" });
        const bought = await planEvidence(business.id);
        expect(bought.subscriptions.map((s) => s.items)).toEqual([
            [{ key: "premium_year", interval: "year", quantity: 1 }],
        ]);

        const run = randomUUID().slice(0, 8);
        const seats = async () =>
            (await planEvidence(business.id)).subscriptions[0]?.items.find(
                (item) => item.key === "seat_month",
            )?.quantity ?? 0;
        const first = await invite(page, runEmail(`seat-${run}-1@example.ca`));
        expect(first.status(), await first.text()).toBe(201);
        await expect.poll(seats, { timeout: 60_000 }).toBe(1);
        const second = await invite(page, runEmail(`seat-${run}-2@example.ca`));
        expect(second.status(), await second.text()).toBe(201);
        await expect.poll(seats, { timeout: 60_000 }).toBe(2);
        const both = await planEvidence(business.id);
        expect(both.subscriptions).toHaveLength(1);
        expect(both.subscriptions[0]?.items).toEqual([
            { key: "premium_year", interval: "year", quantity: 1 },
            { key: "seat_month", interval: "month", quantity: 2 },
        ]);

        const { id } = (await first.json()) as { id: string };
        const revoke = await revokeInvite(page, id);
        expect(revoke.status(), await revoke.text()).toBe(204);
        await expect.poll(seats, { timeout: 60_000 }).toBe(1);
        const after = await planEvidence(business.id);
        expect(after.business).toMatchObject({ plan: "premium", plan_status: "active" });
        await info.attach("pln-e2e-05", {
            body: JSON.stringify({ bought, both, after }, null, 2),
            contentType: "application/json",
        });
    } finally {
        await context.close();
    }
});

test("PLN-E2E-06 the owner returns from Stripe's billing portal, and a plan change whose response is lost applies once when retried", async ({
    browser,
}, info) => {
    test.setTimeout(600_000);
    const context = await browser.newContext({ baseURL: web() });
    try {
        const page = await context.newPage();
        const business = await trialBusiness(page, `${demoPerson(randomUUID())} Grooming Co`);
        await buyPremium(page, "month");
        await expect
            .poll(async () => (await planEvidence(business.id)).business, { timeout: 90_000 })
            .toMatchObject({ plan: "premium", plan_status: "active" });
        await navigate(page, "/setup/security");

        const opened = page.waitForResponse(
            (r) =>
                new URL(r.url()).pathname === "/v1/plan/portal" && r.request().method() === "POST",
        );
        await page.getByRole("button", { name: p.manage, exact: true }).click();
        const portal = await opened;
        expect(portal.status()).toBe(200);
        await page.waitForURL(/^https:\/\/billing\.stripe\.com\//, { timeout: 60_000 });
        await page.getByRole("link", { name: /^Return to / }).click({ timeout: 60_000 });
        await page.waitForURL((url) => url.pathname === "/setup/security", { timeout: 60_000 });
        await expect(page.getByText(p.current, { exact: true })).toBeVisible({ timeout: 60_000 });
        expect(await planItemChanges(business.id)).toEqual({
            [(await planEvidence(business.id)).subscriptions[0]?.id ?? ""]: 0,
        });

        // the first change reaches the server and Stripe, then its answer never reaches the page
        const sent: { key: string; body: string }[] = [];
        let lose = true;
        await page.route("**/v1/plan/change", async (route) => {
            const response = await route.fetch();
            sent.push({
                key: route.request().headers()["idempotency-key"] ?? "",
                body: await response.text(),
            });
            if (lose) {
                lose = false;
                await route.abort("connectionreset");
                return;
            }
            await route.fulfill({ response });
        });
        const team = page.getByRole("button", { name: p.switchTo(p.team), exact: true });
        await team.click();
        await expect(page.getByText(p.changeError, { exact: true })).toBeVisible({
            timeout: 60_000,
        });
        await expect
            .poll(async () => (await planEvidence(business.id)).subscriptions[0]?.items, {
                timeout: 60_000,
            })
            .toEqual([{ key: "team_month", interval: "month", quantity: 1 }]);
        await team.click();
        await expect(page.getByText(p.changeError, { exact: true })).toHaveCount(0, {
            timeout: 60_000,
        });
        const teamPanel = page
            .locator("section")
            .filter({ has: page.getByRole("heading", { name: p.team, exact: true }) });
        await expect(teamPanel.getByText(p.current, { exact: true })).toBeVisible({
            timeout: 60_000,
        });
        await page.unroute("**/v1/plan/change");

        // the retry carried the first attempt's key and got its stored answer back
        expect(sent).toHaveLength(2);
        expect(sent[1]?.key).toBe(sent[0]?.key);
        expect(JSON.parse(sent[1]?.body ?? "")).toEqual(JSON.parse(sent[0]?.body ?? ""));
        const changed = await planEvidence(business.id);
        expect(changed.business).toMatchObject({ plan: "team", plan_status: "active" });
        expect(changed.subscriptions).toEqual([
            expect.objectContaining({
                status: "trialing",
                items: [{ key: "team_month", interval: "month", quantity: 1 }],
            }),
        ]);
        const subscription = changed.subscriptions[0]?.id ?? "";
        await expect
            .poll(async () => planItemChanges(business.id), { timeout: 60_000 })
            .toEqual({ [subscription]: 1 });
        expect(charged(changed)).toEqual([]);
        await info.attach("pln-e2e-06", {
            body: JSON.stringify({ sent, changed }, null, 2),
            contentType: "application/json",
        });
    } finally {
        await context.close();
    }
});
