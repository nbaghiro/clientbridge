import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./e2e",
    testMatch: "*.e2e.ts",
    timeout: 30_000,
    workers: 1,
    use: {
        baseURL: "http://localhost:8791",
        ...(process.env.CI ? {} : { channel: "chrome" }),
    },
    webServer: {
        command: "pnpm exec vite packages/sync/e2e --port 8791 --strictPort",
        cwd: "../..",
        url: "http://localhost:8791",
        reuseExistingServer: false,
    },
});
