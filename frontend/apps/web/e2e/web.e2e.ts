import { strings } from "@clientbridge/app-core/public";
import { expect, type Page, test } from "@playwright/test";

const PAYMENTS_TABS = ["invoices", "sales", "gift-cards", "refunds", "staff-pay", "reports"];
const SETUP_SECTIONS = ["business", "services", "team", "getting-paid", "online-booking"];

async function navigate(page: Page, path: string): Promise<void> {
    await page.evaluate((to) => {
        history.pushState({}, "", to);
        dispatchEvent(new PopStateEvent("popstate"));
    }, path);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await page.waitForTimeout(500);
}

async function openAndClose(page: Page, opener: string | RegExp): Promise<void> {
    await page.locator("main").getByRole("button", { name: opener }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
}

async function openFirstRow(page: Page): Promise<void> {
    await page.locator("main button.block").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
}

test("an owner can open every page and dialog without errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
        if (m.type() === "error") errors.push(`console: ${m.text()}`);
    });

    await page.goto("/");
    await page.fill('input[type="email"]', "hannah@birchbarkpets.ca");
    await page.fill('input[type="password"]', "demo1234");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/today");
    await expect(page.locator("main").getByText(strings.today.schedule)).toBeVisible();
    await expect(page.locator("main").getByText(strings.today.needsYou)).toBeVisible();
    await page.waitForTimeout(6000);
    await expect(page.locator("main").getByText(strings.today.booked)).toBeVisible();

    const sidebar = page.locator("aside");
    await sidebar.getByRole("button", { name: strings.navigation.createMenu }).click();
    const menu = page.getByRole("menu", { name: strings.navigation.createMenu });
    await expect(menu.getByRole("menuitem")).toHaveCount(7);
    await page.keyboard.press("c");
    await expect(page).toHaveURL(/\/clients$/);
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog");
    await expect(palette.getByText(strings.search.jumpTo)).toBeVisible();
    await page.keyboard.type("ma");
    await expect(palette.getByText(strings.search.clients, { exact: true }).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    await sidebar.getByRole("button", { name: strings.notifications.title }).click();
    await expect(page.getByRole("dialog", { name: strings.notifications.title })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: strings.notifications.title })).toBeHidden();

    await sidebar.getByRole("link", { name: strings.navigation.schedule }).click();
    await expect(page).toHaveURL(/\/schedule$/);
    await sidebar.getByRole("link", { name: strings.navigation.today }).click();
    await expect(page).toHaveURL(/\/today$/);

    await navigate(page, "/schedule");
    await openAndClose(page, strings.bookings.newBookingButton);

    await navigate(page, "/clients");
    await openAndClose(page, strings.clients.addClient);
    await openFirstRow(page);

    for (const tab of PAYMENTS_TABS) await navigate(page, `/payments/${tab}`);
    await navigate(page, "/payments/invoices");
    await openAndClose(page, /new invoice/i);
    const desk = page.locator("main");
    await desk
        .getByText(new RegExp(`^${strings.billing.segments.open} \\d`))
        .first()
        .click();
    await desk.locator("button.block").first().click();
    const record = page.getByRole("dialog");
    await record.getByRole("button", { name: strings.billing.recordPayment }).click();
    await expect(page.getByRole("dialog")).toContainText(strings.billing.rec.howPaid);
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").getByRole("button", { name: strings.billing.pdf }).click();
    await expect(page.getByRole("dialog")).toContainText(strings.billing.doc.download);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toContainText(strings.billing.lines);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await desk.getByText(strings.billing.estimates, { exact: true }).first().click();
    await openFirstRow(page);
    await openAndClose(page, /new estimate/i);

    await navigate(page, "/payments/refunds");
    await desk
        .getByRole("button", { name: /Invoice #|Sale S-/ })
        .first()
        .click();
    await expect(desk.getByText(strings.refunds.reverses)).toBeVisible();
    await desk.getByRole("tab", { name: strings.refunds.tabs.notes }).click();
    await desk.getByRole("tab", { name: new RegExp(strings.refunds.tabs.disputes) }).click();

    await navigate(page, "/payments/gift-cards");
    await openAndClose(page, strings.entitlements.sellNew);
    await openAndClose(page, strings.entitlements.redeemGift);

    const s = strings.pos.desk;
    await navigate(page, "/payments/sales");
    const register = page.locator("main");
    await expect(register.getByText(s.todaysVisits)).toBeVisible();
    await register.locator("div.grid").last().getByRole("button").first().click();
    const ticket = page.getByRole("complementary", { name: s.ticket });
    await ticket.getByRole("button", { name: s.addDiscount, exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(s.discountScope);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await ticket.getByRole("button", { name: /^Charge/ }).click();
    await expect(page.getByRole("dialog")).toContainText(s.howPaying);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await ticket.getByRole("button", { name: s.clear }).click();
    await register.getByRole("tab", { name: s.ordersTitle }).click();
    await expect(register.getByText(s.openTickets)).toBeVisible();
    await register.getByRole("tab", { name: s.history }).click();
    await expect(register.getByText(s.todaySales)).toBeVisible();
    await register
        .getByRole("button", { name: /^S-\d+/ })
        .first()
        .click();
    await expect(page.getByRole("dialog")).toContainText(s.payments);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    await navigate(page, "/inbox");
    await openAndClose(page, new RegExp(`^${strings.messaging.newMessage}$`));
    await openAndClose(page, new RegExp(`^${strings.messaging.broadcast}$`));

    for (const section of SETUP_SECTIONS) await navigate(page, `/setup/${section}`);
    await navigate(page, "/setup/services");
    await openFirstRow(page);
    const main = page.locator("main");
    await main.getByRole("button", { name: strings.catalog.addItem }).click();
    const picker = page.getByRole("dialog");
    await picker.getByText(strings.catalog.kindPackage, { exact: true }).click();
    await picker.getByRole("button", { name: strings.catalog.next }).click();
    await expect(page.getByRole("dialog")).toContainText(strings.catalog.covers);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await main.getByRole("tab", { name: strings.catalog.views.products }).click();
    await openFirstRow(page);
    await main.getByRole("tab", { name: strings.catalog.views.inventory }).click();
    await expect(main.getByText(strings.catalog.inventorySubtitle)).toBeVisible();

    expect(errors).toEqual([]);
});
