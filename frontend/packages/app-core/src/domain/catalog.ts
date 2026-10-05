import { useQuery } from "@powersync/react";
import { useRef, useState } from "react";

import { useAsyncAction } from "../hooks";
import { strings } from "../strings";
import { type ApiLike, newIdempotencyKey } from "../api";
import { blankToNull } from "../format";
import { type Intent } from "../ui";

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
}

export const KIND_LABEL: Record<string, string> = {
    service: strings.catalog.kindService,
    product: strings.catalog.kindProduct,
    class: strings.catalog.kindClass,
    package: strings.catalog.kindPackage,
    subscription: strings.catalog.kindSubscription,
    gift: strings.catalog.kindGift,
};

export const ITEM_KINDS = [
    "service",
    "product",
    "class",
    "package",
    "subscription",
    "gift",
] as const;

/** Kinds a client can book on the calendar or the booking page. */
export const BOOKABLE_KINDS = ["service", "class"];
/** Kinds a sale or invoice carries as lines; packages, subscriptions and gift cards sell through
 *  their own checkout so the entitlement (and its liability) is created. */
export const LINE_KINDS = ["service", "class", "product"];
export const ENTITLEMENT_KINDS = ["gift", "package", "subscription"] as const;
export type EntitlementKind = (typeof ENTITLEMENT_KINDS)[number];

export const TAX_CLASSES: { value: string; label: string }[] = [
    { value: "standard", label: strings.catalog.taxStandard },
    { value: "federal_only", label: strings.catalog.taxFederalOnly },
    { value: "exempt", label: strings.catalog.taxExempt },
];

export const DEPOSIT_TYPES: { value: string; label: string }[] = [
    { value: "none", label: strings.catalog.depositNone },
    { value: "fixed", label: strings.catalog.depositFixed },
    { value: "percent", label: strings.catalog.depositPercent },
];

export const FREQUENCIES: { value: string; label: string }[] = [
    { value: "week", label: strings.catalog.freqWeek },
    { value: "month", label: strings.catalog.freqMonth },
    { value: "year", label: strings.catalog.freqYear },
];

export const ITEMS_SQL = `
SELECT i.id, i.kind, i.name, i.description, i.category, i.price_cents, i.currency,
       i.duration_min, i.capacity, i.active, i.color, i.online_bookable,
       i.buffer_before_min, i.buffer_after_min, i.deposit_type, i.deposit_value,
       i.session_count, i.validity_days, i.interval, i.frequency, i.tax_class,
       i.sku, i.cost_cents, i.track_stock, i.sell_online, i.stock_on_hand, i.low_stock_at,
       (SELECT f.id FROM files f
        WHERE f.parent_type = 'item' AND f.parent_id = i.id AND f.purpose = 'image'
        ORDER BY f.created_at DESC LIMIT 1) AS image_file_id
FROM items i ORDER BY i.active DESC, i.name COLLATE NOCASE`;

export function useCatalogItems(): ItemRow[] {
    return useQuery<ItemRow>(ITEMS_SQL).data;
}

/** Owner/admin set what the catalog shows customers, including item images. */
export function canManageCatalog(role: string | null): boolean {
    return role === "owner" || role === "admin";
}

export function filterItems(rows: ItemRow[], q: string): ItemRow[] {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
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

/** Active services and classes: what a booking can be made for. */
export function bookableItems(items: ItemRow[]): ItemRow[] {
    return items.filter((i) => isActive(i) && BOOKABLE_KINDS.includes(i.kind));
}

/** Active, priced services, classes and products: what a sale or invoice can carry as lines. */
export function sellableItems(items: ItemRow[]): ItemRow[] {
    return items.filter(
        (i) => isActive(i) && i.price_cents !== null && LINE_KINDS.includes(i.kind),
    );
}

/** The entitlement kinds with at least one active item, in sale-tile order. */
export function entitlementKindsOnSale(items: ItemRow[]): EntitlementKind[] {
    return ENTITLEMENT_KINDS.filter((k) => items.some((i) => isActive(i) && i.kind === k));
}

/** Active `subscription` items — the plans a client subscription can start on. */
export function subscriptionPlans(items: ItemRow[]): ItemRow[] {
    return items.filter((i) => isActive(i) && i.kind === "subscription");
}

/** Active `package` items — the offerings a client package can be sold from. */
export function packageOfferings(items: ItemRow[]): ItemRow[] {
    return items.filter((i) => isActive(i) && i.kind === "package");
}

/** Active `gift` items — the preset gift cards a sale can ring up by `item_id`. */
export function giftItems(items: ItemRow[]): ItemRow[] {
    return items.filter((i) => isActive(i) && i.kind === "gift");
}

export type StockState = "untracked" | "in" | "low" | "out";

export function stockState(item: ItemRow): StockState {
    if (item.track_stock !== 1) return "untracked";
    const onHand = item.stock_on_hand ?? 0;
    if (onHand <= 0) return "out";
    if (item.low_stock_at !== null && onHand <= item.low_stock_at) return "low";
    return "in";
}

export function stockIntent(state: StockState): Intent {
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

export function stockLabel(item: ItemRow): string {
    const state = stockState(item);
    if (state === "untracked") return "";
    if (state === "out") return strings.catalog.stockOut;
    const onHand = item.stock_on_hand ?? 0;
    return state === "low" ? strings.catalog.stockLow(onHand) : strings.catalog.stockIn(onHand);
}

export type CatalogFilter = "all" | "lowStock" | "archived";

export const CATALOG_FILTERS: { key: CatalogFilter; label: string }[] = [
    { key: "all", label: strings.catalog.filterAll },
    { key: "lowStock", label: strings.catalog.filterLowStock },
    { key: "archived", label: strings.catalog.filterArchived },
];

export function catalogEmptyText(query: string, filter: CatalogFilter): string {
    if (query) return strings.catalog.noMatch;
    return filter === "all" ? strings.catalog.empty : strings.catalog.filterEmpty;
}

export function filterCatalog(items: ItemRow[], filter: CatalogFilter): ItemRow[] {
    switch (filter) {
        case "lowStock":
            return items.filter((i) => {
                const s = stockState(i);
                return s === "low" || s === "out";
            });
        case "archived":
            return items.filter((i) => !isActive(i));
        default:
            return items.filter(isActive);
    }
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
}

export type ItemField = keyof ItemFormValues;

const KIND_FIELDS: Record<string, ItemField[]> = {
    service: ["duration", "bufferBefore", "bufferAfter", "onlineBookable", "depositType"],
    class: ["duration", "bufferBefore", "bufferAfter", "capacity", "onlineBookable", "depositType"],
    product: ["sku", "cost", "trackStock", "lowStockAt", "sellOnline"],
    package: ["sessionCount", "validityDays"],
    subscription: ["interval", "frequency"],
    gift: [],
};

/** Whether the editor shows a field for this kind of item (common fields always show). */
export function itemFieldShown(kind: string, field: ItemField): boolean {
    return (KIND_FIELDS[kind] ?? []).includes(field);
}

const dollars = (cents: number | null): string => (cents === null ? "" : (cents / 100).toFixed(2));
const text = (n: number | null): string => (n === null ? "" : String(n));

function depositText(item: ItemRow | null): string {
    const value = item?.deposit_value ?? null;
    if (item === null || value === null) return "";
    return item.deposit_type === "fixed" ? dollars(value) : String(value);
}

function initialValues(item: ItemRow | null): ItemFormValues {
    return {
        kind: item?.kind ?? "service",
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
    };
}

const toCents = (value: string): number | null => {
    const n = Number(value.trim());
    return value.trim() === "" || !Number.isFinite(n) ? null : Math.round(n * 100);
};
const toInt = (value: string): number | null => {
    const n = Number(value.trim());
    return value.trim() === "" || !Number.isInteger(n) ? null : n;
};

/** Validation by kind; returns the first problem, or null when the item can be saved. */
export function itemFormError(v: ItemFormValues): string | null {
    const shown = (f: ItemField): boolean => itemFieldShown(v.kind, f);
    if (v.name.trim() === "") return strings.catalog.nameRequired;
    const price = toCents(v.price);
    if (v.price.trim() !== "" && (price === null || price < 0)) return strings.catalog.priceInvalid;
    if (shown("duration") && (toInt(v.duration) ?? 0) <= 0) return strings.catalog.durationRequired;
    if (shown("depositType") && v.depositType !== "none") {
        const value = Number(v.depositValue);
        if (v.depositValue.trim() === "" || !Number.isFinite(value) || value <= 0)
            return strings.catalog.depositRequired;
        if (v.depositType === "percent" && value > 100) return strings.catalog.depositPercentMax;
    }
    if (shown("sessionCount") && (toInt(v.sessionCount) ?? 0) <= 0)
        return strings.catalog.sessionsRequired;
    if (shown("interval") && (toInt(v.interval) ?? 0) <= 0) return strings.catalog.intervalRequired;
    if (shown("trackStock") && v.trackStock && v.openingStock.trim() !== "") {
        const opening = toInt(v.openingStock);
        if (opening === null || opening < 0) return strings.catalog.stockInvalid;
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
        price_cents: toCents(v.price) ?? 0,
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
                  ? toCents(v.depositValue)
                  : Number(v.depositValue);
    }
    if (shown("sessionCount")) body.session_count = toInt(v.sessionCount);
    if (shown("validityDays")) body.validity_days = toInt(v.validityDays);
    if (shown("interval")) body.interval = toInt(v.interval);
    if (shown("frequency")) body.frequency = v.frequency;
    if (shown("sku")) body.sku = blankToNull(v.sku);
    if (shown("cost")) body.cost_cents = toCents(v.cost);
    if (shown("trackStock")) body.track_stock = v.trackStock;
    if (shown("lowStockAt")) body.low_stock_at = v.trackStock ? toInt(v.lowStockAt) : null;
    if (shown("sellOnline")) body.sell_online = v.sellOnline;
    return body;
}

export function createItem(api: ApiLike, body: Record<string, unknown>): Promise<{ id: string }> {
    return api.post<{ id: string }>("/v1/items", body);
}

export function updateItem(
    api: ApiLike,
    id: string,
    body: Record<string, unknown>,
): Promise<{ id: string }> {
    return api.patch<{ id: string }>(`/v1/items/${id}`, body);
}

export function setItemActive(api: ApiLike, id: string, active: boolean): Promise<{ id: string }> {
    return api.patch<{ id: string }>(`/v1/items/${id}`, { active });
}

export function restockItem(
    api: ApiLike,
    id: string,
    quantity: number,
    note: string | null,
    idempotencyKey: string,
): Promise<{ id: string }> {
    return api.post<{ id: string }>(
        `/v1/items/${id}/restock`,
        { quantity, note },
        { idempotencyKey },
    );
}

export interface ItemForm {
    values: ItemFormValues;
    set: <K extends ItemField>(field: K, value: ItemFormValues[K]) => void;
    shows: (field: ItemField) => boolean;
    editing: boolean;
    busy: boolean;
    error: string | null;
    submit: () => void;
    archive: () => void;
    restore: () => void;
}

/** The item editor's view-model, for both adding and editing: every field the item's kind uses,
 *  validation, save, and archive/restore. On create, an opening stock count is booked as a restock. */
export function useItemForm(api: ApiLike, item: ItemRow | null, onDone: () => void): ItemForm {
    const [values, setValues] = useState<ItemFormValues>(() => initialValues(item));
    const { busy, error, setError, run } = useAsyncAction();
    const editing = item !== null;

    const set = <K extends ItemField>(field: K, value: ItemFormValues[K]): void => {
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
                    await updateItem(api, item.id, body);
                    return;
                }
                const created = await createItem(api, body);
                const opening = toInt(values.openingStock) ?? 0;
                if (values.trackStock && opening > 0) {
                    await restockItem(
                        api,
                        created.id,
                        opening,
                        strings.catalog.openingStockNote,
                        newIdempotencyKey(),
                    );
                }
            },
            {
                onSuccess: () => {
                    if (!editing) setValues(initialValues(null));
                    onDone();
                },
                errorMessage: editing ? strings.catalog.saveError : strings.catalog.addError,
            },
        );
    };

    const toggleActive = (active: boolean): void => {
        if (item === null) return;
        run(() => setItemActive(api, item.id, active), {
            onSuccess: onDone,
            errorMessage: strings.catalog.saveError,
        });
    };

    return {
        values,
        set,
        shows: (field) => itemFieldShown(values.kind, field),
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

export interface RestockForm {
    quantity: string;
    setQuantity: (v: string) => void;
    note: string;
    setNote: (v: string) => void;
    busy: boolean;
    error: string | null;
    submit: () => void;
}

/** Add (or, with a negative count, correct) stock; one idempotency key per attempt. */
export function useRestockForm(api: ApiLike, item: ItemRow, onDone: () => void): RestockForm {
    const [quantity, setQuantityState] = useState("");
    const [note, setNote] = useState("");
    const keyRef = useRef<string | null>(null);
    const { busy, error, setError, run } = useAsyncAction();

    const setQuantity = (v: string): void => {
        keyRef.current = null;
        setQuantityState(v);
    };

    const submit = (): void => {
        const qty = toInt(quantity);
        if (qty === null || qty === 0) {
            setError(strings.catalog.restockInvalid);
            return;
        }
        keyRef.current ??= newIdempotencyKey();
        const key = keyRef.current;
        run(() => restockItem(api, item.id, qty, blankToNull(note), key), {
            onSuccess: () => {
                keyRef.current = null;
                setQuantityState("");
                setNote("");
                onDone();
            },
            errorMessage: strings.catalog.restockError,
        });
    };

    return { quantity, setQuantity, note, setNote, busy, error, submit };
}
