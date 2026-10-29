import { strings } from "@clientbridge/app-core/public";
import { replicaFilename } from "@clientbridge/sync";
import { expect } from "@playwright/test";
import { newAccount } from "./support/auth";
import { signUp } from "./support/business";
import { showOnly } from "./support/billing";
import { requireLocalMail } from "./support/evidence";
import { navigate, opfsEntries, signIn, test } from "./support/session";
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
    await main
        .getByRole("navigation")
        .getByRole("button")
        .filter({ has: page.getByText("Amélie Tremblay", { exact: true }) })
        .click({ timeout: 60_000 });
    // the demo welcomed Amélie before the months this device syncs
    const welcome = main.getByText("Welcome to Birchbark! Text us here any time about Bella.", {
        exact: true,
    });
    await expect(welcome).toHaveCount(0);
    const earlier = main.getByRole("button", { name: m.thread.showEarlier, exact: true });
    const messages = page.waitForResponse((r) => /\/v1\/threads\/[^/]+\/messages/.test(r.url()));
    await earlier.click();
    const page1 = await messages;
    expect(page1.status()).toBe(200);
    const body = (await page1.json()) as { more: boolean };
    await expect(welcome).toBeVisible();
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
    await expect(main.getByRole("combobox", { name: strings.ui.listShow })).toBeVisible({
        timeout: 60_000,
    });
    await showOnly(page, new RegExp(`^${s.segments.open}`));
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
            await navigate(page, "/setup/security");
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
            await expect(page).toHaveURL(/\/setup\/security$/);
            await expect(choose).toBeVisible({ timeout: 20_000 });
            await expect(stuck).toHaveCount(0);
            // no Playwright engine restored the page from the back-forward cache, so its events do
            await page.evaluate(() => {
                dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
                dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
            });
            await expect(choose).toBeVisible({ timeout: 20_000 });
            await expect(stuck).toHaveCount(0);
            await expect(
                page.getByText(strings.sync.problems.storage, { exact: true }),
            ).toHaveCount(0);
        },
    );
});

test(
    "XB-E2E-20 sign-out with a second tab open removes the account's replica files, and the next sign-in opens a new one",
    { tag: "@browsers" },
    async ({ page, context, request, browserName }) => {
        test.setTimeout(240_000);
        requireLocalMail();
        const account = newAccount("replica");
        const o = strings.business.onboarding;
        // Playwright's WebKit shares one OPFS across profiles, so other cases' replicas can appear here
        let files: string[] = [];
        const mine = async (): Promise<string[]> =>
            (await opfsEntries(page)).filter((name) => files.includes(name));
        await page.goto("/");
        await signUp(page, request, account);
        const onboarding = page.getByRole("heading", { name: o.title });
        await expect(onboarding).toBeVisible({ timeout: 60_000 });
        const userId = await page.evaluate(() => localStorage.getItem("cb_user"));
        expect(userId).not.toBeNull();
        const name = replicaFilename({ userId: userId ?? "", scope: new URL(page.url()).origin });
        files = [name, `${name}-journal`, `${name}-wal`];
        // until every engine keeps the replica in OPFS (web-storage T9), only WebKit has files here
        const kept = browserName === "webkit" ? files : [];
        expect(await mine()).toEqual(kept);

        const second = await context.newPage();
        await second.goto("/");
        await expect(second.getByRole("heading", { name: o.title })).toBeVisible({
            timeout: 60_000,
        });
        await page.getByRole("button", { name: o.signOut, exact: true }).click();
        const email = page.getByRole("textbox", { name: strings.auth.email, exact: true });
        await expect(email).toBeVisible({ timeout: 30_000 });
        // the session ends in every tab, so the second leaves the replica too
        await expect(
            second.getByRole("textbox", { name: strings.auth.email, exact: true }),
        ).toBeVisible({ timeout: 30_000 });
        await page.reload();
        await expect(email).toBeVisible();
        await expect.poll(mine).toEqual([]);
        expect(await page.evaluate(() => localStorage.getItem("cb_replica_trash"))).toBeNull();

        await email.fill(account.email);
        await page.getByLabel(strings.auth.password, { exact: true }).fill(account.password);
        await page.getByRole("button", { name: strings.auth.signIn, exact: true }).click();
        await expect(onboarding).toBeVisible({ timeout: 60_000 });
        expect(await mine()).toEqual(kept);
    },
);
