import type { ThemeTokens } from "./themes";

export type ColorKey = keyof ThemeTokens["color"];
export type IntentTone = "accent" | "success" | "warning" | "danger" | "neutral";

// soft fills a pill or event block, ink is its text, line is a border, dot or accent bar.
export const INTENT_COLORS: Record<IntentTone, { soft: ColorKey; ink: ColorKey; line: ColorKey }> =
    {
        accent: { soft: "accentWeak", ink: "accentStrong", line: "accent" },
        success: { soft: "okBg", ink: "okFg", line: "success" },
        warning: { soft: "warnBg", ink: "warnFg", line: "warnFg" },
        danger: { soft: "danBg", ink: "danFg", line: "danFg" },
        neutral: { soft: "surface2", ink: "muted", line: "border" },
    };

export function cssVar(key: ColorKey): string {
    return `var(--${key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)})`;
}

// Text and icons drawn over a data colour (a service, staff or brand colour) and the shadow of raised surfaces.
export const ON_DATA = "#FFFFFF";
export const SHADOW = "#14191E";

// A see-through tint of a data or theme colour (web, so CSS variables work too).
export function tint(color: string, percent: number): string {
    return `color-mix(in srgb, ${color} ${String(percent)}%, transparent)`;
}

// A data colour darkened toward black, so text in it stays readable on its own tint.
export function shade(color: string, percent: number): string {
    return `color-mix(in srgb, ${color} ${String(100 - percent)}%, black)`;
}

export function shadeHex(hex: string, percent: number): string {
    const keep = 1 - percent / 100;
    const channel = (i: number): string =>
        Math.round(parseInt(hex.slice(i, i + 2), 16) * keep)
            .toString(16)
            .padStart(2, "0");
    return `#${channel(1)}${channel(3)}${channel(5)}`;
}

// The same tint for React Native, which takes a #RRGGBB colour.
export function tintHex(hex: string, percent: number): string {
    const alpha = Math.round((percent / 100) * 255)
        .toString(16)
        .padStart(2, "0");
    return `${hex.slice(0, 7)}${alpha}`;
}
