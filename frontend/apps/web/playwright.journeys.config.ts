import { defineConfig } from "@playwright/test";

import base from "./playwright.config";

const webPort = Number(process.env.WEB_E2E_PORT ?? "8721");
const connectPort = Number(process.env.CONNECT_E2E_PORT ?? "8723");

export default defineConfig({
    ...base,
    testMatch: "*.journey.ts",
    projects: [{ name: "default", use: { baseURL: `http://localhost:${String(webPort)}` } }],
    webServer: [
        {
            command: `pnpm exec vite build && pnpm exec vite preview --port ${String(webPort)} --strictPort`,
            url: `http://localhost:${String(webPort)}/`,
            reuseExistingServer: false,
        },
        {
            command: `pnpm --filter connect exec vite build && pnpm --filter connect exec vite preview --port ${String(connectPort)} --strictPort`,
            url: `http://localhost:${String(connectPort)}/`,
            reuseExistingServer: false,
        },
    ],
});
