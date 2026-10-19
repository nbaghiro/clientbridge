import type { ReactNode } from "react";

// Every desktop page sits in this centred frame, so margins match across the app.
export function PageFrame({ className, children }: { className?: string; children: ReactNode }) {
    return (
        <div className={`mx-auto w-full max-w-[88rem] px-8 py-8 ${className ?? ""}`}>
            {children}
        </div>
    );
}
