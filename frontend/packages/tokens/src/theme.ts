// React Native theme object — the Pewter tokens as plain values (RN has no CSS vars).
import { pewter } from "./index";

export const theme = {
    colors: pewter.color,
    fonts: pewter.font,
    radius: pewter.radius.base,
    avatarRadius: pewter.radius.avatar,
    borderWidth: pewter.borderWidth,
} as const;

export type Theme = typeof theme;
