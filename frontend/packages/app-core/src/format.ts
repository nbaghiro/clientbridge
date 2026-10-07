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
