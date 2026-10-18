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
