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

test(
    "XB-E2E-23 on a phone, a move from the manage link brings its confirmation into view and counts down the moves left",
    { tag: "@browsers" },
    async ({ browser }, info) => {
        const m = strings.publicManage;
        const b = strings.publicBooking;
        const base = info.project.use.baseURL;
        const context = await browser.newContext({
            viewport: { width: 390, height: 844 },
            ...(base === undefined ? {} : { baseURL: base }),
        });
        await ownAddress(context, info);
        const page = await context.newPage();
        const errors = watchErrors(page);
        const seen: {
            visit: { starts_at: string; ends_at: string; policy: { max_reschedules: number } };
        } = { visit: { starts_at: "", ends_at: "", policy: { max_reschedules: 0 } } };
        const unpaid = {
            reschedules_used: 0,
            can_move: true,
            deposit_cents: 0,
            deposit_status: "none",
        };
        await page.route(`**/manage/${links.manage}`, async (route) => {
            const response = await route.fetch();
            seen.visit = (await response.json()) as typeof seen.visit;
            await route.fulfill({ response, json: { ...seen.visit, ...unpaid } });
        });
        // the move is answered here, so the shared visit keeps its time and its moves
        await page.route(`**/manage/${links.manage}/reschedule`, async (route) => {
            const { starts_at } = route.request().postDataJSON() as { starts_at: string };
            const length = Date.parse(seen.visit.ends_at) - Date.parse(seen.visit.starts_at);
            await route.fulfill({
                json: {
                    ...seen.visit,
                    ...unpaid,
                    starts_at,
                    ends_at: new Date(Date.parse(starts_at) + length).toISOString(),
                    reschedules_used: 1,
                },
            });
        });
        await page.goto(`/m/${links.manage}`);
        await expect(page.getByText(m.title, { exact: true })).toBeVisible();
        const most = seen.visit.policy.max_reschedules;
        await expect(page.getByText(m.movesLeft(most), { exact: true })).toBeVisible();
        await page.getByRole("button", { name: m.reschedule, exact: true }).click();
        const times = page
            .getByRole("radiogroup", { name: b.openTimes, exact: true })
            .getByRole("radio");
        const none = page.getByText(m.noTimes, { exact: true });
        await expect(times.first().or(none)).toBeVisible();
        if (await none.isVisible()) {
            await page.getByRole("dialog").getByRole("button", { name: b.nextWeek }).last().click();
        }
        await times.first().click();
        await page.getByRole("button", { name: new RegExp(`^${m.confirmMove("")}`) }).click();
        await expect(
            page.getByRole("heading", { name: m.movedTitle, exact: true }),
        ).toBeInViewport();
        await expect(page.getByText(new RegExp(`${m.movedBodyPlain("").trim()}$`))).toBeVisible();
        await expect(page.getByText(m.movesLeft(most - 1), { exact: true })).toBeVisible();
        await page.unrouteAll({ behavior: "ignoreErrors" });
        await context.close();
        expect(errors).toEqual([]);
    },
);

test("a client's fresh tab offers no second payment while Stripe confirms the deposit, and a cancel then promises its refund only if it lands", async ({
    page,
}) => {
    const errors = watchErrors(page);
    const m = strings.publicManage;
    const amount = formatMoney(2500, "CAD");
    await page.route(`**/manage/${links.manage}`, async (route) => {
        const response = await route.fetch();
        await route.fulfill({
            response,
            json: {
                ...((await response.json()) as object),
                can_cancel: true,
                deposit_cents: 2500,
                deposit_status: "pending",
                deposit_due: false,
                deposit_paying: true,
                accepts_card: true,
            },
        });
    });
    // answered here, so the shared visit stays booked
    await page.route(`**/manage/${links.manage}/cancel`, async (route) => {
        await route.fulfill({ json: { deposit: "paying", refund_cents: 0 } });
    });
    await page.goto(`/m/${links.manage}`);
    await expect(page.getByText(m.depositPaying(amount), { exact: true })).toBeVisible();
    await expect(page.getByText(m.depositProcessing(amount), { exact: true })).toBeVisible();
    await expect(page.getByText(m.depositPaid(amount), { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: m.payDeposit })).toHaveCount(0);
    await page.getByRole("button", { name: m.cancel, exact: true }).click();
    await expect(page.getByText(m.cancelRefund(amount), { exact: true })).toBeVisible();
    await page.getByRole("button", { name: m.cancelConfirm, exact: true }).click();
    await expect(page.getByRole("heading", { name: m.canceledTitle, exact: true })).toBeVisible();
    await expect(page.getByText(m.canceledPaying(amount), { exact: true }).first()).toBeVisible();
    await page.unrouteAll({ behavior: "ignoreErrors" });
    expect(errors).toEqual([]);
});
