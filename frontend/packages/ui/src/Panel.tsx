import type { PanelProps } from "@clientbridge/app-core/public";

export function Panel({ title, children }: PanelProps) {
    return (
        <section className="mt-5 space-y-3 rounded-lg border border-line bg-surface p-5 shadow-card">
            <h3 className="font-display text-base font-bold text-ink">{title}</h3>
            {children}
        </section>
    );
}
