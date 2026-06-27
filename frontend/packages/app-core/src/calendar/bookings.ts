import type { ApiLike } from "../api";

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
