import { randomUUID } from "node:crypto";
import { addDays, dateKey, strings } from "@clientbridge/app-core/public";
import { expect, test, type Page } from "@playwright/test";

import {
    bookingApi,
    cancelOwnedBooking,
    createBookingFixture,
    fillBookingComposer,
    type BookingFixture,
} from "./support/bookings";
import { joinHoursStaff } from "./support/offline";
import { signIn } from "./support/session";
import {
    choiceKeys,
    connectStaff,
    fillConnectDetails,
    onlineBooker,
    openConnectDay,
    openConnectService,
    teamMember,
    visitEvidence,
} from "./support/visits";

const b = strings.publicBooking;

async function composerStaff(page: Page, fixture: BookingFixture): Promise<string[]> {
    await fillBookingComposer(page, fixture);
    const keys = await choiceKeys(
        page
            .getByRole("form", { name: strings.bookings.composerTitle })
            .getByRole("group", { name: strings.bookings.composerWith, exact: true }),
    );
    await page.getByRole("button", { name: strings.bookings.composerCancel, exact: true }).click();
    return keys;
}

async function connectChoices(page: Page, itemName: string): Promise<string[]> {
    await openConnectService(page, "birchbark", itemName);
    return choiceKeys(page.getByRole("group", { name: b.with, exact: true }));
}

test("SCH-E2E-06 only the staff chosen for a service are offered on Connect and in the calendar, and a removed member stops being offered", async ({
    page,
    browser,
    request,
    baseURL,
}, testInfo) => {
    test.setTimeout(300_000);
    const joining = await browser.newContext({ baseURL: baseURL ?? "" });
    const member = await joinHoursStaff(await joining.newPage(), request);
    let removed = false;
    const anonymous = await browser.newContext({
        extraHTTPHeaders: {
            "X-Forwarded-For": `2001:db8:${randomUUID().replaceAll("-", "").slice(0, 16).match(/.{4}/g)?.join(":")}::1`,
        },
    });
    const owned: string[] = [];
    try {
        await signIn(page);
        const fixture = await createBookingFixture(page, { online_bookable: true });
        const diego = await teamMember(page, "diego@birchbark.example");
        const everyone = (await connectStaff(page, "birchbark", fixture.itemId)) ?? [];
        expect(everyone).toEqual(expect.arrayContaining([fixture.staffId, diego.id, member.id]));

        await page.goto("/setup/services");
        await page.locator(`button[data-row-key="${fixture.itemId}"]`).click({ timeout: 60_000 });
        const editor = page.getByRole("dialog");
        const offeredBy = editor.getByRole("group", {
            name: strings.catalog.offeredBy,
            exact: true,
        });
        await expect(offeredBy.locator('button[data-value="all"]')).toHaveAttribute(
            "aria-pressed",
            "true",
            { timeout: 60_000 },
        );
        await offeredBy.locator(`button[data-value="${diego.id}"]`).click();
        await offeredBy.locator(`button[data-value="${member.id}"]`).click();
        await expect(offeredBy.locator('button[data-value="all"]')).toHaveAttribute(
            "aria-pressed",
            "false",
        );
        const saved = page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === `/v1/items/${fixture.itemId}` &&
                response.request().method() === "PATCH",
        );
        await editor.getByRole("button", { name: strings.catalog.save, exact: true }).click();
        const savedResponse = await saved;
        expect(savedResponse.status(), await savedResponse.text()).toBe(200);
        expect(((await savedResponse.json()) as { staff_ids: string[] }).staff_ids).toEqual(
            [diego.id, member.id].sort(),
        );

        const asDiego = { ...fixture, staffId: diego.id, staffName: diego.name };
        await expect
            .poll(() => composerStaff(page, asDiego), { timeout: 60_000 })
            .toEqual([diego.id, member.id].sort());
        expect(await connectStaff(page, "birchbark", fixture.itemId)).toEqual(
            [diego.id, member.id].sort(),
        );
        expect(await connectChoices(await anonymous.newPage(), fixture.itemName)).toEqual(
            ["any", diego.id, member.id].sort(),
        );

        const date = dateKey(addDays(new Date(), 14, fixture.zone), fixture.zone);
        const unoffered = await anonymous.request.get(`${bookingApi()}/book/birchbark/slots`, {
            params: { item_id: fixture.itemId, staff_id: fixture.staffId, date },
        });
        expect(unoffered.status(), await unoffered.text()).toBe(422);
        expect(((await unoffered.json()) as { error: string }).error).toBe("service_not_offered");
        const outsider = onlineBooker("Clover");
        const refused = await anonymous.request.post(`${bookingApi()}/book/birchbark`, {
            headers: { "Idempotency-Key": randomUUID() },
            data: {
                item_id: fixture.itemId,
                staff_id: fixture.staffId,
                starts_at: new Date(`${date}T18:00:00Z`).toISOString(),
                client: { name: outsider.name, email: outsider.email },
                subject_name: outsider.subject,
            },
        });
        expect(refused.status(), await refused.text()).toBe(422);
        expect(((await refused.json()) as { error: string }).error).toBe("service_not_offered");
        expect(await visitEvidence([outsider.email])).toMatchObject({ clients: [], bookings: [] });

        const removal = await page.request.post(`${bookingApi()}/v1/staff/${member.id}/remove`, {
            headers: { Origin: new URL(page.url()).origin },
            data: {},
        });
        expect(removal.status(), await removal.text()).toBe(200);
        removed = true;
        expect(await connectStaff(page, "birchbark", fixture.itemId)).toEqual([diego.id]);
        expect(await connectChoices(await anonymous.newPage(), fixture.itemName)).toEqual(
            ["any", diego.id].sort(),
        );
        await page.reload();
        await expect
            .poll(() => composerStaff(page, asDiego), { timeout: 60_000 })
            .toEqual([diego.id]);

        const client = await anonymous.newPage();
        const days = await openConnectService(client, "birchbark", fixture.itemName);
        await client
            .getByRole("group", { name: b.with, exact: true })
            .getByRole("button", { name: b.anyone, exact: true })
            .click();
        await expect.poll(() => days.days.length).toBeGreaterThan(0);
        const firstWeek = (
            (await days.days.at(-1)?.json()) as { days: { date: string; count: number }[] }
        ).days;
        const open = firstWeek.find((day) => day.count > 0);
        if (open === undefined) throw new Error("No open day for Diego this week");
        const slots = await openConnectDay(client, days, open.date);
        expect(new Set(slots.map((slot) => slot.staff_id))).toEqual(new Set([diego.id]));
        await client
            .getByRole("radiogroup", { name: b.openTimes, exact: true })
            .getByRole("radio")
            .first()
            .click();
        const booker = onlineBooker("Pepper");
        await fillConnectDetails(client, booker, "pet");
        const posted = client.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === "/book/birchbark" &&
                response.request().method() === "POST",
        );
        await client.getByRole("button", { name: b.confirm, exact: true }).click();
        const online = await posted;
        expect(online.status(), await online.text()).toBe(200);
        const onlineId = ((await online.json()) as { booking_id: string }).booking_id;
        owned.push(onlineId);
        await expect(
            client.getByRole("heading", { name: b.pendingTitle, exact: true }),
        ).toBeVisible();
        const booked = await visitEvidence([booker.email]);
        expect(booked.bookings).toEqual([
            expect.objectContaining({
                id: onlineId,
                staff_id: diego.id,
                item_id: fixture.itemId,
                status: "pending",
                source: "online",
            }),
        ]);
        await testInfo.attach("offered-staff", {
            body: JSON.stringify({ diego: diego.id, removed: member.id, booked }),
            contentType: "application/json",
        });
    } finally {
        for (const id of owned) await cancelOwnedBooking(page, id);
        if (!removed) await member.cleanup();
        await anonymous.close();
        await joining.close();
    }
});
