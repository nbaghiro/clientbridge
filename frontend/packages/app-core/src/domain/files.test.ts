// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { strings } from "../strings";
import { canEditPhoto, logoTarget, personMedia, photoIndex, useFileUpload } from "./files";

describe("useFileUpload", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function storageApi(post: (path: string, body: unknown) => Promise<unknown>): ApiLike {
        return { post } as unknown as ApiLike;
    }

    const minted = { file: { id: "fl_a" }, upload_url: "https://files.test/a" };

    it("declares the bytes' own type and size, then confirms them", async () => {
        const put = vi.fn(() => Promise.resolve({ ok: true }));
        vi.stubGlobal("fetch", put);
        const posts: [string, unknown][] = [];
        const api = storageApi((path, body) => {
            posts.push([path, body]);
            return Promise.resolve(minted);
        });
        const uploaded = vi.fn();
        const { result } = renderHook(() => useFileUpload(api, uploaded));
        const bytes = new Blob(["abcd"], { type: "image/webp" });
        act(() => {
            result.current.upload(Promise.resolve(bytes), logoTarget("bz_a"));
        });
        await waitFor(() => {
            expect(uploaded).toHaveBeenCalledWith("fl_a");
        });
        expect(posts[0]).toEqual([
            "/v1/files",
            {
                parent_type: "business",
                parent_id: "bz_a",
                purpose: "logo",
                content_type: "image/webp",
                size: 4,
            },
        ]);
        expect(put).toHaveBeenCalledWith("https://files.test/a", {
            method: "PUT",
            headers: { "Content-Type": "image/webp" },
            body: bytes,
        });
        expect(posts[1]?.[0]).toBe("/v1/files/fl_a/complete");
    });

    it("says what is wrong with a refused file", async () => {
        const refused = Object.assign(new Error("422"), { code: "file_too_large" });
        const api = storageApi(() => Promise.reject(refused));
        const { result } = renderHook(() => useFileUpload(api));
        act(() => {
            result.current.upload(new Blob(["a"], { type: "image/png" }), logoTarget("bz_a"));
        });
        await waitFor(() => {
            expect(result.current.error).toBe(strings.api.fileTooLarge);
        });
    });

    it("reports bytes that could not be prepared, without asking the server", async () => {
        const post = vi.fn();
        const unreadable = Object.assign(new Error("no"), { code: "file_type_unsupported" });
        const { result } = renderHook(() => useFileUpload(storageApi(post)));
        act(() => {
            result.current.upload(Promise.reject(unreadable), logoTarget("bz_a"));
        });
        await waitFor(() => {
            expect(result.current.error).toBe(strings.api.fileTypeUnsupported);
        });
        expect(post).not.toHaveBeenCalled();
    });

    it("tells a connection failure apart from a refused file", async () => {
        const api = storageApi(() => Promise.reject(new TypeError("offline")));
        const { result } = renderHook(() => useFileUpload(api));
        act(() => {
            result.current.upload(new Blob(["a"], { type: "image/png" }), logoTarget("bz_a"));
        });
        await waitFor(() => {
            expect(result.current.error).toBe(strings.common.fileUploadOffline);
        });
    });
});

describe("photoIndex", () => {
    it("keeps each person's newest photo, keyed by client, user and staff id", () => {
        const index = photoIndex([
            { id: "fl_old", parent_type: "client", parent_id: "cl_a", staff_id: null },
            { id: "fl_dana", parent_type: "user", parent_id: "us_dana", staff_id: "st_dana" },
            { id: "fl_new", parent_type: "client", parent_id: "cl_a", staff_id: null },
            { id: "fl_b", parent_type: "client", parent_id: "cl_b", staff_id: null },
        ]);
        expect([...index.clients]).toEqual([
            ["cl_a", "fl_new"],
            ["cl_b", "fl_b"],
        ]);
        expect([...index.users]).toEqual([["us_dana", "fl_dana"]]);
        expect([...index.staff]).toEqual([["st_dana", "fl_dana"]]);
    });

    it("gives a user without a staff row on this business no staff photo", () => {
        const index = photoIndex([
            { id: "fl_u", parent_type: "user", parent_id: "us_gone", staff_id: null },
        ]);
        expect(index.users.get("us_gone")).toBe("fl_u");
        expect(index.staff.size).toBe(0);
    });

    it("ignores files that belong to anything else", () => {
        const index = photoIndex([
            { id: "fl_pet", parent_type: "subject", parent_id: "sj_a", staff_id: null },
            { id: "fl_visit", parent_type: "booking", parent_id: "bk_a", staff_id: null },
        ]);
        expect(index.clients.size + index.users.size + index.staff.size).toBe(0);
    });
});

describe("canEditPhoto", () => {
    const client = { kind: "client", id: "cl_a" } as const;
    const self = { kind: "user", id: "us_me" } as const;
    const colleague = { kind: "user", id: "us_other" } as const;

    it("lets any member change a client's photo", () => {
        for (const role of ["owner", "admin", "staff", "contractor"]) {
            expect(canEditPhoto(client, { userId: "us_me", role })).toBe(true);
        }
    });

    it("lets a member change their own photo and a manager change anyone's", () => {
        expect(canEditPhoto(self, { userId: "us_me", role: "staff" })).toBe(true);
        expect(canEditPhoto(colleague, { userId: "us_me", role: "staff" })).toBe(false);
        expect(canEditPhoto(colleague, { userId: "us_me", role: "contractor" })).toBe(false);
        expect(canEditPhoto(colleague, { userId: "us_me", role: "admin" })).toBe(true);
        expect(canEditPhoto(colleague, { userId: "us_me", role: "owner" })).toBe(true);
    });

    it("lets nobody edit before the viewer's membership is known", () => {
        expect(canEditPhoto(client, { userId: "us_me", role: null })).toBe(false);
        expect(canEditPhoto(self, { userId: "us_me", role: null })).toBe(false);
    });
});

describe("personMedia", () => {
    it("carries a photo when there is one", () => {
        expect(personMedia("Dana Lee", "#336699", "https://files.test/a")).toEqual({
            kind: "person",
            name: "Dana Lee",
            color: "#336699",
            src: "https://files.test/a",
        });
        expect(personMedia("Dana Lee").src).toBeNull();
    });
});
