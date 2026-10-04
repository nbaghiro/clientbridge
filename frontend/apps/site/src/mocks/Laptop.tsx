import type { ReactNode } from "react";

/** A laptop drawn in CSS: dark bezel with a camera notch over a light aluminium base. */
export function Laptop({ children }: { children: ReactNode }) {
    return (
        <div className="laptop" aria-hidden="true">
            <div className="lt-lid">
                <i className="lt-notch" />
                <div className="lt-scr">{children}</div>
            </div>
            <div className="lt-base">
                <i className="lt-lip" />
            </div>
        </div>
    );
}
