import { type UsageBarProps, type UsageBarSegment } from "@clientbridge/app-core/public";

import { type WebProps, cx } from "./props";

export function UsageBar({
    segments,
    total,
    now,
    ticks = [],
    label,
    className,
}: WebProps<UsageBarProps>) {
    const pct = (m: number): string => `${String((m / total) * 100)}%`;
    return (
        <div className={cx("min-w-0", className)}>
            <div
                role="img"
                aria-label={label}
                className="relative h-7 overflow-hidden rounded-md bg-bg"
            >
                {ticks.map((t) => (
                    <span
                        key={t.at}
                        aria-hidden
                        className="absolute inset-y-0 w-px bg-line-soft"
                        style={{ left: pct(t.at) }}
                    />
                ))}
                {segments.map((s: UsageBarSegment) => (
                    <span
                        key={s.key}
                        title={s.label}
                        className="absolute inset-y-1 truncate rounded-[4px] px-1.5 text-[10px] font-semibold leading-5 text-on-data"
                        style={{
                            left: pct(s.from),
                            width: pct(s.to - s.from),
                            backgroundColor: s.color ?? undefined,
                        }}
                    >
                        {s.label}
                    </span>
                ))}
                {now !== undefined && now !== null && now > 0 && now < total ? (
                    <span
                        aria-hidden
                        className="absolute inset-y-0 w-0.5 bg-danger"
                        style={{ left: pct(now) }}
                    />
                ) : null}
            </div>
            {ticks.length > 0 ? (
                <div aria-hidden className="relative mt-1 h-3">
                    {ticks.map((t) => (
                        <span
                            key={t.at}
                            className="absolute -translate-x-1/2 text-[10px] text-muted first:translate-x-0"
                            style={{ left: pct(t.at) }}
                        >
                            {t.label}
                        </span>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
