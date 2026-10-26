import { createHash } from "node:crypto";

import type { BrowserContext, TestInfo } from "@playwright/test";
import { runUrl } from "@clientbridge/config/e2e/run";

const runKey = Date.now().toString();

/** Isolates each journey from localhost's 30-request public API budget. */
export async function ownAddress(context: BrowserContext, info: TestInfo): Promise<void> {
    const suffix = createHash("sha256")
        .update(`${runKey}:${info.testId}`)
        .digest("hex")
        .slice(0, 16);
    const address = `2001:db8:${suffix.match(/.{4}/g)?.join(":")}::1`;
    await context.route(`${runUrl("VITE_API_URL")}/**`, async (route) => {
        await route.continue({
            headers: { ...route.request().headers(), "X-Forwarded-For": address },
        });
    });
}
