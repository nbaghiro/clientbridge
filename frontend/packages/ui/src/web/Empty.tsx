import type { EmptyProps } from "@clientbridge/app-core/public";

import { Icon } from "./Icon";

/** The real Empty (one muted line) plus an optional icon, body, next-step actions, a danger tone and a card frame. */
export function Empty({
    message,
    body,
    icon,
    actions,
    intent = "neutral",
    size = "inline",
}: EmptyProps) {
    if (
        body === undefined &&
        icon === undefined &&
        actions === undefined &&
        intent === "neutral" &&
        size === "inline"
    ) {
        return <p className="px-4 py-12 text-center text-sm text-muted">{message}</p>;
    }
    const danger = intent === "danger";
    return (
        <div
            role={danger ? "alert" : undefined}
            className={`flex flex-col items-center px-6 text-center ${size === "card" ? "rounded-lg border border-dashed border-line bg-surface py-12" : "py-10"}`}
        >
            {icon !== undefined ? (
                <span
                    className={`flex h-11 w-11 items-center justify-center rounded-full ${danger ? "bg-danger-bg text-danger" : "bg-accent-weak text-accent"}`}
                >
                    <Icon name={icon} size={20} />
                </span>
            ) : null}
            <p className={`text-sm font-semibold text-ink ${icon !== undefined ? "mt-3" : ""}`}>
                {message}
            </p>
            {body !== undefined ? (
                <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">{body}</p>
            ) : null}
            {actions !== undefined ? (
                <div className="mt-4 flex flex-wrap justify-center gap-2">{actions}</div>
            ) : null}
        </div>
    );
}
