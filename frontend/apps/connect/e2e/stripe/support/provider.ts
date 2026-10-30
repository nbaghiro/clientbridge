import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
    expect,
    type APIRequestContext,
    type Frame,
    type JSHandle,
    type Response,
    type Page,
    type TestInfo,
} from "@playwright/test";
import { formatMoneyWithCurrency, strings } from "@clientbridge/app-core/public";

import { documentApi, documentProvider } from "../../support/documents";
import { on } from "../../support/hosts";
import { demoId } from "@clientbridge/config/e2e/run";

const execute = promisify(execFile);

interface StripeBrowserEvidence {
    invoice: { id: string; business_id: string; client_id: string };
    payments: {
        id: string;
        status: string;
        amount_cents: number;
        currency: string;
        tip_cents: number;
        provider: string;
        provider_ref: string;
        kind: string;
    }[];
    entries: {
        journal_id: string;
        ref: string;
        amount_cents: number;
        currency: string;
        category: string;
        owner_type: string;
        owner_id: string;
    }[];
    stripe: {
        id: string;
        account: string;
        status: string;
        livemode: boolean;
        amount: number;
        currency: string;
        net?: number;
        fee?: number;
        application_fee_amount: number | null;
        amount_refunded?: number;
        charge?: string;
        charge_paid?: boolean;
        amount_captured?: number;
        error_code: string | null;
        decline_code: string | null;
        next_action_type: string | null;
        three_d_secure?: { result: string; version: string; authentication_flow: string } | null;
    }[];
    provider_intent_ids: string[];
    webhooks: { id: string; event: string; status: string; processed: boolean }[];
}

async function probe(invoiceId?: string): Promise<string> {
    const { stdout } = await execute(
        "uv",
        ["run", "python", "-m", "e2e.stripe", "browser", ...(invoiceId ? [invoiceId] : [])],
        {
            cwd: fileURLToPath(new URL("../../../../../../backend", import.meta.url)),
            timeout: 60_000,
        },
    );
    return stdout;
}

export async function stripeEvidence(invoiceId: string): Promise<StripeBrowserEvidence> {
    return JSON.parse(await probe(invoiceId)) as StripeBrowserEvidence;
}

export async function stripeReady(): Promise<{ ready: boolean; account: string }> {
    if (
        process.env.STRIPE_BROWSER_E2E !== "1" ||
        !process.env.STRIPE_PUBLISHABLE_KEY?.startsWith("pk_test_")
    ) {
        throw new Error(
            "requires the dedicated isolated Stripe browser lane and test publishable key",
        );
    }
    // Fails before creating fixtures unless the real provider, isolated DB and SMTP are ready.
    const ready = JSON.parse(await probe()) as { ready: boolean; account: string };
    expect(ready.ready).toBe(true);
    return ready;
}

export async function stripeInvoice(request: APIRequestContext) {
    await stripeReady();
    const provider = await documentProvider(request);
    const response = await request.post(`${documentApi}/v1/invoices`, {
        headers: { ...provider.headers, "Idempotency-Key": randomUUID() },
        data: {
            client_id: provider.clientId,
            send: true,
            lines: [
                {
                    description: "Grooming consultation",
                    quantity: 1,
                    unit_amount_cents: 2000,
                    tax_class: "exempt",
                },
            ],
        },
    });
    expect(response.status(), "invoice prerequisite creation failed").toBe(201);
    const invoice = (await response.json()) as { id: string; pay_token: string };
    return registerStripeInvoice(request, invoice);
}

export async function registerStripeInvoice(
    request: APIRequestContext,
    invoice: { id: string; pay_token: string },
) {
    const ready = await stripeReady();
    // Record exact invoice/client ownership and tag its provider customer before UI creates an intent.
    await execute("uv", ["run", "python", "-m", "e2e.stripe", "setup", "register", invoice.id], {
        cwd: fileURLToPath(new URL("../../../../../../backend", import.meta.url)),
        timeout: 60_000,
    });
    const publicResponse = await request.get(`${documentApi}/pay/${invoice.pay_token}`);
    expect(publicResponse.status()).toBe(200);
    expect(await publicResponse.json()).toMatchObject({
        balance_cents: 2000,
        total_cents: 2000,
        accepts_card: true,
    });
    return { ...invoice, account: ready.account };
}

export async function openStripeInvoice(page: Page, request: APIRequestContext) {
    const invoice = await stripeInvoice(request);
    return openRegisteredStripeInvoice(page, invoice, on("pay", `/i/${invoice.pay_token}`));
}

export async function openRegisteredStripeInvoice(
    page: Page,
    invoice: { id: string; pay_token: string; account: string },
    url: string,
) {
    await page.goto(url);
    await expect(page.getByText("Grooming consultation", { exact: true })).toBeVisible();
    // The product starts with no tip. Assert the real public-card request preserves that choice.
    const starting = page.waitForRequest(
        (r) => r.method() === "POST" && r.url() === `${documentApi}/pay/${invoice.pay_token}/card`,
    );
    await page.getByRole("button", { name: strings.publicPay.payByCard, exact: true }).click();
    expect((await starting).postDataJSON()).toMatchObject({ tip_cents: 0 });
    return { invoice, payment: await cardFrame(page) };
}

/** Stripe's card form, wherever its iframe mounts; a frame Stripe replaces while polling is skipped. */
export async function cardFrame(page: Page): Promise<Frame> {
    let found: Frame | undefined;
    await expect
        .poll(
            async () => {
                for (const frame of page.frames()) {
                    if (frame.isDetached()) continue;
                    try {
                        if (
                            await frame
                                .getByRole("textbox", { name: "Card number", exact: true })
                                .isVisible()
                        ) {
                            found = frame;
                            return true;
                        }
                        // Firefox gets the methods collapsed, with none chosen until one is clicked
                        const card = frame.getByRole("button", { name: "Card", exact: true });
                        if (await card.isVisible()) await card.click();
                    } catch (error) {
                        if (!frame.isDetached()) throw error;
                    }
                }
                return false;
            },
            { timeout: 60_000 },
        )
        .toBe(true);
    if (!found) throw new Error("Stripe card input frame did not become ready");
    return found;
}

export async function enterStripeCard(payment: Frame, number: string): Promise<void> {
    await payment.getByRole("textbox", { name: "Card number", exact: true }).fill(number);
    const expiry = `12${String(new Date().getFullYear() + 3).slice(-2)}`;
    await payment.getByRole("textbox", { name: /Expiration|Expiry/ }).fill(expiry);
    await payment.getByRole("textbox", { name: /Security code|CVC/ }).fill("123");
    const country = payment.getByRole("combobox", { name: "Country", exact: true });
    const postal = payment.getByRole("textbox", { name: /Postal code|ZIP code/ });
    if (await country.count()) {
        await country.selectOption({ label: "Canada" });
        await expect(country).toHaveValue("CA");
    }
    if (await postal.count()) {
        await expect(postal).toBeVisible();
        await postal.fill("M5V 2T6");
    }
    await expect(payment.locator('input[aria-invalid="true"]')).toHaveCount(0);
}

interface CheckoutSignals {
    clicks: { trusted: boolean; disabled: boolean; busy: boolean }[];
    submits: { trusted: boolean }[];
    attributes: { disabled: boolean; busy: boolean }[];
    invalid: number;
}

interface CheckoutObservation {
    signals: CheckoutSignals;
    stop: () => void;
}

const checkoutObservations = new WeakMap<
    Page,
    {
        observation: JSHandle<CheckoutObservation>;
        network: { endpoint: string; status: number }[];
        response: (response: Response) => void;
    }
>();

export async function checkoutDiagnostics(page: Page, info: TestInfo, stop = true): Promise<void> {
    const tracked = checkoutObservations.get(page);
    if (!tracked) return;
    try {
        let signals: CheckoutSignals | null = null;
        try {
            signals = await tracked.observation.evaluate((observation) => observation.signals);
        } catch {
            // A customer reload destroys the old document containing the observation handle.
        }
        const frames: {
            inputs: {
                empty: boolean;
                invalid: boolean;
                required: boolean;
                valid: boolean;
                disabled: boolean;
            }[];
            visibleAlerts: number;
        }[] = [];
        for (const frame of page.frames()) {
            if (
                !(await frame
                    .getByRole("textbox", { name: "Card number", exact: true })
                    .isVisible())
            )
                continue;
            const inputs = await frame.locator("input").evaluateAll((nodes) =>
                nodes.map((node) => {
                    if (!(node instanceof HTMLInputElement))
                        throw new Error("Expected an input element");
                    return {
                        empty: node.value.length === 0,
                        invalid: node.getAttribute("aria-invalid") === "true",
                        required: node.required,
                        valid: node.validity.valid,
                        disabled: node.disabled,
                    };
                }),
            );
            const alerts = frame.getByRole("alert");
            let visibleAlerts = 0;
            for (let index = 0; index < (await alerts.count()); index++) {
                if (await alerts.nth(index).isVisible()) visibleAlerts++;
            }
            frames.push({ inputs, visibleAlerts });
        }
        await info.attach(stop ? "checkout-final-signals" : "checkout-submit-signals", {
            body: JSON.stringify({ signals, frames, network: tracked.network }),
            contentType: "application/json",
        });
    } catch (error) {
        await info.attach("checkout-diagnostics-unavailable", {
            body: JSON.stringify({
                available: false,
                errorType: error instanceof Error ? error.name : "unknown",
            }),
            contentType: "application/json",
        });
    } finally {
        if (stop) {
            try {
                await tracked.observation.evaluate((observation) => {
                    observation.stop();
                });
                await tracked.observation.dispose();
            } catch {
                // Navigation already disposed the old document and its listeners.
            }
            page.off("response", tracked.response);
            checkoutObservations.delete(page);
        }
    }
}

export async function submitStripeCard(page: Page, info: TestInfo): Promise<void> {
    const label = strings.checkout.pay(formatMoneyWithCurrency(2000, "CAD"));
    const submit = page.getByRole("button", { name: label, exact: true });
    await checkoutDiagnostics(page, info);
    // listen on the document, since the page may re-render the button between setup and the click
    const observation = await page.evaluateHandle((label): CheckoutObservation => {
        const signals: CheckoutSignals = { clicks: [], submits: [], attributes: [], invalid: 0 };
        const current = (): HTMLButtonElement | undefined =>
            Array.from(document.querySelectorAll("button")).find(
                (button) => button.textContent.trim() === label,
            );
        const state = (button: Element) => ({
            disabled: button.hasAttribute("disabled"),
            busy: button.getAttribute("aria-busy") === "true",
        });
        const click = (event: Event) => {
            const button = event.target instanceof Element ? event.target.closest("button") : null;
            if (button !== null && button === current()) {
                signals.clicks.push({ trusted: event.isTrusted, ...state(button) });
            }
        };
        const submitted = (event: Event) => {
            const button = current();
            if (
                event.target instanceof HTMLFormElement &&
                button &&
                event.target.contains(button)
            ) {
                signals.submits.push({ trusted: event.isTrusted });
            }
        };
        const invalid = (event: Event) => {
            const form = current()?.closest("form");
            if (form && event.target instanceof Node && form.contains(event.target)) {
                signals.invalid++;
            }
        };
        document.addEventListener("click", click, true);
        document.addEventListener("submit", submitted, true);
        document.addEventListener("invalid", invalid, true);
        const observer = new MutationObserver((records) => {
            for (const record of records) {
                if (record.target instanceof Element && record.target === current()) {
                    signals.attributes.push(state(record.target));
                }
            }
        });
        observer.observe(document.body, {
            subtree: true,
            attributes: true,
            attributeFilter: ["disabled", "aria-busy"],
        });
        return {
            signals,
            stop: () => {
                document.removeEventListener("click", click, true);
                document.removeEventListener("submit", submitted, true);
                document.removeEventListener("invalid", invalid, true);
                observer.disconnect();
            },
        };
    }, label);
    const network: { endpoint: string; status: number }[] = [];
    const response = (result: Response) => {
        const url = new URL(result.url());
        if (url.hostname === "api.stripe.com") {
            network.push({
                endpoint: url.pathname.split("/").slice(0, 3).join("/"),
                status: result.status(),
            });
        }
    };
    page.on("response", response);
    checkoutObservations.set(page, { observation, network, response });
    const activation = process.env.STRIPE_BROWSER_ACTIVATION ?? "pointer";
    if (activation === "pointer") {
        await page.getByRole("heading", { name: strings.publicPay.cardLabel, exact: true }).click();
    }
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport({ ratio: 1 });
    await info.attach("checkout-activation", {
        body: JSON.stringify({
            activation,
            before: await submit.boundingBox(),
            hit: await submit.evaluate((button) => {
                const rect = button.getBoundingClientRect();
                const hit = document.elementFromPoint(
                    rect.x + rect.width / 2,
                    rect.y + rect.height / 2,
                );
                return {
                    tag: hit?.tagName,
                    role: hit?.getAttribute("role"),
                    withinButton: hit !== null && button.contains(hit),
                    fullyVisible: rect.top >= 0 && rect.bottom <= innerHeight,
                };
            }),
        }),
        contentType: "application/json",
    });
    if (activation === "keyboard") {
        await submit.focus();
        await submit.press("Enter");
    } else {
        await submit.click();
    }
    try {
        await expect
            .poll(
                async () =>
                    await observation.evaluate((observed) => ({
                        click: observed.signals.clicks.some((event) => event.trusted),
                        submit: observed.signals.submits.some((event) => event.trusted),
                    })),
                { timeout: 5000 },
            )
            .toEqual({ click: true, submit: true });
    } finally {
        await checkoutDiagnostics(page, info, false);
    }
}

export async function settledStripeInvoice(
    page: Page,
    request: APIRequestContext,
    invoice: Awaited<ReturnType<typeof stripeInvoice>>,
    info: TestInfo,
    events: string[] = ["payment_intent.succeeded"],
): Promise<StripeBrowserEvidence> {
    try {
        await expect(
            page.getByRole("heading", { name: strings.publicPay.paidTitle }),
        ).toBeVisible();

        // The immediate success screen is optimistic; require committed settlement before reload.
        await expect(async () => {
            const response = await request.get(`${documentApi}/pay/${invoice.pay_token}`);
            expect(response.status()).toBe(200);
            expect(await response.json()).toMatchObject({ status: "paid", balance_cents: 0 });
            const evidence = await stripeEvidence(invoice.id);
            expect(evidence.payments).toHaveLength(1);
            expect(evidence.payments[0]).toMatchObject({ status: "succeeded" });
            expect(evidence.webhooks.map((row) => row.event).sort()).toEqual([...events].sort());
            for (const webhook of evidence.webhooks) {
                expect(webhook).toMatchObject({ status: "processed", processed: true });
            }
        }).toPass({ timeout: 90_000, intervals: [1000, 3000, 5000] });

        const saved = await stripeEvidence(invoice.id);
        const paid = saved.payments[0];
        const intent = saved.stripe[0];
        if (!paid || !intent) throw new Error("missing independent settlement evidence");
        expect(saved.stripe).toHaveLength(1);
        expect(saved.provider_intent_ids).toEqual([intent.id]);
        expect(paid).toMatchObject({
            status: "succeeded",
            amount_cents: 2000,
            currency: "CAD",
            tip_cents: 0,
            provider: "stripe",
            kind: "payment",
            provider_ref: intent.id,
        });
        expect(intent).toMatchObject({
            account: invoice.account,
            livemode: false,
            status: "succeeded",
            amount: 2000,
            currency: "cad",
            amount_refunded: 0,
        });
        const settlement = saved.entries.filter((entry) => entry.ref === `payment:${paid.id}`);
        expect(settlement.length).toBeGreaterThanOrEqual(2);
        expect(new Set(settlement.map((entry) => entry.journal_id)).size).toBe(1);
        expect(settlement.reduce((sum, entry) => sum + entry.amount_cents, 0)).toBe(0);
        const journalTotals = new Map<string, number>();
        for (const entry of saved.entries) {
            journalTotals.set(
                entry.journal_id,
                (journalTotals.get(entry.journal_id) ?? 0) + entry.amount_cents,
            );
        }
        for (const total of journalTotals.values()) expect(total).toBe(0);
        const businessEntries = saved.entries.filter(
            (entry) => entry.owner_type === "business" && entry.owner_id === demoId("bz_birchbark"),
        );
        const total = (category: string): number =>
            businessEntries
                .filter((entry) => entry.category === category)
                .reduce((sum, entry) => sum + entry.amount_cents, 0);
        expect(total("stripe")).toBe(intent.net);
        expect(total("platform_fee")).toBe(intent.application_fee_amount ?? 0);
        expect(total("processing_fee") + total("platform_fee")).toBe(intent.fee);
        await checkoutDiagnostics(page, info);
        await page.reload();
        await expect(
            page.getByRole("heading", { name: strings.publicPay.paidTitle }),
        ).toBeVisible();
        await expect(page.getByRole("button", { name: strings.publicPay.payByCard })).toHaveCount(
            0,
        );
        expect(await stripeEvidence(invoice.id)).toEqual(saved);
        // Contains IDs/accounting only; never provider client secrets, keys or raw card fields.
        await info.attach("committed-stripe-settlement", {
            body: JSON.stringify(saved, null, 2),
            contentType: "application/json",
        });
        return saved;
    } finally {
        await checkoutDiagnostics(page, info);
    }
}

export async function unpaidStripeInvoice(
    request: APIRequestContext,
    invoice: Awaited<ReturnType<typeof stripeInvoice>>,
): Promise<StripeBrowserEvidence> {
    const response = await request.get(`${documentApi}/pay/${invoice.pay_token}`);
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ status: "sent", balance_cents: 2000 });
    const evidence = await stripeEvidence(invoice.id);
    expect(evidence.payments).toHaveLength(1);
    expect(evidence.payments[0]?.status).not.toBe("succeeded");
    expect(evidence.entries).toEqual([]);
    expect(evidence.stripe).toHaveLength(1);
    expect(evidence.provider_intent_ids).toEqual([evidence.stripe[0]?.id]);
    expect(evidence.stripe[0]?.status).not.toBe("succeeded");
    expect(evidence.stripe[0]?.charge_paid ?? false).toBe(false);
    expect(evidence.stripe[0]?.amount_captured ?? 0).toBe(0);
    return evidence;
}

export async function stripeChallenge(page: Page): Promise<Frame> {
    let challenge: Frame | undefined;
    await expect
        .poll(
            async () => {
                for (const frame of page.frames()) {
                    if (
                        await frame
                            .getByRole("button", { name: "Complete", exact: true })
                            .isVisible()
                    ) {
                        challenge = frame;
                        return true;
                    }
                }
                return false;
            },
            { timeout: 60_000 },
        )
        .toBe(true);
    if (!challenge) throw new Error("actual Stripe challenge did not become visible");
    return challenge;
}
