// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { usePublicBookingFlow } from "./publicBooking";
import { useReturningClient } from "./publicReturning";

afterEach(cleanup);

const STARTS = "2026-10-15T17:00:00.000Z";

it("books a returning client with subjects at a client-only business without a subject", async () => {
    const booking: Parameters<typeof usePublicBookingFlow>[0] = {
        getServices: vi.fn().mockResolvedValue({
            business_name: "Demo",
            brand: { logo_url: null, primary: null, tagline: null },
            services: [
                {
                    id: "service",
                    name: "Visit",
                    description: null,
                    duration_min: 60,
                    price_cents: 1000,
                    currency: "CAD",
                    deposit_required: false,
                    deposit_amount_cents: 0,
                    image_url: null,
                    kind: "service",
                    category: null,
                    color: null,
                    staff_ids: [],
                },
            ],
            staff: [],
            addons: [],
            stripe_account_id: null,
            slug: "demo",
            now: "2026-10-13T17:00:00Z",
            timezone: "America/Vancouver",
            policy: null,
            rating: null,
            review_count: 0,
            subject: null,
        }),
        getDays: vi.fn().mockResolvedValue([]),
        getSlots: vi
            .fn()
            .mockResolvedValue([
                { starts_at: STARTS, ends_at: "2026-10-15T18:00:00.000Z", staff_id: null },
            ]),
        book: vi.fn().mockResolvedValue({
            booking_id: "booking",
            status: "confirmed",
            manage_token: null,
            deposit_cents: 0,
            deposit_client_secret: null,
            stripe_account_id: null,
        }),
    };
    const returning: Parameters<typeof useReturningClient>[0] = {
        request: vi.fn().mockResolvedValue({ challenge_id: "challenge" }),
        verify: vi.fn().mockResolvedValue({
            token: "token",
            profile: {
                name: "Pat",
                email: "pat@example.com",
                phone: null,
                subjects: [{ id: "sub_old", name: "Rex" }],
                last_visit: {
                    item_id: "service",
                    staff_id: "staff",
                    subject_id: "sub_old",
                    starts_at: "2026-09-01T17:00:00Z",
                },
            },
        }),
    };
    const { result } = renderHook(() => {
        const flow = usePublicBookingFlow(booking, "demo", {
            itemId: "service",
            startsAt: STARTS,
        });
        return { flow, returning: useReturningClient(returning, "demo", flow) };
    });
    await waitFor(() => {
        expect(result.current.flow.step).toBe("details");
    });
    act(() => {
        result.current.returning.setContact("pat@example.com");
    });
    act(() => {
        result.current.returning.requestCode();
    });
    await waitFor(() => {
        expect(result.current.returning.stage).toBe("code");
    });
    act(() => {
        result.current.returning.setCode("123456");
    });
    act(() => {
        result.current.returning.verifyCode();
    });
    await waitFor(() => {
        expect(result.current.flow.returningToken).toBe("token");
    });
    expect(result.current.flow.subjectId).toBeNull();
    act(() => {
        result.current.returning.chooseSubject("sub_old");
    });
    expect(result.current.flow.subjectId).toBeNull();
    act(() => {
        result.current.flow.next();
    });
    await waitFor(() => {
        expect(booking.book).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(booking.book).mock.calls[0]?.[1]).toMatchObject({
        returningToken: "token",
        subjectId: null,
        subjectName: "",
    });
});
