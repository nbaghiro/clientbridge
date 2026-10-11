import { defineConfig } from "@playwright/test";

const port = Number(process.env.PLAYGROUND_E2E_PORT ?? "8722");
const pseudoPort = Number(process.env.PLAYGROUND_PSEUDO_E2E_PORT ?? "8725");

// Runs against the built playground (pnpm build first), the way CI serves it; the en-XA pass uses the dev server.
export default defineConfig({
    testDir: "e2e",
    testMatch: "*.e2e.ts",
    timeout: 300_000,
    reporter: process.env.CI ? "github" : "list",
    use: {
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
            command: `pnpm exec vite preview --port ${String(port)} --strictPort`,
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
