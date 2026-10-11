import { useBusinessQuery as useQuery } from "../hooks";

import { useEffect, useMemo, useState } from "react";

import { type ApiLike, newIdempotencyKey } from "../api";
import { dateKey, wallTime, zonedDate, useBusinessZone } from "../datetime";
import { formatList, formatMoney, formatMoneyShort, BUSINESS_CURRENCY } from "../format";
import { type Load, useAsyncAction, useRemote } from "../hooks";
import { strings } from "../strings";
import { useReplicaLoad } from "./sync";
import { taxList, taxName, taxRateLabel } from "./printing";

const t = strings.taxes;

export interface TaxRate {
    id: string;
    jurisdiction: string;
    province: string;
    rate_bps: number;
}

export type ProvinceCode =
    "AB" | "BC" | "MB" | "NB" | "NL" | "NS" | "NT" | "NU" | "ON" | "PE" | "QC" | "SK" | "YT";

interface ProvinceTaxLine {
    // The jurisdiction code the catalog names; Manitoba's provincial tax is the RST.
    code: string;
    rateBps: number;
    level: "federal" | "provincial";
}

const HST = (bps: number): ProvinceTaxLine[] => [{ code: "HST", rateBps: bps, level: "federal" }];
const GST: ProvinceTaxLine = { code: "GST", rateBps: 500, level: "federal" };

// The same rates as services/tax.py; the server computes every real tax amount.
const PROVINCE_TAX: Record<ProvinceCode, ProvinceTaxLine[]> = {
    AB: [GST],
    BC: [GST, { code: "PST", rateBps: 700, level: "provincial" }],
    MB: [GST, { code: "RST", rateBps: 700, level: "provincial" }],
    NB: HST(1500),
    NL: HST(1500),
    NS: HST(1400),
    NT: [GST],
    NU: [GST],
    ON: HST(1300),
    PE: HST(1500),
    QC: [GST, { code: "QST", rateBps: 997, level: "provincial" }],
    SK: [GST, { code: "PST", rateBps: 600, level: "provincial" }],
    YT: [GST],
};

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
    const labels = taxLinesFor(province)
        .filter((l) => cls === "standard" || l.level === "federal")
        .map((l) => taxRateLabel(l.code, l.rateBps));
    return taxList(labels);
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
    const names = taxList(
        lines
            .filter((l) => cls === "standard" || l.level === "federal")
            .map((l) => taxName(l.code)),
    );
    return cls === "federal_only" && lines.length > 1 ? t.only(names) : names;
}

/** "Service, GST only" for the worked example; the no-tax card is just "No tax". */
export function taxExampleTitle(cls: ItemTaxClass, province: string | null): string {
    const kind = t.exampleFor[cls];
    const label = taxClassLabel(cls, province);
    return kind === undefined ? label : formatList([kind, label], "unit");
}

const SMALL_SUPPLIER_CENTS = 3_000_000;
const EXAMPLE_SALE_CENTS = 10_000;

/** The small-supplier threshold as the tax copy shows it: "$30,000". */
export function smallSupplierLimit(): string {
    return formatMoneyShort(SMALL_SUPPLIER_CENTS, BUSINESS_CURRENCY);
}

/** The sale the worked example is priced on: "$100". */
export function exampleSale(): string {
    return formatMoneyShort(EXAMPLE_SALE_CENTS, BUSINESS_CURRENCY);
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
    cents = EXAMPLE_SALE_CENTS,
): { lines: TaxExampleLine[]; totalCents: number } {
    const all = taxLinesFor(province);
    const applied =
        !collect || cls === "exempt"
            ? []
            : cls === "federal_only"
              ? all.filter((l) => l.level === "federal")
              : all;
    const lines = applied.map((l) => ({
        label: taxRateLabel(l.code, l.rateBps),
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
export function filingPeriod(
    frequency: FilingFrequency,
    zone: string,
    now: Date = new Date(),
): FilingPeriod {
    const { year, month } = wallTime(now, zone);
    const day = (m: number, d: number, y = year): Date => zonedDate(y, m, d, 0, 0, zone);
    if (frequency === "annual")
        return { from: day(1, 1), to: day(12, 31), due: day(4, 30, year + 1) };
    const months = frequency === "quarterly" ? 3 : 1;
    const start = Math.floor((month - 1) / months) * months + 1;
    return { from: day(start, 1), to: day(start + months, 0), due: day(start + months + 1, 0) };
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
    const zone = useBusinessZone();
    const period = filingPeriod(draft.frequency, zone);
    const from = dateKey(period.from, zone);
    const collected = useRemote(
        () =>
            api.get<{ tax_collected_cents: number }>(
                `/v1/reports/gst-hst?start=${from}&end=${dateKey(period.to, zone)}`,
            ),
        `${from}:${String(initial.registration === "registered")}`,
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
            label: taxRateLabel(l.code, l.rateBps),
            level: l.level,
        })),
        hasPst: lines.some((l) => l.level === "provincial" && l.code !== "QST"),
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

export function taxableItemPriceLabel(item: TaxableItem): string {
    return item.kind === "gift" || item.price_cents === null
        ? t.anyAmount
        : formatMoney(item.price_cents, BUSINESS_CURRENCY);
}

function useTaxRates(api: ApiLike): TaxRate[] | null {
    const [rates, setRates] = useState<TaxRate[] | null>(null);
    useEffect(() => {
        api.get<TaxRate[]>("/v1/tax-rates")
            .then(setRates)
            .catch(() => {
                setRates([]);
            });
    }, [api]);
    return rates;
}

export const TAX_REGISTERED_SQL = "SELECT tax_registered FROM businesses LIMIT 1";

interface TaxSetup {
    rates: TaxRate[] | null;
    registered: boolean;
}

/** The rates this business charges, and whether it collects tax at all (a small supplier doesn't). */
export function useTaxSetup(api: ApiLike): TaxSetup {
    const rates = useTaxRates(api);
    const row = useQuery<{ tax_registered: number | null }>(TAX_REGISTERED_SQL).data[0];
    return { rates, registered: row?.tax_registered !== 0 };
}
