import { type PublicBrand, strings } from "@clientbridge/app-core/public";
import { Avatar, Icon, IconButton } from "@clientbridge/ui";
import type { CSSProperties, ReactNode } from "react";

import { isEmbedded } from "../embed";

const WIDTHS = { narrow: "max-w-3xl", wide: "max-w-6xl" } as const;

export function brandStyle(brand: PublicBrand | null): CSSProperties | undefined {
    const primary = brand?.primary;
    if (!primary) return undefined;
    const hex = primary.slice(1);
    const full = hex.length === 3 ? hex.replace(/./g, "$&$&") : hex;
    const channels = [0, 2, 4].map((at) => {
        const value = parseInt(full.slice(at, at + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    const luminance =
        (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722;
    const ink = luminance > 0.179 ? "#000000" : "#ffffff";
    return {
        "--accent": primary,
        "--accent-ink": ink,
        "--brand-ink": ink,
        "--accent-strong": `color-mix(in srgb, ${primary} 82%, black)`,
        "--accent-weak": `color-mix(in srgb, ${primary} 8%, white)`,
        "--accent-line": `color-mix(in srgb, ${primary} 26%, white)`,
    } as CSSProperties;
}

export const ON_BRAND = {
    "--ink": "var(--accent-ink)",
    "--ink-soft": "color-mix(in srgb, var(--accent-ink) 92%, transparent)",
    "--muted": "color-mix(in srgb, var(--accent-ink) 72%, transparent)",
    "--border": "color-mix(in srgb, var(--accent-ink) 32%, transparent)",
    "--bg": "color-mix(in srgb, var(--accent-ink) 12%, transparent)",
} as CSSProperties;

/** A full-width public page: the business header, then the content, in the business's colours. */
export function PublicPage({
    name,
    brand,
    subtitle,
    actions,
    width = "wide",
    hero,
    onBack,
    children,
}: {
    name: string;
    brand: PublicBrand | null;
    subtitle?: string | null;
    actions?: ReactNode;
    hero?: ReactNode;
    onBack?: (() => void) | undefined;
    width?: keyof typeof WIDTHS;
    children: ReactNode;
}) {
    const style = brandStyle(brand);
    const embedded = isEmbedded();
    const tagline = subtitle ?? brand?.tagline ?? null;
    return (
        <div style={style} className={embedded ? "bg-bg" : "min-h-screen bg-bg"}>
            {embedded ? null : (
                <header
                    style={hero === undefined ? undefined : ON_BRAND}
                    className={
                        hero === undefined
                            ? "sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur"
                            : "bg-accent text-accent-ink"
                    }
                >
                    <div
                        className={`mx-auto flex ${WIDTHS[width]} items-center gap-3 px-4 py-3 sm:px-6`}
                    >
                        {onBack ? (
                            <IconButton
                                icon="chevronLeft"
                                label={strings.publicBooking.back}
                                onPress={onBack}
                            />
                        ) : null}
                        <span
                            className={
                                hero === undefined
                                    ? undefined
                                    : "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white p-1 shadow-sm"
                            }
                        >
                            <Avatar
                                name={name}
                                src={brand?.avatar_url ?? brand?.logo_url}
                                color={hero === undefined ? brand?.primary : undefined}
                            />
                        </span>
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
                    {hero !== undefined ? (
                        <div className={`mx-auto ${WIDTHS[width]} px-4 pb-16 pt-5 sm:px-6`}>
                            {hero}
                        </div>
                    ) : null}
                </header>
            )}
            {!embedded && hero === undefined ? <div className="h-1 bg-accent" /> : null}
            <main
                className={`relative mx-auto w-full px-4 sm:px-6 ${WIDTHS[width]} ${hero === undefined ? "py-6 md:py-10" : "-mt-10 pb-8"}`}
            >
                {children}
            </main>
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
