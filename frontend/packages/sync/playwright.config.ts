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
    outputDir: `${output}/results`,
    reporter: [["list"], ["html", { outputFolder: `${output}/report`, open: "never" }]],
    use: { baseURL: `http://localhost:${port}` },
    webServer: {
        command: `pnpm exec vite packages/sync/e2e --port ${port} --strictPort`,
        cwd: "../..",
        url: `http://localhost:${port}`,
        reuseExistingServer: false,
    },
});
