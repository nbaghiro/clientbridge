import type { BadgeProps } from "@clientbridge/app-core/public";
import { INTENT_COLORS, cssVar } from "@clientbridge/tokens";

export function Badge({ label, intent = "accent", kind = "pill" }: BadgeProps) {
    if (kind === "count") {
        return (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-ink">
                {label}
            </span>
        );
    }
    const tone = INTENT_COLORS[intent];
    return (
        <span
            style={{ backgroundColor: cssVar(tone.soft), color: cssVar(tone.ink) }}
            className="rounded-full px-2 py-0.5 text-xs font-medium"
        >
            {label}
        </span>
    );
}
