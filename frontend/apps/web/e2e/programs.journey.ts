import { randomUUID } from "node:crypto";
import {
    addDays,
    combineDayAndTime,
    dateKey,
    formatMoney,
    strings,
} from "@clientbridge/app-core/public";
import { expect, test } from "@playwright/test";

import { openInvoice } from "./support/billing";
import { bookingApi } from "./support/bookings";
import { signIn } from "./support/session";
import {
    apiCall,
    at,
    connectUrl,
    fillConnectDetails,
    onlineBooker,
    teamMember,
    visitEvidence,
} from "./support/visits";

const b = strings.publicBooking;
const ZONE = "America/Vancouver";
const CEDAR = { email: "owner@cedarcoast.example", password: "demo1234" };

interface ScheduledProgram {
    id: string;
    sessions: { slot_id: string; starts_at: string }[];
}

interface Program {
    starts_at: string;
    staff_id: string;
    days: { starts_at: string; ends_at: string }[];
    seats_left: number;
}

test("CLS-E2E-02 a client enrols in a three-day camp on Connect and every day, with one invoice for the whole camp", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(240_000);
    await signIn(page, CEDAR);
    const owner = await teamMember(page, "owner@cedarcoast.example");
    const run = randomUUID().slice(0, 6).toUpperCase();
    const camp = await apiCall<{ id: string; name: string }>(
        page,
        "POST",
        "/v1/items",
        {
            kind: "class",
            name: `Puppy confidence camp ${run}`,
            duration_min: 60,
            price_cents: 12000,
            capacity: 2,
            session_count: 3,
            deposit_type: "none",
            online_bookable: true,
        },
        201,
    );
    // Monday to Wednesday at four, in the first week Rowan's afternoons are free
    const schedule = async (): Promise<ScheduledProgram> => {
        for (let week = 3; week < 9; week++) {
            const ahead = addDays(new Date(), week * 7, ZONE);
            const weekday = new Date(`${dateKey(ahead, ZONE)}T12:00:00Z`).getUTCDay();
            const monday = dateKey(addDays(ahead, -((weekday + 6) % 7), ZONE), ZONE);
            const response = await page.request.post(`${bookingApi()}/v1/programs`, {
                headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
                data: {
                    item_id: camp.id,
                    staff_id: owner.id,
                    starts_at: combineDayAndTime(monday, "16:00", ZONE).toISOString(),
                    byday: ["MO", "TU", "WE"],
                    count: 3,
                },
            });
            if (response.status() === 409) continue;
            expect(response.status(), await response.text()).toBe(201);
            return (await response.json()) as ScheduledProgram;
        }
        throw new Error("No free week for the camp");
    };
    const program = await schedule();
    const sessions = program.sessions.map((session) => at(session.starts_at));
    expect(sessions).toHaveLength(3);
    const context = await browser.newContext({
        extraHTTPHeaders: {
            "X-Forwarded-For": `2001:db8:${randomUUID().replaceAll("-", "").slice(0, 16).match(/.{4}/g)?.join(":")}::1`,
        },
    });
    const runs = async (): Promise<Program[]> => {
        const response = await context.request.get(`${bookingApi()}/book/cedarcoast/programs`, {
            params: { item_id: camp.id, staff_id: "any" },
        });
        expect(response.status(), await response.text()).toBe(200);
        return ((await response.json()) as { programs: Program[] }).programs;
    };
    try {
        const before = await runs();
        expect(before.map((p) => ({ ...p, starts_at: at(p.starts_at) }))).toEqual([
            {
                starts_at: sessions[0],
                staff_id: owner.id,
                days: expect.any(Array),
                seats_left: 2,
            },
        ]);
        expect(before[0]?.days.map((day) => at(day.starts_at))).toEqual(sessions);

        const client = await context.newPage();
        const listed = client.waitForResponse(
            (response) => response.url().includes("/book/cedarcoast/programs?") && response.ok(),
        );
        await client.goto(connectUrl("cedarcoast"));
        await client
            .getByRole("button")
            .filter({ has: client.getByText(camp.name, { exact: true }) })
            .click();
        await listed;
        await expect(client.getByText(b.programNote, { exact: true })).toBeVisible();
        const cards = client.getByRole("group", { name: b.programPick, exact: true });
        await expect(cards.getByRole("button")).toHaveCount(1);
        await cards.getByRole("button").first().click();
        const booker = onlineBooker("Maple");
        await fillConnectDetails(client, booker, "pet");
        const posted = client.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === "/book/cedarcoast" &&
                response.request().method() === "POST",
        );
        await client.getByRole("button", { name: b.confirm, exact: true }).click();
        const online = await posted;
        expect(online.status(), await online.text()).toBe(200);
        expect(online.request().postDataJSON()).toMatchObject({ item_id: camp.id });
        expect(at((online.request().postDataJSON() as { starts_at: string }).starts_at)).toBe(
            sessions[0],
        );
        const enrolled = (await online.json()) as {
            booking_id: string;
            booking_ids: string[];
            status: string;
            deposit_cents: number;
            deposit_client_secret: string | null;
        };
        expect(enrolled).toMatchObject({
            status: "confirmed",
            deposit_cents: 0,
            deposit_client_secret: null,
        });
        expect(enrolled.booking_ids).toHaveLength(3);
        await expect(client.getByRole("heading", { name: b.doneTitle, exact: true })).toBeVisible();

        const evidence = await visitEvidence([booker.email]);
        const slotIds = program.sessions.map((session) => session.slot_id);
        expect(evidence.bookings.map((booking) => booking.slot_id)).toEqual(slotIds);
        expect(new Set(evidence.bookings.map((booking) => booking.recurrence_id))).toEqual(
            new Set([program.id]),
        );
        expect(evidence.bookings.map((booking) => at(booking.starts_at))).toEqual(sessions);
        const invoiceId = evidence.bookings[0]?.invoice_id ?? null;
        expect(invoiceId).not.toBeNull();
        expect(
            evidence.bookings.map(
                ({
                    status,
                    source,
                    price_cents,
                    deposit_amount_cents,
                    deposit_status,
                    invoice_id,
                }) => ({
                    status,
                    source,
                    price_cents,
                    deposit_amount_cents,
                    deposit_status,
                    invoice_id,
                }),
            ),
        ).toEqual([
            {
                status: "confirmed",
                source: "online",
                price_cents: 12000,
                deposit_amount_cents: 0,
                deposit_status: "none",
                invoice_id: invoiceId,
            },
            ...[1, 2].map(() => ({
                status: "confirmed",
                source: "online",
                price_cents: 0,
                deposit_amount_cents: 0,
                deposit_status: "none",
                invoice_id: null,
            })),
        ]);
        expect(new Set(evidence.bookings.map((booking) => booking.subject_id)).size).toBe(1);
        expect(evidence.subjects.map((subject) => subject.name)).toEqual(["Maple"]);
        // one price for the camp, with 5% GST and 7% PST, due on its first day
        expect(evidence.invoices).toEqual([
            {
                id: invoiceId,
                client_id: evidence.clients[0]?.id,
                status: "sent",
                number: expect.any(Number),
                subtotal_cents: 12000,
                tax_total_cents: 1440,
                total_cents: 13440,
                due_at: expect.any(String),
            },
        ]);
        expect(at(evidence.invoices[0]?.due_at ?? "")).toBe(sessions[0]);
        expect(evidence.lines).toEqual([
            expect.objectContaining({
                invoice_id: invoiceId,
                description: `${camp.name} · 3 days`,
                quantity: 1,
                unit_amount_cents: 12000,
                amount_cents: 12000,
                item_id: camp.id,
                booking_id: evidence.bookings[0]?.id,
            }),
        ]);
        expect(evidence.payments).toEqual([]);
        const receivable = evidence.entries.filter((entry) => entry.category === "receivable");
        expect(receivable.reduce((sum, entry) => sum + entry.amount_cents, 0)).toBe(13440);
        expect(evidence.entries.reduce((sum, entry) => sum + entry.amount_cents, 0)).toBe(0);
        expect(evidence.entries.filter((entry) => entry.category === "cash")).toEqual([]);

        const after = await runs();
        expect(after.map((p) => p.seats_left)).toEqual([1]);
        const again = await context.request.post(`${bookingApi()}/book/cedarcoast`, {
            headers: { "Idempotency-Key": randomUUID() },
            data: {
                item_id: camp.id,
                staff_id: "any",
                starts_at: program.sessions[0]?.starts_at,
                client: { name: booker.name, email: booker.email },
                subject_name: booker.subject,
            },
        });
        expect(again.status(), await again.text()).toBe(409);
        expect(((await again.json()) as { error: string }).error).toBe("already_enrolled");
        const midway = onlineBooker("Hazel");
        const second = await context.request.post(`${bookingApi()}/book/cedarcoast`, {
            headers: { "Idempotency-Key": randomUUID() },
            data: {
                item_id: camp.id,
                staff_id: "any",
                starts_at: program.sessions[1]?.starts_at,
                client: { name: midway.name, email: midway.email },
                subject_name: midway.subject,
            },
        });
        expect(second.status(), await second.text()).toBe(409);
        expect(((await second.json()) as { error: string }).error).toBe("slot_unavailable");
        expect(await visitEvidence([midway.email])).toMatchObject({ clients: [], bookings: [] });
        expect(await visitEvidence([booker.email])).toEqual(evidence);

        const clientRow = evidence.clients[0];
        if (clientRow === undefined || invoiceId === null) throw new Error("Enrolment is missing");
        await openInvoice(page, { id: invoiceId, name: clientRow.name, email: clientRow.email });
        const drawer = page.getByRole("dialog");
        await expect(
            drawer.getByText(strings.billing.statusLabel.sent, { exact: true }).first(),
        ).toBeVisible();
        await expect(
            drawer.getByText(formatMoney(13440, "CAD"), { exact: true }).first(),
        ).toBeVisible();
        await expect(
            drawer
                .getByText(`${camp.name} · 3 days`, { exact: true })
                .filter({ visible: true })
                .first(),
        ).toBeVisible();
        await testInfo.attach("camp-enrolment", {
            body: JSON.stringify(evidence),
            contentType: "application/json",
        });
    } finally {
        await context.close();
    }
});
