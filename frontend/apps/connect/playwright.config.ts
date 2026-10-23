import { defineConfig } from "@playwright/test";

import { PORTS, on } from "./e2e/hosts";

const port = PORTS.default;
const pseudoPort = PORTS.pseudo;

// Needs the API on :8701 over a migrated, seeded Postgres: `make up migrate seed dev-api` first.
export default defineConfig({
    testDir: "e2e",
    testMatch: "*.e2e.ts",
    timeout: 120_000,
    expect: { timeout: 15_000 },
    reporter: [[process.env.CI ? "github" : "list"], ["html", { open: "never" }]],
    workers: 2,
    use: {
        viewport: { width: 1280, height: 900 },
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        ...(process.env.CI ? {} : { channel: "chrome" }),
    },
    projects: [
        {
            name: "default",
            testIgnore: "pseudo.e2e.ts",
            use: { baseURL: on("book", "") },
        },
        {
            name: "pseudo",
            testMatch: "pseudo.e2e.ts",
            use: { baseURL: on("book", "", "pseudo") },
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
