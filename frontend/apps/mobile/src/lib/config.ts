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

function developmentUrl(value: unknown): string | undefined {
    return __DEV__ && typeof value === "string" ? value : undefined;
}

export const apiUrl =
    developmentUrl(process.env.EXPO_PUBLIC_API_URL) ?? extra.apiUrl ?? "http://127.0.0.1:8701";

export const powersyncUrl =
    developmentUrl(process.env.EXPO_PUBLIC_POWERSYNC_URL) ??
    extra.powersyncUrl ??
    "http://127.0.0.1:8704";

/** Web app origin for staff invites and payment account management. */
export const publicWebUrl =
    developmentUrl(process.env.EXPO_PUBLIC_PUBLIC_WEB_URL) ??
    extra.publicWebUrl ??
    "https://app.clientbridge.ca";

/** The one host every invoice pay link uses. */
export const payUrl =
    developmentUrl(process.env.EXPO_PUBLIC_PAY_URL) ??
    extra.payUrl ??
    "https://pay.clientbridge.ca";

/** Where the public booking pages live (Connect). */
export const bookUrl =
    developmentUrl(process.env.EXPO_PUBLIC_BOOK_URL) ??
    extra.bookUrl ??
    "https://book.clientbridge.ca";

/** Blank until configured; the card forms then show a not-configured note. Never a secret key. */
export const stripePublishableKey = extra.stripePublishableKey ?? "";

export const stripeMerchantId = extra.stripeMerchantId ?? "merchant.ca.clientbridge.app";

/** Discover a simulated Terminal reader (dev) vs a real Tap-to-Pay device. */
export const terminalSimulated = extra.terminalSimulated ?? true;

/** Set by EAS builds; push registration falls back to Expo's default without it. */
export const easProjectId = extra.eas?.projectId;
