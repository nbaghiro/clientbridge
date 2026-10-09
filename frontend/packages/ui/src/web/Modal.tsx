import type { ModalProps } from "@clientbridge/app-core/public";
import { createContext, useContext, useEffect, useId, useRef } from "react";

import { type WebProps, cx } from "./props";

const FlowContext = createContext(false);
export function useModalFlow(): boolean {
    return useContext(FlowContext);
}

const WIDTH = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg", xl: "max-w-6xl" } as const;
const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
    open = true,
    flow = false,
    onClose,
    size = "md",
    framed = true,
    children,
    className,
}: WebProps<ModalProps>) {
    const inFlow = useModalFlow();
    const dialogRef = useRef<HTMLDivElement>(null);
    const titleId = useId();
    const onCloseRef = useRef(onClose);
    useEffect(() => {
        onCloseRef.current = onClose;
    });

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!open || dialog === null) return;
        const heading = Array.from(dialog.querySelectorAll<HTMLElement>("h1, h2, h3")).find(
            (item) => item.getClientRects().length > 0,
        );
        if (heading) {
            if (heading.id === "") heading.id = titleId;
            dialog.setAttribute("aria-labelledby", heading.id);
        }
    }, [children, open, titleId]);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!open || dialog === null) return undefined;
        const returnTo =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const focusables = (): HTMLElement[] =>
            Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
                (item) => item.getClientRects().length > 0,
            );
        (focusables()[0] ?? dialog).focus();

        const onKey = (e: KeyboardEvent): void => {
            if (inFlow) return;
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
    }, [open, titleId, inFlow]);

    if (inFlow)
        return (
            <div
                ref={dialogRef}
                hidden={!open}
                tabIndex={-1}
                className={cx(
                    "h-full min-h-0 overflow-y-auto outline-hidden",
                    framed && "p-6",
                    className,
                )}
            >
                {children}
            </div>
        );
    if (!open) return null;
    return (
        <div
            className={cx(
                flow
                    ? "fixed inset-0 z-40 flex justify-end bg-scrim"
                    : "fixed inset-0 z-40 flex items-center justify-center bg-scrim p-4",
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
                className={`max-h-full w-full overflow-y-auto outline-hidden ${flow ? "h-full bg-surface shadow-card " + WIDTH[size] : WIDTH[size]} ${
                    framed ? "rounded-xl border border-line bg-surface p-6 shadow-card" : ""
                }`}
            >
                <FlowContext.Provider value={flow}>{children}</FlowContext.Provider>
            </div>
        </div>
    );
}
