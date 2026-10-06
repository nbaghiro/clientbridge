import type { EmptyProps } from "@clientbridge/app-core/public";

import { Icon } from "./Icon";
import { type WebProps, cx } from "./props";

export function Empty({
    message,
    body,
    icon,
    actions,
    intent = "neutral",
    variant = "inline",
    className,
}: WebProps<EmptyProps>) {
    if (
        body === undefined &&
        icon === undefined &&
        actions === undefined &&
        intent === "neutral" &&
        variant === "inline"
    ) {
        return (
            <p className={cx("px-4 py-12 text-center text-sm text-muted", className)}>{message}</p>
        );
    }
    const danger = intent === "danger";
    return (
        <div
            role={danger ? "alert" : undefined}
            className={cx(
                `flex flex-col items-center px-6 text-center ${variant === "card" ? "rounded-lg border border-dashed border-line bg-surface py-12" : "py-10"}`,
                className,
            )}
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
