import { type ActivityTimelineProps, type TimelineEntry } from "@clientbridge/app-core/public";
import { INTENT_COLORS, cssVar } from "@clientbridge/tokens";

import { Icon } from "./Icon";
import { type WebProps, cx } from "./props";

export function ActivityTimeline({ entries, className }: WebProps<ActivityTimelineProps>) {
    return (
        <ol className={cx("relative", className)}>
            {entries.map((e: TimelineEntry, i) => {
                const tone = INTENT_COLORS[e.intent ?? "neutral"];
                const big = e.icon !== undefined;
                return (
                    <li
                        key={e.key}
                        className={`relative flex gap-3 last:pb-0 ${big ? "pb-5" : "pb-4"}`}
                    >
                        {i < entries.length - 1 ? (
                            <span
                                aria-hidden
                                className={`absolute w-px bg-line ${big ? "left-[13px] top-8 h-[calc(100%-28px)]" : "left-[5px] top-4 h-[calc(100%-10px)]"}`}
                            />
                        ) : null}
                        {big ? (
                            <span
                                aria-hidden
                                style={{
                                    backgroundColor: cssVar(tone.soft),
                                    color: cssVar(tone.ink),
                                }}
                                className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-4 ring-surface"
                            >
                                {e.icon !== undefined ? <Icon name={e.icon} size={14} /> : null}
                            </span>
                        ) : (
                            <span
                                aria-hidden
                                style={{ backgroundColor: cssVar(tone.line) }}
                                className="relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full ring-4 ring-surface"
                            />
                        )}
                        <div className={`min-w-0 flex-1 ${big ? "pt-1" : ""}`}>
                            <div className="flex items-baseline justify-between gap-3">
                                <p className="text-sm font-medium text-ink">{e.label}</p>
                                {e.aside !== undefined ? (
                                    <span className="shrink-0 text-sm font-medium tabular-nums text-ink">
                                        {e.aside}
                                    </span>
                                ) : (
                                    <time className="shrink-0 text-xs text-muted">{e.at}</time>
                                )}
                            </div>
                            {e.detail !== undefined || e.aside !== undefined ? (
                                <p className="mt-0.5 text-xs text-muted">
                                    {[e.detail, e.aside !== undefined ? e.at : undefined]
                                        .filter(Boolean)
                                        .join(" · ")}
                                </p>
                            ) : null}
                            {e.quote !== undefined ? (
                                <p className="mt-2 rounded-md bg-bg px-3 py-2 text-sm leading-relaxed text-ink-soft">
                                    {e.quote}
                                </p>
                            ) : null}
                        </div>
                    </li>
                );
            })}
        </ol>
    );
}
