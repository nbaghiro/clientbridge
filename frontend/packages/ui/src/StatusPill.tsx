import type { Intent } from "@clientbridge/app-core/public";

const INTENT_BADGE: Record<Intent, string> = {
    accent: "bg-accent-weak text-accent-strong",
    success: "bg-ok-bg text-ok-fg",
    warning: "bg-warn-bg text-warn-fg",
    danger: "bg-surface text-danger",
    neutral: "bg-bg text-muted",
};

/** Raw status values are capitalized; `asWritten` keeps an already-worded label as it is. */
export function StatusPill({
    status,
    intent,
    asWritten = false,
}: {
    status: string;
    intent: Intent;
    asWritten?: boolean;
}) {
    return (
        <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${asWritten ? "" : "capitalize"} ${INTENT_BADGE[intent]}`}
        >
            {status}
        </span>
    );
}
