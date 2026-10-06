import type { StatusPillProps } from "@clientbridge/app-core/public";
import { INTENT_COLORS, cssVar } from "@clientbridge/tokens";

import { type WebProps, cx } from "./props";

export function StatusPill({
    status,
    intent,
    asWritten = false,
    className,
}: WebProps<StatusPillProps>) {
    const tone = INTENT_COLORS[intent];
    return (
        <span
            style={{ backgroundColor: cssVar(tone.soft), color: cssVar(tone.ink) }}
            className={cx(
                `rounded-full px-2 py-0.5 text-xs font-medium ${asWritten ? "" : "capitalize"}`,
                className,
            )}
        >
            {status}
        </span>
    );
}
