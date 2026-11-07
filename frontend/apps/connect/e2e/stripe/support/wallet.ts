import { randomUUID } from "node:crypto";
import { formatMoney, strings } from "@clientbridge/app-core/public";
import { expect, type Frame, type Locator, type Page } from "@playwright/test";
import { openInvoice, paymentDrawer } from "../../../../web/e2e/support/billing";
import { bookingApi } from "../../../../web/e2e/support/bookings";
import { type ClientFixture, openWallet } from "../../../../web/e2e/support/clients";
import { select } from "../../../../web/e2e/support/db";
import { type ChargeEvidence, stripeHarness } from "./disputes";

export interface WalletEvidence {
    customer: string;
    default: string | null;
    methods: { id: string; type: string; last4: string | null }[];
    setups: {
        id: string;
        status: string;
        payment_method: string | null;
        mandate: { id: string; status: string; payment_method: string } | null;
    }[];
    intents: {
        id: string;
        status: string;
        amount: number;
        payment_method: string | null;
        payment_method_types: string[];
        invoice_id: string | null;
        charge: ChargeEvidence | null;
    }[];
}

export function walletEvidence(clientId: string): Promise<WalletEvidence> {
    return stripeHarness<WalletEvidence>(["clients", "methods", clientId]);
}

export interface SavedMethod {
    id: string;
    method: string;
    brand: string | null;
    last4: string | null;
    preferred: boolean;
    mandate_status: string;
    provider_ref: string | null;
}

export function savedMethods(clientId: string): Promise<SavedMethod[]> {
    return select<SavedMethod>`
        SELECT id, method, brand, last4, preferred, mandate_status, provider_ref
        FROM payment_methods WHERE client_id = ${clientId} ORDER BY created_at, id`;
}

export function methodLine(wallet: Locator, last4: string): Locator {
    return wallet.getByRole("listitem").filter({ hasText: last4 });
}

/** Picks an action from a saved method's menu in the client's wallet. */
export async function methodAction(
    page: Page,
    client: ClientFixture,
    last4: string,
    action: string,
): Promise<Locator> {
    const wallet = await openWallet(page, client);
    await methodLine(wallet, last4).getByRole("button").click();
    await page
        .getByRole("menuitem")
        .filter({ has: page.getByText(action, { exact: true }) })
        .click();
    return wallet;
}

export async function sentInvoice(
    page: Page,
    client: ClientFixture,
    cents: number,
): Promise<string> {
    const response = await page.request.post(`${bookingApi()}/v1/invoices`, {
        headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
        data: {
            client_id: client.id,
            lines: [
                {
                    description: "Coat care visit",
                    quantity: 1,
                    unit_amount_cents: cents,
                    tax_class: "exempt",
                },
            ],
            send: true,
        },
    });
    expect(response.status(), await response.text()).toBe(201);
    return ((await response.json()) as { id: string }).id;
}

export interface InvoiceCharge {
    payment_id: string;
    status: string;
    balance_cents: number;
}

/** Charges the client's saved default method from Record payment on the invoice. */
export async function chargeSavedMethod(
    page: Page,
    client: ClientFixture,
    invoiceId: string,
    last4: string,
    cents: number,
): Promise<{ charge: InvoiceCharge; summary: string }> {
    const r = strings.billing.rec;
    await openInvoice(page, { id: invoiceId, name: client.name, phone: client.phone });
    await page.getByRole("button", { name: strings.billing.recordPayment, exact: true }).click();
    const drawer = paymentDrawer(page);
    await drawer
        .getByRole("group", { name: r.howPaid, exact: true })
        .getByRole("button")
        .filter({ hasText: last4 })
        .click();
    const charged = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === `/v1/invoices/${invoiceId}/payments` &&
            response.request().method() === "POST",
    );
    await drawer
        .getByRole("button", { name: r.charge(formatMoney(cents, "CAD")), exact: true })
        .click();
    const response = await charged;
    expect(response.status(), await response.text()).toBe(201);
    await expect(
        drawer.getByRole("button", { name: strings.common.done, exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    const summary = await drawer.innerText();
    await drawer.getByRole("button", { name: strings.common.done, exact: true }).click();
    return { charge: (await response.json()) as InvoiceCharge, summary };
}

export interface SetupLink {
    id: string;
    setup_status: string;
    setup_intent_id: string | null;
    token_hash: string;
    expires_at: Date;
}

export function setupLinks(clientId: string): Promise<SetupLink[]> {
    return select<SetupLink>`
        SELECT id, setup_status, setup_intent_id, token_hash, expires_at
        FROM payment_setup_links WHERE client_id = ${clientId} ORDER BY id DESC`;
}

export function hoursLeft(at: Date | undefined): number {
    if (at === undefined) throw new Error("the link has no expiry");
    return (new Date(at).getTime() - Date.now()) / 3_600_000;
}

/** Stripe's hosted bank verification dialog, which opens over the setup page. */
export async function bankDialog(page: Page): Promise<Frame> {
    let found: Frame | undefined;
    await expect
        .poll(
            async () => {
                found = page
                    .frames()
                    .find(
                        (frame) =>
                            !frame.isDetached() &&
                            frame.url().startsWith("https://payments.stripe.com/acss/"),
                    );
                return found !== undefined && (await found.getByRole("dialog").isVisible());
            },
            { timeout: 60_000 },
        )
        .toBe(true);
    if (!found) throw new Error("Stripe's bank dialog did not open");
    return found;
}

/** Stripe's dialog ignores a press while a screen animates in, so press until the next one shows. */
export async function advance(control: Locator, next: Locator): Promise<void> {
    await expect(async () => {
        if (await control.isVisible().catch(() => false)) await control.click({ timeout: 5_000 });
        await expect(next).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 120_000 });
}

/** Detaches a saved method at Stripe without the app, as the Dashboard can. */
export function detachAtStripe(
    clientId: string,
    providerRef: string,
): Promise<{ payment_method: string; customer: string | null }> {
    return stripeHarness(["clients", "detach", clientId, "--target", providerRef]);
}

/** Finishes the client's bank setup with Stripe's test bank whose debits the bank refuses. */
export function authorizeRefusingBank(
    clientId: string,
    intentId: string,
): Promise<{ setup: string; status: string; payment_method: string; mandate: string | null }> {
    return stripeHarness(["clients", "unauthorized-bank", clientId, "--target", intentId]);
}

/** Creates a private bank authorization link from the client's wallet. */
export async function createSetupLink(
    page: Page,
    client: ClientFixture,
): Promise<{ id: string; url: string }> {
    const wallet = await openWallet(page, client);
    await wallet.getByRole("button", { name: strings.clients.addBankWeb, exact: true }).click();
    const created = page.waitForResponse(
        (r) =>
            new URL(r.url()).pathname === `/v1/payments/pad-links/${client.id}` &&
            r.request().method() === "POST",
    );
    await wallet
        .getByRole("button", { name: strings.checkout.bankLinkCreate, exact: true })
        .click();
    const response = await created;
    expect(response.status(), await response.text()).toBe(200);
    const made = (await response.json()) as { id: string; url: string };
    await expect(wallet.getByText(made.url, { exact: true })).toBeVisible();
    await wallet.getByRole("button", { name: strings.common.done, exact: true }).click();
    return made;
}
