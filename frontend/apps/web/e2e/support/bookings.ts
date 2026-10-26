import { randomUUID } from "node:crypto";
import {
    addDays,
    combineDayAndTime,
    formatFullDate,
    formatTime,
    strings,
} from "@clientbridge/app-core/public";
import { demoPerson } from "@clientbridge/config/e2e/demo";
import { expect, type Page } from "@playwright/test";

import { requireLocalMail } from "./evidence";
import { navigate } from "./session";
import { runEmail, runUrl } from "@clientbridge/config/e2e/run";

export interface BookingFixture {
    clientId: string;
    clientName: string;
    clientEmail: string;
    itemId: string;
    itemName: string;
    staffId: string;
    staffName: string;
    zone: string;
}

export interface BookingRecord {
    id: string;
    status: string;
    staff_id: string;
    starts_at: string;
    ends_at: string;
}

export function bookingApi(): string {
    const base = runUrl("VITE_API_URL");
    if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) {
        throw new Error("Booking fixtures require a local API and SMTP sink");
    }
    return base;
}

export async function createBookingFixture(
    page: Page,
    overrides: Record<string, unknown> = {},
): Promise<BookingFixture> {
    requireLocalMail();
    const api = bookingApi();
    const run = randomUUID();
    const clientName = demoPerson(run);
    const clientEmail = runEmail(`booking-${run}@example.ca`);
    const itemName = `Coat care for ${clientName}`;
    const headers = { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() };
    const team = await page.request.get(`${api}/v1/staff/team`);
    expect(team.status()).toBe(200);
    const { members } = (await team.json()) as {
        members: { id: string; email: string; name: string; status: string }[];
    };
    const staff = members.find((member) => member.email === runEmail("hannah@birchbark.example"));
    expect(staff?.status).toBe("active");
    if (!staff) throw new Error("The Birch & Bark owner fixture is missing");
    const client = await page.request.post(`${api}/v1/clients`, {
        headers,
        data: { name: clientName, email: clientEmail, preferred_channel: "email" },
    });
    expect(client.status(), await client.text()).toBe(201);
    const item = await page.request.post(`${api}/v1/items`, {
        headers,
        data: {
            kind: "service",
            name: itemName,
            duration_min: 30,
            price_cents: 1000,
            deposit_type: "none",
            online_bookable: false,
            ...overrides,
        },
    });
    expect(item.status(), await item.text()).toBe(201);
    return {
        clientId: ((await client.json()) as { id: string }).id,
        clientName,
        clientEmail,
        itemId: ((await item.json()) as { id: string }).id,
        itemName,
        staffId: staff.id,
        staffName: staff.name,
        zone: "America/Vancouver",
    };
}

export async function fillBookingComposer(page: Page, fixture: BookingFixture): Promise<void> {
    await navigate(page, "/schedule?new=1");
    const form = page.getByRole("form", { name: strings.bookings.composerTitle });
    await form.getByRole("searchbox").fill(fixture.clientEmail);
    await form
        .getByRole("button")
        .filter({ has: page.getByText(fixture.clientName, { exact: true }) })
        .click();
    await form
        .getByRole("combobox", { name: strings.bookings.composerService })
        .fill(fixture.itemName);
    const service = page.locator(`[role="option"][data-value="${fixture.itemId}"]`);
    await expect(service.getByText(fixture.itemName, { exact: true })).toBeVisible();
    await service.click();
    const staff = form.getByRole("group", { name: strings.bookings.composerWith, exact: true });
    const name = fixture.staffName.split(" ")[0] ?? fixture.staffName;
    await staff
        .getByRole("button", { name, exact: true })
        .or(staff.getByRole("button", { name: `${name} ${strings.bookings.busy}`, exact: true }))
        .click();
    await form.getByRole("switch", { name: strings.bookings.composerConfirm }).uncheck();
}

export async function pickBookingDay(page: Page, date: Date, zone: string): Promise<void> {
    await page.getByRole("button", { name: strings.bookings.composerDate, exact: true }).click();
    const target = page.getByRole("gridcell", { name: formatFullDate(date, zone), exact: true });
    for (let month = 0; month < 3 && (await target.count()) === 0; month++) {
        await page.getByRole("button", { name: strings.ui.nextMonth, exact: true }).click();
    }
    await target.click();
}

export async function pickBookingTime(
    page: Page,
    day: Date,
    time: string,
    zone: string,
): Promise<void> {
    await page.getByRole("combobox", { name: strings.bookings.composerTime }).click();
    await page
        .getByRole("option", {
            name: formatTime(combineDayAndTime(day, time, zone), zone),
            exact: true,
        })
        .click();
}

export async function chooseFreeBookingTime(page: Page, fixture: BookingFixture): Promise<void> {
    const submit = page.getByRole("button", { name: strings.bookings.composerBook, exact: true });
    for (let offset = 14; offset < 21; offset++) {
        const day = addDays(new Date(), offset, fixture.zone);
        await pickBookingDay(page, day, fixture.zone);
        for (const time of ["10:00", "11:00", "13:00", "14:00", "15:00"]) {
            await pickBookingTime(page, day, time, fixture.zone);
            if (await submit.isEnabled()) return;
        }
    }
    throw new Error("No free owner appointment found in the fixture window");
}

export async function openBooking(
    page: Page,
    fixture: BookingFixture,
    id: string,
    heading = fixture.clientName,
): Promise<void> {
    await navigate(page, `/schedule?open=${id}`);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible({
        timeout: 60_000,
    });
    await expect(page.getByText(fixture.itemName, { exact: true }).first()).toBeVisible();
}

export async function committedVisits(
    page: Page,
    fixture: BookingFixture,
): Promise<BookingRecord[]> {
    const response = await page.request.get(`${bookingApi()}/v1/bookings/visits`, {
        params: {
            client_id: fixture.clientId,
            before: addDays(new Date(), 60, fixture.zone).toISOString(),
        },
    });
    expect(response.status(), await response.text()).toBe(200);
    const body = (await response.json()) as { visits: BookingRecord[]; more: boolean };
    expect(body.more).toBe(false);
    return body.visits;
}

export async function createBookingThroughUi(
    page: Page,
    fixture: BookingFixture,
): Promise<BookingRecord> {
    await fillBookingComposer(page, fixture);
    await chooseFreeBookingTime(page, fixture);
    const created = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === "/v1/bookings" &&
            response.request().method() === "POST",
    );
    await page.getByRole("button", { name: strings.bookings.composerBook, exact: true }).click();
    const response = await created;
    expect(response.status(), await response.text()).toBe(201);
    return (await response.json()) as BookingRecord;
}

export async function cancelOwnedBooking(page: Page, bookingId: string): Promise<void> {
    const response = await page.request.patch(`${bookingApi()}/v1/bookings/${bookingId}`, {
        headers: { Origin: new URL(page.url()).origin },
        data: { status: "canceled", notify: false },
    });
    expect(response.status(), await response.text()).toBe(200);
    expect(await response.json()).toMatchObject({ id: bookingId, status: "canceled" });
}
