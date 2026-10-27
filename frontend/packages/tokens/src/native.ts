// The default theme's tokens as plain values, since React Native has no CSS variables.
import { type ThemeKey, themes } from "./index";

const DEFAULT_THEME: ThemeKey = "pewter";
const t = themes[DEFAULT_THEME];

export const theme = {
    colors: { ...t.color, scrim: "rgba(20,25,30,0.35)" },
    fonts: t.font,
    radius: t.radius.base,
    avatarRadius: t.radius.avatar,
    borderWidth: t.borderWidth,
    // The web's scale: text-2xl page titles and 17 px section and sheet titles.
    type: { page: 24, section: 17 },
    // Points: from `tablet` wide the sidebar replaces the tab bar and pages centre in `frame`.
    layout: { tablet: 900, frame: 960, gutter: 32, sheet: 560, panel: 640, form: 400, sidebar: 248 },
} as const;
