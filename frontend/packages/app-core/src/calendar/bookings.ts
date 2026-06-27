import type { ApiLike } from "../api";
import { dragToStart } from "./layout";
import type { CalendarEvent } from "./types";

export interface BookingResult {
    id: string;
    session_id: string;
    status: string;
    starts_at: string;
    ends_at: string;
}

export interface NewBooking {
    clientId: string;
    itemId: string;
    staffId: string;
    startsAt: Date;
    resourceId?: string | null;
}

export type BookingStatus = "confirmed" | "completed" | "canceled" | "no_show";

export function createBooking(api: ApiLike, input: NewBooking): Promise<BookingResult> {
    return api.post<BookingResult>("/v1/bookings", {
        client_id: input.clientId,
        item_id: input.itemId,
        staff_id: input.staffId,
        starts_at: input.startsAt.toISOString(),
        resource_id: input.resourceId ?? null,
    });
}

export function rescheduleBooking(
    api: ApiLike,
    bookingId: string,
    startsAt: Date,
): Promise<BookingResult> {
    return api.patch<BookingResult>(`/v1/bookings/${bookingId}`, {
        starts_at: startsAt.toISOString(),
    });
}

export function setBookingStatus(
    api: ApiLike,
    bookingId: string,
    status: BookingStatus,
): Promise<BookingResult> {
    return api.patch<BookingResult>(`/v1/bookings/${bookingId}`, { status });
}

// Drag-drop reschedule: snap the vertical delta to a new start and PATCH it (fire-and-forget; a
// rejected move just leaves the booking where it was once sync reconciles).
export function rescheduleByDrag(
    api: ApiLike,
    event: CalendarEvent,
    deltaPx: number,
    pxPerMin: number,
): void {
    if (event.bookingId === null) return;
    const newStart = dragToStart(event.start, deltaPx, pxPerMin);
    if (newStart.getTime() === event.start.getTime()) return;
    void rescheduleBooking(api, event.bookingId, newStart).catch(() => undefined);
}
