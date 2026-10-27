import { strings } from "@clientbridge/app-core/public";
import { expect } from "@playwright/test";
import { navigate, signIn, test } from "./support/session";
import { offsiteLoadFailure } from "./support/shell";
import { demoId, runEmail } from "@clientbridge/config/e2e/run";

const m = strings.messaging;
const s = strings.billing;

test("history older than the device window is read from the API", async ({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (msg) => {
        if (msg.type() === "error" && !offsiteLoadFailure(msg)) errors.push(msg.text());
    });
    await page.goto("/");
    await page
        .getByRole("textbox", { name: strings.auth.email, exact: true })
        .fill(runEmail("hannah@birchbark.example"));
    await page.getByLabel(strings.auth.password, { exact: true }).fill("demo1234");
    await page.getByRole("button", { name: strings.auth.signIn, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Hannah", {
        timeout: 60_000,
    });
    const visits = page.waitForResponse((r) => r.url().includes("/v1/bookings/visits"));
    await navigate(page, `/clients/${demoId("cl_amelie")}/history`);
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

test("a recorded payment holds the invoice until its new balance reaches this device", async ({
    page,
}) => {
    test.setTimeout(180_000);
    // the command succeeds, but no payment is written, so the replica never catches up
    await page.route("**/v1/invoices/*/payments", (route) =>
        route.request().method() === "POST"
            ? route.fulfill({
                  json: {
                      payment_id: "pay_catch_up",
                      status: "succeeded",
                      amount_cents: 100,
                      change_cents: 0,
                      balance_cents: 0,
                      client_secret: null,
                  },
              })
            : route.continue(),
    );
    await page.goto("/payments/invoices");
    await page
        .getByRole("textbox", { name: strings.auth.email, exact: true })
        .fill(runEmail("hannah@birchbark.example"));
    await page.getByLabel(strings.auth.password, { exact: true }).fill("demo1234");
    await page.getByRole("button", { name: strings.auth.signIn, exact: true }).click();
    const main = page.getByRole("main");
    await main
        .getByRole("button", { name: new RegExp(`^${s.segments.open}`) })
        .click({ timeout: 60_000 });
    await main.locator("button.block").first().click();
    const record = page.getByRole("dialog");
    await record.getByRole("button", { name: s.recordPayment }).click();
    await page.getByRole("button", { name: new RegExp(`^${s.rec.cash} `) }).click();
    await page.getByRole("button", { name: /^Record \$/ }).click();
    await expect(page.getByText(s.rec.doneTitle)).toBeVisible();
    await page.getByRole("button", { name: strings.common.done, exact: true }).click();

    await expect(record.getByText(s.settling)).toBeVisible();
    await expect(record.getByRole("button", { name: s.recordPayment })).toHaveCount(0);
    await expect(record.getByText(s.settlingLate)).toBeVisible({ timeout: 20_000 });
    await expect(record.getByRole("button", { name: s.recordPayment })).toBeVisible();
});

test.describe(() => {
    // WebKit does not route requests from a page its service worker controls
    test.use({ serviceWorkers: "block" });

    test(
        "XB-E2E-21 a checkout that leaves the app reopens the replica on the return and on Back",
        { tag: "@browsers" },
        async ({ page, baseURL }) => {
            test.setTimeout(180_000);
            const back = new URL("/today", baseURL);
            await page.route("**/v1/plan/checkout", (route) =>
                route.request().method() === "POST"
                    ? route.fulfill({
                          json: { url: back.toString() },
                          headers: {
                              "access-control-allow-origin": back.origin,
                              "access-control-allow-credentials": "true",
                          },
                      })
                    : route.continue(),
            );
            await signIn(page, {
                email: runEmail("owner@cedarcoast.example"),
                password: "demo1234",
            });
            await navigate(page, "/setup/plan");
            const choose = page.getByRole("button", {
                name: strings.plans.choose(strings.plans.team),
                exact: true,
            });
            await choose.click({ timeout: 60_000 });

            const stuck = page.getByText(strings.sync.openStuckTitle, { exact: true });
            await expect(page).toHaveURL(/\/today$/);
            await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
            await expect(stuck).toHaveCount(0);

            await page.goBack();
            await expect(page).toHaveURL(/\/setup\/plan$/);
            await expect(choose).toBeVisible({ timeout: 20_000 });
            await expect(stuck).toHaveCount(0);
        },
    );
});
