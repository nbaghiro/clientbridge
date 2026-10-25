import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";

import { openClient } from "./support/crm";
import { expectOwnerUnchanged, expectRefused, prepareSecurityFixture } from "./support/security";
import { navigate, signIn } from "./support/session";

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
        await signIn(staff, { email: "diego@birchbark.example", password: "demo1234" });
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
        await signIn(foreign, { email: "owner@cedarcoast.example", password: "demo1234" });
        await navigate(foreign, `/clients/${fixture.client.id}/history`);
        await expect(
            foreign.getByText(strings.clients.record.goneBody, { exact: true }),
        ).toBeVisible({ timeout: 60_000 });
        await expect(foreign.getByText(fixture.client.email, { exact: true })).toHaveCount(0);
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
        await expectRefused(foreign, history, "GET", 403, undefined, "bz_birchbark");
        await expectRefused(
            foreign,
            `clients/${fixture.client.id}`,
            "PATCH",
            403,
            { name: "Avery Patel" },
            "bz_birchbark",
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
