import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import {
    checkoutDiagnostics,
    enterStripeCard,
    openStripeInvoice,
    openRegisteredStripeInvoice,
    settledStripeInvoice,
    stripeChallenge,
    stripeEvidence,
    submitStripeCard,
    unpaidStripeInvoice,
} from "./stripe-provider";
import { signIn } from "../../web/e2e/support/session";
import { expectPaid, openInvoice } from "../../web/e2e/support/billing";
import {
    controlStripeRelay,
    issueStripeInvoice,
    stripeReceipt,
    stripeReceiptEvidence,
} from "./stripe-bridge";
import { documentApi } from "./documents";
import { receiptMessages } from "../../web/e2e/support/evidence";
import { runPort } from "@clientbridge/config/e2e/run";

const authenticatedCard = "4000000000003220";

test(
    "STRIPE-BROWSER-01 customer pays a CAD invoice through Stripe.js and signed settlement persists",
    { tag: "@browsers" },
    async ({ page, request }, info) => {
        const { invoice, payment } = await openStripeInvoice(page, request);
        await enterStripeCard(payment, "4242424242424242");
        await submitStripeCard(page, info);
        await settledStripeInvoice(page, request, invoice, info);
    },
);

test("STRIPE-BROWSER-02 declined card stays unpaid then corrected card settles the same payment once", async ({
    page,
    request,
}, info) => {
    const { invoice, payment } = await openStripeInvoice(page, request);
    await enterStripeCard(payment, "4000000000009995");
    await submitStripeCard(page, info);
    await expect(page.getByRole("alert")).toContainText(/insufficient funds|declined/i);
    await expect(page.getByRole("heading", { name: strings.publicPay.paidTitle })).toHaveCount(0);
    await expect(async () => {
        const failed = await unpaidStripeInvoice(request, invoice);
        expect(failed.payments[0]?.status).toBe("failed");
        expect(failed.stripe[0]).toMatchObject({
            status: "requires_payment_method",
            decline_code: "insufficient_funds",
        });
        expect(failed.webhooks).toEqual([
            expect.objectContaining({
                event: "payment_intent.payment_failed",
                status: "processed",
                processed: true,
            }),
        ]);
    }).toPass({ timeout: 30_000 });
    const failed = await unpaidStripeInvoice(request, invoice);
    await info.attach("committed-decline", {
        body: JSON.stringify(failed),
        contentType: "application/json",
    });
    await enterStripeCard(payment, "4242424242424242");
    await submitStripeCard(page, info);
    const paid = await settledStripeInvoice(page, request, invoice, info, [
        "payment_intent.payment_failed",
        "payment_intent.succeeded",
    ]);
    expect(paid.payments[0]?.id).toBe(failed.payments[0]?.id);
    expect(paid.stripe[0]?.id).toBe(failed.stripe[0]?.id);
});

test(
    "STRIPE-BROWSER-03 completing a real 3DS challenge settles only after authentication",
    { tag: "@browsers" },
    async ({ page, request }, info) => {
        const { invoice, payment } = await openStripeInvoice(page, request);
        await enterStripeCard(payment, authenticatedCard);
        await submitStripeCard(page, info);
        const challenge = await stripeChallenge(page);
        await expect(page.getByRole("heading", { name: strings.publicPay.paidTitle })).toHaveCount(
            0,
        );
        const pending = await unpaidStripeInvoice(request, invoice);
        expect(pending.payments[0]?.status).toBe("pending");
        expect(pending.stripe[0]).toMatchObject({
            status: "requires_action",
            next_action_type: "use_stripe_sdk",
        });
        await info.attach("before-authentication", {
            body: JSON.stringify(pending),
            contentType: "application/json",
        });
        await challenge.getByRole("button", { name: "Complete", exact: true }).click();
        const paid = await settledStripeInvoice(page, request, invoice, info);
        expect(paid.stripe[0]?.three_d_secure).toMatchObject({
            result: "authenticated",
            authentication_flow: "challenge",
        });
        expect(paid.payments[0]?.id).toBe(pending.payments[0]?.id);
        expect(paid.stripe[0]?.id).toBe(pending.stripe[0]?.id);
    },
);

test("STRIPE-BROWSER-04 closing a real 3DS challenge leaves the invoice unpaid after reload", async ({
    page,
    request,
}, info) => {
    const { invoice, payment } = await openStripeInvoice(page, request);
    await enterStripeCard(payment, authenticatedCard);
    await submitStripeCard(page, info);
    const challenge = await stripeChallenge(page);
    await expect(page.getByRole("heading", { name: strings.publicPay.paidTitle })).toHaveCount(0);
    const pending = await unpaidStripeInvoice(request, invoice);
    expect(pending.stripe[0]?.status).toBe("requires_action");
    const dialog = challenge.parentFrame();
    if (!dialog) throw new Error("Stripe challenge has no enclosing authentication dialog");
    await dialog.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("heading", { name: strings.publicPay.paidTitle })).toHaveCount(0);
    await expect(async () => {
        const canceled = await unpaidStripeInvoice(request, invoice);
        expect(canceled.payments[0]?.status).toBe("failed");
        expect(canceled.stripe[0]).toMatchObject({
            status: "requires_payment_method",
            error_code: "payment_intent_authentication_failure",
            next_action_type: null,
        });
        expect(canceled.webhooks).toEqual([
            expect.objectContaining({
                event: "payment_intent.payment_failed",
                status: "processed",
                processed: true,
            }),
        ]);
    }).toPass({ timeout: 30_000 });
    const canceled = await unpaidStripeInvoice(request, invoice);
    expect(canceled.payments[0]?.id).toBe(pending.payments[0]?.id);
    expect(canceled.stripe[0]?.id).toBe(pending.stripe[0]?.id);
    await info.attach("after-authentication-cancel", {
        body: JSON.stringify(canceled),
        contentType: "application/json",
    });
    await checkoutDiagnostics(page, info);
    await page.reload();
    await expect(
        page.getByRole("button", { name: strings.publicPay.payByCard, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: strings.publicPay.paidTitle })).toHaveCount(0);
    expect(await unpaidStripeInvoice(request, invoice)).toEqual(canceled);
});

test("STRIPE-BROWSER-05 owner issues an invoice and emailed card checkout reaches both owner replicas", async ({
    browser,
}, info) => {
    const ownerContext = await browser.newContext({
        baseURL: `http://localhost:${String(runPort("WEB_E2E_PORT"))}`,
    });
    const replicaContext = await browser.newContext({
        baseURL: `http://localhost:${String(runPort("WEB_E2E_PORT"))}`,
    });
    const customerContext = await browser.newContext();
    try {
        const owner = await ownerContext.newPage();
        const replica = await replicaContext.newPage();
        const customer = await customerContext.newPage();
        await signIn(owner);
        const fixture = await issueStripeInvoice(owner);
        const ownerInvoice = {
            id: fixture.invoice.id,
            name: fixture.client.name,
            phone: fixture.client.phone,
        };
        await signIn(replica);
        for (const page of [owner, replica]) {
            await openInvoice(page, ownerInvoice);
            await expect(
                page
                    .getByRole("dialog")
                    .getByText(strings.billing.statusLabel.sent, { exact: true })
                    .first(),
            ).toBeVisible();
        }
        const { payment } = await openRegisteredStripeInvoice(
            customer,
            fixture.invoice,
            fixture.url,
        );
        await enterStripeCard(payment, "4242424242424242");
        await submitStripeCard(customer, info);
        const settled = await settledStripeInvoice(
            customer,
            customer.request,
            fixture.invoice,
            info,
        );
        const paymentId = settled.payments[0]?.id;
        if (!paymentId) throw new Error("Settled payment is missing");
        for (const page of [owner, replica]) await expectPaid(page);
        const receipt = await stripeReceipt(owner, fixture.client, fixture.invoice.id, paymentId);
        expect(receipt.mailId).not.toBe(fixture.invoiceMailId);
        for (const page of [owner, replica]) {
            await page.reload();
            await openInvoice(page, ownerInvoice);
            await expectPaid(page);
        }
        expect(await stripeReceipt(owner, fixture.client, fixture.invoice.id, paymentId)).toEqual(
            receipt,
        );
        await info.attach("bridge-receipt", {
            body: JSON.stringify(receipt),
            contentType: "application/json",
        });
    } finally {
        await customerContext.close();
        await replicaContext.close();
        await ownerContext.close();
    }
});

test("STRIPE-BROWSER-06 held genuine settlement leaves durable invoice unpaid until release", async ({
    browser,
}, info) => {
    const ownerContext = await browser.newContext({
        baseURL: `http://localhost:${String(runPort("WEB_E2E_PORT"))}`,
    });
    const replicaContext = await browser.newContext({
        baseURL: `http://localhost:${String(runPort("WEB_E2E_PORT"))}`,
    });
    const customerContext = await browser.newContext();
    try {
        const owner = await ownerContext.newPage();
        const replica = await replicaContext.newPage();
        const customer = await customerContext.newPage();
        await signIn(owner);
        const fixture = await issueStripeInvoice(owner);
        const ownerInvoice = {
            id: fixture.invoice.id,
            name: fixture.client.name,
            phone: fixture.client.phone,
        };
        await signIn(replica);
        for (const page of [owner, replica]) await openInvoice(page, ownerInvoice);
        const { payment } = await openRegisteredStripeInvoice(
            customer,
            fixture.invoice,
            fixture.url,
        );
        const pending = await stripeEvidence(fixture.invoice.id);
        const intentId = pending.stripe[0]?.id;
        if (!intentId) throw new Error("Created Stripe intent is missing");
        await controlStripeRelay(owner, "arm", { invoice: fixture.invoice.id, intent: intentId });
        await enterStripeCard(payment, "4242424242424242");
        await submitStripeCard(customer, info);
        await expect(
            customer.getByRole("heading", { name: strings.publicPay.paidTitle }),
        ).toBeVisible();
        await expect.poll(async () => (await controlStripeRelay(owner, "status")).held).toBe(true);
        const held = await stripeEvidence(fixture.invoice.id);
        expect(held.payments).toHaveLength(1);
        expect(held.payments[0]).toMatchObject({ id: pending.payments[0]?.id, status: "pending" });
        expect(held.provider_intent_ids).toEqual([intentId]);
        expect(held.stripe).toEqual([
            expect.objectContaining({
                id: intentId,
                status: "succeeded",
                charge_paid: true,
                amount_captured: 2000,
            }),
        ]);
        expect(held.entries).toEqual([]);
        expect(held.webhooks).toEqual([]);
        expect(await stripeReceiptEvidence(fixture.invoice.id)).toEqual({ receipts: [] });
        expect(await receiptMessages(owner.request, fixture.client.phone)).toEqual([]);
        for (const page of [owner, replica]) {
            await expect(
                page
                    .getByRole("dialog")
                    .getByText(strings.billing.statusLabel.sent, { exact: true })
                    .first(),
            ).toBeVisible();
            await expect(
                page
                    .getByRole("dialog")
                    .getByText(strings.billing.statusLabel.paid, { exact: true }),
            ).toHaveCount(0);
        }
        await checkoutDiagnostics(customer, info);
        await customer.reload();
        await expect(
            customer.getByRole("button", { name: strings.publicPay.payByCard, exact: true }),
        ).toBeVisible();
        await expect(
            customer.getByRole("heading", { name: strings.publicPay.paidTitle }),
        ).toHaveCount(0);
        const publicState = await customer.request.get(
            `${documentApi}/pay/${fixture.invoice.pay_token}`,
        );
        expect(await publicState.json()).toMatchObject({ status: "sent", balance_cents: 2000 });
        const reloaded = await stripeEvidence(fixture.invoice.id);
        expect(reloaded.payments).toEqual(held.payments);
        expect(reloaded.entries).toEqual([]);
        expect(reloaded.webhooks).toEqual([]);
        expect(reloaded.provider_intent_ids).toEqual([intentId]);
        expect(reloaded.stripe[0]).toMatchObject({
            id: intentId,
            status: "succeeded",
            charge: held.stripe[0]?.charge,
        });
        expect(await stripeReceiptEvidence(fixture.invoice.id)).toEqual({ receipts: [] });
        await info.attach("held-genuine-settlement", {
            body: JSON.stringify({
                optimisticCustomerPaid: true,
                canonicalReloadPaid: false,
                evidence: held,
                relay: await controlStripeRelay(owner, "status"),
            }),
            contentType: "application/json",
        });
        await expect(async () => {
            expect((await controlStripeRelay(owner, "release")).upstream_status).toBe(200);
        }).toPass({ timeout: 60_000, intervals: [1000, 3000, 5000] });
        await customer.reload();
        const paid = await settledStripeInvoice(customer, customer.request, fixture.invoice, info);
        expect(paid.payments[0]?.id).toBe(held.payments[0]?.id);
        expect(paid.stripe[0]?.id).toBe(intentId);
        expect(paid.stripe[0]?.charge).toBe(held.stripe[0]?.charge);
        const relayState = await controlStripeRelay(owner, "status");
        const heldEvents = relayState.records
            ?.filter((record) => record.status === "held")
            .map((record) => record.event);
        expect(new Set(heldEvents)).toEqual(new Set(paid.webhooks.map((event) => event.id)));
        expect(relayState.held).toBe(false);
        const paymentId = paid.payments[0]?.id;
        if (!paymentId) throw new Error("Settled payment missing");
        const receipt = await stripeReceipt(owner, fixture.client, fixture.invoice.id, paymentId);
        for (const page of [owner, replica]) {
            await expectPaid(page);
            await page.reload();
            await openInvoice(page, ownerInvoice);
            await expectPaid(page);
        }
        expect(await stripeReceipt(owner, fixture.client, fixture.invoice.id, paymentId)).toEqual(
            receipt,
        );
        await info.attach("released-genuine-settlement", {
            body: JSON.stringify({ receipt, relay: await controlStripeRelay(owner, "status") }),
            contentType: "application/json",
        });
    } finally {
        await customerContext.close();
        await replicaContext.close();
        await ownerContext.close();
    }
});
