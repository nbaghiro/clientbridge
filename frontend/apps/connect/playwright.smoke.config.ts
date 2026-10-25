import { defineConfig } from "@playwright/test";

const output = process.env.SMOKE_OUTPUT_DIR ?? "test-results/smoke";

// Read-only checks of a deployed environment; `make test-staging-smoke` runs them against staging.
export default defineConfig({
    testDir: "e2e/smoke",
    testMatch: "*.smoke.ts",
    outputDir: output,
    timeout: 120_000,
    forbidOnly: true,
    retries: 0,
    workers: 2,
    expect: { timeout: 20_000 },
    reporter: [
        [process.env.CI ? "github" : "list"],
        ["json", { outputFile: `${output}/results.json` }],
    ],
    use: {
        viewport: { width: 1280, height: 900 },
        trace: "off",
        video: "off",
        screenshot: "only-on-failure",
        ...(process.env.CI ? {} : { channel: "chrome" }),
    },
});
