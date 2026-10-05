import type { PanelProps } from "@clientbridge/app-core/public";

export function Panel({ title, subtitle, actions, flush = false, children }: PanelProps) {
    const head = title !== undefined || subtitle !== undefined || actions !== undefined;
    return (
        <section
            className={`overflow-hidden rounded-lg border border-line bg-surface shadow-card ${flush ? "" : "p-5"}`}
        >
            {head ? (
                <div
                    className={`flex items-start justify-between gap-4 ${flush ? "border-b border-line px-4 py-3" : "mb-4"}`}
                >
                    <div className="min-w-0">
                        {title !== undefined ? (
                            <h3
                                className={`font-display font-bold text-ink ${flush ? "text-sm" : "text-base"}`}
                            >
                                {title}
                            </h3>
                        ) : null}
                        {subtitle !== undefined ? (
                            <p className="mt-0.5 text-sm text-muted">{subtitle}</p>
                        ) : null}
                    </div>
                    {actions !== undefined ? (
                        <div className="flex shrink-0 items-center gap-2">{actions}</div>
                    ) : null}
                </div>
            ) : null}
            <div className={flush ? "" : "space-y-3"}>{children}</div>
        </section>
    );
}
