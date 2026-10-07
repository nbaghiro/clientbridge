import { useQuery } from "@powersync/react";
import { useEffect, useMemo, useState } from "react";

import { type ApiLike, newIdempotencyKey } from "../api";
import { addDays, dateKey } from "../datetime";
import { formatMoney } from "../format";
import { type Load, useAsyncAction, useRemote } from "../hooks";
import { strings } from "../strings";
import { useReplicaLoad } from "./sync";

const t = strings.taxes;

export type ProvinceCode =
    "AB" | "BC" | "MB" | "NB" | "NL" | "NS" | "NT" | "NU" | "ON" | "PE" | "QC" | "SK" | "YT";

interface ProvinceTaxLine {
    name: string;
    rateBps: number;
    level: "federal" | "provincial";
}

const HST = (bps: number): ProvinceTaxLine[] => [{ name: "HST", rateBps: bps, level: "federal" }];
const GST: ProvinceTaxLine = { name: "GST", rateBps: 500, level: "federal" };

// The same rates as services/tax.py; the server computes every real tax amount.
const PROVINCE_TAX: Record<ProvinceCode, ProvinceTaxLine[]> = {
    AB: [GST],
    BC: [GST, { name: "PST", rateBps: 700, level: "provincial" }],
    MB: [GST, { name: "RST", rateBps: 700, level: "provincial" }],
    NB: HST(1500),
    NL: HST(1500),
    NS: HST(1400),
    NT: [GST],
    NU: [GST],
    ON: HST(1300),
    PE: HST(1500),
    QC: [GST, { name: "QST", rateBps: 997, level: "provincial" }],
    SK: [GST, { name: "PST", rateBps: 600, level: "provincial" }],
    YT: [GST],
};

const formatRate = (bps: number): string => `${String(bps / 100)}%`;

function taxLinesFor(province: string | null): ProvinceTaxLine[] {
    return province !== null && province in PROVINCE_TAX
        ? PROVINCE_TAX[province as ProvinceCode]
        : [GST];
}

/** "GST 5% + PST 7%" for a province; federal_only keeps only the GST or HST. */
export function taxSummary(
    province: string | null,
    cls: "standard" | "federal_only" = "standard",
): string {
    return taxLinesFor(province)
        .filter((l) => cls === "standard" || l.level === "federal")
        .map((l) => `${l.name} ${formatRate(l.rateBps)}`)
        .join(" + ");
}

export type ItemTaxClass = "standard" | "federal_only" | "exempt";
type FilingFrequency = "monthly" | "quarterly" | "annual";
type TaxRegistration = "registered" | "small";

export const TAX_CLASS_KEYS: ItemTaxClass[] = ["federal_only", "standard", "exempt"];
export const FILING_FREQUENCIES: FilingFrequency[] = ["monthly", "quarterly", "annual"];

const GST_FORMAT = /^\d{9}RT\d{4}$/;
const PST_FORMAT = /^(PST)?\d{8}$/;
const compact = (v: string): string => v.replace(/[\s-]/g, "").toUpperCase();

/** The class names for a province: "GST + PST" in BC, "HST" in Ontario. */
export function taxClassLabel(cls: ItemTaxClass, province: string | null): string {
    if (cls === "exempt") return t.classes.exempt;
    const lines = taxLinesFor(province);
    const names = lines
        .filter((l) => cls === "standard" || l.level === "federal")
        .map((l) => l.name)
        .join(" + ");
    return cls === "federal_only" && lines.length > 1 ? t.only(names) : names;
}

/** "Service, GST only" for the worked example; the no-tax card is just "No tax". */
export function taxExampleTitle(cls: ItemTaxClass, province: string | null): string {
    const kind = t.exampleFor[cls];
    const label = taxClassLabel(cls, province);
    return kind === undefined ? label : `${kind}, ${label}`;
}

interface TaxExampleLine {
    label: string;
    cents: number;
}

/** A worked example: tax lines and total on a sale of `cents` under one class. */
export function taxExample(
    cls: ItemTaxClass,
    province: string | null,
    collect: boolean,
    cents = 10000,
): { lines: TaxExampleLine[]; totalCents: number } {
    const all = taxLinesFor(province);
    const applied =
        !collect || cls === "exempt"
            ? []
            : cls === "federal_only"
              ? all.filter((l) => l.level === "federal")
              : all;
    const lines = applied.map((l) => ({
        label: `${l.name} ${formatRate(l.rateBps)}`,
        cents: Math.round((cents * l.rateBps) / 10000),
    }));
    return { lines, totalCents: cents + lines.reduce((sum, l) => sum + l.cents, 0) };
}

interface FilingPeriod {
    from: Date;
    to: Date;
    due: Date;
}

/** The return period that contains `now`, and when it is due to the CRA. */
export function filingPeriod(frequency: FilingFrequency, now: Date = new Date()): FilingPeriod {
    const y = now.getFullYear();
    if (frequency === "annual") {
        return { from: new Date(y, 0, 1), to: new Date(y, 11, 31), due: new Date(y + 1, 3, 30) };
    }
    const months = frequency === "quarterly" ? 3 : 1;
    const start = Math.floor(now.getMonth() / months) * months;
    const from = new Date(y, start, 1);
    const to = addDays(new Date(y, start + months, 1), -1);
    return { from, to, due: new Date(y, start + months + 1, 0) };
}

export const TAX_SETTINGS_SQL = `
SELECT province, tax_registered, gst_hst_number, pst_number, filing_frequency
FROM businesses LIMIT 1`;

interface TaxSettingsRow {
    province: string | null;
    tax_registered: number | null;
    gst_hst_number: string | null;
    pst_number: string | null;
    filing_frequency: string | null;
}

export interface TaxSettingsForm {
    load: Load;
    province: string | null;
    provinceName: string;
    taxLines: { label: string; level: "federal" | "provincial" }[];
    hasPst: boolean;
    registration: TaxRegistration;
    setRegistration: (r: TaxRegistration) => void;
    gst: string;
    setGst: (v: string) => void;
    pst: string;
    setPst: (v: string) => void;
    frequency: FilingFrequency;
    setFrequency: (f: FilingFrequency) => void;
    fieldErrors: { gst?: string; pst?: string };
    filing: FilingPeriod & { collectedCents: number | null };
    dirty: boolean;
    busy: boolean;
    error: string | null;
    saved: boolean;
    submit: () => void;
}

/** The registration switch, the numbers that print on invoices, and the next return. */
export function useTaxSettingsForm(
    api: ApiLike,
    provinceName: (code: string) => string,
): TaxSettingsForm {
    const query = useQuery<TaxSettingsRow>(TAX_SETTINGS_SQL);
    const row = query.data[0];
    const load = useReplicaLoad([query], row === undefined);
    const initial = useMemo(
        () => ({
            registration: row?.tax_registered === 1 ? ("registered" as const) : ("small" as const),
            gst: row?.gst_hst_number ?? "",
            pst: row?.pst_number ?? "",
            frequency: (row?.filing_frequency ?? "annual") as FilingFrequency,
        }),
        [row],
    );
    const [draft, setDraft] = useState(initial);
    const [fieldErrors, setFieldErrors] = useState<TaxSettingsForm["fieldErrors"]>({});
    const [saved, setSaved] = useState(false);
    const { busy, error, run } = useAsyncAction();
    useEffect(() => {
        setDraft(initial);
    }, [initial]);

    const province = row?.province ?? null;
    const lines = taxLinesFor(province);
    const period = filingPeriod(draft.frequency);
    const collected = useRemote(
        () =>
            api.get<{ tax_collected_cents: number }>(
                `/v1/reports/gst-hst?start=${dateKey(period.from)}&end=${dateKey(period.to)}`,
            ),
        `${dateKey(period.from)}:${String(initial.registration === "registered")}`,
    );
    const edit = (patch: Partial<typeof draft>): void => {
        setDraft((d) => ({ ...d, ...patch }));
        setSaved(false);
    };

    return {
        load,
        province,
        provinceName: province === null ? "" : provinceName(province),
        taxLines: lines.map((l) => ({
            label: `${l.name} ${formatRate(l.rateBps)}`,
            level: l.level,
        })),
        hasPst: lines.some((l) => l.level === "provincial" && l.name !== "QST"),
        registration: draft.registration,
        setRegistration: (r) => {
            edit({ registration: r });
        },
        gst: draft.gst,
        setGst: (v) => {
            edit({ gst: v });
        },
        pst: draft.pst,
        setPst: (v) => {
            edit({ pst: v });
        },
        frequency: draft.frequency,
        setFrequency: (f) => {
            edit({ frequency: f });
        },
        fieldErrors,
        filing: { ...period, collectedCents: collected.data?.tax_collected_cents ?? null },
        dirty: JSON.stringify(draft) !== JSON.stringify(initial),
        busy,
        error,
        saved,
        submit: () => {
            const registered = draft.registration === "registered";
            const errs: TaxSettingsForm["fieldErrors"] = {};
            if (registered && !GST_FORMAT.test(compact(draft.gst))) errs.gst = t.gstInvalid;
            if (draft.pst.trim() !== "" && !PST_FORMAT.test(compact(draft.pst)))
                errs.pst = t.pstInvalid;
            setFieldErrors(errs);
            if (Object.keys(errs).length > 0) return;
            run(
                () =>
                    api.patch("/v1/business", {
                        tax_registered: registered,
                        gst_hst_number: draft.gst.trim(),
                        pst_number: draft.pst.trim(),
                        filing_frequency: draft.frequency,
                    }),
                {
                    errorMessage: t.saveError,
                    onSuccess: () => {
                        setSaved(true);
                    },
                },
            );
        },
    };
}

export const TAXABLE_ITEMS_SQL = `
SELECT id, name, kind, price_cents, tax_class FROM items
WHERE active = 1 ORDER BY kind, name COLLATE NOCASE`;

interface TaxableItem {
    id: string;
    name: string;
    kind: string;
    price_cents: number | null;
    tax_class: ItemTaxClass;
}

export interface ItemTaxClasses {
    load: Load;
    items: TaxableItem[];
    selected: string[];
    toggle: (id: string) => void;
    allSelected: boolean;
    toggleAll: () => void;
    clearSelection: () => void;
    setClass: (ids: readonly string[], cls: ItemTaxClass) => void;
    busy: boolean;
    error: string | null;
}

/** Every active item with its tax class, changed one at a time or for a selection. */
export function useItemTaxClasses(api: ApiLike): ItemTaxClasses {
    const query = useQuery<TaxableItem>(TAXABLE_ITEMS_SQL);
    const items = query.data;
    const load = useReplicaLoad([query], items.length === 0);
    const [selected, setSelected] = useState<string[]>([]);
    const { busy, error, run } = useAsyncAction();
    return {
        load,
        items,
        selected,
        toggle: (id) => {
            setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
        },
        allSelected: items.length > 0 && selected.length === items.length,
        toggleAll: () => {
            setSelected((s) => (s.length === items.length ? [] : items.map((i) => i.id)));
        },
        clearSelection: () => {
            setSelected([]);
        },
        setClass: (ids, cls) => {
            const key = newIdempotencyKey();
            run(
                () =>
                    api.post(
                        "/v1/items/tax-class",
                        { item_ids: ids, tax_class: cls },
                        { idempotencyKey: key },
                    ),
                {
                    errorMessage: t.classError,
                    onSuccess: () => {
                        setSelected([]);
                    },
                },
            );
        },
        busy,
        error,
    };
}

export function itemPriceLabel(item: TaxableItem): string {
    return item.kind === "gift" || item.price_cents === null
        ? t.anyAmount
        : formatMoney(item.price_cents);
}
