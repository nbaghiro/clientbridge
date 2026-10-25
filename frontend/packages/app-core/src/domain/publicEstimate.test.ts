// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { type PublicEstimate, usePublicEstimatePage } from "./publicEstimate";

afterEach(cleanup);

const line = (id: string, optional: boolean, selected: boolean, tax: number) => ({
    id,
    description: id,
    quantity: 1,
    unit_amount_cents: 10000,
    amount_cents: 10000,
    tax_codes: ["GST"],
    optional,
    selected,
    tax_cents: tax,
    tax_by_code: { GST: tax },
});

// two $100 lines, the second optional, 10% off the estimate and 5% GST
const sent: PublicEstimate = {
    number: 4,
    business_name: "Birch Studio",
    brand: { logo_url: null, primary: null, tagline: null },
    contact_email: null,
    gst_hst_number: null,
    qst_number: null,
    client_name: "Ann",
    status: "sent",
    currency: "CAD",
    timezone: "America/Vancouver",
    subtotal_cents: 9000,
    tax_total_cents: 450,
    total_cents: 9450,
    issued_at: null,
    valid_until: null,
    notes: null,
    decline_reason: null,
    discount_cents: 1000,
    discount_reason: null,
    lines: [line("base", false, false, 450), line("addon", true, false, 500)],
    taxes: [{ code: "GST", rate_bps: 500, base_cents: 9000, cents: 450 }],
};

const quoted: PublicEstimate = {
    ...sent,
    subtotal_cents: 18000,
    tax_total_cents: 900,
    total_cents: 18900,
    discount_cents: 2000,
    lines: [line("base", false, false, 450), line("addon", true, true, 450)],
    taxes: [{ code: "GST", rate_bps: 500, base_cents: 18000, cents: 900 }],
};

it("shows and accepts the total the server quotes for the ticked add-on", async () => {
    let answer: (estimate: PublicEstimate) => void = () => undefined;
    const quote = vi.fn(
        () =>
            new Promise<PublicEstimate>((resolve) => {
                answer = resolve;
            }),
    );
    const accept = vi.fn().mockResolvedValue({ ...quoted, status: "accepted" });
    const client = {
        getEstimate: vi.fn().mockResolvedValue(sent),
        quote,
        accept,
        decline: vi.fn(),
    };
    const { result } = renderHook(() => usePublicEstimatePage(client, "tok"));
    await waitFor(() => {
        expect(result.current.status).toBe("open");
    });
    expect(result.current.totalCents).toBe(9450);
    expect(quote).not.toHaveBeenCalled();

    act(() => {
        result.current.toggle("addon");
    });
    await waitFor(() => {
        expect(quote).toHaveBeenCalledWith("tok", ["addon"]);
    });
    expect(result.current.busy).toBe(true);
    act(() => {
        result.current.accept();
    });
    expect(accept).not.toHaveBeenCalled();

    act(() => {
        answer(quoted);
    });
    await waitFor(() => {
        expect(result.current.totalCents).toBe(18900);
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.totals.map((t) => [t.key, t.cents])).toEqual([
        ["discount", 2000],
        ["subtotal", 18000],
        ["GST", 900],
        ["total", 18900],
    ]);
    act(() => {
        result.current.accept();
    });
    await waitFor(() => {
        expect(result.current.status).toBe("accepted");
    });
    expect(accept).toHaveBeenCalledWith("tok", ["addon"], 18900);
});
