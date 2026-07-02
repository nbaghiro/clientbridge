import type { PublicBrand } from "@clientbridge/app-core/public";
import type { CSSProperties, ReactNode } from "react";

import { isEmbedded } from "../embed";

const WIDTHS = { md: "max-w-md", xl: "max-w-xl", "2xl": "max-w-2xl" } as const;

/** The card shell shared by every public customer surface. Applies the business's brand colour (as
 *  the `--accent` token) + shows its logo + tagline, falling back to plain Pewter when unbranded.
 *  When embedded it drops the full-screen chrome and sizes to its content so the host iframe fits it. */
export function PublicFrame({
    brand,
    size = "md",
    children,
}: {
    brand?: PublicBrand | null;
    size?: keyof typeof WIDTHS;
    children: ReactNode;
}) {
    const primary = brand?.primary ?? null;
    const logoUrl = brand?.logo_url ?? null;
    const tagline = brand?.tagline ?? null;
    const style = primary !== null ? ({ "--accent": primary } as CSSProperties) : undefined;
    const outer = isEmbedded()
        ? "flex justify-center p-2"
        : "flex min-h-screen items-center justify-center bg-bg px-4 py-10";

    return (
        <div style={style} className={outer}>
            <div
                className={`w-full rounded-xl border border-line bg-surface p-7 shadow-card ${WIDTHS[size]}`}
            >
                {logoUrl !== null || tagline !== null ? (
                    <div className="mb-6 flex flex-col items-center gap-2 text-center">
                        {logoUrl !== null ? (
                            <img src={logoUrl} alt="" className="h-12 w-auto" />
                        ) : null}
                        {tagline !== null ? <p className="text-xs text-muted">{tagline}</p> : null}
                    </div>
                ) : null}
                {children}
            </div>
        </div>
    );
}

export function PublicCentered({ children }: { children: ReactNode }) {
    return <p className="py-8 text-center text-sm text-muted">{children}</p>;
}
