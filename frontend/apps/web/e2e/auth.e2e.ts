import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";

const a = strings.auth;

for (const width of [1440, 390]) {
    test(`sign-in, signup and reset validation at ${String(width)}px`, async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/");
        await expect(page.getByRole("heading", { name: a.signInTitle })).toBeVisible();

        const email = page.getByRole("textbox", { name: a.email, exact: true });
        const password = page.getByLabel(a.password, { exact: true });
        await email.fill("");
        await password.fill("");
        await page.getByRole("button", { name: a.signIn, exact: true }).click();
        await expect(page.getByText(a.emailRequired, { exact: true })).toBeVisible();
        await expect(page.getByText(a.passwordRequired, { exact: true })).toBeVisible();

        await password.fill("example-password");
        await page.getByRole("checkbox", { name: a.showPassword }).check();
        await expect(password).toHaveAttribute("type", "text");
        await page.getByRole("checkbox", { name: a.showPassword }).uncheck();
        await expect(password).toHaveAttribute("type", "password");

        await page.getByRole("button", { name: a.continueWithGoogle }).click();
        await expect(page.getByText(a.googleNotConfigured, { exact: true })).toBeVisible();
        await page.getByRole("button", { name: a.createAnAccount, exact: true }).click();
        await expect(page.getByRole("heading", { name: a.signUpTitle })).toBeVisible();
        await page.getByLabel(a.newPassword, { exact: true }).fill("short");
        await page.getByRole("button", { name: a.createAccount, exact: true }).click();
        await expect(page.getByText(a.nameRequired, { exact: true })).toBeVisible();
        await expect(page.getByText(a.passwordShort, { exact: true })).toBeVisible();

        await page.getByRole("button", { name: a.signIn, exact: true }).click();
        await page.getByRole("button", { name: a.forgot, exact: true }).click();
        await expect(page.getByRole("heading", { name: a.resetTitle })).toBeVisible();
        await email.fill("not-an-email");
        await page.getByRole("button", { name: a.sendLink, exact: true }).click();
        await expect(page.getByText(a.emailInvalid, { exact: true })).toBeVisible();
        await page.getByRole("button", { name: a.backToSignIn, exact: true }).click();
        await expect(page.getByRole("heading", { name: a.signInTitle })).toBeVisible();
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        ).toBeLessThanOrEqual(0);
        expect(errors).toEqual([]);
    });
}

test("signup has its own entry link and invites explain a missing token", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("heading", { name: a.signUpTitle })).toBeVisible();
    await expect(page.getByRole("textbox", { name: a.email, exact: true })).toHaveValue("");
    await expect(page.getByLabel(a.newPassword, { exact: true })).toHaveValue("");
    await page.goto("/accept-invite");
    await expect(page.getByRole("heading", { name: a.inviteTitle })).toBeVisible();
    await expect(page.getByText(a.inviteMissingCode, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: a.joinTeam })).toHaveCount(0);
});

test("existing business never flashes onboarding during sign-in or a slow reload", async ({
    page,
}) => {
    await page.addInitScript((title) => {
        sessionStorage.removeItem("onboarding-flashed");
        const observer = new MutationObserver(() => {
            if (
                [...document.querySelectorAll("h1")].some(
                    (node) => node.textContent.trim() === title,
                )
            ) {
                sessionStorage.setItem("onboarding-flashed", "yes");
            }
        });
        observer.observe(document, { subtree: true, childList: true });
    }, strings.business.onboarding.title);
    await page.goto("/");
    await page.getByRole("textbox", { name: a.email, exact: true }).fill("hannah@birchbarkpets.ca");
    await page.getByLabel(a.password, { exact: true }).fill("demo1234");
    await page.getByRole("button", { name: a.signIn, exact: true }).click();
    await expect(
        page
            .locator("aside")
            .getByRole("link", { name: strings.navigation.businessMenu, exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem("onboarding-flashed"))).toBeNull();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 300,
        downloadThroughput: 150000,
        uploadThroughput: 75000,
    });
    await page.reload();
    await expect(
        page
            .locator("aside")
            .getByRole("link", { name: strings.navigation.businessMenu, exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem("onboarding-flashed"))).toBeNull();
});
