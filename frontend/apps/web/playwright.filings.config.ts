import { defineConfig } from "@playwright/test";

import base, { chromium } from "./playwright.config";

const webPort = Number(process.env.WEB_E2E_PORT ?? "8721");

export default defineConfig({
    ...base,
    testMatch: "*.filing.ts",
    projects: [
        { name: "default", use: { ...chromium, baseURL: `http://localhost:${String(webPort)}` } },
    ],
    webServer: [
        {
            command: `pnpm exec vite build && pnpm exec vite preview --port ${String(webPort)} --strictPort`,
            url: `http://localhost:${String(webPort)}/`,
            reuseExistingServer: false,
        },
    ],
});
