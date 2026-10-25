import { createHash } from "node:crypto";

import type { BrowserContext, TestInfo } from "@playwright/test";

const runKey = Date.now().toString();

/** Isolates each journey from localhost's 30-request public API budget. */
export async function ownAddress(context: BrowserContext, info: TestInfo): Promise<void> {
    const suffix = createHash("sha256")
        .update(`${runKey}:${info.testId}`)
        .digest("hex")
        .slice(0, 16);
    const address = `2001:db8:${suffix.match(/.{4}/g)?.join(":")}::1`;
    await context.route(
        `${process.env.VITE_API_URL ?? "http://127.0.0.1:8701"}/**`,
        async (route) => {
            await route.continue({
                headers: { ...route.request().headers(), "X-Forwarded-For": address },
            });
        },
    );
}
