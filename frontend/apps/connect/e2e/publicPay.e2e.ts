import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import { on } from "./support/hosts";
import { links } from "./support/links";
import { ownAddress } from "./support/network";
import { watchErrors } from "./support/errors";

test.beforeEach(async ({ context }, info) => {
    await ownAddress(context, info);
});

test("a client opens an invoice and sees how to pay it", async ({ page }) => {
    const errors = watchErrors(page);
    const pay = strings.publicPay;
    await page.goto(on("pay", `/i/${links.invoice}`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText("#");
    await expect(
        page.getByRole("heading", { name: new RegExp(`^(${pay.cardLabel}|${pay.offlineTitle})$`) }),
    ).toBeVisible();
    expect(errors).toEqual([]);
});
