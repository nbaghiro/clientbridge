import { randomUUID } from "node:crypto";
import { demoPerson } from "@clientbridge/config/e2e/demo";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { nativeSession } from "../support/auth";
import { bookingApi } from "../support/bookings";
import { communicationEvidence, emailEvent } from "../support/communication";
import { paymentEvidence } from "../support/evidence";
import { prepareSecurityFixture } from "../support/security";
import { signIn } from "../support/session";

function operator(): { email: string; password: string } {
    const email = process.env.E2E_OPERATOR_CONSOLE_EMAIL;
    const password = process.env.E2E_OPERATOR_CONSOLE_PASSWORD;
    if (!email || !password)
        throw new Error("The platform operator is not set; run the case through the e2e stack");
    return { email, password };
}

async function admin<T>(request: APIRequestContext, token: string, path: string): Promise<T> {
    const response = await request.get(`${bookingApi()}/admin/v1${path}`, {
        headers: { "X-Session-Token": token },
    });
    expect(response.status(), `${path}: ${await response.text()}`).toBe(200);
    return (await response.json()) as T;
}

interface Page<T> {
    items: T[];
    has_more: boolean;
}

test("FLOW-10-A a desk payment is traceable in the operator console's ledger and activity, and failed delivery and callback work shows only where it belongs", async ({
    page,
    request,
}, testInfo) => {
    test.setTimeout(240_000);
    await signIn(page);
    const fixture = await prepareSecurityFixture(page);
    const owned = await paymentEvidence(fixture.invoice.id);
    const legs = owned.entries.filter((entry) => entry.source_id === fixture.paymentId);
    expect(legs.map((leg) => [leg.category, leg.amount_cents]).sort()).toEqual([
        ["cash", 400],
        ["receivable", -400],
    ]);

    const denied = await page.request.get(`${bookingApi()}/admin/v1/payments`);
    expect(denied.status()).toBe(403);
    const credentials = operator();
    const token = await nativeSession(request, credentials.email, credentials.password);

    const found = await admin<Page<{ id: string; status: string; amount_cents: number }>>(
        request,
        token,
        `/payments?q=${fixture.invoice.id}`,
    );
    expect(found.items).toEqual([
        expect.objectContaining({ id: fixture.paymentId, status: "succeeded", amount_cents: 400 }),
    ]);
    const detail = await admin<{
        payment: { id: string; business_name: string | null };
        entries: { journal_id: string; account_category: string; amount_cents: number }[];
        refunds: unknown[];
        stripe_url: string | null;
    }>(request, token, `/payments/${fixture.paymentId}`);
    expect(detail.refunds).toEqual([]);
    expect(detail.stripe_url).toBeNull();
    // the console shows the same balanced journal the database holds, leg for leg
    expect(
        detail.entries
            .map((leg) => [leg.journal_id, leg.account_category, leg.amount_cents])
            .sort(),
    ).toEqual(legs.map((leg) => [leg.journal_id, leg.category, leg.amount_cents]).sort());
    expect(detail.entries.reduce((sum, leg) => sum + leg.amount_cents, 0)).toBe(0);
    const activity = await admin<
        Page<{ entity_id: string; action: string; business_name: string | null }>
    >(request, token, `/activity?q=${fixture.paymentId}`);
    expect(activity.items.length).toBeGreaterThan(0);
    for (const row of activity.items)
        expect(row).toMatchObject({
            entity_id: fixture.paymentId,
            business_name: "Birchbark Pet Studio",
        });

    const origin = new URL(page.url()).origin;
    const created = await page.request.post(`${bookingApi()}/v1/clients`, {
        headers: { Origin: origin, "Idempotency-Key": randomUUID() },
        data: {
            name: demoPerson(randomUUID()),
            email: `ops-${randomUUID()}@mailbox.invalid`,
            preferred_channel: "email",
        },
    });
    expect(created.status(), await created.text()).toBe(201);
    const unreachable = ((await created.json()) as { id: string }).id;
    const invoice = await page.request.post(`${bookingApi()}/v1/invoices`, {
        headers: { Origin: origin, "Idempotency-Key": randomUUID() },
        data: {
            client_id: unreachable,
            send: true,
            lines: [
                {
                    description: "Nail trim",
                    quantity: 1,
                    unit_amount_cents: 2000,
                    tax_class: "standard",
                },
            ],
        },
    });
    expect(invoice.status(), await invoice.text()).toBe(201);
    const failed = (await communicationEvidence(unreachable)).deliveries;
    expect(failed).toEqual([
        expect.objectContaining({ channel: "email", state: "failed", error: "reserved_address" }),
    ]);
    const history = await admin<Page<{ id: string }>>(request, token, "/deliveries");
    // the console's delivery history is for operator test mail, not business notices
    expect(history.items.map((row) => row.id)).not.toContain(failed[0]?.id);

    const before = await admin<{ failed_webhooks: number }>(request, token, "/overview");
    const event = { type: "email.delivered" as const, emailId: "", to: "", tags: {} };
    const garbled = await emailEvent(request, event, { body: "{not json" });
    expect(garbled.status).toBe(200);
    const forged = await emailEvent(request, event, { body: "{not json", forged: true });
    expect(forged.status).toBe(401);
    const operations = await admin<{
        webhooks: Page<{ id: string; provider: string; event: string; status: string }>;
    }>(request, token, "/operations?status=failed");
    expect(operations.webhooks.items).toContainEqual(
        expect.objectContaining({
            id: `resend_${garbled.id}`,
            provider: "resend",
            event: "unparsed",
            status: "failed",
        }),
    );
    expect(operations.webhooks.items.map((row) => row.id)).not.toContain(`resend_${forged.id}`);
    const after = await admin<{ failed_webhooks: number }>(request, token, "/overview");
    expect(after.failed_webhooks).toBeGreaterThan(before.failed_webhooks);
    await testInfo.attach("operational-trail", {
        body: JSON.stringify({ payment: detail, activity: activity.items, failed }),
        contentType: "application/json",
    });
});
