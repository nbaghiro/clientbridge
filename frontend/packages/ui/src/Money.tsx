import { type MoneyProps, formatMoney } from "@clientbridge/app-core/public";

const TONES: Record<NonNullable<MoneyProps["tone"]>, string> = {
    ink: "text-ink",
    muted: "text-muted",
    success: "text-success",
    danger: "text-danger",
};

export function Money({ cents, tone = "ink", strong = false }: MoneyProps) {
    return (
        <span className={`tabular-nums ${TONES[tone]} ${strong ? "font-semibold" : "font-medium"}`}>
            {formatMoney(cents)}
        </span>
    );
}
