import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import { runEmail } from "@clientbridge/config/e2e/run";

const s = strings.billing;

test("a recorded payment holds the invoice until its new balance reaches this device", async ({
    page,
}) => {
    test.setTimeout(180_000);
    // the command succeeds, but no payment is written, so the replica never catches up
    await page.route("**/v1/invoices/*/payments", (route) =>
        route.request().method() === "POST"
            ? route.fulfill({
                  json: {
                      payment_id: "pay_catch_up",
                      status: "succeeded",
                      amount_cents: 100,
                      change_cents: 0,
                      balance_cents: 0,
                      client_secret: null,
                  },
              })
            : route.continue(),
    );
    await page.goto("/payments/invoices");
    await page
        .getByRole("textbox", { name: strings.auth.email, exact: true })
        .fill(runEmail("hannah@birchbark.example"));
    await page.getByLabel(strings.auth.password, { exact: true }).fill("demo1234");
    await page.getByRole("button", { name: strings.auth.signIn, exact: true }).click();
    const main = page.getByRole("main");
    await main
        .getByRole("button", { name: new RegExp(`^${s.segments.open}`) })
        .click({ timeout: 60_000 });
    await main.locator("button.block").first().click();
    const record = page.getByRole("dialog");
    await record.getByRole("button", { name: s.recordPayment }).click();
    await page.getByRole("button", { name: new RegExp(`^${s.rec.cash} `) }).click();
    await page.getByRole("button", { name: /^Record \$/ }).click();
    await expect(page.getByText(s.rec.doneTitle)).toBeVisible();
    await page.getByRole("button", { name: strings.common.done, exact: true }).click();

    await expect(record.getByText(s.settling)).toBeVisible();
    await expect(record.getByRole("button", { name: s.recordPayment })).toHaveCount(0);
    await expect(record.getByText(s.settlingLate)).toBeVisible({ timeout: 20_000 });
    await expect(record.getByRole("button", { name: s.recordPayment })).toBeVisible();
});
