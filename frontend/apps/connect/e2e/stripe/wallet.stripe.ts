import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { strings } from "@clientbridge/app-core/public";
import { runPort } from "@clientbridge/config/e2e/run";
import { bookingApi } from "../../../web/e2e/support/bookings";
import { createClient, openWallet } from "../../../web/e2e/support/clients";
import { signIn } from "../../../web/e2e/support/session";
import {
    categoryTotals,
    clientMoney,
    expectLedgerMatchesStripe,
    registerPurchaser,
} from "./support/disputes";
import { saveCardUi } from "./support/memberships";
import {
    advance,
    authorizeRefusingBank,
    bankDialog,
    chargeSavedMethod,
    createSetupLink,
    detachAtStripe,
    hoursLeft,
    methodAction,
    methodLine,
    savedMethods,
    sentInvoice,
    setupLinks,
    walletEvidence,
} from "./support/wallet";

test.use({ actionTimeout: 60_000 });

const w = strings.clients.wallet;

function webContext() {
    return { baseURL: `http://localhost:${String(runPort("WEB_E2E_PORT"))}` };
}

test("STR-E26 cards saved through Stripe charge nothing, the chosen default pays an invoice off-session, and a removed card can't be charged", async ({
    browser,
}, info) => {
    test.setTimeout(600_000);
    const owner = await (await browser.newContext(webContext())).newPage();
    try {
        await signIn(owner);
        const client = await createClient(owner);
        const customer = await registerPurchaser(client.id);
        await saveCardUi(owner, client);
        await saveCardUi(owner, client, "5555555555554444");
        const [visa, mastercard] = await savedMethods(client.id);
        if (!visa?.provider_ref || !mastercard?.provider_ref)
            throw new Error("both cards should be saved with their Stripe method");
        expect([visa, mastercard].map((m) => [m.method, m.brand, m.last4, m.preferred])).toEqual([
            ["card", "visa", "4242", true],
            ["card", "mastercard", "4444", false],
        ]);
        const saved = await walletEvidence(client.id);
        expect(saved.customer).toBe(customer);
        expect(saved.methods.map((m) => m.id).sort()).toEqual(
            [visa.provider_ref, mastercard.provider_ref].sort(),
        );
        expect(saved.setups.map((s) => [s.status, s.payment_method]).sort()).toEqual(
            [
                ["succeeded", visa.provider_ref],
                ["succeeded", mastercard.provider_ref],
            ].sort(),
        );
        // saving a card is a SetupIntent, so nothing was charged
        expect(saved.intents).toEqual([]);

        await test.step("the second card becomes the default", async () => {
            const wallet = await methodAction(owner, client, "4444", w.makeDefault);
            await expect
                .poll(async () => (await savedMethods(client.id)).map((m) => m.preferred))
                .toEqual([false, true]);
            await expect(
                methodLine(wallet, "4444").getByText(w.default, { exact: true }),
            ).toBeVisible();
            await expect(
                methodLine(wallet, "4242").getByText(w.default, { exact: true }),
            ).toHaveCount(0);
        });

        const invoiceId = await sentInvoice(owner, client, 2000);
        await test.step("the default card pays an invoice without the client present", async () => {
            const { charge, summary } = await chargeSavedMethod(
                owner,
                client,
                invoiceId,
                "4444",
                2000,
            );
            // the invoice is paid when Stripe's webhook settles the charge, not on the response
            expect(charge).toMatchObject({ status: "pending", balance_cents: 2000 });
            expect(summary).toContain(strings.billing.rec.cardTitle);
            await expect
                .poll(
                    async () =>
                        (await walletEvidence(client.id)).intents.map((i) => [
                            i.status,
                            i.amount,
                            i.payment_method,
                            i.invoice_id,
                        ]),
                    { timeout: 120_000 },
                )
                .toEqual([["succeeded", 2000, mastercard.provider_ref, invoiceId]]);
            const charged = await walletEvidence(client.id);
            const provider = charged.intents[0]?.charge;
            if (!provider) throw new Error("the invoice charge has no Stripe evidence");
            await expect
                .poll(
                    async () =>
                        (await clientMoney(client.id)).payments.map((p) => [
                            p.status,
                            p.amount_cents,
                            p.provider_ref,
                        ]),
                    { timeout: 120_000 },
                )
                .toEqual([["succeeded", 2000, charged.intents[0]?.id]]);
            await expect
                .poll(
                    async () =>
                        categoryTotals((await clientMoney(client.id)).entries).receivable ?? 0,
                    { timeout: 120_000 },
                )
                .toBe(0);
            expectLedgerMatchesStripe((await clientMoney(client.id)).entries, provider);
        });

        await test.step("the older card is removed and can no longer be charged", async () => {
            await methodAction(owner, client, "4242", w.remove);
            await owner
                .getByRole("dialog")
                .getByRole("button", { name: w.removeConfirm, exact: true })
                .click();
            await expect
                .poll(async () => (await savedMethods(client.id)).map((m) => m.last4))
                .toEqual(["4444"]);
            await expect
                .poll(async () => (await walletEvidence(client.id)).methods.map((m) => m.id))
                .toEqual([mastercard.provider_ref]);
            const wallet = await openWallet(owner, client);
            await expect(methodLine(wallet, "4242")).toHaveCount(0);
            await expect(
                methodLine(wallet, "4444").getByText(w.default, { exact: true }),
            ).toBeVisible();

            const next = await sentInvoice(owner, client, 1000);
            const headers = { Origin: new URL(owner.url()).origin };
            const stale = await owner.request.post(`${bookingApi()}/v1/invoices/${next}/payments`, {
                headers: { ...headers, "Idempotency-Key": randomUUID() },
                data: { method: "card", amount_cents: 1000, payment_method_id: visa.id },
            });
            expect(stale.status(), await stale.text()).toBe(404);
            const other = await createClient(owner);
            const elsewhere = await sentInvoice(owner, other, 1000);
            const borrowed = await owner.request.post(
                `${bookingApi()}/v1/invoices/${elsewhere}/payments`,
                {
                    headers: { ...headers, "Idempotency-Key": randomUUID() },
                    data: { method: "card", amount_cents: 1000, payment_method_id: mastercard.id },
                },
            );
            expect(borrowed.status(), await borrowed.text()).toBe(404);
            expect((await walletEvidence(client.id)).intents).toHaveLength(1);
        });

        await test.step("a card already detached at Stripe is still removed", async () => {
            await saveCardUi(owner, client, "4000056655665556");
            const debit = (await savedMethods(client.id)).find((m) => m.last4 === "5556");
            if (!debit?.provider_ref) throw new Error("the debit card has no Stripe method");
            await detachAtStripe(client.id, debit.provider_ref);
            await methodAction(owner, client, "5556", w.remove);
            const removed = owner.waitForResponse(
                (r) =>
                    new URL(r.url()).pathname === `/v1/payments/methods/${debit.id}` &&
                    r.request().method() === "DELETE",
            );
            await owner
                .getByRole("dialog")
                .getByRole("button", { name: w.removeConfirm, exact: true })
                .click();
            const response = await removed;
            expect(response.status(), await response.text()).toBe(200);
            await expect
                .poll(async () => (await savedMethods(client.id)).map((m) => m.last4))
                .toEqual(["4444"]);
        });

        await info.attach("str-e26", {
            body: JSON.stringify(
                { stripe: await walletEvidence(client.id), ledger: await clientMoney(client.id) },
                null,
                2,
            ),
            contentType: "application/json",
        });
    } finally {
        await owner.context().close();
    }
});

test("STR-E27 a client authorizes a bank account from the setup link, and an invoice debited from it is paid only once Stripe settles", async ({
    browser,
}, info) => {
    test.setTimeout(1_500_000);
    const c = strings.checkout;
    const owner = await (await browser.newContext(webContext())).newPage();
    const payer = await (await browser.newContext()).newPage();
    try {
        await signIn(owner);
        const client = await createClient(owner);
        await registerPurchaser(client.id);
        const link = await test.step("staff create a private link from the wallet", () =>
            createSetupLink(owner, client));
        const token = new URLSearchParams(new URL(link.url).hash.slice(1)).get("token") ?? "";
        const [fresh] = await setupLinks(client.id);
        expect(fresh).toMatchObject({
            id: link.id,
            setup_status: "not_started",
            setup_intent_id: null,
        });
        expect(token.length).toBeGreaterThan(20);
        // only a hash of the link's secret is kept
        expect(fresh?.token_hash).not.toContain(token);
        expect(hoursLeft(fresh?.expires_at)).toBeCloseTo(24, 0);

        await test.step("opening the link starts nothing until the client continues", async () => {
            await payer.goto(link.url);
            await expect(
                payer.getByRole("heading", { name: c.bankSetupTitle, exact: true }),
            ).toBeVisible();
            expect((await setupLinks(client.id))[0]?.setup_intent_id).toBeNull();
            expect((await walletEvidence(client.id)).setups).toEqual([]);
            await payer.getByRole("textbox", { name: c.payerEmail }).fill("payer@example.com");
            await payer.getByRole("button", { name: c.bankSetupStart, exact: true }).click();
            await expect(
                payer.getByRole("button", { name: c.bankSetupConfirm, exact: true }),
            ).toBeVisible();
            const [started] = await setupLinks(client.id);
            expect(started?.setup_intent_id).toMatch(/^seti_/);
            expect(hoursLeft(started?.expires_at)).toBeCloseTo(240, 0);
        });

        const bank =
            await test.step("the client verifies with the bank and accepts the PAD agreement", async () => {
                await payer.getByRole("button", { name: c.bankSetupConfirm, exact: true }).click();
                const stripe = await bankDialog(payer);
                const agree = stripe.getByRole("button", { name: "Agree", exact: true });
                const simulate = stripe.getByRole("button", {
                    name: "Simulate successful verification",
                    exact: true,
                });
                const agreement = stripe.getByRole("heading", {
                    name: "Pre-authorized debit agreement",
                });
                await advance(agree, simulate);
                await advance(simulate, agreement);
                await advance(
                    agree,
                    payer.getByRole("heading", { name: c.bankSetupDone, exact: true }),
                );
                expect(payer.url()).not.toContain("setup_intent_client_secret");
                await expect
                    .poll(
                        async () =>
                            (await savedMethods(client.id)).map((m) => [
                                m.method,
                                m.last4,
                                m.mandate_status,
                            ]),
                        { timeout: 120_000 },
                    )
                    .toEqual([["bank_eft", "6789", "active"]]);
                const [saved] = await savedMethods(client.id);
                if (!saved?.provider_ref) throw new Error("the bank account has no Stripe method");
                const provider = await walletEvidence(client.id);
                expect(
                    provider.setups.map((s) => [s.status, s.payment_method, s.mandate?.status]),
                ).toEqual([["succeeded", saved.provider_ref, "active"]]);
                expect(provider.setups[0]?.mandate?.payment_method).toBe(saved.provider_ref);
                expect(provider.intents).toEqual([]);
                expect((await setupLinks(client.id))[0]?.setup_status).toBe("succeeded");
                const wallet = await openWallet(owner, client);
                await expect(
                    methodLine(wallet, "6789").getByText(w.default, { exact: true }),
                ).toBeVisible({
                    timeout: 60_000,
                });
                return saved;
            });

        const invoiceId = await sentInvoice(owner, client, 2000);
        await test.step("a debit from the bank leaves the invoice owing while Stripe processes it", async () => {
            const { charge, summary } = await chargeSavedMethod(
                owner,
                client,
                invoiceId,
                "6789",
                2000,
            );
            expect(charge).toMatchObject({ status: "pending", balance_cents: 2000 });
            expect(summary).toContain(strings.billing.rec.debitTitle);
            expect(summary).toContain(strings.billing.rec.debitBody);
            const debit = (await walletEvidence(client.id)).intents;
            expect(
                debit.map((i) => [
                    i.amount,
                    i.payment_method,
                    i.payment_method_types,
                    i.invoice_id,
                ]),
            ).toEqual([[2000, bank.provider_ref, ["acss_debit"], invoiceId]]);
            if (debit[0]?.status === "processing") {
                const money = await clientMoney(client.id);
                expect(money.payments.map((p) => p.status)).toEqual(["pending"]);
                expect(categoryTotals(money.entries).receivable).toBe(2000);
            }
        });

        await test.step("the invoice is paid once, when the debit settles", async () => {
            await expect
                .poll(async () => (await walletEvidence(client.id)).intents.map((i) => i.status), {
                    timeout: 1_200_000,
                    intervals: [15_000],
                })
                .toEqual(["succeeded"]);
            const settled = await walletEvidence(client.id);
            const provider = settled.intents[0]?.charge;
            if (!provider) throw new Error("the settled debit has no Stripe evidence");
            await expect
                .poll(
                    async () =>
                        (await clientMoney(client.id)).payments.map((p) => [
                            p.status,
                            p.amount_cents,
                            p.provider_ref,
                        ]),
                    { timeout: 120_000 },
                )
                .toEqual([["succeeded", 2000, settled.intents[0]?.id]]);
            await expect
                .poll(
                    async () =>
                        categoryTotals((await clientMoney(client.id)).entries).receivable ?? 0,
                    { timeout: 120_000 },
                )
                .toBe(0);
            expectLedgerMatchesStripe((await clientMoney(client.id)).entries, provider);
        });

        await info.attach("str-e27", {
            body: JSON.stringify(
                { stripe: await walletEvidence(client.id), ledger: await clientMoney(client.id) },
                null,
                2,
            ),
            contentType: "application/json",
        });
    } finally {
        await payer.context().close();
        await owner.context().close();
    }
});

test("STR-E30 a bank whose debit its bank refuses loses its mandate, can't be charged or made the default, and can still be removed", async ({
    browser,
}, info) => {
    test.setTimeout(900_000);
    const c = strings.checkout;
    const owner = await (await browser.newContext(webContext())).newPage();
    const payer = await (await browser.newContext()).newPage();
    try {
        await signIn(owner);
        const client = await createClient(owner);
        await registerPurchaser(client.id);
        const link = await createSetupLink(owner, client);
        const intent = await test.step("the client starts the bank setup", async () => {
            await payer.goto(link.url);
            await payer.getByRole("textbox", { name: c.payerEmail }).fill("payer@example.com");
            await payer.getByRole("button", { name: c.bankSetupStart, exact: true }).click();
            await expect(
                payer.getByRole("button", { name: c.bankSetupConfirm, exact: true }),
            ).toBeVisible();
            const [started] = await setupLinks(client.id);
            if (!started?.setup_intent_id) throw new Error("the link started no setup intent");
            return started.setup_intent_id;
        });

        const bank =
            await test.step("Stripe authorizes a bank whose debits the bank refuses", async () => {
                await authorizeRefusingBank(client.id, intent);
                await expect
                    .poll(
                        async () =>
                            (await savedMethods(client.id)).map((m) => [
                                m.method,
                                m.mandate_status,
                                m.preferred,
                            ]),
                        { timeout: 120_000 },
                    )
                    .toEqual([["bank_eft", "active", true]]);
                const [saved] = await savedMethods(client.id);
                if (!saved?.provider_ref || !saved.last4)
                    throw new Error("the bank account has no Stripe method");
                return { ...saved, provider_ref: saved.provider_ref, last4: saved.last4 };
            });

        const invoiceId = await sentInvoice(owner, client, 2000);
        await test.step("the bank refuses the debit and Stripe ends the mandate", async () => {
            const { charge } = await chargeSavedMethod(owner, client, invoiceId, bank.last4, 2000);
            expect(charge).toMatchObject({ status: "pending", balance_cents: 2000 });
            await expect
                .poll(
                    async () =>
                        (await walletEvidence(client.id)).setups.map((s) => s.mandate?.status),
                    { timeout: 300_000, intervals: [5_000] },
                )
                .toEqual(["inactive"]);
            await expect
                .poll(
                    async () =>
                        (await savedMethods(client.id)).map((m) => [m.mandate_status, m.preferred]),
                    { timeout: 120_000 },
                )
                .toEqual([["revoked", false]]);
            // Stripe ends only the mandate; the bank account stays attached to the customer
            expect((await walletEvidence(client.id)).methods.map((m) => m.id)).toEqual([
                bank.provider_ref,
            ]);
            const wallet = await openWallet(owner, client);
            const line = methodLine(wallet, bank.last4);
            await expect(line.getByText(w.mandateRevoked, { exact: true })).toBeVisible({
                timeout: 60_000,
            });
            await expect(line.getByText(w.default, { exact: true })).toHaveCount(0);
        });

        await test.step("the bank can't be charged or made the default", async () => {
            const headers = { Origin: new URL(owner.url()).origin };
            const charged = await owner.request.post(
                `${bookingApi()}/v1/invoices/${invoiceId}/payments`,
                {
                    headers: { ...headers, "Idempotency-Key": randomUUID() },
                    data: { method: "card", amount_cents: 2000, payment_method_id: bank.id },
                },
            );
            expect(charged.status(), await charged.text()).toBe(409);
            const preferred = await owner.request.post(
                `${bookingApi()}/v1/payments/methods/${bank.id}/default`,
                { headers: { ...headers, "Idempotency-Key": randomUUID() } },
            );
            expect(preferred.status(), await preferred.text()).toBe(409);
            expect(((await preferred.json()) as { error: string }).error).toBe(
                "payment_method_not_chargeable",
            );
        });

        await test.step("removing it detaches it at Stripe", async () => {
            await methodAction(owner, client, bank.last4, w.remove);
            await owner
                .getByRole("dialog")
                .getByRole("button", { name: w.removeConfirm, exact: true })
                .click();
            await expect.poll(async () => (await savedMethods(client.id)).length).toBe(0);
            await expect.poll(async () => (await walletEvidence(client.id)).methods).toEqual([]);
        });

        await info.attach("str-e30", {
            body: JSON.stringify(
                { stripe: await walletEvidence(client.id), ledger: await clientMoney(client.id) },
                null,
                2,
            ),
            contentType: "application/json",
        });
    } finally {
        await payer.context().close();
        await owner.context().close();
    }
});
