import { defineConfig } from "@playwright/test";

const port = Number(process.env.WEB_E2E_PORT ?? "8721");
const pseudoPort = Number(process.env.WEB_PSEUDO_E2E_PORT ?? "8724");

// Needs the local stack (API, PowerSync, seeded Postgres): `make up migrate seed dev-api` first.
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
        viewport: { width: 1440, height: 900 },
        trace: "retain-on-failure",
        video: process.env.E2E_RECORD === "1" ? "on" : "off",
        screenshot: "only-on-failure",
        ...(process.env.CI ? {} : { channel: "chrome" }),
    },
    projects: [
        {
            name: "default",
            testIgnore: "pseudo.e2e.ts",
            use: { baseURL: `http://localhost:${String(port)}` },
        },
        {
            name: "pseudo",
            testMatch: "pseudo.e2e.ts",
            use: { baseURL: `http://localhost:${String(pseudoPort)}` },
        },
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
