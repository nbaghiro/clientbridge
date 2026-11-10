// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { BusinessZoneContext } from "../datetime";
import { useSalesHistory } from "./pos";

const today = new Date().toISOString();
const sale = (id: string, total: number, tip: number, refunded: number) => ({
    id,
    number: 1,
    client_id: null,
    client_name: null,
    source: "desk",
    pickup_status: null,
    created_at: today,
    total_cents: total,
    staff_id: "st_1",
    note: null,
    status: refunded >= total + tip ? "refunded" : "paid",
    tip_cents: tip,
    refunded_cents: refunded,
    discount_cents: 0,
    method: "cash",
    summary: null,
    item_count: 1,
});

vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: () => ({
        data: [
            sale("ord_kept", 5000, 0, 0),
            sale("ord_back", 5376, 0, 5376),
            sale("ord_half", 4000, 1000, 2500),
        ],
        isLoading: false,
        error: null,
    }),
}));

vi.mock("./sync", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./sync")>()),
    useReplicaLoad: () => ({ state: "ready", retry: () => undefined }),
}));

const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(BusinessZoneContext.Provider, { value: "America/Vancouver" }, children);

describe("the day's takings", () => {
    it("count what stays after refunds, and a sale refunded in full no longer counts as a sale", () => {
        const { result } = renderHook(() => useSalesHistory(), { wrapper });
        expect(result.current.today).toMatchObject({
            salesCents: 5000 + 2000,
            count: 2,
            tipsCents: 500,
            averageCents: 3500,
        });
        expect(result.current.days[0]).toMatchObject({ totalCents: 5000 + 2500, count: 2 });
    });
});
