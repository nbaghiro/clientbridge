import { type KeyValueListProps, type KeyValueRow } from "@clientbridge/app-core/public";
import { INTENT_COLORS, cssVar } from "@clientbridge/tokens";

const COLS = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-2 sm:grid-cols-4" } as const;

export function KeyValueList({ rows, layout = "inline", columns = 2 }: KeyValueListProps) {
    return (
        <dl
            className={
                layout === "inline"
                    ? "divide-y divide-line-soft"
                    : `grid ${COLS[columns]} gap-x-6 gap-y-4`
            }
        >
            {rows.map((row: KeyValueRow) => (
                <div
                    key={row.label}
                    className={
                        layout === "inline"
                            ? "flex items-baseline justify-between gap-4 py-2.5"
                            : "min-w-0"
                    }
                >
                    <dt
                        className={
                            layout === "inline"
                                ? "text-sm text-muted"
                                : "text-xs font-medium uppercase tracking-wide text-muted"
                        }
                    >
                        {row.label}
                    </dt>
                    <dd
                        style={
                            row.intent
                                ? { color: cssVar(INTENT_COLORS[row.intent].ink) }
                                : undefined
                        }
                        className={`text-sm font-medium text-ink ${layout === "inline" ? "text-right" : "mt-1 truncate"}`}
                    >
                        {row.value}
                    </dd>
                </div>
            ))}
        </dl>
    );
}
