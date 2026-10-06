import type { MeterProps } from "@clientbridge/app-core/public";
import { INTENT_COLORS, cssVar } from "@clientbridge/tokens";

export function Meter({
    value,
    max,
    label,
    detail,
    intent = "accent",
    units = false,
    overflow = 0,
    marker = null,
    labelPosition = "above",
    size = "md",
}: MeterProps) {
    const scale = Math.max(1, max);
    const share = Math.max(0, Math.min(1, value / scale));
    const tone = INTENT_COLORS[intent];
    const fill = cssVar(tone.line);
    const h = size === "sm" ? "h-1.5" : "h-2";
    const bar = (
        <div
            role="meter"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={scale}
            aria-valuenow={value}
            className={labelPosition === "beside" ? "min-w-12 flex-1" : undefined}
        >
            {units ? (
                <div className="flex items-center gap-0.5">
                    {Array.from({ length: scale }, (_, i) => (
                        <span
                            key={i}
                            style={
                                i < Math.round(share * scale)
                                    ? { backgroundColor: fill }
                                    : undefined
                            }
                            className={`${h} flex-1 rounded-full bg-line`}
                        />
                    ))}
                    {overflow > 0 ? (
                        <span className="ml-1 flex shrink-0 gap-0.5">
                            {Array.from({ length: Math.min(overflow, 4) }, (_, i) => (
                                <span
                                    key={i}
                                    style={{ borderColor: fill }}
                                    className={`${h} w-2 rounded-full border border-dashed`}
                                />
                            ))}
                        </span>
                    ) : null}
                </div>
            ) : (
                <div className={`relative ${h} overflow-hidden rounded-full bg-line`}>
                    <span
                        style={{
                            width: `${String(value > 0 ? Math.max(4, share * 100) : 0)}%`,
                            backgroundColor: fill,
                        }}
                        className="block h-full rounded-full"
                    />
                    {marker !== null ? (
                        <span
                            style={{ left: `${String(Math.min(100, (marker / scale) * 100))}%` }}
                            className="absolute inset-y-0 w-px bg-ink/25"
                        />
                    ) : null}
                </div>
            )}
        </div>
    );
    if (labelPosition === "hidden") return bar;
    if (labelPosition === "beside") {
        return (
            <div className="flex min-w-0 items-center gap-2.5">
                {bar}
                <span className="shrink-0 text-xs font-medium" style={{ color: cssVar(tone.ink) }}>
                    {label}
                </span>
            </div>
        );
    }
    if (labelPosition === "below") {
        return (
            <div className="min-w-0">
                {bar}
                <p className="mt-1 text-xs text-muted">{label}</p>
            </div>
        );
    }
    return (
        <div>
            <div className="mb-2 flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold text-ink">{label}</span>
                {detail !== undefined ? <span className="text-xs text-muted">{detail}</span> : null}
            </div>
            {bar}
        </div>
    );
}
