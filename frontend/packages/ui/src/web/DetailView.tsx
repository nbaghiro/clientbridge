import {
    type DetailSectionProps,
    type DetailViewProps,
    strings,
} from "@clientbridge/app-core/public";
import { StatusPill } from "./StatusPill";
import { useEffect } from "react";

export function DetailView({
    open,
    title,
    subtitle,
    status,
    leading,
    onClose,
    actions,
    children,
}: DetailViewProps) {
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("keydown", onKey);
        };
    }, [open, onClose]);

    if (!open) return null;
    return (
        <div className="fixed inset-0 z-20 flex justify-end bg-scrim" onClick={onClose}>
            <aside
                role="dialog"
                aria-label={title}
                onClick={(e) => {
                    e.stopPropagation();
                }}
                className="flex h-full w-full max-w-[520px] flex-col border-l border-line bg-surface shadow-card"
            >
                <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-4">
                    <div className="flex min-w-0 items-center gap-3">
                        {leading}
                        <div className="min-w-0">
                            <h2 className="truncate font-display text-lg font-bold text-ink">
                                {title}
                            </h2>
                            {subtitle !== undefined ? (
                                <p className="mt-0.5 truncate text-sm text-muted">{subtitle}</p>
                            ) : null}
                        </div>
                    </div>
                    {status !== undefined ? (
                        <StatusPill status={status.status} intent={status.intent} />
                    ) : null}
                </div>
                <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">{children}</div>
                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-6 py-4">
                    {actions}
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-bg"
                    >
                        {strings.common.close}
                    </button>
                </div>
            </aside>
        </div>
    );
}

export function DetailSection({ title, action, children }: DetailSectionProps) {
    return (
        <section>
            {title !== undefined || action !== undefined ? (
                <div className="flex items-center justify-between">
                    {title !== undefined ? (
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                            {title}
                        </h3>
                    ) : (
                        <span />
                    )}
                    {action}
                </div>
            ) : null}
            <div className={title !== undefined || action !== undefined ? "mt-2" : ""}>
                {children}
            </div>
        </section>
    );
}
