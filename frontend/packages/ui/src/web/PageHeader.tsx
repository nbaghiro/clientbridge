import type { PageHeaderProps } from "@clientbridge/app-core/public";

import type { WebProps } from "./props";

export function PageHeader({
    title,
    subtitle,
    actions,
    children,
    className,
}: WebProps<PageHeaderProps>) {
    return (
        <header className={className}>
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <h1 className="font-display text-2xl font-bold text-ink">{title}</h1>
                    {subtitle !== undefined ? (
                        <p className="mt-0.5 text-sm text-muted">{subtitle}</p>
                    ) : null}
                </div>
                {actions !== undefined ? (
                    <div className="flex shrink-0 items-center gap-2">{actions}</div>
                ) : null}
            </div>
            {children !== undefined ? <div className="mt-4">{children}</div> : null}
        </header>
    );
}
