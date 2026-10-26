import { randomInt } from "node:crypto";
import { strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import { bookingApi } from "./support/bookings";
import { createClient } from "./support/crm";
import { contactEvidence, returningFixture, verifyReturning } from "./support/returning";
import { signIn } from "./support/session";
import { demoSlug } from "@clientbridge/config/e2e/run";

test.use({ actionTimeout: 15_000 });

test("CRM-E2E-07 editing verified contact clears proof and keeps conflicting details editable without writes", async ({
    page,
    browser,
}) => {
    await signIn(page);
    const fixture = await returningFixture(page);
    const other = await createClient(page);
    const phone = `+1250555${String(randomInt(1000, 10000))}`;
    const evidence = () =>
        contactEvidence([fixture.clientEmail, other.email], phone, fixture.itemId);
    const unclaimed = await evidence();
    expect(unclaimed.clients.map((c) => c.id).sort()).toEqual([fixture.clientId, other.id].sort());
    expect(unclaimed.clients.every((c) => c.phone !== phone)).toBe(true);
    const assigned = await page.request.patch(`${bookingApi()}/v1/clients/${other.id}`, {
        headers: { Origin: new URL(page.url()).origin },
        data: { phone },
    });
    expect(assigned.status(), await assigned.text()).toBe(200);
    const customerContext = await browser.newContext();
    try {
        const customer = await customerContext.newPage();
        await verifyReturning(customer, fixture, 1);
        const baseline = await evidence();
        expect(baseline.clients).toHaveLength(2);
        expect(baseline.subjects).toHaveLength(2);
        expect(baseline.bookings).toEqual([]);
        expect(baseline.slots).toEqual([]);
        await customer
            .getByRole("textbox", { name: strings.publicBooking.phone, exact: true })
            .fill(phone);
        const submitting = customer.waitForResponse(
            (r) =>
                new URL(r.url()).pathname === `/book/${demoSlug("birchbark")}` &&
                r.request().method() === "POST",
        );
        await customer
            .getByRole("button", { name: strings.publicBooking.confirm, exact: true })
            .first()
            .click();
        const response = await submitting;
        expect(response.request().postDataJSON()).toMatchObject({
            returning_token: null,
            subject_id: null,
            client: { name: fixture.clientName, email: fixture.clientEmail, phone },
        });
        expect(response.status(), await response.text()).toBe(409);
        expect(await response.json()).toMatchObject({ error: "contact_ambiguous" });
        await expect(
            customer.getByText(strings.api.contactAmbiguous, { exact: true }),
        ).toBeVisible();
        await expect(
            customer.getByRole("textbox", { name: new RegExp(`^${strings.publicBooking.email}`) }),
        ).toHaveValue(fixture.clientEmail);
        await expect(
            customer.getByRole("textbox", { name: strings.publicBooking.phone, exact: true }),
        ).toHaveValue(phone);
        await expect(
            customer.getByText(strings.publicBooking.slotTaken, { exact: true }),
        ).toHaveCount(0);
        expect(await evidence()).toEqual(baseline);
        await customer.reload();
        expect(await evidence()).toEqual(baseline);
    } finally {
        await customerContext.close();
    }
});
