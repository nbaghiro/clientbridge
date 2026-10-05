import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as {
    publicWebUrl?: string;
    stripePublishableKey?: string;
    stripeMerchantId?: string;
    stripeTerminalLocationId?: string;
    terminalSimulated?: boolean;
};

/** Public-web origin used to build invoice pay links (see app.config.ts `extra.publicWebUrl`). */
export const publicWebUrl = extra.publicWebUrl ?? "https://app.clientbridge.ca";

/** Blank until configured; the card forms then show a not-configured note. Never a secret key. */
export const stripePublishableKey = extra.stripePublishableKey ?? "";

/** Apple Pay merchant id passed to the Stripe SDK. */
export const stripeMerchantId = extra.stripeMerchantId ?? "merchant.ca.clientbridge.app";

/** Blank until configured; with `terminalSimulated` the SDK uses a test reader. */
export const stripeTerminalLocationId = extra.stripeTerminalLocationId ?? "";

/** Discover a simulated Terminal reader (dev) vs a real Tap-to-Pay device. */
export const terminalSimulated = extra.terminalSimulated ?? true;
