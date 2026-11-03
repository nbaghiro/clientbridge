import { defineConfig } from "@playwright/test";
import { recorded } from "@clientbridge/config/e2e/recording";

import base, { chromium } from "./playwright.config";
import { runPreview, runPort } from "@clientbridge/config/e2e/run";

const webPort = runPort("WEB_E2E_PORT");
const connectPort = runPort("CONNECT_E2E_PORT");

const config = defineConfig({
    ...base,
    testMatch: "journeys/*.journey.ts",
    projects: [
        { name: "default", use: { ...chromium, baseURL: `http://localhost:${String(webPort)}` } },
    ],
    webServer: [
        {
            command: runPreview("web", webPort),
            url: `http://localhost:${String(webPort)}/`,
            reuseExistingServer: false,
        },
        {
            command: runPreview("connect", connectPort),
            url: `http://localhost:${String(connectPort)}/`,
            reuseExistingServer: false,
        },
    ],
});

export default recorded(config);
