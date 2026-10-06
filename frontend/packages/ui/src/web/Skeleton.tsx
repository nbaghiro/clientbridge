import type { SkeletonProps } from "@clientbridge/app-core/public";

const bar = "animate-pulse rounded bg-surface2";

const COLS = {
    2: "grid grid-cols-2",
    3: "grid grid-cols-3",
    4: "grid grid-cols-2 lg:grid-cols-4",
} as const;

export function Skeleton({ variant, count = 1, columns, label }: SkeletonProps) {
    return (
        <div
            role="status"
            aria-label={label}
            aria-busy="true"
            className={columns ? COLS[columns] : undefined}
        >
            {Array.from({ length: count }, (_, i) =>
                variant === "row" ? (
                    <div key={i} className="flex items-center gap-3 px-4 py-3">
                        <span className={`h-9 w-9 shrink-0 rounded-md ${bar}`} />
                        <span className="flex-1 space-y-2">
                            <span
                                className={`block h-3 ${bar}`}
                                style={{ width: `${String(52 - ((i * 13) % 24))}%` }}
                            />
                            <span
                                className={`block h-2.5 ${bar}`}
                                style={{ width: `${String(34 - ((i * 7) % 14))}%` }}
                            />
                        </span>
                        <span className={`h-3 w-12 ${bar}`} />
                    </div>
                ) : variant === "stat" ? (
                    <div key={i} className="space-y-2.5 px-5 py-4">
                        <span className={`block h-2.5 w-20 ${bar}`} />
                        <span className={`block h-6 w-28 ${bar}`} />
                        <span className={`block h-2 w-24 ${bar}`} />
                    </div>
                ) : (
                    <span
                        key={i}
                        className={`my-2 block h-3 ${bar}`}
                        style={{ width: `${String(90 - ((i * 17) % 40))}%` }}
                    />
                ),
            )}
        </div>
    );
}
