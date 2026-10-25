import { randomUUID } from "node:crypto";
import { formatParts, strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";

import { newAccount } from "./identity";
import {
    bookingApi,
    chooseFreeBookingTime,
    fillBookingComposer,
    openBooking,
    type BookingRecord,
} from "./support/bookings";
import { createClient, openClient } from "./support/crm";
import { openBusiness, signUp } from "./support/onboarding";
import { apiCall, visitEvidence } from "./support/visits";

const v = strings.subjects.fields.vehicle;

test("CRM-E2E-08 a detailing business books a client's parked vehicle as the visit's subject", async ({
    page,
    request,
}, testInfo) => {
    test.setTimeout(240_000);
    const account = newAccount("detailing");
    await signUp(page, request, account);
    await openBusiness(page, `${account.name} Mobile Detailing`, "detailing");
    const client = await createClient(page);
    const record = await openClient(page, client);
    await record
        .getByRole("button", { name: strings.subjects.add("vehicle"), exact: true })
        .click();
    const form = page.getByRole("dialog", { name: strings.subjects.add("vehicle"), exact: true });
    await expect(
        form.getByRole("textbox", { name: strings.subjects.fields.pet.breed, exact: false }),
    ).toHaveCount(0);
    await form.getByRole("textbox", { name: strings.subjects.nameLabel }).fill("Family Outback");
    await form.getByLabel(v.make, { exact: false }).fill("Subaru");
    await form.getByLabel(v.model, { exact: false }).fill("Outback");
    await form.getByLabel(v.year, { exact: false }).fill("2019");
    await form.getByLabel(v.colour, { exact: false }).fill("Forest green");
    await form.getByLabel(v.plate, { exact: false }).fill("RX4 21K");
    await form
        .getByRole("group", { name: v.size, exact: true })
        .locator('button[data-value="suv"]')
        .click();
    await form.getByLabel(v.address, { exact: false }).fill("1285 West Pender Street, Vancouver");
    const saving = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === "/v1/subjects" &&
            response.request().method() === "POST",
    );
    await form.getByRole("button", { name: strings.subjects.save("vehicle"), exact: true }).click();
    const saved = await saving;
    expect(saved.status(), await saved.text()).toBe(201);
    const vehicle = ((await saved.json()) as { id: string }).id;
    await expect(
        record.getByRole("button", {
            name: strings.subjects.editNamed("Family Outback"),
            exact: true,
        }),
    ).toBeVisible();
    const added = await visitEvidence([client.id]);
    expect(added.subjects).toEqual([
        {
            id: vehicle,
            client_id: client.id,
            name: "Family Outback",
            attributes: {
                make: "Subaru",
                model: "Outback",
                year: 2019,
                colour: "Forest green",
                plate: "RX4 21K",
                size: "suv",
                address: "1285 West Pender Street, Vancouver",
            },
        },
    ]);
    const boat = await page.request.post(`${bookingApi()}/v1/subjects`, {
        headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
        data: { client_id: client.id, name: "Lake boat", attributes: { size: "boat" } },
    });
    expect(boat.status(), await boat.text()).toBe(422);
    expect((await visitEvidence([client.id])).subjects).toEqual(added.subjects);

    const team = await page.request.get(`${bookingApi()}/v1/staff/team`);
    expect(team.status()).toBe(200);
    const owner = ((await team.json()) as { members: { id: string; name: string }[] }).members[0];
    if (owner === undefined) throw new Error("The new business has no owner on its team");
    const service = await apiCall<{ id: string; name: string }>(
        page,
        "POST",
        "/v1/items",
        {
            kind: "service",
            name: "Interior detail",
            duration_min: 30,
            price_cents: 14900,
            deposit_type: "none",
            online_bookable: false,
        },
        201,
    );
    const fixture = {
        clientId: client.id,
        clientName: client.name,
        clientEmail: client.email,
        itemId: service.id,
        itemName: service.name,
        staffId: owner.id,
        staffName: owner.name,
        zone: "America/Vancouver",
    };
    await fillBookingComposer(page, fixture);
    await chooseFreeBookingTime(page, fixture);
    const creating = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === "/v1/bookings" &&
            response.request().method() === "POST",
    );
    await page.getByRole("button", { name: strings.bookings.composerBook, exact: true }).click();
    const created = await creating;
    expect(created.status(), await created.text()).toBe(201);
    expect(created.request().postDataJSON()).toMatchObject({
        client_id: client.id,
        subject_id: vehicle,
        item_id: service.id,
    });
    const booking = (await created.json()) as BookingRecord;
    const booked = await visitEvidence([client.id]);
    expect(booked.bookings).toEqual([
        expect.objectContaining({
            id: booking.id,
            subject_id: vehicle,
            item_id: service.id,
            staff_id: owner.id,
            status: "confirmed",
            source: "manual",
        }),
    ]);
    expect(booked.subjects).toEqual(added.subjects);
    await openBooking(page, fixture, booking.id, formatParts(["Family Outback", client.name]));
    await expect(
        page.getByText("Family Outback", { exact: false }).filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
        page
            .getByText("1285 West Pender Street, Vancouver", { exact: false })
            .filter({ visible: true })
            .first(),
    ).toBeVisible();
    await testInfo.attach("vehicle-visit", {
        body: JSON.stringify(booked),
        contentType: "application/json",
    });
});
