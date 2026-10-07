import { describe, expect, it } from "vitest";

import { buildAgenda, greeting, visitAction } from "./today";

const row = (over: Record<string, unknown>) => ({
    slot_id: "ss_1",
    starts_at: "2026-10-06T16:00:00Z",
    ends_at: "2026-10-06T17:00:00Z",
    staff_id: "st_owner",
    capacity: 1,
    item_name: "Full Groom",
    item_kind: "service",
    item_color: "#3F5E80",
    item_price_cents: 8000,
    booking_id: "bk_1",
    booking_status: "confirmed",
    price_cents: 7500,
    client_id: "cl_ann",
    client_name: "Ann Lee",
    client_phone: null,
    deposit_amount_cents: 2000,
    deposit_status: "collected",
    checked_in_at: null,
    staff_name: "Hannah Wong",
    staff_title: null,
    staff_role: "owner",
    staff_color: null,
    ...over,
});

describe("buildAgenda", () => {
    const now = new Date("2026-10-06T16:30:00Z");

    it("marks what is done, in progress and next, in time order", () => {
        const agenda = buildAgenda(
            [
                row({
                    slot_id: "ss_3",
                    booking_id: "bk_3",
                    starts_at: "2026-10-06T20:00:00Z",
                    ends_at: "2026-10-06T21:00:00Z",
                }),
                row({
                    slot_id: "ss_0",
                    booking_id: "bk_0",
                    starts_at: "2026-10-06T14:00:00Z",
                    ends_at: "2026-10-06T15:00:00Z",
                }),
                row({}),
                row({
                    slot_id: "ss_2",
                    booking_id: "bk_2",
                    starts_at: "2026-10-06T18:00:00Z",
                    ends_at: "2026-10-06T19:00:00Z",
                    checked_in_at: "2026-10-06T16:20:00Z",
                }),
            ],
            now,
        );
        expect(agenda.map((a) => [a.id, a.state])).toEqual([
            ["bk_0", "done"],
            ["bk_1", "now"],
            ["bk_2", "next"],
            ["bk_3", "later"],
        ]);
        expect(agenda[2]?.checkedIn).toBe(true);
        expect(agenda[2]?.minutesAway).toBe(90);
        expect(agenda[1]?.depositPaidCents).toBe(2000);
        expect(agenda[1]?.priceCents).toBe(7500);
    });

    it("folds a class into one row priced by its seats", () => {
        const seat = { slot_id: "ss_c", capacity: 6, item_kind: "class", item_name: "Puppy class" };
        const agenda = buildAgenda(
            [
                row({ ...seat, booking_id: "bk_a", price_cents: 3000 }),
                row({ ...seat, booking_id: "bk_b", price_cents: 3000 }),
            ],
            now,
        );
        expect(agenda).toHaveLength(1);
        expect(agenda[0]).toMatchObject({
            id: "ss_c",
            isClass: true,
            clientName: "Puppy class",
            serviceName: "2 of 6 booked",
            priceCents: 6000,
            bookingId: null,
        });
        const only = agenda[0];
        expect(only === undefined ? undefined : visitAction(only)).toBeNull();
    });

    it("keeps a no-show out of the queue and offers checkout once checked in", () => {
        const [noShow, later] = buildAgenda(
            [
                row({ booking_status: "no_show", starts_at: "2026-10-06T16:10:00Z" }),
                row({
                    slot_id: "ss_9",
                    booking_id: "bk_9",
                    starts_at: "2026-10-06T19:00:00Z",
                    ends_at: "2026-10-06T20:00:00Z",
                    checked_in_at: "2026-10-06T16:00:00Z",
                }),
            ],
            now,
        );
        expect(noShow?.state).toBe("no_show");
        expect(noShow === undefined ? undefined : visitAction(noShow)).toBeNull();
        expect(later === undefined ? undefined : visitAction(later)).toBe("checkout");
    });
});

describe("greeting", () => {
    it("greets by the time of day and first name", () => {
        expect(greeting(9, "Hannah Wong")).toBe("Good morning, Hannah");
        expect(greeting(13, "Diego")).toBe("Good afternoon, Diego");
        expect(greeting(19, "")).toBe("Good evening");
    });
});
