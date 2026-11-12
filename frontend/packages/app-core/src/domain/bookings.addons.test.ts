// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { type CalendarEvent, useBookingAddons } from "./bookings";
import { clearTasks, useTask } from "./navigation";

let invoiceRows: { invoice_id: string | null }[] = [];

vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: (sql: string) => ({
        data: sql.includes("invoice_id") ? invoiceRows : [],
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
});

describe("invoicing a visit", () => {
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
