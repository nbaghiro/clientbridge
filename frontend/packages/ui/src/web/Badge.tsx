import type { BadgeProps } from "@clientbridge/app-core/public";
import { INTENT_COLORS, cssVar } from "@clientbridge/tokens";

import { type WebProps, cx } from "./props";

export function Badge({
    label,
    intent = "accent",
    variant = "pill",
    className,
}: WebProps<BadgeProps>) {
    if (variant === "count") {
        return (
            <span
                className={cx(
                    "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-ink",
                    className,
                )}
            >
                {label}
            </span>
        );
    }
    const tone = INTENT_COLORS[intent];
    return (
        <span
            style={{ backgroundColor: cssVar(tone.soft), color: cssVar(tone.ink) }}
            className={cx(
                "inline-block max-w-full truncate whitespace-nowrap rounded-full px-2 py-0.5 align-middle text-xs font-medium",
                className,
            )}
        >
            {label}
        </span>
    );
}
