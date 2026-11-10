// @vitest-environment happy-dom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatTimeRange, weekdayDay } from "../datetime";
import { strings } from "../strings";
import { type createPublicOrderClient, usePublicOrder } from "./publicOrder";

type Client = ReturnType<typeof createPublicOrderClient>;
type Order = Awaited<ReturnType<Client["get"]>>;

const base: Order = {
    pickup_from: null,
    pickup_to: null,
    address: null,
    phone: null,
    number: 22,
    business_name: "Birchbark Pet Studio",
    brand: { logo_url: null, primary: null, tagline: null },
    status: "paid",
    pickup_status: "unfulfilled",
    created_at: "2026-10-13T16:00:00Z",
    preparing_at: null,
    ready_at: null,
    picked_up_at: null,
    notify_sms: true,
    refund_pending: false,
    refund_cents: 0,
    can_cancel: true,
    receipt_token: "rcpt",
    currency: "CAD",
    timezone: "America/Vancouver",
    subtotal_cents: 5300,
    tax_total_cents: 636,
    total_cents: 5936,
    lines: [],
    taxes: [],
};

async function page(order: Partial<Order>) {
    const data = { ...base, ...order };
    const client: Client = {
        get: vi.fn().mockResolvedValue(data),
        alerts: vi.fn().mockResolvedValue(data),
        cancel: vi.fn().mockResolvedValue(data),
    };
    const { result } = renderHook(() => usePublicOrder(client, "tok"));
    await waitFor(() => {
        expect(result.current.order).not.toBeNull();
    });
    return result.current;
}

describe("the client's order page", () => {
    afterEach(() => {
        cleanup();
    });
    const s = strings.publicOrder;

    it("tells a client what is happening at each step", async () => {
        expect((await page({ status: "open", pickup_status: null })).lead).toBe(s.awaitingBody);
        expect((await page({})).lead).toBe(s.pending);
        const ready = await page({ pickup_status: "ready" });
        expect(ready.lead).toBe(s.readyBody("Birchbark Pet Studio"));
        expect(ready.showAlerts).toBe(true);
    });

    it("marks every step done once the order is collected and drops the texts toggle", async () => {
        const collected = await page({ pickup_status: "picked_up" });
        expect(collected.title).toBe(s.collected);
        expect(collected.lead).toBe(s.collectedBody);
        expect(collected.steps.map((step) => step.state)).toEqual(["done", "done", "done", "done"]);
        expect(collected.showAlerts).toBe(false);
    });

    it("shows a canceled order as refunded, without progress, pickup or texts", async () => {
        const refunded = await page({
            status: "refunded",
            pickup_status: null,
            refund_cents: 5936,
        });
        expect([refunded.title, refunded.lead]).toEqual([s.canceled, s.refundedBody("$59.36")]);
        expect([refunded.canceled, refunded.showAlerts, refunded.refundNote]).toEqual([
            true,
            false,
            null,
        ]);
        const pending = await page({ refund_pending: true, refund_cents: 5936 });
        expect([pending.title, pending.lead]).toEqual([
            s.refundPending,
            s.refundPendingBody("$59.36"),
        ]);
        expect((await page({ status: "void", pickup_status: null })).lead).toBe(s.voidBody);
    });

    it("keeps an order refunded after pickup as collected, with its refund", async () => {
        const later = await page({
            status: "refunded",
            pickup_status: "picked_up",
            refund_cents: 5936,
        });
        expect([later.title, later.lead, later.refundNote, later.canceled]).toEqual([
            s.collected,
            s.collectedBody,
            s.refundedBody("$59.36"),
            false,
        ]);
        expect(later.steps.every((step) => step.state === "done")).toBe(true);
    });

    it("keeps an order with a partial refund going and names only the part refunded", async () => {
        const partial = await page({ refund_pending: true, refund_cents: 500 });
        expect([partial.title, partial.lead, partial.refundNote]).toEqual([
            s.placed,
            s.pending,
            s.refundPendingBody("$5.00"),
        ]);
        expect([partial.canceled, partial.showAlerts]).toEqual([false, true]);
        const ready = await page({
            status: "partly_refunded",
            pickup_status: "ready",
            refund_cents: 500,
        });
        expect([ready.title, ready.lead, ready.refundNote, ready.canceled]).toEqual([
            s.ready,
            s.readyBody("Birchbark Pet Studio"),
            s.refundedBody("$5.00"),
            false,
        ]);
    });

    it("shows the whole pickup window the client chose", async () => {
        const from = "2026-10-15T16:00:00Z";
        const to = "2026-10-15T17:00:00Z";
        const zone = "America/Vancouver";
        const chosen = await page({ pickup_from: from, pickup_to: to });
        expect(chosen.pickupLabel).toBe(
            strings.common.dayAndTime(
                weekdayDay(new Date(from), zone),
                formatTimeRange(new Date(from), new Date(to), zone),
            ),
        );
        expect((await page({})).pickupLabel).toBe(strings.publicShop.pickupAsap);
    });
});
