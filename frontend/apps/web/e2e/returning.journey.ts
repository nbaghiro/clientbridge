import { formatParts, strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import { cancelOwnedBooking } from "./support/bookings";
import { clientCommand, editClient } from "./support/crm";
import { returningEvidence, returningFixture, verifyReturning } from "./support/returning";
import { navigate, signIn } from "./support/session";
import { demoSlug } from "@clientbridge/config/e2e/run";

test.use({ actionTimeout: 15_000 });

test("CRM-E2E-05 verified returning customer books the selected existing pet and retains original contact data", async ({
    page,
    browser,
}) => {
    await signIn(page);
    const fixture = await returningFixture(page);
    const initial = await returningEvidence(fixture);
    const customerContext = await browser.newContext();
    let bookingId: string | undefined;
    try {
        const customer = await customerContext.newPage();
        await verifyReturning(customer, fixture, 0);
        await expect(
            customer.getByRole("textbox", { name: strings.publicBooking.name, exact: true }),
        ).toHaveValue(fixture.clientName);
        await expect(
            customer.getByRole("textbox", { name: strings.publicBooking.phone, exact: true }),
        ).toHaveValue("");
        const submitted = customer.waitForResponse(
            (r) =>
                new URL(r.url()).pathname === `/book/${demoSlug("birchbark")}` &&
                r.request().method() === "POST",
        );
        await customer
            .getByRole("button", { name: strings.publicBooking.confirm, exact: true })
            .first()
            .click();
        const response = await submitted;
        const submittedBody = response.request().postDataJSON() as {
            returning_token: string | null;
            subject_id: string | null;
        };
        expect(submittedBody.returning_token).toEqual(expect.any(String));
        expect(submittedBody.returning_token?.length).toBeGreaterThan(0);
        expect(submittedBody.subject_id).toBe(fixture.petId);
        expect(response.status(), await response.text()).toBe(200);
        const result = (await response.json()) as { booking_id: string; status: string };
        bookingId = result.booking_id;
        expect(result.status).toBe("pending");
        await expect(
            customer.getByRole("heading", {
                name: strings.publicBooking.pendingTitle,
                exact: true,
            }),
        ).toBeVisible();
        const committed = await returningEvidence(fixture);
        expect(committed.clients).toEqual(initial.clients);
        expect(committed.subjects).toEqual(initial.subjects);
        expect(committed.bookings).toEqual([
            expect.objectContaining({
                id: bookingId,
                client_id: fixture.clientId,
                subject_id: fixture.petId,
                status: "pending",
                source: "online",
                price_cents: 1000,
                deposit_amount_cents: 0,
                deposit_status: "none",
            }),
        ]);
        expect(committed.slots).toEqual([
            expect.objectContaining({ item_id: fixture.itemId, staff_id: fixture.staffId }),
        ]);
        expect(committed.challenges).toEqual([
            expect.objectContaining({ client_id: fixture.clientId, verified: true }),
        ]);
        const observerContext = await browser.newContext();
        try {
            const observer = await observerContext.newPage();
            await signIn(observer);
            await navigate(observer, `/schedule?open=${bookingId}`);
            const heading = observer.getByRole("heading", {
                name: formatParts(["Clover", fixture.clientName]),
                exact: true,
            });
            const service = observer.getByText(fixture.itemName, { exact: true }).first();
            await expect(heading).toBeVisible({ timeout: 60_000 });
            await expect(service).toBeVisible();
            await observer.reload();
            await navigate(observer, `/schedule?open=${bookingId}`);
            await expect(heading).toBeVisible({ timeout: 60_000 });
            await expect(service).toBeVisible();
            expect(await returningEvidence(fixture)).toEqual(committed);
        } finally {
            await observerContext.close();
        }
    } finally {
        try {
            if (bookingId) await cancelOwnedBooking(page, bookingId);
        } finally {
            await customerContext.close();
        }
    }
});

test("CRM-E2E-06 archiving a verified customer revokes their proof before public booking", async ({
    page,
    browser,
}) => {
    await signIn(page);
    const fixture = await returningFixture(page);
    const customerContext = await browser.newContext();
    try {
        const customer = await customerContext.newPage();
        await verifyReturning(customer, fixture, 1);
        const editor = await editClient(page, fixture.client);
        await editor
            .getByRole("button", { name: strings.clients.edit.archive, exact: true })
            .click();
        const archived = clientCommand(page, `/${fixture.clientId}/archive`, "POST");
        await page
            .getByRole("dialog", {
                name: strings.clients.edit.archiveTitle(fixture.clientName),
                exact: true,
            })
            .getByRole("button", { name: strings.clients.edit.archiveConfirm, exact: true })
            .click();
        expect((await archived).status()).toBe(200);
        const before = await returningEvidence(fixture);
        expect(before.clients).toEqual([
            expect.objectContaining({ id: fixture.clientId, status: "inactive" }),
        ]);
        expect(before.bookings).toEqual([]);
        expect(before.slots).toEqual([]);
        const submitted = customer.waitForResponse(
            (r) =>
                new URL(r.url()).pathname === `/book/${demoSlug("birchbark")}` &&
                r.request().method() === "POST",
        );
        await customer
            .getByRole("button", { name: strings.publicBooking.confirm, exact: true })
            .first()
            .click();
        const rejected = await submitted;
        expect(rejected.status(), await rejected.text()).toBe(401);
        expect(await rejected.json()).toMatchObject({ error: "unauthorized" });
        await expect(
            customer.getByText(strings.publicBooking.bookError, { exact: true }).first(),
        ).toBeVisible();
        expect(await returningEvidence(fixture)).toEqual(before);
        await page.reload();
        expect(await returningEvidence(fixture)).toEqual(before);
    } finally {
        await customerContext.close();
    }
});
