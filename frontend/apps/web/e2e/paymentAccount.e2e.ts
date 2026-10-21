import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";

test("payment account entrypoints preserve navigation when payment tools are offline", async ({
    page,
}) => {
    await page.route("https://connect-js.stripe.com/**", (route) => route.abort());
    await page.route("**/v1/connect/payouts", (route) =>
        route.fulfill({
            status: 503,
            json: { error: "provider_unavailable", message: "provider unavailable" },
        }),
    );
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
    await expect(
        page.getByRole("tab", { name: strings.payouts.tabCharges, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(strings.ui.listError, { exact: true })).toBeVisible();
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
            json: {
                next_cursor: null,
                payouts: [
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
            },
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
        .fill("hannah@birchbark.example");
    await page.getByLabel(strings.auth.password, { exact: true }).fill("demo1234");
    await page.getByRole("button", { name: strings.auth.signIn, exact: true }).click();
    await page.getByRole("button", { name: /12[.]00/ }).click({ timeout: 60_000 });
    await expect(page.getByText(strings.payouts.contentsTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(strings.payouts.transactionCharge, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: strings.payouts.contentsNext, exact: true }).click();
    await expect(page.getByText(strings.payouts.transactionRefund, { exact: true })).toBeVisible();
    await expect(
        page.getByText(strings.payouts.transactionCharge, { exact: true }),
    ).not.toBeVisible();
    await page.getByRole("button", { name: strings.payouts.contentsPrevious, exact: true }).click();
    await expect(page.getByText(strings.payouts.transactionCharge, { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.getByRole("button", { name: /34[.]00/ }).click();
    await expect(
        page.getByText(strings.payouts.contentsUnavailable, { exact: true }),
    ).toBeVisible();
    await expect(
        page.getByText(strings.payouts.transactionCharge, { exact: true }),
    ).not.toBeVisible();
});

test("payout history reaches older pages and returns to the newest page", async ({ page }) => {
    const created = new Date().toISOString();
    await page.route("**/v1/connect/payouts**", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith("/transactions")) {
            await route.fulfill({
                json: { status: "unavailable", transactions: [], next_cursor: null },
            });
            return;
        }
        const older = url.searchParams.has("after");
        await route.fulfill({
            json: {
                payouts: [
                    {
                        id: older ? "po_older" : "po_newer",
                        amount_cents: older ? 12345 : 67890,
                        status: "paid",
                        occurred_at: created,
                        arrival_at: created,
                    },
                ],
                next_cursor: older ? null : "po_newer",
            },
        });
    });
    await page.goto("/payments/payouts");
    await page
        .getByRole("textbox", { name: strings.auth.email, exact: true })
        .fill("hannah@birchbark.example");
    await page.getByLabel(strings.auth.password, { exact: true }).fill("demo1234");
    await page.getByRole("button", { name: strings.auth.signIn, exact: true }).click();
    await expect(page.getByText("po_newer", { exact: true })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: strings.payouts.historyNext, exact: true }).click();
    await expect(page.getByText("po_older", { exact: true })).toBeVisible();
    await expect(
        page.getByRole("button", { name: strings.payouts.historyNext, exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: strings.payouts.historyPrevious, exact: true }).click();
    await expect(page.getByText("po_newer", { exact: true })).toBeVisible();
});
