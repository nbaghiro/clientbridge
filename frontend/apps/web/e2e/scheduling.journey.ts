import { randomUUID } from "node:crypto";
import { formatParts, strings } from "@clientbridge/app-core/public";
import { expect, test, type Response, type Route } from "@playwright/test";
import { cancelOwnedBooking } from "./support/bookings";
import {
    acceptedRaceEvidence,
    raceContact,
    raceDetails,
    raceEvidence,
    raceFixture,
    raceTimePicker,
} from "./support/scheduling";
import { inboxMail } from "./support/messaging";
import { navigate, signIn } from "./support/session";

test("SCH-E2E-03 two real clients race for one time without loser side effects", async ({
    page,
    browser,
}, testInfo) => {
    await signIn(page);
    const fixture = await raceFixture(page);
    const contacts = [raceContact("Maple"), raceContact("Clover")];
    const contexts = await Promise.all(
        contacts.map(() =>
            browser.newContext({
                extraHTTPHeaders: {
                    "X-Forwarded-For": `2001:db8:${randomUUID().replaceAll("-", "").slice(0, 16).match(/.{4}/g)?.join(":")}::1`,
                },
            }),
        ),
    );
    let release: (proceed: boolean) => void = () => undefined;
    const barrier = new Promise<boolean>((resolve) => {
        release = resolve;
    });
    const attempts: {
        index: number;
        body: { item_id: string; staff_id: string; starts_at: string; client: { email: string } };
        key: string | undefined;
    }[] = [];
    const pendingResponses: Promise<Response>[] = [];
    const refreshedSlots: Response[][] = contacts.map(() => []);
    try {
        expect(await raceEvidence(fixture, contacts)).toEqual({
            slots: [],
            bookings: [],
            clients: [],
            subjects: [],
            payments: [],
            deliveries: [],
        });
        for (const contact of contacts)
            expect(await inboxMail(page.request, contact.email)).toEqual([]);
        const clients = await Promise.all(contexts.map((context) => context.newPage()));
        const dayIndexes = await Promise.all(
            clients.map((client) => raceTimePicker(client, fixture)),
        );
        expect(new Set(dayIndexes).size).toBe(1);
        await Promise.all(
            clients.map(async (client, index) => {
                await client
                    .getByRole("radiogroup", { name: strings.publicBooking.date, exact: true })
                    .getByRole("radio")
                    .nth(dayIndexes[index] ?? -1)
                    .click();
                await client
                    .getByRole("radiogroup", { name: strings.publicBooking.openTimes, exact: true })
                    .getByRole("radio")
                    .first()
                    .click();
                const contact = contacts[index];
                if (!contact) throw new Error("Race contact is missing");
                await raceDetails(client, contact);
                await client.route("**/book/birchbark", async (route: Route) => {
                    if (route.request().method() !== "POST") return route.continue();
                    attempts.push({
                        index,
                        body: route.request().postDataJSON() as (typeof attempts)[number]["body"],
                        key: route.request().headers()["idempotency-key"],
                    });
                    if (await barrier) await route.continue();
                    else await route.abort("aborted");
                });
            }),
        );
        clients.forEach((client, index) => {
            client.on("response", (response) => {
                if (response.url().includes("/book/birchbark/slots?") && response.ok())
                    refreshedSlots[index]?.push(response);
            });
        });
        const responses = clients.map((client) =>
            client.waitForResponse(
                (response) =>
                    new URL(response.url()).pathname === "/book/birchbark" &&
                    response.request().method() === "POST",
            ),
        );
        pendingResponses.push(...responses);
        await Promise.all(
            clients.map((client) =>
                client
                    .getByRole("button", { name: strings.publicBooking.confirm, exact: true })
                    .click(),
            ),
        );
        await expect.poll(() => attempts.length).toBe(2);
        expect(new Set(attempts.map((attempt) => attempt.body.starts_at)).size).toBe(1);
        expect(new Set(attempts.map((attempt) => attempt.key)).size).toBe(2);
        for (const attempt of attempts) {
            expect(attempt.key).toBeTruthy();
            expect(attempt.body).toMatchObject({
                item_id: fixture.itemId,
                staff_id: fixture.staffId,
                client: { email: contacts[attempt.index]?.email },
            });
        }
        release(true);
        const completed = await Promise.all(responses);
        expect(completed.map((response) => response.status()).sort()).toEqual([200, 409]);
        const winnerIndex = completed.findIndex((response) => response.status() === 200);
        const loserIndex = 1 - winnerIndex;
        const winner = contacts[winnerIndex];
        const winnerPage = clients[winnerIndex];
        const loser = clients[loserIndex];
        const winnerResponse = completed[winnerIndex];
        const loserResponse = completed[loserIndex];
        if (!winner || !winnerPage || !loser || !winnerResponse || !loserResponse)
            throw new Error("Race results are incomplete");
        const won = (await winnerResponse.json()) as { booking_id: string; status: string };
        expect(won).toMatchObject({
            status: "pending",
            deposit_cents: 0,
            deposit_client_secret: null,
        });
        expect(["conflict", "slot_unavailable"]).toContain(
            ((await loserResponse.json()) as { error: string }).error,
        );
        await expect(
            winnerPage.getByRole("heading", {
                name: strings.publicBooking.pendingTitle,
                exact: true,
            }),
        ).toBeVisible();
        await expect(
            loser.getByText(strings.publicBooking.slotTaken, { exact: true }),
        ).toBeVisible();
        await expect(
            loser.getByRole("heading", { name: strings.publicBooking.stepTime, exact: true }),
        ).toBeVisible();
        await expect(
            loser
                .getByRole("radiogroup", { name: strings.publicBooking.openTimes })
                .getByRole("radio", { checked: true }),
        ).toHaveCount(0);
        await expect.poll(() => refreshedSlots[loserIndex]?.length ?? 0).toBeGreaterThan(0);
        const refreshed = refreshedSlots[loserIndex]?.at(-1);
        if (!refreshed) throw new Error("Loser did not refresh real availability");
        const refreshedBody = (await refreshed.json()) as { slots: { starts_at: string }[] };
        expect(
            refreshedBody.slots.some(
                (slot) =>
                    new Date(slot.starts_at).getTime() ===
                    new Date(attempts[0]?.body.starts_at ?? "").getTime(),
            ),
        ).toBe(false);
        const committed = await acceptedRaceEvidence(fixture, contacts, winner.email);
        expect(committed.slots).toHaveLength(1);
        const slot = committed.slots[0];
        expect(slot).toMatchObject({
            item_id: fixture.itemId,
            staff_id: fixture.staffId,
            capacity: 1,
        });
        expect(new Date(slot?.starts_at ?? "").getTime()).toBe(
            new Date(attempts[0]?.body.starts_at ?? "").getTime(),
        );
        expect(committed.clients).toEqual([
            { id: expect.any(String), name: winner.name, email: winner.email },
        ]);
        expect(committed.subjects).toEqual([
            { id: expect.any(String), client_id: committed.clients[0]?.id, name: winner.pet },
        ]);
        expect(committed.bookings).toEqual([
            {
                id: won.booking_id,
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
            { id: expect.any(String), state: "accepted", recipient: winner.email },
        ]);
        const acknowledgment = "Booking request received — Birchbark Pet Studio";
        // the intake form cron may also mail the new client while this runs
        const acknowledgments = async () =>
            (await inboxMail(page.request, winner.email)).filter(
                ({ Subject }) => Subject === acknowledgment,
            );
        await expect.poll(async () => (await acknowledgments()).length).toBe(1);
        const winnerMail = await acknowledgments();
        const message = await page.request.get(
            `${process.env.MAILPIT_URL ?? "http://localhost:8715"}/api/v1/message/${winnerMail[0]?.ID}`,
        );
        expect(message.status()).toBe(200);
        expect(
            ((await message.json()) as { To: { Address: string }[] }).To.map((to) => to.Address),
        ).toEqual([winner.email]);
        const losingContact = contacts[loserIndex];
        if (!losingContact) throw new Error("Losing contact is missing");
        expect(await inboxMail(page.request, losingContact.email)).toEqual([]);
        const observer = await browser.newContext({ baseURL: new URL(page.url()).origin });
        try {
            const other = await observer.newPage();
            await signIn(other);
            for (const provider of [page, other]) {
                for (let pass = 0; pass < 2; pass++) {
                    if (pass === 1) await provider.reload();
                    await navigate(provider, `/schedule?open=${won.booking_id}`);
                    await expect(
                        provider.getByRole("heading", {
                            name: formatParts([winner.pet, winner.name]),
                            exact: true,
                        }),
                    ).toBeVisible({ timeout: 60_000 });
                    await expect(
                        provider.getByText(fixture.itemName, { exact: true }).first(),
                    ).toBeVisible();
                }
            }
            expect(await raceEvidence(fixture, contacts)).toEqual(committed);
            expect((await acknowledgments()).map(({ ID, Subject }) => ({ ID, Subject }))).toEqual(
                winnerMail.map(({ ID, Subject }) => ({ ID, Subject })),
            );
            expect(await inboxMail(page.request, losingContact.email)).toEqual([]);
            await testInfo.attach("real-last-slot-race", {
                body: JSON.stringify({
                    attempts,
                    statuses: completed.map((response) => response.status()),
                    committed,
                }),
                contentType: "application/json",
            });
        } finally {
            await observer.close();
        }
    } finally {
        release(false);
        await Promise.allSettled(pendingResponses);
        try {
            const owned = await raceEvidence(fixture, contacts);
            for (const booking of owned.bookings)
                if (booking.status !== "canceled") await cancelOwnedBooking(page, booking.id);
        } finally {
            await Promise.all(contexts.map((context) => context.close()));
        }
    }
});
