// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useAsyncAction, useRemote } from "./hooks";

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
