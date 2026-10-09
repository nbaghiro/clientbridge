import type { ListRowProps } from "@clientbridge/app-core/public";
import { INTENT_COLORS, cssVar } from "@clientbridge/tokens";

import { Icon } from "./Icon";
import { type WebProps, type WithRef, cx } from "./props";

export function ListRow({
    title,
    detail,
    meta,
    icon,
    intent = "neutral",
    leading,
    trailing,
    unread,
    selected,
    onPress,
    label,
    density = "regular",
    className,
    ref,
}: WebProps<ListRowProps> & WithRef<HTMLButtonElement>) {
    const compact = density === "compact";
    const flagged = intent === "danger" || intent === "warning";
    const body = (
        <>
            {unread !== undefined ? (
                <span
                    aria-hidden
                    className={`h-2 w-2 shrink-0 rounded-full ${unread ? "bg-accent" : "bg-transparent"}`}
                />
            ) : null}
            {leading ??
                (icon ? (
                    <span className="flex w-5 shrink-0 justify-center text-ink-soft">
                        <Icon name={icon} size={20} />
                    </span>
                ) : null)}
            <span className="min-w-0 flex-1">
                <span
                    className={`flex items-center gap-1.5 text-sm text-ink ${unread ? "font-semibold" : "font-medium"}`}
                >
                    {flagged ? (
                        <span
                            aria-hidden
                            style={{ backgroundColor: cssVar(INTENT_COLORS[intent].ink) }}
                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                        />
                    ) : null}
                    <span className="min-w-0 truncate">{title}</span>
                </span>
                {detail !== undefined ? (
                    <span className="mt-0.5 block truncate text-xs text-muted">{detail}</span>
                ) : null}
            </span>
            {meta !== undefined ? (
                <span className="shrink-0 text-right text-xs text-muted">{meta}</span>
            ) : null}
        </>
    );
    const pad = compact ? "px-3 py-2" : "px-4 py-3";
    return (
        <div
            className={cx(
                `flex items-center gap-2 ${selected === true ? "bg-accent-weak" : ""}`,
                className,
            )}
        >
            {onPress ? (
                <button
                    ref={ref}
                    type="button"
                    onClick={onPress}
                    aria-label={label}
                    aria-current={selected === true ? true : undefined}
                    className={`flex min-w-0 flex-1 items-center gap-3 text-left transition hover:bg-bg hover:text-ink ${selected === true ? "hover:bg-accent-weak" : ""} ${pad}`}
                >
                    {body}
                </button>
            ) : (
                <div className={`flex min-w-0 flex-1 items-center gap-3 ${pad}`}>{body}</div>
            )}
            {trailing !== undefined ? (
                <div className="flex shrink-0 items-center gap-2 pr-4">{trailing}</div>
            ) : null}
        </div>
    );
}
