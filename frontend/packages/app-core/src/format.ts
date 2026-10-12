import { activeLocale } from "./locale";
import { strings } from "./strings";

type NumberOptions = Intl.NumberFormatOptions;

// Businesses price in Canadian dollars until the business record carries a currency.
export const BUSINESS_CURRENCY = "CAD";

const formatters = new Map<string, Intl.NumberFormat>();

function numberFormat(options: NumberOptions): Intl.NumberFormat {
    const locale = activeLocale();
    const key = `${locale}|${JSON.stringify(options)}`;
    let format = formatters.get(key);
    if (format === undefined) {
        format = new Intl.NumberFormat(locale, options);
        formatters.set(key, format);
    }
    return format;
}

const currencyOptions = (currency: string): NumberOptions => ({
    style: "currency",
    currency: currency.toUpperCase(),
});

// Amounts are held in the currency's minor unit: cents for CAD, whole yen for JPY.
function minorDigits(currency: string): number {
    return numberFormat(currencyOptions(currency)).resolvedOptions().maximumFractionDigits ?? 2;
}

const major = (cents: number, currency: string): number => cents / 10 ** minorDigits(currency);

/** Cents in the amount's own currency: "$1,234.56" for CAD, "US$12.50" for USD. */
export function formatMoney(cents: number | null, currency: string): string {
    return numberFormat(currencyOptions(currency)).format(major(cents ?? 0, currency));
}

/** A whole amount without its zero minor part, for limits and presets: "$25", "$30,000". */
export function formatMoneyShort(cents: number, currency: string): string {
    if (cents % 10 ** minorDigits(currency) !== 0) return formatMoney(cents, currency);
    const whole = {
        ...currencyOptions(currency),
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    };
    return numberFormat(whole).format(major(cents, currency));
}

/** An amount taken off, with a true minus sign: "−$5.00". */
export function formatCredit(cents: number, currency: string): string {
    if (cents === 0) return formatMoney(0, currency);
    return numberFormat(currencyOptions(currency))
        .formatToParts(-major(Math.abs(cents), currency))
        .map((p) => (p.type === "minusSign" ? "\u2212" : p.value))
        .join("");
}

/** An amount followed by its currency code, for a figure that must name it: "$12.50 USD". */
export function formatMoneyWithCurrency(cents: number, currency: string): string {
    const amount = numberFormat({
        ...currencyOptions(currency),
        currencyDisplay: "narrowSymbol",
    }).format(major(cents, currency));
    return strings.common.amountWithCurrency(amount, currency.toUpperCase());
}

/** Cents as a plain decimal for an amount field: "1250.50", in the locale's digits and separator. */
export function formatAmountInput(cents: number, currency: string): string {
    const digits = minorDigits(currency);
    return numberFormat({
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        useGrouping: false,
    }).format(major(cents, currency));
}

export function formatNumber(value: number, options: NumberOptions = {}): string {
    return numberFormat(options).format(value);
}

/** A star rating to one decimal: "4.7". */
export function formatRating(value: number): string {
    return numberFormat({ minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
}

/** A rate held in basis points: "5%", "9.975%". */
export function formatRate(bps: number): string {
    return numberFormat({ style: "percent", maximumFractionDigits: 3 }).format(bps / 10_000);
}

/** A share of a whole: 0.676 reads "67.6%". */
export function formatPercent(fraction: number, maximumFractionDigits = 1): string {
    return numberFormat({ style: "percent", maximumFractionDigits }).format(fraction);
}

/** Where the currency sign sits around an amount typed into a field. */
export function currencyAffix(currency: string): { prefix?: string; suffix?: string } {
    const parts = numberFormat(currencyOptions(currency)).formatToParts(1);
    const at = parts.findIndex((p) => p.type === "currency");
    const symbol = parts[at]?.value ?? "";
    const number = parts.findIndex((p) => p.type === "integer");
    return at < number ? { prefix: symbol } : { suffix: symbol };
}

function separators(): { group: string; decimal: string } {
    const parts = numberFormat({}).formatToParts(12345.6);
    return {
        group: parts.find((p) => p.type === "group")?.value ?? "",
        decimal: parts.find((p) => p.type === "decimal")?.value ?? ".",
    };
}

/** A number typed by a person in the active locale ("1,250.5"); null when blank or not a number. */
export function parseNumber(value: string): number | null {
    const { group, decimal } = separators();
    let plain = value.replace(/\s/g, "");
    if (group !== "") plain = plain.split(group).join("");
    plain = plain.replace(decimal, ".");
    return /^-?(\d+\.?\d*|\.\d+)$/.test(plain) ? Number(plain) : null;
}

function currencySigns(currency: string): string[] {
    const displays = ["symbol", "narrowSymbol", "code"] as const;
    const signs = displays.flatMap((currencyDisplay) =>
        numberFormat({ ...currencyOptions(currency), currencyDisplay })
            .formatToParts(1)
            .filter((p) => p.type === "currency")
            .map((p) => p.value),
    );
    return [...new Set(signs)].sort((a, b) => b.length - a.length);
}

/** An amount typed by a person ("$1,250.50") as cents; null when blank, negative or not a number. */
export function parseCents(value: string, currency: string): number | null {
    let text = value;
    for (const sign of currencySigns(currency)) text = text.split(sign).join("");
    const n = parseNumber(text);
    return n === null || n < 0 ? null : Math.round(n * 10 ** minorDigits(currency));
}

export const initials = (name: string): string =>
    name
        .trim()
        .split(/\s+/)
        .filter((w) => w !== "")
        .slice(0, 2)
        .map((w) => String.fromCodePoint(w.codePointAt(0) ?? 0))
        .join("")
        .toUpperCase();

export function blankToNull(value: string | null | undefined): string | null {
    const trimmed = value?.trim() ?? "";
    return trimmed.length > 0 ? trimmed : null;
}

/** The ten local digits of a North American number (a leading 1 dropped), else all digits. */
export function phoneDigits(value: string | null | undefined): string {
    return (value ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
}

/** The number as E.164 ("+12505550201"), by the rule the server applies; null when unreadable. */
export function normalizePhone(value: string | null | undefined): string | null {
    const raw = (value ?? "").trim();
    const international = raw.startsWith("+");
    let digits = raw.replace(/\D/g, "");
    if (!international && digits.length === 10) digits = `1${digits}`;
    if (international && digits.length >= 8 && digits.length <= 15 && !digits.startsWith("0"))
        return `+${digits}`;
    if (digits.length === 11 && digits.startsWith("1") && !["0", "1"].includes(digits[1] ?? ""))
        return `+${digits}`;
    return null;
}

/** "(250) 555-0201" for a North American number, stored local or as +1; anything else as entered. */
export function formatPhone(raw: string | null | undefined): string {
    const d = phoneDigits(raw);
    if (d.length !== 10) return raw ?? "";
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export function formatList(
    items: readonly string[],
    type: "conjunction" | "unit" = "conjunction",
): string {
    return new Intl.ListFormat(activeLocale(), {
        type,
        style: type === "unit" ? "short" : "long",
    }).format(items);
}

export function formatParts(parts: readonly (string | null | undefined | false)[]): string {
    return parts.filter((p) => typeof p === "string" && p !== "").join(strings.common.separator);
}

export function firstName(name: string): string {
    return name.trim().split(/\s+/)[0] ?? name;
}
