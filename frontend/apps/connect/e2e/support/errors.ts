import type { ConsoleMessage, Page } from "@playwright/test";

import { offsiteLoadFailure } from "../../../web/e2e/support/shell";

// a third party's frame, such as Stripe's, reports its own policy errors into the page's console
function thirdParty(message: ConsoleMessage): boolean {
    try {
        const host = new URL(message.location().url).hostname;
        return host !== "localhost" && !host.endsWith(".localhost") && host !== "127.0.0.1";
    } catch {
        return false;
    }
}

export function watchErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
        if (m.type() === "error" && !offsiteLoadFailure(m) && !thirdParty(m))
            errors.push(`console: ${m.text()} (${m.location().url})`);
    });
    return errors;
}
