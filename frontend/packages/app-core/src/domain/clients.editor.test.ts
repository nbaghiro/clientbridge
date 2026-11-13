// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { type ReactNode, createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { BusinessZoneContext } from "../datetime";
import { strings } from "../strings";
import {
    CLIENT_CONSENT_SQL,
    type ClientListRow,
    NUMBER_REPLY_SQL,
    useClientEditor,
} from "./clients";

const replica = vi.hoisted(() => {
    const rows: (sql: string, params: readonly unknown[]) => unknown[] = () => [];
    return { rows };
});

vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: (sql: string, params: readonly unknown[] = []) => ({
        data: replica.rows(sql, params),
    }),
}));

afterEach(() => {
    replica.rows = () => [];
});

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
    subjectNames: [],
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

it("keeps what the person typed when the record refreshes, and shows the fields they didn't", () => {
    const { result, rerender } = editor([ann]);
    act(() => {
        result.current.set("name", "Ann T.");
    });
    rerender({ rows: [{ ...ann, phone: "+16045550002", tags: ["VIP"] }] });
    expect(result.current.draft.name).toBe("Ann T.");
    expect(result.current.draft.phone).toBe("(604) 555-0002");
    expect(result.current.draft.tags).toEqual(["VIP"]);
});

it("saves only the fields edited, so a stale form can't undo another device's rename", async () => {
    const patch = vi.fn((_path: string, body: Record<string, unknown>) =>
        Promise.resolve({ name: "Ann Smith", phone: "+16045550001", tags: [], ...body }),
    );
    const { result, rerender } = renderHook(
        ({ rows }: { rows: readonly ClientListRow[] }) =>
            useClientEditor({ ...api, patch } as ApiLike, rows, "cl_ann", () => undefined),
        { wrapper, initialProps: { rows: [ann] as readonly ClientListRow[] } },
    );
    act(() => {
        result.current.set("tags", ["VIP"]);
    });
    rerender({ rows: [{ ...ann, name: "Ann Smith" }] });
    expect(result.current.draft.name).toBe("Ann Smith");
    await act(async () => {
        result.current.submit();
        await Promise.resolve();
    });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0]?.[1]).toEqual({ tags: ["VIP"] });
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

it("locks consent while the number as typed replied STOP, and a tap there never comes back as a yes", async () => {
    replica.rows = (sql, params) =>
        sql === NUMBER_REPLY_SQL && params[0] === "+16045550001"
            ? [{ status: "withdrawn", created_at: "2026-11-01T17:00:00Z" }]
            : [];
    const patch = vi.fn((_path: string, body: Record<string, unknown>) =>
        Promise.resolve({ name: "Ann Tremblay", phone: "+16045550003", tags: [], ...body }),
    );
    const { result } = renderHook(
        () => useClientEditor({ ...api, patch } as ApiLike, [ann], "cl_ann", () => undefined),
        { wrapper },
    );
    expect(result.current.consentLocked).toBe(true);
    expect(result.current.textsStopped).toBe(strings.clients.record.textsStopped("Nov 1, 2026"));
    act(() => {
        result.current.set("consent", true);
    });
    expect(result.current.draft.consent).toBe(false);
    expect(result.current.dirty).toBe(false);
    act(() => {
        result.current.set("phone", "604 555 0003");
    });
    expect(result.current.consentLocked).toBe(false);
    expect(result.current.textsStopped).toBeNull();
    expect(result.current.draft.consent).toBe(false);
    await act(async () => {
        result.current.submit();
        await Promise.resolve();
    });
    expect(patch.mock.calls[0]?.[1]).toEqual({ phone: "+16045550003" });
});

it.each([
    [
        { status: "granted", source: "reply", recorded_by_name: null, expires_at: null },
        true,
        () => strings.clients.edit.consentAgreedBy("reply", "Nov 1, 2026"),
    ],
    [
        {
            status: "withdrawn",
            source: "in_person",
            recorded_by_name: "Hannah Wong",
            expires_at: null,
        },
        false,
        () => strings.clients.edit.consentDeclined("Nov 1, 2026", "Hannah Wong"),
    ],
    [
        { status: "withdrawn", source: "reply", recorded_by_name: null, expires_at: null },
        false,
        () => strings.clients.edit.consentDeclinedBy("reply", "Nov 1, 2026"),
    ],
    [
        {
            status: "implied",
            source: "online_booking",
            recorded_by_name: null,
            expires_at: "2027-04-10T17:00:00Z",
        },
        true,
        () => strings.clients.edit.consentImplied("Apr 10, 2027"),
    ],
    [
        {
            status: "implied",
            source: "online_booking",
            recorded_by_name: null,
            expires_at: "2026-10-01T17:00:00Z",
        },
        false,
        () => null,
    ],
])("says how the newest consent came about (%o)", (row, agreed, note) => {
    replica.rows = (sql) =>
        sql === CLIENT_CONSENT_SQL ? [{ ...row, created_at: "2026-11-01T17:00:00Z" }] : [];
    const { result } = editor([ann]);
    expect(result.current.draft.consent).toBe(agreed);
    expect(result.current.consentNote).toBe(note());
});

it("records a no for a client who only has implied consent, since offers still go to them", async () => {
    replica.rows = (sql) =>
        sql === CLIENT_CONSENT_SQL
            ? [
                  {
                      status: "implied",
                      source: "online_booking",
                      recorded_by_name: null,
                      expires_at: "2027-04-10T17:00:00Z",
                      created_at: "2026-11-01T17:00:00Z",
                  },
              ]
            : [];
    const patch = vi.fn((_path: string, body: Record<string, unknown>) =>
        Promise.resolve({ name: "Ann Tremblay", phone: "+16045550001", tags: [], ...body }),
    );
    const { result } = renderHook(
        () => useClientEditor({ ...api, patch } as ApiLike, [ann], "cl_ann", () => undefined),
        { wrapper },
    );
    expect(result.current.draft.consent).toBe(true);
    act(() => {
        result.current.set("consent", false);
    });
    expect(result.current.dirty).toBe(true);
    await act(async () => {
        result.current.submit();
        await Promise.resolve();
    });
    expect(patch.mock.calls[0]?.[1]).toEqual({ marketing_consent: false });
});

it("shows a stopped number's toggle off even over an earlier yes", () => {
    replica.rows = (sql) =>
        sql === NUMBER_REPLY_SQL
            ? [{ status: "withdrawn", created_at: "2026-11-01T17:00:00Z" }]
            : sql === CLIENT_CONSENT_SQL
              ? [
                    {
                        status: "granted",
                        source: "in_person",
                        recorded_by_name: "Hannah Wong",
                        expires_at: null,
                        created_at: "2026-10-01T17:00:00Z",
                    },
                ]
              : [];
    const { result } = editor([ann]);
    expect(result.current.consentLocked).toBe(true);
    expect(result.current.draft.consent).toBe(false);
    expect(result.current.dirty).toBe(false);
});

it("drops a choice made before a STOP landed once the START lifts it", () => {
    const consent = (source: string, at: string) => ({
        status: "granted",
        source,
        recorded_by_name: null,
        expires_at: null,
        created_at: at,
    });
    replica.rows = (sql) =>
        sql === CLIENT_CONSENT_SQL ? [consent("in_person", "2026-10-01T17:00:00Z")] : [];
    const { result, rerender } = editor([ann]);
    act(() => {
        result.current.set("consent", false);
    });
    expect(result.current.dirty).toBe(true);
    replica.rows = (sql) =>
        sql === NUMBER_REPLY_SQL
            ? [{ status: "withdrawn", created_at: "2026-11-01T17:00:00Z" }]
            : [];
    rerender({ rows: [ann] });
    expect(result.current.consentLocked).toBe(true);
    replica.rows = (sql) =>
        sql === NUMBER_REPLY_SQL
            ? [{ status: "granted", created_at: "2026-11-02T17:00:00Z" }]
            : sql === CLIENT_CONSENT_SQL
              ? [consent("reply", "2026-11-02T17:00:00Z")]
              : [];
    rerender({ rows: [ann] });
    expect(result.current.consentLocked).toBe(false);
    expect(result.current.draft.consent).toBe(true);
    expect(result.current.dirty).toBe(false);
});
