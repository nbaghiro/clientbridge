// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { strings } from "../strings";
import { type ClientRow, filterClients, useNoteComposer, visitPill } from "./clients";
import { zonedDate } from "../datetime";

const ZONE = "America/Vancouver";

const r = strings.clients.record;

const client = (id: string, name: string, phone: string | null) =>
    ({ id, name, phone, status: "active", lifetime_value_cents: null }) satisfies ClientRow;

const ROWS = [
    client("cl_ann", "Ann Tremblay", "+16045550001"),
    client("cl_ben", "ben", null),
    client("cl_cara", "Cara", "+12505550202"),
];

describe("filterClients", () => {
    it("matches names without case and phone digits as stored", () => {
        expect(filterClients(ROWS, "")).toBe(ROWS);
        expect(filterClients(ROWS, "   ")).toBe(ROWS);
        expect(filterClients(ROWS, "ANN").map((c) => c.id)).toEqual(["cl_ann"]);
        expect(filterClients(ROWS, " Ben ").map((c) => c.id)).toEqual(["cl_ben"]);
        expect(filterClients(ROWS, "604555").map((c) => c.id)).toEqual(["cl_ann"]);
        expect(filterClients(ROWS, "2505550202").map((c) => c.id)).toEqual(["cl_cara"]);
        expect(filterClients(ROWS, "zzz")).toEqual([]);
    });
});

describe("visitPill", () => {
    type Visit = Parameters<typeof visitPill>[0];
    const now = zonedDate(2026, 10, 7, 12, 0, ZONE);
    const visit = (extra: Partial<Visit>): Visit => ({
        id: "bk_1",
        status: "confirmed",
        subjectId: null,
        start: zonedDate(2026, 10, 8, 10, 0, ZONE),
        end: zonedDate(2026, 10, 8, 11, 0, ZONE),
        service: "Groom",
        color: null,
        staffName: null,
        depositCents: 0,
        depositStatus: "none",
        waitlistClosed: false,
        ...extra,
    });

    it("marks a visit under way, from the minute it starts", () => {
        const pill = { label: r.inProgress, intent: "accent" };
        expect(visitPill(visit({ start: now, depositCents: 2000 }), now)).toEqual(pill);
        expect(visitPill(visit({ start: zonedDate(2026, 10, 7, 11, 59, ZONE) }), now)).toEqual(
            pill,
        );
    });

    it("shows a coming visit's deposit as paid or due, and nothing without one", () => {
        expect(visitPill(visit({}), now)).toBeNull();
        expect(visitPill(visit({ depositCents: 2000, depositStatus: "collected" }), now)).toEqual({
            label: r.depositPaid("$20.00"),
            intent: "success",
        });
        expect(visitPill(visit({ depositCents: 2000, depositStatus: "applied" }), now)).toEqual({
            label: r.depositPaid("$20.00"),
            intent: "success",
        });
        expect(visitPill(visit({ depositCents: 1875, depositStatus: "pending" }), now)).toEqual({
            label: r.depositDue("$18.75"),
            intent: "warning",
        });
    });
});

describe("useNoteComposer", () => {
    const api: ApiLike = {
        get: <T>() => Promise.resolve({} as T),
        getText: () => Promise.resolve(""),
        post: <T>() => Promise.resolve({} as T),
        patch: <T>() => Promise.resolve({} as T),
        delete: <T>() => Promise.resolve({} as T),
    };

    it("opens empty again after a cancel drops the draft and its error", () => {
        const { result } = renderHook(() => useNoteComposer(api, { bookingId: "bk_1" }));
        expect(result.current.open).toBe(false);
        act(() => {
            result.current.show();
        });
        act(() => {
            result.current.submit();
        });
        expect(result.current.error).toBe(strings.clients.history.noteRequired);
        act(() => {
            result.current.setBody("Gate code 4417");
        });
        act(() => {
            result.current.setPinned(true);
        });
        act(() => {
            result.current.cancel();
        });
        expect(result.current.open).toBe(false);
        act(() => {
            result.current.show();
        });
        expect(result.current).toMatchObject({ open: true, body: "", pinned: false, error: null });
    });

    it("closes and clears once the note is saved", async () => {
        const saved = vi.fn();
        const { result } = renderHook(() => useNoteComposer(api, { bookingId: "bk_1" }, saved));
        act(() => {
            result.current.show();
        });
        act(() => {
            result.current.setBody("Gate code 4417");
        });
        await act(async () => {
            result.current.submit();
            await Promise.resolve();
        });
        expect(saved).toHaveBeenCalledOnce();
        expect(result.current).toMatchObject({ open: false, body: "" });
    });
});
