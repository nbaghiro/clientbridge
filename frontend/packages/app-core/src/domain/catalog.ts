import { useQuery } from "@powersync/react";
import { useMemo, useRef, useState } from "react";

import { type ApiLike, newIdempotencyKey } from "../api";
import { addDays, parseTimestamp, stampLabel, startOfDay } from "../datetime";
import { blankToNull, formatMoney, parseCents } from "../format";
import { type Load, useAsyncAction } from "../hooks";
import { strings } from "../strings";
import { type DurationSegment, type Intent, type TimelineEntry } from "../ui";
import { utcSql } from "./bookings";
import { useFileUpload } from "./files";
import { invoiceStatusSql, orderStatusSql } from "./ledger";
import { useReplicaLoad } from "./sync";
import { type TaxRate, useTaxSetup } from "./taxes";

const s = strings.catalog;

export interface ItemRow {
    id: string;
    kind: string;
    name: string;
    description: string | null;
    category: string | null;
    price_cents: number | null;
    currency: string;
    duration_min: number | null;
    capacity: number | null;
    active: number;
    color: string | null;
    image_file_id: string | null;
    online_bookable: number;
    buffer_before_min: number;
    buffer_after_min: number;
    deposit_type: string;
    deposit_value: number | null;
    session_count: number | null;
    validity_days: number | null;
    interval: number | null;
    frequency: string | null;
    tax_class: string;
    sku: string | null;
    cost_cents: number | null;
    track_stock: number;
    sell_online: number;
    stock_on_hand: number | null;
    low_stock_at: number | null;
    covers_item_id: string | null;
    visits_per_period: number | null;
    member_discount_bps: number | null;
    gift_amounts: string | null;
}

export const KIND_LABEL: Record<string, string> = {
    service: s.kindService,
    product: s.kindProduct,
    class: s.kindClass,
    package: s.kindPackage,
    subscription: s.kindSubscription,
    gift: s.kindGift,
};

const KIND_ORDER = ["service", "class", "product", "package", "subscription", "gift"];
const BOOKABLE_KINDS = ["service", "class"];
// Packages, subscriptions and gift cards sell through their own checkout so the liability is created.
const LINE_KINDS = ["service", "class", "product"];
const ENTITLEMENT_KINDS = ["gift", "package", "subscription"] as const;

export const DEPOSIT_TYPES: { value: string; label: string }[] = [
    { value: "none", label: s.depositNone },
    { value: "fixed", label: s.depositFixed },
    { value: "percent", label: s.depositPercent },
];

export const FREQUENCIES: { value: string; label: string }[] = [
    { value: "week", label: s.freqWeek },
    { value: "month", label: s.freqMonth },
    { value: "year", label: s.freqYear },
];

export const ITEMS_SQL = `
SELECT i.id, i.kind, i.name, i.description, i.category, i.price_cents, i.currency,
       i.duration_min, i.capacity, i.active, i.color, i.online_bookable,
       i.buffer_before_min, i.buffer_after_min, i.deposit_type, i.deposit_value,
       i.session_count, i.validity_days, i.interval, i.frequency, i.tax_class,
       i.sku, i.cost_cents, i.track_stock, i.sell_online, i.stock_on_hand, i.low_stock_at,
       i.covers_item_id, i.visits_per_period, i.member_discount_bps, i.gift_amounts,
       (SELECT f.id FROM files f
        WHERE f.parent_type = 'item' AND f.parent_id = i.id AND f.purpose = 'image'
        ORDER BY f.created_at DESC LIMIT 1) AS image_file_id
FROM items i ORDER BY i.active DESC, i.name COLLATE NOCASE`;

// Units on paid sales and paid invoices since a cutoff; owners only, staff replicas have no ledger.
export const UNITS_SOLD_SQL = `
SELECT l.item_id, SUM(l.quantity) AS units
FROM lines l
LEFT JOIN orders o ON o.id = l.order_id
LEFT JOIN invoices v ON v.id = l.invoice_id
WHERE l.item_id IS NOT NULL AND (
    (o.id IS NOT NULL AND ${utcSql("o.created_at")} >= datetime(?) AND ${orderStatusSql("o")} = 'paid')
    OR (v.id IS NOT NULL AND ${utcSql("v.issued_at")} >= datetime(?) AND ${invoiceStatusSql("v")} = 'paid'))
GROUP BY l.item_id`;

export const STOCK_MOVES_SQL = `
SELECT m.id, m.item_id, i.name AS item_name, m.reason, m.quantity, m.note, m.created_at,
       o.source AS order_source, l.invoice_id AS invoice_id,
       COALESCE(sb.name, sb.title, so.name, so.title) AS by_name
FROM inventory m
JOIN items i ON i.id = m.item_id
LEFT JOIN staff sb ON sb.user_id = m.created_by
LEFT JOIN lines l ON l.id = m.line_id
LEFT JOIN orders o ON o.id = l.order_id
LEFT JOIN staff so ON so.id = o.staff_id
ORDER BY m.created_at DESC, m.id DESC LIMIT 60`;

export function useCatalogItems(): ItemRow[] {
    return useQuery<ItemRow>(ITEMS_SQL).data;
}

function filterItems(rows: readonly ItemRow[], q: string): ItemRow[] {
    const t = q.trim().toLowerCase();
    if (!t) return [...rows];
    return rows.filter(
        (i) =>
            i.name.toLowerCase().includes(t) ||
            (i.category ?? "").toLowerCase().includes(t) ||
            (i.sku ?? "").toLowerCase().includes(t),
    );
}

// `active` is the SQLite 0/1 boolean column; normalize the check in one place.
function isActive(item: ItemRow): boolean {
    return item.active === 1;
}

export function bookableItems(items: ItemRow[]): ItemRow[] {
    return items.filter((i) => isActive(i) && BOOKABLE_KINDS.includes(i.kind));
}

/** Active, priced services, classes and products: what a sale or invoice can carry as lines. */
export function sellableItems(items: ItemRow[]): ItemRow[] {
    return items.filter(
        (i) => isActive(i) && i.price_cents !== null && LINE_KINDS.includes(i.kind),
    );
}

export function subscriptionPlans(items: ItemRow[]): ItemRow[] {
    return items.filter((i) => isActive(i) && i.kind === "subscription");
}

export function packageOfferings(items: ItemRow[]): ItemRow[] {
    return items.filter((i) => isActive(i) && i.kind === "package");
}

export function giftItems(items: ItemRow[]): ItemRow[] {
    return items.filter((i) => isActive(i) && i.kind === "gift");
}

/** A gift card item's suggested amounts in cents; the replica keeps the array as text. */
export function giftAmounts(item: Pick<ItemRow, "gift_amounts">): number[] {
    const raw = item.gift_amounts?.trim() ?? "";
    if (raw === "") return [];
    return raw
        .replace(/^[[{]|[\]}]$/g, "")
        .split(",")
        .map((v) => Number(v.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
}

type StockState = "untracked" | "in" | "low" | "out";

export function stockState(item: ItemRow): StockState {
    if (item.track_stock !== 1) return "untracked";
    const onHand = item.stock_on_hand ?? 0;
    if (onHand <= 0) return "out";
    if (item.low_stock_at !== null && onHand <= item.low_stock_at) return "low";
    return "in";
}

function stockIntent(state: StockState): Intent {
    switch (state) {
        case "out":
            return "danger";
        case "low":
            return "warning";
        case "in":
            return "success";
        default:
            return "neutral";
    }
}

function stockLabel(item: ItemRow): string {
    const state = stockState(item);
    if (state === "untracked") return "";
    if (state === "out") return s.stockOut;
    const onHand = item.stock_on_hand ?? 0;
    return state === "low" ? s.stockLow(onHand) : s.stockIn(onHand);
}

const isLow = (i: ItemRow): boolean => {
    const st = stockState(i);
    return st === "low" || st === "out";
};

/** The full scale of a stock meter: twice the low-stock line, so the line sits at the middle. */
export function stockScale(onHand: number, lowAt: number | null): number {
    return Math.max(1, (lowAt ?? Math.max(onHand, 1)) * 2);
}

type CatalogFilter = "all" | "services" | "products" | "plans" | "lowStock" | "archived";

export function matchesFilter(i: ItemRow, f: CatalogFilter): boolean {
    if (f === "archived") return !isActive(i);
    if (!isActive(i)) return false;
    if (f === "services") return BOOKABLE_KINDS.includes(i.kind);
    if (f === "products") return i.kind === "product";
    if (f === "plans") return (ENTITLEMENT_KINDS as readonly string[]).includes(i.kind);
    if (f === "lowStock") return isLow(i);
    return true;
}

interface CatalogSection {
    key: string;
    title: string;
    items: ItemRow[];
}

const kindRank = (kind: string): number => {
    const at = KIND_ORDER.indexOf(kind);
    return at === -1 ? KIND_ORDER.length : at;
};

/** Sections by category, ordered by the kind they hold; an item without one sits under its kind. */
export function groupByCategory(items: readonly ItemRow[]): CatalogSection[] {
    const map = new Map<string, ItemRow[]>();
    for (const i of items) {
        const k = i.category ?? s.groups[i.kind] ?? i.kind;
        map.set(k, [...(map.get(k) ?? []), i]);
    }
    const rank = (rows: ItemRow[]): number => Math.min(...rows.map((r) => kindRank(r.kind)));
    return [...map.entries()]
        .sort(([a, ra], [b, rb]) => rank(ra) - rank(rb) || a.localeCompare(b))
        .map(([title, rows]) => ({ key: title, title, items: rows }));
}

interface CatalogView {
    items: ItemRow[];
    filter: CatalogFilter;
    setFilter: (f: CatalogFilter) => void;
    filters: { key: CatalogFilter; label: string }[];
    q: string;
    setQ: (q: string) => void;
    sections: CatalogSection[];
    summary: string | undefined;
    empty: string;
    load: Load;
}

/** The catalog grouped by category, with kind filters and their counts, and search. */
export function useCatalogView(initial: CatalogFilter = "all"): CatalogView {
    const query = useQuery<ItemRow>(ITEMS_SQL);
    const items = query.data;
    const load = useReplicaLoad([query], items.length === 0);
    const [filter, setFilter] = useState<CatalogFilter>(initial);
    const [q, setQ] = useState("");
    const sections = useMemo(
        () =>
            groupByCategory(
                filterItems(
                    items.filter((i) => matchesFilter(i, filter)),
                    q,
                ),
            ),
        [items, filter, q],
    );
    const active = items.filter(isActive);
    const lowCount = active.filter(isLow).length;
    const count = (f: CatalogFilter): number => items.filter((i) => matchesFilter(i, f)).length;
    const labels: [CatalogFilter, string][] = [
        ["all", s.filterAll],
        ["services", s.filterServices],
        ["products", s.filterProducts],
        ["plans", s.filterPlans],
        ["lowStock", s.filterLowStock],
        ["archived", s.filterArchived],
    ];
    return {
        items,
        filter,
        setFilter,
        filters: labels.map(([key, label]) => ({ key, label: s.filterCount(label, count(key)) })),
        q,
        setQ,
        sections,
        summary: load.ready ? s.summary(active.length, lowCount) : undefined,
        empty: q !== "" ? s.noMatch : s.filterEmpty,
        load,
    };
}

function freqWord(frequency: string | null): string {
    return s.freqLabel[frequency ?? "month"] ?? frequency ?? "";
}

/** One line of facts under an item's name, by kind. */
export function itemMeta(i: ItemRow): string {
    switch (i.kind) {
        case "service": {
            const buffer = i.buffer_before_min + i.buffer_after_min;
            const parts = [
                s.minutes(i.duration_min ?? 0) + (buffer > 0 ? s.plusBuffer(buffer) : ""),
            ];
            if (i.deposit_type !== "none" && i.deposit_value !== null)
                parts.push(
                    s.depositMeta(
                        i.deposit_type === "percent"
                            ? `${String(i.deposit_value)}%`
                            : formatMoney(i.deposit_value),
                    ),
                );
            return parts.join(" · ");
        }
        case "class":
            return [s.minutes(i.duration_min ?? 0), s.classSize(i.capacity ?? 0)].join(" · ");
        case "product":
            return i.sku === null ? s.untracked : s.skuLine(i.sku);
        case "package":
            return [s.visits(i.session_count ?? 0), s.validDays(i.validity_days)].join(" · ");
        case "subscription":
            return s.every(i.interval ?? 1, freqWord(i.frequency));
        default:
            return s.anyAmount;
    }
}

export function itemPriceLabel(i: ItemRow): string {
    if (i.kind === "gift") return s.anyAmount;
    if (i.kind === "subscription")
        return s.perPeriod(formatMoney(i.price_cents), freqWord(i.frequency));
    return formatMoney(i.price_cents);
}

interface ItemStatus {
    label: string;
    intent: Intent;
}

/** The one status worth a pill: archived, or low or out of stock. */
export function itemStatus(i: ItemRow): ItemStatus | null {
    if (!isActive(i)) return { label: s.archived, intent: "neutral" };
    const st = stockState(i);
    if (st === "low" || st === "out") return { label: stockLabel(i), intent: stockIntent(st) };
    return null;
}

export function sellsOnline(i: ItemRow): boolean {
    if (BOOKABLE_KINDS.includes(i.kind)) return i.online_bookable === 1;
    return i.kind === "product" && i.sell_online === 1;
}

export interface ItemFormValues {
    kind: string;
    name: string;
    description: string;
    category: string;
    price: string;
    duration: string;
    bufferBefore: string;
    bufferAfter: string;
    capacity: string;
    onlineBookable: boolean;
    depositType: string;
    depositValue: string;
    sessionCount: string;
    validityDays: string;
    interval: string;
    frequency: string;
    taxClass: string;
    sku: string;
    cost: string;
    trackStock: boolean;
    openingStock: string;
    lowStockAt: string;
    sellOnline: boolean;
    coversItemId: string;
    visitsPerPeriod: string;
    memberDiscount: string;
    giftAmounts: number[];
}

type ItemField = keyof ItemFormValues;

const KIND_FIELDS: Record<string, ItemField[]> = {
    service: ["duration", "bufferBefore", "bufferAfter", "onlineBookable", "depositType"],
    class: ["duration", "bufferBefore", "bufferAfter", "capacity", "onlineBookable", "depositType"],
    product: ["sku", "cost", "trackStock", "lowStockAt", "sellOnline"],
    package: ["sessionCount", "validityDays", "coversItemId"],
    subscription: ["interval", "frequency", "visitsPerPeriod", "memberDiscount"],
    gift: ["giftAmounts"],
};

function itemFieldShown(kind: string, field: ItemField): boolean {
    return (KIND_FIELDS[kind] ?? []).includes(field);
}

const dollars = (cents: number | null): string => (cents === null ? "" : (cents / 100).toFixed(2));
const text = (n: number | null): string => (n === null ? "" : String(n));

function depositText(item: ItemRow | null): string {
    const value = item?.deposit_value ?? null;
    if (item === null || value === null) return "";
    return item.deposit_type === "fixed" ? dollars(value) : String(value);
}

function initialValues(item: ItemRow | null, kind: string): ItemFormValues {
    return {
        kind: item?.kind ?? kind,
        name: item?.name ?? "",
        description: item?.description ?? "",
        category: item?.category ?? "",
        price: item === null ? "" : dollars(item.price_cents),
        duration: text(item?.duration_min ?? null),
        bufferBefore: item === null ? "0" : String(item.buffer_before_min),
        bufferAfter: item === null ? "0" : String(item.buffer_after_min),
        capacity: text(item?.capacity ?? null),
        onlineBookable: item === null ? true : item.online_bookable === 1,
        depositType: item?.deposit_type ?? "none",
        depositValue: depositText(item),
        sessionCount: text(item?.session_count ?? null),
        validityDays: text(item?.validity_days ?? null),
        interval: item === null ? "1" : text(item.interval),
        frequency: item?.frequency ?? "month",
        taxClass: item?.tax_class ?? "standard",
        sku: item?.sku ?? "",
        cost: dollars(item?.cost_cents ?? null),
        trackStock: item?.track_stock === 1,
        openingStock: "",
        lowStockAt: text(item?.low_stock_at ?? null),
        sellOnline: item?.sell_online === 1,
        coversItemId: item?.covers_item_id ?? "",
        visitsPerPeriod: text(item?.visits_per_period ?? null),
        memberDiscount:
            item?.member_discount_bps == null ? "" : String(item.member_discount_bps / 100),
        giftAmounts: item === null ? [] : giftAmounts(item),
    };
}

const toInt = (value: string): number | null => {
    const n = Number(value.trim());
    return value.trim() === "" || !Number.isInteger(n) ? null : n;
};

const minutesOf = (value: string): number => Math.max(0, toInt(value) ?? 0);

/** Validation by kind; returns the first problem, or null when the item can be saved. */
export function itemFormError(v: ItemFormValues): string | null {
    const shown = (f: ItemField): boolean => itemFieldShown(v.kind, f);
    if (v.name.trim() === "") return s.nameRequired;
    if (v.price.trim() !== "" && parseCents(v.price) === null) return s.priceInvalid;
    if (shown("duration") && (toInt(v.duration) ?? 0) <= 0) return s.durationRequired;
    if (shown("depositType") && v.depositType !== "none") {
        const value = Number(v.depositValue);
        if (v.depositValue.trim() === "" || !Number.isFinite(value) || value <= 0)
            return s.depositRequired;
        if (v.depositType === "percent" && value > 100) return s.depositPercentMax;
    }
    if (shown("coversItemId") && v.coversItemId === "") return s.coversRequired;
    if (shown("sessionCount") && (toInt(v.sessionCount) ?? 0) <= 0) return s.sessionsRequired;
    if (shown("interval") && (toInt(v.interval) ?? 0) <= 0) return s.intervalRequired;
    if (shown("memberDiscount") && v.memberDiscount.trim() !== "") {
        const pct = Number(v.memberDiscount);
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) return s.perkInvalid;
    }
    if (shown("trackStock") && v.trackStock && v.openingStock.trim() !== "") {
        const opening = toInt(v.openingStock);
        if (opening === null || opening < 0) return s.stockInvalid;
    }
    return null;
}

/** The API body for the fields this kind uses; `kind` is only sent on create. */
export function itemPayload(v: ItemFormValues, creating: boolean): Record<string, unknown> {
    const shown = (f: ItemField): boolean => itemFieldShown(v.kind, f);
    const body: Record<string, unknown> = {
        name: v.name.trim(),
        description: blankToNull(v.description),
        category: blankToNull(v.category),
        price_cents: parseCents(v.price) ?? 0,
        tax_class: v.taxClass,
    };
    if (creating) body.kind = v.kind;
    if (shown("duration")) body.duration_min = toInt(v.duration);
    if (shown("bufferBefore")) body.buffer_before_min = toInt(v.bufferBefore) ?? 0;
    if (shown("bufferAfter")) body.buffer_after_min = toInt(v.bufferAfter) ?? 0;
    if (shown("capacity")) body.capacity = toInt(v.capacity);
    if (shown("onlineBookable")) body.online_bookable = v.onlineBookable;
    if (shown("depositType")) {
        body.deposit_type = v.depositType;
        body.deposit_value =
            v.depositType === "none"
                ? null
                : v.depositType === "fixed"
                  ? parseCents(v.depositValue)
                  : Number(v.depositValue);
    }
    if (shown("sessionCount")) body.session_count = toInt(v.sessionCount);
    if (shown("validityDays")) body.validity_days = toInt(v.validityDays);
    if (shown("coversItemId")) body.covers_item_id = blankToNull(v.coversItemId);
    if (shown("interval")) body.interval = toInt(v.interval);
    if (shown("frequency")) body.frequency = v.frequency;
    if (shown("visitsPerPeriod")) body.visits_per_period = toInt(v.visitsPerPeriod);
    if (shown("memberDiscount"))
        body.member_discount_bps =
            v.memberDiscount.trim() === "" ? null : Math.round(Number(v.memberDiscount) * 100);
    if (shown("giftAmounts")) body.gift_amounts = v.giftAmounts;
    if (shown("sku")) body.sku = blankToNull(v.sku);
    if (shown("cost")) body.cost_cents = parseCents(v.cost);
    if (shown("trackStock")) body.track_stock = v.trackStock;
    if (shown("lowStockAt")) body.low_stock_at = v.trackStock ? toInt(v.lowStockAt) : null;
    if (shown("sellOnline")) body.sell_online = v.sellOnline;
    return body;
}

function restockItem(
    api: ApiLike,
    id: string,
    body: { quantity: number; note: string | null; unit_cost_cents?: number | null },
    idempotencyKey: string,
): Promise<{ id: string }> {
    return api.post<{ id: string }>(`/v1/items/${id}/restock`, body, { idempotencyKey });
}

export interface ItemForm {
    values: ItemFormValues;
    set: <K extends ItemField>(field: K, value: ItemFormValues[K]) => void;
    editing: boolean;
    busy: boolean;
    error: string | null;
    submit: () => void;
    archive: () => void;
    restore: () => void;
}

/** Add or edit one item of a kind; on create an opening stock count is booked as a restock. */
function useItemForm(
    api: ApiLike,
    item: ItemRow | null,
    kind: string,
    onDone: () => void,
): ItemForm {
    const [values, setValues] = useState<ItemFormValues>(() => initialValues(item, kind));
    const { busy, error, setError, run } = useAsyncAction();
    const editing = item !== null;

    const set = <K extends ItemField>(field: K, value: ItemFormValues[K]): void => {
        setError(null);
        setValues((v) => ({ ...v, [field]: value }));
    };

    const submit = (): void => {
        const problem = itemFormError(values);
        if (problem !== null) {
            setError(problem);
            return;
        }
        const body = itemPayload(values, !editing);
        run(
            async () => {
                if (item !== null) {
                    await api.patch(`/v1/items/${item.id}`, body);
                    return;
                }
                const created = await api.post<{ id: string }>("/v1/items", body);
                const opening = toInt(values.openingStock) ?? 0;
                if (values.trackStock && opening > 0) {
                    await restockItem(
                        api,
                        created.id,
                        { quantity: opening, note: s.openingStockNote },
                        newIdempotencyKey(),
                    );
                }
            },
            { onSuccess: onDone, errorMessage: editing ? s.saveError : s.addError },
        );
    };

    const toggleActive = (active: boolean): void => {
        if (item === null) return;
        run(() => api.patch(`/v1/items/${item.id}`, { active }), {
            onSuccess: onDone,
            errorMessage: s.saveError,
        });
    };

    return {
        values,
        set,
        editing,
        busy,
        error,
        submit,
        archive: () => {
            toggleActive(false);
        },
        restore: () => {
            toggleActive(true);
        },
    };
}

const FEDERAL = ["GST", "HST"];

function ratesFor(taxClass: string, rates: readonly TaxRate[]): TaxRate[] {
    if (taxClass === "exempt") return [];
    return taxClass === "federal_only"
        ? rates.filter((r) => FEDERAL.includes(r.jurisdiction))
        : [...rates];
}

/** The three tax classes, named after the taxes this business actually charges. */
export function taxOptions(rates: readonly TaxRate[] | null): { key: string; label: string }[] {
    const all = rates ?? [];
    const federal = ratesFor("federal_only", all).map((r) => r.jurisdiction);
    const every = all.map((r) => r.jurisdiction);
    return [
        {
            key: "federal_only",
            label: federal.length > 0 ? s.taxOnly(s.taxJoin(federal)) : s.taxFederalOnly,
        },
        { key: "standard", label: every.length > 0 ? s.taxJoin(every) : s.taxAll },
        { key: "exempt", label: s.taxExempt },
    ];
}

function taxFacts(
    v: ItemFormValues,
    rates: readonly TaxRate[] | null,
    registered: boolean,
): string {
    if (!registered) return s.taxNotRegistered;
    const price = parseCents(v.price) ?? 0;
    const applied = ratesFor(v.taxClass, rates ?? []);
    if (applied.length === 0) return s.taxPreview(s.taxExempt, formatMoney(price));
    const tax = applied.reduce((sum, r) => sum + Math.round((price * r.rate_bps) / 10000), 0);
    return s.taxPreview(applied.map((r) => r.name).join(" + "), formatMoney(price + tax));
}

interface ItemTiming {
    segments: DurationSegment[];
    caption: string;
}

function itemTiming(v: ItemFormValues): ItemTiming {
    const before = minutesOf(v.bufferBefore);
    const main = minutesOf(v.duration);
    const after = minutesOf(v.bufferAfter);
    return {
        segments: [
            { key: "before", minutes: before, label: s.minutes(before), kind: "buffer" },
            {
                key: "main",
                minutes: Math.max(main, 1),
                label: s.mainSegment(v.name.trim() || (KIND_LABEL[v.kind] ?? v.kind), main),
                kind: "main",
            },
            { key: "after", minutes: after, label: s.minutes(after), kind: "buffer" },
        ],
        caption: s.timelineCaption(before + main + after, before, main, after),
    };
}

function depositSummary(v: ItemFormValues): string {
    const price = parseCents(v.price) ?? 0;
    if (v.depositType === "none") return s.depositNoneSummary;
    const raw =
        v.depositType === "percent"
            ? Math.round((price * Number(v.depositValue || 0)) / 100)
            : (parseCents(v.depositValue) ?? 0);
    const deposit = Math.min(price, Math.max(0, raw));
    return s.depositSummary(formatMoney(deposit), formatMoney(price - deposit));
}

interface MarginFacts {
    label: string;
    low: boolean;
}

function marginFacts(price: string, cost: string): MarginFacts | null {
    const p = parseCents(price);
    const c = parseCents(cost);
    if (p === null || c === null || p === 0) return null;
    const pct = Math.round(((p - c) / p) * 100);
    return { label: s.marginSummary(formatMoney(p - c), pct), low: pct < 30 };
}

interface Taxed {
    form: ItemForm;
    tax: string;
    taxOptions: { key: string; label: string }[];
}

function useTaxed(api: ApiLike, form: ItemForm): Taxed {
    const setup = useTaxSetup(api);
    return {
        form,
        tax: taxFacts(form.values, setup.rates, setup.registered),
        taxOptions: taxOptions(setup.rates),
    };
}

export interface ServiceEditor extends Taxed {
    timing: ItemTiming;
    deposit: string;
    isClass: boolean;
}

/** The service and class editor: the item form plus what it blocks on the calendar and the deposit in words. */
export function useServiceEditor(
    api: ApiLike,
    item: ItemRow | null,
    kind: string,
    onDone: () => void,
): ServiceEditor {
    const form = useItemForm(api, item, kind, onDone);
    return {
        ...useTaxed(api, form),
        timing: itemTiming(form.values),
        deposit: depositSummary(form.values),
        isClass: form.values.kind === "class",
    };
}

interface ProductPhoto {
    fileId: string | null;
    canUpload: boolean;
    busy: boolean;
    error: string | null;
    uploaded: boolean;
    upload: (body: Blob, contentType: string, sizeBytes?: number) => void;
}

export interface ProductEditor extends Taxed {
    margin: MarginFacts | null;
    photo: ProductPhoto;
    sold30: number;
}

/** The product editor: the item form plus margin, units sold and the photo upload. */
export function useProductEditor(
    api: ApiLike,
    item: ItemRow | null,
    onDone: () => void,
): ProductEditor {
    const form = useItemForm(api, item, "product", onDone);
    const [fileId, setFileId] = useState<string | null>(item?.image_file_id ?? null);
    const files = useFileUpload(api, setFileId);
    const sold = useUnitsSold();
    return {
        ...useTaxed(api, form),
        margin: marginFacts(form.values.price, form.values.cost),
        sold30: item === null ? 0 : (sold.get(item.id) ?? 0),
        photo: {
            fileId,
            canUpload: item !== null,
            busy: files.busy,
            error: files.error,
            uploaded: files.fileId !== null,
            upload: (body, contentType, sizeBytes) => {
                if (item === null) return;
                files.upload(
                    body,
                    { parentType: "item", parentId: item.id, purpose: "image" },
                    contentType,
                    sizeBytes,
                );
            },
        },
    };
}

interface PlanFacts {
    summary: string;
    perVisit: string | null;
    perYear: string | null;
}

export interface PlanEditor extends Taxed {
    coverOptions: { key: string; label: string }[];
    giftChoices: number[];
    toggleGiftAmount: (cents: number) => void;
    facts: PlanFacts;
}

const GIFT_CHOICES = [2500, 5000, 7500, 10000, 15000, 20000];
const PER_YEAR: Record<string, number> = { day: 365, week: 52, month: 12, year: 1 };

function planFacts(v: ItemFormValues, covers: ItemRow | null): PlanFacts {
    const price = parseCents(v.price) ?? 0;
    if (v.kind === "package") {
        const visits = minutesOf(v.sessionCount);
        if (covers === null || visits === 0)
            return { summary: s.planSummaryIncomplete, perVisit: null, perYear: null };
        const full = (covers.price_cents ?? 0) * visits;
        const saving =
            full > price ? s.saves(formatMoney(full - price), visits, covers.name) : s.noSaving;
        return {
            summary: s.planSummaryPackage(visits, covers.name),
            perVisit: `${s.perVisit(formatMoney(Math.round(price / visits)))} · ${saving}`,
            perYear: null,
        };
    }
    if (v.kind === "subscription") {
        const every = Math.max(1, toInt(v.interval) ?? 1);
        return {
            summary: s.planSummaryMembership(formatMoney(price), freqWord(v.frequency)),
            perVisit: null,
            perYear: s.perYear(
                formatMoney(Math.round((price * (PER_YEAR[v.frequency] ?? 12)) / every)),
            ),
        };
    }
    return { summary: s.giftNote, perVisit: null, perYear: null };
}

/** Packages, memberships and gift cards: the item form plus what a visit covers and what it's worth. */
export function usePlanEditor(
    api: ApiLike,
    item: ItemRow | null,
    kind: string,
    items: readonly ItemRow[],
    onDone: () => void,
): PlanEditor {
    const form = useItemForm(api, item, kind, onDone);
    const v = form.values;
    const services = items.filter((i) => isActive(i) && BOOKABLE_KINDS.includes(i.kind));
    const covers = services.find((i) => i.id === v.coversItemId) ?? null;
    return {
        ...useTaxed(api, form),
        coverOptions: services.map((i) => ({
            key: i.id,
            label: `${i.name} · ${formatMoney(i.price_cents)}`,
        })),
        giftChoices: [...new Set([...GIFT_CHOICES, ...v.giftAmounts])].sort((a, b) => a - b),
        toggleGiftAmount: (cents) => {
            form.set(
                "giftAmounts",
                v.giftAmounts.includes(cents)
                    ? v.giftAmounts.filter((c) => c !== cents)
                    : [...v.giftAmounts, cents].sort((a, b) => a - b),
            );
        },
        facts: planFacts(v, covers),
    };
}

/** Add item, step one: the kind decides every field after it and can't change later. */
export function useKindPicker(): {
    kind: string | null;
    setKind: (k: string) => void;
    options: { key: string; label: string; detail: string }[];
} {
    const [kind, setKind] = useState<string | null>(null);
    return {
        kind,
        setKind,
        options: KIND_ORDER.map((k) => ({
            key: k,
            label: KIND_LABEL[k] ?? k,
            detail: s.kindHints[k] ?? "",
        })),
    };
}

function soldSince(): string {
    return addDays(startOfDay(new Date()), -30).toISOString();
}

/** Units of each item sold on paid sales and paid invoices over the last 30 days. */
function useUnitsSold(): Map<string, number> {
    const since = useMemo(soldSince, []);
    const rows = useQuery<{ item_id: string; units: number }>(UNITS_SOLD_SQL, [since, since]).data;
    return useMemo(() => new Map(rows.map((r) => [r.item_id, Math.round(r.units)])), [rows]);
}

export type ProductFilter = "all" | "lowStock" | "notOnline" | "archived";
type ProductSort = "name" | "margin" | "stock";

interface ProductRowView {
    item: ItemRow;
    marginPct: number | null;
    stock: ItemStatus | null;
    onHand: number | null;
    sold30: number;
}

interface ProductsView {
    filter: ProductFilter;
    setFilter: (f: ProductFilter) => void;
    filters: { key: ProductFilter; label: string }[];
    sort: ProductSort;
    setSort: (s: ProductSort) => void;
    sorts: { key: ProductSort; label: string }[];
    q: string;
    setQ: (q: string) => void;
    rows: ProductRowView[];
    summary: string | undefined;
    empty: string;
    load: Load;
}

function productRow(i: ItemRow, sold30: number): ProductRowView {
    const p = i.price_cents ?? 0;
    const st = stockState(i);
    return {
        item: i,
        marginPct:
            i.cost_cents === null || p === 0 ? null : Math.round(((p - i.cost_cents) / p) * 100),
        stock: st === "untracked" ? null : { label: stockLabel(i), intent: stockIntent(st) },
        onHand: i.track_stock === 1 ? (i.stock_on_hand ?? 0) : null,
        sold30,
    };
}

function matchesProductFilter(i: ItemRow, f: ProductFilter): boolean {
    if (f === "archived") return !isActive(i);
    if (!isActive(i)) return false;
    if (f === "lowStock") return isLow(i);
    if (f === "notOnline") return i.sell_online !== 1;
    return true;
}

/** Products with margin, stock and units sold, filtered, searched and sorted. */
export function useProductsView(): ProductsView {
    const query = useQuery<ItemRow>(ITEMS_SQL);
    const products = useMemo(() => query.data.filter((i) => i.kind === "product"), [query.data]);
    const load = useReplicaLoad([query], products.length === 0);
    const sold = useUnitsSold();
    const [filter, setFilter] = useState<ProductFilter>("all");
    const [sort, setSort] = useState<ProductSort>("name");
    const [q, setQ] = useState("");
    const rows = useMemo(() => {
        const shown = filterItems(
            products.filter((i) => matchesProductFilter(i, filter)),
            q,
        ).map((i) => productRow(i, sold.get(i.id) ?? 0));
        return shown.sort((a, b) =>
            sort === "margin"
                ? (b.marginPct ?? -1) - (a.marginPct ?? -1)
                : sort === "stock"
                  ? (a.onHand ?? Number.MAX_SAFE_INTEGER) - (b.onHand ?? Number.MAX_SAFE_INTEGER)
                  : a.item.name.localeCompare(b.item.name),
        );
    }, [products, filter, sort, q, sold]);
    const active = products.filter(isActive);
    const costValue = active.reduce(
        (sum, i) =>
            sum +
            (i.track_stock === 1 ? Math.max(0, i.stock_on_hand ?? 0) * (i.cost_cents ?? 0) : 0),
        0,
    );
    return {
        filter,
        setFilter,
        filters: [
            { key: "all", label: s.filterAll },
            { key: "lowStock", label: s.filterLowStock },
            { key: "notOnline", label: s.filterNotOnline },
            { key: "archived", label: s.filterArchived },
        ],
        sort,
        setSort,
        sorts: [
            { key: "name", label: s.sortName },
            { key: "margin", label: s.sortMargin },
            { key: "stock", label: s.sortStock },
        ],
        q,
        setQ,
        rows,
        summary: load.ready ? s.productsSummary(active.length, formatMoney(costValue)) : undefined,
        empty: q !== "" ? s.noMatch : s.filterEmpty,
        load,
    };
}

export interface StockRowView {
    item: ItemRow;
    onHand: number;
    lowAt: number | null;
    intent: Intent;
    label: string;
    low: boolean;
    detail: string;
    suggested: number;
}

function stockRow(i: ItemRow, sold30: number): StockRowView {
    const onHand = i.stock_on_hand ?? 0;
    const st = stockState(i);
    const daysLeft = sold30 === 0 ? null : Math.floor(Math.max(0, onHand) / (sold30 / 30));
    const target = Math.max((i.low_stock_at ?? 0) * 2, sold30);
    return {
        item: i,
        onHand,
        lowAt: i.low_stock_at,
        intent: stockIntent(st),
        label: stockLabel(i),
        low: st === "low" || st === "out",
        detail: [
            daysLeft === null ? null : s.daysLeft(daysLeft),
            sold30 > 0 ? s.sold30(sold30) : null,
        ]
            .filter((x): x is string => x !== null)
            .join(" · "),
        suggested: Math.max(0, target - onHand),
    };
}

interface InventoryView {
    rows: StockRowView[];
    attention: StockRowView[];
    others: StockRowView[];
    stats: { tracked: number; low: number; out: number; costCents: number; retailCents: number };
    load: Load;
}

/** Tracked products: the ones to reorder first, the rest, and what's on the shelf at cost and retail. */
export function useInventory(): InventoryView {
    const query = useQuery<ItemRow>(ITEMS_SQL);
    const sold = useUnitsSold();
    const tracked = useMemo(
        () =>
            query.data
                .filter((i) => isActive(i) && i.kind === "product" && i.track_stock === 1)
                .map((i) => stockRow(i, sold.get(i.id) ?? 0)),
        [query.data, sold],
    );
    const load = useReplicaLoad([query], tracked.length === 0);
    return useMemo(() => {
        const daysLeft = (r: StockRowView): number => {
            const perDay = (sold.get(r.item.id) ?? 0) / 30;
            return r.onHand <= 0 ? -1 : perDay === 0 ? Number.MAX_SAFE_INTEGER : r.onHand / perDay;
        };
        const shelf = (r: StockRowView, cents: number | null): number =>
            Math.max(0, r.onHand) * (cents ?? 0);
        const byName = (a: StockRowView, b: StockRowView): number =>
            a.item.name.localeCompare(b.item.name);
        return {
            rows: [...tracked].sort(byName),
            attention: tracked.filter((r) => r.low).sort((a, b) => daysLeft(a) - daysLeft(b)),
            others: tracked.filter((r) => !r.low).sort(byName),
            stats: {
                tracked: tracked.length,
                low: tracked.filter((r) => r.low && r.onHand > 0).length,
                out: tracked.filter((r) => r.onHand <= 0).length,
                costCents: tracked.reduce((sum, r) => sum + shelf(r, r.item.cost_cents), 0),
                retailCents: tracked.reduce((sum, r) => sum + shelf(r, r.item.price_cents), 0),
            },
            load,
        };
    }, [tracked, sold, load]);
}

interface StockMoveRow {
    id: string;
    item_id: string;
    item_name: string;
    reason: string;
    quantity: number;
    note: string | null;
    created_at: string;
    order_source: string | null;
    invoice_id: string | null;
    by_name: string | null;
}

function moveKind(m: StockMoveRow): string {
    if (m.reason !== "sale") return m.reason;
    if (m.invoice_id !== null) return "invoice";
    return m.order_source === "online" ? "online" : "sale";
}

function moveEntry(m: StockMoveRow): TimelineEntry {
    const qty = s.moveQty(m.quantity);
    return {
        key: m.id,
        label: s.moveLabel(m.item_name, qty),
        detail: [s.moveKinds[moveKind(m)], m.note, m.by_name === null ? null : s.by(m.by_name)]
            .filter((x): x is string => x !== null && x !== undefined && x !== "")
            .join(" · "),
        at: stampLabel(parseTimestamp(m.created_at)),
        intent: m.quantity > 0 ? "success" : m.reason === "correction" ? "warning" : undefined,
    };
}

/** Stock changes, newest first, with what caused each and who. */
export function useStockMoves(limit = 8): TimelineEntry[] {
    const rows = useQuery<StockMoveRow>(STOCK_MOVES_SQL).data;
    return useMemo(() => rows.slice(0, limit).map(moveEntry), [rows, limit]);
}

interface RestockForm {
    quantity: string;
    setQuantity: (v: string) => void;
    note: string;
    setNote: (v: string) => void;
    after: number;
    busy: boolean;
    error: string | null;
    submit: () => void;
}

/** Add (or, with a negative count, correct) stock; one idempotency key per attempt. */
export function useRestockForm(
    api: ApiLike,
    item: ItemRow,
    onDone: (quantity: number) => void,
): RestockForm {
    const [quantity, setQuantityState] = useState("");
    const [note, setNote] = useState("");
    const keyRef = useRef<string | null>(null);
    const { busy, error, setError, run } = useAsyncAction();
    const qty = toInt(quantity);

    const setQuantity = (v: string): void => {
        keyRef.current = null;
        setError(null);
        setQuantityState(v);
    };

    const submit = (): void => {
        if (qty === null || qty === 0) {
            setError(s.restockInvalid);
            return;
        }
        keyRef.current ??= newIdempotencyKey();
        const key = keyRef.current;
        run(() => restockItem(api, item.id, { quantity: qty, note: blankToNull(note) }, key), {
            onSuccess: () => {
                keyRef.current = null;
                setQuantityState("");
                setNote("");
                onDone(qty);
            },
            errorMessage: s.restockError,
        });
    };

    return {
        quantity,
        setQuantity,
        note,
        setNote,
        after: (item.stock_on_hand ?? 0) + (qty ?? 0),
        busy,
        error,
        submit,
    };
}

interface DeliveryLine {
    item: ItemRow;
    quantity: string;
    unitCost: string;
}

interface ReceiveDelivery {
    supplier: string;
    setSupplier: (v: string) => void;
    reference: string;
    setReference: (v: string) => void;
    lines: DeliveryLine[];
    add: (item: ItemRow) => void;
    remove: (itemId: string) => void;
    setQuantity: (itemId: string, v: string) => void;
    setUnitCost: (itemId: string, v: string) => void;
    q: string;
    setQ: (q: string) => void;
    candidates: ItemRow[];
    units: number;
    costCents: number;
    after: (line: DeliveryLine) => number;
    stillLow: (line: DeliveryLine) => boolean;
    lineCost: (line: DeliveryLine) => number;
    busy: boolean;
    error: string | null;
    done: string | null;
    submit: () => void;
    load: Load;
}

const lineQty = (l: DeliveryLine): number | null => {
    const n = toInt(l.quantity);
    return n === null || n <= 0 ? null : n;
};

function deliveryLine(item: ItemRow, quantity: number): DeliveryLine {
    return { item, quantity: String(quantity), unitCost: dollars(item.cost_cents ?? 0) };
}

/** Receive a delivery: several products in one save, each a restock with its own idempotency key. */
export function useReceiveDelivery(
    api: ApiLike,
    seed: readonly { itemId: string; quantity: number }[],
): ReceiveDelivery {
    const query = useQuery<ItemRow>(ITEMS_SQL);
    const tracked = useMemo(
        () => query.data.filter((i) => isActive(i) && i.kind === "product" && i.track_stock === 1),
        [query.data],
    );
    const load = useReplicaLoad([query], tracked.length === 0);
    const [supplier, setSupplier] = useState("");
    const [reference, setReference] = useState("");
    const [q, setQ] = useState("");
    const [done, setDone] = useState<string | null>(null);
    const [lines, setLines] = useState<DeliveryLine[] | null>(null);
    const keys = useRef(new Map<string, string>());
    const { busy, error, setError, run } = useAsyncAction();

    const seeded =
        lines ??
        seed.flatMap((sd) => {
            const item = tracked.find((i) => i.id === sd.itemId);
            return item === undefined ? [] : [deliveryLine(item, sd.quantity)];
        });
    const edit = (fn: (ls: DeliveryLine[]) => DeliveryLine[]): void => {
        setDone(null);
        setError(null);
        setLines(fn(seeded));
    };
    const t = q.trim().toLowerCase();
    return {
        supplier,
        setSupplier,
        reference,
        setReference,
        lines: seeded,
        add: (item) => {
            setQ("");
            if (seeded.some((l) => l.item.id === item.id)) return;
            edit((ls) => [...ls, deliveryLine(item, Math.max(1, stockRow(item, 0).suggested))]);
        },
        remove: (id) => {
            edit((ls) => ls.filter((l) => l.item.id !== id));
        },
        setQuantity: (id, v) => {
            keys.current.delete(id);
            edit((ls) => ls.map((l) => (l.item.id === id ? { ...l, quantity: v } : l)));
        },
        setUnitCost: (id, v) => {
            keys.current.delete(id);
            edit((ls) => ls.map((l) => (l.item.id === id ? { ...l, unitCost: v } : l)));
        },
        q,
        setQ,
        candidates:
            t === ""
                ? []
                : tracked
                      .filter(
                          (i) =>
                              !seeded.some((l) => l.item.id === i.id) &&
                              [i.name, i.sku ?? ""].some((v) => v.toLowerCase().includes(t)),
                      )
                      .slice(0, 6),
        units: seeded.reduce((sum, l) => sum + (lineQty(l) ?? 0), 0),
        costCents: seeded.reduce(
            (sum, l) => sum + (lineQty(l) ?? 0) * (parseCents(l.unitCost) ?? 0),
            0,
        ),
        after: (l) => (l.item.stock_on_hand ?? 0) + (lineQty(l) ?? 0),
        stillLow: (l) =>
            l.item.low_stock_at !== null &&
            (l.item.stock_on_hand ?? 0) + (lineQty(l) ?? 0) <= l.item.low_stock_at,
        lineCost: (l) => (lineQty(l) ?? 0) * (parseCents(l.unitCost) ?? 0),
        busy,
        error,
        done,
        submit: () => {
            if (seeded.length === 0 || seeded.some((l) => lineQty(l) === null)) {
                setError(s.receiveInvalid);
                return;
            }
            const note = blankToNull(
                [supplier.trim(), reference.trim()].filter(Boolean).join(" · "),
            );
            const count = seeded.length;
            run(
                () =>
                    Promise.all(
                        seeded.map((l) => {
                            const key = keys.current.get(l.item.id) ?? newIdempotencyKey();
                            keys.current.set(l.item.id, key);
                            return restockItem(
                                api,
                                l.item.id,
                                {
                                    quantity: lineQty(l) ?? 0,
                                    note,
                                    unit_cost_cents: parseCents(l.unitCost),
                                },
                                key,
                            );
                        }),
                    ),
                {
                    onSuccess: () => {
                        keys.current.clear();
                        setDone(s.received(count));
                        setLines([]);
                        setReference("");
                    },
                    errorMessage: s.receiveError,
                },
            );
        },
        load,
    };
}
