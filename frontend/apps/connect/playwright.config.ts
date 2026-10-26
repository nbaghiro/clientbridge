import { defineConfig } from "@playwright/test";

import { PORTS, on } from "./e2e/hosts";

const port = PORTS.default;
const pseudoPort = PORTS.pseudo;
const chromium = process.env.CI ? {} : { channel: "chrome" };

// Needs the API on :8701 over a migrated, seeded Postgres: `make up migrate seed dev-api` first.
export default defineConfig({
    testDir: "e2e",
    outputDir: process.env.E2E_OUTPUT_DIR ?? "test-results",
    testMatch: "*.e2e.ts",
    timeout: 120_000,
    forbidOnly: Boolean(process.env.CI),
    expect: { timeout: 15_000 },
    reporter: [
        [process.env.CI ? "github" : "list"],
        ["html", { open: "never" }],
        ["json", { outputFile: `${process.env.E2E_OUTPUT_DIR ?? "test-results"}/results.json` }],
    ],
    workers: 2,
    use: {
        viewport: { width: 1280, height: 900 },
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
    },
    projects: [
        {
            name: "default",
            testIgnore: "pseudo.e2e.ts",
            use: { ...chromium, baseURL: on("book", "") },
        },
        {
            name: "pseudo",
            testMatch: "pseudo.e2e.ts",
            use: { ...chromium, baseURL: on("book", "", "pseudo") },
        },
        // the cases tagged @browsers carry the storage, navigation and payment risk
        ...(["firefox", "webkit"] as const).map((browserName) => ({
            name: browserName,
            testIgnore: "pseudo.e2e.ts",
            grep: /@browsers/,
            use: { browserName, baseURL: on("book", "") },
        })),
    ],
    webServer: [
        {
            // CI tests the production bundle; locally the dev server keeps edits live
            command: process.env.CI
                ? `pnpm exec vite build && pnpm exec vite preview --port ${String(port)} --strictPort`
                : `pnpm exec vite --port ${String(port)} --strictPort`,
            url: `http://localhost:${String(port)}/`,
            reuseExistingServer: !process.env.CI,
        },
        {
            command: `pnpm exec vite --port ${String(pseudoPort)} --strictPort`,
            env: { VITE_PSEUDO_LOCALE: "1" },
            url: `http://localhost:${String(pseudoPort)}/`,
            reuseExistingServer: !process.env.CI,
        },
    ],
});
