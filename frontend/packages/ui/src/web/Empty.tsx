import type { EmptyProps } from "@clientbridge/app-core/public";

import { Logo } from "./Logo";
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
    const Heading = variant === "page" ? "h1" : "h2";
    const content = (
        <div
            role={danger ? "alert" : undefined}
            className={cx(
                `flex flex-col items-center px-6 text-center ${variant === "page" ? "w-full max-w-md rounded-xl border border-line bg-surface py-10 shadow-card" : variant === "card" ? "rounded-lg border border-dashed border-line bg-surface py-12" : "py-10"}`,
                className,
            )}
        >
            {icon !== undefined ? <Icon name={icon} size={28} className="text-muted" /> : null}
            <Heading
                className={`${variant === "page" ? "font-display text-xl font-bold" : "text-base font-semibold"} text-ink ${icon !== undefined ? "mt-3" : ""}`}
            >
                {message}
            </Heading>
            {body !== undefined ? (
                <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">{body}</p>
            ) : null}
            {actions !== undefined ? (
                <div className="mt-4 flex flex-wrap justify-center gap-2">{actions}</div>
            ) : null}
        </div>
    );
    return variant === "page" ? (
        <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-bg px-4 py-10">
            <Logo className="h-8 w-auto text-accent" />
            {content}
        </div>
    ) : (
        content
    );
}
