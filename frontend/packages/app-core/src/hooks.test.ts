// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { typedRows, useAsyncAction, useDraftList, useRemote } from "./hooks";

afterEach(cleanup);

it("prevents simultaneous submissions before the busy state renders", async () => {
    let finish = (): void => undefined;
    const pending = new Promise<void>((resolve) => {
        finish = resolve;
    });
    const call = vi.fn(() => pending);
    const { result } = renderHook(() => useAsyncAction());
    act(() => {
        result.current.run(call);
        result.current.run(call);
    });
    expect(call).toHaveBeenCalledTimes(1);
    await act(async () => {
        finish();
        await pending;
    });
    act(() => {
        result.current.run(call);
    });
    expect(call).toHaveBeenCalledTimes(2);
    await act(async () => {
        await pending;
    });
});

it("ignores an older remote response when the resource changes", async () => {
    let first: (value: string) => void = () => undefined;
    let second: (value: string) => void = () => undefined;
    const a = new Promise<string>((resolve) => {
        first = resolve;
    });
    const b = new Promise<string>((resolve) => {
        second = resolve;
    });
    const { result, rerender } = renderHook(
        ({ key }) => useRemote(() => (key === "a" ? a : b), key),
        { initialProps: { key: "a" } },
    );
    rerender({ key: "b" });
    await act(async () => {
        second("current");
        await b;
    });
    expect(result.current.data).toBe("current");
    await act(async () => {
        first("stale");
        await a;
    });
    expect(result.current.data).toBe("current");
});

const KEYS = ["name", "phone"] as const;

it("edits a draft list over its stored rows and stops at the limit", () => {
    const stored = [{ name: "Rosa", phone: "" }];
    const { result } = renderHook(() => useDraftList(KEYS, stored, 3));
    expect(result.current.rows).toEqual(stored);
    for (let i = 0; i < 4; i++)
        act(() => {
            result.current.add();
        });
    expect(result.current.rows).toHaveLength(3);
    act(() => {
        result.current.set(1, "name", "Ngozi");
    });
    act(() => {
        result.current.remove(0);
    });
    expect(result.current.rows).toEqual([
        { name: "Ngozi", phone: "" },
        { name: "", phone: "" },
    ]);
    expect(stored).toEqual([{ name: "Rosa", phone: "" }]);
});

it("keeps no rows for a record without the list", () => {
    const { result } = renderHook(() => useDraftList(KEYS, null, 3));
    act(() => {
        result.current.add();
    });
    expect(result.current.rows).toBeNull();
    expect(typedRows(KEYS, result.current.rows)).toEqual([]);
});

it("sends trimmed values and drops blank fields and blank rows", () => {
    expect(
        typedRows(KEYS, [
            { name: " Ngozi ", phone: "" },
            { name: " ", phone: "" },
            { name: "", phone: "613-555-0181" },
        ]),
    ).toEqual([{ name: "Ngozi" }, { phone: "613-555-0181" }]);
});
