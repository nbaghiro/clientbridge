import type { ReactNode } from "react";

/** The card a working view lives in (calendar, classes, sales): a header row, then the view. */
export function Workspace({
    header,
    className = "",
    children,
}: {
    header: ReactNode;
    className?: string;
    children: ReactNode;
}) {
    return (
        <div
            className={`relative flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card ${className}`}
        >
            <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-5 py-3">
                {header}
            </header>
            {children}
        </div>
    );
}

/** The strip of figures under a working view's header. */
export function SummaryStrip({ items }: { items: readonly { label: string; value: string }[] }) {
    return (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-line bg-bg/60 px-5 py-2 text-sm">
            {items.map((it) => (
                <span key={it.label} className="flex items-baseline gap-1.5">
                    <span className="text-xs text-muted">{it.label}</span>
                    <span className="font-semibold text-ink">{it.value}</span>
                </span>
            ))}
        </div>
    );
}
