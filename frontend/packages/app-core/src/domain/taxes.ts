import { useBusinessQuery as useQuery } from "../hooks";

import { useEffect, useMemo, useState } from "react";

import { type ApiLike, newIdempotencyKey } from "../api";
import { dateKey, wallTime, zonedDate, useBusinessZone } from "../datetime";
import { formatList, formatMoney, formatMoneyShort, BUSINESS_CURRENCY } from "../format";
import { type Load, useAsyncAction, useRemote } from "../hooks";
import { strings } from "../strings";
import { useReplicaLoad } from "./sync";
import { FEDERAL_TAX_CODES, TAX_RATES } from "../taxRates";
import { taxList, taxName, taxRateLabel } from "./printing";

const t = strings.taxes;

export type ProvinceCode =
    "AB" | "BC" | "MB" | "NB" | "NL" | "NS" | "NT" | "NU" | "ON" | "PE" | "QC" | "SK" | "YT";

export interface RateRow {
    province: string;
    code: string;
    ppm: number;
    from: string;
}

export interface DocRate {
    code: string;
    ppm: number;
}

export const isFederal = (code: string): boolean => FEDERAL_TAX_CODES.includes(code);

/** The taxes a province charges on a business date ("2026-07-01"), as services/tax.py picks them. */
export function ratesOn(province: string | null, day: string): DocRate[] {
    const current = new Map<string, RateRow>();
    for (const row of TAX_RATES) {
        if (row.province !== province || row.from > day) continue;
        const seen = current.get(row.code);
        if (seen === undefined || row.from > seen.from) current.set(row.code, row);
    }
    return [...current.values()]
        .filter((r) => r.ppm > 0)
        .map((r) => ({ code: r.code, ppm: r.ppm }));
}

export type ItemTaxClass = "standard" | "federal_only" | "exempt";

export function asTaxClass(value: string | null | undefined): ItemTaxClass {
    return value === "federal_only" || value === "exempt" ? value : "standard";
}

function halfUp(num: number, den: number): number {
    const whole = Math.floor((2 * Math.abs(num) + den) / (2 * den));
    return num < 0 ? 0 - whole : whole;
}

/** One line's tax per code, as services/tax.py works it: exact rates, each code half up. */
export function lineTax(
    amountCents: number,
    taxClass: ItemTaxClass,
    rates: readonly DocRate[],
    inclusive = false,
): Record<string, number> {
    const applied =
        taxClass === "exempt"
            ? []
            : rates.filter((r) => taxClass === "standard" || isFederal(r.code));
    const den = 1_000_000 + (inclusive ? applied.reduce((sum, r) => sum + r.ppm, 0) : 0);
    return Object.fromEntries(applied.map((r) => [r.code, halfUp(amountCents * r.ppm, den)]));
}

/** Today's date where the business is, the day its tax rates are read on. */
export function useBusinessDay(): string {
    return dateKey(new Date(), useBusinessZone());
}

function taxLinesFor(province: string | null, day: string): DocRate[] {
    const rates = ratesOn(province, day);
    // A business without a province is shown the GST alone, as Alberta charges it.
    return rates.length > 0 ? rates : ratesOn("AB", day);
}

const rateLabel = (r: DocRate): string => taxRateLabel(r.code, r.ppm / 100);

/** "GST 5% + PST 7%" for a province; federal_only keeps only the GST or HST. */
export function taxSummary(
    province: string | null,
    day: string,
    cls: "standard" | "federal_only" = "standard",
): string {
    const labels = taxLinesFor(province, day)
        .filter((l) => cls === "standard" || isFederal(l.code))
        .map(rateLabel);
    return taxList(labels);
}

type FilingFrequency = "monthly" | "quarterly" | "annual";
type TaxRegistration = "registered" | "small";

export const TAX_CLASS_KEYS: ItemTaxClass[] = ["federal_only", "standard", "exempt"];
export const FILING_FREQUENCIES: FilingFrequency[] = ["monthly", "quarterly", "annual"];

const GST_FORMAT = /^\d{9}RT\d{4}$/;
const PST_FORMAT = /^(PST)?\d{8}$/;
const compact = (v: string): string => v.replace(/[\s-]/g, "").toUpperCase();

/** The class names for a province: "GST + PST" in BC, "HST" in Ontario. */
export function taxClassLabel(cls: ItemTaxClass, province: string | null, day: string): string {
    if (cls === "exempt") return t.classes.exempt;
    const lines = taxLinesFor(province, day);
    const names = taxList(
        lines.filter((l) => cls === "standard" || isFederal(l.code)).map((l) => taxName(l.code)),
    );
    return cls === "federal_only" && lines.length > 1 ? t.only(names) : names;
}

/** "Service, GST only" for the worked example; the no-tax card is just "No tax". */
export function taxExampleTitle(cls: ItemTaxClass, province: string | null, day: string): string {
    const kind = t.exampleFor[cls];
    const label = taxClassLabel(cls, province, day);
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
    day: string,
    cents = EXAMPLE_SALE_CENTS,
): { lines: TaxExampleLine[]; totalCents: number } {
    const byCode = collect ? lineTax(cents, cls, taxLinesFor(province, day)) : {};
    const lines = taxLinesFor(province, day)
        .filter((r) => r.code in byCode)
        .map((r) => ({ label: rateLabel(r), cents: byCode[r.code] ?? 0 }));
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
    const zone = useBusinessZone();
    const lines = taxLinesFor(province, dateKey(new Date(), zone));
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
            label: rateLabel(l),
            level: isFederal(l.code) ? "federal" : "provincial",
        })),
        hasPst: lines.some((l) => l.code === "PST" || l.code === "RST"),
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

export const TAX_SETUP_SQL = "SELECT province, tax_registered FROM businesses LIMIT 1";

interface TaxSetup {
    province: string | null;
    rates: DocRate[];
    registered: boolean;
    // false until the business row syncs, so nothing is charged at rates not yet known
    ready: boolean;
}

/** The rates this business charges today, and whether it collects tax at all (a small supplier doesn't). */
export function useTaxSetup(): TaxSetup {
    const row = useQuery<{ province: string | null; tax_registered: number | null }>(TAX_SETUP_SQL)
        .data[0];
    const day = useBusinessDay();
    return {
        province: row?.province ?? null,
        rates: ratesOn(row?.province ?? null, day),
        registered: row?.tax_registered !== 0,
        ready: row !== undefined,
    };
}
