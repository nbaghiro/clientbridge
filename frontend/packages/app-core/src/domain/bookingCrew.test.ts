// @vitest-environment happy-dom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { type CalendarEvent, useBookingCrew } from "./bookings";

vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: () => ({
        data: [
            { id: "st_lead", name: "Lead Lou", status: "active" },
            { id: "st_help", name: "Helper Hal", status: "active" },
            { id: "st_free", name: "Free Fay", status: "active" },
        ],
    }),
}));

const EVENT = {
    id: "ses_1",
    slotId: "ses_1",
    bookingId: "bk_1",
    status: "confirmed",
    staffId: "st_lead",
    capacity: 1,
    itemStaffIds: [],
} as unknown as CalendarEvent;

function crewApi(): ApiLike {
    const read = {
        booking_id: "bk_1",
        status: "confirmed",
        lead_id: "st_lead",
        lead_name: "Lead Lou",
        service: "Install",
        client_name: "Ann",
        address: null,
        starts_at: "2099-01-01T17:00:00Z",
        ends_at: "2099-01-01T19:00:00Z",
        members: [{ staff_id: "st_help", name: "Helper Hal" }],
        can_edit: true,
    };
    return {
        get: <T>() => Promise.resolve(read as T),
        getText: () => Promise.resolve(""),
        post: <T>() => Promise.resolve({} as T),
        patch: <T>() => Promise.resolve({} as T),
        delete: <T>() => Promise.resolve({} as T),
    };
}

describe("useBookingCrew", () => {
    it("shows the crew to its lead without the controls a manager has", async () => {
        const lead = renderHook(() =>
            useBookingCrew(crewApi(), EVENT, { staffId: "st_lead", role: "staff" }),
        );
        await waitFor(() => {
            expect(lead.result.current.shown).toBe(true);
        });
        expect(lead.result.current.members.map((m) => m.id)).toEqual(["st_help"]);
        expect(lead.result.current.canEdit).toBe(false);
        const owner = renderHook(() =>
            useBookingCrew(crewApi(), EVENT, { staffId: "st_owner", role: "owner" }),
        );
        await waitFor(() => {
            expect(owner.result.current.canEdit).toBe(true);
        });
    });
});
