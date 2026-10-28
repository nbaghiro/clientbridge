import type { Page } from "@playwright/test";

import { offsiteLoadFailure } from "../../../web/e2e/support/shell";

export function watchErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
        if (m.type() === "error" && !offsiteLoadFailure(m)) errors.push(`console: ${m.text()}`);
    });
    return errors;
}
