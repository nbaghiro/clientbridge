import type { AppearanceOptions, CustomFontSource } from "@stripe/connect-js";
import type { Appearance } from "@stripe/stripe-js";

import { type ColorKey, INTENT_COLORS, SCRIM } from "./palette";
import { themes } from "./themes";

type Color = (key: ColorKey) => string;

const FONT = "Clientbridge Sans";
const FONT_STACK = `${FONT}, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
// Tailwind's rounded-md, which every button and field draws with, and rounded-xl for dialogs.
const CONTROL_RADIUS = "6px";
const OVERLAY_RADIUS = "12px";
const SCHIBSTED =
    "url(https://fonts.gstatic.com/s/schibstedgrotesk/v7/Jqz55SSPQuCQF3t8uOwiUL-taUTtap9GayojdSFO.woff2) format('woff2')";
// Stripe sets tabular figures, which make Schibsted's , . and : as wide as a digit; those come from the system font.
const WITHOUT_PUNCTUATION =
    "U+0000-002B, U+002D, U+002F-0039, U+003B-00FF, U+0131, U+0152-0153, U+2000-206F, U+20AC, U+2122, U+2212";

/** Schibsted Grotesk for Stripe's frames, one face per weight of the variable font. */
export const STRIPE_FONTS: CustomFontSource[] = ["400", "500", "600", "700"].map((weight) => ({
    family: FONT,
    src: SCHIBSTED,
    weight,
    unicodeRange: WITHOUT_PUNCTUATION,
    display: "swap",
}));

/** Connect embedded components (account, payments, payouts, notices) in our colours, type and radii. */
export function stripeConnectAppearance(color: Color): AppearanceOptions {
    const badge = (tone: keyof typeof INTENT_COLORS) => {
        const { soft, ink } = INTENT_COLORS[tone];
        return { background: color(soft), text: color(ink) };
    };
    const neutral = badge("neutral");
    const success = badge("success");
    const warning = badge("warning");
    const danger = badge("danger");
    return {
        overlays: "drawer",
        variables: {
            fontFamily: FONT_STACK,
            fontSizeBase: "14px",
            colorPrimary: color("accent"),
            colorText: color("ink"),
            colorSecondaryText: color("muted"),
            colorBackground: color("surface"),
            colorBorder: color("border"),
            colorDanger: color("danFg"),
            offsetBackgroundColor: color("bg"),
            formBackgroundColor: color("surface"),
            formHighlightColorBorder: color("accent"),
            formAccentColor: color("accent"),
            buttonPrimaryColorBackground: color("accent"),
            buttonPrimaryColorBorder: color("accent"),
            buttonPrimaryColorText: color("accentInk"),
            buttonSecondaryColorBackground: color("surface"),
            buttonSecondaryColorBorder: color("border"),
            buttonSecondaryColorText: color("inkSoft"),
            buttonDangerColorBackground: color("surface"),
            buttonDangerColorBorder: color("danFg"),
            buttonDangerColorText: color("danFg"),
            actionPrimaryColorText: color("accent"),
            actionSecondaryColorText: color("inkSoft"),
            badgeNeutralColorBackground: neutral.background,
            badgeNeutralColorBorder: neutral.background,
            badgeNeutralColorText: neutral.text,
            badgeSuccessColorBackground: success.background,
            badgeSuccessColorBorder: success.background,
            badgeSuccessColorText: success.text,
            badgeWarningColorBackground: warning.background,
            badgeWarningColorBorder: warning.background,
            badgeWarningColorText: warning.text,
            badgeDangerColorBackground: danger.background,
            badgeDangerColorBorder: danger.background,
            badgeDangerColorText: danger.text,
            borderRadius: `${String(themes.pewter.radius.base)}px`,
            buttonBorderRadius: CONTROL_RADIUS,
            formBorderRadius: CONTROL_RADIUS,
            // Stripe caps radii at 24px, still a pill at a badge's height
            badgeBorderRadius: "24px",
            overlayBorderRadius: OVERLAY_RADIUS,
            overlayBackdropColor: SCRIM,
            buttonLabelFontSize: "14px",
            buttonLabelFontWeight: "500",
            badgeLabelFontSize: "12px",
            badgeLabelFontWeight: "500",
            badgePaddingX: "8px",
            badgePaddingY: "2px",
            bodyMdFontSize: "14px",
            bodySmFontSize: "13px",
            labelMdFontSize: "14px",
            labelMdFontWeight: "500",
            labelSmFontSize: "12px",
            labelSmFontWeight: "500",
            headingXlFontSize: "24px",
            headingXlFontWeight: "700",
            headingLgFontSize: "20px",
            headingLgFontWeight: "700",
            headingMdFontSize: "17px",
            headingMdFontWeight: "700",
            headingSmFontSize: "15px",
            headingSmFontWeight: "600",
            headingXsFontSize: "14px",
            headingXsFontWeight: "600",
        },
    };
}

/** The card form (Payment and Express Checkout Elements) drawn like our Field; touch screens get 16px inputs so iOS doesn't zoom. */
export function stripeElementsAppearance(color: Color, touch: boolean): Appearance {
    return {
        variables: {
            fontFamily: FONT_STACK,
            fontSizeBase: "14px",
            colorPrimary: color("accent"),
            colorText: color("ink"),
            colorTextSecondary: color("muted"),
            colorTextPlaceholder: color("muted"),
            colorBackground: color("surface"),
            colorDanger: color("danFg"),
            iconColor: color("muted"),
            borderRadius: CONTROL_RADIUS,
            spacingUnit: "4px",
            gridRowSpacing: "14px",
            gridColumnSpacing: "12px",
            labelFontWeight: "500",
            labelColorText: color("inkSoft"),
            inputColorBorder: color("border"),
            inputBoxShadow: "none",
            inputFocusColorBorder: color("accent"),
            inputFocusBoxShadow: "none",
        },
        rules: {
            ".Input": { padding: "9px 12px", fontSize: touch ? "16px" : "14px" },
            ".Label": { fontSize: "14px", marginBottom: "6px" },
            ".Tab": { boxShadow: "none", borderColor: color("border") },
            ".Block": { boxShadow: "none", borderColor: color("border") },
        },
    };
}
