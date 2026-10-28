import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base } from "@playwright/test";

// Playwright's WebKit contexts browse privately, where OPFS refuses the replica, so WebKit gets a profile
export const test = base.extend({
    context: async ({ browserName, context, playwright, baseURL }, use, testInfo) => {
        if (testInfo.project.metadata.storage === "indexeddb")
            await context.addInitScript(() => {
                Object.assign(globalThis, { replicaStorage: "indexeddb" });
            });
        if (browserName !== "webkit") {
            await use(context);
            return;
        }
        const profile = await mkdtemp(join(tmpdir(), "webkit-profile-"));
        const persistent = await playwright.webkit.launchPersistentContext(profile, {
            ...(baseURL === undefined ? {} : { baseURL }),
        });
        try {
            await use(persistent);
        } finally {
            await persistent.close();
            await rm(profile, { recursive: true, force: true });
        }
    },
});
