import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";

test("payment account entrypoints preserve navigation when payment tools are offline", async ({
    page,
}) => {
    await page.route("https://connect-js.stripe.com/**", (route) => route.abort());
    await page.goto("/setup/getting-paid?manage=account");
    await page
        .getByRole("textbox", { name: strings.auth.email, exact: true })
        .fill("hannah@birchbark.example");
    await page.getByLabel(strings.auth.password, { exact: true }).fill("demo1234");
    await page.getByRole("button", { name: strings.auth.signIn, exact: true }).click();
    await expect(
        page.getByRole("button", { name: strings.paymentAccount.close, exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(/\/setup\/getting-paid$/);
    await page.getByRole("button", { name: strings.paymentAccount.close, exact: true }).click();
    await expect(
        page.getByRole("button", { name: strings.gettingPaid.refresh, exact: true }),
    ).toBeVisible();

    await page.goto("/payments/refunds");
    await page.getByRole("tab", { name: new RegExp(`^${strings.refunds.tabs.disputes}`) }).click();
    await page
        .getByRole("button", { name: strings.paymentAccount.manageDisputes, exact: true })
        .click();
    await expect(
        page.getByRole("region", { name: strings.paymentAccount.payments, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: strings.paymentAccount.close, exact: true }).click();
    await expect(
        page.getByRole("tab", { name: new RegExp(`^${strings.refunds.tabs.disputes}`) }),
    ).toBeVisible();

    await page.goto("/payments/payouts");
    await page
        .getByRole("button", { name: strings.paymentAccount.viewPayouts, exact: true })
        .click();
    await expect(
        page.getByRole("region", { name: strings.paymentAccount.payouts, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: strings.paymentAccount.close, exact: true }).click();
    await page.getByRole("button", { name: strings.paymentAccount.manage, exact: true }).click();
    await expect(
        page.getByRole("region", { name: strings.paymentAccount.account, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: strings.paymentAccount.close, exact: true }).click();
});

test("payout contents paginate and clear when switching to a manual payout", async ({ page }) => {
    const created = new Date().toISOString();
    await page.route("**/v1/connect/payouts", async (route) => {
        await route.fulfill({
            json: [
                {
                    id: "po_auto",
                    amount_cents: 1200,
                    status: "paid",
                    occurred_at: created,
                    arrival_at: created,
                },
                {
                    id: "po_manual",
                    amount_cents: 3400,
                    status: "pending",
                    occurred_at: created,
                    arrival_at: null,
                },
            ],
        });
    });
    await page.route("**/v1/connect/payouts/*/transactions*", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.includes("po_manual")) {
            await route.fulfill({
                json: { status: "unavailable", transactions: [], next_cursor: null },
            });
            return;
        }
        const next = url.searchParams.has("after");
        await route.fulfill({
            json: {
                status: "available",
                next_cursor: next ? null : "txn_first",
                transactions: [
                    {
                        id: next ? "txn_second" : "txn_first",
                        source: null,
                        kind: next ? "refund" : "charge",
                        amount_cents: next ? -500 : 2000,
                        fee_cents: 0,
                        net_cents: next ? -500 : 2000,
                        currency: "CAD",
                        occurred_at: created,
                    },
                ],
            },
        });
    });
    await page.goto("/payments/payouts");
    await page
        .getByRole("textbox", { name: strings.auth.email, exact: true })
        .fill("hannah@birchbarkpets.ca");
    await page.getByLabel(strings.auth.password, { exact: true }).fill("demo1234");
    await page.getByRole("button", { name: strings.auth.signIn, exact: true }).click();
    await expect(page.getByText(strings.payouts.contentsTitle, { exact: true })).toBeVisible({
        timeout: 60_000,
    });
    await expect(page.getByText(strings.payouts.transactionCharge, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: strings.payouts.contentsNext, exact: true }).click();
    await expect(page.getByText(strings.payouts.transactionRefund, { exact: true })).toBeVisible();
    await expect(
        page.getByText(strings.payouts.transactionCharge, { exact: true }),
    ).not.toBeVisible();
    await page.getByRole("button", { name: strings.payouts.contentsPrevious, exact: true }).click();
    await expect(page.getByText(strings.payouts.transactionCharge, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /34[.]00/ }).click();
    await expect(
        page.getByText(strings.payouts.contentsUnavailable, { exact: true }),
    ).toBeVisible();
    await expect(
        page.getByText(strings.payouts.transactionCharge, { exact: true }),
    ).not.toBeVisible();
});
