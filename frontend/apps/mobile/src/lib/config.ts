import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as {
    apiUrl?: string;
    powersyncUrl?: string;
    authUrl?: string;
    publicWebUrl?: string;
    pageUrl?: string;
    bookUrl?: string;
    shopUrl?: string;
    payUrl?: string;
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

export const authUrl =
    developmentUrl(process.env.EXPO_PUBLIC_AUTH_URL) ?? extra.authUrl ?? "http://127.0.0.1:8713";

/** Web app origin for staff invites and payment account management. */
export const publicWebUrl =
    developmentUrl(process.env.EXPO_PUBLIC_PUBLIC_WEB_URL) ??
    extra.publicWebUrl ??
    "http://localhost:8700";

/** Each business's public page, a subdomain named by its slug (Connect). */
export const pageUrl =
    developmentUrl(process.env.EXPO_PUBLIC_PAGE_URL) ??
    extra.pageUrl ??
    "http://{slug}.localhost:8709";

export const bookUrl =
    developmentUrl(process.env.EXPO_PUBLIC_BOOK_URL) ??
    extra.bookUrl ??
    "http://book.localhost:8709";

export const shopUrl =
    developmentUrl(process.env.EXPO_PUBLIC_SHOP_URL) ??
    extra.shopUrl ??
    "http://shop.localhost:8709";

export const payUrl =
    developmentUrl(process.env.EXPO_PUBLIC_PAY_URL) ?? extra.payUrl ?? "http://pay.localhost:8709";

/** Blank until configured; the card forms then show a not-configured note. Never a secret key. */
export const stripePublishableKey = extra.stripePublishableKey ?? "";

export const stripeMerchantId = extra.stripeMerchantId ?? "merchant.ca.clientbridge.app";

/** Discover a simulated Terminal reader (dev) vs a real Tap-to-Pay device. */
export const terminalSimulated = extra.terminalSimulated ?? true;

/** Development builds switch to the en-XA pseudo-locale with EXPO_PUBLIC_PSEUDO_LOCALE=1. */
export const pseudoLocale = __DEV__ && process.env.EXPO_PUBLIC_PSEUDO_LOCALE === "1";

/** Set by EAS builds; push registration falls back to Expo's default without it. */
export const easProjectId = extra.eas?.projectId;
