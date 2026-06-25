// Clientbridge design tokens — theme: Pewter (cool silver-gray + slate-blue accent).
// Single source for web (Tailwind preset + CSS vars) and React Native (theme object).

export const pewter = {
    color: {
        bg: "#F3F4F6",
        surface: "#FFFFFF",
        surface2: "#EAECEF",
        head: "#F2F3F5",
        ink: "#191D22",
        inkSoft: "#3E454D",
        muted: "#6E757E",
        border: "#DBDEE3",
        borderSoft: "#E8EAEE",
        primary: "#3A4654",
        primaryInk: "#F2F4F6",
        accent: "#3F5E80",
        accentInk: "#FFFFFF",
        accentStrong: "#2E4A66",
        accentWeak: "#E4EAF1",
        accentLine: "#CCD7E3",
        success: "#2E7A5A",
        okBg: "#DEEDE5",
        okFg: "#256048",
        warnBg: "#F3E8CC",
        warnFg: "#86621E",
        danBg: "#F1DFDC",
        danFg: "#A2433A",
        side: "#22282F",
        sideInk: "#99A2AC",
        logo: "#8FB4E0", // intentionally distinct from --side
    },
    font: {
        ui: "Schibsted Grotesk",
        display: "Schibsted Grotesk",
        mono: "Geist Mono",
    },
    radius: { base: 8, avatar: 7 },
    borderWidth: 1.5,
    shadow: "0 1px 2px rgba(20,25,30,.05)",
} as const;

export type PewterTokens = typeof pewter;
