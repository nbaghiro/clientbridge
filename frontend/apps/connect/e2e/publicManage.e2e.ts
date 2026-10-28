import { formatMoney, strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import { links } from "./support/links";
import { ownAddress } from "./support/network";
import { watchErrors } from "./support/errors";

test.beforeEach(async ({ context }, info) => {
    await ownAddress(context, info);
});

test("a client opens the manage link and the move picker", async ({ page }) => {
    const errors = watchErrors(page);
    const m = strings.publicManage;
    await page.goto(`/m/${links.manage}`);
    await expect(page.getByText(m.title, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: m.reschedule }).click();
    await expect(page.getByRole("heading", { name: m.moveTitle })).toBeVisible();
    await page.getByRole("button", { name: m.back }).click();
    await expect(page.getByText(m.title, { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
});

test(
    "XB-E2E-14 a client sees a deposit due on the manage link and how to pay it",
    { tag: "@browsers" },
    async ({ page }) => {
        const errors = watchErrors(page);
        const m = strings.publicManage;
        const amount = formatMoney(2500, "CAD");
        let business = "";
        let acceptsCard = false;
        await page.route(`**/manage/${links.manage}`, async (route) => {
            const response = await route.fetch();
            const booking = (await response.json()) as { business_name: string };
            business = booking.business_name;
            await route.fulfill({
                response,
                json: {
                    ...booking,
                    deposit_cents: 2500,
                    deposit_status: "pending",
                    deposit_due: true,
                    accepts_card: acceptsCard,
                },
            });
        });
        await page.goto(`/m/${links.manage}`);
        await expect(page.getByText(m.depositDue(amount))).toBeVisible();
        await expect(page.getByText(m.depositOffline(amount, business))).toBeVisible();
        await expect(page.getByRole("button", { name: m.payDeposit })).toHaveCount(0);
        acceptsCard = true;
        await page.reload();
        await expect(page.getByText(m.depositDueBody(amount))).toBeVisible();
        await expect(page.getByRole("button", { name: m.payDeposit })).toBeVisible();
        await page.unrouteAll({ behavior: "ignoreErrors" });
        expect(errors).toEqual([]);
    },
);
