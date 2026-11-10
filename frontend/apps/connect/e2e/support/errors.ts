import type { ConsoleMessage, Page } from "@playwright/test";

import { offsiteLoadFailure } from "../../../web/e2e/support/shell";

// WebKit reports the policy refusals inside Stripe.js's hidden fraud-signal frames into the page
const STRIPE_FRAMES = ["js.stripe.com", "m.stripe.network"];

function fromStripeFrame(message: ConsoleMessage): boolean {
    try {
        return STRIPE_FRAMES.includes(new URL(message.location().url).hostname);
    } catch {
        return false;
    }
}

export function watchErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
        if (m.type() === "error" && !offsiteLoadFailure(m) && !fromStripeFrame(m))
            errors.push(`console: ${m.text()} (${m.location().url})`);
    });
    return errors;
}
