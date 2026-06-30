import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as {
    publicWebUrl?: string;
    stripePublishableKey?: string;
    stripeMerchantId?: string;
};

/** Public-web origin used to build invoice pay links (see app.config.ts `extra.publicWebUrl`). */
export const publicWebUrl = extra.publicWebUrl ?? "https://app.clientbridge.ca";

/** Stripe publishable (platform) key — blank until configured; the SDK seams fall back to a
 *  placeholder when empty. Never put a secret key here. */
export const stripePublishableKey = extra.stripePublishableKey ?? "";

/** Apple Pay merchant id passed to the Stripe SDK. */
export const stripeMerchantId = extra.stripeMerchantId ?? "merchant.ca.clientbridge.app";
