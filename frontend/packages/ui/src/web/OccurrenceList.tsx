import { type OccurrenceListProps, type OccurrenceRow } from "@clientbridge/app-core/public";
import { INTENT_COLORS, cssVar } from "@clientbridge/tokens";

import { Badge } from "./Badge";
import { Icon } from "./Icon";
import { type WebProps, cx } from "./props";

export function OccurrenceList({
    rows,
    label,
    onAction,
    className,
}: WebProps<OccurrenceListProps>) {
    return (
        <ol aria-label={label} className={cx("divide-y divide-line-soft", className)}>
            {rows.map((r: OccurrenceRow) => (
                <li key={r.key} className="flex gap-3 py-2.5">
                    <span className="w-7 shrink-0 pt-0.5 text-right text-xs tabular-nums text-muted">
                        {r.index}
                    </span>
                    <span
                        aria-hidden
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${r.past === true ? "opacity-50" : ""}`}
                        style={{ backgroundColor: cssVar(INTENT_COLORS[r.intent].line) }}
                    />
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span
                                className={`text-sm font-medium ${r.past === true ? "text-muted" : r.intent === "neutral" ? "text-muted line-through" : "text-ink"}`}
                            >
                                {r.date}
                            </span>
                            <span className="text-sm text-muted">{r.time}</span>
                            <span className="ml-auto">
                                <Badge label={r.state} intent={r.intent} />
                            </span>
                        </div>
                        {r.flag ? (
                            <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-accent">
                                <Icon name="clock" size={12} />
                                {r.flag}
                            </p>
                        ) : null}
                        {r.note ? (
                            <p
                                className={`mt-0.5 text-xs ${r.intent === "danger" || r.intent === "warning" ? "text-warn" : "text-muted"}`}
                            >
                                {r.note}
                            </p>
                        ) : null}
                        {r.actions && r.actions.length > 0 ? (
                            <div
                                className="mt-2 flex flex-wrap gap-2"
                                role="group"
                                aria-label={`${r.date} ${r.note ?? ""}`}
                            >
                                {r.actions.map((a) => (
                                    <button
                                        key={a.key}
                                        type="button"
                                        aria-pressed={a.selected === true}
                                        onClick={() => {
                                            onAction?.(r.key, a.key);
                                        }}
                                        className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                                            a.selected === true
                                                ? "border-accent bg-accent-weak text-accent-strong"
                                                : "border-line bg-surface text-ink-soft hover:bg-bg hover:text-ink"
                                        }`}
                                    >
                                        {a.label}
                                    </button>
                                ))}
                            </div>
                        ) : null}
                    </div>
                </li>
            ))}
        </ol>
    );
}
