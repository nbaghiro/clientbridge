import { defineConfig } from "@playwright/test";

import { on, PORTS } from "./e2e/hosts";
import { runBuild, runPort } from "@clientbridge/config/e2e/run";

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
    projects: [
        { name: "default" },
        ...(["firefox", "webkit"] as const).map((browserName) => ({
            name: browserName,
            grep: /@browsers/,
            use: { browserName },
        })),
    ],
    webServer: [
        {
            command: runBuild("connect", PORTS.default),
            url: `http://localhost:${String(PORTS.default)}/`,
            reuseExistingServer: false,
        },
        {
            command: runBuild("web", runPort("WEB_E2E_PORT")),
            url: `http://localhost:${String(runPort("WEB_E2E_PORT"))}/`,
            reuseExistingServer: false,
        },
    ],
});
