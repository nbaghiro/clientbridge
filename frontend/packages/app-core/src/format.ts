export const formatMoney = (cents: number | null): string => {
    const c = cents ?? 0;
    const abs = (Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2 });
    return c < 0 ? `-$${abs}` : `$${abs}`;
};

export const formatMoneyWithCurrency = (cents: number, currency: string): string =>
    `${formatMoney(cents)} ${currency.toUpperCase()}`;

export const initials = (name: string): string =>
    name
        .split(" ")
        .map((w) => w[0] ?? "")
        .slice(0, 2)
        .join("")
        .toUpperCase();

export function blankToNull(value: string | null | undefined): string | null {
    const trimmed = value?.trim() ?? "";
    return trimmed.length > 0 ? trimmed : null;
}

/** Dollars typed by a person ("$1,250.50") as cents; null when blank, negative or not a number. */
export function parseCents(value: string): number | null {
    const n = Number(value.replace(/[$,\s]/g, ""));
    return value.trim() === "" || !Number.isFinite(n) || n < 0 ? null : Math.round(n * 100);
}

/** The ten local digits of a North American number (a leading 1 dropped), else all digits. */
export function phoneDigits(value: string | null | undefined): string {
    return (value ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
}

/** "(250) 555-0201" for a North American number, stored local or as +1; anything else as entered. */
export function formatPhone(raw: string | null | undefined): string {
    const d = phoneDigits(raw);
    if (d.length !== 10) return raw ?? "";
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export function firstName(name: string): string {
    return name.trim().split(/\s+/)[0] ?? name;
}
