import { defineConfig } from "@playwright/test";
import { runBuild, runPort } from "@clientbridge/config/e2e/run";

const port = runPort("WEB_E2E_PORT");
const pseudoPort = runPort("WEB_PSEUDO_E2E_PORT");
const baseURL = `http://localhost:${String(port)}`;

export const chromium = process.env.CI ? {} : { channel: "chrome" };
// the admin console runs only where the functional stack grants an operator and names its URL
const adminUrl = process.env.VITE_ADMIN_URL;

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
    },
    projects: [
        { name: "default", testIgnore: "pseudo.e2e.ts", use: { ...chromium, baseURL } },
        {
            name: "pseudo",
            testMatch: "pseudo.e2e.ts",
            use: { ...chromium, baseURL: `http://localhost:${String(pseudoPort)}` },
        },
        // the cases tagged @browsers carry the auth, storage, navigation and payment risk
        ...(["firefox", "webkit"] as const).map((browserName) => ({
            name: browserName,
            testIgnore: "pseudo.e2e.ts",
            grep: /@browsers/,
            // Playwright's WebKit cannot load a service-worker page offline
            ...(browserName === "webkit" ? { grepInvert: /@no-webkit/ } : {}),
            use: { browserName, baseURL },
        })),
    ],
    webServer: [
        {
            // CI tests the production bundle; locally the dev server keeps edits live
            command: process.env.CI
                ? runBuild("web", port)
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
        ...(adminUrl
            ? [
                  {
                      command: process.env.CI
                          ? runBuild("admin", new URL(adminUrl).port)
                          : `pnpm --filter admin exec vite --port ${new URL(adminUrl).port} --strictPort`,
                      url: `${adminUrl}/`,
                      reuseExistingServer: !process.env.CI,
                  },
              ]
            : []),
    ],
});
