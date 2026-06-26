// React Native theme — the default theme's tokens as plain values (RN has no CSS vars).
// Change DEFAULT_THEME to switch the app's theme; mirrors the web's [data-theme] default.
import { type ThemeKey, themes } from "./index";

export const DEFAULT_THEME: ThemeKey = "pewter";
const t = themes[DEFAULT_THEME];

export const theme = {
    colors: t.color,
    fonts: t.font,
    radius: t.radius.base,
    avatarRadius: t.radius.avatar,
    borderWidth: t.borderWidth,
} as const;

export type Theme = typeof theme;
