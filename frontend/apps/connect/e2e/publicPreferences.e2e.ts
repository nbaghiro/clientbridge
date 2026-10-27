import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import { links } from "./links";
import { ownAddress } from "./network";
import { watchErrors } from "./errors";

test.beforeEach(async ({ context }, info) => {
    await ownAddress(context, info);
});

test("a client opens their message preferences and an unknown link", async ({ page }) => {
    const errors = watchErrors(page);
    const prefs = strings.publicPreferences;
    await page.goto(`/prefs/${links.prefs}`);
    await expect(page.getByRole("heading", { name: prefs.title })).toBeVisible();
    await page.getByRole("switch").first().click();
    await expect(page.getByRole("button", { name: prefs.save })).toBeEnabled();
    await page.goto("/nowhere/at-all");
    await expect(
        page.getByRole("heading", { name: strings.publicLanding.pageNotFoundTitle }),
    ).toBeVisible();
    expect(errors).toEqual([]);
});
