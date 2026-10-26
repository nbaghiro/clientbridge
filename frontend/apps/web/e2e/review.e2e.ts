import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import { runEmail } from "@clientbridge/config/e2e/run";

const r = strings.ui.review;
const p = strings.previews;

test("a reminder shows the message before it goes out, and cancelling sends nothing", async ({
    page,
}) => {
    test.setTimeout(180_000);
    const sends: string[] = [];
    page.on("request", (req) => {
        if (req.method() === "POST" && /\/v1\/invoices\/[^/]+\/(remind|send)$/.test(req.url()))
            sends.push(req.url());
    });
    await page.goto("/today");
    await page
        .getByRole("textbox", { name: strings.auth.email, exact: true })
        .fill(runEmail("hannah@birchbark.example"));
    await page.getByLabel(strings.auth.password, { exact: true }).fill("demo1234");
    await page.getByRole("button", { name: strings.auth.signIn, exact: true }).click();
    const main = page.getByRole("main");
    await main
        .getByRole("button", { name: strings.today.attention.overdueAction })
        .first()
        .click({ timeout: 60_000 });
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText(p.title)).toBeVisible();
    await expect(sheet.getByText(new RegExp(`^${r.emailTo("").trim()}`))).toBeVisible();
    await expect(sheet.getByRole("button", { name: p.sendReminder })).toBeEnabled();
    await sheet.getByRole("button", { name: strings.common.cancel }).click();
    await expect(page.getByText(p.title)).toHaveCount(0);
    expect(sends).toEqual([]);
});
