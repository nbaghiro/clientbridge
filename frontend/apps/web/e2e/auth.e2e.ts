import { strings } from "@clientbridge/app-core/public";
import { type Page, expect } from "@playwright/test";
import { test } from "./support/session";
import {
    browserSession,
    deleteIdentity,
    mailedCode,
    mailedCodeForFlow,
    mailedVerificationLink,
    nativeSession,
    newAccount,
    ownerInvite,
    registerAccount,
    requestResetCode,
    sessionActive,
    signedInEmail,
    totp,
} from "./support/auth";
import { signUp, openBusiness } from "./support/business";
import { select } from "./support/db";
import { navigate, signIn } from "./support/session";
import { runEmail } from "@clientbridge/config/e2e/run";

const a = strings.auth;
// One second past the API's 30 s identity cache, the most an ended session can still be honoured.
const IDENTITY_CACHE_MS = 31_000;

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
    "XB-E2E-01 sign up, confirm the email with the mailed code, then open a business",
    { tag: "@browsers" },
    async ({ page, request }) => {
        const account = newAccount("signup");
        await signUp(page, request, account);
        await openBusiness(page, `${account.name}'s Beauty Studio`);
    },
);

test(
    "XB-E2E-02 recover a forgotten password with an emailed code, staying signed in only here",
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
        await page
            .getByLabel(a.code, { exact: true })
            .fill(await requestResetCode(page, request, account.email));
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
    "XB-E2E-03 changing the password signs out every other device",
    { tag: "@browsers" },
    async ({ page, request }) => {
        const account = newAccount("password");
        await signUp(page, request, account);
        await openBusiness(page, `${account.name}'s Beauty Studio`);
        const otherDevice = await nativeSession(request, account.email, account.password);
        expect(await sessionActive(request, otherDevice)).toBe(true);

        await openSecurity(page);
        const newPassword = page.getByLabel(a.securityNewPassword, { exact: true });
        const change = page.getByRole("button", { name: a.securityChangePassword, exact: true });
        await newPassword.fill(account.password);
        await change.click();
        await expect(page.getByText(a.flowMessages[4000039], { exact: true })).toBeVisible();
        expect(await sessionActive(request, otherDevice)).toBe(true);

        await newPassword.fill(`${account.password}-new`);
        await change.click();
        await expect(page.getByText(a.flowMessages[1050001], { exact: true })).toBeVisible();

        expect(await sessionActive(request, otherDevice)).toBe(false);
        await page.reload();
        await expect(
            page.getByRole("heading", { name: strings.navigation.setupSections.security }),
        ).toBeVisible();
    },
);

test(
    "XB-E2E-04 turn on an authenticator app, then sign in with its code",
    { tag: "@browsers" },
    async ({ page, request }) => {
        const account = newAccount("totp");
        await signUp(page, request, account);
        await openBusiness(page, `${account.name}'s Beauty Studio`);
        await openSecurity(page);
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

test("ID-E2E-06 Google sign-in on a password account's address opens the same account and business", async ({
    page,
    request,
}) => {
    const account = newAccount("google");
    const name = `${account.name}'s Beauty Studio`;
    await signUp(page, request, account);
    await openBusiness(page, name);
    const viaGoogle = async (): Promise<void> => {
        await page.context().clearCookies();
        await page.goto("/");
        await page.getByRole("button", { name: a.continueWithGoogle }).click();
        // the test tier's Google stand-in signs in whatever address is typed
        await page.waitForURL(/\/authorize\?/);
        await page.getByRole("textbox", { name: "Email", exact: true }).fill(account.email);
        await page.getByRole("button", { name: "Continue", exact: true }).click();
    };
    await viaGoogle();
    await expect(page.getByText(a.flowMessages[1010016], { exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: a.email, exact: true }).fill(account.email);
    await page.getByLabel(a.password, { exact: true }).fill(account.password);
    await page.getByRole("button", { name: a.signIn, exact: true }).click();
    await expect(page).toHaveURL(/\/today$/, { timeout: 60_000 });
    // once linked, Google alone opens the account
    await viaGoogle();
    await expect(page).toHaveURL(/\/today$/, { timeout: 60_000 });
    await navigate(page, "/setup/business");
    await expect(
        page.getByRole("textbox", { name: strings.business.nameLabel, exact: true }),
    ).toHaveValue(name, { timeout: 60_000 });
    expect(await signedInEmail(page)).toBe(account.email);
    const users = await select<{ count: number }>`
        select count(*)::int as count from users where email = ${account.email}`;
    expect(users[0]?.count).toBe(1);
});

test("ID-E2E-02 a wrong code then the mailed one confirms the email, and a second browser reaches the same business", async ({
    page,
    request,
    browser,
}) => {
    const account = newAccount("confirm");
    const name = `${account.name}'s Beauty Studio`;
    await startSignUp(page, account);
    const mailed = await mailedCode(request, account.email, "verification");
    const wrong = otherCode(mailed);
    await page.getByLabel(a.code, { exact: true }).fill(wrong);
    await page.getByRole("button", { name: a.verify, exact: true }).click();
    await expect(page.getByText(a.flowMessages[4070006], { exact: true })).toBeVisible();
    await page.getByLabel(a.code, { exact: true }).fill(mailed);
    await page.getByRole("button", { name: a.verify, exact: true }).click();
    await openBusiness(page, name);

    const second = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
        const other = await second.newPage();
        await signIn(other, account);
        await navigate(other, "/setup/business");
        await expect(
            other.getByRole("textbox", { name: strings.business.nameLabel, exact: true }),
        ).toHaveValue(name, { timeout: 60_000 });
    } finally {
        await second.close();
    }
});

test("ID-E2E-03 recovery refuses the old session's next business action once the identity cache expires", async ({
    page,
    request,
    browser,
}) => {
    const account = newAccount("revoked");
    const name = `${account.name}'s Beauty Studio`;
    await signUp(page, request, account);
    await openBusiness(page, name);
    await navigate(page, "/setup/business");
    const nameField = page.getByRole("textbox", { name: strings.business.nameLabel, exact: true });
    await expect(nameField).toHaveValue(name, { timeout: 60_000 });
    await nameField.fill(`${name} Renamed`);

    const second = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
        const recovering = await second.newPage();
        await recovering.goto("/login");
        await recovering.getByRole("button", { name: a.forgot, exact: true }).click();
        await recovering
            .getByLabel(a.code, { exact: true })
            .fill(await requestResetCode(recovering, request, account.email));
        await recovering.getByRole("button", { name: a.checkCode, exact: true }).click();
        await recovering.getByLabel(a.newPassword, { exact: true }).fill(`${account.password}-new`);
        await recovering.getByRole("button", { name: a.savePassword, exact: true }).click();
        await expect(recovering).toHaveURL(/\/today$/, { timeout: 60_000 });

        await page.waitForTimeout(IDENTITY_CACHE_MS);
        await page
            .locator("form", { has: nameField })
            .getByRole("button", { name: strings.business.saveDetails, exact: true })
            .click();
        await expect(page.getByRole("heading", { name: a.signInTitle })).toBeVisible();
        const [business] = await select<{ name: string }>`
            SELECT b.name FROM businesses b
            JOIN staff s ON s.business_id = b.id
            JOIN users u ON u.id = s.user_id
            WHERE u.email = ${account.email}`;
        expect(business?.name).toBe(name);

        await navigate(recovering, "/setup/business");
        await expect(
            recovering.getByRole("textbox", { name: strings.business.nameLabel, exact: true }),
        ).toHaveValue(name, { timeout: 60_000 });
    } finally {
        await second.close();
    }
});

test("ID-E2E-04 a backup code works once, and new codes retire the old ones", async ({
    page,
    request,
}) => {
    const useCode = async (code: string) => {
        await passwordStep(page, account);
        await expect(page.getByRole("heading", { name: a.mfaTitle })).toBeVisible();
        await page.getByLabel(a.mfaLookup, { exact: true }).fill(code);
        await page.getByRole("button", { name: a.confirm, exact: true }).click();
    };
    const refused = page.getByText(a.flowMessages[4000016], { exact: true });
    const business = page
        .locator("aside")
        .getByRole("link", { name: strings.navigation.businessMenu, exact: true });
    const account = newAccount("backup");
    await signUp(page, request, account);
    await openBusiness(page, `${account.name}'s Beauty Studio`);
    await openSecurity(page);
    const [first = "", second = "", third = ""] = await newBackupCodes(page);

    await useCode(first);
    await expect(business).toBeVisible({ timeout: 60_000 });

    await useCode(first);
    await expect(page.getByText(a.flowMessages[4000012], { exact: true })).toBeVisible();
    await expect(business).toHaveCount(0);

    await page.getByLabel(a.mfaLookup, { exact: true }).fill(second);
    await page.getByRole("button", { name: a.confirm, exact: true }).click();
    await expect(business).toBeVisible({ timeout: 60_000 });

    await openSecurity(page);
    await page.getByRole("button", { name: a.securityShowCodes, exact: true }).click();
    const codes = page.locator("ul.font-mono li");
    await expect(codes.filter({ hasText: a.backupCodeUsed("").trim() })).toHaveCount(2);
    await expect(codes.filter({ hasText: third })).toHaveCount(1);
    await expect(page.getByText("Secret was used")).toHaveCount(0);

    await openSecurity(page);
    const [fresh = ""] = await newBackupCodes(page);
    await useCode(third);
    await expect(refused).toBeVisible();
    await expect(business).toHaveCount(0);
    await page.getByLabel(a.mfaLookup, { exact: true }).fill(fresh);
    await page.getByRole("button", { name: a.confirm, exact: true }).click();
    await expect(business).toBeVisible({ timeout: 60_000 });
});

test("a reset left half-finished by a reload can start again", async ({ page, request }) => {
    const account = newAccount("reset-reload");
    await signUp(page, request, account);
    await expect(
        page.getByRole("heading", { name: strings.business.onboarding.title }),
    ).toBeVisible();
    await page.context().clearCookies();
    await page.goto("/login");
    const reset = async (previous?: string): Promise<string> => {
        const code = await requestResetCode(page, request, account.email, previous);
        await page.getByLabel(a.code, { exact: true }).fill(code);
        await page.getByRole("button", { name: a.checkCode, exact: true }).click();
        await expect(page.getByRole("heading", { name: a.resetPasswordTitle })).toBeVisible();
        return code;
    };
    await page.getByRole("button", { name: a.forgot, exact: true }).click();
    const first = await reset();
    await page.reload();
    await reset(first);
});

test("a reset closed at its last step leaves nobody signed in on the next load", async ({
    context,
    page,
    request,
}) => {
    const account = newAccount("reset-closed");
    await registerAccount(request, account);
    await page.goto("/login");
    await page.getByRole("button", { name: a.forgot, exact: true }).click();
    await page
        .getByLabel(a.code, { exact: true })
        .fill(await requestResetCode(page, request, account.email));
    await page.getByRole("button", { name: a.checkCode, exact: true }).click();
    await expect(page.getByRole("heading", { name: a.resetPasswordTitle })).toBeVisible();
    expect(await signedInEmail(page)).toBe(account.email);
    await page.close();

    const next = await context.newPage();
    await next.goto("/");
    await expect(next.getByRole("heading", { name: a.signInTitle })).toBeVisible();
    await expect.poll(() => signedInEmail(next)).toBeNull();
    await next.reload();
    await expect(next.getByRole("heading", { name: a.signInTitle })).toBeVisible();
    expect(await signedInEmail(next)).toBeNull();
});

test("the credentials typed decide the account, whatever session the browser still holds", async ({
    page,
    request,
}) => {
    const left = newAccount("typed-left");
    const typed = newAccount("typed-other");
    await registerAccount(request, left);
    await registerAccount(request, typed);
    // a full session the sign-in page knows nothing of, as another tab's sign-in leaves
    const leaveSession = async (): Promise<void> => {
        await browserSession(page, left.email, left.password);
        await page.goto("/login");
        await expect(page.getByRole("heading", { name: a.signInTitle })).toBeVisible();
        expect(await signedInEmail(page)).toBe(left.email);
    };
    const signInAs = async (email: string, password: string): Promise<void> => {
        await page.getByRole("textbox", { name: a.email, exact: true }).fill(email);
        await page.getByLabel(a.password, { exact: true }).fill(password);
        await page.getByRole("button", { name: a.signIn, exact: true }).click();
    };

    await leaveSession();
    await signInAs(left.email, "not-the-password");
    await expect(page.getByText(a.flowMessages[4000006], { exact: true })).toBeVisible();
    expect(await signedInEmail(page)).toBeNull();

    await leaveSession();
    await signInAs(typed.email, typed.password);
    await expect(page.getByRole("heading", { name: a.verifyTitle })).toBeVisible({
        timeout: 60_000,
    });
    expect(await signedInEmail(page)).toBe(typed.email);
});

function otherCode(code: string): string {
    return code.replace(/\d$/, (digit) => String((Number(digit) + 1) % 10));
}

/** Six wrong tries end a code's flow; each waits for the auth service, since the message repeats. */
async function useUpCode(page: Page, wrong: string, submit: string): Promise<void> {
    for (let attempt = 0; attempt < 6; attempt++) {
        await page.getByLabel(a.code, { exact: true }).fill(wrong);
        await Promise.all([
            page.waitForResponse(
                (r) => r.url().includes("/self-service/") && r.request().method() === "POST",
            ),
            page.getByRole("button", { name: submit, exact: true }).click(),
        ]);
    }
}

test("too many wrong codes at sign-up ask for a new one, and it confirms the email", async ({
    page,
    request,
}) => {
    const account = newAccount("too-often-signup");
    await startSignUp(page, account);
    const first = await mailedCode(request, account.email, "verification");
    await useUpCode(page, otherCode(first), a.verify);
    await expect(page.getByText(a.codeTooOften, { exact: true })).toBeVisible();

    await page.getByLabel(a.code, { exact: true }).fill(first);
    await page.getByRole("button", { name: a.verify, exact: true }).click();
    await expect(page.getByText(a.codeTooOften, { exact: true })).toBeVisible();

    const again = page.getByRole("button", { name: a.resendCode, exact: true });
    await expect(again).toBeEnabled();
    await again.click();
    await expect(page.getByText(a.codeTooOften, { exact: true })).toHaveCount(0);
    await page
        .getByLabel(a.code, { exact: true })
        .fill(await mailedCode(request, account.email, "verification", first));
    await page.getByRole("button", { name: a.verify, exact: true }).click();
    await expect(
        page.getByRole("heading", { name: strings.business.onboarding.title }),
    ).toBeVisible({ timeout: 60_000 });
});

test("too many wrong codes on a reset ask for a new one, and it resets the password", async ({
    page,
    request,
}) => {
    const account = newAccount("too-often-reset");
    await registerAccount(request, account);
    await page.goto("/login");
    await page.getByRole("button", { name: a.forgot, exact: true }).click();
    const first = await requestResetCode(page, request, account.email);
    await useUpCode(page, otherCode(first), a.checkCode);
    await expect(page.getByText(a.codeTooOften, { exact: true })).toBeVisible();

    await page.getByLabel(a.code, { exact: true }).fill(first);
    await page.getByRole("button", { name: a.checkCode, exact: true }).click();
    await expect(page.getByText(a.codeTooOften, { exact: true })).toBeVisible();

    const again = page.getByRole("button", { name: a.resendCode, exact: true });
    await expect(again).toBeEnabled();
    await again.click();
    await expect(page.getByText(a.codeTooOften, { exact: true })).toHaveCount(0);
    await page
        .getByLabel(a.code, { exact: true })
        .fill(await mailedCode(request, account.email, "password reset", first));
    await page.getByRole("button", { name: a.checkCode, exact: true }).click();
    await expect(page.getByRole("heading", { name: a.resetPasswordTitle })).toBeVisible();
    await page.getByLabel(a.newPassword, { exact: true }).fill(account.password);
    await page.getByRole("button", { name: a.savePassword, exact: true }).click();
    await expect(page.getByText(a.flowMessages[4000039], { exact: true })).toBeVisible();
});

test("a password reset on an account with a second factor confirms it, then saves the new password", async ({
    page,
    request,
}) => {
    const account = newAccount("reset-second-factor");
    await signUp(page, request, account);
    await openBusiness(page, `${account.name}'s Beauty Studio`);
    await openSecurity(page);
    const [first = "", second = ""] = await newBackupCodes(page);

    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByRole("button", { name: a.forgot, exact: true }).click();
    await page
        .getByLabel(a.code, { exact: true })
        .fill(await requestResetCode(page, request, account.email));
    await page.getByRole("button", { name: a.checkCode, exact: true }).click();

    await expect(page.getByRole("heading", { name: a.mfaTitle })).toBeVisible();
    await expect(page.getByText(a.resetMfaSubtitle, { exact: true })).toBeVisible();
    await page.getByLabel(a.mfaLookup, { exact: true }).fill("not-a-backup-code");
    await page.getByRole("button", { name: a.confirm, exact: true }).click();
    await expect(page.getByText(a.flowMessages[4000016], { exact: true })).toBeVisible();
    await page.getByLabel(a.mfaLookup, { exact: true }).fill(first);
    await page.getByRole("button", { name: a.confirm, exact: true }).click();

    await expect(page.getByRole("heading", { name: a.resetPasswordTitle })).toBeVisible();
    const replaced = `${account.password}-new`;
    await page.getByLabel(a.newPassword, { exact: true }).fill(replaced);
    await page.getByRole("button", { name: a.savePassword, exact: true }).click();
    await expect(
        page.locator("aside").getByRole("link", { name: strings.navigation.businessMenu }),
    ).toBeVisible({ timeout: 60_000 });

    await passwordStep(page, account);
    await expect(page.getByText(a.flowMessages[4000006], { exact: true })).toBeVisible();
    await passwordStep(page, { email: account.email, password: replaced });
    await expect(page.getByRole("heading", { name: a.mfaTitle })).toBeVisible();
    await page.getByLabel(a.mfaLookup, { exact: true }).fill(second);
    await page.getByRole("button", { name: a.confirm, exact: true }).click();
    await expect(
        page.locator("aside").getByRole("link", { name: strings.navigation.businessMenu }),
    ).toBeVisible({ timeout: 60_000 });
});

test("ID-E2E-05 add a security key, sign in with it, and a removed key is refused", async ({
    page,
    request,
    browser,
}) => {
    const authenticator = async (target: Page) => {
        const cdp = await target.context().newCDPSession(target);
        await cdp.send("WebAuthn.enable");
        const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
            options: {
                protocol: "ctap2",
                transport: "internal",
                hasResidentKey: true,
                hasUserVerification: true,
                isUserVerified: true,
                automaticPresenceSimulation: true,
            },
        });
        return { cdp, authenticatorId };
    };
    const business = page
        .locator("aside")
        .getByRole("link", { name: strings.navigation.businessMenu, exact: true });
    const owner = await authenticator(page);
    const account = newAccount("key");
    await signUp(page, request, account);
    await openBusiness(page, `${account.name}'s Beauty Studio`);

    await openSecurity(page);
    const add = page.getByRole("button", { name: a.securityAddKey, exact: true });
    await add.click();
    await expect(page.getByText(a.securityKeyNameRequired, { exact: true })).toBeVisible();
    await page.getByLabel(a.securityKeyName, { exact: true }).fill("Work laptop");
    await add.click();
    const remove = page.getByRole("button", {
        name: a.securityRemoveKey("Work laptop"),
        exact: true,
    });
    await expect(remove).toBeVisible();

    await passwordStep(page, account);
    await expect(page.getByRole("heading", { name: a.mfaTitle })).toBeVisible();
    await page.getByRole("button", { name: a.confirm, exact: true }).click();
    await expect(business).toBeVisible({ timeout: 60_000 });
    await openSecurity(page);

    // A second browser holds the key and reaches its prompt first, so the server itself must refuse it.
    const { credentials } = await owner.cdp.send("WebAuthn.getCredentials", {
        authenticatorId: owner.authenticatorId,
    });
    const second = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
        const stale = await second.newPage();
        const holder = await authenticator(stale);
        for (const credential of credentials)
            await holder.cdp.send("WebAuthn.addCredential", {
                authenticatorId: holder.authenticatorId,
                credential,
            });
        await passwordStep(stale, account);
        await expect(stale.getByRole("heading", { name: a.mfaTitle })).toBeVisible();

        await remove.click();
        await expect(remove).toHaveCount(0);

        await stale.getByRole("button", { name: a.confirm, exact: true }).click();
        await expect(stale.getByText(a.mfaKeyRefused, { exact: true })).toBeVisible();
        await expect(
            stale
                .locator("aside")
                .getByRole("link", { name: strings.navigation.businessMenu, exact: true }),
        ).toHaveCount(0);
    } finally {
        await second.close();
    }

    await passwordStep(page, account);
    await expect(business).toBeVisible({ timeout: 60_000 });
});

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

async function passwordStep(
    page: Page,
    account: { email: string; password: string },
): Promise<void> {
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByRole("textbox", { name: a.email, exact: true }).fill(account.email);
    await page.getByLabel(a.password, { exact: true }).fill(account.password);
    await page.getByRole("button", { name: a.signIn, exact: true }).click();
}

async function newBackupCodes(page: Page): Promise<string[]> {
    await page.getByRole("button", { name: a.securityNewCodes, exact: true }).click();
    const shown = page.locator("ul.font-mono li");
    await expect(shown).not.toHaveCount(0);
    const codes = await shown.allTextContents();
    await page.getByRole("button", { name: a.securityConfirmCodes, exact: true }).click();
    await expect(shown).toHaveCount(0);
    return codes;
}

async function openSecurity(page: Page): Promise<void> {
    await page.goto("/setup/security");
    // the photo control appears once the replica knows the viewer's role and pushes the form down
    await expect(
        page.getByRole("button", { name: strings.files.addPhoto, exact: true }),
    ).toBeVisible();
}

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

test("a new account stays on the code step, through a reload, until its email is confirmed", async ({
    page,
    request,
}) => {
    const account = newAccount("reload");
    await startSignUp(page, account);
    await expect(page).toHaveURL(/\/verify\?flow=/);
    const flowId = new URL(page.url()).searchParams.get("flow") ?? "";
    await page.reload();
    await expect(page.getByRole("heading", { name: a.verifyTitle })).toBeVisible();
    await expect(
        page.getByRole("heading", { name: strings.business.onboarding.title }),
    ).toHaveCount(0);
    await page
        .getByLabel(a.code, { exact: true })
        .fill(await mailedCodeForFlow(request, account.email, flowId));
    await page.getByRole("button", { name: a.verify, exact: true }).click();
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
    // The API refuses this live session (409) until the email is verified, so only the code step shows.
    await expect(page).toHaveURL(/\/verify\?flow=/);
    await expect(page.getByRole("button", { name: strings.navigation.signOut })).toBeVisible();
    const flowId = new URL(page.url()).searchParams.get("flow") ?? "";
    await page
        .getByLabel(a.code, { exact: true })
        .fill(await mailedCodeForFlow(request, account.email, flowId));
    await page.getByRole("button", { name: a.verify, exact: true }).click();
    await expect(
        page
            .locator("aside")
            .getByRole("link", { name: strings.navigation.businessMenu, exact: true }),
    ).toBeVisible({ timeout: 60_000 });
});

test("an invitee confirms the email first, then lands back on the invite and joins", async ({
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
        await page
            .getByLabel(a.code, { exact: true })
            .fill(await mailedCode(request, account.email, "verification"));
        await page.getByRole("button", { name: a.verify, exact: true }).click();
        await expect(page).toHaveURL(/\/accept-invite$/);
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
        // The tab shares the unconfirmed session, so the link confirms it and continues on its own.
        await expect(tab).toHaveURL(/\/accept-invite$/, { timeout: 30_000 });
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
