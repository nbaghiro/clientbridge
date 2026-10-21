import type { PanelProps } from "@clientbridge/app-core/public";

import { type WebProps, cx } from "./props";

export function Panel({
    title,
    subtitle,
    actions,
    flush = false,
    footer,
    children,
    className,
}: WebProps<PanelProps>) {
    const head = title !== undefined || subtitle !== undefined || actions !== undefined;
    return (
        <section
            className={cx(
                `overflow-hidden rounded-lg border border-line bg-surface shadow-card ${flush ? "" : "p-5"}`,
                className,
            )}
        >
            {head ? (
                <div
                    className={`flex flex-wrap items-center justify-between gap-4 ${flush ? "border-b border-line px-4 py-3" : "mb-4"}`}
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
                        <div className="flex max-w-full flex-wrap items-center gap-2">
                            {actions}
                        </div>
                    ) : null}
                </div>
            ) : null}
            <div className={flush ? "" : "space-y-3"}>{children}</div>
            {footer !== undefined ? (
                <div
                    className={`flex flex-wrap items-center justify-end gap-3 border-t border-line bg-bg/50 py-3 ${flush ? "px-4" : "-mx-5 -mb-5 mt-5 px-5"}`}
                >
                    {footer}
                </div>
            ) : null}
        </section>
    );
}
