// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { BusinessZoneContext, formatDate, formatMonthDay, readDate } from "../datetime";
import { BUSINESS_CURRENCY, formatMoney, formatParts } from "../format";
import { strings } from "../strings";
import {
    WALLET_CLIENT_SQL,
    WALLET_HOLDERS_SQL,
    WALLET_SQL,
    useEntitlementDetail,
    useEntitlementWallet,
} from "./entitlements";

const ZONE = "America/Vancouver";
const END = "2026-12-19T17:00:00Z";
const ENDED = "2026-11-02T18:30:00Z";
const w = strings.entitlements;

const membership = (id: string, status: string, endsAt: string | null, paid: number | null) => ({
    kind: "membership",
    id,
    client_id: "cl_1",
    item_name: `Plan ${id}`,
    status,
    sessions_total: null,
    sessions_used: null,
    expires_at: endsAt,
    code: null,
    recipient: null,
    price_cents: 3000,
    balance_cents: null,
    period_end: END,
    method_brand: "visa",
    method_last4: "4242",
    payment_id: null,
    paid_cents: paid,
    created_at: "2026-10-19T17:00:00Z",
    subject_name: null,
    deferred_paid_cents: null,
    lapsed: 0,
});

// the member joined at $25 plus tax, so the card is charged $26.25 though the item now says $30
const ROWS = [
    membership("renewing", "active", null, 2625),
    membership("ending", "active", END, 2625),
    membership("ended", "canceled", ENDED, 2625),
    membership("behind", "past_due", null, 2625),
    membership("paused", "paused", null, 2625),
    membership("unbilled", "active", null, null),
];

vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: (sql: string) => ({
        data:
            sql === WALLET_SQL
                ? ROWS
                : sql === WALLET_HOLDERS_SQL
                  ? [{ id: "cl_1", name: "Ann" }]
                  : sql === WALLET_CLIENT_SQL
                    ? [{ id: "cl_1", name: "Ann", phone: null }]
                    : [],
        isLoading: false,
        error: null,
    }),
}));

vi.mock("./sync", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./sync")>()),
    useReplicaLoad: () => ({ state: "ready", hasData: true, retry: () => undefined }),
}));

const api = {} as ApiLike;
const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(BusinessZoneContext.Provider, { value: ZONE }, children);

function wallet() {
    return renderHook(() => useEntitlementWallet("cl_1"), { wrapper }).result.current;
}

function detail(id: string) {
    const summary = wallet().summaries.find((x) => x.row.id === id) ?? null;
    return renderHook(() => useEntitlementDetail(api, summary, () => undefined), { wrapper }).result
        .current;
}

const monthDay = (iso: string): string => formatMonthDay(readDate(iso, ZONE), ZONE);
const day = (iso: string): string => formatDate(readDate(iso, ZONE), ZONE);

describe("a membership in the Plans list and its panel", () => {
    it("says when it renews or ends, that it ended, that its payment failed, or nothing while paused", () => {
        const labels = Object.fromEntries(
            wallet().summaries.map((x) => [x.row.id, x.balanceLabel]),
        );
        expect(labels).toEqual({
            renewing: w.renews(monthDay(END)),
            ending: w.ends(monthDay(END)),
            ended: w.ended(monthDay(ENDED)),
            behind: w.retrying,
            paused: "",
            unbilled: w.renews(monthDay(END)),
        });
    });

    it("values a membership at what its card is charged, and at the price before a renewal", () => {
        const values = Object.fromEntries(wallet().summaries.map((x) => [x.row.id, x.valueCents]));
        expect(values).toEqual({
            renewing: 2625,
            ending: 2625,
            ended: 2625,
            behind: 2625,
            paused: 2625,
            unbilled: 3000,
        });
        expect(wallet().totals.monthlyCents).toBe(2625 * 3 + 3000);
    });

    it("names the next charge at what the card is charged, not the item's price today", () => {
        expect(detail("renewing")?.facts).toContainEqual({
            label: w.factNextCharge,
            value: formatParts([day(END), formatMoney(2625, BUSINESS_CURRENCY)]),
        });
    });

    it("says when an ending or ended membership stops instead of a next charge", () => {
        const facts = (id: string) => detail(id)?.facts.map((f) => f.label) ?? [];
        expect(detail("ending")?.facts).toContainEqual({ label: w.factEnds, value: day(END) });
        expect(detail("ended")?.facts).toContainEqual({ label: w.factEnded, value: day(ENDED) });
        for (const id of ["ending", "ended", "behind", "paused"])
            expect(facts(id)).not.toContain(w.factNextCharge);
    });
});
