import type { ModalProps } from "@clientbridge/app-core/public";
import { useEffect } from "react";

const WIDTH = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg", xl: "max-w-6xl" } as const;

export function Modal({ open = true, onClose, size = "md", framed = true, children }: ModalProps) {
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
        <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-scrim p-4"
            onClick={onClose}
        >
            <div
                role="dialog"
                aria-modal="true"
                onClick={(e) => {
                    e.stopPropagation();
                }}
                className={`w-full ${WIDTH[size]} ${
                    framed ? "rounded-xl border border-line bg-surface p-6 shadow-card" : ""
                }`}
            >
                {children}
            </div>
        </div>
    );
}
