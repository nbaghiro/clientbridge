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

// The colours a business brand or a team member can take, by the name a screen reader says.
export const BRAND_PALETTE = {
    forest: "#2E4A3F",
    slate: "#3F5E80",
    teal: "#2E6670",
    plum: "#7D5A82",
    terracotta: "#A95C43",
    ochre: "#86621E",
    charcoal: "#3A4654",
} as const;

// Black or white, whichever reads on a brand colour (the WCAG contrast crossover).
export function readableInk(color: string): "#000000" | "#ffffff" {
    const hex = color.slice(1);
    const full = hex.length === 3 ? hex.replace(/./g, "$&$&") : hex;
    const [r = 0, g = 0, b = 0] = [0, 2, 4].map((at) => {
        const value = parseInt(full.slice(at, at + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return r * 0.2126 + g * 0.7152 + b * 0.0722 > 0.179 ? "#000000" : "#ffffff";
}

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
