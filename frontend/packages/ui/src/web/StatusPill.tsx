import type { Intent } from "@clientbridge/app-core/public";
import { INTENT_COLORS, cssVar } from "@clientbridge/tokens";

import { type WebProps, cx } from "./props";

/** Raw status values are capitalized; `asWritten` keeps an already-worded label as it is. */
export function StatusPill({
    status,
    intent,
    asWritten = false,
    className,
}: WebProps<{
    status: string;
    intent: Intent;
    asWritten?: boolean;
}>) {
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
