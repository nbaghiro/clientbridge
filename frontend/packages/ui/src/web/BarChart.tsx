import { type BarChartProps, type BarChartBar } from "@clientbridge/app-core/public";

import { type WebProps, cx } from "./props";

export function BarChart({ bars, label, height = 160, className }: WebProps<BarChartProps>) {
    const max = Math.max(1, ...bars.map((b) => b.value));
    return (
        <figure aria-label={label} role="img" className={cx("w-full", className)}>
            <div className="relative" style={{ height }}>
                {[0.5, 1].map((f) => (
                    <span
                        key={f}
                        aria-hidden
                        className="absolute inset-x-0 border-t border-dashed border-line-soft"
                        style={{ bottom: `${String(f * 100)}%` }}
                    />
                ))}
                <div className="absolute inset-0 flex items-end gap-[2px] border-b border-line">
                    {bars.map((b: BarChartBar) => (
                        <div
                            key={b.key}
                            className="group relative flex h-full flex-1 items-end justify-center"
                            title={`${b.label}: ${b.valueLabel}`}
                        >
                            <span
                                className={`w-full max-w-10 rounded-t transition group-hover:opacity-80 ${b.dim ? "bg-accent-line" : "bg-accent"} ${b.partial ? "opacity-50" : ""}`}
                                style={{ height: `${String(Math.max(2, (b.value / max) * 100))}%` }}
                            />
                            <span className="pointer-events-none absolute -top-7 z-10 hidden whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs font-medium tabular-nums text-surface group-hover:block">
                                {b.valueLabel}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
            <div className="mt-1.5 flex gap-[2px]">
                {bars.map((b) => (
                    <span
                        key={b.key}
                        className={`flex-1 text-center text-[11px] ${b.dim ? "text-muted" : "font-semibold text-ink-soft"}`}
                    >
                        {b.label}
                    </span>
                ))}
            </div>
        </figure>
    );
}
