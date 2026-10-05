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
        neutral: { soft: "bg", ink: "muted", line: "border" },
    };

export function cssVar(key: ColorKey): string {
    return `var(--${key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)})`;
}
