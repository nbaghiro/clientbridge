import { type PublicBrand, strings } from "@clientbridge/app-core/public";
import { Icon } from "@clientbridge/ui";
import type { CSSProperties, ReactNode } from "react";

import { isEmbedded } from "../embed";

const WIDTHS = { narrow: "max-w-xl", wide: "max-w-5xl" } as const;

/** A full-width public page: the business header, then the content, in the business's colours. */
export function PublicPage({
    name,
    brand,
    subtitle,
    actions,
    width = "wide",
    children,
}: {
    name: string;
    brand: PublicBrand | null;
    subtitle?: string | null;
    actions?: ReactNode;
    width?: keyof typeof WIDTHS;
    children: ReactNode;
}) {
    const style =
        brand?.primary != null ? ({ "--accent": brand.primary } as CSSProperties) : undefined;
    const embedded = isEmbedded();
    const tagline = subtitle ?? brand?.tagline ?? null;
    return (
        <div style={style} className={embedded ? "bg-bg" : "min-h-screen bg-bg"}>
            {embedded ? null : (
                <header className="border-b border-line bg-surface">
                    <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
                        {brand?.logo_url != null ? (
                            <img
                                src={brand.logo_url}
                                alt=""
                                className="h-9 w-9 rounded-md object-contain"
                            />
                        ) : (
                            <span
                                aria-hidden
                                className="flex h-9 w-9 items-center justify-center rounded-md bg-accent font-display text-sm font-bold text-accent-ink"
                            >
                                {name.slice(0, 1).toUpperCase()}
                            </span>
                        )}
                        <div className="min-w-0 flex-1">
                            <p className="truncate font-display text-base font-bold text-ink">
                                {name}
                            </p>
                            {tagline !== null ? (
                                <p className="truncate text-xs text-muted">{tagline}</p>
                            ) : null}
                        </div>
                        {actions}
                    </div>
                </header>
            )}
            <main className={`mx-auto w-full px-4 py-8 ${WIDTHS[width]}`}>{children}</main>
            {embedded ? null : (
                <p className="pb-8 text-center text-xs text-muted">
                    {strings.publicBooking.poweredBy}
                </p>
            )}
        </div>
    );
}

export function Rating({ label }: { label: string }) {
    return (
        <span className="flex shrink-0 items-center gap-1.5 text-sm text-ink-soft">
            <Icon name="star" size={15} />
            {label}
        </span>
    );
}
