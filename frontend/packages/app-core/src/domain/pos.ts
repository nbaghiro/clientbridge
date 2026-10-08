import { useQuery } from "@powersync/react";
import { useCallback, useMemo, useRef, useState } from "react";

import { daysUntil, parseTimestamp, relativeDay, relativeDayTime } from "../datetime";
import { formatMoney, formatPhone, parseCents, phoneDigits } from "../format";
import { type Load, useAsyncAction, useLoad, useRemote } from "../hooks";
import { strings } from "../strings";
import { type ApiLike, newIdempotencyKey } from "../api";
import type { ConfirmOptions, DocTotalLine, Intent, PrintedDocTax } from "../ui";
import {
    type DiscountKind,
    type SaleDiscount,
    allocate,
    discountCents,
    docRates,
    priceDoc,
} from "./billing";
import { utcSql } from "./bookings";
import { type ItemRow, ITEMS_SQL, sellableItems, stockState } from "./catalog";
import { type Checkout, NEW_CARD, useCheckout } from "./checkout";
import { orderStatusSql } from "./ledger";
import { canManagePayments, creditNoteNumber, type SavedCardRow, savedCardLabel } from "./payments";
import { staffName } from "./staff";
import { useReplicaLoad } from "./sync";
import { type TaxRate, useTaxSetup } from "./taxes";

interface CheckoutResult {
    order_id: string;
    client_secret: string;
    payment_id: string;
}

function requestConnectionToken(api: ApiLike): Promise<string> {
    return api.post<{ secret: string }>("/v1/terminal/connection-token", {}).then((r) => r.secret);
}

export function useConnectionToken(api: ApiLike): () => Promise<string> {
    return useCallback(() => requestConnectionToken(api), [api]);
}

// A paid online order moves unfulfilled -> ready -> picked_up; cancelling is a refund, not a status.
type PickupStatus = "unfulfilled" | "preparing" | "ready" | "picked_up";

const PICKUP_FLOW: PickupStatus[] = ["unfulfilled", "preparing", "ready", "picked_up"];

const STATUS: Record<PickupStatus, { label: string; intent: Intent; empty: string }> = {
    unfulfilled: {
        label: strings.pos.pickup.toPack,
        intent: "warning",
        empty: strings.pos.pickup.emptyToPack,
    },
    preparing: {
        label: strings.publicOrder.preparing,
        intent: "accent",
        empty: strings.publicOrder.emptyPreparing,
    },
    ready: {
        label: strings.pos.pickup.ready,
        intent: "accent",
        empty: strings.pos.pickup.emptyReady,
    },
    picked_up: {
        label: strings.pos.pickup.pickedUp,
        intent: "success",
        empty: strings.pos.pickup.emptyPickedUp,
    },
};

export function nextPickupStatus(s: PickupStatus): PickupStatus | null {
    return s === "unfulfilled"
        ? "preparing"
        : s === "preparing"
          ? "ready"
          : s === "ready"
            ? "picked_up"
            : null;
}

/** The client is told when an order is ready; nothing is sent when it is picked up. */
function setPickupStatus(
    api: ApiLike,
    orderId: string,
    status: Exclude<PickupStatus, "unfulfilled">,
): Promise<unknown> {
    return api.post(`/v1/orders/${orderId}/pickup`, { status });
}

export const PICKUP_ORDERS_SQL = `
SELECT o.id, o.number, o.client_id, c.name AS client_name, c.phone, c.email, o.pickup_status,
       o.total_cents, o.created_at, o.ready_at, o.picked_up_at, o.pickup_from, o.pickup_to, o.note, o.notify_sms
FROM orders o LEFT JOIN clients c ON c.id = o.client_id
WHERE o.source = 'online' AND o.pickup_status IS NOT NULL
ORDER BY o.created_at DESC`;

export const PICKUP_LINES_SQL = `
SELECT l.id, l.order_id, l.item_id, l.description, l.quantity, l.unit_amount_cents,
       i.color AS item_color
FROM lines l JOIN orders o ON o.id = l.order_id LEFT JOIN items i ON i.id = l.item_id
WHERE o.source = 'online' AND o.pickup_status IS NOT NULL
ORDER BY l.order_id, l.position`;

interface PickupRow {
    pickup_from?: string | null;
    pickup_to?: string | null;
    note?: string | null;
    notify_sms?: number;
    id: string;
    number?: number | null;
    client_id: string | null;
    client_name: string | null;
    phone: string | null;
    email: string | null;
    pickup_status: PickupStatus;
    total_cents: number | null;
    created_at: string;
    ready_at: string | null;
    picked_up_at: string | null;
}

interface PickupLineRow {
    id: string;
    order_id: string;
    item_id: string | null;
    description: string;
    quantity: number;
    unit_amount_cents: number;
    item_color: string | null;
}

interface PickupLine {
    id: string;
    itemId: string | null;
    name: string;
    quantity: number;
    unitCents: number;
    color: string | null;
}

interface PickupOrder {
    note: string | null;
    id: string;
    number: string;
    clientId: string | null;
    clientName: string;
    status: PickupStatus;
    statusLabel: string;
    intent: Intent;
    lines: PickupLine[];
    itemsLabel: string;
    total: string;
    contact: string;
    phone: string | null;
    email: string | null;
    // Placed, ready since or picked up at, whichever is latest.
    when: string;
    waiting: string;
}

export function pickupOrder(row: PickupRow, lines: PickupLineRow[], now: Date): PickupOrder {
    const status = row.pickup_status;
    const p = strings.pos.pickup;
    const since = parseTimestamp(
        status === "ready" && row.ready_at !== null ? row.ready_at : row.created_at,
    );
    const mine = lines.filter((l) => l.order_id === row.id);
    return {
        id: row.id,
        number: row.number == null ? "" : `S-${String(row.number)}`,
        clientId: row.client_id,
        clientName: row.client_name ?? p.guest,
        status,
        note:
            [
                row.pickup_from
                    ? `${strings.publicShop.pickupWindow}: ${relativeDayTime(parseTimestamp(row.pickup_from), now)}`
                    : null,
                row.note,
            ]
                .filter(Boolean)
                .join(" · ") || null,
        statusLabel: STATUS[status].label,
        intent: STATUS[status].intent,
        lines: mine.map((l) => ({
            id: l.id,
            itemId: l.item_id,
            name: l.description,
            quantity: l.quantity,
            unitCents: l.unit_amount_cents,
            color: l.item_color,
        })),
        itemsLabel: p.items(mine.reduce((n, l) => n + l.quantity, 0)),
        total: row.total_cents === null ? "" : formatMoney(row.total_cents),
        contact: [row.phone === null ? null : formatPhone(row.phone), row.email]
            .filter((v) => v !== null && v !== "")
            .join(" · "),
        phone: row.phone,
        email: row.email,
        when:
            status === "picked_up" && row.picked_up_at !== null
                ? p.pickedAt(relativeDayTime(parseTimestamp(row.picked_up_at), now))
                : status === "ready" && row.ready_at !== null
                  ? p.readySince(relativeDayTime(parseTimestamp(row.ready_at), now))
                  : p.placed(relativeDayTime(parseTimestamp(row.created_at), now)),
        waiting: p.waiting(Math.max(0, -daysUntil(since, now))),
    };
}

interface PickupQueue {
    load: Load;
    q: string;
    setQ: (q: string) => void;
    status: PickupStatus;
    setStatus: (s: PickupStatus) => void;
    all: PickupOrder[];
    segments: { key: PickupStatus; label: string; count: number }[];
    columns: {
        key: PickupStatus;
        label: string;
        intent: Intent;
        orders: PickupOrder[];
        empty: string;
    }[];
    list: PickupOrder[];
    selected: PickupOrder | null;
    select: (id: string | null) => void;
    advance: (id: string) => void;
    // A step the server allows from here, e.g. straight to picked up from to pack.
    move: (id: string, status: PickupStatus) => void;
    busyId: string | null;
    error: string | null;
}

/** The shared pickup queue: to pack, ready and picked up, worked from the front desk board. */
function usePickupOrders(api: ApiLike): PickupQueue {
    const [now] = useState(() => new Date());
    const orders = useQuery<PickupRow>(PICKUP_ORDERS_SQL);
    const lines = useQuery<PickupLineRow>(PICKUP_LINES_SQL);
    const [q, setQ] = useState("");
    const [status, setStatus] = useState<PickupStatus>("unfulfilled");
    const [selectedId, select] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const { error, run } = useAsyncAction();
    const all = useMemo(
        () => orders.data.map((o) => pickupOrder(o, lines.data, now)),
        [orders.data, lines.data, now],
    );
    const t = q.trim().toLowerCase();
    const match = (o: PickupOrder): boolean =>
        t === "" ||
        [o.clientName, ...o.lines.map((l) => l.name)].some((v) => v.toLowerCase().includes(t));
    const load = useReplicaLoad([orders, lines], all.length === 0);
    const move = (id: string, to: PickupStatus): void => {
        if (to === "unfulfilled") return;
        setBusyId(id);
        run(() => setPickupStatus(api, id, to), {
            onSuccess: () => {
                setBusyId(null);
            },
            errorMessage: strings.pos.pickup.error,
        });
    };
    return {
        load,
        q,
        setQ,
        status,
        setStatus,
        all,
        segments: PICKUP_FLOW.map((k) => ({
            key: k,
            label: STATUS[k].label,
            count: all.filter((o) => o.status === k).length,
        })),
        columns: PICKUP_FLOW.map((k) => ({
            key: k,
            label: STATUS[k].label,
            intent: STATUS[k].intent,
            orders: all.filter((o) => o.status === k && match(o)),
            empty: STATUS[k].empty,
        })),
        list: all.filter((o) => o.status === status && match(o)),
        selected: all.find((o) => o.id === selectedId) ?? null,
        select,
        advance: (id) => {
            const order = all.find((o) => o.id === id);
            const next = order === undefined ? null : nextPickupStatus(order.status);
            if (next !== null) move(id, next);
        },
        move,
        busyId: error === null ? busyId : null,
        error,
    };
}

const d = strings.pos.desk;

type TipChoice =
    { kind: "none" } | { kind: "percent"; pct: number } | { kind: "custom"; cents: number };

export interface SaleLine {
    key: string;
    itemId: string | null;
    kind: string;
    description: string;
    unitAmountCents: number;
    quantity: number;
    taxClass: string;
    staffId: string | null;
    bookingId: string | null;
    color: string | null;
    imageFileId: string | null;
    discount: SaleDiscount | null;
}

interface SalePricedLine extends SaleLine {
    grossCents: number;
    lineDiscountCents: number;
    saleDiscountShareCents: number;
    netCents: number;
    taxCents: number;
}

interface SaleTotals {
    grossCents: number;
    lineDiscountCents: number;
    saleDiscountCents: number;
    discountCents: number;
    subtotalCents: number;
    taxes: PrintedDocTax[];
    taxCents: number;
    tipCents: number;
    totalCents: number;
    depositCents: number;
    dueCents: number;
}

interface PricedSale {
    lines: SalePricedLine[];
    totals: SaleTotals;
}

const TIP_PRESETS = [15, 18, 20] as const;

export function discountLabel(discount: SaleDiscount): string {
    return discount.kind === "percent" ? `${String(discount.value)}%` : formatMoney(discount.value);
}

/** A tip is worked out on the price before tax and never carries tax. */
export function tipCentsFor(tip: TipChoice, subtotalCents: number): number {
    if (tip.kind === "percent") return Math.round((subtotalCents * tip.pct) / 100);
    if (tip.kind === "custom") return Math.max(0, tip.cents);
    return 0;
}

/** Line discounts, then the sale discount shared by value, then tax per line on the net, as the server does. */
export function priceSale(
    lines: readonly SaleLine[],
    saleDiscount: SaleDiscount | null,
    rates: readonly TaxRate[] | null,
    registered: boolean,
    tip: TipChoice,
    depositCents = 0,
): PricedSale {
    const gross = lines.map((l) => Math.round(l.unitAmountCents * l.quantity));
    const lineOff = lines.map((l, i) => discountCents(gross[i] ?? 0, l.discount));
    const bases = gross.map((g, i) => g - (lineOff[i] ?? 0));
    const saleOff = discountCents(
        bases.reduce((a, b) => a + b, 0),
        saleDiscount,
    );
    const shares = allocate(saleOff, bases);
    const net = bases.map((b, i) => b - (shares[i] ?? 0));
    const doc = priceDoc(
        lines.map((l, i) => ({
            amountCents: net[i] ?? 0,
            taxClass: asSaleTaxClass(l.taxClass),
            included: true,
        })),
        docRates(rates, registered),
    );
    const priced = lines.map((l, i) => ({
        ...l,
        grossCents: gross[i] ?? 0,
        lineDiscountCents: lineOff[i] ?? 0,
        saleDiscountShareCents: shares[i] ?? 0,
        netCents: net[i] ?? 0,
        taxCents: doc.lines[i]?.taxCents ?? 0,
    }));
    const lineDiscountCents = lineOff.reduce((a, b) => a + b, 0);
    const tipCents = tipCentsFor(tip, doc.subtotalCents);
    const totalCents = doc.totalCents + tipCents;
    const deposit = Math.min(depositCents, doc.totalCents);
    return {
        lines: priced,
        totals: {
            grossCents: gross.reduce((a, b) => a + b, 0),
            lineDiscountCents,
            saleDiscountCents: saleOff,
            discountCents: lineDiscountCents + saleOff,
            subtotalCents: doc.subtotalCents,
            taxes: doc.taxes,
            taxCents: doc.taxCents,
            tipCents,
            totalCents,
            depositCents: deposit,
            dueCents: Math.max(0, totalCents - deposit),
        },
    };
}

function asSaleTaxClass(value: string): "standard" | "federal_only" | "exempt" {
    return value === "federal_only" || value === "exempt" ? value : "standard";
}

/** The DocTotals rows for a sale, top to bottom; discounts and the deposit print as credits. */
export function saleTotalLines(
    t: SaleTotals,
    opts: { saleDiscountReason?: string | null; showTip?: boolean } = {},
): DocTotalLine[] {
    const rows: DocTotalLine[] = [];
    if (t.discountCents > 0) {
        rows.push({ key: "gross", label: d.itemsTotal, cents: t.grossCents, kind: "subtotal" });
        if (t.lineDiscountCents > 0)
            rows.push({
                key: "lineDisc",
                label: d.lineDiscounts,
                cents: t.lineDiscountCents,
                kind: "credit",
            });
        if (t.saleDiscountCents > 0)
            rows.push({
                key: "saleDisc",
                label: d.saleDiscount,
                cents: t.saleDiscountCents,
                kind: "credit",
                hint: opts.saleDiscountReason ?? undefined,
            });
    }
    rows.push({ key: "subtotal", label: d.subtotal, cents: t.subtotalCents, kind: "subtotal" });
    for (const tax of t.taxes)
        rows.push({ key: tax.code, label: tax.label, cents: tax.cents, kind: "tax" });
    if (opts.showTip === true || t.tipCents > 0)
        rows.push({
            key: "tip",
            label: d.tip,
            cents: t.tipCents,
            kind: "subtotal",
            hint: d.tipNoTax,
        });
    rows.push({
        key: "total",
        label: d.total,
        cents: t.totalCents,
        kind: t.depositCents > 0 ? "total" : "balance",
    });
    if (t.depositCents > 0) {
        rows.push({ key: "deposit", label: d.depositPaid, cents: t.depositCents, kind: "credit" });
        rows.push({ key: "due", label: d.dueNow, cents: t.dueCents, kind: "balance" });
    }
    return rows;
}

interface DiscountPreview {
    before: SaleTotals;
    after: SaleTotals;
    offCents: number;
    taxChangeCents: number;
    overLimit: boolean;
}

/** What a discount would do before it's applied: on the whole sale, or on the chosen lines. */
export function previewDiscount(
    lines: readonly SaleLine[],
    saleDiscount: SaleDiscount | null,
    rates: readonly TaxRate[] | null,
    registered: boolean,
    change: { scope: "sale" | "lines"; lineKeys: readonly string[]; discount: SaleDiscount | null },
    limitBps: number | null,
): DiscountPreview {
    const before = priceSale(lines, saleDiscount, rates, registered, { kind: "none" }).totals;
    const next = lines.map((l) =>
        change.scope === "lines" && change.lineKeys.includes(l.key)
            ? { ...l, discount: change.discount }
            : l,
    );
    const after = priceSale(
        next,
        change.scope === "sale" ? change.discount : saleDiscount,
        rates,
        registered,
        { kind: "none" },
    ).totals;
    return {
        before,
        after,
        offCents: after.discountCents - before.discountCents,
        taxChangeCents: after.taxCents - before.taxCents,
        overLimit: overStaffLimit(after, limitBps),
    };
}

/** Staff may take off up to the business's limit; `null` means the viewer needs no approval. */
export function overStaffLimit(t: SaleTotals, limitBps: number | null): boolean {
    return limitBps !== null && t.discountCents * 10000 > t.grossCents * limitBps;
}

export const DISCOUNT_LIMIT_SQL = "SELECT staff_discount_limit_bps FROM businesses LIMIT 1";

function useDiscountLimit(role: string | null): number | null {
    const row = useQuery<{ staff_discount_limit_bps: number | null }>(DISCOUNT_LIMIT_SQL).data[0];
    if (role === "owner" || role === "admin") return null;
    return row?.staff_discount_limit_bps ?? 1500;
}

export interface DiscountEditor {
    kind: DiscountKind;
    setKind: (k: DiscountKind) => void;
    value: string;
    setValue: (v: string) => void;
    reason: string;
    setReason: (r: string) => void;
    reasons: readonly string[];
    draft: SaleDiscount | null;
    previewCents: number;
    error: string | null;
    apply: () => SaleDiscount | null;
}

/** The discount form: percent or amount, a reason, and the cents it takes off `baseCents`. */
export function useDiscountEditor(initial: SaleDiscount | null, baseCents: number): DiscountEditor {
    const [kind, setKindState] = useState<DiscountKind>(initial?.kind ?? "percent");
    const [value, setValueState] = useState(
        initial === null
            ? ""
            : initial.kind === "percent"
              ? String(initial.value)
              : (initial.value / 100).toFixed(2),
    );
    const [reason, setReason] = useState(initial?.reason ?? "");
    const [error, setError] = useState<string | null>(null);
    const n = Number(value.replace(/[$,%\s]/g, ""));
    const draft: SaleDiscount | null =
        value.trim() === "" || !Number.isFinite(n) || n <= 0
            ? null
            : {
                  kind,
                  value: kind === "percent" ? Math.round(n) : Math.round(n * 100),
                  reason: reason.trim() === "" ? null : reason.trim(),
              };
    return {
        kind,
        setKind: (k) => {
            setError(null);
            setKindState(k);
        },
        value,
        setValue: (v) => {
            setError(null);
            setValueState(v);
        },
        reason,
        setReason,
        reasons: d.reasons,
        draft,
        previewCents: discountCents(baseCents, draft),
        error,
        apply: () => {
            const problem =
                draft === null
                    ? d.discountInvalid
                    : draft.kind === "percent" && draft.value > 100
                      ? d.discountPercentMax
                      : draft.kind === "amount" && draft.value > baseCents
                        ? d.discountTooBig(formatMoney(baseCents))
                        : draft.reason === null
                          ? d.discountReasonRequired
                          : null;
            setError(problem);
            return problem === null ? draft : null;
        },
    };
}

type SalePhase = "cart" | "pay" | "paid";
export type SalePayMethod = "tap" | "saved" | "card" | "cash";
type TipSplitMode = "byService" | "one";
export type ReceiptChannel = "email" | "sms" | "none";

interface TipShare {
    staffId: string;
    name: string;
    color: string | null;
    cents: number;
}

interface SaleStaffRow {
    id: string;
    name: string | null;
    title: string | null;
    role: string;
    color: string | null;
}

export const SALE_STAFF_SQL = `
SELECT id, name, title, role, color FROM staff WHERE status = 'active' ORDER BY name COLLATE NOCASE`;

/** Who did each line gets the tip by line value, unless the desk gives it all to one person. */
export function tipShares(
    lines: readonly SalePricedLine[],
    tipCents: number,
    mode: TipSplitMode,
    tipTo: string | null,
    staff: readonly SaleStaffRow[],
): TipShare[] {
    const who = (id: string): SaleStaffRow | undefined => staff.find((s) => s.id === id);
    const share = (id: string, cents: number): TipShare => {
        const row = who(id);
        return {
            staffId: id,
            name: row === undefined ? d.noStaff : staffName(row),
            color: row?.color ?? null,
            cents,
        };
    };
    if (tipCents <= 0) return [];
    const served = lines.filter((l) => l.staffId !== null && l.netCents > 0);
    const ids = [...new Set(served.flatMap((l) => (l.staffId === null ? [] : [l.staffId])))];
    if (mode === "one" && tipTo !== null) return [share(tipTo, tipCents)];
    if (ids.length === 0) return [];
    const parts = allocate(
        tipCents,
        ids.map((id) => served.filter((l) => l.staffId === id).reduce((n, l) => n + l.netCents, 0)),
    );
    return ids.map((id, i) => share(id, parts[i] ?? 0));
}

export interface OrderOut {
    id: string;
    number: number | null;
    client_id: string | null;
    status: string;
    total_cents: number;
    subtotal_cents: number;
    tax_total_cents: number;
    deposit_cents: number;
    due_cents: number;
    discount_cents: number;
    note: string | null;
    created_at?: string;
    discount: SaleDiscount | null;
    lines: {
        id: string;
        description: string;
        quantity: number;
        unit_amount_cents: number;
        item_id: string | null;
        booking_id: string | null;
        tax_class: string;
        staff_id: string | null;
        discount: SaleDiscount | null;
    }[];
}

interface CashResult {
    payment_id: string;
    amount_cents: number;
    tip_cents: number;
    change_cents: number;
}

export function saleNumber(n: number | null): string {
    return n === null ? "" : `S-${String(n)}`;
}

function saleBody(t: {
    clientId: string | null;
    lines: readonly SaleLine[];
    saleDiscount: SaleDiscount | null;
    pin: string | null;
    note?: string | null | undefined;
}): Record<string, unknown> {
    return {
        client_id: t.clientId,
        discount: t.saleDiscount,
        approval_pin: t.pin,
        note: t.note ?? null,
        lines: t.lines.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unit_amount_cents: l.unitAmountCents,
            item_id: l.itemId,
            booking_id: l.bookingId,
            tax_class: asSaleTaxClass(l.taxClass),
            staff_id: l.staffId,
            discount: l.discount,
        })),
    };
}

function saveSale(
    api: ApiLike,
    orderId: string | null,
    body: Record<string, unknown>,
    idempotencyKey: string,
): Promise<OrderOut> {
    return orderId === null
        ? api.post<OrderOut>("/v1/orders", body, { idempotencyKey })
        : api.patch<OrderOut>(`/v1/orders/${orderId}`, body);
}

function tipBody(cents: number, shares: readonly TipShare[]): Record<string, unknown> {
    return {
        tip_cents: cents,
        tip_split:
            cents > 0 && shares.length > 0
                ? shares.map((s) => ({ staff_id: s.staffId, cents: s.cents }))
                : null,
    };
}

interface SaleLineView {
    key: string;
    title: string;
    meta: string;
    tag: { label: string; intent: Intent } | null;
    cents: number;
    originalCents: number | null;
    // Products take a quantity; a booked visit or a service is one.
    quantity: number | null;
    grossCents: number;
}

interface SaleClient {
    id: string;
    name: string;
    detail: string;
    email: string | null;
    phone: string | null;
}

export interface SaleTicket {
    number: string;
    lines: SalePricedLine[];
    views: SaleLineView[];
    client: SaleClient | null;
    savedCardLabel: string | null;
    totals: SaleTotals;
    totalLines: DocTotalLine[];
    ratesReady: boolean;
    isEmpty: boolean;
    itemCount: number;
    clientId: string | null;
    setClientId: (id: string | null) => void;
    addItem: (item: ItemRow) => void;
    addVisit: (visit: CheckoutVisit) => void;
    hasVisit: (bookingId: string) => boolean;
    setQuantity: (key: string, quantity: number) => void;
    removeLine: (key: string) => void;
    setLineStaff: (key: string, staffId: string | null) => void;
    setLineDiscount: (key: string, discount: SaleDiscount | null) => void;
    saleDiscount: SaleDiscount | null;
    setSaleDiscount: (discount: SaleDiscount | null) => void;
    limitBps: number | null;
    overLimit: boolean;
    approvalPin: string | null;
    approve: (pin: string) => void;
    tip: TipChoice;
    setTip: (tip: TipChoice) => void;
    tipKey: string;
    tipOptions: { key: string; label: string; hint: string }[];
    tipShares: TipShare[];
    tipMode: TipSplitMode;
    setTipMode: (m: TipSplitMode) => void;
    tipTo: string | null;
    setTipTo: (staffId: string) => void;
    tipStaff: { key: string; label: string }[];
    phase: SalePhase;
    setPhase: (phase: SalePhase) => void;
    method: SalePayMethod;
    setMethod: (m: SalePayMethod) => void;
    payOptions: { key: SalePayMethod; label: string; hint: string; disabled: boolean }[];
    cashGiven: string;
    setCashGiven: (v: string) => void;
    changeCents: number | null;
    canCharge: boolean;
    // Saves the ticket, then charges: cash at once, a card through `checkout`, Tap to Pay on a reader.
    charge: (m?: SalePayMethod) => void;
    checkout: Checkout;
    terminal: { orderId: string; clientSecret: string } | null;
    markPaid: () => void;
    busy: boolean;
    error: string | null;
    receipt: SaleReceiptForm;
    paidCents: number;
    changeGiven: number | null;
    hold: (note?: string) => void;
    held: string | null;
    resume: (order: OrderOut, items: readonly ItemRow[]) => void;
    newSale: () => void;
    clear: () => void;
}

/** How a ticket line reads: who did it, its discount as a tag, and the price after it. */
function saleLineView(l: SalePricedLine, staff: string | null): SaleLineView {
    const after = l.grossCents - l.lineDiscountCents;
    return {
        key: l.key,
        title: l.description,
        meta: [
            staff === null ? null : d.servedBy(staff),
            l.bookingId === null ? null : d.fromBooking,
            l.kind === "product" || l.quantity === 1
                ? null
                : d.each(formatMoney(l.unitAmountCents)),
        ]
            .filter((v) => v !== null)
            .join(" · "),
        tag:
            l.discount === null
                ? null
                : {
                      label: [discountLabel(l.discount), l.discount.reason]
                          .filter((v) => v !== null && v !== "")
                          .join(" · "),
                      intent: "success",
                  },
        cents: after,
        originalCents: l.lineDiscountCents > 0 ? l.grossCents : null,
        quantity: l.kind === "product" && l.bookingId === null ? l.quantity : null,
        grossCents: l.grossCents,
    };
}

interface SaleReceiptForm {
    email: string;
    setEmail: (v: string) => void;
    phone: string;
    setPhone: (v: string) => void;
    sent: ReceiptChannel | null;
    send: (channel: ReceiptChannel) => void;
    busy: boolean;
    error: string | null;
}

let saleSeq = 0;
const nextKey = (): string => `sl${String((saleSeq += 1))}`;

function lineFromItem(item: ItemRow, extra: Partial<SaleLine> = {}): SaleLine {
    return {
        key: nextKey(),
        itemId: item.id,
        kind: item.kind,
        description: item.name,
        unitAmountCents: item.price_cents ?? 0,
        quantity: 1,
        taxClass: item.tax_class,
        staffId: null,
        bookingId: null,
        color: item.color,
        imageFileId: item.image_file_id,
        discount: null,
        ...extra,
    };
}

const SALE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

interface SaleClientRow {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
}

export const SALE_CLIENT_SQL = "SELECT id, name, email, phone FROM clients WHERE id = ?";
export const SALE_CARDS_SQL = `
SELECT id, client_id, method, brand, last4, preferred, mandate_status, status FROM payment_methods
WHERE client_id = ? AND method = 'card' AND status = 'active' ORDER BY preferred DESC, created_at DESC`;

/** The register: lines, discounts, tip, payment and receipt in one view-model for web and mobile. */
export function useSale(
    api: ApiLike,
    opts: { role: string | null; viewerStaffId?: string | null; platform: "web" | "mobile" },
): SaleTicket {
    const { rates, registered } = useTaxSetup(api);
    const staffRows = useQuery<SaleStaffRow>(SALE_STAFF_SQL).data;
    const limitBps = useDiscountLimit(opts.role);
    const [lines, setLines] = useState<SaleLine[]>([]);
    const [clientId, setClientIdState] = useState<string | null>(null);
    const [saleDiscount, setSaleDiscountState] = useState<SaleDiscount | null>(null);
    const [tip, setTipState] = useState<TipChoice>({ kind: "none" });
    const [deposits, setDeposits] = useState<Record<string, number>>({});
    const [phase, setPhaseState] = useState<SalePhase>("cart");
    const [chosen, setChosen] = useState<SalePayMethod | null>(null);
    const [cashGiven, setCashGivenState] = useState("");
    const [approvalPin, setApprovalPin] = useState<string | null>(null);
    const [tipMode, setTipMode] = useState<TipSplitMode>("byService");
    const [tipToChoice, setTipTo] = useState<string | null>(null);
    const [order, setOrder] = useState<OrderOut | null>(null);
    const [terminal, setTerminal] = useState<{ orderId: string; clientSecret: string } | null>(
        null,
    );
    const [paidCents, setPaidCents] = useState(0);
    const [changeGiven, setChangeGiven] = useState<number | null>(null);
    const [held, setHeld] = useState<string | null>(null);
    const [sent, setSent] = useState<ReceiptChannel | null>(null);
    const client = useQuery<SaleClientRow>(SALE_CLIENT_SQL, [clientId ?? ""]).data[0] ?? null;
    const cards = useQuery<SavedCardRow>(SALE_CARDS_SQL, [clientId ?? ""]).data;
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const keyRef = useRef<string | null>(null);
    const { busy, error, setError, run } = useAsyncAction();
    const receiptAction = useAsyncAction();

    const depositCents = Object.values(deposits).reduce((a, b) => a + b, 0);
    const priced = useMemo(
        () => priceSale(lines, saleDiscount, rates, registered, tip, depositCents),
        [lines, saleDiscount, rates, registered, tip, depositCents],
    );
    const t = priced.totals;
    const saved = cards[0] ?? null;
    const web = opts.platform === "web";
    const method: SalePayMethod = chosen ?? (saved !== null ? "saved" : web ? "card" : "tap");
    const overLimit = overStaffLimit(t, limitBps) && approvalPin === null;
    const cash = parseCents(cashGiven);
    const servedIds = [
        ...new Set(priced.lines.flatMap((l) => (l.staffId === null ? [] : [l.staffId]))),
    ];
    const tipTo = tipToChoice ?? servedIds[0] ?? opts.viewerStaffId ?? null;
    const shares = tipShares(priced.lines, t.tipCents, tipMode, tipTo, staffRows);

    const markPaid = (): void => {
        keyRef.current = null;
        setPhaseState("paid");
    };
    const checkout = useCheckout(markPaid, { defaultMethod: saved?.id ?? NEW_CARD });

    const edit = (fn: (ls: SaleLine[]) => SaleLine[]): void => {
        keyRef.current = null;
        setError(null);
        setApprovalPin(null);
        setLines(fn);
    };

    const reset = (): void => {
        keyRef.current = null;
        setLines([]);
        setClientIdState(null);
        setSaleDiscountState(null);
        setTipState({ kind: "none" });
        setDeposits({});
        setPhaseState("cart");
        setChosen(null);
        setCashGivenState("");
        setApprovalPin(null);
        setTipTo(null);
        setTipMode("byService");
        setOrder(null);
        setTerminal(null);
        setSent(null);
        setEmail("");
        setPhone("");
        setPaidCents(0);
        setChangeGiven(null);
        setError(null);
    };

    const save = async (note?: string | null): Promise<OrderOut> => {
        keyRef.current ??= newIdempotencyKey();
        const out = await saveSale(
            api,
            order?.id ?? null,
            saleBody({ clientId, lines, saleDiscount, pin: approvalPin, note }),
            keyRef.current,
        );
        setOrder(out);
        return out;
    };

    const charge = (m?: SalePayMethod): void => {
        const use = m ?? method;
        if (m !== undefined) setChosen(m);
        if (lines.length === 0) {
            setError(d.addItemFirst);
            return;
        }
        if (overLimit) {
            setError(d.overLimit(String((limitBps ?? 0) / 100)));
            return;
        }
        if (use === "cash" && (cash === null || cash < t.dueCents)) {
            setError(d.cashShort(formatMoney(t.dueCents)));
            return;
        }
        const tipPart = tipBody(t.tipCents, shares);
        run(
            async () => {
                const saved_ = await save();
                const amount = saved_.due_cents + t.tipCents;
                if (use === "cash") {
                    const out = await api.post<CashResult>(
                        `/v1/orders/${saved_.id}/cash`,
                        { ...tipPart, tendered_cents: cash ?? 0 },
                        { idempotencyKey: newIdempotencyKey() },
                    );
                    setPaidCents(out.amount_cents);
                    setChangeGiven(out.change_cents);
                    markPaid();
                    return;
                }
                if (use === "tap") {
                    const out = await api.post<CheckoutResult>(
                        `/v1/orders/${saved_.id}/checkout`,
                        tipPart,
                        { idempotencyKey: newIdempotencyKey() },
                    );
                    setPaidCents(amount);
                    setTerminal({ orderId: saved_.id, clientSecret: out.client_secret });
                    return;
                }
                setPaidCents(amount);
                checkout.pay(
                    ({ paymentMethodId, idempotencyKey }) =>
                        api.post<CheckoutResult>(
                            `/v1/orders/${saved_.id}/pay`,
                            { ...tipPart, payment_method_id: paymentMethodId ?? null },
                            { idempotencyKey },
                        ),
                    d.payError,
                );
            },
            { errorMessage: d.payError },
        );
    };

    const staffOf = (id: string | null): string | null => {
        const row = id === null ? undefined : staffRows.find((r) => r.id === id);
        return row === undefined ? null : staffName(row);
    };
    return {
        number: saleNumber(order?.number ?? null),
        lines: priced.lines,
        views: priced.lines.map((l) => saleLineView(l, staffOf(l.staffId))),
        client:
            client === null
                ? null
                : {
                      id: client.id,
                      name: client.name,
                      detail: formatPhone(client.phone) || (client.email ?? ""),
                      email: client.email,
                      phone: client.phone,
                  },
        savedCardLabel: saved === null ? null : savedCardLabel(saved),
        totals: t,
        totalLines: saleTotalLines(t, { saleDiscountReason: saleDiscount?.reason ?? null }),
        ratesReady: rates !== null,
        isEmpty: lines.length === 0,
        itemCount: lines.reduce((n, l) => n + l.quantity, 0),
        clientId,
        setClientId: (id) => {
            keyRef.current = null;
            setClientIdState(id);
            setChosen(null);
        },
        addItem: (item) => {
            edit((ls) => {
                const same = ls.find(
                    (l) => l.itemId === item.id && l.bookingId === null && l.discount === null,
                );
                if (same !== undefined && item.kind === "product")
                    return ls.map((l) =>
                        l.key === same.key ? { ...l, quantity: l.quantity + 1 } : l,
                    );
                return [...ls, lineFromItem(item, { staffId: null })];
            });
        },
        addVisit: (visit) => {
            if (lines.some((l) => l.bookingId === visit.bookingId)) return;
            edit((ls) => [...ls, visit.line]);
            if (clientId === null) setClientIdState(visit.clientId);
            if (visit.depositCents > 0)
                setDeposits((m) => ({ ...m, [visit.bookingId]: visit.depositCents }));
        },
        hasVisit: (bookingId) => lines.some((l) => l.bookingId === bookingId),
        setQuantity: (key, quantity) => {
            edit((ls) =>
                quantity <= 0
                    ? ls.filter((l) => l.key !== key)
                    : ls.map((l) => (l.key === key ? { ...l, quantity } : l)),
            );
        },
        removeLine: (key) => {
            const gone = lines.find((l) => l.key === key);
            edit((ls) => ls.filter((l) => l.key !== key));
            const bookingId = gone?.bookingId ?? null;
            if (bookingId !== null)
                setDeposits((m) =>
                    Object.fromEntries(Object.entries(m).filter(([k]) => k !== bookingId)),
                );
        },
        setLineStaff: (key, staffId) => {
            edit((ls) => ls.map((l) => (l.key === key ? { ...l, staffId } : l)));
        },
        setLineDiscount: (key, discount) => {
            edit((ls) => ls.map((l) => (l.key === key ? { ...l, discount } : l)));
        },
        saleDiscount,
        setSaleDiscount: (discount) => {
            keyRef.current = null;
            setApprovalPin(null);
            setError(null);
            setSaleDiscountState(discount);
        },
        limitBps,
        overLimit,
        approvalPin,
        approve: (pin) => {
            setError(null);
            setApprovalPin(pin);
        },
        tip,
        setTip: (next) => {
            keyRef.current = null;
            setTipState(next);
        },
        tipKey: tip.kind === "percent" ? String(tip.pct) : tip.kind,
        tipOptions: [
            ...TIP_PRESETS.map((pct) => ({
                key: String(pct),
                label: `${String(pct)}%`,
                hint: formatMoney(tipCentsFor({ kind: "percent", pct }, t.subtotalCents)),
            })),
            {
                key: "custom",
                label: d.tipCustom,
                hint: tip.kind === "custom" ? formatMoney(tip.cents) : d.tipCustomHint,
            },
            { key: "none", label: d.tipNone, hint: formatMoney(0) },
        ],
        tipShares: shares,
        tipMode,
        setTipMode,
        tipTo,
        setTipTo,
        tipStaff: staffRows.map((s) => ({ key: s.id, label: staffName(s) })),
        phase,
        setPhase: (p) => {
            setError(null);
            setPhaseState(p);
        },
        method,
        setMethod: (m) => {
            keyRef.current = null;
            setError(null);
            setChosen(m);
            if (m === "card") checkout.setMethod(NEW_CARD);
            if (m === "saved" && saved !== null) checkout.setMethod(saved.id);
        },
        payOptions: [
            {
                key: "tap",
                label: d.methodTap,
                hint: web ? d.methodTapWebHint : d.methodTapHint,
                disabled: web,
            },
            ...(saved !== null
                ? [
                      {
                          key: "saved" as const,
                          label: savedCardLabel(saved),
                          hint: d.methodSavedHint,
                          disabled: false,
                      },
                  ]
                : []),
            { key: "card", label: d.methodCard, hint: d.methodCardHint, disabled: false },
            { key: "cash", label: d.methodCash, hint: d.methodCashHint, disabled: false },
        ],
        cashGiven,
        setCashGiven: (v) => {
            setError(null);
            setCashGivenState(v);
        },
        changeCents: cash === null ? null : cash - t.dueCents,
        canCharge: lines.length > 0 && !overLimit && rates !== null,
        charge,
        checkout,
        terminal,
        markPaid,
        busy: busy || checkout.busy,
        error: error ?? checkout.error,
        paidCents,
        changeGiven,
        receipt: {
            email: email === "" ? (client?.email ?? "") : email,
            setEmail,
            phone: phone === "" ? formatPhone(client?.phone) : phone,
            setPhone,
            sent,
            send: (channel) => {
                if (channel === "none" || order === null) {
                    setSent("none");
                    return;
                }
                const to =
                    channel === "email"
                        ? email !== ""
                            ? email
                            : (client?.email ?? "")
                        : phone !== ""
                          ? phone
                          : (client?.phone ?? "");
                if (channel === "email" && !SALE_EMAIL.test(to.trim())) {
                    receiptAction.setError(d.receiptEmailInvalid);
                    return;
                }
                if (channel === "sms" && phoneDigits(to).length < 10) {
                    receiptAction.setError(d.receiptPhoneInvalid);
                    return;
                }
                receiptAction.run(
                    () => api.post(`/v1/orders/${order.id}/receipt`, { channel, to: to.trim() }),
                    {
                        onSuccess: () => {
                            setSent(channel);
                        },
                        errorMessage: d.receiptError,
                    },
                );
            },
            busy: receiptAction.busy,
            error: receiptAction.error,
        },
        hold: (note) => {
            if (lines.length === 0) return;
            run(
                async () => {
                    const out = await save(note ?? null);
                    reset();
                    setHeld(d.heldNotice(saleNumber(out.number)));
                },
                { errorMessage: d.holdError },
            );
        },
        held,
        resume: (out, items) => {
            reset();
            setOrder(out);
            setClientIdState(out.client_id);
            setSaleDiscountState(out.discount);
            setLines(
                out.lines.map((l) => {
                    const item = items.find((i) => i.id === l.item_id);
                    return {
                        key: nextKey(),
                        itemId: l.item_id,
                        kind: item?.kind ?? "service",
                        description: l.description,
                        unitAmountCents: l.unit_amount_cents,
                        quantity: l.quantity,
                        taxClass: l.tax_class,
                        staffId: l.staff_id,
                        bookingId: l.booking_id,
                        color: item?.color ?? null,
                        imageFileId: item?.image_file_id ?? null,
                        discount: l.discount,
                    };
                }),
            );
            if (out.deposit_cents > 0) setDeposits({ [out.id]: out.deposit_cents });
            setPhaseState("pay");
        },
        newSale: () => {
            reset();
            setHeld(null);
        },
        clear: () => {
            edit(() => []);
            setDeposits({});
            setSaleDiscountState(null);
        },
    };
}

type VisitState = "paid" | "onTicket" | "ready" | "inProgress" | "upcoming";

export const VISIT_STATE: Record<VisitState, { label: string; intent: Intent }> = {
    paid: { label: d.visitPaid, intent: "success" },
    onTicket: { label: d.onTicket, intent: "accent" },
    ready: { label: d.visitReady, intent: "warning" },
    inProgress: { label: d.visitInProgress, intent: "accent" },
    upcoming: { label: d.visitUpcoming, intent: "neutral" },
};

export const CHECKOUT_QUEUE_SQL = `
SELECT b.id AS booking_id, b.client_id, c.name AS client_name, b.staff_id, st.name AS staff_name,
       st.title AS staff_title, st.role AS staff_role, st.color AS staff_color, s.starts_at, s.ends_at,
       b.price_cents, b.deposit_status, b.deposit_amount_cents, b.order_id, b.charged_at,
       s.item_id, i.name AS item_name, i.kind AS item_kind, i.tax_class, i.color AS item_color,
       i.price_cents AS item_price_cents
FROM bookings b JOIN slots s ON s.id = b.slot_id
LEFT JOIN clients c ON c.id = b.client_id LEFT JOIN items i ON i.id = s.item_id
LEFT JOIN staff st ON st.id = b.staff_id
WHERE b.deleted_at IS NULL AND b.status NOT IN ('canceled', 'no_show')
  AND ${utcSql("s.starts_at")} >= datetime(?) AND ${utcSql("s.starts_at")} < datetime(?)
ORDER BY s.starts_at`;

interface QueueRow {
    booking_id: string;
    client_id: string;
    client_name: string | null;
    staff_id: string | null;
    staff_name: string | null;
    staff_title: string | null;
    staff_role: string | null;
    staff_color: string | null;
    starts_at: string;
    ends_at: string;
    price_cents: number | null;
    deposit_status: string | null;
    deposit_amount_cents: number | null;
    order_id: string | null;
    charged_at: string | null;
    item_id: string | null;
    item_name: string | null;
    item_kind: string | null;
    tax_class: string | null;
    item_color: string | null;
    item_price_cents: number | null;
}

export interface CheckoutVisit {
    bookingId: string;
    clientId: string;
    clientName: string;
    itemName: string;
    priceCents: number;
    staffId: string | null;
    staffName: string;
    staffColor: string | null;
    start: Date;
    end: Date;
    state: VisitState;
    depositCents: number;
    line: SaleLine;
}

function checkoutVisit(row: QueueRow, now: Date): CheckoutVisit {
    const start = parseTimestamp(row.starts_at);
    const end = parseTimestamp(row.ends_at);
    const state: VisitState =
        row.charged_at !== null
            ? "paid"
            : row.order_id !== null
              ? "onTicket"
              : end <= now
                ? "ready"
                : start <= now
                  ? "inProgress"
                  : "upcoming";
    const price = row.price_cents ?? row.item_price_cents ?? 0;
    return {
        bookingId: row.booking_id,
        clientId: row.client_id,
        clientName: row.client_name ?? d.walkIn,
        itemName: row.item_name ?? "",
        priceCents: price,
        staffId: row.staff_id,
        staffName:
            row.staff_role === null
                ? d.noStaff
                : staffName({ name: row.staff_name, title: row.staff_title, role: row.staff_role }),
        staffColor: row.staff_color,
        start,
        end,
        state,
        depositCents: row.deposit_status === "collected" ? (row.deposit_amount_cents ?? 0) : 0,
        line: {
            key: nextKey(),
            itemId: row.item_id,
            kind: row.item_kind ?? "service",
            description: row.item_name ?? "",
            unitAmountCents: price,
            quantity: 1,
            taxClass: row.tax_class ?? "standard",
            staffId: row.staff_id,
            bookingId: row.booking_id,
            color: row.item_color,
            imageFileId: null,
            discount: null,
        },
    };
}

const QUEUE_RANK: Record<VisitState, number> = {
    ready: 0,
    inProgress: 1,
    onTicket: 2,
    upcoming: 3,
    paid: 4,
};

interface CheckoutQueue {
    load: Load;
    visits: CheckoutVisit[];
    waiting: number;
}

/** Today's booked visits: ready to pay first, then in progress, later today, and paid last. */
export function useCheckoutQueue(): CheckoutQueue {
    const [now] = useState(() => new Date());
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const to = new Date(from.getTime() + 86_400_000);
    const rows = useQuery<QueueRow>(CHECKOUT_QUEUE_SQL, [from.toISOString(), to.toISOString()]);
    const visits = useMemo(
        () =>
            rows.data
                .map((r) => checkoutVisit(r, now))
                .sort((a, b) => QUEUE_RANK[a.state] - QUEUE_RANK[b.state] || +a.start - +b.start),
        [rows.data, now],
    );
    return {
        load: useReplicaLoad([rows], visits.length === 0),
        visits,
        waiting: visits.filter((v) => v.state === "ready" || v.state === "inProgress").length,
    };
}

export type BoardColumn = "open" | "prepare" | "ready";

export interface BoardCard {
    id: string;
    number: string;
    clientName: string;
    lines: string[];
    total: string;
    since: string;
    note: string | null;
    column: BoardColumn;
    action: { label: string; tone: "primary" | "outline" };
}

interface HeldClientRow {
    id: string;
    name: string;
}

export const SALE_CLIENT_NAMES_SQL = "SELECT id, name FROM clients";

interface FrontDeskBoard {
    load: Load;
    isEmpty: boolean;
    held: OrderOut[];
    columns: {
        key: BoardColumn;
        title: string;
        hint: string;
        empty: string;
        cards: BoardCard[];
    }[];
    // Held sales open on the register (`onResume`); pickups move to their next step.
    advance: (id: string) => void;
    busyId: string | null;
    done: string | null;
    error: string | null;
    refresh: () => void;
}

const sinceText = (iso: string, now: Date): string => {
    const m = Math.max(0, Math.round((+now - +parseTimestamp(iso)) / 60000));
    return m < 60
        ? `${String(m)} min`
        : m < 1440
          ? `${String(Math.floor(m / 60))} h`
          : `${String(Math.floor(m / 1440))} d`;
};

/** Held desk sales (from the server, so staff see them too) beside online pickups (from the replica). */
export function useFrontDeskBoard(
    api: ApiLike,
    onResume: (order: OrderOut) => void,
): FrontDeskBoard {
    const [now] = useState(() => new Date());
    const queue = usePickupOrders(api);
    const heldRemote = useRemote(() => api.get<OrderOut[]>("/v1/orders/held"));
    const names = useQuery<HeldClientRow>(SALE_CLIENT_NAMES_SQL).data;
    const [done, setDone] = useState<string | null>(null);
    const held = heldRemote.data ?? [];
    const nameOf = (id: string | null): string => names.find((c) => c.id === id)?.name ?? d.walkIn;
    const lineText = (q: number, name: string): string => (q > 1 ? `${String(q)} × ${name}` : name);
    const heldCards: BoardCard[] = held.map((o) => ({
        id: o.id,
        number: saleNumber(o.number),
        clientName: nameOf(o.client_id),
        lines: o.lines.map((l) => lineText(l.quantity, l.description)),
        total: formatMoney(o.total_cents),
        since: d.heldAt(d.ago(sinceText(o.created_at ?? now.toISOString(), now))),
        note: o.note,
        column: "open",
        action: { label: d.resumeSale, tone: "primary" },
    }));
    const pickups: BoardCard[] = queue.all
        .filter((o) => o.status !== "picked_up")
        .map((o) => {
            const column: BoardColumn =
                o.status === "unfulfilled" || o.status === "preparing" ? "prepare" : "ready";
            return {
                id: o.id,
                number: o.number,
                clientName: o.clientName,
                lines: o.lines.map((l) => lineText(l.quantity, l.name)),
                total: o.total,
                since: o.when,
                note: o.note,
                column,
                action:
                    o.status === "unfulfilled"
                        ? { label: strings.publicOrder.startPreparing, tone: "primary" }
                        : column === "prepare"
                          ? { label: d.markReady, tone: "primary" }
                          : { label: d.markPickedUp, tone: "outline" },
            };
        });
    const cards = [...heldCards, ...pickups];
    const col = (key: BoardColumn, title: string, hint: string, empty: string) => ({
        key,
        title,
        hint,
        empty,
        cards: cards.filter((c) => c.column === key),
    });
    const load = useLoad(
        [heldRemote, { isLoading: queue.load.state === "loading", error: null }],
        cards.length === 0,
    );
    return {
        load,
        isEmpty: cards.length === 0,
        held,
        columns: [
            col("open", d.openTickets, d.openTicketsHint, d.nothingOpen),
            col("prepare", d.toPrepare, d.toPrepareHint, d.nothingToPrepare),
            col("ready", d.readyForPickup, d.readyHint, d.nothingReady),
        ],
        advance: (id) => {
            const order = held.find((o) => o.id === id);
            if (order !== undefined) {
                setDone(null);
                onResume(order);
                return;
            }
            const card = pickups.find((c) => c.id === id);
            if (card === undefined) return;
            queue.advance(id);
            setDone(
                queue.all.find((order) => order.id === id)?.status === "unfulfilled"
                    ? strings.publicOrder.preparingStarted
                    : card.column === "prepare"
                      ? d.markedReady(card.clientName)
                      : d.markedPickedUp(card.clientName),
            );
        },
        busyId: queue.busyId,
        done: queue.error === null ? done : null,
        error: queue.error,
        refresh: () => {
            heldRemote.refresh().catch(() => undefined);
        },
    };
}

type SaleStatus = "open" | "paid" | "partly_refunded" | "refunded" | "void";

export const SALES_SQL = `
SELECT o.id, o.number, o.client_id, c.name AS client_name, o.source, o.pickup_status, o.created_at,
       o.total_cents, o.staff_id, o.note, ${orderStatusSql("o")} AS status,
       COALESCE((SELECT SUM(p.tip_cents) FROM payments p
                 WHERE p.order_id = o.id AND p.kind = 'payment' AND p.status = 'succeeded'), 0) AS tip_cents,
       COALESCE((SELECT SUM(p.amount_cents) FROM payments p
                 WHERE p.order_id = o.id AND p.kind = 'refund' AND p.status = 'succeeded'), 0) AS refunded_cents,
       COALESCE((SELECT SUM(l.discount_cents + l.sale_discount_cents) FROM lines l
                 WHERE l.order_id = o.id), 0) AS discount_cents,
       (SELECT p.method FROM payments p WHERE p.order_id = o.id AND p.kind = 'payment'
          AND p.status = 'succeeded' ORDER BY p.paid_at DESC LIMIT 1) AS method,
       (SELECT GROUP_CONCAT(CASE WHEN l.quantity > 1 THEN CAST(l.quantity AS INTEGER) || ' × ' || l.description
                                 ELSE l.description END, ', ')
          FROM lines l WHERE l.order_id = o.id) AS summary,
       (SELECT SUM(l.quantity) FROM lines l WHERE l.order_id = o.id) AS item_count
FROM orders o LEFT JOIN clients c ON c.id = o.client_id
ORDER BY o.created_at DESC`;

interface SaleRow {
    id: string;
    number: number | null;
    client_id: string | null;
    client_name: string | null;
    source: string;
    pickup_status: string | null;
    created_at: string;
    total_cents: number;
    staff_id: string;
    note: string | null;
    status: string;
    tip_cents: number;
    refunded_cents: number;
    discount_cents: number;
    method: string | null;
    summary: string | null;
    item_count: number | null;
}

interface SaleSummary {
    id: string;
    number: string;
    at: Date;
    clientName: string;
    clientId: string | null;
    summary: string;
    itemCount: number;
    totalCents: number;
    tipCents: number;
    discountCents: number;
    refundedCents: number;
    status: SaleStatus;
    statusLabel: string;
    intent: Intent;
    source: "desk" | "online";
    methodLabel: string;
}

function saleStatusIntent(status: SaleStatus): Intent {
    switch (status) {
        case "paid":
            return "success";
        case "open":
            return "accent";
        case "void":
            return "neutral";
        default:
            return "warning";
    }
}

export function saleStatus(row: { status: string; refunded_cents: number }): SaleStatus {
    if (row.status === "paid" && row.refunded_cents > 0) return "partly_refunded";
    return row.status === "paid" || row.status === "refunded" || row.status === "void"
        ? row.status
        : "open";
}

function saleSummary(row: SaleRow): SaleSummary {
    const status = saleStatus(row);
    return {
        id: row.id,
        number: saleNumber(row.number),
        at: parseTimestamp(row.created_at),
        clientName: row.client_name ?? d.walkIn,
        clientId: row.client_id,
        summary: row.summary ?? "",
        itemCount: row.item_count ?? 0,
        totalCents: row.total_cents + row.tip_cents,
        tipCents: row.tip_cents,
        discountCents: row.discount_cents,
        refundedCents: row.refunded_cents,
        status,
        statusLabel: d.status[status],
        intent: saleStatusIntent(status),
        source: row.source === "online" ? "online" : "desk",
        methodLabel:
            row.method === null
                ? d.notPaid
                : (strings.publicReceipt.method[row.method] ??
                  strings.publicReceipt.method.other ??
                  ""),
    };
}

type SalesFilter = "all" | "desk" | "online" | "open" | "refunds";

interface HistoryDay {
    key: string;
    label: string;
    totalCents: number;
    count: number;
    rows: SaleSummary[];
}

interface SalesHistory {
    load: Load;
    filter: SalesFilter;
    setFilter: (f: SalesFilter) => void;
    filters: { key: SalesFilter; label: string }[];
    q: string;
    setQ: (q: string) => void;
    days: HistoryDay[];
    empty: string;
    // Sales before tips: tips are owed to staff and reported apart.
    today: {
        salesCents: number;
        count: number;
        tipsCents: number;
        discountsCents: number;
        averageCents: number;
    };
}

const saleDayKey = (dt: Date): string =>
    `${String(dt.getFullYear())}-${String(dt.getMonth() + 1)}-${String(dt.getDate())}`;

/** Every sale, newest first, grouped by day with the day's takings. */
export function useSalesHistory(): SalesHistory {
    const [now] = useState(() => new Date());
    const rows = useQuery<SaleRow>(SALES_SQL);
    const [filter, setFilter] = useState<SalesFilter>("all");
    const [q, setQ] = useState("");
    const all = useMemo(() => rows.data.map(saleSummary), [rows.data]);
    const days = useMemo(() => {
        const t = q.trim().toLowerCase();
        const keep = all.filter((r) => {
            if (filter === "desk" && r.source !== "desk") return false;
            if (filter === "online" && r.source !== "online") return false;
            if (filter === "open" && r.status !== "open") return false;
            if (filter === "refunds" && r.refundedCents === 0) return false;
            return (
                t === "" ||
                [r.number, r.clientName, r.summary].some((v) => v.toLowerCase().includes(t))
            );
        });
        const map = new Map<string, HistoryDay>();
        for (const r of keep) {
            const k = saleDayKey(r.at);
            const day = map.get(k) ?? {
                key: k,
                label: relativeDay(r.at, "long", now),
                totalCents: 0,
                count: 0,
                rows: [],
            };
            day.rows.push(r);
            if (r.status !== "void" && r.status !== "open") {
                day.totalCents += r.totalCents;
                day.count += 1;
            }
            map.set(k, day);
        }
        return [...map.values()];
    }, [all, filter, q, now]);
    const todays = all.filter(
        (r) => saleDayKey(r.at) === saleDayKey(now) && r.status !== "void" && r.status !== "open",
    );
    const salesCents = todays.reduce((n, r) => n + r.totalCents - r.tipCents, 0);
    return {
        load: useReplicaLoad([rows], all.length === 0),
        filter,
        setFilter,
        filters: [
            { key: "all", label: d.filterAll },
            { key: "desk", label: d.filterDesk },
            { key: "online", label: d.filterOnline },
            { key: "open", label: d.filterOpen },
            { key: "refunds", label: d.filterRefunds },
        ],
        q,
        setQ,
        days,
        empty:
            q !== "" ? d.historyNoMatch : filter === "all" ? d.historyEmpty : d.historyFilterEmpty,
        today: {
            salesCents,
            count: todays.length,
            tipsCents: todays.reduce((n, r) => n + r.tipCents, 0),
            discountsCents: todays.reduce((n, r) => n + r.discountCents, 0),
            averageCents: todays.length === 0 ? 0 : Math.round(salesCents / todays.length),
        },
    };
}

export const SALE_LINES_SQL = `
SELECT l.id, l.item_id, l.description, l.quantity, l.unit_amount_cents, l.amount_cents, l.tax_class,
       l.staff_id, l.booking_id, l.discount_kind, l.discount_value, l.discount_reason,
       i.kind AS item_kind, i.color AS item_color,
       (SELECT f.id FROM files f WHERE f.parent_type = 'item' AND f.parent_id = l.item_id
          AND f.purpose = 'image' ORDER BY f.created_at DESC LIMIT 1) AS image_file_id
FROM lines l LEFT JOIN items i ON i.id = l.item_id
WHERE l.order_id = ? ORDER BY l.position`;

export const SALE_PAYMENTS_SQL = `
SELECT p.id, p.kind, p.method, p.amount_cents, p.tip_cents, p.tip_split, p.status, p.paid_at,
       p.credit_note, p.reason, p.tendered_cents, p.parent_payment_id
FROM payments p WHERE p.order_id = ? AND p.status IN ('succeeded', 'pending')
ORDER BY p.paid_at`;

export const SALE_RECORD_SQL = `
SELECT o.id, o.number, o.client_id, c.name AS client_name, c.email AS client_email, c.phone AS client_phone,
       o.source, o.pickup_status, o.created_at, o.total_cents, o.staff_id, o.note, o.approved_by,
       o.discount_kind, o.discount_value, o.discount_reason, o.receipt_channel, o.receipt_email,
       o.receipt_phone, o.receipt_sent_at, ${orderStatusSql("o")} AS status
FROM orders o LEFT JOIN clients c ON c.id = o.client_id WHERE o.id = ?`;

interface SaleRecordRow {
    id: string;
    number: number | null;
    client_id: string | null;
    client_name: string | null;
    client_email: string | null;
    client_phone: string | null;
    source: string;
    pickup_status: string | null;
    created_at: string;
    total_cents: number;
    staff_id: string;
    note: string | null;
    approved_by: string | null;
    discount_kind: string | null;
    discount_value: number | null;
    discount_reason: string | null;
    receipt_channel: string | null;
    receipt_email: string | null;
    receipt_phone: string | null;
    receipt_sent_at: string | null;
    status: string;
}

interface SaleLineRow {
    id: string;
    item_id: string | null;
    description: string;
    quantity: number;
    unit_amount_cents: number;
    amount_cents: number;
    tax_class: string;
    staff_id: string | null;
    booking_id: string | null;
    discount_kind: string | null;
    discount_value: number | null;
    discount_reason: string | null;
    item_kind: string | null;
    item_color: string | null;
    image_file_id: string | null;
}

interface SalePaymentRow {
    id: string;
    kind: string;
    method: string;
    amount_cents: number;
    tip_cents: number | null;
    tip_split: string | null;
    status: string;
    paid_at: string | null;
    credit_note: string | null;
    reason: string | null;
    tendered_cents: number | null;
    parent_payment_id: string | null;
}

export function discountFrom(
    kind: string | null,
    value: number | null,
    reason: string | null,
): SaleDiscount | null {
    if ((kind !== "percent" && kind !== "amount") || value === null || value <= 0) return null;
    return { kind, value, reason };
}

type SaleActionKey = "preparing" | "receipt" | "refund" | "void" | "resume" | "ready" | "pickedUp";

interface SaleDetail {
    id: string;
    number: string;
    clientName: string;
    clientId: string | null;
    clientEmail: string | null;
    clientPhone: string | null;
    status: SaleStatus;
    statusLabel: string;
    intent: Intent;
    source: "desk" | "online";
    at: Date;
    note: string | null;
    priced: PricedSale;
    totalLines: DocTotalLine[];
    rungBy: string;
    approved: boolean;
    payments: {
        id: string;
        label: string;
        detail: string;
        cents: number;
        refund: boolean;
    }[];
    tipShares: TipShare[];
    refundablePaymentId: string | null;
    paidWith: string;
    refundableCents: number;
    creditNotes: string[];
    receipt: string | null;
    actions: { key: SaleActionKey; label: string; tone: "primary" | "outline" | "danger" }[];
}

/** One sale with its maths, payments, tip shares and the actions its status allows. */
export function useSaleDetail(
    api: ApiLike,
    id: string | null,
    role: string | null,
): {
    load: Load;
    detail: SaleDetail | null;
} {
    const { rates, registered } = useTaxSetup(api);
    const staffRows = useQuery<SaleStaffRow>(SALE_STAFF_SQL).data;
    const record = useQuery<SaleRecordRow>(SALE_RECORD_SQL, [id ?? ""]);
    const lineRows = useQuery<SaleLineRow>(SALE_LINES_SQL, [id ?? ""]);
    const payRows = useQuery<SalePaymentRow>(SALE_PAYMENTS_SQL, [id ?? ""]);
    const row = record.data[0] ?? null;
    const detail = useMemo((): SaleDetail | null => {
        if (row === null) return null;
        const lines: SaleLine[] = lineRows.data.map((l) => ({
            key: l.id,
            itemId: l.item_id,
            kind: l.item_kind ?? "service",
            description: l.description,
            unitAmountCents: l.unit_amount_cents,
            quantity: l.quantity,
            taxClass: l.tax_class,
            staffId: l.staff_id,
            bookingId: l.booking_id,
            color: l.item_color,
            imageFileId: l.image_file_id,
            discount: discountFrom(l.discount_kind, l.discount_value, l.discount_reason),
        }));
        const pays = payRows.data.filter((p) => p.status === "succeeded");
        const tip = pays
            .filter((p) => p.kind === "payment")
            .reduce((n, p) => n + (p.tip_cents ?? 0), 0);
        const refunded = pays
            .filter((p) => p.kind === "refund")
            .reduce((n, p) => n + p.amount_cents, 0);
        const paidIn = pays
            .filter((p) => p.kind === "payment")
            .reduce((n, p) => n + p.amount_cents, 0);
        const saleDiscount = discountFrom(
            row.discount_kind,
            row.discount_value,
            row.discount_reason,
        );
        const priced = priceSale(lines, saleDiscount, rates, registered, {
            kind: "custom",
            cents: tip,
        });
        const status = saleStatus({ status: row.status, refunded_cents: refunded });
        const manager = role === "owner" || role === "admin";
        const lastPaid = [...pays].reverse().find((p) => p.kind === "payment") ?? null;
        const splits: { staff_id: string; cents: number }[] =
            lastPaid?.tip_split != null
                ? (JSON.parse(lastPaid.tip_split) as { staff_id: string; cents: number }[])
                : [];
        const actions: SaleDetail["actions"] = [];
        if (status === "open" && row.source !== "online")
            actions.push({ key: "resume", label: d.resumeSale, tone: "primary" });
        if (row.pickup_status === "unfulfilled")
            actions.push({
                key: "preparing",
                label: strings.publicOrder.startPreparing,
                tone: "primary",
            });
        if (row.pickup_status === "preparing")
            actions.push({ key: "ready", label: d.markReady, tone: "primary" });
        if (row.pickup_status === "ready")
            actions.push({ key: "pickedUp", label: d.markPickedUp, tone: "primary" });
        if (status !== "open" && status !== "void")
            actions.push({ key: "receipt", label: d.resendReceipt, tone: "outline" });
        if (manager && (status === "paid" || status === "partly_refunded"))
            actions.push({ key: "refund", label: d.refund, tone: "outline" });
        if (manager && status === "open")
            actions.push({ key: "void", label: d.voidSale, tone: "danger" });
        const staffOf = (sid: string): SaleStaffRow | undefined =>
            staffRows.find((s) => s.id === sid);
        const rung = staffOf(row.staff_id);
        const method = strings.publicReceipt.method;
        return {
            id: row.id,
            number: saleNumber(row.number),
            clientName: row.client_name ?? d.walkIn,
            clientId: row.client_id,
            clientEmail: row.receipt_email ?? row.client_email,
            clientPhone: row.receipt_phone ?? row.client_phone,
            status,
            statusLabel: d.status[status],
            intent: saleStatusIntent(status),
            source: row.source === "online" ? "online" : "desk",
            at: parseTimestamp(row.created_at),
            note: row.note,
            priced,
            totalLines: saleTotalLines(
                { ...priced.totals, depositCents: 0, dueCents: priced.totals.totalCents },
                { saleDiscountReason: saleDiscount?.reason ?? null },
            ),
            rungBy: rung === undefined ? d.noStaff : staffName(rung),
            approved: row.approved_by !== null,
            payments: pays.map((p) => ({
                id: p.id,
                label:
                    p.kind === "refund"
                        ? p.credit_note === null
                            ? d.refunded(formatMoney(p.amount_cents))
                            : d.creditNote(p.credit_note)
                        : (method[p.method] ?? method.other ?? ""),
                detail: p.paid_at === null ? "" : relativeDayTime(parseTimestamp(p.paid_at)),
                cents: p.kind === "refund" ? -p.amount_cents : p.amount_cents,
                refund: p.kind === "refund",
            })),
            tipShares: splits.map((s) => {
                const who = staffOf(s.staff_id);
                return {
                    staffId: s.staff_id,
                    name: who === undefined ? d.noStaff : staffName(who),
                    color: who?.color ?? null,
                    cents: s.cents,
                };
            }),
            refundablePaymentId: lastPaid?.id ?? null,
            paidWith:
                lastPaid === null ? d.methodCard : (method[lastPaid.method] ?? method.other ?? ""),
            refundableCents: Math.max(0, paidIn - refunded),
            creditNotes: pays.flatMap((p) => (p.credit_note === null ? [] : [p.credit_note])),
            receipt:
                row.receipt_channel === null
                    ? null
                    : d.sentBy(
                          row.receipt_channel,
                          (row.receipt_channel === "sms"
                              ? formatPhone(row.receipt_phone)
                              : row.receipt_email) ?? "",
                      ),
            actions,
        };
    }, [row, lineRows.data, payRows.data, rates, registered, role, staffRows]);
    return { load: useReplicaLoad([record, lineRows, payRows], row === null), detail };
}

interface SaleActions {
    run: (detail: SaleDetail, key: SaleActionKey) => void;
    busyKey: SaleActionKey | null;
    done: string | null;
    error: string | null;
    dismiss: () => void;
}

/** Resend, refund and void from a sale's panel; refund and void ask first and are manager-only. */
export function useSaleActions(
    api: ApiLike,
    confirmFn: (o: ConfirmOptions) => Promise<boolean>,
    onResume: (orderId: string) => void,
): SaleActions {
    const { busy, error, setError, run } = useAsyncAction();
    const [busyKey, setBusyKey] = useState<SaleActionKey | null>(null);
    const [done, setDone] = useState<string | null>(null);
    const ask = (options: ConfirmOptions, then: () => void): void => {
        confirmFn(options)
            .then((ok) => {
                if (ok) then();
            })
            .catch(() => undefined);
    };
    const go = (key: SaleActionKey, fn: () => Promise<unknown>, message: string): void => {
        setBusyKey(key);
        setDone(null);
        run(fn, {
            onSuccess: () => {
                setBusyKey(null);
                setDone(message);
            },
            errorMessage: d.actionError,
        });
    };
    return {
        run: (detail, key) => {
            if (key === "resume") {
                onResume(detail.id);
                return;
            }
            if (key === "preparing" || key === "ready" || key === "pickedUp") {
                go(
                    key,
                    () =>
                        api.post(`/v1/orders/${detail.id}/pickup`, {
                            status:
                                key === "preparing"
                                    ? "preparing"
                                    : key === "ready"
                                      ? "ready"
                                      : "picked_up",
                        }),
                    key === "preparing"
                        ? strings.publicOrder.preparingStarted
                        : key === "ready"
                          ? d.markedReady(detail.clientName)
                          : d.markedPickedUp(detail.clientName),
                );
                return;
            }
            if (key === "receipt") {
                const sms = detail.clientEmail === null && detail.clientPhone !== null;
                const to = (sms ? detail.clientPhone : detail.clientEmail) ?? "";
                go(
                    key,
                    () =>
                        api.post(`/v1/orders/${detail.id}/receipt`, {
                            channel: sms ? "sms" : "email",
                            to,
                        }),
                    d.receiptSent(sms ? formatPhone(to) : to),
                );
                return;
            }
            if (key === "refund" && detail.refundablePaymentId !== null) {
                const cents = detail.refundableCents;
                const paymentId = detail.refundablePaymentId;
                const note = creditNoteNumber(detail.number, detail.creditNotes.length + 1);
                ask(
                    {
                        title: d.refundTitle(detail.number),
                        message: d.refundBody(formatMoney(cents), detail.paidWith, note),
                        confirmLabel: d.refundConfirm(formatMoney(cents)),
                        destructive: true,
                    },
                    () => {
                        go(
                            key,
                            () =>
                                api.post(
                                    `/v1/payments/${paymentId}/refund`,
                                    { amount_cents: cents, notify: true },
                                    { idempotencyKey: newIdempotencyKey() },
                                ),
                            d.refundDone(formatMoney(cents), note),
                        );
                    },
                );
                return;
            }
            if (key === "void") {
                ask(
                    {
                        title: d.voidTitle(detail.number),
                        message: d.voidBody,
                        confirmLabel: d.voidSale,
                        destructive: true,
                    },
                    () => {
                        go(
                            key,
                            () => api.post(`/v1/orders/${detail.id}/void`, {}),
                            d.voidDone(detail.number),
                        );
                    },
                );
            }
        },
        busyKey: busy ? busyKey : null,
        done,
        error,
        dismiss: () => {
            setDone(null);
            setError(null);
        },
    };
}

export interface DiscountSheet {
    scope: "sale" | "lines";
    setScope: (s: "sale" | "lines") => void;
    keys: string[];
    toggleKey: (key: string) => void;
    editor: DiscountEditor;
    preview: DiscountPreview;
    approval: {
        needed: boolean;
        pin: string;
        setPin: (v: string) => void;
        approve: () => void;
        approved: boolean;
        error: string | null;
    };
    apply: () => boolean;
}

/** Scope, amount and reason with a before and after preview; over the staff limit an owner's PIN is asked. */
export function useDiscountSheet(api: ApiLike, sale: SaleTicket): DiscountSheet {
    const { rates, registered } = useTaxSetup(api);
    const [scope, setScopeState] = useState<"sale" | "lines">("sale");
    const [keys, setKeys] = useState<string[]>([]);
    const [pin, setPinState] = useState("");
    const [approvedPin, setApprovedPin] = useState<string | null>(null);
    const [pinError, setPinError] = useState<string | null>(null);
    const base =
        scope === "sale"
            ? sale.totals.subtotalCents + sale.totals.saleDiscountCents
            : sale.lines.filter((l) => keys.includes(l.key)).reduce((n, l) => n + l.grossCents, 0);
    const editor = useDiscountEditor(scope === "sale" ? sale.saleDiscount : null, base);
    const preview = previewDiscount(
        sale.lines,
        sale.saleDiscount,
        rates,
        registered,
        { scope, lineKeys: keys, discount: editor.draft },
        sale.limitBps,
    );
    return {
        scope,
        setScope: (v) => {
            setApprovedPin(null);
            setScopeState(v);
        },
        keys,
        toggleKey: (k) => {
            setApprovedPin(null);
            setKeys((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k]));
        },
        editor,
        preview,
        approval: {
            needed: preview.overLimit && approvedPin === null,
            pin,
            setPin: (v) => {
                setPinError(null);
                setPinState(v.replace(/\D/g, "").slice(0, 4));
            },
            // The server checks the PIN when the sale is saved; a wrong one comes back as an error there.
            approve: () => {
                if (pin.length !== 4) {
                    setPinError(d.pinInvalid);
                    return;
                }
                setApprovedPin(pin);
                setPinState("");
            },
            approved: approvedPin !== null,
            error: pinError,
        },
        apply: () => {
            const discount = editor.apply();
            if (discount === null) return false;
            if (scope === "lines" && keys.length === 0) return false;
            if (preview.overLimit && approvedPin === null) return false;
            if (scope === "sale") sale.setSaleDiscount(discount);
            else for (const k of keys) sale.setLineDiscount(k, discount);
            if (approvedPin !== null) sale.approve(approvedPin);
            return true;
        },
    };
}

type RegisterFilter = "retail" | "services" | "all";

interface RegisterCatalog {
    load: Load;
    filter: RegisterFilter;
    setFilter: (f: RegisterFilter) => void;
    filters: { key: RegisterFilter; label: string }[];
    q: string;
    setQ: (q: string) => void;
    items: ItemRow[];
    empty: string;
}

/** What a tile says under the name: minutes for a service, stock for a product. */
export function saleTileMeta(item: ItemRow): string {
    if (item.kind !== "product")
        return item.duration_min === null ? "" : d.minutes(item.duration_min);
    const state = stockState(item);
    if (state === "untracked") return d.notTracked;
    return state === "out" ? d.outOfStock : d.inStock(item.stock_on_hand ?? 0);
}

export function saleTileOut(item: ItemRow): boolean {
    return item.kind === "product" && stockState(item) === "out";
}

function inRegisterFilter(item: ItemRow, f: RegisterFilter): boolean {
    if (f === "retail") return item.kind === "product";
    if (f === "services") return item.kind !== "product";
    return true;
}

/** The add-ons and retail grid under today's visits, with a kind switch and search. */
export function useRegisterCatalog(): RegisterCatalog {
    const rows = useQuery<ItemRow>(ITEMS_SQL);
    const [filter, setFilter] = useState<RegisterFilter>("retail");
    const [q, setQ] = useState("");
    const sellable = useMemo(() => sellableItems(rows.data), [rows.data]);
    const t = q.trim().toLowerCase();
    const count = (f: RegisterFilter): number =>
        sellable.filter((i) => inRegisterFilter(i, f)).length;
    const items = sellable.filter(
        (i) =>
            inRegisterFilter(i, filter) &&
            (t === "" ||
                [i.name, i.category ?? "", i.sku ?? ""].some((v) => v.toLowerCase().includes(t))),
    );
    return {
        load: useReplicaLoad([rows], sellable.length === 0),
        filter,
        setFilter,
        filters: [
            { key: "retail", label: `${d.catRetail} ${String(count("retail"))}` },
            { key: "services", label: `${d.catServices} ${String(count("services"))}` },
            { key: "all", label: `${d.catAll} ${String(count("all"))}` },
        ],
        q,
        setQ,
        items,
        empty: t === "" ? d.noItemsTitle : d.noResults,
    };
}

export type SalesView = "register" | "board" | "history";

/** The Sales tab's views; history reads paid sales from the ledger, which staff replicas don't hold. */
export function salesViewsFor(role: string | null): { key: SalesView; label: string }[] {
    return [
        { key: "register", label: d.newSaleTitle },
        { key: "board", label: d.ordersTitle },
        ...(canManagePayments(role) ? [{ key: "history" as const, label: d.history }] : []),
    ];
}
