import { randomUUID } from "node:crypto";
import { strings } from "@clientbridge/app-core/public";
import { runEmail } from "@clientbridge/config/e2e/run";
import { expect, type Page } from "@playwright/test";
import { patchBusiness } from "../../../../web/e2e/support/business";
import { apiBase, headers } from "../../../../web/e2e/support/messaging";
import { ownBusiness } from "../../../../web/e2e/support/plans";
import { navigate } from "../../../../web/e2e/support/session";
import { stripeHarness } from "./disputes";

const p = strings.plans;
const DAY = 86_400;

export interface PlanEvidence {
    business: {
        plan: string | null;
        plan_status: string;
        stripe_account_id: string | null;
        stripe_subscription_id: string | null;
    };
    subscriptions: {
        id: string;
        status: string;
        cancel_at_period_end: boolean;
        items: { key: string; interval: string; quantity: number }[];
    }[];
    invoices: {
        id: string;
        status: string;
        billing_reason: string;
        subtotal: number;
        total: number;
        amount_paid: number;
        tax: number;
        attempt_count: number;
        subscription: string;
    }[];
}

export function planEvidence(businessId: string): Promise<PlanEvidence> {
    return stripeHarness<PlanEvidence>(["plans", "evidence", businessId]);
}

export async function advancePlanClock(businessId: string, days: number): Promise<void> {
    const moved = await stripeHarness<{ frozen_time: number }>(
        ["plans", "advance", businessId, "--seconds", String(days * DAY)],
        600_000,
    );
    expect(moved.frozen_time).toBeGreaterThan(0);
}

/** How many times Stripe changed each plan subscription's items, read from its update events. */
export async function planItemChanges(businessId: string): Promise<Record<string, number>> {
    return (
        await stripeHarness<{ changes: Record<string, number> }>(["plans", "changes", businessId])
    ).changes;
}

export function declinePlanCard(businessId: string): Promise<{ subscription: string }> {
    return stripeHarness<{ subscription: string }>(["plans", "decline", businessId]);
}

/** A new owner's business on its trial, with the address plans are taxed by, billed on a clock. */
export async function trialBusiness(page: Page, name: string) {
    const business = await ownBusiness(page, page.request, name);
    const address = await patchBusiness(page, {
        street_number: "1450",
        street_name: "Fort Street",
        city: "Victoria",
        province: "BC",
        postal_code: "V8S 1Z1",
        legal_phone: "(250) 555-0142",
    });
    expect(address.status(), await address.text()).toBe(200);
    const fixture = await stripeHarness<{ business: string; clock: string; account: string }>([
        "plans",
        "register",
        business.id,
    ]);
    expect(fixture).toMatchObject({
        business: business.id,
        clock: expect.stringMatching(/^clock_/),
    });
    return { ...business, clock: fixture.clock, account: fixture.account };
}

/** Chooses Premium on the plan page and pays Stripe's hosted Checkout with a test card. */
export async function buyPremium(page: Page, interval: "month" | "year"): Promise<void> {
    await navigate(page, "/setup/security");
    await page
        .getByRole("group", { name: p.interval, exact: true })
        .getByRole("button", { name: interval === "month" ? p.monthly : p.yearly, exact: true })
        .click({ timeout: 60_000 });
    await page.getByRole("button", { name: p.choose(p.premium), exact: true }).click();
    await page.waitForURL(/^https:\/\/checkout\.stripe\.com\//, { timeout: 60_000 });
    const number = page.getByRole("textbox", { name: "Card number" });
    const choice = page.getByRole("button", { name: "Pay with card" });
    // Checkout shows the card form at once or behind its Card choice, depending on the session
    await expect(async () => {
        if (await choice.count()) await choice.dispatchEvent("click");
        await expect(number).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 60_000 });
    // Checkout adapts to where the browser is, and the owner pays as a Canadian business in CAD
    const cad = page.getByRole("button", { name: "CAD", exact: true });
    if (await cad.isVisible()) await cad.click();
    const country = page.getByRole("combobox", { name: /Country/ });
    if (await country.isVisible()) await country.selectOption({ label: "Canada" });
    const link = page.getByRole("checkbox", { name: /Save my information/ });
    if ((await link.isVisible()) && (await link.isChecked())) await link.uncheck();
    const email = page.getByRole("textbox", { name: "Email" });
    if ((await email.isVisible()) && (await email.inputValue()) === "")
        await email.fill(runEmail(`plan-${randomUUID().slice(0, 8)}@example.ca`));
    await number.fill("4242424242424242");
    await page.getByRole("textbox", { name: "Expiration" }).fill("12 / 34");
    await page.getByRole("textbox", { name: "CVC" }).fill("123");
    await page.getByRole("textbox", { name: "Cardholder name" }).fill("Plan Owner");
    const postal = page.getByRole("textbox", { name: /Postal code|ZIP/ });
    if (await postal.isVisible()) {
        await postal.fill("V8S 1Z1");
        await expect(postal).toHaveValue("V8S 1Z1");
    }
    await page.getByTestId("hosted-payment-submit-button").click();
    await page.waitForURL(
        (url) => url.pathname === "/setup/security" && url.searchParams.get("checkout") === "done",
        { timeout: 120_000 },
    );
}

export function invite(page: Page, email: string) {
    return page.request.post(`${apiBase()}/v1/staff/invites`, {
        data: { email, role: "staff" },
        headers: headers(page),
    });
}

export function revokeInvite(page: Page, id: string) {
    return page.request.post(`${apiBase()}/v1/staff/invites/${id}/revoke`, {
        headers: headers(page),
    });
}
