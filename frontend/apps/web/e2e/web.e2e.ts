import { strings } from "@clientbridge/app-core/public";
import { expect, type Page, test } from "@playwright/test";

const PAYMENTS_TABS = ["invoices", "sales", "gift-cards", "staff-pay", "reports"];
const SETUP_SECTIONS = [
    "business",
    "services",
    "team",
    "getting-paid",
    "online-booking",
    "reminders",
];

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
    await openAndClose(page, strings.bookings.newBooking);
    await navigate(page, "/schedule/classes");
    await navigate(page, "/schedule/series");
    await openAndClose(page, new RegExp(`^${strings.recurrences.newShort}$`));

    await navigate(page, "/clients");
    await openAndClose(page, strings.clients.addClient);
    await openFirstRow(page);

    for (const tab of PAYMENTS_TABS) await navigate(page, `/payments/${tab}`);
    await navigate(page, "/payments/invoices");
    await openAndClose(page, /new invoice/i);

    await navigate(page, "/inbox");
    await openAndClose(page, new RegExp(`^${strings.messaging.newMessage}$`));
    await openAndClose(page, new RegExp(`^${strings.messaging.broadcast}$`));

    for (const section of SETUP_SECTIONS) await navigate(page, `/setup/${section}`);
    await navigate(page, "/setup/services");
    await openFirstRow(page);

    expect(errors).toEqual([]);
});
