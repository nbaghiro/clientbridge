import { defineConfig } from "@playwright/test";

const port = Number(process.env.CONNECT_E2E_PORT ?? "8723");
const pseudoPort = Number(process.env.CONNECT_PSEUDO_E2E_PORT ?? "8726");

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
            name: "en-CA",
            testIgnore: "pseudo.e2e.ts",
            use: { baseURL: `http://localhost:${String(port)}` },
        },
        {
            name: "en-XA",
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
