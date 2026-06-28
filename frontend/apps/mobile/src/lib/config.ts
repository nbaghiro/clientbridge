import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as { publicWebUrl?: string };

/** Public-web origin used to build invoice pay links (see app.config.ts `extra.publicWebUrl`). */
export const publicWebUrl = extra.publicWebUrl ?? "https://app.clientbridge.ca";
