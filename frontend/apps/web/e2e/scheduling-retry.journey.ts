import { randomUUID } from "node:crypto";
import { formatParts, strings } from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";
import { cancelOwnedBooking } from "./support/bookings";
import { inboxMail } from "./support/messaging";
import {
    acceptedRaceEvidence,
    raceContact,
    raceDetails,
    raceEvidence,
    raceFixture,
    raceTimePicker,
} from "./support/scheduling";
import { navigate, signIn } from "./support/session";

test("SCH-E2E-04 lost committed booking response retries once without another acknowledgment", async ({
    page,
    browser,
}, testInfo) => {
    await signIn(page);
    const fixture = await raceFixture(page);
    const contact = raceContact("Juniper");
    const clientContext = await browser.newContext({
        extraHTTPHeaders: {
            "X-Forwarded-For": `2001:db8:${randomUUID().replaceAll("-", "").slice(0, 16).match(/.{4}/g)?.join(":")}::1`,
        },
    });
    try {
        expect(await raceEvidence(fixture, [contact])).toEqual({
            slots: [],
            bookings: [],
            clients: [],
            subjects: [],
            payments: [],
            deliveries: [],
        });
        expect(await inboxMail(page.request, contact.email)).toEqual([]);
        const client = await clientContext.newPage();
        const day = await raceTimePicker(client, fixture, 4);
        await client
            .getByRole("radiogroup", { name: strings.publicBooking.date, exact: true })
            .getByRole("radio")
            .nth(day)
            .click();
        await client
            .getByRole("radiogroup", { name: strings.publicBooking.openTimes, exact: true })
            .getByRole("radio")
            .first()
            .click();
        await raceDetails(client, contact);
        const attempts: {
            body: string | null;
            key: string | undefined;
            response: { booking_id: string; status: string };
        }[] = [];
        await client.route("**/book/birchbark", async (route) => {
            if (route.request().method() !== "POST") return route.continue();
            const response = await route.fetch();
            expect(response.status(), await response.text()).toBe(200);
            attempts.push({
                body: route.request().postData(),
                key: route.request().headers()["idempotency-key"],
                response: (await response.json()) as { booking_id: string; status: string },
            });
            if (attempts.length === 1) await route.abort("connectionreset");
            else await route.fulfill({ response });
        });
        const confirm = client.getByRole("button", {
            name: strings.publicBooking.confirm,
            exact: true,
        });
        await confirm.click();
        await expect(
            client.getByText(strings.publicBooking.connectionError, { exact: true }),
        ).toBeVisible();
        await expect(
            client.getByRole("heading", { name: strings.publicBooking.stepDetails, exact: true }),
        ).toBeVisible();
        const initial = await acceptedRaceEvidence(fixture, [contact], contact.email);
        expect(initial.bookings).toHaveLength(1);
        await expect
            .poll(async () => (await inboxMail(page.request, contact.email)).length)
            .toBe(1);
        const firstMail = await inboxMail(page.request, contact.email);
        await confirm.click();
        await expect(
            client.getByRole("heading", { name: strings.publicBooking.pendingTitle, exact: true }),
        ).toBeVisible();
        expect(attempts).toHaveLength(2);
        expect(attempts[0]?.key).toBeTruthy();
        expect(attempts[1]).toEqual(attempts[0]);
        expect(attempts[0]?.response).toMatchObject({
            status: "pending",
            deposit_cents: 0,
            deposit_client_secret: null,
        });
        const committed = await raceEvidence(fixture, [contact]);
        expect(committed).toEqual(initial);
        expect(committed.slots).toHaveLength(1);
        const slot = committed.slots[0];
        expect(slot).toMatchObject({
            item_id: fixture.itemId,
            staff_id: fixture.staffId,
            capacity: 1,
        });
        expect(committed.clients).toEqual([
            { id: expect.any(String), name: contact.name, email: contact.email },
        ]);
        expect(committed.subjects).toEqual([
            { id: expect.any(String), name: contact.pet, client_id: committed.clients[0]?.id },
        ]);
        expect(committed.bookings).toEqual([
            {
                id: attempts[0]?.response.booking_id,
                slot_id: slot?.id,
                client_id: committed.clients[0]?.id,
                subject_id: committed.subjects[0]?.id,
                status: "pending",
                source: "online",
                deposit_status: "none",
                deposit_amount_cents: 0,
            },
        ]);
        expect(committed.payments).toEqual([]);
        expect(committed.deliveries).toEqual([
            { id: expect.any(String), state: "accepted", recipient: contact.email },
        ]);
        const observer = await browser.newContext({ baseURL: new URL(page.url()).origin });
        try {
            const other = await observer.newPage();
            await signIn(other);
            for (const provider of [page, other]) {
                await navigate(provider, `/schedule?open=${attempts[0]?.response.booking_id}`);
                await expect(
                    provider.getByRole("heading", {
                        name: formatParts([contact.pet, contact.name]),
                        exact: true,
                    }),
                ).toBeVisible({ timeout: 60_000 });
                await provider.reload();
                await navigate(provider, `/schedule?open=${attempts[0]?.response.booking_id}`);
                await expect(
                    provider.getByRole("heading", {
                        name: formatParts([contact.pet, contact.name]),
                        exact: true,
                    }),
                ).toBeVisible();
            }
            const finalMail = await inboxMail(page.request, contact.email);
            await testInfo.attach("booking-retry-acknowledgment", {
                body: JSON.stringify({ attempts, committed, firstMail, finalMail }),
                contentType: "application/json",
            });
            expect(finalMail.map(({ ID, Subject }) => ({ ID, Subject }))).toEqual(
                firstMail.map(({ ID, Subject }) => ({ ID, Subject })),
            );
            expect(finalMail).toHaveLength(1);
            expect(finalMail[0]?.Subject).toBe("Booking request received — Birchbark Pet Studio");
            expect(await raceEvidence(fixture, [contact])).toEqual(committed);
        } finally {
            await observer.close();
        }
    } finally {
        try {
            const evidence = await raceEvidence(fixture, [contact]);
            for (const booking of evidence.bookings)
                if (booking.status !== "canceled") await cancelOwnedBooking(page, booking.id);
        } finally {
            await clientContext.close();
        }
    }
});
