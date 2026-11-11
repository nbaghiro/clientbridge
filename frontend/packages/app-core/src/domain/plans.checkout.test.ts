// @vitest-environment happy-dom
import { renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { BusinessZoneContext } from "../datetime";
import { strings } from "../strings";
import { usePlan } from "./plans";

vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: () => ({ data: [{ id: "bz_1" }] }),
}));

const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(BusinessZoneContext.Provider, { value: "America/Vancouver" }, children);

const TRIAL = {
    access: "trial",
    plan: null,
    plan_status: "trialing",
    trial_ends_at: "2026-11-24T17:00:00Z",
    managed: false,
    interval: null,
    seats: 1,
    seat_cap: null,
    current_period_end: null,
    cancel_at_period_end: false,
    currency: "cad",
    prices: [],
};
const PAID = { ...TRIAL, access: "active", plan: "premium", plan_status: "active", managed: true };

function planApi(answers: object[]): { api: ApiLike; reads: () => number } {
    let reads = 0;
    const api: ApiLike = {
        get: <T>() =>
            Promise.resolve((answers[Math.min(reads++, answers.length - 1)] ?? TRIAL) as T),
        getText: () => Promise.resolve(""),
        post: <T>() => Promise.resolve({} as T),
        patch: <T>() => Promise.resolve({} as T),
        delete: <T>() => Promise.resolve({} as T),
    };
    return { api, reads: () => reads };
}

describe("the plan page after Checkout", () => {
    it("looks again until Stripe's event has marked the plan paid", async () => {
        const { api } = planApi([TRIAL, PAID]);
        const { result } = renderHook(() => usePlan(api, undefined, true), { wrapper });
        await waitFor(() => {
            expect(result.current.status).toBe(strings.plans.status.trial);
        });
        await waitFor(
            () => {
                expect(result.current.status).toBe(strings.plans.status.active);
            },
            { timeout: 5000 },
        );
    });

    it("reads the plan once when the owner didn't come back from Checkout", async () => {
        const { api, reads } = planApi([TRIAL, PAID]);
        const { result } = renderHook(() => usePlan(api), { wrapper });
        await waitFor(() => {
            expect(result.current.status).toBe(strings.plans.status.trial);
        });
        await new Promise((resolve) => setTimeout(resolve, 2500));
        expect(reads()).toBe(1);
    });
});
