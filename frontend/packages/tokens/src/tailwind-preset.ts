// Tailwind preset wiring the Pewter CSS variables into utility classes.
// Web apps: `import { clientbridgePreset } from "@clientbridge/tokens/tailwind-preset"` and add
// it to `presets`, plus `import "@clientbridge/tokens/pewter.css"` once at the root.
import type { Config } from "tailwindcss";

export const clientbridgePreset = {
    theme: {
        extend: {
            colors: {
                bg: "var(--bg)",
                surface: "var(--surface)",
                surface2: "var(--surface2)",
                head: "var(--head)",
                ink: { DEFAULT: "var(--ink)", soft: "var(--ink-soft)" },
                muted: "var(--muted)",
                line: { DEFAULT: "var(--border)", soft: "var(--border-soft)" },
                primary: { DEFAULT: "var(--primary)", ink: "var(--primary-ink)" },
                accent: {
                    DEFAULT: "var(--accent)",
                    ink: "var(--accent-ink)",
                    strong: "var(--accent-strong)",
                    weak: "var(--accent-weak)",
                    line: "var(--accent-line)",
                },
                success: "var(--success)",
                ok: { bg: "var(--ok-bg)", fg: "var(--ok-fg)" },
                warn: { bg: "var(--warn-bg)", fg: "var(--warn-fg)" },
                danger: { bg: "var(--dan-bg)", fg: "var(--dan-fg)" },
                side: { DEFAULT: "var(--side)", ink: "var(--side-ink)" },
                logo: "var(--logo)",
            },
            fontFamily: {
                sans: ["Schibsted Grotesk", "sans-serif"],
                display: ["Schibsted Grotesk", "sans-serif"],
                mono: ["Geist Mono", "monospace"],
            },
            borderRadius: { DEFAULT: "var(--radius)", avatar: "var(--avatar-radius)" },
            boxShadow: { card: "var(--shadow)" },
            borderWidth: { card: "1.5px" },
        },
    },
} satisfies Partial<Config>;

export default clientbridgePreset;
