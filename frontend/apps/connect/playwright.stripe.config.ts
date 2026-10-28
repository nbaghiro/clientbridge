import { defineConfig } from "@playwright/test";

import { on, PORTS } from "./e2e/hosts";
import { runPreview, runPort } from "@clientbridge/config/e2e/run";

export default defineConfig({
    testDir: "e2e",
    testMatch: [
        "stripe-provider.spec.ts",
        "stripe-deposit.spec.ts",
        "stripe-disputes.spec.ts",
        "stripe-memberships.spec.ts",
        "stripe-payouts.spec.ts",
        "stripe-desk.spec.ts",
        "stripe-tabs.spec.ts",
        "stripe-account.spec.ts",
    ],
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
        // reconciliation checks every source the other cases made, so it runs after all of them
        {
            name: "reconciliation",
            testMatch: "stripe-reconciliation.spec.ts",
            dependencies: ["default", "firefox", "webkit"],
        },
    ],
    webServer: [
        {
            command: runPreview("connect", PORTS.default),
            url: `http://localhost:${String(PORTS.default)}/`,
            reuseExistingServer: false,
        },
        {
            command: runPreview("web", runPort("WEB_E2E_PORT")),
            url: `http://localhost:${String(runPort("WEB_E2E_PORT"))}/`,
            reuseExistingServer: false,
        },
    ],
});
