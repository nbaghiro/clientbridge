import { type ActionMenuProps, type ActionMenuItem } from "@clientbridge/app-core/public";
import { useEffect, useRef } from "react";

import { Icon } from "./Icon";
import { moveFocus } from "./keys";
import { type WebProps, cx } from "./props";

const PLACE = {
    "below-start": "left-0 top-full mt-2",
    "below-end": "right-0 top-full mt-2",
    "above-start": "bottom-full left-0 mb-2",
} as const;

export function ActionMenu({
    open,
    onClose,
    title,
    items,
    onSelect,
    layout = "list",
    footer,
    placement = "below-start",
    className,
}: WebProps<ActionMenuProps>) {
    const ref = useRef<HTMLDivElement>(null);
    const close = useRef(onClose);
    useEffect(() => {
        close.current = onClose;
    });
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === "Escape") close.current();
        };
        const onDown = (e: MouseEvent): void => {
            if (ref.current && !ref.current.parentElement?.contains(e.target as Node))
                close.current();
        };
        const opener = document.activeElement;
        window.addEventListener("keydown", onKey);
        window.addEventListener("mousedown", onDown);
        ref.current?.querySelector("button")?.focus();
        return () => {
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("mousedown", onDown);
            if (opener instanceof HTMLElement) opener.focus();
        };
    }, [open]);
    if (!open) return null;
    return (
        <div
            ref={ref}
            role="menu"
            aria-label={title}
            onKeyDown={(e) => {
                moveFocus(e, '[role="menuitem"]', layout === "grid" ? "both" : "vertical");
            }}
            className={cx(
                `absolute z-30 overflow-hidden rounded-lg border border-line bg-surface shadow-pop ${PLACE[placement]} ${
                    layout === "grid" ? "w-[420px]" : "w-80"
                }`,
                className,
            )}
        >
            {title !== undefined ? (
                <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {title}
                </p>
            ) : null}
            <div className={layout === "grid" ? "grid grid-cols-2 gap-2 p-3" : "py-1.5"}>
                {items.map((item: ActionMenuItem) => (
                    <button
                        key={item.key}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                            onSelect(item.key);
                        }}
                        className={
                            layout === "grid"
                                ? "flex items-start gap-3 rounded-md border border-line-soft p-3 text-left transition hover:border-accent-line hover:bg-accent-weak focus:border-accent focus:outline-hidden"
                                : "flex w-full items-center gap-3 px-4 py-2 text-left transition hover:bg-bg focus:bg-bg focus:outline-hidden"
                        }
                    >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-weak text-accent">
                            <Icon name={item.icon} size={17} />
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-ink">
                                {item.label}
                            </span>
                            {item.hint !== undefined ? (
                                <span
                                    className={`block text-xs text-muted ${layout === "grid" ? "mt-0.5 leading-snug" : "truncate"}`}
                                >
                                    {item.hint}
                                </span>
                            ) : null}
                        </span>
                        {item.shortcut !== undefined && layout === "list" ? (
                            <kbd className="rounded border border-line bg-bg px-1.5 py-0.5 font-mono text-[11px] text-muted">
                                {item.shortcut}
                            </kbd>
                        ) : null}
                    </button>
                ))}
            </div>
            {footer !== undefined ? (
                <div className="border-t border-line-soft">{footer}</div>
            ) : null}
        </div>
    );
}
