import { strings } from "@clientbridge/app-core/public";
import { expect, test, type Page } from "@playwright/test";

import { deployment, expectNoWrites, readOnly } from "./support/deployment";

const { slug, domain } = deployment;

async function signIn(page: Page, email: string): Promise<void> {
    await page.goto(deployment.app);
    await page.getByRole("textbox", { name: strings.auth.email, exact: true }).fill(email);
    await page.getByLabel(strings.auth.password, { exact: true }).fill(deployment.password);
    await page.getByRole("button", { name: strings.auth.signIn, exact: true }).click();
    await expect(page).toHaveURL(/\/today$/, { timeout: 60_000 });
}

test("staff screens show the business page, booking and shop links", async ({ page, context }) => {
    const writes = await readOnly(context);
    const [owner = ""] = deployment.owners;
    await signIn(page, owner);
    await page.goto(`${deployment.app}/setup/online-booking`);
    await expect(page.getByText(`book.${domain}/${slug}`).first()).toBeVisible();
    await expect(page.getByText(`<connect-booking slug="${slug}">`).first()).toBeVisible();
    await page.goto(`${deployment.app}/setup/services`);
    await page.getByRole("tab", { name: strings.catalog.views.products }).click();
    await expect(page.getByText(strings.catalog.shopLinkTitle).first()).toBeVisible();
    await expect(page.getByText(`${deployment.shop}/${slug}`).first()).toBeVisible();
    await page.goto(`${deployment.app}/setup/business`);
    await expect(page.getByLabel(strings.business.onboarding.webAddress)).toHaveValue(slug);
    await expect(page.getByText(`.${domain}`).first()).toBeVisible();
    expectNoWrites(writes);
});

for (const owner of deployment.owners) {
    test(`${owner} signs in to today and reads the payment account`, async ({ page, context }) => {
        const writes = await readOnly(context);
        await signIn(page, owner);
        const response = await page.request.get(`${deployment.api}/v1/connect/status`);
        expect(response.status()).toBe(200);
        const status = (await response.json()) as {
            charges_enabled?: boolean;
            payouts_enabled?: boolean;
        };
        test.info().annotations.push({
            type: "payment account",
            description: `charges=${String(status.charges_enabled)} payouts=${String(status.payouts_enabled)}`,
        });
        expect(typeof status.charges_enabled).toBe("boolean");
        expectNoWrites(writes);
    });
}
