import { strings } from "@clientbridge/app-core/public";
import { type Page, expect, test } from "@playwright/test";
import {
    deleteIdentity,
    mailedCode,
    mailedCodeForFlow,
    mailedVerificationLink,
    nativeSession,
    newAccount,
    ownerInvite,
    sessionActive,
    totp,
} from "./support/auth";
import { signUp, openBusiness } from "./support/business";
import { runEmail } from "@clientbridge/config/e2e/run";

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

        await expect(page.getByRole("button", { name: a.continueWithGoogle })).toBeVisible();
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
        await page.getByRole("button", { name: a.sendCode, exact: true }).click();
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
    await expect(page.getByRole("heading", { name: strings.staff.inviteTitle })).toBeVisible();
    await expect(
        page.getByText(strings.staff.inviteProblem.invalid, { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: strings.staff.inviteJoin })).toHaveCount(0);
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
    await page
        .getByRole("textbox", { name: a.email, exact: true })
        .fill(runEmail("hannah@birchbark.example"));
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

test(
    "sign up, confirm the email with the mailed code, then open a business",
    { tag: "@browsers" },
    async ({ page, request }) => {
        const account = newAccount("signup");
        await signUp(page, request, account);
        await openBusiness(page, `${account.name}'s Beauty Studio`);
    },
);

test(
    "recover a forgotten password with an emailed code, staying signed in only here",
    { tag: "@browsers" },
    async ({ page, request }) => {
        const account = newAccount("recover");
        await signUp(page, request, account);
        await expect(
            page.getByRole("heading", { name: strings.business.onboarding.title }),
        ).toBeVisible();
        const otherDevice = await nativeSession(request, account.email, account.password);
        await page.context().clearCookies();
        await page.goto("/login");
        await page.getByRole("button", { name: a.forgot, exact: true }).click();
        await expect(page.getByRole("heading", { name: a.resetTitle })).toBeVisible();
        await page.getByRole("textbox", { name: a.email, exact: true }).fill(account.email);
        await page.getByRole("button", { name: a.sendCode, exact: true }).click();
        await page
            .getByLabel(a.code, { exact: true })
            .fill(await mailedCode(request, account.email, "password reset"));
        await page.getByRole("button", { name: a.checkCode, exact: true }).click();
        await expect(page.getByRole("heading", { name: a.resetPasswordTitle })).toBeVisible();
        await page.getByLabel(a.newPassword, { exact: true }).fill(`${account.password}-new`);
        await page.getByRole("button", { name: a.savePassword, exact: true }).click();
        await expect(
            page.getByRole("heading", { name: strings.business.onboarding.title }),
        ).toBeVisible();
        expect(await sessionActive(request, otherDevice)).toBe(false);
    },
);

test(
    "changing the password signs out every other device",
    { tag: "@browsers" },
    async ({ page, request }) => {
        const account = newAccount("password");
        await signUp(page, request, account);
        await openBusiness(page, `${account.name}'s Beauty Studio`);
        const otherDevice = await nativeSession(request, account.email, account.password);
        expect(await sessionActive(request, otherDevice)).toBe(true);

        await page.goto("/setup/security");
        await page
            .getByLabel(a.securityNewPassword, { exact: true })
            .fill(`${account.password}-new`);
        await page.getByRole("button", { name: a.securityChangePassword, exact: true }).click();
        await expect(page.getByText(a.flowMessages[1050001], { exact: true })).toBeVisible();

        expect(await sessionActive(request, otherDevice)).toBe(false);
        await page.reload();
        await expect(page.getByRole("heading", { name: a.securityTitle })).toBeVisible();
    },
);

test(
    "turn on an authenticator app, then sign in with its code",
    { tag: "@browsers" },
    async ({ page, request }) => {
        const account = newAccount("totp");
        await signUp(page, request, account);
        await openBusiness(page, `${account.name}'s Beauty Studio`);
        await page.goto("/setup/security");
        const key = page.getByText(/^Or enter this key: /);
        const secret = ((await key.textContent()) ?? "").replace("Or enter this key: ", "").trim();
        await page.getByLabel(a.code, { exact: true }).fill(totp(secret));
        await page.getByRole("button", { name: a.securityTurnOn, exact: true }).click();
        await expect(page.getByText(a.securityTotpOn, { exact: true })).toBeVisible();

        await page.context().clearCookies();
        await page.goto("/login");
        await page.getByRole("textbox", { name: a.email, exact: true }).fill(account.email);
        await page.getByLabel(a.password, { exact: true }).fill(account.password);
        await page.getByRole("button", { name: a.signIn, exact: true }).click();
        await expect(page.getByRole("heading", { name: a.mfaTitle })).toBeVisible();
        await page.getByLabel(a.mfaTotp, { exact: true }).fill(totp(secret));
        await page.getByRole("button", { name: a.confirm, exact: true }).click();
        await expect(
            page
                .locator("aside")
                .getByRole("link", { name: strings.navigation.businessMenu, exact: true }),
        ).toBeVisible({ timeout: 60_000 });
    },
);

test("an invite joins the account that signs up with the invited email", async ({
    page,
    request,
}) => {
    const s = strings.staff;
    const account = newAccount("invitee");
    const { token, cleanup } = await ownerInvite(request, account.email);
    await page.goto(`/accept-invite?token=${token}`);
    await expect(page.getByText(s.inviteFor(account.email), { exact: false })).toBeVisible();
    await page.getByRole("button", { name: s.inviteSignUp, exact: true }).click();
    await expect(page.getByRole("textbox", { name: a.email, exact: true })).toHaveValue(
        account.email,
    );
    try {
        await signUp(page, request, account);
        await page.getByRole("button", { name: s.inviteJoin, exact: true }).click();
        await expect(
            page
                .locator("aside")
                .getByRole("link", { name: strings.navigation.businessMenu, exact: true }),
        ).toBeVisible({ timeout: 60_000 });
    } finally {
        await cleanup();
    }
});

test("an invite refuses an account with a different email", async ({ page, request }) => {
    const s = strings.staff;
    const { token, cleanup } = await ownerInvite(request, newAccount("invited").email);
    try {
        await signUp(page, request, newAccount("other"));
        await expect(
            page.getByRole("heading", { name: strings.business.onboarding.title }),
        ).toBeVisible();
        await page.goto(`/accept-invite?token=${token}`);
        await page.getByRole("button", { name: s.inviteJoin, exact: true }).click();
        await expect(page.getByText(s.inviteProblem.mismatch, { exact: true })).toBeVisible();
    } finally {
        await cleanup();
    }
});

async function startSignUp(
    page: Page,
    account: { email: string; password: string; name: string },
): Promise<void> {
    if (!page.url().includes("/signup")) await page.goto("/signup");
    await page.getByLabel(a.name, { exact: true }).fill(account.name);
    await page.getByRole("textbox", { name: a.email, exact: true }).fill(account.email);
    await page.getByLabel(a.newPassword, { exact: true }).fill(account.password);
    await page.getByRole("button", { name: a.createAccount, exact: true }).click();
    await expect(page.getByRole("heading", { name: a.verifyTitle })).toBeVisible();
}

test("reloading while confirming the email keeps the new account signed in", async ({ page }) => {
    await startSignUp(page, newAccount("reload"));
    await page.reload();
    await expect(
        page.getByRole("heading", { name: strings.business.onboarding.title }),
    ).toBeVisible();
});

test("an account whose identity was recreated confirms its email instead of looping", async ({
    page,
    request,
}) => {
    const account = newAccount("relink");
    await signUp(page, request, account);
    await openBusiness(page, `${account.name}'s Beauty Studio`);
    await deleteIdentity(request, account.email);
    await page.goto("/signup");
    await expect(page.getByRole("heading", { name: a.signUpTitle })).toBeVisible();
    await startSignUp(page, account);
    // A reload here finds a live session the API refuses (409) until the email is verified.
    const sent = page.waitForRequest(
        (r) => r.method() === "POST" && r.url().includes("/self-service/verification?flow="),
    );
    await page.reload();
    await expect(page).toHaveURL(/\/verify$/);
    await expect(page.getByText(a.verifyToContinue, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: strings.navigation.signOut })).toBeVisible();
    const flowId = new URL((await sent).url()).searchParams.get("flow") ?? "";
    await page
        .getByLabel(a.code, { exact: true })
        .fill(await mailedCodeForFlow(request, account.email, flowId));
    await page.getByRole("button", { name: a.verify, exact: true }).click();
    await page.getByRole("button", { name: a.continue, exact: true }).click();
    await expect(
        page
            .locator("aside")
            .getByRole("link", { name: strings.navigation.businessMenu, exact: true }),
    ).toBeVisible({ timeout: 60_000 });
});

test("an invitee who skipped confirming the email verifies, then joins", async ({
    page,
    request,
}) => {
    const s = strings.staff;
    const account = newAccount("later");
    const { token, cleanup } = await ownerInvite(request, account.email);
    try {
        await page.goto(`/accept-invite?token=${token}`);
        await expect(page).toHaveURL(/\/accept-invite$/);
        await page.getByRole("button", { name: s.inviteSignUp, exact: true }).click();
        await startSignUp(page, account);
        const skipped = await mailedCode(request, account.email, "verification");
        await page.getByRole("button", { name: a.skipForNow, exact: true }).click();
        await page.getByRole("button", { name: s.inviteJoin, exact: true }).click();
        await page.getByRole("button", { name: s.inviteVerify, exact: true }).click();
        await expect(page.getByRole("heading", { name: a.verifyTitle })).toBeVisible();
        await page
            .getByLabel(a.code, { exact: true })
            .fill(await mailedCode(request, account.email, "verification", skipped));
        await page.getByRole("button", { name: a.verify, exact: true }).click();
        await page.getByRole("button", { name: a.continue, exact: true }).click();
        await page.getByRole("button", { name: s.inviteJoin, exact: true }).click();
        await expect(
            page
                .locator("aside")
                .getByRole("link", { name: strings.navigation.businessMenu, exact: true }),
        ).toBeVisible({ timeout: 60_000 });
    } finally {
        await cleanup();
    }
});

test("an invitee who verifies from the emailed link in a new tab lands back on the invite", async ({
    page,
    request,
    baseURL,
}) => {
    const s = strings.staff;
    const account = newAccount("newtab");
    const { token, cleanup } = await ownerInvite(request, account.email);
    try {
        await page.goto(`/accept-invite?token=${token}`);
        await page.getByRole("button", { name: s.inviteSignUp, exact: true }).click();
        await startSignUp(page, account);
        const tab = await page.context().newPage();
        // The auth service redirects to its configured web origin (:8700); the e2e app runs on its own port.
        await tab.route(/\/self-service\/verification\?code=/, async (route) => {
            const auth = await route.fetch({ maxRedirects: 0 });
            const target = new URL(auth.headers().location ?? "/");
            target.port = new URL(baseURL ?? "").port;
            await route.fulfill({ status: 303, headers: { location: target.href } });
        });
        await tab.goto(await mailedVerificationLink(request, account.email));
        await expect(tab).toHaveURL(/\/verify\?flow=/, { timeout: 15_000 });
        await expect(tab.getByRole("button", { name: a.continue, exact: true })).toBeVisible({
            timeout: 30_000,
        });
        await tab.getByRole("button", { name: a.continue, exact: true }).click();
        await expect(tab).toHaveURL(/\/accept-invite$/);
        await tab.getByRole("button", { name: s.inviteJoin, exact: true }).click();
        await expect(
            tab
                .locator("aside")
                .getByRole("link", { name: strings.navigation.businessMenu, exact: true }),
        ).toBeVisible({ timeout: 60_000 });
    } finally {
        await cleanup();
    }
});

test("auth errors offer a clean return to sign in", async ({ page }) => {
    await page.goto("/auth-error");
    await expect(page.getByRole("heading", { name: strings.auth.errorTitle })).toBeVisible();
    await page.getByRole("button", { name: strings.auth.backToSignIn }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: strings.auth.signInTitle })).toBeVisible();
});
