import { BusinessNavigation } from "./BusinessNavigation";
import { type PublicBrand, strings } from "@clientbridge/app-core/public";
import { Icon, IconButton } from "@clientbridge/ui";
import { useState, type CSSProperties, type ReactNode } from "react";

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

const ON_BRAND = {
    "--ink": "var(--accent-ink)",
    "--ink-soft": "color-mix(in srgb, var(--accent-ink) 92%, transparent)",
    "--muted": "color-mix(in srgb, var(--accent-ink) 72%, transparent)",
    "--border": "color-mix(in srgb, var(--accent-ink) 32%, transparent)",
    "--bg": "color-mix(in srgb, var(--accent-ink) 12%, transparent)",
} as CSSProperties;

export function BusinessCover({
    brand,
    children,
    className = "",
}: {
    brand: PublicBrand | null;
    children: ReactNode;
    className?: string;
}) {
    const [failed, setFailed] = useState<string | null>(null);
    const cover = brand?.cover_url;
    const photo = cover && cover !== failed;
    return (
        <header
            style={
                brand === null
                    ? undefined
                    : { ...ON_BRAND, ...(photo ? { "--accent-ink": "#ffffff" } : {}) }
            }
            className={`relative isolate z-20 ${brand === null ? "border-b border-line bg-surface" : "bg-accent"} text-ink ${className}`}
        >
            {photo ? (
                <>
                    <img
                        src={cover}
                        alt=""
                        className="absolute inset-0 -z-20 h-full w-full object-cover"
                        onError={() => {
                            setFailed(cover);
                        }}
                    />
                    <div
                        aria-hidden
                        className="absolute inset-0 -z-10 bg-gradient-to-r from-black/75 via-black/50 to-black/25"
                    />
                </>
            ) : null}
            {children}
        </header>
    );
}

/** A full-width public page: the business header, then the content, in the business's colours. */
export function PublicPage({
    name,
    brand,
    actions,
    cartCount,
    width = "wide",
    hero,
    onBack,
    children,
}: {
    name: string;
    brand: PublicBrand | null;
    actions?: ReactNode;
    cartCount?: number;
    hero?: ReactNode;
    onBack?: (() => void) | undefined;
    width?: keyof typeof WIDTHS;
    children: ReactNode;
}) {
    const style = brandStyle(brand);
    const embedded = isEmbedded();
    return (
        <div style={style} className={embedded ? "bg-bg" : "flex min-h-screen flex-col bg-bg"}>
            <BusinessNavigation
                brand={brand ? { ...brand, business_name: name } : brand}
                cartCount={cartCount}
            />
            <main
                className={`relative mx-auto w-full flex-1 px-4 py-6 sm:px-6 md:py-8 ${WIDTHS[width]}`}
            >
                {!embedded && (onBack || actions) ? (
                    <div className="mb-4 flex items-center justify-between gap-3">
                        {onBack ? (
                            <IconButton
                                icon="chevronLeft"
                                label={strings.publicBooking.back}
                                onPress={onBack}
                            />
                        ) : (
                            <span />
                        )}
                        {actions}
                    </div>
                ) : null}
                {hero !== undefined ? <div className="mb-6">{hero}</div> : null}
                {children}
            </main>
            {embedded ? null : <PoweredBy />}
        </div>
    );
}

export function PoweredBy() {
    return (
        <footer className="mt-auto py-8 text-center text-xs text-muted print:hidden">
            {strings.publicLanding.poweredBy}
        </footer>
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
