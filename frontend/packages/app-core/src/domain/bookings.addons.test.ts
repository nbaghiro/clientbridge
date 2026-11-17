// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { strings } from "../strings";
import { type CalendarEvent, useBookingAddons } from "./bookings";
import { clearTasks, useTask } from "./navigation";

let invoiceRows: { invoice_id: string | null; covered?: number; sold?: number }[] = [];
let addonRows: { id: string; quantity: number; unit_amount_cents: number }[] = [];

vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: (sql: string) => ({
        data: sql.includes("invoice_id")
            ? invoiceRows
            : sql.includes("FROM addons")
              ? addonRows
              : [],
    }),
}));

const EVENT = {
    id: "ses_1",
    slotId: "ses_1",
    bookingId: "bk_1",
    status: "completed",
    staffId: "st_owner",
    itemId: "it_bath",
} as unknown as CalendarEvent;
const OWNER = { staffId: "st_owner", role: "owner" } as const;

function invoicingApi(): ApiLike {
    return {
        get: <T>() => Promise.resolve({} as T),
        getText: () => Promise.resolve(""),
        post: <T>() => Promise.resolve({ id: "inv_new", status: "draft" } as T),
        patch: <T>() => Promise.resolve({} as T),
        delete: <T>() => Promise.resolve({} as T),
    };
}

afterEach(() => {
    clearTasks();
    invoiceRows = [];
    addonRows = [];
});

describe("invoicing a visit", () => {
    it("bills a covered visit only for add-ons, so one without any offers no invoice", () => {
        invoiceRows = [{ invoice_id: null, covered: 1 }];
        const covered = renderHook(() => useBookingAddons(invoicingApi(), EVENT, OWNER));
        expect(covered.result.current.canInvoice).toBe(false);
        expect(covered.result.current.canEdit).toBe(true);
        addonRows = [{ id: "ba_1", quantity: 1, unit_amount_cents: 1200 }];
        covered.rerender();
        expect(covered.result.current.canInvoice).toBe(true);
    });

    it("offers no invoice for a visit already sold at the desk", () => {
        invoiceRows = [{ invoice_id: null, covered: 0, sold: 1 }];
        const { result } = renderHook(() => useBookingAddons(invoicingApi(), EVENT, OWNER));
        expect(result.current.canInvoice).toBe(false);
    });

    it("says in words when the desk sold the visit before the replica knew", async () => {
        const sold = Object.assign(new Error("409"), { code: "visit_sold" });
        const api = { ...invoicingApi(), post: () => Promise.reject(sold) };
        const { result } = renderHook(() => useBookingAddons(api, EVENT, OWNER));
        act(() => {
            result.current.createInvoice();
        });
        await waitFor(() => {
            expect(result.current.error).toBe(strings.api.visitSold);
        });
    });

    it("says in words when another device covered the visit before the replica knew", async () => {
        const covered = Object.assign(new Error("409"), { code: "visit_covered" });
        const api = { ...invoicingApi(), post: () => Promise.reject(covered) };
        const { result } = renderHook(() => useBookingAddons(api, EVENT, OWNER));
        act(() => {
            result.current.createInvoice();
        });
        await waitFor(() => {
            expect(result.current.error).toBe(strings.api.visitCovered);
        });
    });

    it("opens the new draft once it is created", async () => {
        const { result } = renderHook(() => ({
            addons: useBookingAddons(invoicingApi(), EVENT, OWNER),
            task: useTask(),
        }));
        expect(result.current.addons.canInvoice).toBe(true);
        act(() => {
            result.current.addons.createInvoice();
        });
        await waitFor(() => {
            expect(result.current.task).toEqual({ kind: "record", type: "invoice", id: "inv_new" });
        });
    });

    it("stays busy until the new draft reaches this device", async () => {
        const { result, rerender } = renderHook(() => ({
            addons: useBookingAddons(invoicingApi(), EVENT, OWNER),
            task: useTask(),
        }));
        act(() => {
            result.current.addons.createInvoice();
        });
        await waitFor(() => {
            expect(result.current.task).not.toBeNull();
        });
        expect(result.current.addons.busy).toBe(true);
        invoiceRows = [{ invoice_id: "inv_new" }];
        rerender();
        expect(result.current.addons.busy).toBe(false);
        expect(result.current.addons.invoiceId).toBe("inv_new");
    });

    it("opens the invoice a visit already has", () => {
        invoiceRows = [{ invoice_id: "inv_old" }];
        const { result } = renderHook(() => ({
            addons: useBookingAddons(invoicingApi(), EVENT, OWNER),
            task: useTask(),
        }));
        expect(result.current.addons.canInvoice).toBe(false);
        act(() => {
            result.current.addons.openInvoice();
        });
        expect(result.current.task).toEqual({ kind: "record", type: "invoice", id: "inv_old" });
    });
});
