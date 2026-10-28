import type { IconBadgeProps } from "@clientbridge/app-core/public";
import { INTENT_COLORS, cssVar } from "@clientbridge/tokens";

import { Icon } from "./Icon";
import { type WebProps, cx } from "./props";

export function IconBadge({
    icon,
    intent = "neutral",
    size = "md",
    className,
}: WebProps<IconBadgeProps>) {
    const tone = INTENT_COLORS[intent];
    return (
        <span
            aria-hidden
            className={cx(
                "flex shrink-0 items-center justify-center rounded-full",
                size === "sm" ? "h-8 w-8" : "h-10 w-10",
                className,
            )}
            style={{ backgroundColor: cssVar(tone.soft), color: cssVar(tone.ink) }}
        >
            <Icon name={icon} size={size === "sm" ? 16 : 19} />
        </span>
    );
}
