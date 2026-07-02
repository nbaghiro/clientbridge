import type { Intent } from "@clientbridge/app-core/public";

const INTENT_BADGE: Record<Intent, string> = {
    accent: "bg-accent-weak text-accent-strong",
    success: "bg-ok-bg text-ok-fg",
    warning: "bg-warn-bg text-warn-fg",
    danger: "bg-surface text-danger",
    neutral: "bg-bg text-muted",
};

export function StatusPill({ status, intent }: { status: string; intent: Intent }) {
    return (
        <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${INTENT_BADGE[intent]}`}
        >
            {status}
        </span>
    );
}
