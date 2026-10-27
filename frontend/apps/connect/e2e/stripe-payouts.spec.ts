import { formatMoney, strings } from "@clientbridge/app-core/public";
import { expect, test, type Page } from "@playwright/test";
import { demoId, runPort } from "@clientbridge/config/e2e/run";
import { select } from "../../web/e2e/support/db";
import { navigate, signIn } from "../../web/e2e/support/session";
import {
    enterStripeCard,
    openStripeInvoice,
    settledStripeInvoice,
    stripeReady,
    submitStripeCard,
} from "./stripe-provider";
import {
    bankDeposits,
    depositedCents,
    merchant,
    payoutJournals,
    stripeFrame,
    type PayoutSchedule,
    type StripePayout,
} from "./stripe-payouts";

test.use({ actionTimeout: 60_000 });
const p = strings.payouts;
const g = strings.gettingPaid;
// Stripe's test card whose funds skip the pending balance, so the run can pay its own charge out.
const availableCard = "4000000000000077";

function webContext(browser: import("@playwright/test").Browser) {
    return browser.newContext({ baseURL: `http://localhost:${String(runPort("WEB_E2E_PORT"))}` });
}

async function openPayoutsComponent(page: Page) {
    await page
        .getByRole("button", { name: strings.paymentAccount.viewPayouts, exact: true })
        .click();
    await expect(
        page.getByRole("region", { name: strings.paymentAccount.payouts, exact: true }),
    ).toBeVisible();
}

test.describe("payouts", () => {
    test.describe.configure({ mode: "serial" });
    let funded: { charge: string; net: number } | null = null;

    test("STR-E01 a Connect invoice payment books fees that match Stripe's balance transaction", async ({
        page,
        request,
    }, info) => {
        const { invoice, payment } = await openStripeInvoice(page, request);
        await enterStripeCard(payment, availableCard);
        await submitStripeCard(page, info);
        const settled = await settledStripeInvoice(page, request, invoice, info);
        const intent = settled.stripe[0];
        if (!intent?.charge || intent.net === undefined) throw new Error("charge evidence missing");
        const charge = await merchant<{ net: number; fee: number; status: string }>(
            "charge",
            intent.charge,
        );
        expect(charge).toMatchObject({ net: intent.net, fee: intent.fee, status: "available" });
        funded = { charge: intent.charge, net: intent.net };
    });

    // Opt-in: the shared merchant needs an available balance that covers this run's charge.
    if (process.env.STRIPE_PAYOUT_CASE === "1")
        test("STR-E08 a manual payout shows in transit, is left out of Deposited until Stripe pays it, then reaches Bank deposits", async ({
            browser,
        }, info) => {
            test.setTimeout(900_000);
            if (funded === null) throw new Error("STR-E01 did not fund the payout");
            const { net } = funded;
            const balance = await merchant<{ available: number; pending: number }>("balance");
            await info.attach("balance-before-payout", {
                body: JSON.stringify({ balance, net }),
                contentType: "application/json",
            });
            // Refunds draw on the available balance while the charges they reverse are still pending.
            expect(
                balance.available,
                "the shared merchant's available balance must cover this run's charge",
            ).toBeGreaterThanOrEqual(net);
            const original = await merchant<PayoutSchedule>("schedule");
            expect(original.interval).not.toBe("manual");
            const before = new Set(
                (await merchant<{ payouts: { id: string }[] }>("payouts")).payouts.map(
                    (row) => row.id,
                ),
            );
            const context = await webContext(browser);
            try {
                const page = await context.newPage();
                await signIn(page);
                await navigate(page, "/payments/payouts");
                await expect(page.getByText(p.depositedHint, { exact: true })).toBeVisible({
                    timeout: 60_000,
                });
                const depositedBefore = await depositedCents(page);

                await openPayoutsComponent(page);
                const component = await stripeFrame(page, /^Update$/);
                await component.getByRole("button", { name: "Update", exact: true }).click();
                const scheduleDialog = await stripeFrame(page, /^Save$/);
                await scheduleDialog.getByRole("radio", { name: /^Manual/ }).check();
                await scheduleDialog.getByRole("button", { name: "Save", exact: true }).click();
                await expect
                    .poll(async () => (await merchant<PayoutSchedule>("schedule")).interval)
                    .toBe("manual");

                await (
                    await stripeFrame(page, /^Pay out$/)
                )
                    .getByRole("button", { name: "Pay out", exact: true })
                    .click();
                const payoutDialog = await stripeFrame(page, /^(Pay out|Confirm|Send)/);
                await info.attach("payout-dialog", {
                    body: await page.screenshot({ fullPage: true }),
                    contentType: "image/png",
                });
                const amount = payoutDialog.getByRole("textbox").first();
                if ((await amount.count()) > 0) await amount.fill((net / 100).toFixed(2));
                await payoutDialog
                    .getByRole("button", { name: /^(Pay out|Confirm|Send)/ })
                    .last()
                    .click();
                let payoutId = "";
                await expect(async () => {
                    const listed = await merchant<{ payouts: { id: string }[] }>("payouts");
                    const created = listed.payouts.filter((row) => !before.has(row.id));
                    expect(created).toHaveLength(1);
                    payoutId = created[0]?.id ?? "";
                }).toPass({ timeout: 60_000 });
                const created = await merchant<StripePayout>("payout", payoutId);
                expect(created).toMatchObject({ amount: net, currency: "cad", automatic: false });
                await page
                    .getByRole("button", { name: strings.paymentAccount.close, exact: true })
                    .click();

                await expect
                    .poll(async () => (await payoutJournals(payoutId)).length, { timeout: 120_000 })
                    .toBeGreaterThan(0);
                const inTransit = await payoutJournals(payoutId);
                const paidEarly = inTransit.some((leg) => leg.ref.endsWith(":paid"));
                await info.attach("payout-in-transit", {
                    body: JSON.stringify({ payout: created, journals: inTransit, paidEarly }),
                    contentType: "application/json",
                });
                expect(
                    inTransit
                        .filter((leg) => leg.ref === `payout:${payoutId}`)
                        .map(({ category, amount_cents }) => ({ category, amount_cents })),
                ).toEqual([
                    { category: "stripe", amount_cents: -net },
                    { category: "transit", amount_cents: net },
                ]);
                await page.reload();
                const row = page.getByRole("button").filter({ hasText: payoutId });
                await expect(row).toBeVisible({ timeout: 60_000 });
                if (!paidEarly) {
                    await expect(row).toContainText(
                        new RegExp(`${p.status.pending}|${p.status.in_transit}`),
                    );
                    expect(await depositedCents(page)).toBe(depositedBefore);
                }

                await expect
                    .poll(async () => (await merchant<StripePayout>("payout", payoutId)).status, {
                        timeout: 600_000,
                        intervals: [5000, 10_000, 20_000],
                    })
                    .toBe("paid");
                await expect
                    .poll(
                        async () =>
                            (await payoutJournals(payoutId)).filter(
                                (leg) => leg.ref === `payout:${payoutId}:paid`,
                            ).length,
                        { timeout: 120_000 },
                    )
                    .toBe(2);
                const journals = await payoutJournals(payoutId);
                expect(
                    journals
                        .filter((leg) => leg.ref === `payout:${payoutId}:paid`)
                        .map(({ category, amount_cents }) => ({ category, amount_cents })),
                ).toEqual([
                    { category: "bank", amount_cents: net },
                    { category: "transit", amount_cents: -net },
                ]);
                const transit = journals
                    .filter((leg) => leg.category === "transit")
                    .reduce((sum, leg) => sum + leg.amount_cents, 0);
                expect(transit).toBe(0);

                await page.reload();
                await expect(row).toContainText(p.status.paid, { timeout: 60_000 });
                await expect
                    .poll(() => depositedCents(page), { timeout: 60_000 })
                    .toBe(depositedBefore + net);
                await row.click();
                await expect(page.getByText(p.contentsUnavailable, { exact: true })).toBeVisible();
                await page.keyboard.press("Escape");

                const paidJournal = journals.find(
                    (leg) => leg.ref === `payout:${payoutId}:paid` && leg.category === "bank",
                )?.journal_id;
                const deposits = await bankDeposits(page, info, "bank-deposits");
                const arrival = await select<{ day: string }>`
                    SELECT to_char(available_at AT TIME ZONE 'America/Vancouver', 'YYYY-MM-DD') AS day
                    FROM entries WHERE journal_id = ${paidJournal ?? ""} AND business_id = ${demoId("bz_birchbark")}
                    LIMIT 1`;
                expect(deposits).toContainEqual([
                    paidJournal,
                    arrival[0]?.day,
                    String(net),
                    "paid",
                ]);
                await info.attach("payout-settled", {
                    body: JSON.stringify({
                        payout: await merchant<StripePayout>("payout", payoutId),
                        journals,
                        formatted: formatMoney(net, "CAD"),
                    }),
                    contentType: "application/json",
                });
            } finally {
                try {
                    await context.close();
                } finally {
                    const restored = await merchant<PayoutSchedule>(
                        "restore-schedule",
                        original.interval,
                    );
                    expect(restored).toEqual(original);
                }
            }
        });
});

test("STR-E09 Getting paid shows payouts paused from the mirrored account and Check again reads it back from Stripe", async ({
    browser,
}, info) => {
    await stripeReady();
    const context = await webContext(browser);
    try {
        const page = await context.newPage();
        await signIn(page);
        const paused = await merchant<{ kyc_status: string }>("mirror", "paused");
        expect(paused).toMatchObject({ kyc_status: "payouts_paused" });
        await navigate(page, "/setup/getting-paid");
        await expect(page.getByText(g.pausedTitle, { exact: true })).toBeVisible({
            timeout: 60_000,
        });
        await expect(page.getByText(g.pausedBodyNoDate, { exact: true })).toBeVisible();
        await expect(page.getByText(g.reqExternalAccount, { exact: true })).toBeVisible();

        const stripeSide = await merchant<{
            charges_enabled: boolean;
            payouts_enabled: boolean;
            past_due: string[];
        }>("account");
        const refreshed = page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === "/v1/connect/refresh" &&
                response.request().method() === "POST",
        );
        await page.getByRole("button", { name: g.refresh, exact: true }).click();
        const response = await refreshed;
        expect(response.status()).toBe(200);
        const status = (await response.json()) as Record<string, unknown>;
        expect(status).toMatchObject({
            kyc_status: "enabled",
            charges_enabled: stripeSide.charges_enabled,
            payouts_enabled: stripeSide.payouts_enabled,
            past_due: stripeSide.past_due,
        });
        await expect(page.getByText(g.readyTitle, { exact: true })).toBeVisible();
        await expect(page.getByText(g.pausedTitle, { exact: true })).toHaveCount(0);
        const [business] = await select<{ payouts: boolean; past_due: unknown }>`
            SELECT stripe_payouts_enabled AS payouts, stripe_requirements->'past_due' AS past_due
            FROM businesses WHERE id = ${demoId("bz_birchbark")}`;
        expect(business).toEqual({ payouts: true, past_due: [] });
        await info.attach("refreshed-account", {
            body: JSON.stringify({ stripe: stripeSide, response: status }),
            contentType: "application/json",
        });
    } finally {
        await context.close();
        await merchant("mirror", "stripe");
    }
});
