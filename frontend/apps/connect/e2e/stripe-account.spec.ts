import { strings } from "@clientbridge/app-core/public";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { runPort } from "@clientbridge/config/e2e/run";
import { navigate, signIn } from "../../web/e2e/support/session";
import { merchant, stripeFrame } from "./stripe-payouts";
import { stripeReady } from "./stripe-provider";

test.use({ actionTimeout: 60_000 });

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
        const retry = page.getByRole("button", { name: strings.paymentAccount.retry, exact: true });
        // Stripe's component sometimes fails its first load; the page offers a retry
        if (await retry.isVisible({ timeout: 20_000 }).catch(() => false)) await retry.click();
        const component = await stripeFrame(page, /^Sign in to see details$/);
        for (const last4 of before.banks.map((bank) => bank.last4)) {
            await expect(component.getByText(last4)).toHaveCount(0);
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
