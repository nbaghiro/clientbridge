import { defineConfig } from "@playwright/test";

const port = Number(process.env.PLAYGROUND_E2E_PORT ?? "8722");

// Runs against the built playground (pnpm build first), the way CI serves it.
export default defineConfig({
    testDir: "e2e",
    testMatch: "*.e2e.ts",
    timeout: 300_000,
    reporter: process.env.CI ? "github" : "list",
    use: {
        baseURL: `http://localhost:${String(port)}`,
        ...(process.env.CI ? {} : { channel: "chrome" }),
    },
    webServer: {
        command: `pnpm exec vite preview --port ${String(port)} --strictPort`,
        url: `http://localhost:${String(port)}/`,
        reuseExistingServer: !process.env.CI,
    },
});
