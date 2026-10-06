import {
    type StatProps,
    formatMoney,
    formatMoneyWithCurrency,
} from "@clientbridge/app-core/public";

import { type WebProps, cx } from "./props";

const TONE = {
    ink: "text-ink",
    muted: "text-muted",
    success: "text-success",
    danger: "text-danger",
} as const;

export function Stat({
    label,
    cents,
    value,
    tone = "ink",
    hint,
    size = "md",
    className,
}: WebProps<StatProps>) {
    const large = size === "lg";
    const money = (c: number): string =>
        large ? formatMoneyWithCurrency(c, "CAD") : formatMoney(c);
    const shown = value ?? (cents === null || cents === undefined ? null : money(cents));
    return (
        <div
            className={cx(
                large
                    ? "rounded-lg border border-line bg-surface p-5 shadow-card"
                    : "rounded-md border border-line bg-bg p-4",
                className,
            )}
        >
            <p className="text-sm text-muted">{label}</p>
            {shown === null ? (
                <div
                    className={`mt-2 animate-pulse rounded-base bg-bg ${large ? "h-8 w-32" : "h-7 w-24"}`}
                />
            ) : (
                <p
                    className={`mt-1 font-display font-bold tabular-nums ${TONE[tone]} ${large ? "text-3xl" : "text-2xl"}`}
                >
                    {shown}
                </p>
            )}
            {hint !== undefined ? <p className="mt-1.5 text-xs text-muted">{hint}</p> : null}
        </div>
    );
}
