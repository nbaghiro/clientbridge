import { defineConfig } from "@playwright/test";
import { recorded } from "@clientbridge/config/e2e/recording";

const port = Number(process.env.SITE_E2E_PORT ?? "8719");

// Runs against the built site (pnpm build first), served the way a static host would serve it.
const config = defineConfig({
    testDir: "e2e",
    testMatch: "*.e2e.ts",
    timeout: 60_000,
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

export default recorded(config);
