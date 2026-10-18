import type { BadgeProps } from "@clientbridge/app-core/public";
import { INTENT_COLORS, ON_DATA, cssVar } from "@clientbridge/tokens";

import { type WebProps, cx } from "./props";

export function Badge({
    label,
    intent = "accent",
    variant = "pill",
    className,
}: WebProps<BadgeProps>) {
    if (variant === "count") {
        const solid = INTENT_COLORS[intent].line;
        return (
            <span
                style={
                    intent === "accent"
                        ? undefined
                        : { backgroundColor: cssVar(solid), color: ON_DATA }
                }
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
