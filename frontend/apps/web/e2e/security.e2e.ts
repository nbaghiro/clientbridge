import { formatPhone, strings } from "@clientbridge/app-core/public";
import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { openClient } from "./support/clients";
import {
    expectOwnerUnchanged,
    expectRefused,
    prepareSecurityFixture,
    type SecurityFixture,
} from "./support/security";
import { navigate, signIn } from "./support/session";
import { demoId, runEmail } from "@clientbridge/config/e2e/run";
import { randomUUID } from "node:crypto";
import { openInvoice } from "./support/billing";
import { bookingApi } from "./support/bookings";
import { hoursEvidence, joinHoursStaff } from "./support/hours";

test("SEC-E2E-01 authenticated staff cannot read invoice details, record invoice payments or refund", async ({
    page,
    browser,
}, testInfo) => {
    await signIn(page);
    const fixture = await prepareSecurityFixture(page);
    const staffContext = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        viewport: { width: 1440, height: 900 },
    });
    try {
        const staff = await staffContext.newPage();
        await signIn(staff, { email: runEmail("diego@birchbark.example"), password: "demo1234" });
        await expect(staff.getByText(strings.staff.roleStaff, { exact: true })).toBeVisible();
        const record = await openClient(staff, fixture.client);
        await expect(
            record.getByRole("button", { name: strings.clients.record.invoice, exact: true }),
        ).toHaveCount(0);
        await navigate(staff, `/payments/invoices?open=${fixture.invoice.id}`);
        await expect(staff).toHaveURL(/\/payments\/sales$/);
        await expect(
            staff.getByRole("button", { name: strings.billing.recordPayment, exact: true }),
        ).toHaveCount(0);
        await expect(
            staff.getByRole("tab", { name: strings.navigation.paymentsTabs.invoices, exact: true }),
        ).toHaveCount(0);
        await navigate(staff, "/payments/refunds");
        await expect(staff).toHaveURL(/\/payments\/sales$/);
        await expect(
            staff.getByRole("tab", { name: strings.navigation.paymentsTabs.refunds, exact: true }),
        ).toHaveCount(0);
        await expectRefused(staff, `previews/invoices/${fixture.invoice.id}/send`, "GET", 403);
        await expectRefused(staff, `invoices/${fixture.invoice.id}/payments`, "POST", 403, {
            method: "cash",
            amount_cents: 100,
            send_receipt: false,
        });
        await expectRefused(staff, `payments/${fixture.paymentId}/refund-preview`, "GET", 403);
        await expectRefused(staff, `payments/${fixture.paymentId}/refund`, "POST", 403, {
            amount_cents: 100,
            reason: "other",
            notify: false,
        });
        await expectOwnerUnchanged(page, fixture);
        await testInfo.attach("unchanged-committed-payment-evidence", {
            body: JSON.stringify(fixture.payments),
            contentType: "application/json",
        });
    } finally {
        await staffContext.close();
    }
});

test("SEC-E2E-02 another business cannot read or mutate client, invoice or payment IDs", async ({
    page,
    browser,
}, testInfo) => {
    await signIn(page);
    const fixture = await prepareSecurityFixture(page);
    const foreignContext = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        viewport: { width: 1440, height: 900 },
    });
    try {
        const foreign = await foreignContext.newPage();
        await signIn(foreign, {
            email: runEmail("owner@cedarcoast.example"),
            password: "demo1234",
        });
        await navigate(foreign, `/clients/${fixture.client.id}/history`);
        await expect(
            foreign.getByText(strings.clients.record.goneBody, { exact: true }),
        ).toBeVisible({ timeout: 60_000 });
        await expect(
            foreign.getByText(formatPhone(fixture.client.phone), { exact: true }),
        ).toHaveCount(0);
        await navigate(foreign, `/payments/invoices?open=${fixture.invoice.id}`);
        await expect(
            foreign.getByRole("tab", {
                name: strings.navigation.paymentsTabs.invoices,
                exact: true,
            }),
        ).toBeVisible();
        await expect(foreign.getByRole("dialog")).toHaveCount(0);
        await expect(foreign.getByText(fixture.invoice.name, { exact: true })).toHaveCount(0);
        const history = `bookings/visits?client_id=${fixture.client.id}&before=${encodeURIComponent(new Date().toISOString())}`;
        await expectRefused(foreign, history, "GET", 404);
        await expectRefused(foreign, `clients/${fixture.client.id}`, "PATCH", 404, {
            name: "Morgan Ellis",
        });
        await expectRefused(foreign, `clients/${fixture.client.id}/archive`, "POST", 404, {});
        await expectRefused(foreign, `previews/invoices/${fixture.invoice.id}/send`, "GET", 404);
        await expectRefused(foreign, `invoices/${fixture.invoice.id}`, "PATCH", 404, {
            notes: "Please call before changing the appointment.",
        });
        await expectRefused(foreign, `invoices/${fixture.invoice.id}/payments`, "POST", 404, {
            method: "cash",
            amount_cents: 100,
            send_receipt: false,
        });
        await expectRefused(foreign, `payments/${fixture.paymentId}/refund-preview`, "GET", 404);
        await expectRefused(foreign, `payments/${fixture.paymentId}/refund`, "POST", 404, {
            amount_cents: 100,
            reason: "other",
            notify: false,
        });
        await expectRefused(foreign, history, "GET", 403, undefined, demoId("bz_birchbark"));
        await expectRefused(
            foreign,
            `clients/${fixture.client.id}`,
            "PATCH",
            403,
            { name: "Avery Patel" },
            demoId("bz_birchbark"),
        );
        await expectOwnerUnchanged(page, fixture);
        await testInfo.attach("unchanged-committed-payment-evidence", {
            body: JSON.stringify(fixture.payments),
            contentType: "application/json",
        });
    } finally {
        await foreignContext.close();
    }
});

async function adminControl(page: Page, f: SecurityFixture): Promise<void> {
    await openInvoice(page, f.invoice);
    const invoice = page.getByRole("dialog");
    await expect(
        invoice.getByText(strings.billing.statusLabel.partial, { exact: true }).first(),
    ).toBeVisible();
    await expect(
        invoice.getByRole("button", { name: strings.billing.recordPayment, exact: true }),
    ).toBeVisible();
    const preview = await page.request.get(
        `${bookingApi()}/v1/previews/invoices/${f.invoice.id}/send`,
        {
            headers: { Origin: new URL(page.url()).origin },
        },
    );
    expect(preview.status(), await preview.text()).toBe(200);
    await invoice.getByRole("button", { name: strings.common.close, exact: true }).click();
}
async function downgraded(page: Page, f: SecurityFixture): Promise<void> {
    await expect(page.getByText(strings.staff.roleStaff, { exact: true })).toBeVisible({
        timeout: 60_000,
    });
    const client = await openClient(page, f.client);
    await expect(client).toContainText(formatPhone(f.client.phone));
    await expect(
        client.getByRole("button", { name: strings.clients.record.invoice, exact: true }),
    ).toHaveCount(0);
    await navigate(page, `/payments/invoices?open=${f.invoice.id}`);
    await expect(page).toHaveURL(/\/payments\/sales$/);
    await expect(
        page.getByRole("tab", { name: strings.navigation.paymentsTabs.invoices, exact: true }),
    ).toHaveCount(0);
    await expect(
        page.getByRole("button", { name: strings.billing.recordPayment, exact: true }),
    ).toHaveCount(0);
    await expectRefused(page, `previews/invoices/${f.invoice.id}/send`, "GET", 403);
    await expectRefused(page, `invoices/${f.invoice.id}/payments`, "POST", 403, {
        method: "cash",
        amount_cents: 100,
        send_receipt: false,
    });
    await expectRefused(page, `payments/${f.paymentId}/refund`, "POST", 403, {
        amount_cents: 100,
        reason: "other",
        notify: false,
    });
}
async function removed(page: Page, f: SecurityFixture, businessId: string): Promise<void> {
    await expect(
        page.getByRole("heading", { name: strings.business.onboarding.title, exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(formatPhone(f.client.phone), { exact: true })).toHaveCount(0);
    await expect(
        page.getByRole("tab", { name: strings.navigation.paymentsTabs.invoices, exact: true }),
    ).toHaveCount(0);
    await expectRefused(
        page,
        `clients/${f.client.id}`,
        "PATCH",
        403,
        { name: f.client.name },
        businessId,
    );
    await expectRefused(
        page,
        `invoices/${f.invoice.id}/payments`,
        "POST",
        403,
        { method: "cash", amount_cents: 100, send_receipt: false },
        businessId,
    );
}

test("SYN-E2E-02 API role downgrade and removal revoke rendered finance access on two real devices", async ({
    page,
    request,
    browser,
    context,
}, info) => {
    test.setTimeout(240_000);
    const member = await joinHoursStaff(page, request);
    const baseURL = new URL(page.url()).origin;
    const ownedContexts: BrowserContext[] = [];
    const failures: unknown[] = [];
    let membershipRemoved = false;
    const transitions: object[] = [];
    try {
        const ownerContext = await browser.newContext({ baseURL });
        ownedContexts.push(ownerContext);
        const secondContext = await browser.newContext({ baseURL });
        ownedContexts.push(secondContext);
        const memberRow = await hoursEvidence(member.id);
        expect(memberRow.staff.id).toBe(member.id);
        const owner = await ownerContext.newPage();
        await signIn(owner);
        const fixture = await prepareSecurityFixture(owner);
        // Ordinary owner API role changes are intentional boundaries, not UI management coverage.
        const role = async (value: "admin" | "staff"): Promise<void> => {
            const response = await owner.request.patch(`${bookingApi()}/v1/staff/${member.id}`, {
                headers: { Origin: baseURL },
                data: { role: value },
            });
            expect(response.status(), await response.text()).toBe(204);
            transitions.push({ staffId: member.id, role: value, status: response.status() });
        };
        await role("admin");
        await page.reload();
        await expect(page.getByText(strings.staff.roleAdmin, { exact: true })).toBeVisible({
            timeout: 60_000,
        });
        await adminControl(page, fixture);
        const second = await secondContext.newPage();
        await signIn(second, member.account);
        await adminControl(second, fixture);
        await expectOwnerUnchanged(owner, fixture);
        await secondContext.setOffline(true);
        await role("staff");
        await downgraded(page, fixture);
        await expectOwnerUnchanged(owner, fixture);
        // An offline device is expected to retain its old cache until it reconnects.
        await secondContext.setOffline(false);
        await downgraded(second, fixture);
        await second.reload();
        await downgraded(second, fixture);
        await expectOwnerUnchanged(owner, fixture);
        const response = await owner.request.post(`${bookingApi()}/v1/staff/${member.id}/remove`, {
            headers: { Origin: baseURL, "Idempotency-Key": randomUUID() },
            data: {},
        });
        expect(response.status(), await response.text()).toBe(200);
        membershipRemoved = true;
        const removal: unknown = await response.json();
        transitions.push({
            staffId: member.id,
            action: "remove",
            status: response.status(),
            result: removal,
        });
        for (const device of [page, second]) {
            await removed(device, fixture, memberRow.staff.business_id);
            await device.reload();
            await removed(device, fixture, memberRow.staff.business_id);
        }
        await expectOwnerUnchanged(owner, fixture);
        await info.attach("real-membership-transitions-and-owner-control", {
            body: JSON.stringify({
                transitions,
                invoiceId: fixture.invoice.id,
                paymentId: fixture.paymentId,
                unchangedPayments: fixture.payments,
                unchangedDocument: fixture.document,
            }),
            contentType: "application/json",
        });
    } catch (error) {
        failures.push(error);
    } finally {
        const reconnected = await Promise.allSettled([
            context.setOffline(false),
            ...ownedContexts.map((owned) => owned.setOffline(false)),
        ]);
        const closed = await Promise.allSettled(ownedContexts.map((owned) => owned.close()));
        const cleaned = await Promise.allSettled(membershipRemoved ? [] : [member.cleanup()]);
        failures.push(
            ...[...reconnected, ...closed, ...cleaned].flatMap((result) =>
                result.status === "rejected" ? [result.reason as unknown] : [],
            ),
        );
    }
    if (failures.length > 0)
        throw new AggregateError(failures, "revocation journey or teardown failed");
});
