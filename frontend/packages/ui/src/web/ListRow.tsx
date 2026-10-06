import type { ListRowProps } from "@clientbridge/app-core/public";
import { INTENT_COLORS, cssVar } from "@clientbridge/tokens";

import { Icon } from "./Icon";

export function ListRow({
    title,
    detail,
    meta,
    icon,
    intent = "neutral",
    leading,
    trailing,
    unread,
    active,
    onPress,
    label,
    compact,
}: ListRowProps) {
    const tone = INTENT_COLORS[intent];
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
                    <span
                        style={{ backgroundColor: cssVar(tone.soft), color: cssVar(tone.ink) }}
                        className={`flex shrink-0 items-center justify-center rounded-md ${compact ? "h-8 w-8" : "h-9 w-9"}`}
                    >
                        <Icon name={icon} size={compact ? 16 : 18} />
                    </span>
                ) : null)}
            <span className="min-w-0 flex-1">
                <span
                    className={`block truncate text-sm text-ink ${unread ? "font-semibold" : "font-medium"}`}
                >
                    {title}
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
        <div className={`flex items-center gap-2 ${active ? "bg-accent-weak" : ""}`}>
            {onPress ? (
                <button
                    type="button"
                    onClick={onPress}
                    aria-label={label}
                    aria-current={active === true ? true : undefined}
                    className={`flex min-w-0 flex-1 items-center gap-3 text-left transition hover:bg-bg ${active ? "hover:bg-accent-weak" : ""} ${pad}`}
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
