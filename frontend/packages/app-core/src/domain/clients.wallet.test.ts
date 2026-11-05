// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { type ReactNode, createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { BusinessZoneContext } from "../datetime";
import { strings } from "../strings";
import { useClientWallet } from "./clients";
import { canBeDefault, isDefaultMethod } from "./payments";

let rows: Record<string, unknown>[] = [];

vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: (sql: string) => ({
        data: sql.includes("FROM payment_methods") ? rows : [{ status: "active" }],
        isLoading: false,
    }),
}));

vi.mock("./sync", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./sync")>()),
    useReplicaLoad: () => ({ state: "ready" }),
}));

const api: ApiLike = {
    get: <T>() => Promise.resolve({} as T),
    getText: () => Promise.resolve(""),
    post: <T>() => Promise.resolve({} as T),
    patch: <T>() => Promise.resolve({} as T),
    delete: <T>() => Promise.resolve({} as T),
};

const method = (
    id: string,
    extra: Partial<{
        method: string;
        brand: string;
        last4: string;
        preferred: number;
        mandate_status: string;
        pays: string | null;
    }> = {},
) => ({
    id,
    client_id: "cl_ann",
    method: "card",
    brand: "Visa",
    last4: id.slice(-4),
    preferred: 0,
    mandate_status: "none",
    exp_month: 12,
    exp_year: 2034,
    holder_name: null,
    bank_name: null,
    created_at: "2026-01-01T00:00:00Z",
    pays: null,
    ...extra,
});

const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(BusinessZoneContext.Provider, { value: "America/Vancouver" }, children);

function wallet() {
    return renderHook(() => useClientWallet(api, "cl_ann"), { wrapper }).result.current;
}

function shown(index: number) {
    const m = wallet().methods[index];
    if (m === undefined) throw new Error(`no method at ${String(index)}`);
    return m;
}

describe("wallet defaults", () => {
    it("never shows a bank account waiting on its mandate as the default", () => {
        const pending = method("pm_bank", {
            method: "bank_eft",
            preferred: 1,
            mandate_status: "pending",
        });
        expect(isDefaultMethod(pending)).toBe(false);
        expect(canBeDefault(pending)).toBe(false);
        expect(isDefaultMethod({ ...pending, mandate_status: "active" })).toBe(true);
        expect(canBeDefault(method("pm_card"))).toBe(true);
    });
});

describe("removing a method a membership bills", () => {
    beforeEach(() => {
        rows = [];
    });

    it("moves the default's memberships to the newest other chargeable method", () => {
        rows = [
            method("pm_4242", { preferred: 1, pays: "Monthly Plan" }),
            method("pm_1111"),
            method("pm_5555"),
            method("pm_bank", { method: "bank_eft", mandate_status: "pending" }),
        ];
        expect(wallet().removeMessage(shown(0))).toBe(
            strings.clients.wallet.removeBodyInUse("Monthly Plan", shown(2).label),
        );
    });

    it("moves another method's memberships to the default", () => {
        rows = [method("pm_1111", { preferred: 1 }), method("pm_4242", { pays: "Monthly Plan" })];
        expect(wallet().removeMessage(shown(1))).toBe(
            strings.clients.wallet.removeBodyInUse("Monthly Plan", shown(0).label),
        );
    });

    it("warns when nothing else could take the membership", () => {
        rows = [
            method("pm_4242", { preferred: 1, pays: "Monthly Plan" }),
            method("pm_bank", { method: "bank_eft", mandate_status: "pending" }),
        ];
        expect(wallet().removeMessage(shown(0))).toBe(
            strings.clients.wallet.removeBodyLast("Monthly Plan"),
        );
    });

    it("explains plainly what removing a method nobody bills does", () => {
        rows = [method("pm_4242")];
        expect(wallet().removeMessage(shown(0))).toBe(strings.clients.wallet.removeBody);
    });
});
