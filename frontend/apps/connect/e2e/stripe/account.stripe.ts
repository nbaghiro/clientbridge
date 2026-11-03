import { strings } from "@clientbridge/app-core/public";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { runPort } from "@clientbridge/config/e2e/run";
import { newBusiness, type NewBusiness } from "../../../web/e2e/support/business";
import { select } from "../../../web/e2e/support/db";
import { navigate, signIn } from "../../../web/e2e/support/session";
import { stripeHarness } from "./support/disputes";
import { merchant, stripeFrame } from "./support/payouts";
import { stripeReady } from "./support/provider";

test.use({ actionTimeout: 60_000 });

const g = strings.gettingPaid;

interface Banks {
    banks: { id: string; last4: string; default: boolean }[];
}

// Stripe's sign-in sends its code behind an hCaptcha, so a run stops at the sign-in itself
async function openStripeSignIn(context: BrowserContext, page: Page): Promise<Page> {
    for (let attempt = 0; attempt < 2; attempt++) {
        const frame = await stripeFrame(page, /^Sign in to see details$/);
        const opened = context.waitForEvent("page");
        await frame.getByRole("button", { name: "Sign in to see details", exact: true }).click();
        const popup = await opened;
        await popup.waitForLoadState();
        if (!popup.url().startsWith("chrome-error:")) return popup;
        await popup.close();
    }
    throw new Error("Stripe's sign-in window did not load");
}

test("STR-E13 bank details stay behind Stripe's sign-in, which sends its code to the account's phone", async ({
    browser,
}, info) => {
    await stripeReady();
    const before = await merchant<Banks>("banks");
    expect(before.banks.length).toBeGreaterThan(0);
    const context = await browser.newContext({
        baseURL: `http://localhost:${String(runPort("WEB_E2E_PORT"))}`,
    });
    try {
        const page = await context.newPage();
        await signIn(page);
        await navigate(page, "/setup/getting-paid");
        await page
            .getByRole("button", { name: strings.paymentAccount.manage, exact: true })
            .click();
        const component = await stripeFrame(page, /^Sign in to see details$/);
        for (const last4 of before.banks.map((bank) => bank.last4)) {
            // a whole number, since Stripe's font check draws hidden "0123456789" text
            await expect(component.getByText(new RegExp(`\\b${last4}\\b`))).toHaveCount(0);
        }

        const popup = await openStripeSignIn(context, page);
        expect(new URL(popup.url()).hostname).toBe("connect.stripe.com");
        await expect(popup.getByRole("heading", { name: "Welcome back" })).toBeVisible({
            timeout: 60_000,
        });
        await expect(
            popup.getByText(/sent to the phone number associated with the account/),
        ).toBeVisible();
        await expect(popup.getByRole("button", { name: "Send code", exact: true })).toBeVisible();
        await info.attach("stripe-sign-in", {
            body: await popup.screenshot({ fullPage: true }),
            contentType: "image/png",
        });
        await popup.close();
    } finally {
        await context.close();
    }
    expect(await merchant<Banks>("banks")).toEqual(before);
});

interface FreshAccount {
    account: string;
    charges_enabled: boolean;
    payouts_enabled: boolean;
    past_due: string[];
    currently_due: string[];
}

const TERMS = [
    "identity.attestations.terms_of_service.account.date",
    "identity.attestations.terms_of_service.account.ip",
];

/** The Stripe account the app created for a business this run made (`e2e.stripe onboarding`). */
function freshAccount(command: "account" | "close", business: NewBusiness): Promise<FreshAccount> {
    return stripeHarness<FreshAccount>(["onboarding", command, business.id]);
}

function webContext(browser: Browser): Promise<BrowserContext> {
    return browser.newContext({ baseURL: `http://localhost:${String(runPort("WEB_E2E_PORT"))}` });
}

/** A new owner presses Set up payments, which creates the business's Stripe account. */
async function startOnboarding(context: BrowserContext, page: Page): Promise<NewBusiness> {
    const business = await newBusiness(page, context.request, "stripe-onboarding");
    await navigate(page, "/setup/getting-paid");
    await expect(page.getByText(g.connectTitle, { exact: true })).toBeVisible({
        timeout: 60_000,
    });
    await page.getByRole("button", { name: g.connect, exact: true }).click();
    await expect
        .poll(
            async () =>
                (
                    await select<{ account: string | null }>`
                        SELECT stripe_account_id AS account FROM businesses
                        WHERE id = ${business.id}`
                )[0]?.account ?? "",
            { timeout: 60_000 },
        )
        .toMatch(/^acct_/);
    return business;
}

async function closeOnboarding(page: Page): Promise<void> {
    await page.getByRole("button", { name: strings.paymentAccount.close, exact: true }).click();
    await expect(page.getByRole("button", { name: g.finish, exact: true })).toBeVisible({
        timeout: 60_000,
    });
}

test("STR-E15 a new owner starts onboarding from Getting paid, sees what Stripe needs in plain words and reaches Stripe's sign-in", async ({
    browser,
}, info) => {
    await stripeReady();
    const context = await webContext(browser);
    let business: NewBusiness | undefined;
    try {
        const page = await context.newPage();
        business = await startOnboarding(context, page);
        const component = await stripeFrame(page, /^Add information$/);
        const opened = context.waitForEvent("page");
        await component.getByRole("button", { name: "Add information", exact: true }).click();
        const popup = await opened;
        await popup.waitForLoadState();
        expect(new URL(popup.url()).hostname).toBe("connect.stripe.com");
        await info.attach("stripe-onboarding-sign-in", {
            body: await popup.screenshot({ fullPage: true }),
            contentType: "image/png",
        });
        await popup.close();

        await closeOnboarding(page);
        for (const label of [
            g.reqBusinessType,
            g.reqProductDescription,
            g.reqPhone,
            g.reqExternalAccount,
        ]) {
            await expect(page.getByText(label, { exact: true })).toBeVisible();
        }
        // Stripe asks for the terms' date and IP apart, which the owner sees as one step
        await expect(page.getByText(g.reqTosAcceptance, { exact: true })).toHaveCount(1);
        await expect(page.getByText(g.reqOther, { exact: true })).toHaveCount(0);

        const account = await freshAccount("account", business);
        expect(account).toMatchObject({ charges_enabled: false, payouts_enabled: false });
        expect([...account.past_due, ...account.currently_due]).toEqual(
            expect.arrayContaining(["external_account", "identity.entity_type", ...TERMS]),
        );
    } finally {
        await context.close();
        if (business !== undefined) await freshAccount("close", business);
    }
});
