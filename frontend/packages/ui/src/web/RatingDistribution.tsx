import type { RatingDistributionProps } from "@clientbridge/app-core/public";

export function RatingDistribution({ rows, label }: RatingDistributionProps) {
    const max = Math.max(1, ...rows.map((r) => r.count));
    return (
        <ul className="space-y-1.5">
            {rows.map((r) => (
                <li
                    key={r.stars}
                    aria-label={label(r.stars, r.count)}
                    className="flex items-center gap-2.5 text-xs"
                >
                    <span aria-hidden className="w-6 shrink-0 tabular-nums text-muted">
                        {r.stars}★
                    </span>
                    <span
                        aria-hidden
                        className="h-2 flex-1 overflow-hidden rounded-full bg-surface2"
                    >
                        <span
                            className="block h-full rounded-full bg-accent"
                            style={{ width: `${String((r.count / max) * 100)}%` }}
                        />
                    </span>
                    <span aria-hidden className="w-4 shrink-0 text-right tabular-nums text-muted">
                        {r.count}
                    </span>
                </li>
            ))}
        </ul>
    );
}
