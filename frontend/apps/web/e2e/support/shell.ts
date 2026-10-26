import type { ConsoleMessage } from "@playwright/test";

/** A third-party asset (fonts, Stripe) failing on the network, which is not an app error. */
export function offsiteLoadFailure(message: ConsoleMessage): boolean {
    if (!message.text().startsWith("Failed to load resource")) return false;
    try {
        return !["localhost", "127.0.0.1"].includes(new URL(message.location().url).hostname);
    } catch {
        return false;
    }
}
