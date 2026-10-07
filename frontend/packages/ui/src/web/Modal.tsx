import type { ModalProps } from "@clientbridge/app-core/public";
import { useEffect, useId, useRef } from "react";

import { type WebProps, cx } from "./props";

const WIDTH = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg", xl: "max-w-6xl" } as const;
const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
    open = true,
    onClose,
    size = "md",
    framed = true,
    children,
    className,
}: WebProps<ModalProps>) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const titleId = useId();
    const onCloseRef = useRef(onClose);
    useEffect(() => {
        onCloseRef.current = onClose;
    });

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!open || dialog === null) return undefined;
        const returnTo =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const heading = dialog.querySelector("h1, h2, h3");
        if (heading !== null) {
            if (heading.id === "") heading.id = titleId;
            dialog.setAttribute("aria-labelledby", heading.id);
        }
        const focusables = (): HTMLElement[] =>
            Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
        (focusables()[0] ?? dialog).focus();

        const onKey = (e: KeyboardEvent): void => {
            if (e.key === "Escape") {
                onCloseRef.current();
                return;
            }
            if (e.key !== "Tab") return;
            const items = focusables();
            const first = items[0];
            const last = items[items.length - 1];
            if (first === undefined || last === undefined) {
                e.preventDefault();
                return;
            }
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("keydown", onKey);
            returnTo?.focus();
        };
    }, [open, titleId]);

    if (!open) return null;
    return (
        <div
            className={cx(
                "fixed inset-0 z-40 flex items-center justify-center bg-scrim p-4",
                className,
            )}
            onClick={onClose}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                tabIndex={-1}
                onClick={(e) => {
                    e.stopPropagation();
                }}
                className={`max-h-full w-full overflow-y-auto outline-hidden ${WIDTH[size]} ${
                    framed ? "rounded-xl border border-line bg-surface p-6 shadow-card" : ""
                }`}
            >
                {children}
            </div>
        </div>
    );
}
