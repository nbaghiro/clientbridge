// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { strings } from "../strings";
import { usePublicBookingFlow } from "./publicBooking";
import { createReturningClient, useReturningClient } from "./publicReturning";

afterEach(cleanup);

const STARTS = "2026-10-15T17:00:00.000Z";

type BookingClient = Parameters<typeof usePublicBookingFlow>[0];
type ReturningClient = Parameters<typeof useReturningClient>[0];

const refused = (status: number, code: string, detail: unknown = null): Error =>
    Object.assign(new Error(code), { status, code, detail });

function bookingClient(subject: "pet" | null): BookingClient {
    return {
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
            subject,
        }),
        getDays: vi.fn().mockResolvedValue([]),
        getSlots: vi
            .fn()
            .mockResolvedValue([
                { starts_at: STARTS, ends_at: "2026-10-15T18:00:00.000Z", staff_id: null },
            ]),
        joinWaitlist: vi.fn(),
        getPrograms: vi.fn().mockResolvedValue([]),
        payDeposit: vi.fn(),
        book: vi.fn().mockResolvedValue({
            booking_id: "booking",
            status: "confirmed",
            manage_token: null,
            deposit_cents: 0,
            deposit_client_secret: null,
            stripe_account_id: null,
        }),
    };
}

function returningClient(): ReturningClient {
    return {
        request: vi.fn().mockResolvedValue({ challenge_id: "challenge" }),
        verify: vi.fn().mockResolvedValue({
            token: "token",
            profile: {
                name: "Pat",
                phone: "+12505550123",
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
}

async function atDetails(booking: BookingClient, returning: ReturningClient) {
    const rendered = renderHook(() => {
        const flow = usePublicBookingFlow(booking, "demo", {
            itemId: "service",
            startsAt: STARTS,
        });
        return { flow, returning: useReturningClient(returning, "demo", flow) };
    });
    await waitFor(() => {
        expect(rendered.result.current.flow.step).toBe("details");
    });
    return rendered.result;
}

async function sendCode(result: Awaited<ReturnType<typeof atDetails>>): Promise<void> {
    act(() => {
        result.current.returning.setContact("+12505550123");
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
}

async function verified(booking: BookingClient, returning: ReturningClient) {
    const result = await atDetails(booking, returning);
    await sendCode(result);
    act(() => {
        result.current.returning.verifyCode();
    });
    await waitFor(() => {
        expect(result.current.flow.returningToken).toBe("token");
    });
    return result;
}

it("books a returning client with subjects at a client-only business without a subject", async () => {
    const booking = bookingClient(null);
    const result = await verified(booking, returningClient());
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

it("editing the contact after verifying ends the proof and shows the client as unverified", async () => {
    const booking = bookingClient("pet");
    const result = await verified(booking, returningClient());
    expect(result.current.flow.subjectId).toBe("sub_old");
    act(() => {
        result.current.flow.fields.setName("Pat Edited");
    });
    expect(result.current.flow.returningToken).toBeNull();
    expect(result.current.returning.stage).toBe("contact");
    expect(result.current.returning.profile).toBeNull();
    expect(result.current.returning.contact).toBe("+12505550123");
    expect(result.current.returning.proofEnded).toBe(true);
    act(() => {
        result.current.returning.chooseSubject("sub_old");
    });
    expect(result.current.flow.fields.name).toBe("Pat Edited");
    act(() => {
        result.current.flow.next();
    });
    await waitFor(() => {
        expect(booking.book).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(booking.book).mock.calls[0]?.[1]).toMatchObject({
        returningToken: null,
        subjectId: null,
        client: { name: "Pat Edited", phone: "+12505550123" },
        subjectName: "Rex",
    });
});

it("a booking refused for an ended proof drops it and asks the client to verify again", async () => {
    const booking = bookingClient("pet");
    vi.mocked(booking.book).mockRejectedValueOnce(refused(401, "returning_expired"));
    const result = await verified(booking, returningClient());
    act(() => {
        result.current.flow.next();
    });
    await waitFor(() => {
        expect(result.current.flow.error).toBe(strings.api.returningExpired);
    });
    expect(result.current.flow.returningToken).toBeNull();
    expect(result.current.flow.subjectId).toBeNull();
    expect(result.current.returning.stage).toBe("contact");
    expect(result.current.returning.proofEnded).toBe(true);
    act(() => {
        result.current.flow.next();
    });
    await waitFor(() => {
        expect(booking.book).toHaveBeenCalledTimes(2);
    });
    expect(vi.mocked(booking.book).mock.calls[1]?.[1]).toMatchObject({
        returningToken: null,
        subjectId: null,
    });
    expect(vi.mocked(booking.book).mock.calls[1]?.[2]).not.toBe(
        vi.mocked(booking.book).mock.calls[0]?.[2],
    );
});

it("a locked code sends the client back to ask for a new one with a plain message", async () => {
    const returning = returningClient();
    vi.mocked(returning.verify)
        .mockRejectedValueOnce(refused(401, "unauthorized"))
        .mockRejectedValueOnce(refused(429, "code_locked"));
    const result = await atDetails(bookingClient("pet"), returning);
    await sendCode(result);
    act(() => {
        result.current.returning.verifyCode();
    });
    await waitFor(() => {
        expect(result.current.returning.error).toBe(strings.publicReturning.verifyError);
    });
    expect(result.current.returning.stage).toBe("code");
    act(() => {
        result.current.returning.verifyCode();
    });
    await waitFor(() => {
        expect(result.current.returning.error).toBe(strings.api.codeLocked);
    });
    expect(result.current.returning.stage).toBe("contact");
    expect(result.current.returning.code).toBe("");
    await sendCode(result);
    expect(returning.request).toHaveBeenCalledTimes(2);
});

it("changing the number by hand is not an ended proof", async () => {
    const result = await verified(bookingClient("pet"), returningClient());
    act(() => {
        result.current.returning.reset();
    });
    expect(result.current.flow.returningToken).toBeNull();
    expect(result.current.returning.stage).toBe("contact");
    expect(result.current.returning.proofEnded).toBe(false);
});

it("a refusal that lands after the client changed the number shows nothing", async () => {
    const returning = returningClient();
    let refuse: (e: Error) => void = () => undefined;
    vi.mocked(returning.verify).mockReturnValueOnce(
        new Promise((_, reject) => {
            refuse = reject;
        }),
    );
    const result = await atDetails(bookingClient("pet"), returning);
    await sendCode(result);
    act(() => {
        result.current.returning.verifyCode();
    });
    act(() => {
        result.current.returning.reset();
    });
    await act(async () => {
        refuse(refused(429, "code_locked"));
        await Promise.resolve();
    });
    await waitFor(() => {
        expect(result.current.returning.busy).toBe(false);
    });
    expect(result.current.returning.error).toBeNull();
    expect(result.current.returning.stage).toBe("contact");
});

it.each([
    ["codes_limited", 429, { minutes: 15 }, () => strings.api.codesLimited(15)],
    ["codes_limited", 429, null, () => strings.api.tooManyRequests],
    ["invalid_phone", 422, null, () => strings.api.invalidPhone],
    ["invalid_request", 422, null, () => strings.api.invalidPhone],
    ["sms_unassigned", 503, null, () => strings.publicReturning.textsUnavailable],
    ["sms_failed", 502, null, () => strings.publicReturning.textsUnavailable],
    ["sms_refused", 422, null, () => strings.publicReturning.numberRefused],
    ["internal_error", 500, null, () => strings.publicReturning.requestError],
])("a refused code request for %s says why", async (code, status, detail, message) => {
    const returning = returningClient();
    vi.mocked(returning.request).mockRejectedValueOnce(refused(status, code, detail));
    const result = await atDetails(bookingClient("pet"), returning);
    act(() => {
        result.current.returning.setContact("+12505550123");
    });
    act(() => {
        result.current.returning.requestCode();
    });
    await waitFor(() => {
        expect(result.current.returning.error).toBe(message());
    });
    expect(result.current.returning.stage).toBe("contact");
});

it("the returning client reads a refusal's code, never its text", async () => {
    const fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "code_locked", message: "developer text" }), {
            status: 429,
        }),
    );
    vi.stubGlobal("fetch", fetch);
    try {
        await expect(
            createReturningClient("https://api.test").verify("my slug", "challenge", "123456"),
        ).rejects.toMatchObject({ status: 429, code: "code_locked" });
        expect(fetch).toHaveBeenCalledWith(
            "https://api.test/book/my%20slug/returning/verify",
            expect.objectContaining({
                method: "POST",
                body: JSON.stringify({ challenge_id: "challenge", code: "123456" }),
            }),
        );
    } finally {
        vi.unstubAllGlobals();
    }
});
