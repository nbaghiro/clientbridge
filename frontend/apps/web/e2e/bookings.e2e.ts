import { randomUUID } from "node:crypto";
import { formatFullDate, formatShortTimeRange, strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import { runEmail } from "@clientbridge/config/e2e/run";

import {
    bookFreeVisit,
    bookingApi,
    cancelOwnedBooking,
    chooseFreeBookingTime,
    committedVisits,
    createBookingFixture,
    fillBookingComposer,
    openBooking,
    type BookingRecord,
} from "./support/bookings";
import { navigate, signIn } from "./support/session";
import { apiCall, teamMember } from "./support/visit";

test("SCH-PILOT-01 create, reject overlap, reschedule and cancel across replicas", async ({
    page,
    browser,
}, testInfo) => {
    await signIn(page);
    const fixture = await createBookingFixture(page);
    await testInfo.attach("fixture", {
        body: JSON.stringify(fixture),
        contentType: "application/json",
    });
    await fillBookingComposer(page, fixture);
    await chooseFreeBookingTime(page, fixture);
    const created = page.waitForResponse(
        (response) =>
            response.url().endsWith("/v1/bookings") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: strings.bookings.composerBook, exact: true }).click();
    const createResponse = await created;
    expect(createResponse.status(), await createResponse.text()).toBe(201);
    const booking = (await createResponse.json()) as BookingRecord;
    try {
        expect(booking).toMatchObject({ status: "confirmed", staff_id: fixture.staffId });
        expect(new Date(booking.ends_at).getTime() - new Date(booking.starts_at).getTime()).toBe(
            30 * 60_000,
        );
        const observer = await browser.newContext({ baseURL: new URL(page.url()).origin });
        try {
            const other = await observer.newPage();
            await signIn(other);
            await openBooking(page, fixture, booking.id);
            await openBooking(other, fixture, booking.id);
            await test.step("reject a real conflicting command without creating another visit", async () => {
                const rejected = await page.request.post(`${bookingApi()}/v1/bookings`, {
                    headers: {
                        Origin: new URL(page.url()).origin,
                        "Idempotency-Key": randomUUID(),
                    },
                    data: {
                        client_id: fixture.clientId,
                        item_id: fixture.itemId,
                        staff_id: fixture.staffId,
                        starts_at: booking.starts_at,
                        notify: false,
                    },
                });
                expect(rejected.status(), await rejected.text()).toBe(409);
                expect(await committedVisits(other, fixture)).toEqual([
                    expect.objectContaining({
                        id: booking.id,
                        status: "confirmed",
                        starts_at: booking.starts_at,
                    }),
                ]);
            });
            await test.step("reschedule through the UI and observe committed time on both devices", async () => {
                await page
                    .getByRole("button", { name: strings.bookings.reschedule, exact: true })
                    .click();
                const times = page.getByRole("radiogroup", {
                    name: strings.bookings.rescheduleTimes,
                });
                await times.getByRole("radio", { disabled: false }).first().click();
                const moved = page.waitForResponse(
                    (response) =>
                        response.url().endsWith(`/v1/bookings/${booking.id}`) &&
                        response.request().method() === "PATCH",
                );
                await page
                    .getByRole("dialog")
                    .last()
                    .getByRole("button")
                    .filter({ hasText: strings.bookings.rescheduleTo("") })
                    .click();
                const response = await moved;
                expect(response.status(), await response.text()).toBe(200);
                const updated = (await response.json()) as BookingRecord;
                expect(updated.starts_at).not.toBe(booking.starts_at);
                expect(updated).toMatchObject({
                    id: booking.id,
                    status: "confirmed",
                    staff_id: fixture.staffId,
                });
                const time = formatShortTimeRange(
                    new Date(updated.starts_at),
                    new Date(updated.ends_at),
                    fixture.zone,
                );
                await expect(other.getByText(time, { exact: true }).first()).toBeVisible();
                await other.reload();
                await openBooking(other, fixture, booking.id);
                await expect(other.getByText(time, { exact: true }).first()).toBeVisible();
                expect(await committedVisits(other, fixture)).toEqual([
                    expect.objectContaining({
                        id: booking.id,
                        starts_at: updated.starts_at,
                        ends_at: updated.ends_at,
                    }),
                ]);
            });
            await test.step("cancel through the UI and keep the terminal state after reload", async () => {
                await page
                    .getByRole("button", { name: strings.bookings.cancel, exact: true })
                    .click();
                await expect(
                    page.getByText(strings.bookings.cancelTitle, { exact: true }),
                ).toBeVisible();
                const canceled = page.waitForResponse(
                    (response) =>
                        response.url().endsWith(`/v1/bookings/${booking.id}`) &&
                        response.request().method() === "PATCH",
                );
                await page
                    .getByRole("button", { name: strings.bookings.confirmCancel, exact: true })
                    .click();
                const response = await canceled;
                expect(response.status(), await response.text()).toBe(200);
                expect(await response.json()).toMatchObject({ id: booking.id, status: "canceled" });
                await expect(
                    other.getByRole("heading", { name: fixture.clientName, exact: true }),
                ).toHaveCount(0);
                await expect(
                    other
                        .getByRole("region", { name: strings.bookings.title, exact: true })
                        .getByRole("button")
                        .filter({ hasText: fixture.clientName }),
                ).toHaveCount(0);
                await other.reload();
                await navigate(other, `/schedule?open=${booking.id}`);
                await expect(
                    other.getByRole("heading", {
                        name: formatFullDate(new Date(booking.starts_at), fixture.zone),
                        exact: true,
                    }),
                ).toBeVisible();
                await expect(
                    other.getByRole("heading", { name: fixture.clientName, exact: true }),
                ).toHaveCount(0);
                await expect(
                    other
                        .getByRole("region", { name: strings.bookings.title, exact: true })
                        .getByRole("button")
                        .filter({ hasText: fixture.clientName }),
                ).toHaveCount(0);
                await expect(
                    other.getByRole("button", { name: strings.bookings.reschedule, exact: true }),
                ).toHaveCount(0);
                await expect(
                    other.getByRole("button", { name: strings.bookings.cancel, exact: true }),
                ).toHaveCount(0);
                const visits = await committedVisits(other, fixture);
                expect(visits).toEqual([
                    expect.objectContaining({ id: booking.id, status: "canceled" }),
                ]);
                await testInfo.attach("committed-visits", {
                    body: JSON.stringify(visits),
                    contentType: "application/json",
                });
            });
        } finally {
            await observer.close();
        }
    } finally {
        await cancelOwnedBooking(page, booking.id);
    }
});

test("CRM-E2E-21 a booking note reaches the member's panel with its author, beside only the client notes pinned to every booking", async ({
    page,
    browser,
}) => {
    await signIn(page);
    const fixture = await createBookingFixture(page);
    const diego = await teamMember(page, runEmail("diego@birchbark.example"));
    const booking = await bookFreeVisit(page, fixture, diego.id, [30, 31, 32, 33, 34, 35, 36]);
    const quiet = "Paid cash at the last visit.";
    const pinned = "Allergic to oatmeal shampoo.";
    const visitNote = "Use the side door; the front step is being fixed.";
    for (const [body, pin] of [
        [quiet, false],
        [pinned, true],
    ] as const)
        await apiCall(
            page,
            "POST",
            "/v1/notes",
            { parent_type: "client", parent_id: fixture.clientId, body, pinned: pin },
            201,
        );
    const staff = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
        await openBooking(page, fixture, booking.id);
        await page.getByRole("button", { name: strings.bookings.noteAdd, exact: true }).click();
        await page
            .getByRole("textbox", { name: strings.bookings.notePlaceholder, exact: true })
            .fill(visitNote);
        const saved = page.waitForResponse(
            (r) => new URL(r.url()).pathname === "/v1/notes" && r.request().method() === "POST",
        );
        await page
            .getByRole("button", { name: strings.clients.history.saveNote, exact: true })
            .click();
        expect((await saved).status()).toBe(201);
        await expect(page.getByText(visitNote, { exact: true })).toBeVisible();

        const member = await staff.newPage();
        await signIn(member, { email: runEmail("diego@birchbark.example"), password: "demo1234" });
        await openBooking(member, fixture, booking.id);
        const note = (body: string) => member.getByText(body, { exact: true }).locator("..");
        await expect(note(visitNote)).toContainText(fixture.staffName);
        await expect(note(pinned)).toContainText(strings.clients.record.pinned);
        await expect(note(visitNote)).not.toContainText(strings.clients.record.pinned);
        await expect(member.getByText(quiet, { exact: true })).toHaveCount(0);
    } finally {
        await staff.close();
        await cancelOwnedBooking(page, booking.id);
    }
});
