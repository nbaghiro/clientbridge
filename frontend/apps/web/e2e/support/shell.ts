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

/** A sync stream that dropped mid-download, which PowerSync retries and the shell's sync banner shows. */
function droppedSyncStream(message: ConsoleMessage): boolean {
    // the service's cancel of a superseded checkpoint's query can land on the next query
    const text = message.text();
    return text.startsWith("[PowerSync]: Sync error") && text.includes("name: TypeError");
}

/** A console error that a walk through the app should fail on. */
export function appConsoleError(message: ConsoleMessage): boolean {
    return (
        message.type() === "error" && !offsiteLoadFailure(message) && !droppedSyncStream(message)
    );
}
