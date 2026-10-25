import { defineConfig } from "@playwright/test";

import { on, PORTS } from "./e2e/hosts";

export default defineConfig({
    testDir: "e2e",
    testMatch: ["stripe-provider.spec.ts", "stripe-deposit.spec.ts"],
    outputDir: process.env.E2E_OUTPUT_DIR ?? "test-results/stripe-provider",
    timeout: 180_000,
    forbidOnly: true,
    retries: 0,
    workers: 1,
    expect: { timeout: 30_000 },
    reporter: [
        ["list"],
        [
            "json",
            {
                outputFile: `${process.env.E2E_OUTPUT_DIR ?? "test-results/stripe-provider"}/results.json`,
            },
        ],
    ],
    use: {
        baseURL: on("pay", ""),
        viewport: { width: 1280, height: 900 },
        trace: "off",
        video: "off",
        screenshot: "off",
    },
    webServer: [
        {
            command: `pnpm exec vite build && pnpm exec vite preview --port ${String(PORTS.default)} --strictPort`,
            url: `http://localhost:${String(PORTS.default)}/`,
            reuseExistingServer: false,
        },
        {
            command: `pnpm --filter web exec vite build && pnpm --filter web exec vite preview --port ${process.env.WEB_E2E_PORT ?? "8721"} --strictPort`,
            url: `http://localhost:${process.env.WEB_E2E_PORT ?? "8721"}/`,
            reuseExistingServer: false,
        },
    ],
});
