import { defineConfig } from "@playwright/test";

const port = Number(process.env.WEB_E2E_PORT ?? "8721");

// Needs the local stack (API, PowerSync, seeded Postgres): `make up migrate seed dev-api` first.
export default defineConfig({
    testDir: "e2e",
    testMatch: "*.e2e.ts",
    timeout: 120_000,
    expect: { timeout: 15_000 },
    reporter: [[process.env.CI ? "github" : "list"], ["html", { open: "never" }]],
    workers: 2,
    use: {
        baseURL: `http://localhost:${String(port)}`,
        viewport: { width: 1440, height: 900 },
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        ...(process.env.CI ? {} : { channel: "chrome" }),
    },
    webServer: {
        command: `pnpm exec vite --port ${String(port)} --strictPort`,
        url: `http://localhost:${String(port)}/`,
        reuseExistingServer: !process.env.CI,
    },
});
