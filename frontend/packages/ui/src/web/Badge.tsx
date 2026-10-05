import type { BadgeProps, Intent } from "@clientbridge/app-core/public";

const PILL: Record<Intent, string> = {
    accent: "bg-accent-weak text-accent-strong",
    success: "bg-ok-bg text-ok-fg",
    warning: "bg-warn-bg text-warn-fg",
    danger: "bg-danger-bg text-danger-fg",
    neutral: "bg-bg text-muted",
};

export function Badge({ label, intent = "accent", kind = "pill" }: BadgeProps) {
    if (kind === "count") {
        return (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-ink">
                {label}
            </span>
        );
    }
    return (
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PILL[intent]}`}>
            {label}
        </span>
    );
}
