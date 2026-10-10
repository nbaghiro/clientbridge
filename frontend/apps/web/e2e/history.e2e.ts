import { strings } from "@clientbridge/app-core/public";
import { type Page, expect, test } from "@playwright/test";

const m = strings.messaging;

// a client-side route change, so the session and replica stay as they are
async function navigate(page: Page, path: string): Promise<void> {
    await page.evaluate((to) => {
        history.pushState({}, "", to);
        dispatchEvent(new PopStateEvent("popstate"));
    }, path);
}

test("history older than the device window is read from the API", async ({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto("/");
    await page
        .getByRole("textbox", { name: strings.auth.email, exact: true })
        .fill("hannah@birchbarkpets.ca");
    await page.getByLabel(strings.auth.password, { exact: true }).fill("demo1234");
    await page.getByRole("button", { name: strings.auth.signIn, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Hannah", {
        timeout: 60_000,
    });
    const visits = page.waitForResponse((r) => r.url().includes("/v1/bookings/visits"));
    await navigate(page, "/clients/cl_amelie/history");
    expect((await visits).status()).toBe(200);

    await navigate(page, "/inbox");
    const main = page.getByRole("main");
    await main.getByRole("navigation").getByRole("button").first().click({ timeout: 60_000 });
    const earlier = main.getByRole("button", { name: m.thread.showEarlier, exact: true });
    const messages = page.waitForResponse((r) => /\/v1\/threads\/[^/]+\/messages/.test(r.url()));
    await earlier.click();
    const page1 = await messages;
    expect(page1.status()).toBe(200);
    const body = (await page1.json()) as { more: boolean };
    if (!body.more) await expect(earlier).toBeHidden();
    await expect(main.getByText(m.thread.earlierFailed)).toHaveCount(0);
    expect(errors).toEqual([]);
});
