// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { BusinessZoneContext } from "../datetime";
import { strings } from "../strings";
import type { Viewer } from "./auth";
import { useProgramForm } from "./programs";

vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: (sql: string) => ({
        data: sql.includes("FROM staff")
            ? [
                  { id: "st_admin", name: "Alex", role: "admin", status: "active" },
                  { id: "st_owner", name: "Hannah", role: "owner", status: "active" },
              ]
            : sql.includes("FROM items")
              ? [
                    {
                        id: "it_camp",
                        kind: "class",
                        name: "Agility camp",
                        active: 1,
                        capacity: 6,
                        session_count: 3,
                        staff_ids: null,
                        resource_ids: null,
                    },
                ]
              : [],
    }),
}));

afterEach(cleanup);

const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(BusinessZoneContext.Provider, { value: "America/Vancouver" }, children);

function refusingApi(): ApiLike {
    const conflict = Object.assign(new Error("409"), { status: 409, code: "schedule_conflict" });
    return {
        get: <T>() => Promise.resolve({} as T),
        getText: () => Promise.resolve(""),
        post: () => Promise.reject(conflict),
        patch: <T>() => Promise.resolve({} as T),
        delete: <T>() => Promise.resolve({} as T),
    };
}

describe("useProgramForm", () => {
    it("starts with the signed-in member once they load, and otherwise asks who teaches", () => {
        const owner: Viewer = { staffId: "st_owner", role: "owner" };
        const form = renderHook(
            ({ viewer }: { viewer: Viewer | null }) =>
                useProgramForm(refusingApi(), viewer, vi.fn()),
            { wrapper, initialProps: { viewer: null as Viewer | null } },
        );
        act(() => {
            form.result.current.setItemId("it_camp");
        });
        expect(form.result.current.staffId).toBe("");
        expect(form.result.current.blocker).toBe(strings.programs.chooseInstructor);
        form.rerender({ viewer: owner });
        expect(form.result.current.staffId).toBe("st_owner");
        act(() => {
            form.result.current.setStaffId("st_admin");
        });
        expect(form.result.current.staffId).toBe("st_admin");
    });

    it("drops a refusal once the time, days or instructor change", async () => {
        const viewer: Viewer = { staffId: "st_owner", role: "owner" };
        const form = renderHook(() => useProgramForm(refusingApi(), viewer, vi.fn()), {
            wrapper,
        });
        act(() => {
            form.result.current.setItemId("it_camp");
        });
        const refuse = async (): Promise<void> => {
            act(() => {
                form.result.current.submit();
            });
            await waitFor(() => {
                expect(form.result.current.error).toBe(strings.api.scheduleConflict);
            });
        };
        await refuse();
        act(() => {
            form.result.current.setTime("16:00");
        });
        expect(form.result.current.error).toBeNull();
        await refuse();
        act(() => {
            form.result.current.toggleWeekday("MO");
        });
        expect(form.result.current.error).toBeNull();
        await refuse();
        act(() => {
            form.result.current.setStaffId("st_admin");
        });
        expect(form.result.current.error).toBeNull();
        await refuse();
        act(() => {
            form.result.current.setFirstDay("2026-11-23");
        });
        expect(form.result.current.error).toBeNull();
    });
});
