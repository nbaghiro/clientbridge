import { THEME_KEYS, themes } from "@clientbridge/tokens";

// Stands in for @clientbridge/tokens/native in the preview so phone frames follow the theme picker.
const asked = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("theme");
const key = THEME_KEYS.find((k) => k === asked) ?? "pewter";
const t = themes[key];

export const theme = {
    colors: { ...t.color, scrim: "rgba(20,25,30,0.35)" },
    fonts: t.font,
    radius: t.radius.base,
    avatarRadius: t.radius.avatar,
    borderWidth: t.borderWidth,
} as const;
