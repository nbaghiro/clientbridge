// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ApiLike } from "../api";
import { strings } from "../strings";
import { type BookingActions, type ScheduleEvent, useBookingActions } from "./bookings";

afterEach(cleanup);

const s = strings.bookings;
const NOW = new Date("2026-10-13T17:00:00Z");

const visit = (status: string): ScheduleEvent =>
    ({
        bookingId: "bk_1",
        status,
        start: new Date("2026-10-20T17:00:00Z"),
        depositRequired: true,
        depositStatus: "collected",
        depositAmountCents: 2750,
    }) as unknown as ScheduleEvent;

function api(patch: ApiLike["patch"]): ApiLike {
    return { get: vi.fn(), getText: vi.fn(), post: vi.fn(), patch, delete: vi.fn() };
}

it("waits for this device to hear of an approval before offering the visit's next actions", async () => {
    const patch = vi.fn().mockResolvedValue({});
    const { result, rerender } = renderHook<BookingActions, { event: ScheduleEvent | null }>(
        ({ event }) => useBookingActions(api(patch), event, NOW),
        { initialProps: { event: visit("pending") } },
    );
    expect(result.current.canApprove).toBe(true);
    act(() => {
        result.current.run("approve");
    });
    await waitFor(() => {
        expect(result.current.settling).toBe(s.settling);
    });
    expect(patch).toHaveBeenCalledWith("/v1/bookings/bk_1", { status: "confirmed" });
    expect(result.current.canApprove || result.current.canDecline).toBe(false);

    rerender({ event: visit("confirmed") });

    expect(result.current.settling).toBeNull();
    expect(result.current.canCancel).toBe(true);
});

it("says a declined request is done once it leaves this device's schedule", async () => {
    const patch = vi.fn().mockResolvedValue({});
    const { result, rerender } = renderHook<BookingActions, { event: ScheduleEvent | null }>(
        ({ event }) => useBookingActions(api(patch), event, NOW),
        { initialProps: { event: visit("pending") } },
    );
    expect(result.current.declineNote).toBe(s.declineRefund("$27.50"));
    act(() => {
        result.current.run("decline");
    });
    await waitFor(() => {
        expect(result.current.settling).toBe(s.settling);
    });
    expect(patch).toHaveBeenCalledWith("/v1/bookings/bk_1", { status: "canceled" });

    rerender({ event: null });

    expect(result.current.outcome).toBe(s.declinedDone);
});
