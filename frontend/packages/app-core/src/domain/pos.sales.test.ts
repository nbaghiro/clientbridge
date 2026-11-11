// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { BUSINESS_CURRENCY, formatCredit, formatList } from "../format";
import { strings } from "../strings";
import {
    SALE_GIFT_CARDS_SQL,
    SALE_LINES_SQL,
    SALE_PAYMENTS_SQL,
    SALE_RECORD_SQL,
    SALES_SQL,
    useSaleActions,
    useSaleDetail,
    useSalesHistory,
} from "./pos";

const d = strings.pos.desk;
const at = "2026-10-13T17:00:00Z";

const sale = {
    id: "ord_split",
    number: 4,
    client_id: null,
    client_name: null,
    source: "desk",
    pickup_status: null,
    created_at: at,
    total_cents: 4500,
    staff_id: "st_owner",
    note: null,
    status: "paid",
    tip_cents: 0,
    refunded_cents: 0,
    discount_cents: 0,
    summary: "Groom",
    item_count: 1,
};

const replica: Record<string, unknown[]> = {
    [SALES_SQL]: [
        { ...sale, gift_card_cents: 3000, methods: "cash" },
        { ...sale, id: "ord_gift", number: 5, gift_card_cents: 4500, methods: null },
        { ...sale, id: "ord_two", number: 6, gift_card_cents: 0, methods: "card,cash" },
        { ...sale, id: "ord_open", number: 7, status: "open", gift_card_cents: 0, methods: null },
    ],
    [SALE_RECORD_SQL]: [
        {
            ...sale,
            client_phone: null,
            subtotal_cents: 4500,
            tax_total_cents: 0,
            discount_kind: null,
            discount_value: null,
            discount_reason: null,
            receipt_phone: null,
            receipt_sent_at: null,
        },
    ],
    [SALE_LINES_SQL]: [
        {
            id: "ln_1",
            item_id: null,
            description: "Groom",
            quantity: 1,
            unit_amount_cents: 4500,
            amount_cents: 4500,
            tax_class: "exempt",
            tax_amount_cents: 0,
            staff_id: null,
            booking_id: null,
            discount_kind: null,
            discount_value: null,
            discount_reason: null,
            item_kind: "service",
            item_color: null,
            image_file_id: null,
        },
    ],
    [SALE_PAYMENTS_SQL]: [
        {
            id: "pay_cash",
            kind: "payment",
            method: "cash",
            amount_cents: 1500,
            tip_cents: 0,
            tip_split: null,
            status: "succeeded",
            paid_at: "2026-10-13T17:01:00Z",
            credit_note: null,
            reason: null,
            tendered_cents: 2000,
            parent_payment_id: null,
        },
    ],
    [SALE_GIFT_CARDS_SQL]: [{ id: "j_gift", event: "redemption", cents: 3000, at }],
};

vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: (sql: string) => ({ data: replica[sql] ?? [], isLoading: false }),
}));

vi.mock("../datetime", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../datetime")>()),
    useBusinessZone: () => "America/Vancouver",
}));

vi.mock("./sync", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./sync")>()),
    useReplicaLoad: () => ({ state: "ready", ready: true, hasData: true }),
}));

describe("a sale paid in more than one way", () => {
    it("names every tender in the history, and a gift-card-only sale as paid", () => {
        const { result } = renderHook(() => useSalesHistory());
        const methods = new Map(
            result.current.days.flatMap((day) => day.rows).map((r) => [r.id, r.methodLabel]),
        );
        const method = strings.publicReceipt.method;
        expect(methods.get("ord_split")).toBe(formatList([d.giftCardPaid, method.cash], "unit"));
        expect(methods.get("ord_gift")).toBe(d.giftCardPaid);
        expect(methods.get("ord_two")).toBe(formatList([method.card, method.cash], "unit"));
        expect(methods.get("ord_open")).toBe(d.notPaid);
    });

    it("lists the gift card beside the cash on the record, adding up to the total", () => {
        const { result } = renderHook(() => useSaleDetail("ord_split", "owner"));
        const payments = result.current.detail?.payments ?? [];
        expect(payments.map((p) => [p.label, p.cents])).toEqual([
            [d.giftCardPaid, 3000],
            [strings.publicReceipt.method.cash, 1500],
        ]);
        expect(payments.reduce((n, p) => n + p.cents, 0)).toBe(4500);
    });

    it("shows gift card balance a refund put back as money returned", () => {
        replica[SALE_GIFT_CARDS_SQL] = [
            { id: "j_gift", event: "redemption", cents: 3000, at },
            { id: "j_back", event: "reversal", cents: -3000, at: "2026-10-14T17:00:00Z" },
        ];
        const { result } = renderHook(() => useSaleDetail("ord_split", "owner"));
        const back = result.current.detail?.payments.find((p) => p.id === "j_back");
        expect(back).toMatchObject({
            label: d.giftCardReturned,
            cents: -3000,
            amount: formatCredit(3000, BUSINESS_CURRENCY),
            refund: true,
        });
    });
});

describe("a refund from the sale record", () => {
    it("opens the shared refund for the payment, which offers all or part", () => {
        const { result } = renderHook(() => useSaleDetail("ord_split", "owner"));
        const detail = result.current.detail;
        if (detail === null) throw new Error("the sale is missing");
        expect(detail.actions.map((a) => a.key)).toContain("refund");
        const onRefund = vi.fn();
        const confirm = vi.fn(() => Promise.resolve(true));
        const actions = renderHook(() =>
            useSaleActions({} as ApiLike, confirm, () => undefined, onRefund),
        );
        actions.result.current.run(detail, "refund");
        expect(onRefund).toHaveBeenCalledWith("pay_cash");
        expect(confirm).not.toHaveBeenCalled();
    });
});
