import { brandStyle } from "./PublicPage";
import { BusinessNavigation } from "./BusinessNavigation";
import type { PublicBrand } from "@clientbridge/app-core/public";
import type { ReactNode } from "react";

import { isEmbedded } from "../embed";

const WIDTHS = { md: "max-w-md", xl: "max-w-xl", "2xl": "max-w-2xl" } as const;

/** Card shell for every public page, in the business's colours; sized to content when embedded. */
export function PublicFrame({
    brand,
    size = "md",
    children,
}: {
    brand?: PublicBrand | null;
    size?: keyof typeof WIDTHS;
    children: ReactNode;
}) {
    const logoUrl = brand?.logo_url ?? null;
    const tagline = brand?.tagline ?? null;
    const style = brandStyle(brand ?? null);
    const outer = isEmbedded()
        ? "flex justify-center p-2"
        : "flex flex-1 items-center justify-center bg-bg px-4 py-10";

    return (
        <div
            style={style}
            className={isEmbedded() ? undefined : "flex min-h-screen flex-col bg-bg"}
        >
            <BusinessNavigation brand={brand} />
            <div className={outer}>
                <div
                    className={`w-full rounded-xl border border-line bg-surface p-7 shadow-card ${WIDTHS[size]}`}
                >
                    {logoUrl !== null || tagline !== null ? (
                        <div className="mb-6 flex flex-col items-center gap-2 text-center">
                            {logoUrl !== null ? (
                                <img src={logoUrl} alt="" className="h-12 w-auto" />
                            ) : null}
                            {tagline !== null ? (
                                <p className="text-xs text-muted">{tagline}</p>
                            ) : null}
                        </div>
                    ) : null}
                    {children}
                </div>
            </div>
        </div>
    );
}
