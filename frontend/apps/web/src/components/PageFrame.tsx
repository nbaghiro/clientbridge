import type { ReactNode } from "react";

// A card that fills the window under a page header with tabs, such as the Inbox or the calendar.
export const FILL = "h-[calc(100vh-11.5rem)] min-h-[520px]";

// Every desktop page sits in this centred frame, so margins match across the app.
export function PageFrame({ className, children }: { className?: string; children: ReactNode }) {
    return (
        <div className={`mx-auto w-full max-w-[88rem] px-8 py-8 ${className ?? ""}`}>
            {children}
        </div>
    );
}
