import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";

test("payment account entrypoints preserve navigation when payment tools are offline", async ({
    page,
}) => {
    await page.route("https://connect-js.stripe.com/**", (route) => route.abort());
    await page.goto("/setup/getting-paid?manage=account");
    await page
        .getByRole("textbox", { name: strings.auth.email, exact: true })
        .fill("hannah@birchbarkpets.ca");
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
