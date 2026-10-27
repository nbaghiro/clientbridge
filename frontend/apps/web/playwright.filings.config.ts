import { defineConfig } from "@playwright/test";

import base, { chromium } from "./playwright.config";
import { runPreview, runPort } from "@clientbridge/config/e2e/run";

const webPort = runPort("WEB_E2E_PORT");

export default defineConfig({
    ...base,
    testMatch: "*.filing.ts",
    projects: [
        { name: "default", use: { ...chromium, baseURL: `http://localhost:${String(webPort)}` } },
    ],
    webServer: [
        {
            command: runPreview("web", webPort),
            url: `http://localhost:${String(webPort)}/`,
            reuseExistingServer: false,
        },
    ],
});
