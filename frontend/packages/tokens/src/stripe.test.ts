import { describe, expect, it } from "vitest";

import { INTENT_COLORS, SCRIM } from "./palette";
import { STRIPE_FONTS, stripeConnectAppearance, stripeElementsAppearance } from "./stripe";

const marked = (key: string): string => `<${key}>`;

describe("Stripe appearance", () => {
    it("takes every Connect colour from the theme, apart from the shared scrim", () => {
        const { variables = {} } = stripeConnectAppearance(marked);
        const colors = Object.entries(variables).filter(([name]) => /Color|^color/.test(name));
        expect(colors.length).toBeGreaterThan(20);
        for (const [name, value] of colors) {
            if (name === "overlayBackdropColor") expect(value).toBe(SCRIM);
            else expect(value, name).toMatch(/^<\w+>$/);
        }
    });

    it("draws Connect badges in our status pills, with no outline", () => {
        const { variables = {} } = stripeConnectAppearance(marked);
        expect(variables.badgeSuccessColorBackground).toBe(marked(INTENT_COLORS.success.soft));
        expect(variables.badgeSuccessColorBorder).toBe(marked(INTENT_COLORS.success.soft));
        expect(variables.badgeSuccessColorText).toBe(marked(INTENT_COLORS.success.ink));
        expect(variables.badgeDangerColorText).toBe(marked(INTENT_COLORS.danger.ink));
    });

    it("gives touch screens 16px card inputs so iOS doesn't zoom, and desktops our 14px", () => {
        expect(stripeElementsAppearance(marked, true).rules?.[".Input"]?.fontSize).toBe("16px");
        expect(stripeElementsAppearance(marked, false).rules?.[".Input"]?.fontSize).toBe("14px");
    });

    it("leaves the comma, full stop and colon to the system font", () => {
        for (const font of STRIPE_FONTS) {
            const ranges = (font.unicodeRange ?? "").split(", ");
            const covers = (code: number): boolean =>
                ranges.some((range) => {
                    const [from = "", to = from] = range.replace(/U\+/g, "").split("-");
                    return code >= parseInt(from, 16) && code <= parseInt(to, 16);
                });
            expect([0x2c, 0x2e, 0x3a].some(covers)).toBe(false);
            expect(covers(0x41) && covers(0x30)).toBe(true);
        }
    });
});
