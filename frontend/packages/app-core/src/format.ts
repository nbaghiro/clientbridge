export const formatMoney = (cents: number | null): string =>
    `$${((cents ?? 0) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2 })}`;

export const initials = (name: string): string =>
    name
        .split(" ")
        .map((w) => w[0] ?? "")
        .slice(0, 2)
        .join("")
        .toUpperCase();
