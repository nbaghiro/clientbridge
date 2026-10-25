// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, createElement } from "react";
import { expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { BusinessZoneContext } from "../datetime";
import { docDraft, useDocComposer } from "./billing";

vi.mock("./taxes", async (original) => ({
    ...(await original<typeof import("./taxes")>()),
    useTaxSetup: () => ({ province: "BC", rates: [], registered: false }),
}));

type DraftRow = Parameters<typeof docDraft>[0];
type DraftLineRow = Parameters<typeof docDraft>[1][number];

const row = {
    id: "inv_visit",
    number: null,
    client_id: "cl_1",
    notes: null,
    discount_kind: null,
    discount_value: null,
    discount_reason: null,
} as DraftRow;

const visitLine = (extra: Partial<DraftLineRow>): DraftLineRow => ({
    id: "ln_visit",
    item_id: "it_groom",
    booking_id: "bk_1",
    staff_id: null,
    description: "Full groom",
    quantity: 1,
    unit_amount_cents: 9000,
    amount_cents: 9000,
    tax_amount_cents: 0,
    tax_class: "standard",
    optional: null,
    selected: null,
    position: 0,
    ...extra,
});

it("keeps a visit's booking and staff on its lines when only the message is edited", async () => {
    const patches: { path: string; body: unknown }[] = [];
    const api: ApiLike = {
        get: <T>() => Promise.resolve({} as T),
        getText: () => Promise.resolve(""),
        post: <T>() => Promise.resolve({ id: "inv_visit" } as T),
        patch: <T>(path: string, body?: unknown) => {
            patches.push({ path, body });
            return Promise.resolve({ id: "inv_visit" } as T);
        },
        delete: <T>() => Promise.resolve({} as T),
    };
    const draft = docDraft(row, [
        visitLine({}),
        visitLine({
            id: "ln_addon",
            item_id: "it_shampoo",
            staff_id: "st_diego",
            description: "Oatmeal shampoo",
            unit_amount_cents: 2400,
            amount_cents: 2400,
            position: 1,
        }),
    ]);
    const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(BusinessZoneContext.Provider, { value: "America/Vancouver" }, children);
    const { result } = renderHook(() => useDocComposer(api, "invoice", draft), { wrapper });
    act(() => {
        result.current.setMessage("See you next month");
    });
    act(() => {
        result.current.saveDraft();
    });
    await waitFor(() => {
        expect(patches).toHaveLength(1);
    });
    expect(patches[0]?.path).toBe("/v1/invoices/inv_visit");
    expect(patches[0]?.body).toMatchObject({
        notes: "See you next month",
        lines: [
            { description: "Full groom", booking_id: "bk_1", staff_id: null },
            { description: "Oatmeal shampoo", booking_id: "bk_1", staff_id: "st_diego" },
        ],
    });
});
