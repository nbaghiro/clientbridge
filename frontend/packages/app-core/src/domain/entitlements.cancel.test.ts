// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ApiLike } from "../api";
import { strings } from "../strings";
import { useSubscriptionCancel } from "./entitlements";

function droppingResponse(posted: string[]): ApiLike {
    return {
        get: <T>() => Promise.resolve({} as T),
        getText: () => Promise.resolve(""),
        post: (path: string) => {
            posted.push(path);
            return Promise.reject(new TypeError("Failed to fetch"));
        },
        patch: <T>() => Promise.resolve({} as T),
        delete: <T>() => Promise.resolve({} as T),
    };
}

describe("cancelling a membership", () => {
    it("drops the failure once the membership syncs as canceled", async () => {
        const posted: string[] = [];
        const api = droppingResponse(posted);
        const { result, rerender } = renderHook(
            ({ status }) => useSubscriptionCancel(api, { id: "sub_1", status }),
            { initialProps: { status: "active" } },
        );
        expect(result.current.cancelable).toBe(true);
        act(() => {
            result.current.cancel();
        });
        await waitFor(() => {
            expect(result.current.error).toBe(strings.clients.cancelSubscriptionError);
        });
        rerender({ status: "canceled" });
        expect(result.current.cancelable).toBe(false);
        expect(result.current.error).toBeNull();
        expect(posted).toEqual(["/v1/subscriptions/sub_1/cancel"]);
    });
});
