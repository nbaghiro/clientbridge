import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import { on } from "./hosts";
import { ownAddress } from "./network";

test.beforeEach(async ({ context }, info) => {
    await ownAddress(context, info);
});

test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
});

test(
    "bank setup rejects a missing link and removes provider secrets from the URL",
    { tag: "@browsers" },
    async ({ page }) => {
        await page.goto(
            on(
                "pay",
                "/setup?setup_intent_client_secret=secret&setup_intent=seti_test&redirect_status=succeeded",
            ),
        );
        await expect(
            page.getByRole("heading", { name: strings.checkout.bankSetupTitle }),
        ).toBeVisible();
        await expect(page.getByText(strings.checkout.bankSetupUnavailable)).toBeVisible();
        await expect(page).toHaveURL(/\/setup$/);
    },
);
