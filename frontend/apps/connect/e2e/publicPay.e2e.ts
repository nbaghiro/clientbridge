import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import { on } from "./hosts";
import { links } from "./links";
import { ownAddress } from "./network";
import { watchErrors } from "./errors";

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
