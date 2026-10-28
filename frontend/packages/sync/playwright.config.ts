import { defineConfig } from "@playwright/test";

function required(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set: run make test-sync`);
    return value;
}

const port = required("SYNC_TEST_PORT");
const output = required("SYNC_TEST_OUTPUT");

export default defineConfig({
    testDir: "./e2e",
    testMatch: "*.e2e.ts",
    timeout: 30_000,
    workers: 1,
    forbidOnly: true,
    outputDir: `${output}/results`,
    reporter: [
        ["list"],
        ["json", { outputFile: `${output}/results.json` }],
        ["html", { outputFolder: `${output}/report`, open: "never" }],
    ],
    use: { baseURL: `http://localhost:${port}` },
    projects: [
        { name: "chromium", use: { browserName: "chromium" } },
        // the lifecycle cases carry the OPFS locking and file risk that differs by engine
        ...(["firefox", "webkit"] as const).map((browserName) => ({
            name: browserName,
            testMatch: "lifecycle.e2e.ts",
            // Firefox's shared sync worker keeps each restarted stream's connection; six stop sync
            ...(browserName === "firefox" ? { grepInvert: /@stream-restarts/ } : {}),
            use: { browserName },
        })),
        // IndexedDB, which Chromium and Firefox keep the replica in until the OPFS switch
        ...(["chromium", "firefox"] as const).map((browserName) => ({
            name: `${browserName}-indexeddb`,
            testMatch: ["lifecycle.e2e.ts", "hours.e2e.ts"],
            grepInvert: browserName === "firefox" ? /@opfs|@stream-restarts/ : /@opfs/,
            metadata: { storage: "indexeddb" },
            use: { browserName },
        })),
    ],
    webServer: {
        command: `pnpm exec vite packages/sync/e2e --port ${port} --strictPort`,
        cwd: "../..",
        url: `http://localhost:${port}`,
        reuseExistingServer: false,
    },
});
