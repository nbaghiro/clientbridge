// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { type ReactNode, createElement } from "react";
import { expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { BusinessZoneContext } from "../datetime";
import { type ClientListRow, useClientEditor } from "./clients";

vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: () => ({ data: [] }),
}));

const api: ApiLike = {
    get: <T>() => Promise.resolve({} as T),
    getText: () => Promise.resolve(""),
    post: <T>() => Promise.resolve({} as T),
    patch: <T>() => Promise.resolve({} as T),
    delete: <T>() => Promise.resolve({} as T),
};

const ann: ClientListRow = {
    id: "cl_ann",
    name: "Ann Tremblay",
    phone: "+16045550001",
    phoneLabel: "(604) 555-0001",
    archived: false,
    archivedAt: null,
    tags: [],
    subjects: "",
    next: null,
    balanceCents: 0,
    lifetimeCents: null,
    since: new Date("2026-01-01T00:00:00Z"),
};

const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(BusinessZoneContext.Provider, { value: "America/Vancouver" }, children);

function editor(directory: readonly ClientListRow[]) {
    return renderHook(
        ({ rows }: { rows: readonly ClientListRow[] }) =>
            useClientEditor(api, rows, "cl_ann", () => undefined),
        { wrapper, initialProps: { rows: directory } },
    );
}

it("fills the form once the directory loads after the editor opened", () => {
    const { result, rerender } = editor([]);
    expect(result.current.draft.name).toBe("");
    rerender({ rows: [ann] });
    expect(result.current.mode).toBe("edit");
    expect(result.current.draft.name).toBe("Ann Tremblay");
    expect(result.current.draft.phone).toBe("(604) 555-0001");
    expect(result.current.dirty).toBe(false);
});

it("keeps what the person typed when the record refreshes", () => {
    const { result, rerender } = editor([ann]);
    act(() => {
        result.current.set("name", "Ann T.");
    });
    rerender({ rows: [{ ...ann, phone: "+16045550002" }] });
    expect(result.current.draft.name).toBe("Ann T.");
    expect(result.current.draft.phone).toBe("(604) 555-0001");
});

const bo: ClientListRow = { ...ann, id: "cl_bo", name: "Bo Diaz", phone: "+16045550009" };

function adding(directory: readonly ClientListRow[], post: ApiLike["post"]) {
    return renderHook(() => useClientEditor({ ...api, post }, directory, null, () => undefined), {
        wrapper,
    });
}

it("won't save a phone another client holds, and offers that client instead", () => {
    const post = vi.fn();
    const { result } = adding([ann], post);
    act(() => {
        result.current.set("name", "Someone New");
        result.current.set("phone", "604 555 0001");
    });
    expect(result.current.duplicates).toEqual([{ client: ann, phoneTaken: true }]);
    act(() => {
        result.current.ignoreDuplicates();
        result.current.submit();
    });
    expect(result.current.duplicates).toEqual([{ client: ann, phoneTaken: true }]);
    expect(post).not.toHaveBeenCalled();
});

it("shows the client a refused save names as holding the phone", async () => {
    const refused = Object.assign(new Error("409"), {
        status: 409,
        code: "phone_taken",
        detail: { client_id: "cl_bo" },
    });
    const post = vi.fn().mockRejectedValue(refused);
    const { result } = adding([{ ...bo, phone: null }], post);
    act(() => {
        result.current.set("name", "Someone New");
        result.current.set("phone", "604 555 0009");
    });
    await act(async () => {
        result.current.submit();
        await Promise.resolve();
    });
    expect(result.current.duplicates).toEqual([
        { client: { ...bo, phone: null }, phoneTaken: true },
    ]);
    expect(result.current.error).toBeNull();
    act(() => {
        result.current.set("phone", "604 555 0010");
    });
    expect(result.current.duplicates).toEqual([]);
});
