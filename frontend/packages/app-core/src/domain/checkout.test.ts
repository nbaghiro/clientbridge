// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { BusinessZoneContext, formatDate, parseTimestamp } from "../datetime";
import { formatPhone } from "../format";
import { strings } from "../strings";
import {
    createPublicPaymentSetupClient,
    paymentErrorMessage,
    refusedConfirm,
    useAddPaymentMethod,
    useCheckout,
} from "./checkout";

const replica: { phone: string | null; banks: { id: string; mandate_status: string }[] } = {
    phone: "+16045550001",
    banks: [],
};

vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: (sql: string) => ({
        data: sql.includes("FROM clients") ? [{ phone: replica.phone }] : replica.banks,
        isLoading: false,
    }),
}));

const TOKEN = "A".repeat(43);

describe("createPublicPaymentSetupClient", () => {
    it("never asks the server about a token no link could carry", async () => {
        const fetch = vi.fn();
        vi.stubGlobal("fetch", fetch);
        try {
            const client = createPublicPaymentSetupClient("https://connect.example");
            for (const token of ["", "abc", `${TOKEN}A`, `${TOKEN.slice(1)}!`]) {
                await expect(client.get(token)).rejects.toMatchObject({ status: 404 });
            }
            expect(fetch).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("sends the payer email only in the Stripe setup start request", async () => {
        const fetch = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ status: "requires_payment_method" }), {
                status: 200,
            }),
        );
        vi.stubGlobal("fetch", fetch);
        try {
            const client = createPublicPaymentSetupClient("https://connect.example");
            await client.start(TOKEN, "payer@example.test");
            expect(fetch).toHaveBeenCalledWith(
                "https://connect.example/payment-method/start",
                expect.objectContaining({
                    method: "POST",
                    headers: {
                        "X-Payment-Setup-Token": TOKEN,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ email: "payer@example.test" }),
                }),
            );
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe("refusedConfirm", () => {
    it("reads a refused confirm by the intent's status on web and native", () => {
        expect(refusedConfirm("succeeded")).toBe("paid");
        expect(refusedConfirm("Processing")).toBe("paid");
        expect(refusedConfirm("canceled")).toBe("canceled");
        expect(refusedConfirm("Canceled")).toBe("canceled");
        expect(refusedConfirm("requires_payment_method")).toBe("failed");
        expect(refusedConfirm(undefined)).toBe("failed");
        expect(refusedConfirm(null)).toBe("failed");
    });
});

describe("paymentErrorMessage", () => {
    it("names the missing Stripe setup when the server answers 503", () => {
        const e = Object.assign(new Error("refused"), {
            status: 503,
            code: "payments_not_configured",
        });
        expect(paymentErrorMessage(e, "retry")).toBe(strings.payments.notConfigured);
    });

    it("names a declined card from the server's code", () => {
        const declined = Object.assign(new Error("402"), { status: 402, code: "card_declined" });
        expect(paymentErrorMessage(declined, "retry")).toBe(strings.api.cardDeclined);
    });

    it("falls back to the caller's message for any other failure", () => {
        const failed = Object.assign(new Error("refused"), { status: 500, code: null });
        expect(paymentErrorMessage(failed, "retry")).toBe("retry");
        expect(paymentErrorMessage(new Error("offline"), "retry")).toBe("retry");
        expect(paymentErrorMessage("nope", "retry")).toBe("retry");
    });
});

describe("useCheckout", () => {
    const refused = (status: number | undefined) =>
        Object.assign(new Error("refused"), status === undefined ? {} : { status, code: null });

    it("starts a new attempt after a refusal and keeps the key when the answer was lost", async () => {
        const keys: string[] = [];
        const failures = [refused(402), refused(409), refused(undefined)];
        const charge = (input: { idempotencyKey: string }) => {
            keys.push(input.idempotencyKey);
            return Promise.reject(failures[keys.length - 1] ?? new Error("done"));
        };
        const { result } = renderHook(() =>
            useCheckout(() => undefined, { defaultMethod: "pm_1" }),
        );
        for (let press = 1; press <= 3; press++) {
            act(() => {
                result.current.pay(charge, "retry", { amount: 500 });
            });
            await waitFor(() => {
                expect(keys).toHaveLength(press);
            });
            await waitFor(() => {
                expect(result.current.busy).toBe(false);
            });
        }
        // a declined card is asked again under a new key; a conflict or lost answer keeps it
        expect(keys[1]).not.toBe(keys[0]);
        expect(keys[2]).toBe(keys[1]);
    });
});

describe("useAddPaymentMethod bank links", () => {
    const zone = "America/Vancouver";
    const expires = "2026-10-23T17:00:00Z";
    const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(BusinessZoneContext.Provider, { value: zone }, children);

    function setup(open: { id: string; verifying: boolean; expires_at: string } | null) {
        const get = vi.fn(() => Promise.resolve(open));
        const post = vi.fn(() =>
            Promise.resolve({
                id: "psl_new",
                url: "https://pay.test/setup",
                expires_at: expires,
                texted: true,
            }),
        );
        const api = {
            get,
            getText: () => Promise.resolve(""),
            post,
            patch: () => Promise.resolve({}),
            delete: vi.fn(() => Promise.resolve({})),
        } as unknown as ApiLike;
        const hook = renderHook(() => useAddPaymentMethod(api, "cl_ann", () => undefined), {
            wrapper,
        });
        return { ...hook, get, post };
    }

    it("shows a link still waiting on the client, with when it expires", async () => {
        replica.phone = "+16045550001";
        replica.banks = [];
        const { result } = setup({ id: "psl_open", verifying: false, expires_at: expires });
        await waitFor(() => {
            expect(result.current.openBankLink).not.toBeNull();
        });
        expect(result.current.openBankLink).toEqual({
            verifying: false,
            note: strings.checkout.bankLinkWaiting(formatDate(parseTimestamp(expires), zone)),
        });
        expect(result.current.textTo).toBe(formatPhone("+16045550001"));
    });

    it("says Stripe is checking the account while the client verifies it", async () => {
        const { result } = setup({ id: "psl_open", verifying: true, expires_at: expires });
        await waitFor(() => {
            expect(result.current.openBankLink?.note).toBe(strings.checkout.bankLinkVerifying);
        });
    });

    it("texts a new link only when asked, and offers no text without a mobile", async () => {
        replica.phone = null;
        const { result, post } = setup(null);
        expect(result.current.textTo).toBeNull();
        act(() => {
            result.current.requestBankLink(true);
        });
        await waitFor(() => {
            expect(result.current.bankLink?.texted).toBe(true);
        });
        expect(post).toHaveBeenCalledWith("/v1/payments/pad-links/cl_ann", { text: true });
        expect(result.current.openBankLink).toBeNull();
        replica.phone = "+16045550001";
    });

    it("asks again when staff open the bank sheet", async () => {
        const { result, get } = setup(null);
        await waitFor(() => {
            expect(get).toHaveBeenCalledTimes(1);
        });
        act(() => {
            result.current.start("bank");
        });
        await waitFor(() => {
            expect(get).toHaveBeenCalledTimes(2);
        });
    });

    it("asks again once the client's bank account arrives or changes", async () => {
        replica.banks = [];
        const { get, rerender } = setup({ id: "psl_open", verifying: true, expires_at: expires });
        await waitFor(() => {
            expect(get).toHaveBeenCalledTimes(1);
        });
        replica.banks = [{ id: "pm_bank", mandate_status: "pending" }];
        rerender();
        await waitFor(() => {
            expect(get).toHaveBeenCalledTimes(2);
        });
        replica.banks = [];
    });

    it("stops offering the link just made once the client has used it", async () => {
        replica.banks = [];
        const { result, rerender } = setup(null);
        act(() => {
            result.current.requestBankLink(false);
        });
        await waitFor(() => {
            expect(result.current.bankLink?.id).toBe("psl_new");
        });
        replica.banks = [{ id: "pm_bank", mandate_status: "active" }];
        rerender();
        expect(result.current.bankLink).toBeNull();
        replica.banks = [];
    });
});
