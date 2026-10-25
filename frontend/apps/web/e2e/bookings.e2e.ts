import { randomUUID } from "node:crypto";
import { formatFullDate, formatShortTimeRange, strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";

import {
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
