import { type MoneyProps, formatMoney } from "@clientbridge/app-core/public";

import { type WebProps, cx } from "./props";

const TONES: Record<NonNullable<MoneyProps["tone"]>, string> = {
    ink: "text-ink",
    muted: "text-muted",
    success: "text-success",
    danger: "text-danger",
};

export function Money({ cents, tone = "ink", strong = false, className }: WebProps<MoneyProps>) {
    return (
        <span
            className={cx(
                `tabular-nums ${TONES[tone]} ${strong ? "font-semibold" : "font-medium"}`,
                className,
            )}
        >
            {formatMoney(cents)
                .split(/([.,])/)
                .map((part, i) =>
                    part === "." || part === "," ? (
                        // Tabular figures give the separator a figure-wide gap in the UI font.
                        <span key={i} className="[font-variant-numeric:normal]">
                            {part}
                        </span>
                    ) : (
                        part
                    ),
                )}
        </span>
    );
}
