import type { MessageBubbleProps } from "@clientbridge/app-core/public";

import { type WebProps, cx } from "./props";

export function MessageBubble({
    body,
    direction,
    meta,
    variant = "message",
    failed = false,
    width = "auto",
    className,
}: WebProps<MessageBubbleProps>) {
    if (variant === "event") {
        return (
            <p
                className={cx(
                    "mx-auto max-w-md rounded-full bg-surface2 px-3 py-1 text-center text-xs text-muted",
                    className,
                )}
            >
                {body}
            </p>
        );
    }
    const out = direction === "out";
    return (
        <div className={cx(`flex ${out ? "justify-end" : "justify-start"}`, className)}>
            <div
                className={`flex ${width === "full" ? "max-w-full" : "max-w-[75%]"} flex-col ${out ? "items-end" : "items-start"}`}
            >
                <div
                    className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                        out
                            ? `${failed ? "bg-danger-bg text-danger-fg" : "bg-accent text-accent-ink"} rounded-br-md`
                            : "rounded-bl-md border border-line bg-surface text-ink"
                    }`}
                >
                    {body}
                </div>
                {meta !== undefined ? (
                    <span className="mt-1 px-1 text-[11px] text-muted">{meta}</span>
                ) : null}
            </div>
        </div>
    );
}
