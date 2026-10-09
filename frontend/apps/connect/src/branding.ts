import type { PublicBrand } from "@clientbridge/app-core/public";
import { useEffect } from "react";

const ICON_PX = 64;
const HEADER_TILE_PX = 28;

function tileRadius(styles: CSSStyleDeclaration): number {
    const raw = styles.getPropertyValue("--avatar-radius").trim();
    const value = Number.parseFloat(raw);
    if (Number.isNaN(value)) return ICON_PX * 0.25;
    if (raw.endsWith("%")) return (ICON_PX * Math.min(value, 50)) / 100;
    return (ICON_PX * value) / HEADER_TILE_PX;
}

// Drawn like the header's logo tile so a transparent logo stays visible on a dark tab bar.
function tileIcon(logo: ImageBitmap): string | null {
    const canvas = document.createElement("canvas");
    canvas.width = ICON_PX;
    canvas.height = ICON_PX;
    const context = canvas.getContext("2d");
    if (!context) return null;
    const styles = getComputedStyle(document.documentElement);
    context.fillStyle = styles.getPropertyValue("--surface").trim() || "#ffffff";
    context.beginPath();
    context.roundRect(0, 0, ICON_PX, ICON_PX, tileRadius(styles));
    context.fill();
    context.clip();
    const scale = Math.min(ICON_PX / logo.width, ICON_PX / logo.height);
    const width = logo.width * scale;
    const height = logo.height * scale;
    context.drawImage(logo, (ICON_PX - width) / 2, (ICON_PX - height) / 2, width, height);
    return canvas.toDataURL("image/png");
}

// no-store: the page's plain <img> may have cached this file without CORS headers.
async function tiledIcon(url: string): Promise<string | null> {
    const response = await fetch(url, { mode: "cors", cache: "no-store" });
    if (!response.ok) return null;
    return tileIcon(await createImageBitmap(await response.blob()));
}

async function firstIcon(urls: string[]): Promise<string | null> {
    for (const url of urls) {
        const href = await tiledIcon(url).catch(() => null);
        if (href !== null) return href;
    }
    return null;
}

export function useBusinessFavicon(brand?: PublicBrand | null): void {
    const avatar = brand?.avatar_url;
    const logo = brand?.logo_url;
    useEffect(() => {
        const candidates = [
            ...new Set([avatar, logo].filter((url): url is string => Boolean(url))),
        ];
        if (!candidates.length) return;
        const icons = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]'));
        const previous = icons.map((icon) => ({
            icon,
            href: icon.getAttribute("href"),
            type: icon.getAttribute("type"),
            sizes: icon.getAttribute("sizes"),
        }));
        let live = true;
        const apply = (href: string): void => {
            for (const icon of icons) {
                icon.href = href;
                icon.removeAttribute("type");
                icon.removeAttribute("sizes");
            }
        };
        firstIcon(candidates)
            .then((href) => {
                if (live && href !== null) apply(href);
            })
            .catch(() => undefined);
        return () => {
            live = false;
            for (const { icon, ...attributes } of previous) {
                for (const [name, value] of Object.entries(attributes)) {
                    if (value === null) icon.removeAttribute(name);
                    else icon.setAttribute(name, value);
                }
            }
        };
    }, [avatar, logo]);
}
