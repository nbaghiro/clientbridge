import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as {
    apiUrl?: string;
    powersyncUrl?: string;
    publicWebUrl?: string;
    payUrl?: string;
    bookUrl?: string;
    stripePublishableKey?: string;
    stripeMerchantId?: string;
    terminalSimulated?: boolean;
    eas?: { projectId?: string };
};

export const apiUrl = extra.apiUrl ?? "http://localhost:8701";

export const powersyncUrl = extra.powersyncUrl ?? "http://localhost:8704";

/** Web app origin used to build staff invite links. */
export const publicWebUrl = extra.publicWebUrl ?? "https://app.clientbridge.ca";

/** The one host every invoice pay link uses. */
export const payUrl = extra.payUrl ?? "https://pay.clientbridge.ca";

/** Where the public booking pages live (Connect). */
export const bookUrl = extra.bookUrl ?? "https://book.clientbridge.ca";

/** Blank until configured; the card forms then show a not-configured note. Never a secret key. */
export const stripePublishableKey = extra.stripePublishableKey ?? "";

export const stripeMerchantId = extra.stripeMerchantId ?? "merchant.ca.clientbridge.app";

/** Discover a simulated Terminal reader (dev) vs a real Tap-to-Pay device. */
export const terminalSimulated = extra.terminalSimulated ?? true;

/** Set by EAS builds; push registration falls back to Expo's default without it. */
export const easProjectId = extra.eas?.projectId;
